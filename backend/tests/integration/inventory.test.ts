import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture } from '../helpers/fixture.js';
import { stockProduct, enter, adjust, balance, stockHeaders } from '../helpers/inventory.js';
import { seller } from '../helpers/commercial.js';
import * as audit from '../../src/shared/audit/audit.js';
const f = registerFixture();
describe('Estoque integrado', () => {
  it('saldo zero de produto novo e legado com mínimo padrão zero', async () => {
    const id = await stockProduct(f);
    const ref = f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}/products/${id}`);
    const legacy = (await ref.get()).data()!;
    delete legacy.minimumStock;
    await ref.set(legacy);
    await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}/inventory/${id}`).delete();
    expect((await balance(f, id).expect(200)).body.data).toMatchObject({
      physical: '0',
      reserved: '0',
      available: '0',
      minimumStock: '0',
      version: 0,
    });
    expect(
      (await request(f.app).get('/api/v1/inventory').set(stockHeaders(f)).expect(200)).body.data
        .items,
    ).toHaveLength(1);
    expect(
      (await request(f.app).get(`/api/v1/products/${id}`).set(stockHeaders(f)).expect(200)).body
        .data.minimumStock,
    ).toBe('0');
    await enter(f, id, '1').expect(201);
  });
  it('entrada grava saldo, movimento, autoria, idempotência e auditoria juntos', async () => {
    const id = await stockProduct(f);
    const key = randomUUID();
    const result = await enter(f, id, '12', key).expect(201);
    expect(result.body.data.stock).toMatchObject({
      physical: '12',
      reserved: '0',
      available: '12',
      version: 1,
    });
    expect(result.body.data.movement).toMatchObject({
      type: 'STOCK_ENTRY',
      quantity: '12',
      origin: 'administrative',
      originReference: key,
      actorUid: f.ownerA.uid,
      previousPhysical: '0',
      physical: '12',
    });
    expect((await enter(f, id, '12', key).expect(201)).body.data).toEqual(result.body.data);
    await enter(f, id, '13', key).expect(409);
    expect(
      (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/inventoryMovements`).get())
        .size,
    ).toBe(1);
    expect(
      (
        await f.firebase.db
          .collection(`tenants/${f.tenantA.tenant.id}/auditLogs`)
          .where('action', '==', 'inventory.moved')
          .get()
      ).size,
    ).toBe(1);
  });
  it('ajustes positivos/negativos exigem versão, preservam histórico e aceitam replay', async () => {
    const id = await stockProduct(f);
    await enter(f, id).expect(201);
    const key = randomUUID();
    const positive = await adjust(f, id, '2', 1, key).expect(201);
    expect(positive.body.data.movement.type).toBe('STOCK_ADJUSTMENT_IN');
    expect((await adjust(f, id, '2', 1, key).expect(201)).body.data).toEqual(positive.body.data);
    const negative = await adjust(f, id, '-3', 2).expect(201);
    expect(negative.body.data.stock.physical).toBe('9');
    expect(negative.body.data.movement.type).toBe('STOCK_ADJUSTMENT_OUT');
    await adjust(f, id, '1', 2).expect(409);
    await adjust(f, id, '-10', 3).expect(409);
    expect((await balance(f, id).expect(200)).body.data.version).toBe(3);
  });
  it.each(['KG', 'L'] as const)('entrada e ajustes em %s são exatos', async (unit) => {
    const id = await stockProduct(f, { unit, minimumStock: '1.250' });
    await enter(f, id, '1.250').expect(201);
    await enter(f, id, '0.001').expect(201);
    const result = await adjust(f, id, '-0.001', 2).expect(201);
    expect(result.body.data.stock.physical).toBe('1.25');
    await enter(f, id, '1.2501').expect(422);
    expect(
      (await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}/inventory/${id}`).get()).get(
        'physicalScaled',
      ),
    ).toBe(1250);
  });
  it('produto com movimentos mantém unidade mesmo após saldo voltar a zero', async () => {
    const id = await stockProduct(f);
    await enter(f, id, '1').expect(201);
    await adjust(f, id, '-1', 1).expect(201);
    const result = await request(f.app)
      .patch(`/api/v1/products/${id}`)
      .set(stockHeaders(f))
      .send({ expectedVersion: 1, unit: 'KG' })
      .expect(409);
    expect(result.body.error.code).toBe('UNIT_LOCKED');
    const empty = await stockProduct(f);
    await request(f.app)
      .patch(`/api/v1/products/${empty}`)
      .set(stockHeaders(f))
      .send({ expectedVersion: 1, unit: 'KG' })
      .expect(200);
    expect((await balance(f, empty).expect(200)).body.data.unit).toBe('KG');
  });
  it('mínimo/reposição refletem saldo disponível e atualização administrativa', async () => {
    const id = await stockProduct(f, { minimumStock: '10' });
    let list = await request(f.app)
      .get('/api/v1/inventory/replenishment')
      .set(stockHeaders(f))
      .expect(200);
    expect(list.body.data.items[0]).toMatchObject({ productId: id, suggestedQuantity: '10' });
    await enter(f, id, '100').expect(201);
    // Reserved balance is a synthetic fixture only. No order/reservation operation is persisted.
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/inventory/${id}`)
      .update({ reservedScaled: 95000, belowMinimum: true, shortfallScaled: 5000 });
    list = await request(f.app)
      .get('/api/v1/inventory/replenishment')
      .set(stockHeaders(f))
      .expect(200);
    expect(list.body.data.items[0]).toMatchObject({
      physical: '100',
      reserved: '95',
      available: '5',
      suggestedQuantity: '5',
    });
    await adjust(f, id, '-6', 1).expect(409);
    await request(f.app)
      .patch(`/api/v1/products/${id}`)
      .set(stockHeaders(f))
      .send({ expectedVersion: 1, minimumStock: '4' })
      .expect(200);
    expect(
      (await request(f.app).get('/api/v1/inventory/replenishment').set(stockHeaders(f)).expect(200))
        .body.data.items,
    ).toHaveLength(0);
    expect((await balance(f, id).expect(200)).body.data.minimumStock).toBe('4');
  });
  it('reposições paginadas/ordenadas, inativos excluídos por padrão e histórico preservado', async () => {
    const first = await stockProduct(f, { name: 'Árvore A', minimumStock: '2' });
    await stockProduct(f, { name: 'Arvore B', minimumStock: '5' });
    const page = await request(f.app)
      .get('/api/v1/inventory/replenishment?q=arv&limit=1')
      .set(stockHeaders(f))
      .expect(200);
    const next = await request(f.app)
      .get('/api/v1/inventory/replenishment')
      .query({ q: 'arv', limit: '1', cursor: page.body.data.nextCursor })
      .set(stockHeaders(f))
      .expect(200);
    expect(next.body.data.items[0].name).toBe('Arvore B');
    const biggest = await request(f.app)
      .get('/api/v1/inventory/replenishment?sort=shortfall&direction=desc')
      .set(stockHeaders(f))
      .expect(200);
    expect(biggest.body.data.items[0].suggestedQuantity).toBe('5');
    await request(f.app)
      .delete(`/api/v1/products/${first}`)
      .set(stockHeaders(f))
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(
      (await request(f.app).get('/api/v1/inventory/replenishment').set(stockHeaders(f)).expect(200))
        .body.data.items,
    ).toHaveLength(1);
    expect(
      (
        await request(f.app)
          .get('/api/v1/inventory/replenishment?status=all')
          .set(stockHeaders(f))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(2);
    await balance(f, first).expect(200);
  });
  it('movimentos filtram produto/período/tipo e paginam sem alterar registros', async () => {
    const id = await stockProduct(f);
    const earliest = await enter(f, id, '1').expect(201);
    await enter(f, id, '2').expect(201);
    await adjust(f, id, '1', 2).expect(201);
    const query = {
      productId: id,
      type: 'STOCK_ENTRY',
      from: earliest.body.data.movement.occurredAt.slice(0, 19) + 'Z',
      to: '2099-01-01T00:00:00Z',
      limit: '1',
    };
    const first = await request(f.app)
      .get('/api/v1/inventory/movements')
      .query(query)
      .set(stockHeaders(f))
      .expect(200);
    const second = await request(f.app)
      .get('/api/v1/inventory/movements')
      .query({ ...query, cursor: first.body.data.nextCursor })
      .set(stockHeaders(f))
      .expect(200);
    expect(first.body.data.items[0].id).not.toBe(second.body.data.items[0].id);
    expect(first.body.data.items[0].tenantId).toBeUndefined();
    await request(f.app)
      .patch(`/api/v1/inventory/movements/${first.body.data.items[0].id}`)
      .set(stockHeaders(f))
      .send({ quantity: '20' })
      .expect(404);
  });
  it('reconcilia por páginas e detecta modificação de histórico', async () => {
    const id = await stockProduct(f);
    const one = await enter(f, id, '1').expect(201);
    await enter(f, id, '2').expect(201);
    const first = await request(f.app)
      .get(`/api/v1/inventory/${id}/reconciliation?limit=1`)
      .set(stockHeaders(f))
      .expect(200);
    expect(first.body.data).toMatchObject({
      complete: false,
      consistent: true,
      checkedMovements: 1,
    });
    const second = await request(f.app)
      .get(`/api/v1/inventory/${id}/reconciliation`)
      .query({ limit: '1', cursor: first.body.data.nextCursor })
      .set(stockHeaders(f))
      .expect(200);
    expect(second.body.data).toMatchObject({
      complete: true,
      consistent: true,
      physical: '3',
      checkedMovements: 2,
    });
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/inventoryMovements/${one.body.data.movement.id}`)
      .update({ reason: 'Alteração externa simulada' });
    expect(
      (
        await request(f.app)
          .get(`/api/v1/inventory/${id}/reconciliation`)
          .set(stockHeaders(f))
          .expect(200)
      ).body.data.consistent,
    ).toBe(false);
  });
  it('reconciliação detecta duplicata na fronteira de página e saldo divergente', async () => {
    const id = await stockProduct(f);
    const one = await enter(f, id, '1').expect(201);
    const movementRef = f.firebase.db.doc(
      `tenants/${f.tenantA.tenant.id}/inventoryMovements/${one.body.data.movement.id}`,
    );
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/inventoryMovements/duplicate`)
      .set({ ...(await movementRef.get()).data(), id: 'duplicate' });
    const first = await request(f.app)
      .get(`/api/v1/inventory/${id}/reconciliation?limit=1`)
      .set(stockHeaders(f))
      .expect(200);
    const next = await request(f.app)
      .get(`/api/v1/inventory/${id}/reconciliation`)
      .query({ limit: '1', cursor: first.body.data.nextCursor })
      .set(stockHeaders(f))
      .expect(200);
    expect(next.body.data).toMatchObject({ complete: true, consistent: false });
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/inventory/${id}`)
      .update({ physicalScaled: 2000 });
    expect(
      (
        await request(f.app)
          .get(`/api/v1/inventory/${id}/reconciliation`)
          .set(stockHeaders(f))
          .expect(200)
      ).body.data.consistent,
    ).toBe(false);
  });
  it('falha após staging de escritas não deixa saldo/movimento/idempotência/auditoria parcial', async () => {
    const id = await stockProduct(f);
    const key = randomUUID();
    const original = audit.recordAudit;
    const spy = vi.spyOn(audit, 'recordAudit').mockImplementation((...args) => {
      original(...args);
      throw new Error('Falha transacional sintética');
    });
    try {
      await enter(f, id, '1', key).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await balance(f, id).expect(200)).body.data.physical).toBe('0');
    for (const collection of ['stockOperations', 'inventoryMovements'])
      expect(
        (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/${collection}`).get()).size,
      ).toBe(0);
    expect(
      (
        await f.firebase.db
          .collection(`tenants/${f.tenantA.tenant.id}/auditLogs`)
          .where('action', '==', 'inventory.moved')
          .get()
      ).size,
    ).toBe(0);
    await enter(f, id, '1', key).expect(201);
  });
  it('vendedor só recebe disponibilidade de ativos, sem saldos administrativos', async () => {
    const id = await stockProduct(f);
    await enter(f, id, '10').expect(201);
    const user = await seller(f);
    const result = await request(f.app)
      .get(`/api/v1/inventory/${id}`)
      .set(stockHeaders(f, user))
      .expect(200);
    expect(result.body.data.available).toBe('10');
    for (const field of ['physical', 'reserved', 'minimumStock', 'version', 'lastMovementAt'])
      expect(result.body.data[field]).toBeUndefined();
    const list = await request(f.app)
      .get('/api/v1/inventory')
      .set(stockHeaders(f, user))
      .expect(200);
    expect(list.body.data.items[0].physical).toBeUndefined();
    await request(f.app)
      .delete(`/api/v1/products/${id}`)
      .set(stockHeaders(f))
      .send({ expectedVersion: 1 })
      .expect(200);
    await request(f.app).get(`/api/v1/inventory/${id}`).set(stockHeaders(f, user)).expect(404);
  });
});
