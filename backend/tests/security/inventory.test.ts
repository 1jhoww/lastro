import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture, bearer, tenantHeaders } from '../helpers/fixture.js';
import { seller, productInput } from '../helpers/commercial.js';
import { stockProduct, stockHeaders, enter, adjust, balance } from '../helpers/inventory.js';
const f = registerFixture();
describe('Segurança do estoque', () => {
  it('vendedor não altera estoque/mínimo nem consulta movimentos/reposição/reconciliação', async () => {
    const id = await stockProduct(f);
    const user = await seller(f);
    const headers = stockHeaders(f, user);
    for (const path of [
      '/inventory/movements',
      '/inventory/replenishment',
      `/inventory/${id}/reconciliation`,
    ])
      await request(f.app).get(`/api/v1${path}`).set(headers).expect(403);
    await request(f.app)
      .post('/api/v1/inventory/entries')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ productId: id, quantity: '1', reason: 'Teste' })
      .expect(403);
    await request(f.app)
      .post('/api/v1/inventory/adjustments')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ productId: id, delta: '-1', expectedVersion: 0, reason: 'Teste' })
      .expect(403);
    await request(f.app)
      .patch(`/api/v1/products/${id}`)
      .set(headers)
      .send({ expectedVersion: 1, minimumStock: '10' })
      .expect(403);
    for (const name of ['reservations', 'dispatches', 'reservation-releases', 'returns'])
      await request(f.app)
        .post(`/api/v1/inventory/${name}`)
        .set(headers)
        .send({ productId: id })
        .expect(404);
  });
  it('BOLA/contexto/IDs não acessam nem movimentam estoque de outra empresa', async () => {
    const other = await request(f.app)
      .post('/api/v1/products')
      .set(tenantHeaders(f.ownerB, f.tenantB.tenant.id))
      .send(productInput())
      .expect(201);
    await balance(f, other.body.data.id).expect(404);
    await enter(f, other.body.data.id).expect(404);
    await request(f.app)
      .get('/api/v1/inventory')
      .set(stockHeaders(f, f.ownerA, f.tenantB.tenant.id))
      .expect(403);
    await request(f.app)
      .get('/api/v1/inventory/movements')
      .query({ productId: other.body.data.id })
      .set(stockHeaders(f))
      .expect(404);
    await request(f.app)
      .get(`/api/v1/inventory/${other.body.data.id}/reconciliation`)
      .set(stockHeaders(f))
      .expect(404);
    await request(f.app).get('/api/v1/inventory').set(stockHeaders(f, f.platform)).expect(403);
  });
  it('rejeita mass assignment, saldo final e origem/papel fornecidos pelo cliente', async () => {
    const id = await stockProduct(f);
    for (const field of [
      'tenantId',
      'physical',
      'reserved',
      'available',
      'actorUid',
      'origin',
      'type',
      'sequence',
      'unit',
      'operationId',
    ]) {
      await request(f.app)
        .post('/api/v1/inventory/entries')
        .set(stockHeaders(f))
        .set('Idempotency-Key', randomUUID())
        .send({ productId: id, quantity: '1', reason: 'Teste', [field]: 'forjado' })
        .expect(422);
    }
    await request(f.app)
      .post('/api/v1/inventory/adjustments')
      .set(stockHeaders(f))
      .set('Idempotency-Key', randomUUID())
      .send({ productId: id, physical: '100', expectedVersion: 0, reason: 'Teste' })
      .expect(422);
    expect((await balance(f, id).expect(200)).body.data.physical).toBe('0');
  });
  it('limita quantidade, precisão, mínimo e exige chave/motivo válidos', async () => {
    const id = await stockProduct(f);
    for (const quantity of ['0', '-1', '1.001', '1000000001', '1e5', '1;DROP', 1.25])
      await request(f.app)
        .post('/api/v1/inventory/entries')
        .set(stockHeaders(f))
        .set('Idempotency-Key', randomUUID())
        .send({ productId: id, quantity, reason: 'Teste' })
        .expect(422);
    await request(f.app)
      .post('/api/v1/inventory/entries')
      .set(stockHeaders(f))
      .send({ productId: id, quantity: '1', reason: 'Teste' })
      .expect(422);
    await request(f.app)
      .post('/api/v1/inventory/entries')
      .set(stockHeaders(f))
      .set('Idempotency-Key', 'invalid')
      .send({ productId: id, quantity: '1', reason: 'Teste' })
      .expect(422);
    await request(f.app)
      .post('/api/v1/inventory/entries')
      .set(stockHeaders(f))
      .set('Idempotency-Key', randomUUID())
      .send({ productId: id, quantity: '1', reason: '' })
      .expect(422);
    await request(f.app)
      .patch(`/api/v1/products/${id}`)
      .set(stockHeaders(f))
      .send({ expectedVersion: 1, minimumStock: '1.5' })
      .expect(422);
    await adjust(f, id, '0', 0).expect(422);
    await enter(f, 'missing').expect(404);
  });
  it('paginação/filtros malformados não geram consulta irrestrita', async () => {
    const id = await stockProduct(f);
    for (const path of [
      '/inventory?limit=101',
      '/inventory?tenantId=other',
      '/inventory?sort=physical',
      '/inventory/movements?type=INVALID',
      '/inventory/movements?from=tomorrow',
      '/inventory/movements?from=2099-01-01T00:00:00Z&to=2000-01-01T00:00:00Z',
      '/inventory/replenishment?sort=shortfall&q=test',
      `/inventory/${id}/reconciliation?limit=101`,
      '/inventory/bad%2Fpath',
    ])
      await request(f.app).get(`/api/v1${path}`).set(stockHeaders(f)).expect(422);
  });
  it('suspensão/cancelamento bloqueiam estoque inclusive replay administrativo', async () => {
    const id = await stockProduct(f);
    const key = randomUUID();
    await enter(f, id, '1', key).expect(201);
    for (const [status, expectedVersion] of [
      ['suspended', 1],
      ['canceled', 2],
    ] as const) {
      await request(f.app)
        .patch(`/api/v1/admin/subscriptions/${f.tenantA.subscription.id}`)
        .set(bearer(f.platform))
        .send({ status, expectedVersion, reason: 'Bloqueio de teste' })
        .expect(200);
      for (const path of [
        '/inventory',
        `/inventory/${id}`,
        '/inventory/movements',
        '/inventory/replenishment',
        `/inventory/${id}/reconciliation`,
      ])
        await request(f.app).get(`/api/v1${path}`).set(stockHeaders(f)).expect(403);
      await enter(f, id, '1', key).expect(403);
      await adjust(f, id, '1', 1).expect(403);
    }
  });
  it('cursores de reconciliação rejeitam adulteração/outro produto e mudança de estoque', async () => {
    const id = await stockProduct(f);
    const other = await stockProduct(f);
    await enter(f, id, '1').expect(201);
    await enter(f, id, '2').expect(201);
    const first = await request(f.app)
      .get(`/api/v1/inventory/${id}/reconciliation?limit=1`)
      .set(stockHeaders(f))
      .expect(200);
    await request(f.app)
      .get(`/api/v1/inventory/${other}/reconciliation`)
      .query({ cursor: first.body.data.nextCursor })
      .set(stockHeaders(f))
      .expect(422);
    await request(f.app)
      .get(`/api/v1/inventory/${id}/reconciliation`)
      .query({ cursor: first.body.data.nextCursor + 'x' })
      .set(stockHeaders(f))
      .expect(422);
    await enter(f, id, '1').expect(201);
    await request(f.app)
      .get(`/api/v1/inventory/${id}/reconciliation`)
      .query({ cursor: first.body.data.nextCursor })
      .set(stockHeaders(f))
      .expect(409);
  });
  it('reuso da chave em outro tipo/produto é conflito sem nova movimentação', async () => {
    const id = await stockProduct(f);
    const other = await stockProduct(f);
    const key = randomUUID();
    await enter(f, id, '1', key).expect(201);
    await enter(f, other, '1', key).expect(409);
    await adjust(f, id, '1', 1, key).expect(409);
    expect((await balance(f, id).expect(200)).body.data.physical).toBe('1');
  });
});
