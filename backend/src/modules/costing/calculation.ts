import { requireCondition } from '../../shared/errors/appError.js';

/**
 * Cost arithmetic. Money is integer cents; unit costs are thousandths of a cent per whole unit,
 * and quantities are the inventory's scaled integers (1000 = one unit), so one receipt of a
 * fractional quantity keeps its exact value.
 */
export const MILLI_PER_CENT = 1000;
const SCALE = 1000n;

const rounded = (numerator: bigint, denominator: bigint) =>
  (numerator * 2n + denominator) / (denominator * 2n);

/** Unit cost of `valueCents` spread over `quantityScaled`. */
export function unitCostMilli(valueCents: number, quantityScaled: number): number {
  requireCondition(quantityScaled > 0, 422, 'INVALID_QUANTITY', 'Quantidade inválida');
  return Number(
    rounded(BigInt(valueCents) * BigInt(MILLI_PER_CENT) * SCALE, BigInt(quantityScaled)),
  );
}
export const milliToCents = (milli: number) =>
  Number(rounded(BigInt(milli), BigInt(MILLI_PER_CENT)));
export const centsToMilli = (cents: number) => cents * MILLI_PER_CENT;
/** Cost of a quantity at a unit cost, in cents. */
export const costOf = (unitMilli: number, quantityScaled: number) =>
  Number(rounded(BigInt(unitMilli) * BigInt(quantityScaled), BigInt(MILLI_PER_CENT) * SCALE));

export interface CostBase {
  /** Physical stock before the movement, including what is reserved. */
  physicalScaled: number;
  averageCostMilli: number | null;
  referenceCostCents: number | null;
}
const baseUnitCost = (base: CostBase) =>
  base.averageCostMilli ??
  (base.referenceCostCents === null ? null : centsToMilli(base.referenceCostCents));

/**
 * Moving weighted average after a receipt. Stock already on hand counts at the current average;
 * stock that never had a cost (no average and no reference) cannot be valued, so the received
 * cost becomes the average. Exits, adjustments and stand-alone entries never move the average.
 */
export function averageAfterReceipt(base: CostBase, valueCents: number, quantityScaled: number) {
  const unit = baseUnitCost(base);
  if (unit === null || base.physicalScaled === 0) return unitCostMilli(valueCents, quantityScaled);
  const stockValue = BigInt(unit) * BigInt(base.physicalScaled);
  const received = BigInt(valueCents) * BigInt(MILLI_PER_CENT) * SCALE;
  return Number(rounded(stockValue + received, BigInt(base.physicalScaled + quantityScaled)));
}

/**
 * Average once a receipt leaves the stock again: the inverse of `averageAfterReceipt`. When
 * nothing else remains in stock the average stays, since there is nothing left to value.
 */
export function averageAfterReversal(
  physicalScaled: number,
  averageCostMilli: number,
  valueCents: number,
  quantityScaled: number,
) {
  const remaining = physicalScaled - quantityScaled;
  if (remaining <= 0) return averageCostMilli;
  const stockValue = BigInt(averageCostMilli) * BigInt(physicalScaled);
  const removed = BigInt(valueCents) * BigInt(MILLI_PER_CENT) * SCALE;
  if (stockValue <= removed) return averageCostMilli;
  return Number(rounded(stockValue - removed, BigInt(remaining)));
}

/** Gross figures of one unit. Null without a cost or a price, never a misleading zero. */
export function grossMargin(priceCents: number, costCents: number | null) {
  if (costCents === null) return { unitGrossProfitCents: null, grossMarginBp: null };
  const profit = priceCents - costCents;
  return {
    unitGrossProfitCents: profit,
    grossMarginBp: priceCents > 0 ? marginBp(profit, priceCents) : null,
  };
}
export const marginBp = (profitCents: number, revenueCents: number) =>
  revenueCents > 0 ? Math.round((profitCents * 10_000) / revenueCents) : 0;

/**
 * Splits `amount` proportionally to `weights` with the largest-remainder method: the parts always
 * add up to exactly `amount`. Without any weight the amount goes to the first part.
 */
export function distribute(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((a, w) => a + w, 0);
  if (total === 0) return weights.map((_, i) => (i === 0 ? amount : 0));
  const parts = weights.map((weight, index) => {
    const numerator = BigInt(amount) * BigInt(weight);
    return {
      index,
      amount: Number(numerator / BigInt(total)),
      remainder: numerator % BigInt(total),
    };
  });
  let left = amount - parts.reduce((a, p) => a + p.amount, 0);
  for (const part of [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (left-- <= 0) break;
    part.amount++;
  }
  return parts.map((p) => p.amount);
}
