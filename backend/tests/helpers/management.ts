import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { tenantHeaders, type Fixture } from './fixture.js';
import { customerInput, productInput, validAddress } from './commercial.js';

export const companyDay = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

/** Moves the company to Lastro Gestão through the same contract fields a plan change writes. */
export async function gestao(f: Fixture, tenantId = f.tenantA.tenant.id) {
  await f.firebase.db.doc(`subscriptions/${tenantId}`).update({ planCode: 'gestao', userLimit: 5 });
}
export const api = (f: Fixture, tenantId = f.tenantA.tenant.id, user = f.ownerA) => {
  const headers = tenantHeaders(user, tenantId);
  const url = (path: string) => `/api/v1${path}`;
  return {
    get: (path: string) => request(f.app).get(url(path)).set(headers),
    post: (path: string, body?: object, key: string = randomUUID()) => {
      const call = request(f.app).post(url(path)).set(headers).set('Idempotency-Key', key);
      return body ? call.send(body) : call;
    },
    patch: (path: string, body: object, key: string = randomUUID()) =>
      request(f.app).patch(url(path)).set(headers).set('Idempotency-Key', key).send(body),
    put: (path: string, body: object) => request(f.app).put(url(path)).set(headers).send(body),
  };
};
export async function supplier(f: Fixture, name = 'Distribuidora Exemplo', extra: object = {}) {
  const created = await api(f)
    .post('/customers', {
      name,
      address: validAddress,
      relationships: ['supplier'],
      ...extra,
    })
    .expect(201);
  return created.body.data as { id: string; version: number; name: string };
}
export async function product(f: Fixture, priceCents = 3500, extra: object = {}) {
  const created = await api(f)
    .post('/products', { ...productInput(), priceCents, ...extra })
    .expect(201);
  return created.body.data.id as string;
}
export async function condition(f: Fixture, schedule = [30, 60, 90]) {
  const created = await api(f)
    .post('/payment-conditions', {
      name: `Prazo ${randomUUID().slice(0, 8)}`,
      schedule: schedule.map((offsetDays) => ({ offsetDays, weight: 1 })),
    })
    .expect(201);
  return created.body.data as { id: string; version: number };
}
export async function method(f: Fixture) {
  const created = await api(f)
    .post('/payment-methods', { name: `Forma ${randomUUID().slice(0, 8)}`, kind: 'pix' })
    .expect(201);
  return created.body.data as { id: string; version: number };
}
export interface PurchaseShape {
  id: string;
  version: number;
  status: string;
  totalCents: number;
  lines: { id: string; productId: string; quantity: string; pendingQuantity: string }[];
  installments: { amountCents: number; dueDate: string; payableId: string }[];
}
/** Draft purchase of the given products, ready to confirm. */
export async function draft(
  f: Fixture,
  lines: { productId: string; quantity: string; unitCostCents: number }[],
  extra: object = {},
  schedule = [30, 60, 90],
) {
  const [vendor, terms] = [
    await supplier(f, `Fornecedor ${randomUUID().slice(0, 8)}`),
    await condition(f, schedule),
  ];
  const created = await api(f)
    .post('/purchases', {
      supplierId: vendor.id,
      paymentConditionId: terms.id,
      paymentConditionVersion: terms.version,
      lines,
      ...extra,
    })
    .expect(201);
  return created.body.data as PurchaseShape & { supplierId: string };
}
export async function confirmed(
  f: Fixture,
  lines: { productId: string; quantity: string; unitCostCents: number }[],
  extra: object = {},
  schedule?: number[],
) {
  const purchase = await draft(f, lines, extra, schedule);
  const result = await api(f)
    .post(`/purchases/${purchase.id}/confirm`, { expectedVersion: purchase.version })
    .expect(200);
  return result.body.data as PurchaseShape;
}
export const receive = (
  f: Fixture,
  purchase: { id: string; version: number },
  items: { lineId: string; quantity: string }[],
  key?: string,
) =>
  api(f).post(
    `/purchases/${purchase.id}/receipts`,
    { expectedVersion: purchase.version, receivedOn: companyDay(), items },
    key,
  );
export const available = async (f: Fixture, productId: string) =>
  (await api(f).get(`/inventory/${productId}`).expect(200)).body.data.physical as string;
export { customerInput };
