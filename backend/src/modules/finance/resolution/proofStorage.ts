import { z } from 'zod';
import { digest, stableJson } from '../../../shared/utils/crypto.js';
import { proofHash, proofSplit, type ProofContext } from './proofs.js';
import { sourceProofSchema } from './proofRecords.js';
import { opaqueId } from '../../../shared/schemas/models.js';

export const proofChunkSchema = z.strictObject({
  tenantId: opaqueId,
  executionId: opaqueId,
  entryId: proofHash,
  position: z.number().int().nonnegative().safe(),
  entryHash: proofHash,
  entry: sourceProofSchema,
  siblings: z.array(proofHash).max(53).nullable(),
  schemaVersion: z.literal(1),
});
export const proofNodeSchema = z.strictObject({
  tenantId: opaqueId,
  executionId: opaqueId,
  start: z.number().int().nonnegative().safe(),
  count: z.number().int().positive().safe(),
  hash: proofHash,
  schemaVersion: z.literal(1),
});
export const proofNodeId = (context: ProofContext, start: number, count: number) =>
  digest(stableJson({ domain: 'financial-proof:v1:node-id', ...context, start, count }));
export function siblingIntervals(context: ProofContext, position: number) {
  if (!Number.isSafeInteger(position) || position < 0 || position >= context.entryCount)
    throw new Error('Invalid proof position');
  let start = 0,
    count = context.entryCount;
  const intervals: { id: string; start: number; count: number }[] = [];
  while (count > 1) {
    const split = proofSplit(count),
      right = position >= start + split;
    const siblingStart = right ? start : start + split;
    const siblingCount = right ? split : count - split;
    intervals.push({
      id: proofNodeId(context, siblingStart, siblingCount),
      start: siblingStart,
      count: siblingCount,
    });
    if (right) {
      start += split;
      count -= split;
    } else count = split;
  }
  return intervals.reverse();
}
