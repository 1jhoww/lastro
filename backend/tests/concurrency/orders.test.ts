import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture } from '../helpers/fixture.js';
import {
  draft,
  command,
  confirm,
  orderHeaders,
  orderDocs,
  orderCustomer,
} from '../helpers/orders.js';
import { stockProduct, enter, balance } from '../helpers/inventory.js';
import { orderView } from '../../src/shared/schemas/orders.js';
const f = registerFixture();
describe('Concorrência de pedidos', () => {
  it('duas confirmações disputam última unidade sem sobre-reserva', async () => {
    const productId = await stockProduct(f);
    await enter(f, productId, '1').expect(201);
    const a = await draft(f, f.ownerA, { productId }),
      b = await draft(f, f.ownerA, { productId });
    const results = await Promise.all([command(f, a, 'confirm'), command(f, b, 'confirm')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await balance(f, productId).expect(200)).body.data).toMatchObject({
      physical: '1',
      reserved: '1',
      available: '0',
    });
    expect((await orderDocs(f, 'receivables').get()).size).toBe(1);
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(1);
  });
  it('mesma chave concorrente confirma uma vez e retorna mesmo resultado', async () => {
    const o = await draft(f),
      key = randomUUID();
    const results = await Promise.all([
      command(f, o, 'confirm', f.ownerA, key),
      command(f, o, 'confirm', f.ownerA, key),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body.data).toEqual(results[1]!.body.data);
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(1);
    expect((await orderDocs(f, 'receivables').get()).size).toBe(1);
    expect((await orderDocs(f, 'inventoryMovements').get()).size).toBe(2);
  });
  it('chaves diferentes para mesmo pedido não duplicam efeitos', async () => {
    const o = await draft(f);
    const results = await Promise.all([command(f, o, 'confirm'), command(f, o, 'confirm')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await orderDocs(f, 'receivables').get()).size).toBe(1);
  });
  it('expedição e cancelamento simultâneos têm somente um vencedor', async () => {
    const o = await confirm(f, await draft(f));
    const results = await Promise.all([command(f, o, 'dispatch'), command(f, o, 'cancel')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const stock = (await balance(f, o.lines[0]!.productId).expect(200)).body.data;
    const status = (await orderDocs(f, 'orders').doc(o.id).get()).get('status');
    expect(stock.reserved).toBe('0');
    expect(stock.physical).toBe(status === 'dispatched' ? '9' : '10');
    expect((await orderDocs(f, 'receivables').get()).docs[0]!.get('status')).toBe(
      status === 'dispatched' ? 'open' : 'canceled',
    );
  });
  it.each(['dispatch', 'cancel'] as const)(
    '%s concorrente com mesma chave é aplicado uma vez',
    async (action) => {
      const o = await confirm(f, await draft(f)),
        key = randomUUID();
      const r = await Promise.all([
        command(f, o, action, f.ownerA, key),
        command(f, o, action, f.ownerA, key),
      ]);
      expect(r.map((v) => v.status)).toEqual([200, 200]);
      expect(r[0]!.body.data).toEqual(r[1]!.body.data);
      expect((await orderDocs(f, 'inventoryMovements').get()).size).toBe(3);
    },
  );
  it('edição concorrente com confirmação preserva uma versão coerente', async () => {
    const o = await draft(f);
    const r = await Promise.all([
      command(f, o, 'confirm'),
      request(f.app)
        .patch(`/api/v1/orders/${o.id}`)
        .set(orderHeaders(f))
        .send({ expectedVersion: 1, lines: [{ productId: o.lines[0]!.productId, quantity: '2' }] }),
    ]);
    expect(r.map((v) => v.status).sort()).toEqual([200, 409]);
    const stored = orderView.parse((await orderDocs(f, 'orders').doc(o.id).get()).data());
    const stock = (await balance(f, o.lines[0]!.productId).expect(200)).body.data;
    expect(stock.reserved).toBe(stored.status === 'confirmed' ? '1' : '0');
    expect(stored.totalCents).toBe(stored.status === 'confirmed' ? 2050 : 4100);
  });
  it('tenant distinto pode reutilizar chave sem compartilhar estoque ou recebíveis', async () => {
    const a = await draft(f),
      key = randomUUID(),
      customerId = await orderCustomer(f, f.ownerB, f.tenantB.tenant.id);
    const product = (
      await request(f.app)
        .post('/api/v1/products')
        .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
        .send({ name: 'Outro produto', sku: a.lines[0]!.sku, unit: 'UN', priceCents: 123 })
        .expect(201)
    ).body.data;
    await request(f.app)
      .post('/api/v1/inventory/entries')
      .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
      .set('Idempotency-Key', randomUUID())
      .send({ productId: product.id, quantity: '1', reason: 'Entrada sintética' })
      .expect(201);
    const b = (
      await request(f.app)
        .post('/api/v1/orders')
        .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
        .send({ customerId, lines: [{ productId: product.id, quantity: '1' }], payment: a.payment })
        .expect(201)
    ).body.data;
    const r = await Promise.all([
      command(f, a, 'confirm', f.ownerA, key),
      request(f.app)
        .post(`/api/v1/orders/${b.id}/confirm`)
        .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
        .set('Idempotency-Key', key)
        .send({ expectedVersion: 1 }),
    ]);
    expect(r.map((v) => v.status)).toEqual([200, 200]);
    expect((await orderDocs(f, 'receivables').get()).docs[0]!.get('originalCents')).toBe(2050);
    const other = await f.firebase.db
      .collection(`tenants/${f.tenantB.tenant.id}/receivables`)
      .get();
    expect(other.docs[0]!.get('originalCents')).toBe(123);
  });
});
