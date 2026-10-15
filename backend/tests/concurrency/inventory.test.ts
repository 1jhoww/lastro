import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import { productInput } from '../helpers/commercial.js';
import { stockProduct, enter, adjust, balance, stockHeaders } from '../helpers/inventory.js';
const f = registerFixture();
describe('Estoque concorrente', () => {
  it('duas entradas preservam soma, sequência e reconciliação', async () => {
    const id = await stockProduct(f);
    const outcomes = await Promise.all([enter(f, id, '2'), enter(f, id, '3')]);
    expect(outcomes.map((r) => r.status)).toEqual([201, 201]);
    expect((await balance(f, id).expect(200)).body.data).toMatchObject({
      physical: '5',
      version: 2,
    });
    expect(
      (
        await request(f.app)
          .get(`/api/v1/inventory/${id}/reconciliation`)
          .set(stockHeaders(f))
          .expect(200)
      ).body.data.consistent,
    ).toBe(true);
  });
  it('mesma requisição concorrente não duplica movimento, saldo ou auditoria', async () => {
    const id = await stockProduct(f);
    const key = randomUUID();
    const outcomes = await Promise.all([enter(f, id, '2', key), enter(f, id, '2', key)]);
    expect(outcomes.map((r) => r.status)).toEqual([201, 201]);
    expect(outcomes[0]!.body.data).toEqual(outcomes[1]!.body.data);
    expect((await balance(f, id).expect(200)).body.data.physical).toBe('2');
    expect(
      (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/inventoryMovements`).get())
        .size,
    ).toBe(1);
  });
  it('mesma chave com quantidades divergentes aceita somente uma', async () => {
    const id = await stockProduct(f);
    const key = randomUUID();
    const outcomes = await Promise.all([enter(f, id, '2', key), enter(f, id, '3', key)]);
    expect(outcomes.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await balance(f, id).expect(200)).body.data.physical).toBe(
      outcomes.find((r) => r.status === 201)!.body.data.stock.physical,
    );
  });
  it('dois ajustes da mesma versão aceitam só um, sem saldo negativo', async () => {
    const id = await stockProduct(f);
    await enter(f, id, '5').expect(201);
    const outcomes = await Promise.all([adjust(f, id, '-4', 1), adjust(f, id, '-4', 1)]);
    expect(outcomes.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await balance(f, id).expect(200)).body.data.physical).toBe('1');
  });
  it('entrada e ajuste simultâneos não perdem atualização ou sobrescrevem contagem antiga', async () => {
    const id = await stockProduct(f);
    await enter(f, id, '5').expect(201);
    const outcomes = await Promise.all([enter(f, id, '2'), adjust(f, id, '-4', 1)]);
    expect(outcomes[0]!.status).toBe(201);
    expect([201, 409]).toContain(outcomes[1]!.status);
    expect((await balance(f, id).expect(200)).body.data.physical).toBe(
      outcomes[1]!.status === 201 ? '3' : '7',
    );
    expect(
      (
        await request(f.app)
          .get(`/api/v1/inventory/${id}/reconciliation`)
          .set(stockHeaders(f))
          .expect(200)
      ).body.data.consistent,
    ).toBe(true);
  });
  it('empresas diferentes operam SKU e chave iguais sem compartilhar saldo', async () => {
    const id = await stockProduct(f, { sku: 'SAME' });
    const other = await request(f.app)
      .post('/api/v1/products')
      .set(tenantHeaders(f.ownerB, f.tenantB.tenant.id))
      .send(productInput('SAME'))
      .expect(201);
    const key = randomUUID();
    const outcomes = await Promise.all([
      enter(f, id, '2', key),
      request(f.app)
        .post('/api/v1/inventory/entries')
        .set(tenantHeaders(f.ownerB, f.tenantB.tenant.id))
        .set('Idempotency-Key', key)
        .send({ productId: other.body.data.id, quantity: '3', reason: 'Recebimento sintético' }),
    ]);
    expect(outcomes.map((r) => r.status)).toEqual([201, 201]);
    expect((await balance(f, id).expect(200)).body.data.physical).toBe('2');
    expect(
      (
        await request(f.app)
          .get(`/api/v1/inventory/${other.body.data.id}`)
          .set(tenantHeaders(f.ownerB, f.tenantB.tenant.id))
          .expect(200)
      ).body.data.physical,
    ).toBe('3');
  });
  it('troca de unidade contra primeira entrada preserva unidade coerente do histórico', async () => {
    const id = await stockProduct(f);
    const outcomes = await Promise.all([
      enter(f, id, '1'),
      request(f.app)
        .patch(`/api/v1/products/${id}`)
        .set(stockHeaders(f))
        .send({ expectedVersion: 1, unit: 'KG' }),
    ]);
    expect(outcomes[0]!.status).toBe(201);
    expect([200, 409]).toContain(outcomes[1]!.status);
    const stock = (await balance(f, id).expect(200)).body.data;
    expect(stock.unit).toBe(outcomes[0]!.body.data.movement.unit);
    expect(
      (
        await request(f.app)
          .get(`/api/v1/inventory/${id}/reconciliation`)
          .set(stockHeaders(f))
          .expect(200)
      ).body.data.consistent,
    ).toBe(true);
  });
});
