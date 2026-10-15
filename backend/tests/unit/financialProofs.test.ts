import { describe, expect, it } from 'vitest';
import {
  proofLeafHash,
  proofBranchHash,
  proofRootHash,
  verifyProofMembership,
} from '../../src/modules/finance/resolution/proofs.js';
import { digest } from '../../src/shared/utils/crypto.js';

describe('F02: pertencimento de provas financeiras', () => {
  const context = { tenantId: 'tenant', executionId: 'execution', entryCount: 3 };
  const entries = ['a', 'b', 'c'].map(digest);
  const leaves = entries.map((hash, position) => proofLeafHash(context, position, hash));
  const left = proofBranchHash(context, 0, 3, leaves[0]!, leaves[1]!);

  it('verifica posição, quantidade e domínio de uma folha única', () => {
    const single = { ...context, entryCount: 1 };
    const root = proofRootHash(single, proofLeafHash(single, 0, entries[0]!));
    expect(verifyProofMembership(single, root, 0, entries[0]!, [])).toBe(true);
    expect(verifyProofMembership({ ...single, tenantId: 'other' }, root, 0, entries[0]!, [])).toBe(
      false,
    );
    expect(verifyProofMembership(single, root, 1, entries[0]!, [])).toBe(false);
    expect(verifyProofMembership(single, root, 0, entries[1]!, [])).toBe(false);
  });

  it('verifica árvore assimétrica sem padding ambíguo', () => {
    const pair = proofBranchHash(context, 0, 2, leaves[0]!, leaves[1]!);
    const tree = proofBranchHash(context, 0, 3, pair, leaves[2]!);
    const root = proofRootHash(context, tree);
    expect(verifyProofMembership(context, root, 0, entries[0]!, [leaves[1]!, leaves[2]!])).toBe(
      true,
    );
    expect(verifyProofMembership(context, root, 2, entries[2]!, [pair])).toBe(true);
    expect(verifyProofMembership(context, root, 0, entries[0]!, [leaves[2]!, leaves[1]!])).toBe(
      false,
    );
    expect(
      verifyProofMembership(context, root, 0, entries[0]!, [leaves[1]!, leaves[2]!, left]),
    ).toBe(false);
    expect(
      verifyProofMembership({ ...context, executionId: 'other' }, root, 2, entries[2]!, [pair]),
    ).toBe(false);
    expect(verifyProofMembership({ ...context, entryCount: 4 }, root, 2, entries[2]!, [pair])).toBe(
      false,
    );
  });

  it('nega posições, contagens e hashes inválidos sem percursos ilimitados', () => {
    for (const entryCount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        verifyProofMembership({ ...context, entryCount }, entries[0]!, 0, entries[0]!, []),
      ).toBe(false);
    }
    for (const position of [-1, 1.5, 3, Infinity, NaN]) {
      expect(verifyProofMembership(context, entries[0]!, position, entries[0]!, [])).toBe(false);
    }
    expect(
      verifyProofMembership(
        context,
        entries[0]!,
        0,
        entries[0]!,
        Array<string>(54).fill(entries[0]!),
      ),
    ).toBe(false);
    expect(verifyProofMembership(context, 'invalid', 0, entries[0]!, [])).toBe(false);
  });
});
