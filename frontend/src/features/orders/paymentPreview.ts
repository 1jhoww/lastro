import type { ConditionOption } from '@/api/types';
import { manualDueDates, type PaymentChoice } from './rules';

/** Prévia com maiores restos, desempate pela ordem, igual ao contrato comercial do backend. */
export function paymentPreview(
  total: number,
  choice: PaymentChoice,
  conditions: readonly ConditionOption[],
  today: string,
) {
  if (!Number.isSafeInteger(total) || total < 0 || choice.mode === 'later') return [];
  const condition =
    choice.mode === 'condition' ? conditions.find((c) => c.id === choice.conditionId) : undefined;
  const dates =
    choice.mode === 'manual'
      ? choice.first
        ? manualDueDates(choice)
        : []
      : (condition?.schedule.map((row) => {
          const date = new Date(`${today}T12:00:00Z`);
          date.setUTCDate(date.getUTCDate() + row.offsetDays);
          return date.toISOString().slice(0, 10);
        }) ?? []);
  if (!dates.length || dates.length > 12) return [];
  const weights = condition?.schedule.map((row) => BigInt(row.weight)) ?? dates.map(() => 1n);
  const denominator = weights.reduce((sum, weight) => sum + weight, 0n);
  if (denominator <= 0n) return [];
  const parts = dates.map((date, index) => {
    const numerator = BigInt(total) * weights[index]!;
    return {
      date,
      index,
      amountCents: Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  let remaining = total - parts.reduce((sum, part) => sum + part.amountCents, 0);
  for (const part of [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (remaining-- <= 0) break;
    part.amountCents++;
  }
  return parts.map(({ date, amountCents }) => ({ date, amountCents }));
}
