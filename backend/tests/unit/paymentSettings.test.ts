import { describe, it, expect } from 'vitest';
import { schedule, conditionCreate } from '../../src/shared/schemas/paymentSettings.js';
import {
  calendarFor,
  weightedAmounts,
  termsAt,
  presetSchedule,
} from '../../src/modules/finance/paymentCalculation.js';
describe('Condições e calendário E', () => {
  it.each(['cash', 'net30', '30_60', '30_60_90'] as const)(
    'preset %s reparte igualmente',
    (value) => {
      const rows = presetSchedule(value);
      expect(weightedAmounts(100, rows).reduce((a, b) => a + b, 0)).toBe(100);
      expect(rows.every((r) => r.weight === 1)).toBe(true);
    },
  );
  it('até doze, sem mínimo financeiro ou parcela fictícia', () => {
    expect(
      weightedAmounts(
        1,
        Array.from({ length: 12 }, (_, i) => ({ offsetDays: i, weight: 1 })),
      ),
    ).toEqual([1, ...Array(11).fill(0)]);
    expect(
      schedule.safeParse(Array.from({ length: 13 }, () => ({ offsetDays: 0, weight: 1 }))).success,
    ).toBe(false);
  });
  it('pesos seguros com BigInt e desempate determinístico', () => {
    expect(
      weightedAmounts(101, [
        { offsetDays: 0, weight: 1 },
        { offsetDays: 30, weight: 2 },
      ]),
    ).toEqual([34, 67]);
    expect(
      weightedAmounts(100, [
        { offsetDays: 0, weight: Number.MAX_SAFE_INTEGER },
        { offsetDays: 0, weight: Number.MAX_SAFE_INTEGER },
      ]),
    ).toEqual([50, 50]);
  });
  it('dias corridos atravessam fevereiro, ano e fim de semana sem deslocar', () => {
    expect(
      calendarFor('2024-02-28', [
        { offsetDays: 1, weight: 1 },
        { offsetDays: 2, weight: 1 },
      ]),
    ).toEqual(['2024-02-29', '2024-03-01']);
    expect(calendarFor('2026-12-31', [{ offsetDays: 2, weight: 1 }])).toEqual(['2027-01-02']);
    expect(calendarFor('2026-10-09', [{ offsetDays: 1, weight: 1 }])).toEqual(['2026-10-10']);
  });
  it('fuso IANA determina confirmação, não dia UTC', () => {
    const condition = {
      id: 'c',
      name: 'À vista',
      version: 1,
      schedule: [{ offsetDays: 0, weight: 1 }],
    };
    expect(termsAt(condition, new Date('2026-10-09T01:00:00Z'), 'America/Sao_Paulo').baseDate).toBe(
      '2026-10-08',
    );
    expect(termsAt(condition, new Date('2026-10-09T01:00:00Z'), 'Asia/Tokyo').baseDate).toBe(
      '2026-10-09',
    );
  });
  it.each([
    { rows: [{ offsetDays: -1, weight: 1 }] },
    { rows: [{ offsetDays: 0, weight: 0 }] },
    { rows: [{ offsetDays: 0, weight: 1.1 }] },
    {
      rows: [
        { offsetDays: 30, weight: 1 },
        { offsetDays: 0, weight: 1 },
      ],
    },
  ])('nega prazos/pesos inválidos %j', ({ rows }) =>
    expect(schedule.safeParse(rows).success).toBe(false),
  );
  it('calendário não representável falha, sem data fabricada', () =>
    expect(() => calendarFor('9999-12-31', [{ offsetDays: 1, weight: 1 }])).toThrow());
  it('não combina preset e customização nem aceita campos externos', () => {
    expect(
      conditionCreate.safeParse({
        name: '30',
        preset: 'net30',
        schedule: [{ offsetDays: 30, weight: 1 }],
      }).success,
    ).toBe(false);
    expect(conditionCreate.safeParse({ name: '30', preset: 'net30', tenantId: 'x' }).success).toBe(
      false,
    );
  });
});
