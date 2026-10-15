import type { z } from 'zod';
import { schedule, preset, termsSnapshot } from '../../shared/schemas/paymentSettings.js';
import { companyDate, installmentsFor } from '../orders/calculation.js';
import { requireCondition } from '../../shared/errors/appError.js';
export const presetSchedule = (value: z.infer<typeof preset>) =>
  ({ cash: [0], net30: [30], '30_60': [30, 60], '30_60_90': [30, 60, 90] })[value].map(
    (offsetDays) => ({ offsetDays, weight: 1 }),
  );
export function weightedAmounts(total: number, input: z.infer<typeof schedule>) {
  requireCondition(
    Number.isSafeInteger(total) && total >= 0,
    422,
    'INVALID_AMOUNT',
    'Valor inválido',
  );
  const rows = schedule.parse(input),
    denominator = rows.reduce((sum, row) => sum + BigInt(row.weight), 0n);
  const parts = rows.map((row, index) => {
    const numerator = BigInt(total) * BigInt(row.weight);
    return { index, cents: Number(numerator / denominator), remainder: numerator % denominator };
  });
  let left = total - parts.reduce((sum, p) => sum + p.cents, 0);
  for (const p of [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (left-- <= 0) break;
    p.cents++;
  }
  return parts.map((p) => p.cents);
}
export function calendarFor(baseDate: string, input: z.infer<typeof schedule>) {
  return schedule.parse(input).map((row) => {
    const date = new Date(`${baseDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + row.offsetDays);
    requireCondition(
      !Number.isNaN(date.getTime()) && date.getUTCFullYear() <= 9999,
      422,
      'INVALID_DUE_DATE',
      'Prazo excede calendário representável',
    );
    return date.toISOString().slice(0, 10);
  });
}
export function termsAt(
  condition: { id: string; name: string; version: number; schedule: z.infer<typeof schedule> },
  now: Date,
  timeZone: string,
) {
  const baseDate = companyDate(now, timeZone);
  return termsSnapshot.parse({
    id: condition.id,
    name: condition.name,
    version: condition.version,
    schedule: condition.schedule,
    baseDate,
    timeZone,
    dueDates: calendarFor(baseDate, condition.schedule),
  });
}
export function termsInstallments(
  orderId: string,
  total: number,
  terms: z.infer<typeof termsSnapshot>,
) {
  const amounts = weightedAmounts(total, terms.schedule);
  return installmentsFor(orderId, total, terms.dueDates).map((p, i) => ({
    ...p,
    amountCents: amounts[i]!,
  }));
}
export function commercialTerms(terms: z.infer<typeof termsSnapshot>, method: unknown) {
  return {
    condition: { id: terms.id, name: terms.name, version: terms.version, schedule: terms.schedule },
    intendedMethod: method ?? null,
  };
}
