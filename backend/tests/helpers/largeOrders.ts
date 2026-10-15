import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import type { Fixture } from './fixture.js';
import { stockProduct, enter } from './inventory.js';
import { orderCustomer, orderHeaders, orderDocs } from './orders.js';
import { orderView } from '../../src/shared/schemas/orders.js';
import { documentSize } from '../../src/modules/orders/technicalSize.js';
// Bounded fixture setup, not an application queue or production batching policy.
export async function largeProducts(
  f: Fixture,
  count: number,
  quantity = '2',
  description = 'd'.repeat(2000),
) {
  const ids: string[] = [];
  for (let offset = 0; offset < count; offset += 10) {
    ids.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(10, count - offset) }, async () => {
          const id = await stockProduct(f, { name: 'P'.repeat(160), description, priceCents: 500 });
          await enter(f, id, quantity).expect(201);
          return id;
        }),
      )),
    );
  }
  return ids;
}
export async function largeDraft(f: Fixture, ids: string[], discount = true) {
  const response = await request(f.app)
    .post('/api/v1/orders')
    .set(orderHeaders(f))
    .send({
      customerId: await orderCustomer(f),
      lines: ids.map((productId) => ({ productId, quantity: '1' })),
      notes: 'n'.repeat(1000),
      payment: { type: 'installments', dueDates: Array.from({ length: 12 }, () => '2090-01-01') },
      ...(discount
        ? { discount: { type: 'percentage', value: 1250, reason: 'Desconto sintético' } }
        : {}),
    })
    .expect(201);
  return orderView.parse(response.body.data);
}
export async function capacityRecord(
  f: Fixture,
  id: string,
  count: number,
  timings: Record<string, number>,
) {
  const orderDoc = await orderDocs(f, 'orders').doc(id).get();
  const operationDocs = await orderDocs(f, 'orderOperations').where('orderId', '==', id).get();
  const record = {
    lines: count,
    installments: 12,
    ...timings,
    orderStorageBytes: documentSize(orderDoc.ref.path, orderDoc.data()!),
    operationStorageBytes: Math.max(
      ...operationDocs.docs.map((d) => documentSize(d.ref.path, d.data())),
    ),
    confirmWrites: 3 * count + 17,
    confirmLogicalReads: 4 * count + 24,
  };
  await mkdir('reports', { recursive: true });
  const path = 'reports/order-capacity.raw.json';
  let records: unknown[] = [];
  try {
    records = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    /* First case in this run. */
  }
  records = records.filter(
    (r) => typeof r === 'object' && r !== null && 'lines' in r && r.lines !== count,
  );
  await writeFile(path, JSON.stringify([...records, record], null, 2));
  console.info(JSON.stringify({ orderCapacity: record }));
}
export const newKey = () => randomUUID();
