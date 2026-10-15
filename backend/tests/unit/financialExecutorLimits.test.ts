import { describe, it, expect } from 'vitest';
import {
  emptyProofRootHash,
  proofSplit,
  verifyProofMembership,
} from '../../src/modules/finance/resolution/proofs.js';
import { siblingIntervals } from '../../src/modules/finance/resolution/proofStorage.js';
import { openApiDocument } from '../../src/modules/auth/openapi.js';
describe('F02: limites estruturais e contrato', () => {
  it('raiz vazia e separada por empresa e execucao; nao admite membro', () => {
    const c = { tenantId: 'tenant-a', executionId: 'execution-a', entryCount: 0 };
    const root = emptyProofRootHash(c);
    expect(root).toHaveLength(64);
    expect(emptyProofRootHash({ ...c, tenantId: 'tenant-b' })).not.toBe(root);
    expect(emptyProofRootHash({ ...c, executionId: 'execution-b' })).not.toBe(root);
    expect(verifyProofMembership(c, root, 0, 'a'.repeat(64), [])).toBe(false);
  });
  it('intervalos nao entram em loop com infinito ou inteiro inseguro', () => {
    for (const n of [0, 1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => proofSplit(n)).toThrow();
    expect(proofSplit(20_000)).toBe(16_384);
  });
  it('20 mil folhas mantem prova de profundidade logaritmica', () => {
    const c = { tenantId: 'tenant-a', executionId: 'execution-a', entryCount: 20_000 };
    for (const position of [0, 1, 9999, 16_384, 19_999]) {
      const siblings = siblingIntervals(c, position);
      expect(siblings.length).toBeLessThanOrEqual(15);
      expect(new Set(siblings.map((i) => i.id)).size).toBe(siblings.length);
      expect(
        siblings.every((i) => i.count > 0 && i.start >= 0 && i.start + i.count <= 20_000),
      ).toBe(true);
    }
  });
  it('oito endpoints documentam autorizacao e POST distingue 200 de 202', () => {
    const api = openApiDocument();
    const entries = Object.values(api.paths)
      .flatMap((p) => Object.values(p))
      .filter(
        (p) =>
          p &&
          typeof p === 'object' &&
          'operationId' in p &&
          String(p.operationId).match(
            /FinancialExecution|ResolutionExecution|CancellationExecution/,
          ),
      );
    expect(entries.length).toBe(8);
    const route = api.paths['/api/v1/financial-executions/{id}/advance']?.post;
    expect(route).toHaveProperty('responses.200');
    expect(route).toHaveProperty('responses.202');
    expect(route).toHaveProperty('x-permission', 'payments:manage');
  });
});
