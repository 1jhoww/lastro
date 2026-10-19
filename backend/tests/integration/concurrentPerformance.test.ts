import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import { financialOrder, financePost, receiptBody, titles } from '../helpers/finance.js';
import { stockProduct, enter, balance } from '../helpers/inventory.js';
import { orderDocs } from '../helpers/orders.js';
import type request from 'supertest';

const f = registerFixture({ rateLimitMax: 100_000, preserveExisting: true });
const records: object[] = [];
afterAll(async () => {
  await mkdir('../docs/audits/evidence/fase9', { recursive: true });
  await writeFile(
    '../docs/audits/evidence/fase9/concurrency.json',
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        environment: 'demo-lastro-tests, local emulator, independent synthetic companies',
        records,
      },
      null,
      2,
    ),
  );
});
async function race(name: string, calls: (() => PromiseLike<request.Response>)[]) {
  const start = performance.now();
  const results = await Promise.all(
    calls.map(async (call) => {
      const began = performance.now();
      const response = await call();
      return { response, ms: performance.now() - began };
    }),
  );
  records.push({
    name,
    concurrency: calls.length,
    ms: performance.now() - start,
    responses: results.map((r) => ({
      status: r.response.status,
      code: r.response.body.error?.code ?? null,
      ms: r.ms,
    })),
    memory: process.memoryUsage(),
  });
  return results.map((r) => r.response);
}
describe('Measured concurrent stock and financial commands', () => {
  it.each([2, 4, 8, 16])(
    '%i stock entries reconcile all successful commits',
    async (count) => {
      const id = await stockProduct(f);
      const results = await race(
        `stock-entries-${count}`,
        Array.from({ length: count }, () => () => enter(f, id, '1')),
      );
      const committed = results.filter((r) => r.status === 201).length;
      const stock = (await balance(f, id).expect(200)).body.data;
      expect(stock.physical).toBe(String(committed));
      expect(stock.reserved).toBe('0');
      expect(
        (await orderDocs(f, 'inventoryMovements').where('productId', '==', id).get()).size,
      ).toBe(committed);
      expect(results.every((r) => [201, 409, 429, 503].includes(r.status))).toBe(true);
    },
    120_000,
  );
  it('financial versions and same-key replay prevent concurrent duplication', async () => {
    for (let run = 0; run < 3; run++) {
      const { order, method } = await financialOrder(f);
      const body = await receiptBody(f, order, method, 500);
      const results = await race(`receipt-conflict-${run}`, [
        () => financePost(f, `/orders/${order.id}/receipts`, body),
        () => financePost(f, `/orders/${order.id}/receipts`, body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await titles(f, order))[0]!.outstandingCents).toBe(1550);
      const nextBody = await receiptBody(f, order, method, 500);
      const key = randomUUID();
      const replay = await race(`receipt-replay-${run}`, [
        () => financePost(f, `/orders/${order.id}/receipts`, nextBody, key),
        () => financePost(f, `/orders/${order.id}/receipts`, nextBody, key),
      ]);
      expect(replay.map((r) => r.status)).toEqual([200, 200]);
      expect(replay[0]!.body.data).toEqual(replay[1]!.body.data);
      expect((await titles(f, order))[0]!.outstandingCents).toBe(1050);
      expect((await orderDocs(f, 'payments').where('orderId', '==', order.id).get()).size).toBe(2);
    }
  }, 120_000);
});
