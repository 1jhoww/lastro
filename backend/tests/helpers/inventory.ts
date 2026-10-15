import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { tenantHeaders, type Fixture, type TestUser } from './fixture.js';
import { productInput } from './commercial.js';
export const stockHeaders = (
  f: Fixture,
  user: TestUser = f.ownerA,
  tenantId = f.tenantA.tenant.id,
) => tenantHeaders(user, tenantId);
export async function stockProduct(f: Fixture, body: object = {}) {
  const result = await request(f.app)
    .post('/api/v1/products')
    .set(stockHeaders(f))
    .send({ ...productInput(), ...body })
    .expect(201);
  return result.body.data.id as string;
}
export const enter = (f: Fixture, productId: string, quantity = '10', key = randomUUID()) =>
  request(f.app)
    .post('/api/v1/inventory/entries')
    .set(stockHeaders(f))
    .set('Idempotency-Key', key)
    .send({ productId, quantity, reason: 'Recebimento sintético' });
export const adjust = (
  f: Fixture,
  productId: string,
  delta: string,
  expectedVersion: number,
  key = randomUUID(),
) =>
  request(f.app)
    .post('/api/v1/inventory/adjustments')
    .set(stockHeaders(f))
    .set('Idempotency-Key', key)
    .send({ productId, delta, expectedVersion, reason: 'Inventário sintético' });
export const balance = (f: Fixture, productId: string) =>
  request(f.app).get(`/api/v1/inventory/${productId}`).set(stockHeaders(f));
