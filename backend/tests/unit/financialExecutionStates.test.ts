import { describe, expect, it } from 'vitest';
import { assertExecutionTransition } from '../../src/modules/finance/resolution/transitions.js';
import { executionProgressSchema } from '../../src/shared/schemas/financialExecutions.js';

describe('F02: transições e progresso', () => {
  it('não interpreta aplicação como publicação', () => {
    expect(() =>
      assertExecutionTransition(
        {
          status: 'APPLYING',
          resumeStatus: null,
          applicationStartedAt: '2026-10-12T12:00:00.000Z',
        },
        'COMPLETED',
      ),
    ).toThrow();
    expect(() =>
      assertExecutionTransition(
        {
          status: 'APPLYING',
          resumeStatus: null,
          applicationStartedAt: '2026-10-12T12:00:00.000Z',
        },
        'FINALIZABLE',
      ),
    ).not.toThrow();
  });
  it.each(['APPLYING', 'FINALIZABLE', 'PAUSED', 'NEEDS_REVIEW'] as const)(
    'não aborta depois da primeira aplicação em %s',
    (status) => {
      expect(() =>
        assertExecutionTransition(
          { status, resumeStatus: 'APPLYING', applicationStartedAt: '2026-10-12T12:00:00.000Z' },
          'ABORTED',
        ),
      ).toThrow('Execução aplicada');
    },
  );
  it('retoma revisão somente com validação autorizada e fase original', () => {
    const execution = {
      status: 'NEEDS_REVIEW' as const,
      resumeStatus: 'VALIDATING' as const,
      applicationStartedAt: null,
    };
    expect(() => assertExecutionTransition(execution, 'VALIDATING')).toThrow();
    expect(() => assertExecutionTransition(execution, 'VALIDATING', true)).not.toThrow();
    expect(() => assertExecutionTransition(execution, 'READY', true)).toThrow();
    expect(() => assertExecutionTransition(execution, 'ABORTED', true)).not.toThrow();
  });
  it.each(['COMPLETED', 'ABORTED'] as const)('não reabre estado terminal %s', (status) => {
    expect(() =>
      assertExecutionTransition(
        { status, resumeStatus: null, applicationStartedAt: null },
        'INDEXING',
      ),
    ).toThrow();
  });
  it('não admite contador aplicado maior que certificado', () => {
    const progress = {
      examined: 20_000,
      eligible: 20_000,
      planned: 20_000,
      sealed: 20_000,
      validated: 19_999,
      applied: 20_000,
      releasedReservations: 0,
      total: 20_000,
    };
    expect(executionProgressSchema.safeParse(progress).success).toBe(false);
    expect(executionProgressSchema.safeParse({ ...progress, validated: 20_000 }).success).toBe(
      true,
    );
  });
});
