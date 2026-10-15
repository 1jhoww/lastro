import { z } from 'zod';
import { opaqueId } from '../../../shared/schemas/models.js';
import { paymentSchema, creditSchema, lotSchema } from '../../../shared/schemas/finance.js';
import { returnGuardSchema, returnLineSchema } from '../../../shared/schemas/returns.js';
import { digest, stableJson } from '../../../shared/utils/crypto.js';
import { proofContextSchema, proofHash } from './proofs.js';
import { instant } from '../../../shared/schemas/models.js';
import { expectedVersion } from '../../../shared/schemas/commercial.js';
import { returnStatus } from '../../../shared/schemas/returns.js';

const sourceFields = {
  id: proofHash,
  tenantId: opaqueId,
  executionId: opaqueId,
  sourceId: opaqueId,
  fence: z.number().int().positive().safe(),
  position: z.number().int().nonnegative().safe(),
  hash: proofHash,
  schemaVersion: z.literal(1),
};
const sourceProofBodySchema = z.discriminatedUnion('collection', [
  z.strictObject({
    ...sourceFields,
    collection: z.literal('payments'),
    before: paymentSchema,
    after: paymentSchema,
  }),
  z.strictObject({
    ...sourceFields,
    collection: z.literal('creditApplications'),
    before: creditSchema,
    after: creditSchema,
  }),
  z.strictObject({
    ...sourceFields,
    collection: z.literal('creditLots'),
    before: lotSchema,
    after: lotSchema,
  }),
  z.strictObject({
    ...sourceFields,
    collection: z.literal('orderReturnLines'),
    returnId: opaqueId,
    before: returnGuardSchema,
    after: returnGuardSchema,
    lineBefore: returnLineSchema,
    lineAfter: returnLineSchema,
  }),
]);
export const sourceProofSchema = sourceProofBodySchema.refine((entry) => {
  const { before, after } = entry;
  if (
    before.tenantId !== entry.tenantId ||
    after.tenantId !== entry.tenantId ||
    before.id !== entry.sourceId ||
    after.id !== entry.sourceId ||
    after.version !== before.version + 1
  )
    return false;
  if (entry.collection === 'creditLots') {
    const delta = entry.after.availableCents - entry.before.availableCents;
    return (
      delta > 0 &&
      entry.before.appliedCents - entry.after.appliedCents === delta &&
      stableJson(entry.after) ===
        stableJson({
          ...entry.before,
          availableCents: entry.after.availableCents,
          appliedCents: entry.after.appliedCents,
          version: entry.after.version,
          updatedAt: entry.after.updatedAt,
        })
    );
  }
  if (entry.collection === 'orderReturnLines') {
    const allowed = [
      'resolvedSellableScaled',
      'acceptedDamagedScaled',
      'rejectedDamagedScaled',
      'valueResolvedCents',
      'damagedValueReductionCents',
    ] as const;
    const expectedGuard = {
      ...entry.before,
      version: entry.after.version,
      lastEventId: entry.after.lastEventId,
    };
    const expectedLine = { ...entry.lineBefore };
    for (const key of allowed) {
      const beforeGuard = entry.before[key] ?? 0;
      const afterGuard = entry.after[key] ?? 0;
      const beforeLine = entry.lineBefore[key] ?? 0;
      const afterLine = entry.lineAfter[key] ?? 0;
      if (afterGuard < beforeGuard || afterGuard - beforeGuard !== afterLine - beforeLine)
        return false;
      if (entry.after[key] !== undefined) expectedGuard[key] = entry.after[key];
      if (entry.lineAfter[key] !== undefined) expectedLine[key] = entry.lineAfter[key];
    }
    return (
      entry.before.lineId === entry.lineBefore.lineId &&
      entry.after.lineId === entry.lineAfter.lineId &&
      entry.before.productId === entry.lineBefore.productId &&
      entry.after.productId === entry.lineAfter.productId &&
      entry.before.unit === entry.lineBefore.unit &&
      entry.after.unit === entry.lineAfter.unit &&
      stableJson(expectedGuard) === stableJson(entry.after) &&
      stableJson(expectedLine) === stableJson(entry.lineAfter)
    );
  }
  const previous = entry.before.allocations;
  const next = entry.after.allocations;
  if (
    new Set(previous.map((a) => a.receivableId)).size !== previous.length ||
    previous.length !== next.length ||
    previous.some((a, i) => {
      const b = next[i]!;
      return (
        a.receivableId !== b.receivableId ||
        a.amountCents !== b.amountCents ||
        b.remainingCents > a.remainingCents
      );
    })
  )
    return false;
  const delta = previous.reduce((sum, a, i) => sum + a.remainingCents - next[i]!.remainingCents, 0);
  if (delta <= 0) return false;
  if (entry.collection === 'payments')
    return (
      entry.after.transferredCents - entry.before.transferredCents === delta &&
      stableJson(entry.after) ===
        stableJson({
          ...entry.before,
          allocations: entry.after.allocations,
          transferredCents: entry.after.transferredCents,
          version: entry.after.version,
        })
    );
  return (
    entry.after.restoredByCancellationCents - entry.before.restoredByCancellationCents === delta &&
    entry.after.status === (next.some((a) => a.remainingCents > 0) ? 'active' : 'restored') &&
    stableJson(entry.after) ===
      stableJson({
        ...entry.before,
        allocations: entry.after.allocations,
        restoredByCancellationCents: entry.after.restoredByCancellationCents,
        status: entry.after.status,
        version: entry.after.version,
      })
  );
}, 'Transição de fonte financeira inconsistente');
export type SourceProof = z.infer<typeof sourceProofSchema>;
export const sourceProofId = (
  tenantId: string,
  executionId: string,
  collection: string,
  sourceId: string,
) =>
  digest(
    stableJson({
      domain: 'financial-proof:v1:entry-id',
      tenantId,
      executionId,
      collection,
      sourceId,
    }),
  );
export const sourceProofHash = (entry: Omit<SourceProof, 'hash'> | SourceProof) => {
  const { hash: _hash, ...body } = 'hash' in entry ? entry : { ...entry, hash: '' };
  return digest(stableJson({ domain: 'financial-proof:v1:entry', body }));
};
type SourceProofInput = SourceProof extends infer T
  ? T extends SourceProof
    ? Omit<T, 'id' | 'hash' | 'schemaVersion'>
    : never
  : never;
export function sealSourceProof(input: SourceProofInput): SourceProof {
  const content = {
    ...input,
    id: sourceProofId(input.tenantId, input.executionId, input.collection, input.sourceId),
    schemaVersion: 1 as const,
  };
  return sourceProofSchema.parse({ ...content, hash: sourceProofHash(content) });
}
export const proofManifestSchema = proofContextSchema
  .extend({
    orderId: opaqueId,
    rootHash: proofHash,
    beforeSnapshotHash: proofHash,
    afterSnapshotHash: proofHash,
    orderLifecycleHash: proofHash.optional(),
    returnEventId: opaqueId.optional(),
    returnEventHash: proofHash.optional(),
    returnHeaderHash: proofHash.optional(),
    hash: proofHash,
    schemaVersion: z.literal(1),
  })
  .strict();
export type ProofManifest = z.infer<typeof proofManifestSchema>;
export const proofManifestHash = (manifest: Omit<ProofManifest, 'hash'> | ProofManifest) => {
  const { hash: _hash, ...body } = 'hash' in manifest ? manifest : { ...manifest, hash: '' };
  return digest(stableJson({ domain: 'financial-proof:v1:manifest', body }));
};
export const orderLifecycleSchema = z.strictObject({
  tenantId: opaqueId,
  orderId: opaqueId,
  executionId: opaqueId,
  sourceHash: proofHash,
  sourceVersion: expectedVersion,
  status: z.literal('canceled'),
  version: expectedVersion,
  updatedAt: instant,
  updatedBy: opaqueId,
  canceledAt: instant,
  canceledBy: opaqueId,
  schemaVersion: z.literal(1),
});
export const returnResolutionHeaderSchema = z.strictObject({
  tenantId: opaqueId,
  orderId: opaqueId,
  returnId: opaqueId,
  executionId: opaqueId,
  sourceHash: proofHash,
  sourceVersion: expectedVersion,
  version: expectedVersion,
  status: returnStatus,
  reason: z.string().min(3).max(500),
  updatedAt: instant,
  updatedBy: opaqueId,
  eventSequence: z.number().int().positive().safe(),
  headHash: proofHash,
  headEventId: opaqueId,
  lineCount: z.number().int().positive().safe(),
  schemaVersion: z.literal(1),
});
export const compactHeaderHash = (header: unknown) => {
  let body = header;
  if (header && typeof header === 'object' && 'returnId' in header && 'headHash' in header) {
    // The event binds headHash separately; including its own hash would create a cycle.
    const { headHash: _headHash, ...rest } = header;
    body = rest;
  }
  return digest(stableJson({ domain: 'financial-proof:v1:header', header: body }));
};
