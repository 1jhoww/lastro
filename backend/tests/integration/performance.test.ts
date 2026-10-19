import { mkdir, writeFile } from 'node:fs/promises';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Transaction } from 'firebase-admin/firestore';
import request from 'supertest';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import { largeDraft, largeProducts, newKey } from '../helpers/largeOrders.js';
import { command, orderDocs } from '../helpers/orders.js';
import { orderView, orderSchema } from '../../src/shared/schemas/orders.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';
import { documentSource } from '../helpers/documents.js';

const f = registerFixture({ rateLimitMax: 100_000, preserveExisting: true });
const records: object[] = [];
const stage = process.env.PERFORMANCE_STAGE ?? 'regression';
if (!['before', 'after', 'regression'].includes(stage))
  throw new Error('Invalid performance stage');
afterAll(async () => {
  await mkdir('../docs/audits/evidence/fase9', { recursive: true });
  await writeFile(
    `../docs/audits/evidence/fase9/backend-${stage}.json`,
    JSON.stringify(
      {
        stage,
        node: process.version,
        environment: 'demo-lastro-tests, local emulators, Supertest HTTP',
        completedAt: new Date().toISOString(),
        records,
      },
      null,
      2,
    ),
  );
});

async function measure(name: string, work: () => PromiseLike<request.Response>) {
  const calls = { get: 0, getAll: 0, validatedDocuments: 0 };
  const originalGet = Transaction.prototype.get;
  const originalGetAll = Transaction.prototype.getAll;
  const originalRead = FoundationRepository.prototype.readSnapshot;
  const get = vi.spyOn(Transaction.prototype, 'get').mockImplementation(
    new Proxy(originalGet, {
      apply(target, receiver, args) {
        calls.get++;
        return Reflect.apply(target, receiver, args);
      },
    }),
  );
  const getAll = vi.spyOn(Transaction.prototype, 'getAll').mockImplementation(
    new Proxy(originalGetAll, {
      apply(target, receiver, args) {
        calls.getAll++;
        return Reflect.apply(target, receiver, args);
      },
    }),
  );
  const read = vi.spyOn(FoundationRepository.prototype, 'readSnapshot').mockImplementation(
    new Proxy(originalRead, {
      apply(target, receiver, args) {
        calls.validatedDocuments++;
        return Reflect.apply(target, receiver, args);
      },
    }),
  );
  const start = performance.now();
  const memoryBefore = process.memoryUsage();
  try {
    const response = await work();
    const record = {
      name,
      ms: performance.now() - start,
      status: response.status,
      calls,
      bytes: response.headers['content-type']?.includes('json')
        ? Buffer.byteLength(JSON.stringify(response.body))
        : Number(response.headers['content-length'] ?? 0),
      memoryBefore,
      memoryAfter: process.memoryUsage(),
    };
    records.push(record);
    console.info(JSON.stringify({ performance: record }));
    expect(response.status).toBe(200);
    return response;
  } finally {
    get.mockRestore();
    getAll.mockRestore();
    read.mockRestore();
  }
}

describe('Local performance and capacity evidence', () => {
  it.each([1, 20, 50, 100, 200])(
    '%i products: measured confirmation, replay and dispatch',
    async (count) => {
      const ids = await largeProducts(f, count, '10');
      for (let run = 0; run < 3; run++) {
        const order = await largeDraft(f, ids);
        const key = newKey();
        const confirmed = orderView.parse(
          (
            await measure(`confirm-${count}-${run}`, () =>
              command(f, order, 'confirm', f.ownerA, key),
            )
          ).body.data,
        );
        expect(confirmed.totalCents).toBe(count * 500 - Math.round(count * 500 * 0.125));
        const replay = await measure(`replay-${count}-${run}`, () =>
          command(f, order, 'confirm', f.ownerA, key),
        );
        expect(replay.body.data).toEqual(confirmed);
        await measure(`dispatch-${count}-${run}`, () => command(f, confirmed, 'dispatch'));
      }
      const stocks = await orderDocs(f, 'inventory').get();
      expect(
        stocks.docs.every(
          (doc) => doc.get('physicalScaled') === 7000 && doc.get('reservedScaled') === 0,
        ),
      ).toBe(true);
      expect((await orderDocs(f, 'receivables').get()).size).toBe(36);
    },
    180_000,
  );

  it('500 orders with 20 lines: bounded listings, concurrent tenants and reports', async () => {
    const base = documentSource(20).order;
    for (let offset = 0; offset < 500; offset += 50) {
      const batch = f.firebase.db.batch();
      for (let i = offset; i < offset + 50; i++) {
        const id = `perf-order-${String(i).padStart(4, '0')}`;
        batch.create(
          orderDocs(f, 'orders').doc(id),
          orderSchema.parse({
            ...base,
            id,
            tenantId: f.tenantA.tenant.id,
            sellerUid: f.ownerA.uid,
            createdAt: new Date().toISOString(),
            confirmedAt: new Date().toISOString(),
            installments: base.installments.map((p) => ({ ...p, orderId: id })),
          }),
        );
      }
      await batch.commit();
    }
    const headers = tenantHeaders(f.ownerA, f.tenantA.tenant.id);
    for (let run = 0; run < 5; run++) {
      await measure(`list-500-${run}`, () =>
        request(f.app).get('/api/v1/orders?limit=50').set(headers),
      );
      await measure(`filter-500-${run}`, () =>
        request(f.app).get('/api/v1/orders?limit=50&status=confirmed').set(headers),
      );
      const report = await measure(`report-500-${run}`, () =>
        request(f.app).get('/api/v1/reports/orders-status').set(headers),
      );
      expect(report.body.data.rows).toHaveLength(500);
    }
    await measure('report-csv-500', () =>
      request(f.app).get('/api/v1/reports/orders-status/export.csv').set(headers),
    );
    await measure('report-pdf-500', () =>
      request(f.app).get('/api/v1/reports/orders-status/export.pdf').set(headers),
    );
    const start = performance.now();
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(f.app)
          .get('/api/v1/orders?limit=20')
          .set(i % 2 ? headers : tenantHeaders(f.ownerB, f.tenantB.tenant.id)),
      ),
    );
    records.push({
      name: 'parallel-8-two-tenants',
      ms: performance.now() - start,
      statuses: concurrent.map((r) => r.status),
      memory: process.memoryUsage(),
    });
    expect(concurrent.every((r) => [200, 429].includes(r.status))).toBe(true);
    for (let i = 0; i < concurrent.length; i += 2)
      if (concurrent[i]!.status === 200) expect(concurrent[i]!.body.data.items).toEqual([]);
  }, 180_000);
});
