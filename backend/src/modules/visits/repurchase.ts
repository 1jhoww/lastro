import type { z } from 'zod';
import type { repurchaseEstimate } from '../../shared/schemas/visits.js';

/**
 * Repurchase estimate rules. Only confirmed commercial orders count as purchases (status
 * `confirmed` or `dispatched`, dated by `confirmedAt` in the company timezone); drafts and
 * canceled orders never do, and neither do visits or deliveries.
 */
export const REPURCHASE = Object.freeze({
  /** Purchases older than this window do not shape the frequency. */
  lookbackDays: 365,
  /** Distinct purchase days required for an estimate (two intervals). */
  minimumPurchases: 3,
  /** Most recent intervals used for the median. */
  maxIntervals: 12,
});
const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T12:00:00Z`);
export const shiftDate = (date: string, days: number) =>
  new Date(toTime(date) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) =>
  Math.round((toTime(to) - toTime(from)) / DAY);

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export type RepurchaseEstimate = z.infer<typeof repurchaseEstimate>;

/**
 * Estimate from the local purchase days of one customer (any order, duplicates allowed: several
 * orders on the same day are one purchase). `lastPurchaseOn` is the latest day given, even
 * outside the window; frequency and next date come only from days inside the window. The next
 * date is the last purchase plus the median interval, an estimate and never a promise.
 */
export function estimateRepurchase(purchaseDays: readonly string[], today: string) {
  const days = [...new Set(purchaseDays.filter((d) => d <= today))].sort();
  const lastPurchaseOn = days.at(-1) ?? null;
  const windowStart = shiftDate(today, -REPURCHASE.lookbackDays);
  const recent = days.filter((d) => d >= windowStart);
  const base = {
    lastPurchaseOn,
    purchaseCount: recent.length,
    frequencyDays: null,
    nextEstimatedOn: null,
    status: 'insufficient_history',
    daysFromEstimate: null,
  } satisfies RepurchaseEstimate;
  if (recent.length < REPURCHASE.minimumPurchases) return base;
  const intervals = recent
    .slice(1)
    .map((day, i) => daysBetween(recent[i]!, day))
    .slice(-REPURCHASE.maxIntervals);
  const frequencyDays = Math.max(1, median(intervals));
  const nextEstimatedOn = shiftDate(recent.at(-1)!, frequencyDays);
  const daysFromEstimate = daysBetween(nextEstimatedOn, today);
  return {
    ...base,
    frequencyDays,
    nextEstimatedOn,
    status: daysFromEstimate > 0 ? 'overdue' : 'on_track',
    daysFromEstimate,
  } satisfies RepurchaseEstimate;
}

/** Overdue first (most late on top), then the nearest estimates, then customers without one. */
export function compareRepurchase(
  a: RepurchaseEstimate & { customerName: string },
  b: RepurchaseEstimate & { customerName: string },
) {
  const rank = { overdue: 0, on_track: 1, insufficient_history: 2 } as const;
  return (
    rank[a.status] - rank[b.status] ||
    (b.daysFromEstimate ?? 0) - (a.daysFromEstimate ?? 0) ||
    (b.lastPurchaseOn ?? '').localeCompare(a.lastPurchaseOn ?? '') ||
    a.customerName.localeCompare(b.customerName, 'pt-BR')
  );
}
