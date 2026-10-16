import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Fixture, TestUser } from './fixture.js';
import { tenantHeaders } from './fixture.js';
import { stockProduct, enter } from './inventory.js';
import { orderView, type Order } from '../../src/shared/schemas/orders.js';
import { validAddress } from './commercial.js';
export const orderHeaders = (
  f: Fixture,
  user: TestUser = f.ownerA,
  tenantId = f.tenantA.tenant.id,
) => tenantHeaders(user, tenantId);
export async function orderCustomer(
  f: Fixture,
  user: TestUser = f.ownerA,
  tenantId = f.tenantA.tenant.id,
) {
  const result = await request(f.app)
    .post('/api/v1/customers')
    .set(orderHeaders(f, user, tenantId))
    .send({ address: validAddress, name: 'Cliente pedido sintético' })
    .expect(201);
  return result.body.data.id as string;
}
export async function draft(
  f: Fixture,
  user: TestUser = f.ownerA,
  options: { productId?: string; quantity?: string; customerId?: string; extra?: object } = {},
) {
  const productId = options.productId ?? (await stockProduct(f));
  if (!options.productId) await enter(f, productId, '10').expect(201);
  const customerId = options.customerId ?? (await orderCustomer(f, user));
  const result = await request(f.app)
    .post('/api/v1/orders')
    .set(orderHeaders(f, user))
    .send({
      customerId,
      lines: [{ productId, quantity: options.quantity ?? '1' }],
      payment: { type: 'cash', dueDates: ['2090-01-01'] },
      ...options.extra,
    })
    .expect(201);
  return orderView.parse(result.body.data);
}
export const command = (
  f: Fixture,
  order: Pick<Order, 'id' | 'version'>,
  action: 'confirm' | 'dispatch' | 'cancel',
  user: TestUser = f.ownerA,
  key = randomUUID(),
  extra: object = {},
) =>
  request(f.app)
    .post(`/api/v1/orders/${order.id}/${action}`)
    .set(orderHeaders(f, user))
    .set('Idempotency-Key', key)
    .send({
      expectedVersion: order.version,
      ...(action === 'cancel' ? { reason: 'Cancelamento sintético' } : {}),
      ...extra,
    });
export const confirm = async (
  f: Fixture,
  order: Pick<Order, 'id' | 'version'>,
  user: TestUser = f.ownerA,
  key = randomUUID(),
) => orderView.parse((await command(f, order, 'confirm', user, key).expect(200)).body.data);
export const orderDocs = (f: Fixture, collection: string) =>
  f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/${collection}`);
