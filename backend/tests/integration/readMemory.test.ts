import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdir, writeFile } from 'node:fs/promises';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import { documentSource } from '../helpers/documents.js';
import { orderSchema } from '../../src/shared/schemas/orders.js';
import { assertDocumentFits } from '../../src/modules/orders/technicalSize.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';

const f = registerFixture({ rateLimitMax: 10000 });
afterEach(() => vi.restoreAllMocks());
describe('F05: páginas comerciais grandes com memória limitada', () => {
  it('recusa página acima do orçamento sem truncar e permite continuar com limit menor', async () => {
    const tenantId = f.tenantA.tenant.id;
    const base = documentSource(1800).order;
    let sourceBytes = 0;
    for (let i = 0; i < 40; i++) {
      const id = `memory-order-${String(i).padStart(3, '0')}`;
      const value = orderSchema.parse({
        ...base,
        id,
        tenantId,
        sellerUid: f.ownerA.uid,
        installments: base.installments.map((p) => ({ ...p, orderId: id })),
      });
      const ref = f.firebase.db.doc(`tenants/${tenantId}/orders/${id}`);
      assertDocumentFits(ref.path, value);
      sourceBytes = Buffer.byteLength(JSON.stringify(value));
      await ref.create(value);
    }
    const original = FoundationRepository.prototype.read;
    let loaded = 0;
    vi.spyOn(FoundationRepository.prototype, 'read').mockImplementation(async function (
      this: FoundationRepository,
      ...args
    ) {
      if (/\/orders\//.test(args[0].path)) loaded++;
      return original.apply(this, args);
    });
    const before = process.memoryUsage();
    const start = performance.now();
    const failed = await request(f.app)
      .get('/api/v1/orders?limit=100')
      .set(tenantHeaders(f.ownerA, tenantId))
      .expect(413);
    expect(failed.body.error.code).toBe('READ_MEMORY_LIMIT');
    expect(loaded).toBeLessThan(40);
    const examinedBeforeStop = loaded;
    const after = process.memoryUsage();
    const first = await request(f.app)
      .get('/api/v1/orders?limit=2')
      .set(tenantHeaders(f.ownerA, tenantId))
      .expect(200);
    expect(first.body.data.items).toHaveLength(2);
    expect(first.body.data.items.every((o: { lines: unknown[] }) => o.lines.length === 1800)).toBe(
      true,
    );
    const second = await request(f.app)
      .get('/api/v1/orders')
      .query({ limit: '2', cursor: first.body.data.nextCursor })
      .set(tenantHeaders(f.ownerA, tenantId))
      .expect(200);
    expect(second.body.data.items).toHaveLength(2);
    expect(second.body.data.items.map((o: { id: string }) => o.id)).not.toEqual(
      first.body.data.items.map((o: { id: string }) => o.id),
    );
    expect((await f.firebase.db.collection(`tenants/${tenantId}/orders`).get()).size).toBe(40);
    expect((await f.firebase.db.collection(`tenants/${tenantId}/financialEvents`).get()).size).toBe(
      0,
    );
    await mkdir('reports', { recursive: true });
    await writeFile(
      'reports/f03-f07-memory.raw.json',
      JSON.stringify(
        {
          sourceBytes,
          seeded: 40,
          examinedBeforeStop,
          elapsedMs: performance.now() - start,
          heapUsedDelta: after.heapUsed - before.heapUsed,
          rssBefore: before.rss,
          rssAfter: after.rss,
          result: 'READ_MEMORY_LIMIT',
          pagination: 'passed',
          scope: 'Node Windows emulator; sampled memory, not peak or production capacity',
        },
        null,
        2,
      ),
    );
  }, 60_000);
});
