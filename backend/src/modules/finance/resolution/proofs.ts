import { z } from 'zod';
import { opaqueId } from '../../../shared/schemas/models.js';
import { digest, equalDigest, stableJson } from '../../../shared/utils/crypto.js';

export const proofHash = z.string().regex(/^[a-f0-9]{64}$/);
export const proofContextSchema = z.strictObject({
  tenantId: opaqueId,
  executionId: opaqueId,
  entryCount: z.number().int().nonnegative().safe(),
});
export type ProofContext = z.infer<typeof proofContextSchema>;
export const proofMembershipSchema = z.strictObject({
  position: z.number().int().nonnegative().safe(),
  siblings: z.array(proofHash).max(53),
});

const hashNode = (kind: string, context: ProofContext, data: unknown) =>
  digest(stableJson({ domain: `financial-proof:v1:${kind}`, ...context, data }));

export const proofLeafHash = (context: ProofContext, position: number, entryHash: string) =>
  hashNode('leaf', context, { position, entryHash });

export const proofBranchHash = (
  context: ProofContext,
  start: number,
  count: number,
  left: string,
  right: string,
) => hashNode('branch', context, { start, count, left, right });

export const proofRootHash = (context: ProofContext, treeHash: string) =>
  hashNode('root', context, { treeHash });
export const emptyProofRootHash = (context: ProofContext) =>
  proofRootHash(context, hashNode('empty', context, null));

// Split by integer arithmetic, without signed 32-bit bitwise truncation.
export function proofSplit(count: number): number {
  if (!Number.isSafeInteger(count) || count <= 1) throw new Error('Invalid proof interval');
  let split = 1;
  while (split * 2 < count) split *= 2;
  return split;
}

export function verifyProofMembership(
  context: ProofContext,
  rootHash: string,
  position: number,
  entryHash: string,
  siblings: readonly string[],
): boolean {
  if (
    !proofContextSchema.safeParse(context).success ||
    !proofHash.safeParse(rootHash).success ||
    !proofHash.safeParse(entryHash).success ||
    !proofMembershipSchema.safeParse({ position, siblings }).success ||
    position >= context.entryCount
  )
    return false;
  const path: { start: number; count: number; right: boolean }[] = [];
  let start = 0;
  let count = context.entryCount;
  while (count > 1) {
    const split = proofSplit(count);
    const right = position >= start + split;
    path.push({ start, count, right });
    if (right) {
      start += split;
      count -= split;
    } else count = split;
  }
  if (siblings.length !== path.length) return false;
  let hash = proofLeafHash(context, position, entryHash);
  for (let i = 0; i < path.length; i++) {
    const branch = path[path.length - i - 1]!;
    const sibling = siblings[i]!;
    hash = proofBranchHash(
      context,
      branch.start,
      branch.count,
      branch.right ? sibling : hash,
      branch.right ? hash : sibling,
    );
  }
  return equalDigest(proofRootHash(context, hash), rootHash);
}
