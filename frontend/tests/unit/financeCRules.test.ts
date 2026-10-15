import {
  appendReconciliation,
  cancellationBody,
  canAdvance,
  canOfferAbort,
  executionResponseSchema,
  returnResolutionBody,
} from '@/features/finance/resolutionRules';
import { executionPublished } from '@/features/orders/rules';
import { order } from '../support/fakeApi';
import { financialState } from '../support/financeFixtures';
import {
  cancellationInput,
  execution,
  publishedExecution,
  returnPreview,
} from '../support/financeCFixtures';
import type { Order } from '@/api/types';
it('202 e contadores completos não certificam publicação financeira', () => {
  const e = execution({
    progress: {
      examined: 1,
      eligible: 1,
      planned: 1,
      sealed: 1,
      validated: 1,
      applied: 1,
      releasedReservations: 0,
      total: 1,
    },
  });
  expect(executionPublished(e)).toBe(false);
  expect(executionResponseSchema.safeParse(e).success).toBe(true);
});
it.each(['financialCompleted', 'publishedAt', 'result'] as const)(
  'COMPLETED sem %s é recusado',
  (field) => {
    const e = publishedExecution();
    expect(
      executionResponseSchema.safeParse({
        ...e,
        [field]: field === 'financialCompleted' ? false : null,
      }).success,
    ).toBe(false);
  },
);
it('COMPLETED exige resultado do mesmo pedido', () => {
  const e = publishedExecution();
  expect(executionResponseSchema.safeParse(e).success).toBe(true);
  expect(
    executionResponseSchema.safeParse({ ...e, result: { ...e.result, orderId: 'outro' } }).success,
  ).toBe(false);
});
it.each(['ACCEPTED', 'PAUSED', 'ABORTED'] as const)(
  '%s não recebe publicação inventada',
  (status) => {
    expect(executionResponseSchema.safeParse({ ...publishedExecution(), status }).success).toBe(
      false,
    );
  },
);
it('progresso inválido, fracionário ou negativo não libera controles', () => {
  for (const applied of [2, 0.5, -1])
    expect(
      executionResponseSchema.safeParse(
        execution({ progress: { ...execution().progress, applied } }),
      ).success,
    ).toBe(false);
});
it('cancelamento usa versões oficiais e não calcula destinos', () => {
  const o = { ...order('o1'), version: 4, status: 'confirmed' as const, lines: [] } satisfies Order;
  expect(cancellationBody(o, financialState(), cancellationInput)).toEqual(cancellationInput);
  expect(() =>
    cancellationBody({ ...o, status: 'dispatched' }, financialState(), cancellationInput),
  ).toThrow('não expedido');
  expect(() =>
    cancellationBody(o, financialState([], { activeReturnCount: 1 }), cancellationInput),
  ).toThrow();
  expect(() =>
    cancellationBody({ ...o, version: 5 }, financialState(), cancellationInput),
  ).toThrow();
});
it.each([undefined, 0, 250, 1000])('aceite de dano %s usa limite do preview', (acceptedCents) => {
  const body = returnResolutionBody(returnPreview(), 'refund', 'Dano recebido conferido', [
    { lineId: 'line1', accept: true, ...(acceptedCents === undefined ? {} : { acceptedCents }) },
  ]);
  expect(body.expectedVersion).toBe(3);
  expect(body.damagedDecisions?.[0]?.acceptedCents).toBe(acceptedCents);
});
it.each([-1, 1001, 1.1, Number.MAX_SAFE_INTEGER + 1])(
  'aceite fora do limite %s é recusado',
  (acceptedCents) => {
    expect(() =>
      returnResolutionBody(returnPreview(), 'refund', 'Dano recebido conferido', [
        { lineId: 'line1', accept: true, acceptedCents },
      ]),
    ).toThrow('limite oficial');
  },
);
it('rejeição não aceita dinheiro; falta de decisão e linha repetida são recusadas', () => {
  expect(() => returnResolutionBody(returnPreview(), 'refund', 'Motivo', [])).toThrow('Decida');
  expect(() =>
    returnResolutionBody(returnPreview(), 'refund', 'Motivo', [
      { lineId: 'line1', accept: false, acceptedCents: 1 },
    ]),
  ).toThrow();
  expect(() =>
    returnResolutionBody(returnPreview(), 'refund', 'Motivo', [
      { lineId: 'line1', accept: false },
      { lineId: 'line1', accept: false },
    ]),
  ).toThrow();
  expect(
    returnResolutionBody(returnPreview(), 'refund', 'Motivo', [{ lineId: 'line1', accept: false }])
      .damagedDecisions,
  ).toEqual([{ lineId: 'line1', accept: false }]);
});
it('sem recebido elegível não inicia resolução', () => {
  expect(() => returnResolutionBody(returnPreview({ lines: [] }), 'refund', 'Motivo', [])).toThrow(
    'Nenhum recebido',
  );
});
it('lease expirado não oferece avanço; pausa/revisão não avança', () => {
  expect(canAdvance(execution())).toBe(true);
  expect(canAdvance(execution({ leaseUntil: new Date(0).toISOString() }))).toBe(false);
  expect(canAdvance(execution({ status: 'PAUSED' }))).toBe(false);
  expect(canAdvance(execution({ status: 'NEEDS_REVIEW' }))).toBe(false);
  expect(canAdvance(publishedExecution())).toBe(false);
});
it('abort conservador para fase prévia; aplicação e liberação recusam oferta', () => {
  expect(canOfferAbort(execution())).toBe(true);
  expect(canOfferAbort(execution({ status: 'APPLYING' }))).toBe(false);
  expect(
    canOfferAbort(execution({ progress: { ...execution().progress, releasedReservations: 1 } })),
  ).toBe(false);
});
it('journal e provas acumulam falha e não somam contagem cumulativa', () => {
  const a = {
    scope: 'proofs' as const,
    executionId: 'exec1',
    checkedEntries: 2,
    expectedEntries: 3,
    consistent: false,
    complete: false,
    nextCursor: 'signed',
  };
  const b = appendReconciliation(a, {
    ...a,
    checkedEntries: 3,
    consistent: true,
    complete: true,
    nextCursor: null,
  });
  expect(b.consistent).toBe(false);
  expect(b.checkedEntries).toBe(3);
  expect(b.complete).toBe(true);
});
it('página incompleta sem cursor, cursor completo e denominador alterado são recusados', () => {
  const p = {
    scope: 'journal' as const,
    orderId: 'o1',
    checkedEvents: 2,
    consistent: true,
    complete: false,
    nextCursor: 'cursor',
  };
  expect(() => appendReconciliation(null, { ...p, nextCursor: null })).toThrow();
  expect(() => appendReconciliation(p, { ...p, complete: true })).toThrow();
  expect(() => appendReconciliation(p, { ...p, checkedEvents: 1 })).toThrow();
  expect(() => appendReconciliation(p, { ...p, orderId: 'o2' })).toThrow();
  expect(() =>
    appendReconciliation(null, {
      scope: 'proofs',
      executionId: 'e',
      checkedEntries: 1,
      expectedEntries: 2,
      complete: true,
      nextCursor: null,
      consistent: true,
    }),
  ).toThrow();
});
