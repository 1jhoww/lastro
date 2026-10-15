import { describe, expect, it } from 'vitest';
import { EconomicView } from '../../src/modules/finance/resolution/economicView.js';
import {
  sealSourceProof,
  proofManifestHash,
  proofManifestSchema,
} from '../../src/modules/finance/resolution/proofRecords.js';
import { eventV2Schema } from '../../src/shared/schemas/finance.js';
import { proofLeafHash, proofRootHash } from '../../src/modules/finance/resolution/proofs.js';
import { financialEventHash } from '../../src/modules/finance/financialBook.js';
import { digest, stableJson } from '../../src/shared/utils/crypto.js';
import { compactHeaderHash } from '../../src/modules/finance/resolution/proofRecords.js';

function fixture() {
  const before = {
    id: 'lot',
    tenantId: 'tenant',
    customerId: 'customer',
    originOrderId: 'origin',
    originReference: 'origin-event',
    origin: 'order_cancellation' as const,
    issuedCents: 100,
    availableCents: 20,
    appliedCents: 80,
    version: 1,
    createdAt: '2026-10-12T12:00:00.000Z',
    updatedAt: '2026-10-12T12:00:00.000Z',
    schemaVersion: 1 as const,
  };
  const after = { ...before, availableCents: 60, appliedCents: 40, version: 2 };
  const entry = sealSourceProof({
    tenantId: 'tenant',
    executionId: 'execution',
    sourceId: 'lot',
    collection: 'creditLots',
    fence: 2,
    position: 0,
    before,
    after,
  });
  const context = { tenantId: 'tenant', executionId: 'execution', entryCount: 1 };
  const rootHash = proofRootHash(context, proofLeafHash(context, 0, entry.hash));
  const snapshot = {
    cashReceivedCents: 0,
    cashSettledCents: 0,
    creditSettledCents: 0,
    transferredCashCents: 0,
    canceledCents: 100,
    activeReturnCount: 0,
    titles: [
      {
        id: 'title',
        originalCents: 100,
        outstandingCents: 0,
        cashCents: 0,
        creditCents: 0,
        canceledCents: 100,
        version: 2,
      },
    ],
  };
  const eventBody = {
    id: 'event',
    tenantId: 'tenant',
    orderId: 'order',
    customerId: 'customer',
    operationId: 'execution',
    type: 'financial_cancellation' as const,
    amountCents: 100,
    reason: 'Cancelamento',
    actorUid: 'admin',
    occurredAt: '2026-10-12T12:00:00.000Z',
    requestId: 'bce0d137-93ea-466c-976a-31b36305cac6',
    sequence: 1,
    previousHash: digest('previous'),
    before: {
      ...snapshot,
      creditSettledCents: 40,
      canceledCents: 0,
      titles: [
        {
          ...snapshot.titles[0]!,
          outstandingCents: 60,
          creditCents: 40,
          canceledCents: 0,
          version: 1,
        },
      ],
    },
    after: snapshot,
    references: [],
    schemaVersion: 2 as const,
    proof: {
      executionId: 'execution',
      manifestId: 'execution',
      rootHash,
      entryCount: 1,
      beforeSnapshotHash: digest(
        stableJson({
          ...snapshot,
          creditSettledCents: 40,
          canceledCents: 0,
          titles: [
            {
              ...snapshot.titles[0]!,
              outstandingCents: 60,
              creditCents: 40,
              canceledCents: 0,
              version: 1,
            },
          ],
        }),
      ),
      afterSnapshotHash: digest(stableJson(snapshot)),
    },
  };
  const event = { ...eventBody, hash: financialEventHash(eventBody) };
  const manifestBody = {
    ...context,
    orderId: 'order',
    rootHash,
    beforeSnapshotHash: event.proof.beforeSnapshotHash,
    afterSnapshotHash: event.proof.afterSnapshotHash,
    schemaVersion: 1 as const,
  };
  const manifest = { ...manifestBody, hash: proofManifestHash(manifestBody) };
  const root = {
    tenantId: 'tenant',
    orderId: 'order',
    id: 'execution',
    status: 'APPLYING',
    proofRootHash: rootHash,
    proofEntryCount: 1,
    publication: null,
  };
  const records = new Map<string, unknown>([
    ['financialExecutions/execution', root],
    ['financialProofEntries/' + entry.id, { ...entry, siblings: [] }],
    ['financialProofManifests/execution', manifest],
    ['financialEvents/event', event],
  ]);
  const reads: string[] = [];
  const view = new EconomicView(
    async (tenantId, collection, id) => {
      expect(tenantId).toBe('tenant');
      reads.push(`${collection}/${id}`);
      return records.get(`${collection}/${id}`) ?? null;
    },
    async () => null,
  );
  const prepared = {
    ...after,
    pendingExecutionId: 'execution',
    pendingProofEntryId: entry.id,
    pendingFence: 2,
  };
  const complete = () => {
    records.set('financialExecutions/execution', {
      ...root,
      status: 'COMPLETED',
      publication: {
        eventId: 'event',
        eventHash: event.hash,
        manifestHash: manifest.hash,
      },
    });
  };
  return { before, after, entry, records, reads, view, prepared, complete, root };
}

describe('F02: visão econômica de fontes preparadas', () => {
  it('usa backup selado e prova de pertencimento sem modificar entrada original', async () => {
    const f = fixture();
    f.records.set('financialProofEntries/' + f.entry.id, f.entry);
    f.records.set('financialProofChunks/' + f.entry.id, {
      tenantId: 'tenant',
      executionId: 'execution',
      entryId: f.entry.id,
      position: 0,
      entryHash: f.entry.hash,
      entry: f.entry,
      siblings: [],
      schemaVersion: 1,
    });
    expect(await f.view.resolve('tenant', 'creditLots', 'lot', f.prepared)).toEqual(f.before);
    expect(f.records.get('financialProofEntries/' + f.entry.id)).toEqual(f.entry);
  });
  it('nega status terminal preparado sem cabeçalho comercial publicado', async () => {
    const f = fixture();
    await expect(
      f.view.resolve('tenant', 'orders', 'order', {
        id: 'order',
        tenantId: 'tenant',
        status: 'canceled',
        confirmedAt: '2026-10-12T12:00:00.000Z',
        canceledAt: null,
      }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_INTEGRITY' });
  });
  it('mantém documento legado intacto e não consulta provas', async () => {
    const f = fixture();
    expect(await f.view.resolve('tenant', 'creditLots', 'lot', f.before)).toEqual(f.before);
    expect(f.reads).toHaveLength(0);
  });
  it('mantém crédito anterior indisponível durante aplicação e pausa', async () => {
    const f = fixture();
    expect(await f.view.resolve('tenant', 'creditLots', 'lot', f.prepared)).toEqual(f.before);
    f.records.set('financialExecutions/execution', { ...f.root, status: 'PAUSED' });
    expect(await f.view.resolve('tenant', 'creditLots', 'lot', f.prepared)).toEqual(f.before);
    expect(f.reads.length).toBeLessThanOrEqual(6);
  });
  it('expõe depois somente com certificado e evento de publicação válidos', async () => {
    const f = fixture();
    f.complete();
    expect(await f.view.resolve('tenant', 'creditLots', 'lot', f.prepared)).toEqual(f.after);
    expect(f.reads.length).toBeLessThanOrEqual(4);
  });
  it('nega COMPLETED sem publicação, sem inferir saldo', async () => {
    const f = fixture();
    f.records.set('financialExecutions/execution', { ...f.root, status: 'COMPLETED' });
    await expect(f.view.resolve('tenant', 'creditLots', 'lot', f.prepared)).rejects.toMatchObject({
      code: 'FINANCIAL_INTEGRITY',
    });
  });
  it.each([
    'financialExecutions/execution',
    'financialProofEntries',
    'financialProofManifests/execution',
    'financialEvents/event',
  ])('nega prova ausente: %s', async (key) => {
    const f = fixture();
    f.complete();
    f.records.delete(key === 'financialProofEntries' ? 'financialProofEntries/' + f.entry.id : key);
    await expect(f.view.resolve('tenant', 'creditLots', 'lot', f.prepared)).rejects.toMatchObject({
      code: 'FINANCIAL_INTEGRITY',
    });
  });
  it.each([
    { availableCents: 61 },
    { tenantId: 'other' },
    { id: 'other' },
    { pendingFence: 1 },
    { pendingExecutionId: 'other' },
  ])('nega fonte preparada adulterada %j', async (mutation) => {
    const f = fixture();
    await expect(
      f.view.resolve('tenant', 'creditLots', 'lot', { ...f.prepared, ...mutation }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_INTEGRITY' });
  });
  it('nega evento publicado adulterado mesmo mantendo hash declarado', async () => {
    const f = fixture();
    f.complete();
    const event = f.records.get('financialEvents/event') as Record<string, unknown>;
    f.records.set('financialEvents/event', { ...event, amountCents: 99 });
    await expect(f.view.resolve('tenant', 'creditLots', 'lot', f.prepared)).rejects.toMatchObject({
      code: 'FINANCIAL_INTEGRITY',
    });
  });
  it('publica cabeçalho comercial compacto sem ampliar snapshot canônico', async () => {
    const f = fixture();
    const order = {
      id: 'order',
      tenantId: 'tenant',
      status: 'confirmed',
      version: 1,
      lines: [{ id: 'line', description: 'texto comercial preservado' }],
      notes: 'intacto',
    };
    const header = {
      tenantId: 'tenant',
      orderId: 'order',
      executionId: 'execution',
      sourceHash: digest(stableJson(order)),
      sourceVersion: 1,
      status: 'canceled',
      version: 2,
      updatedAt: '2026-10-12T12:00:00.000Z',
      updatedBy: 'admin',
      canceledAt: '2026-10-12T12:00:00.000Z',
      canceledBy: 'admin',
      schemaVersion: 1,
    };
    const hash = compactHeaderHash(header);
    const event = f.records.get('financialEvents/event') as Record<string, unknown>;
    const proof = event.proof as Record<string, unknown>;
    const nextEvent = eventV2Schema.parse({
      ...event,
      proof: { ...proof, orderLifecycleHash: hash },
    });
    nextEvent.hash = financialEventHash(nextEvent);
    const manifest = f.records.get('financialProofManifests/execution') as Record<string, unknown>;
    const nextManifest = proofManifestSchema.parse({ ...manifest, orderLifecycleHash: hash });
    nextManifest.hash = proofManifestHash(nextManifest);
    f.records.set('financialEvents/event', nextEvent);
    f.records.set('financialProofManifests/execution', nextManifest);
    f.records.set('orderLifecycleStates/order', header);
    f.records.set('financialExecutions/execution', {
      ...f.root,
      status: 'COMPLETED',
      publication: {
        eventId: 'event',
        eventHash: nextEvent.hash,
        manifestHash: nextManifest.hash,
      },
    });
    const canonical = { ...order, status: 'canceled' };
    const result = await f.view.resolve('tenant', 'orders', 'order', canonical);
    expect(result).toMatchObject({ status: 'canceled', version: 2, canceledBy: 'admin' });
    expect(result).toHaveProperty('lines', order.lines);
    expect(canonical).toEqual({ ...order, status: 'canceled' });
    await expect(
      f.view.resolve('tenant', 'orders', 'order', { ...canonical, notes: 'adulterado' }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_INTEGRITY' });
  });
});
