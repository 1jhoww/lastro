import { z } from 'zod';
import { opaqueId } from '../../../shared/schemas/models.js';
import { eventV2Schema } from '../../../shared/schemas/finance.js';
import {
  returnEventV2Schema,
  returnSchema,
  returnSnapshotSchema,
} from '../../../shared/schemas/returns.js';
import { requireCondition } from '../../../shared/errors/appError.js';
import { digest, stableJson } from '../../../shared/utils/crypto.js';
import { proofHash, verifyProofMembership } from './proofs.js';
import { proofChunkSchema } from './proofStorage.js';
import {
  sourceProofSchema,
  sourceProofHash,
  sourceProofId,
  proofManifestSchema,
  proofManifestHash,
  compactHeaderHash,
  orderLifecycleSchema,
  returnResolutionHeaderSchema,
} from './proofRecords.js';

export const preparedSourceSchema = z.strictObject({
  pendingExecutionId: opaqueId,
  pendingProofEntryId: proofHash,
  pendingFence: z.number().int().positive().safe(),
});
const publicationSchema = z.strictObject({
  eventId: opaqueId,
  eventHash: proofHash,
  manifestHash: proofHash,
});
const rootCertificateSchema = z.object({
  tenantId: opaqueId,
  orderId: opaqueId,
  id: opaqueId,
  status: z.enum(['APPLYING', 'FINALIZABLE', 'PAUSED', 'NEEDS_REVIEW', 'COMPLETED']),
  proofRootHash: proofHash,
  proofEntryCount: z.number().int().nonnegative().safe(),
  publication: publicationSchema.nullable(),
});
type ProofReader = (tenantId: string, collection: string, id: string) => Promise<unknown>;
type ReturnHeadReader = (tenantId: string, returnId: string) => Promise<unknown>;
function integrity(condition: unknown): asserts condition {
  requireCondition(condition, 409, 'FINANCIAL_INTEGRITY', 'Prova financeira inconsistente');
}

export class EconomicView {
  private readonly cache = new Map<string, { promise: Promise<unknown>; bytes: number }>();
  private cachedBytes = 0;
  constructor(
    private readonly reader: ProofReader,
    private readonly latestReturn: ReturnHeadReader,
  ) {}
  private evict(key: string) {
    const entry = this.cache.get(key);
    if (entry) this.cachedBytes -= entry.bytes;
    this.cache.delete(key);
  }
  private read(tenantId: string, collection: string, id: string): Promise<unknown> {
    const key = `${tenantId}/${collection}/${id}`;
    const prior = this.cache.get(key);
    if (prior) return prior.promise;
    if (this.cache.size >= 64) this.evict(this.cache.keys().next().value!);
    const value = this.reader(tenantId, collection, id).then(
      (raw) => {
        const cached = this.cache.get(key);
        if (cached?.promise === value) {
          cached.bytes = Buffer.byteLength(stableJson(raw), 'utf8');
          this.cachedBytes += cached.bytes;
          while (this.cachedBytes > 2 * 1024 * 1024) this.evict(this.cache.keys().next().value!);
        }
        return raw;
      },
      (error) => {
        if (this.cache.get(key)?.promise === value) this.evict(key);
        throw error;
      },
    );
    this.cache.set(key, { promise: value, bytes: 0 });
    return value;
  }

  private async publishedEvent(
    tenantId: string,
    id: string,
    raw: unknown,
    knownRoot?: z.infer<typeof rootCertificateSchema>,
  ) {
    const event = eventV2Schema.safeParse(raw);
    integrity(event.success && event.data.id === id && event.data.tenantId === tenantId);
    const parsedRoot = rootCertificateSchema.safeParse(
      knownRoot ?? (await this.read(tenantId, 'financialExecutions', event.data.proof.executionId)),
    );
    integrity(parsedRoot.success);
    const root = parsedRoot.data;
    integrity(
      root.tenantId === tenantId &&
        root.id === event.data.proof.executionId &&
        root.status === 'COMPLETED' &&
        root.publication !== null,
    );
    const manifest = proofManifestSchema.safeParse(
      await this.read(tenantId, 'financialProofManifests', root.id),
    );
    integrity(manifest.success);
    integrity(
      manifest.data.hash === proofManifestHash(manifest.data) &&
        manifest.data.hash === root.publication.manifestHash &&
        manifest.data.tenantId === tenantId &&
        manifest.data.executionId === root.id &&
        manifest.data.orderId === root.orderId &&
        manifest.data.rootHash === root.proofRootHash &&
        manifest.data.entryCount === root.proofEntryCount,
    );
    const { hash: _eventHash, ...eventBody } = event.data;
    integrity(
      event.data.id === root.publication.eventId &&
        event.data.hash === root.publication.eventHash &&
        event.data.hash === digest(stableJson(eventBody)) &&
        event.data.orderId === root.orderId &&
        event.data.operationId === root.id,
    );
    integrity(
      event.data.proof.manifestId === root.id &&
        event.data.proof.rootHash === manifest.data.rootHash &&
        event.data.proof.entryCount === manifest.data.entryCount &&
        event.data.proof.beforeSnapshotHash === manifest.data.beforeSnapshotHash &&
        event.data.proof.afterSnapshotHash === manifest.data.afterSnapshotHash,
    );
    for (const key of [
      'orderLifecycleHash',
      'returnEventId',
      'returnEventHash',
      'returnHeaderHash',
    ] as const)
      integrity(event.data.proof[key] === manifest.data[key]);
    return event.data;
  }

  private async source(
    tenantId: string,
    collection: string,
    id: string,
    executionId: string,
    entryId: string,
    fence?: number,
  ) {
    const root = rootCertificateSchema.safeParse(
      await this.read(tenantId, 'financialExecutions', executionId),
    );
    const stored = await this.read(tenantId, 'financialProofEntries', entryId);
    integrity(stored && typeof stored === 'object');
    let { siblings } = stored as Record<string, unknown>;
    const { siblings: _siblings, ...entryBody } = stored as Record<string, unknown>;
    const entry = sourceProofSchema.safeParse(entryBody);
    integrity(root.success && entry.success);
    integrity(root.data.tenantId === tenantId && root.data.id === executionId);
    integrity(
      entry.data.tenantId === tenantId &&
        entry.data.executionId === executionId &&
        entry.data.collection === collection &&
        entry.data.sourceId === id &&
        (fence === undefined || entry.data.fence === fence),
    );
    integrity(
      entry.data.id === entryId &&
        entry.data.id === sourceProofId(tenantId, executionId, collection, id) &&
        entry.data.hash === sourceProofHash(entry.data),
    );
    integrity(
      entry.data.collection === 'creditLots' || entry.data.before.orderId === root.data.orderId,
    );
    if (siblings === undefined) {
      const chunk = proofChunkSchema.safeParse(
        await this.read(tenantId, 'financialProofChunks', entryId),
      );
      integrity(
        chunk.success &&
          chunk.data.tenantId === tenantId &&
          chunk.data.executionId === executionId &&
          chunk.data.entryId === entryId &&
          chunk.data.position === entry.data.position &&
          chunk.data.entryHash === entry.data.hash &&
          stableJson(chunk.data.entry) === stableJson(entry.data),
      );
      siblings = chunk.data.siblings;
    }
    integrity(
      Array.isArray(siblings) &&
        verifyProofMembership(
          { tenantId, executionId, entryCount: root.data.proofEntryCount },
          root.data.proofRootHash,
          entry.data.position,
          entry.data.hash,
          siblings,
        ),
    );
    return { root: root.data, entry: entry.data };
  }

  async publishedSource(tenantId: string, collection: string, id: string, executionId: string) {
    const proof = await this.source(
      tenantId,
      collection,
      id,
      executionId,
      sourceProofId(tenantId, executionId, collection, id),
    );
    integrity(proof.root.status === 'COMPLETED' && proof.root.publication !== null);
    await this.publishedEvent(
      tenantId,
      proof.root.publication.eventId,
      await this.read(tenantId, 'financialEvents', proof.root.publication.eventId),
      proof.root,
    );
    return proof.entry;
  }

  private async publishedReturnEvent(tenantId: string, id: string, raw: unknown) {
    const event = returnEventV2Schema.safeParse(raw);
    integrity(event.success && event.data.tenantId === tenantId && event.data.id === id);
    const root = rootCertificateSchema.safeParse(
      await this.read(tenantId, 'financialExecutions', event.data.executionId),
    );
    integrity(root.success && root.data.status === 'COMPLETED' && root.data.publication !== null);
    const financial = await this.publishedEvent(
      tenantId,
      root.data.publication.eventId,
      await this.read(tenantId, 'financialEvents', root.data.publication.eventId),
      root.data,
    );
    const { hash: _hash, ...body } = event.data;
    integrity(
      event.data.hash === digest(stableJson(body)) &&
        event.data.orderId === financial.orderId &&
        event.data.executionId === financial.proof.executionId &&
        event.data.manifestId === financial.proof.manifestId &&
        event.data.rootHash === financial.proof.rootHash &&
        event.data.entryCount === financial.proof.entryCount &&
        financial.proof.returnEventId === id &&
        financial.proof.returnEventHash === event.data.hash &&
        financial.proof.returnHeaderHash === event.data.headerHash,
    );
    return event.data;
  }

  private async order(tenantId: string, id: string, data: Record<string, unknown>) {
    const rawHeader = await this.read(tenantId, 'orderLifecycleStates', id);
    if (rawHeader === null) {
      integrity(!(data.status === 'canceled' && data.confirmedAt && data.canceledAt === null));
      return data;
    }
    const header = orderLifecycleSchema.safeParse(rawHeader);
    integrity(
      header.success &&
        header.data.tenantId === tenantId &&
        header.data.orderId === id &&
        data.tenantId === tenantId &&
        data.id === id &&
        data.version === header.data.sourceVersion &&
        data.status === 'canceled' &&
        header.data.version === header.data.sourceVersion + 1,
    );
    integrity(header.data.sourceHash === digest(stableJson({ ...data, status: 'confirmed' })));
    const root = rootCertificateSchema.safeParse(
      await this.read(tenantId, 'financialExecutions', header.data.executionId),
    );
    integrity(root.success && root.data.status === 'COMPLETED' && root.data.publication !== null);
    const event = await this.publishedEvent(
      tenantId,
      root.data.publication.eventId,
      await this.read(tenantId, 'financialEvents', root.data.publication.eventId),
      root.data,
    );
    integrity(
      event.orderId === id &&
        event.type === 'financial_cancellation' &&
        event.proof.orderLifecycleHash === compactHeaderHash(header.data),
    );
    return {
      ...data,
      status: header.data.status,
      version: header.data.version,
      updatedAt: header.data.updatedAt,
      updatedBy: header.data.updatedBy,
      canceledAt: header.data.canceledAt,
      canceledBy: header.data.canceledBy,
    };
  }

  private async returned(tenantId: string, id: string, data: Record<string, unknown>) {
    const rawHeader = await this.read(tenantId, 'returnResolutionStates', id);
    if (rawHeader === null) {
      const latest = await this.latestReturn(tenantId, id);
      if (latest !== null) {
        const event = await this.publishedReturnEvent(
          tenantId,
          returnEventV2Schema.parse(latest).id,
          latest,
        );
        integrity(typeof data.eventSequence === 'number' && data.eventSequence >= event.sequence);
      }
      return data;
    }
    const header = returnResolutionHeaderSchema.safeParse(rawHeader);
    const source = returnSchema.safeParse(data);
    integrity(
      header.success &&
        source.success &&
        header.data.tenantId === tenantId &&
        header.data.returnId === id &&
        source.data.tenantId === tenantId &&
        source.data.id === id &&
        source.data.orderId === header.data.orderId,
    );
    if (source.data.version >= header.data.version) return data;
    integrity(
      source.data.version === header.data.sourceVersion &&
        header.data.sourceHash === digest(stableJson(data)) &&
        source.data.lines.length === header.data.lineCount,
    );
    const event = await this.publishedReturnEvent(
      tenantId,
      header.data.headEventId,
      await this.read(tenantId, 'returnEvents', header.data.headEventId),
    );
    integrity(
      event.headerHash === compactHeaderHash(header.data) &&
        event.returnId === id &&
        event.executionId === header.data.executionId &&
        event.hash === header.data.headHash &&
        event.sequence === header.data.eventSequence &&
        event.lineCount === header.data.lineCount,
    );
    const lines: z.infer<typeof returnSchema>['lines'] = [];
    for (const line of source.data.lines) {
      const guardId = digest(`return-line:${tenantId}:${source.data.orderId}:${line.lineId}`);
      const proof = await this.publishedSource(
        tenantId,
        'orderReturnLines',
        guardId,
        header.data.executionId,
      );
      integrity(
        proof.collection === 'orderReturnLines' &&
          proof.returnId === id &&
          proof.lineAfter.lineId === line.lineId,
      );
      lines.push(proof.lineAfter);
    }
    const after = {
      ...source.data,
      lines,
      status: header.data.status,
      version: header.data.version,
      reason: header.data.reason,
      updatedAt: header.data.updatedAt,
      updatedBy: header.data.updatedBy,
      headEventId: header.data.headEventId,
      headHash: header.data.headHash,
      eventSequence: header.data.eventSequence,
    };
    integrity(digest(stableJson(returnSnapshotSchema.parse(after))) === event.afterSnapshotHash);
    return after;
  }

  async resolve(tenantId: string, collection: string, id: string, raw: unknown): Promise<unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const data = raw as Record<string, unknown>;
    if (collection === 'financialEvents' && data.schemaVersion === 2)
      return this.publishedEvent(tenantId, id, raw);
    if (collection === 'returnEvents' && data.schemaVersion === 2)
      return this.publishedReturnEvent(tenantId, id, raw);
    if (collection === 'orders') return this.order(tenantId, id, data);
    if (collection === 'returns') return this.returned(tenantId, id, data);
    const markerPresent = ['pendingExecutionId', 'pendingProofEntryId', 'pendingFence'].some(
      (k) => k in data,
    );
    if (!markerPresent) return raw;
    const marker = preparedSourceSchema.safeParse({
      pendingExecutionId: data.pendingExecutionId,
      pendingProofEntryId: data.pendingProofEntryId,
      pendingFence: data.pendingFence,
    });
    integrity(
      marker.success && opaqueId.safeParse(tenantId).success && opaqueId.safeParse(id).success,
    );
    integrity(
      ['payments', 'creditApplications', 'creditLots', 'orderReturnLines'].includes(collection),
    );
    const { pendingExecutionId, pendingProofEntryId, pendingFence } = marker.data;
    const { root, entry } = await this.source(
      tenantId,
      collection,
      id,
      pendingExecutionId,
      pendingProofEntryId,
      pendingFence,
    );
    const {
      pendingExecutionId: _execution,
      pendingProofEntryId: _entry,
      pendingFence: _fence,
      ...canonical
    } = data;
    integrity(stableJson(canonical) === stableJson(entry.after));
    if (root.status !== 'COMPLETED') {
      integrity(root.publication === null);
      return entry.before;
    }
    integrity(root.publication !== null);
    const publication = root.publication;
    await this.publishedEvent(
      tenantId,
      publication.eventId,
      await this.read(tenantId, 'financialEvents', publication.eventId),
      root,
    );
    return entry.after;
  }
}
