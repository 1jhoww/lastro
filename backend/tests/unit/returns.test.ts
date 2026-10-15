import { describe, it, expect } from 'vitest';
import {
  cumulativeReturnedCents,
  returnedValueLimits,
} from '../../src/modules/returns/calculation.js';
import { returnResolve, returnLineSchema } from '../../src/shared/schemas/returns.js';
describe('Devolução cumulativa em centavos', () => {
  it('reparte centavos sucessivos sem exceder linha original', () => {
    expect([0, 1, 2, 3].map((q) => cumulativeReturnedCents(2, q, 3))).toEqual([0, 1, 1, 2]);
  });
  it('mantém valor integral mesmo com produtos de grande quantidade', () => {
    expect(cumulativeReturnedCents(100_000_000, 1_000_000_000_000, 1_000_000_000_000)).toBe(
      100_000_000,
    );
  });
  it.each([-1, 4, 0.5])('rejeita quantidade devolvida inválida %s', (q) => {
    expect(() => cumulativeReturnedCents(2, q, 3)).toThrow();
  });
  it('não exige valor mínimo para parcial arredondado a zero', () => {
    expect(cumulativeReturnedCents(1, 1, 1000)).toBe(0);
  });
  it('limite do dano usa diferença cumulativa após o revendável', () => {
    expect(returnedValueLimits(2, 3, 0, 1, 1)).toEqual({ sellableCents: 1, damagedLimitCents: 0 });
    expect(returnedValueLimits(2, 3, 2, 0, 1)).toEqual({ sellableCents: 0, damagedLimitCents: 1 });
  });
  it('limites sucessivos mantêm centavos originais para todos os fragmentos', () => {
    for (let total = 0; total <= 25; total++) {
      for (let expedited = 1; expedited <= 15; expedited++) {
        let sum = 0;
        for (let accepted = 0; accepted < expedited; accepted++)
          sum += returnedValueLimits(total, expedited, accepted, 0, 1).damagedLimitCents;
        expect(sum).toBe(total);
      }
    }
  });
  it.each([0, 123, undefined])(
    'contrato admite aceite monetário %s sem perder compatibilidade',
    (acceptedCents) => {
      const result = returnResolve.parse({
        expectedOrderVersion: 1,
        expectedGuardVersion: 1,
        expectedVersion: 1,
        reason: 'Avaliação administrativa',
        disposition: 'refund',
        damagedDecisions: [
          {
            lineId: 'line-1',
            accept: true,
            ...(acceptedCents === undefined ? {} : { acceptedCents }),
          },
        ],
      });
      expect(result.damagedDecisions![0]!.acceptedCents).toBe(acceptedCents);
    },
  );
  it.each([-1, 0.5, 100_000_001])('contrato rejeita valor de dano inválido %s', (acceptedCents) => {
    expect(
      returnResolve.safeParse({
        expectedOrderVersion: 1,
        expectedGuardVersion: 1,
        expectedVersion: 1,
        reason: 'Avaliação administrativa',
        disposition: 'refund',
        damagedDecisions: [{ lineId: 'line-1', accept: true, acceptedCents }],
      }).success,
    ).toBe(false);
  });
  it('rejeição não aceita dinheiro e linha histórica não recebe campo novo por default', () => {
    expect(
      returnResolve.safeParse({
        expectedOrderVersion: 1,
        expectedGuardVersion: 1,
        expectedVersion: 1,
        reason: 'Avaliação administrativa',
        disposition: 'refund',
        damagedDecisions: [{ lineId: 'line-1', accept: false, acceptedCents: 1 }],
      }).success,
    ).toBe(false);
    const legacy = {
      lineId: 'line-1',
      productId: 'product-1',
      unit: 'UN',
      requestedScaled: 1000,
      receivedScaled: 1000,
      sellableScaled: 0,
      damagedScaled: 1000,
      resolvedSellableScaled: 0,
      acceptedDamagedScaled: 1000,
      rejectedDamagedScaled: 0,
      valueResolvedCents: 100,
    };
    expect(returnLineSchema.parse(legacy)).toEqual(legacy);
  });
});
