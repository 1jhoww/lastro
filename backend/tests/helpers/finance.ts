import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Fixture, TestUser } from './fixture.js';
import { orderHeaders, draft, confirm } from './orders.js';
import { conditionView, methodView } from '../../src/shared/schemas/paymentSettings.js';
import { titleView } from '../../src/shared/schemas/finance.js';
import type { Order } from '../../src/shared/schemas/orders.js';
import { companyDate } from '../../src/modules/orders/calculation.js';
export async function titles(f: Fixture, order: Pick<Order, 'id'>) {
  const response = await request(f.app)
    .get(`/api/v1/receivables?orderId=${order.id}`)
    .set(orderHeaders(f))
    .expect(200);
  return response.body.data.items.map((t: unknown) => titleView.parse(t)) as ReturnType<
    typeof titleView.parse
  >[];
}
export async function receiptBody(
  f: Fixture,
  order: Pick<Order, 'id' | 'version' | 'customerId'>,
  paymentMethod: ReturnType<typeof methodView.parse>,
  amount: number,
) {
  const rows = await titles(f, order),
    state = (
      await request(f.app)
        .get(`/api/v1/orders/${order.id}/financial-state`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data;
  const allocations: { receivableId: string; amountCents: number; expectedVersion: number }[] = [];
  let left = amount;
  for (const row of rows.sort((a, b) => a.installmentNumber - b.installmentNumber)) {
    if (left <= 0) break;
    const take = Math.min(left, row.outstandingCents);
    if (take > 0)
      allocations.push({ receivableId: row.id, amountCents: take, expectedVersion: row.version });
    left -= take;
  }
  if (left > 0 && rows[0])
    allocations.push({
      receivableId: rows[0].id,
      amountCents: left,
      expectedVersion: rows[0].version,
    });
  return {
    customerId: order.customerId!,
    methodId: paymentMethod.id,
    methodVersion: paymentMethod.version,
    expectedOrderVersion: order.version,
    expectedGuardVersion: state.guardVersion as number,
    amountCents: amount,
    receivedOn: companyDate(new Date(Date.now() + f.offset), f.tenantA.tenant.timezone),
    allocations,
    reason: 'Recebimento sintético',
  };
}
export async function versions(f: Fixture, order: Pick<Order, 'id' | 'version'>) {
  const state = (
    await request(f.app)
      .get(`/api/v1/orders/${order.id}/financial-state`)
      .set(orderHeaders(f))
      .expect(200)
  ).body.data;
  return {
    expectedOrderVersion: order.version,
    expectedGuardVersion: state.guardVersion as number,
  };
}
export async function creditSource(f: Fixture, amount = 500) {
  const setup = await financialOrder(f);
  await financePost(
    f,
    `/orders/${setup.order.id}/receipts`,
    await receiptBody(f, setup.order, setup.method, amount),
  ).expect(200);
  const result = (
    await financePost(f, `/orders/${setup.order.id}/financial-cancellation`, {
      ...(await versions(f, setup.order)),
      disposition: 'customer_credit',
      reason: 'Crédito de cancelamento sintético',
    }).expect(200)
  ).body.data;
  return { ...setup, creditLotId: result.creditLotId as string };
}
export async function condition(f: Fixture, extra: object = {}) {
  const response = await request(f.app)
    .post('/api/v1/payment-conditions')
    .set(orderHeaders(f))
    .set('Idempotency-Key', randomUUID())
    .send({ name: `Condição ${randomUUID()}`, preset: 'cash', ...extra })
    .expect(201);
  return conditionView.parse(response.body.data);
}
export async function method(
  f: Fixture,
  kind: 'cash' | 'pix' | 'transfer' | 'card' | 'boleto' | 'other' = 'pix',
) {
  const response = await request(f.app)
    .post('/api/v1/payment-methods')
    .set(orderHeaders(f))
    .set('Idempotency-Key', randomUUID())
    .send({ name: `Forma ${randomUUID()}`, kind })
    .expect(201);
  return methodView.parse(response.body.data);
}
export const financePost = (
  f: Fixture,
  path: string,
  body: object,
  key = randomUUID(),
  user: TestUser = f.ownerA,
  tenantId = f.tenantA.tenant.id,
) =>
  request(f.app)
    .post(`/api/v1${path}`)
    .set(orderHeaders(f, user, tenantId))
    .set('Idempotency-Key', key)
    .send(body);
export async function financialOrder(f: Fixture, options: object = {}) {
  const c = await condition(f),
    m = await method(f);
  const o = await confirm(
    f,
    await draft(f, f.ownerA, {
      extra: {
        payment: undefined,
        paymentConditionId: c.id,
        paymentConditionVersion: c.version,
        intendedPaymentMethodId: m.id,
        intendedPaymentMethodVersion: m.version,
        ...options,
      },
    }),
  );
  return { order: o, condition: c, method: m };
}
