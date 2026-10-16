import { addDays } from '@/lib/calendar';

/**
 * Prévia da divisão em centavos com a mesma regra do servidor (maior resto). Somente
 * ilustrativa: o valor oficial de cada parcela é calculado pelo backend na confirmação.
 */
export function previewAmounts(totalCents: number, weights: number[]): number[] {
  const denominator = weights.reduce((a, w) => a + w, 0);
  if (!denominator || weights.some((w) => !Number.isSafeInteger(w) || w <= 0)) return [];
  const parts = weights.map((w, index) => ({
    index,
    cents: Math.floor((totalCents * w) / denominator),
    remainder: (totalCents * w) % denominator,
  }));
  let left = totalCents - parts.reduce((a, p) => a + p.cents, 0);
  for (const p of [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : b.remainder - a.remainder,
  )) {
    if (left-- <= 0) break;
    p.cents++;
  }
  return parts.map((p) => p.cents);
}

export const previewDueDates = (baseDate: string, offsets: number[]) =>
  offsets.map((d) => addDays(baseDate, d));
