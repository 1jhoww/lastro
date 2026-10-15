import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture } from '../helpers/fixture.js';
import { seller } from '../helpers/commercial.js';
import { stockProduct, enter, balance } from '../helpers/inventory.js';
import {
  draft,
  command,
  confirm,
  orderHeaders,
  orderDocs,
  orderCustomer,
} from '../helpers/orders.js';
import { orderView } from '../../src/shared/schemas/orders.js';
import * as audit from '../../src/shared/audit/audit.js';
const f = registerFixture();
describe('Pedidos integrados', () => {
  it('transições inválidas e edição fora de draft não alteram compromisso', async () => {
    const draftOrder = await draft(f);
    await command(f, draftOrder, 'dispatch').expect(409);
    const confirmed = await confirm(f, draftOrder);
    await command(f, confirmed, 'confirm').expect(409);
    await request(f.app)
      .patch(`/api/v1/orders/${confirmed.id}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: confirmed.version, notes: 'Não permitido' })
      .expect(409);
    const dispatched = orderView.parse(
      (await command(f, confirmed, 'dispatch').expect(200)).body.data,
    );
    for (const action of ['confirm', 'dispatch', 'cancel'] as const)
      await command(f, dispatched, action).expect(409);
    const other = await draft(f);
    const canceled = orderView.parse((await command(f, other, 'cancel').expect(200)).body.data);
    for (const action of ['confirm', 'dispatch', 'cancel'] as const)
      await command(f, canceled, action).expect(409);
  });
  it.each(['dispatch', 'cancel'] as const)(
    'falha durante %s não deixa liberação/baixa/recebível parcial',
    async (action) => {
      const order = await confirm(f, await draft(f)),
        key = randomUUID(),
        original = audit.recordAudit;
      const spy = vi.spyOn(audit, 'recordAudit').mockImplementation((...args) => {
        original(...args);
        throw new Error('Falha sintética');
      });
      try {
        await command(f, order, action, f.ownerA, key).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data).toMatchObject({
        physical: '10',
        reserved: '1',
      });
      expect((await orderDocs(f, 'stockReservations').get()).docs[0]!.get('status')).toBe(
        'reserved',
      );
      expect((await orderDocs(f, 'receivables').get()).docs[0]!.get('status')).toBe('open');
      expect((await orderDocs(f, 'orders').doc(order.id).get()).get('status')).toBe('confirmed');
      expect((await orderDocs(f, 'orderOperations').get()).size).toBe(1);
      expect((await orderDocs(f, 'inventoryMovements').get()).size).toBe(2);
      await command(f, order, action, f.ownerA, key).expect(200);
    },
  );
  it('parcela ausente ou com tenant divergente bloqueia cancelamento sem liberar reserva', async () => {
    const one = await confirm(f, await draft(f)),
      two = await confirm(f, await draft(f));
    await orderDocs(f, 'receivables').doc(one.installments[0]!.id).delete();
    await orderDocs(f, 'receivables')
      .doc(two.installments[0]!.id)
      .update({ tenantId: f.tenantB.tenant.id });
    for (const o of [one, two]) {
      await command(f, o, 'cancel').expect(409);
      expect((await balance(f, o.lines[0]!.productId).expect(200)).body.data.reserved).toBe('1');
    }
  });
  it('cria rascunho sem reservas/recebíveis e edita com versão', async () => {
    const o = await draft(f);
    expect(o).toMatchObject({
      status: 'draft',
      subtotalCents: 2050,
      totalCents: 2050,
      discount: null,
      version: 1,
    });
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(0);
    expect((await orderDocs(f, 'receivables').get()).size).toBe(0);
    const edited = await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f))
      .send({
        expectedVersion: 1,
        lines: [{ productId: o.lines[0]!.productId, quantity: '2' }],
        notes: 'Teste',
      })
      .expect(200);
    expect(edited.body.data).toMatchObject({ version: 2, totalCents: 4100, notes: 'Teste' });
    await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1, notes: 'Outra' })
      .expect(409);
  });
  it('confirma, reserva e gera recebível com identidade estável e histórico', async () => {
    const o = await draft(f),
      next = await confirm(f, o);
    expect(next).toMatchObject({ status: 'confirmed', version: 2, confirmedBy: f.ownerA.uid });
    expect((await balance(f, o.lines[0]!.productId).expect(200)).body.data).toMatchObject({
      physical: '10',
      reserved: '1',
      available: '9',
    });
    const reservations = await orderDocs(f, 'stockReservations').get(),
      receivables = await orderDocs(f, 'receivables').get();
    expect(reservations.docs[0]!.data()).toMatchObject({
      orderId: o.id,
      lineId: o.lines[0]!.id,
      status: 'reserved',
      quantityScaled: 1000,
    });
    expect(receivables.docs[0]!.data()).toMatchObject({
      id: next.installments[0]!.id,
      orderId: o.id,
      originalCents: 2050,
      outstandingCents: 2050,
      receivedCents: 0,
      status: 'open',
    });
    const h = await request(f.app)
      .get(`/api/v1/orders/${o.id}/history?limit=1`)
      .set(orderHeaders(f))
      .expect(200);
    expect(h.body.data.items[0]).toMatchObject({
      type: 'created',
      previousStatus: null,
      status: 'draft',
    });
    const h2 = await request(f.app)
      .get(`/api/v1/orders/${o.id}/history`)
      .query({ limit: '1', cursor: h.body.data.nextCursor })
      .set(orderHeaders(f))
      .expect(200);
    expect(h2.body.data.items[0]).toMatchObject({
      type: 'confirmed',
      previousStatus: 'draft',
      status: 'confirmed',
    });
  });
  it('estoque insuficiente em uma linha reverte todos os produtos e recebíveis', async () => {
    const a = await stockProduct(f),
      b = await stockProduct(f);
    await enter(f, a, '3').expect(201);
    const o = await draft(f, f.ownerA, {
      productId: a,
      extra: {
        lines: [
          { productId: a, quantity: '1' },
          { productId: b, quantity: '1' },
        ],
      },
    });
    await command(f, o, 'confirm').expect(409);
    expect((await balance(f, a).expect(200)).body.data.reserved).toBe('0');
    for (const c of ['stockReservations', 'receivables', 'orderOperations'])
      expect((await orderDocs(f, c).get()).size).toBe(0);
    expect((await orderDocs(f, 'orders').doc(o.id).get()).get('status')).toBe('draft');
  });
  it('confirmação repetida devolve snapshot original inclusive após expedição', async () => {
    const o = await draft(f),
      key = randomUUID(),
      first = await confirm(f, o, f.ownerA, key);
    await command(f, first, 'dispatch').expect(200);
    expect((await command(f, o, 'confirm', f.ownerA, key).expect(200)).body.data).toEqual(first);
    await command(f, o, 'confirm', f.ownerA, key, { expectedVersion: 2 }).expect(409);
    expect((await orderDocs(f, 'receivables').get()).size).toBe(1);
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(1);
  });
  it('parcelamento em 3 e 12 soma centavos exatos', async () => {
    const id = await stockProduct(f, { priceCents: 100000 });
    await enter(f, id, '3').expect(201);
    const dates = ['2090-01-01', '2090-02-15', '2090-03-31'];
    const o = await draft(f, f.ownerA, {
      productId: id,
      extra: { payment: { type: 'installments', dueDates: dates } },
    });
    const next = await confirm(f, o);
    expect(next.installments.map((p) => p.amountCents)).toEqual([33334, 33333, 33333]);
    expect(
      (await orderDocs(f, 'receivables').get()).docs.reduce(
        (a, d) => a + d.get('originalCents'),
        0,
      ),
    ).toBe(100000);
    const other = await draft(f, f.ownerA, {
      productId: id,
      extra: {
        payment: { type: 'installments', dueDates: Array.from({ length: 12 }, () => '2091-01-01') },
      },
    });
    await confirm(f, other);
    expect((await orderDocs(f, 'receivables').get()).size).toBe(15);
  });
  it('quantidade KG e centavos arredondam de forma exata', async () => {
    const id = await stockProduct(f, { unit: 'KG', priceCents: 5 });
    await enter(f, id, '1').expect(201);
    const o = await draft(f, f.ownerA, { productId: id, quantity: '0.100' });
    expect((await confirm(f, o)).totalCents).toBe(1);
    expect((await balance(f, id).expect(200)).body.data).toMatchObject({
      physical: '1',
      reserved: '0.1',
    });
  });
  it('desconto administrativo aprovado pode ser confirmado pelo vendedor', async () => {
    const user = await seller(f),
      o = await draft(f, user);
    const edit = await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f))
      .send({
        expectedVersion: 1,
        discount: { type: 'percentage', value: 1000, reason: 'Campanha sintética' },
      })
      .expect(200);
    const approved = orderView.parse(edit.body.data),
      next = await confirm(f, approved, user);
    expect(next).toMatchObject({
      totalCents: 1845,
      discountCents: 205,
      discount: {
        approvedBy: f.ownerA.uid,
        approvedVersion: 2,
        beforeCents: 2050,
        afterCents: 1845,
      },
    });
  });
  it('edição pelo vendedor invalida aprovação administrativa automaticamente', async () => {
    const user = await seller(f),
      o = await draft(f, user);
    await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f))
      .send({
        expectedVersion: 1,
        discount: { type: 'fixed', value: 50, reason: 'Teste desconto' },
      })
      .expect(200);
    const changed = await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f, user))
      .send({ expectedVersion: 2, lines: [{ productId: o.lines[0]!.productId, quantity: '2' }] })
      .expect(200);
    expect(changed.body.data.discount).toBeNull();
    expect((await confirm(f, orderView.parse(changed.body.data), user)).totalCents).toBe(4100);
  });
  it('mudança de preço exige reaprovar desconto e confirmação sem desconto usa novo preço', async () => {
    const o = await draft(f, f.ownerA, {
      extra: { discount: { type: 'fixed', value: 100, reason: 'Teste autorização' } },
    });
    await request(f.app)
      .patch(`/api/v1/products/${o.lines[0]!.productId}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1, priceCents: 3000 })
      .expect(200);
    expect((await command(f, o, 'confirm').expect(409)).body.error.code).toBe(
      'DISCOUNT_APPROVAL_REQUIRED',
    );
    const edit = await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f))
      .send({
        expectedVersion: 1,
        discount: { type: 'fixed', value: 100, reason: 'Reaprovação sintética' },
      })
      .expect(200);
    expect((await confirm(f, orderView.parse(edit.body.data))).totalCents).toBe(2900);
    const plain = await draft(f);
    await request(f.app)
      .patch(`/api/v1/products/${plain.lines[0]!.productId}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1, priceCents: 1234 })
      .expect(200);
    expect((await confirm(f, plain)).totalCents).toBe(1234);
  });
  it('expede integralmente e preserva snapshot após alteração de produto', async () => {
    const o = await confirm(f, await draft(f)),
      key = randomUUID();
    await request(f.app)
      .patch(`/api/v1/products/${o.lines[0]!.productId}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1, priceCents: 999, name: 'Mudou nome' })
      .expect(200);
    const result = await command(f, o, 'dispatch', f.ownerA, key).expect(200);
    expect(result.body.data).toMatchObject({
      status: 'dispatched',
      totalCents: 2050,
      dispatchedBy: f.ownerA.uid,
    });
    expect(result.body.data.lines).toEqual(o.lines);
    expect((await command(f, o, 'dispatch', f.ownerA, key).expect(200)).body.data).toEqual(
      result.body.data,
    );
    expect((await balance(f, o.lines[0]!.productId).expect(200)).body.data).toMatchObject({
      physical: '9',
      reserved: '0',
    });
    expect((await orderDocs(f, 'stockReservations').get()).docs[0]!.get('status')).toBe(
      'dispatched',
    );
    await command(f, orderView.parse(result.body.data), 'cancel').expect(409);
  });
  it('vendedor autorizado expede seu pedido', async () => {
    const user = await seller(f),
      o = await confirm(f, await draft(f, user), user);
    await command(f, o, 'dispatch', user).expect(200);
  });
  it('cancela rascunho sem efeitos de estoque ou recebíveis', async () => {
    const o = await draft(f),
      key = randomUUID();
    const c = await command(f, o, 'cancel', f.ownerA, key).expect(200);
    expect(c.body.data.status).toBe('canceled');
    expect((await command(f, o, 'cancel', f.ownerA, key).expect(200)).body.data).toEqual(
      c.body.data,
    );
    expect((await orderDocs(f, 'receivables').get()).size).toBe(0);
    expect((await balance(f, o.lines[0]!.productId).expect(200)).body.data.reserved).toBe('0');
    await command(f, orderView.parse(c.body.data), 'confirm').expect(409);
  });
  it('cancela confirmado, libera somente suas reservas e cancela recebíveis', async () => {
    const first = await confirm(f, await draft(f)),
      second = await confirm(f, await draft(f, f.ownerA, { productId: first.lines[0]!.productId }));
    const canceled = await command(f, first, 'cancel').expect(200);
    expect(canceled.body.data.lines).toEqual(first.lines);
    expect((await balance(f, first.lines[0]!.productId).expect(200)).body.data).toMatchObject({
      physical: '10',
      reserved: '1',
    });
    const receivables = await orderDocs(f, 'receivables').get();
    expect(receivables.docs.find((d) => d.get('orderId') === first.id)!.data()).toMatchObject({
      status: 'canceled',
      originalCents: 2050,
      outstandingCents: 0,
    });
    expect(receivables.docs.find((d) => d.get('orderId') === second.id)!.get('status')).toBe(
      'open',
    );
  });
  it.each(['payment', 'guard', 'receivable'] as const)(
    'bloqueia cancelamento com registro financeiro em %s',
    async (target) => {
      const o = await confirm(f, await draft(f));
      if (target === 'payment')
        await orderDocs(f, 'payments').doc('synthetic').set({ orderId: o.id, amountCents: 1 });
      if (target === 'guard')
        await orderDocs(f, 'orderFinancialGuards')
          .doc(o.id)
          .update({ paymentCount: 1, receivedCents: 1 });
      if (target === 'receivable')
        await orderDocs(f, 'receivables')
          .doc(o.installments[0]!.id)
          .update({ receivedCents: 1, outstandingCents: 2049, status: 'partially_paid' });
      expect((await command(f, o, 'cancel').expect(409)).body.error.code).toBe(
        'FINANCIAL_CANCELLATION_REQUIRED',
      );
      expect((await balance(f, o.lines[0]!.productId).expect(200)).body.data.reserved).toBe('1');
      expect((await orderDocs(f, 'orders').doc(o.id).get()).get('status')).toBe('confirmed');
    },
  );
  it('falha no staging desfaz pedido, reservas, recebíveis, movimentos e idempotência', async () => {
    const o = await draft(f),
      key = randomUUID(),
      original = audit.recordAudit;
    const spy = vi.spyOn(audit, 'recordAudit').mockImplementation((...args) => {
      original(...args);
      throw new Error('Falha sintética');
    });
    try {
      await command(f, o, 'confirm', f.ownerA, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    for (const c of ['stockReservations', 'receivables', 'orderOperations', 'orderFinancialGuards'])
      expect((await orderDocs(f, c).get()).size).toBe(0);
    expect((await orderDocs(f, 'inventoryMovements').get()).size).toBe(1);
    expect((await orderDocs(f, 'orders').doc(o.id).get()).get('status')).toBe('draft');
    await confirm(f, o, f.ownerA, key);
  });
  it('reconcilia estoque após reserva, expedição e liberação', async () => {
    const one = await confirm(f, await draft(f)),
      two = await confirm(f, await draft(f, f.ownerA, { productId: one.lines[0]!.productId }));
    await command(f, one, 'dispatch').expect(200);
    await command(f, two, 'cancel').expect(200);
    const result = await request(f.app)
      .get(`/api/v1/inventory/${one.lines[0]!.productId}/reconciliation`)
      .set(orderHeaders(f))
      .expect(200);
    expect(result.body.data).toMatchObject({
      complete: true,
      consistent: true,
      physical: '9',
      reserved: '0',
      checkedMovements: 5,
    });
  });
  it('lista pedidos paginados com filtros e IDs comerciais únicos', async () => {
    const a = await draft(f),
      b = await draft(f);
    expect(a.commercialId).not.toBe(b.commercialId);
    const query = { status: 'draft', direction: 'asc', limit: '1' };
    const first = await request(f.app)
      .get('/api/v1/orders')
      .query(query)
      .set(orderHeaders(f))
      .expect(200);
    const next = await request(f.app)
      .get('/api/v1/orders')
      .query({ ...query, cursor: first.body.data.nextCursor })
      .set(orderHeaders(f))
      .expect(200);
    expect(next.body.data.items[0].id).not.toBe(first.body.data.items[0].id);
    await request(f.app)
      .get('/api/v1/orders')
      .query({ customerId: a.customerId })
      .set(orderHeaders(f))
      .expect(200);
    await request(f.app)
      .get('/api/v1/orders')
      .query({ ...query, status: 'confirmed', cursor: first.body.data.nextCursor })
      .set(orderHeaders(f))
      .expect(422);
  });
  it('cenário histórico de 10 linhas com descrições máximas e 12 parcelas confirma atomicamente', async () => {
    const products: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = await stockProduct(f, {
        name: 'P'.repeat(160),
        description: 'd'.repeat(2000),
        priceCents: 100,
      });
      await enter(f, id, '1').expect(201);
      products.push(id);
    }
    const customerId = await orderCustomer(f);
    const o = await draft(f, f.ownerA, {
      productId: products[0]!,
      customerId,
      extra: {
        notes: 'n'.repeat(1000),
        lines: products.map((productId) => ({ productId, quantity: '1' })),
        payment: { type: 'installments', dueDates: Array.from({ length: 12 }, () => '2090-01-01') },
      },
    });
    const start = performance.now(),
      result = await confirm(f, o),
      elapsedMs = performance.now() - start;
    const stored = (await orderDocs(f, 'orders').doc(o.id).get()).data()!;
    const all = [
      stored,
      ...(await orderDocs(f, 'stockReservations').get()).docs.map((d) => d.data()),
      ...(await orderDocs(f, 'receivables').get()).docs.map((d) => d.data()),
      ...(await orderDocs(f, 'inventoryMovements').where('origin', '==', 'order').get()).docs.map(
        (d) => d.data(),
      ),
      ...(await orderDocs(f, 'orderOperations').get()).docs.map((d) => d.data()),
      ...(await orderDocs(f, 'inventory').get()).docs.map((d) => d.data()),
    ];
    const jsonBytes = all.reduce((a, d) => a + Buffer.byteLength(JSON.stringify(d)), 0);
    console.info(
      JSON.stringify({
        phaseDLimit: {
          lines: 10,
          installments: 12,
          elapsedMs: Math.round(elapsedMs),
          orderJsonBytes: Buffer.byteLength(JSON.stringify(stored)),
          domainJsonBytes: jsonBytes,
        },
      }),
    );
    expect(result.status).toBe('confirmed');
    expect(result.totalCents).toBe(1000);
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(10);
    expect((await orderDocs(f, 'receivables').get()).size).toBe(12);
    expect(jsonBytes).toBeLessThan(1024 * 1024);
  });
});
