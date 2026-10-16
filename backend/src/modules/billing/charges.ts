import { z } from 'zod';
import {
  calendarDate,
  instant,
  opaqueId,
  planCode,
  termsShape,
  type Subscription,
} from '../../shared/schemas/models.js';
import { addDays } from './calendar.js';

/**
 * Manual billing of Lastro subscriptions (no payment gateway). A charge is the amount owed for
 * one month ("competência") of one subscription.
 *
 * Rules:
 * - One charge per subscription and month: the document id is `{subscriptionId}_{YYYY-MM}`,
 *   so generation is idempotent and an automatic charge never duplicates a manual one.
 * - The amount is a snapshot of the contracted price when the charge is issued. Later plan,
 *   price or due-day changes apply only to charges not issued yet.
 * - Only `active` subscriptions with billing terms get automatic charges; pending, suspended,
 *   canceled and zero-priced contracts get none.
 * - A charge is issued up to GENERATION_LEAD_DAYS before its due date and never for a due date
 *   before `billingStartsOn` nor older than GENERATION_GRACE_DAYS (no retroactive charges after
 *   a suspension; only a short outage of the scheduler is covered).
 * - "Overdue" is derived (pending and past due), never stored, and only raises an alert: access
 *   is never blocked automatically.
 */
export const GENERATION_LEAD_DAYS = 10;
export const GENERATION_GRACE_DAYS = 3;
export const DUE_SOON_DAYS = 5;

export const competence = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const chargeStatus = z.enum(['pending', 'paid', 'canceled']);
export const chargeSituation = z.enum(['pending', 'due_soon', 'overdue', 'paid', 'canceled']);
const amount = termsShape.monthlyPriceCents;
const notes = z.string().trim().max(500).nullable();

export const chargeSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  subscriptionId: opaqueId,
  competence,
  amountCents: amount,
  dueDate: calendarDate,
  status: chargeStatus,
  paidAt: calendarDate.nullable(),
  paidAmountCents: amount.nullable(),
  notes,
  origin: z.enum(['automatic', 'manual']),
  /** Plan when the charge was issued, for reports; null for legacy contracts. */
  planCode: planCode.nullable(),
  version: z.number().int().positive(),
  createdAt: instant,
  updatedAt: instant,
  schemaVersion: z.literal(1),
});
export type Charge = z.infer<typeof chargeSchema>;
export type ChargeSituation = z.infer<typeof chargeSituation>;

export function chargeId(subscriptionId: string, month: string): string {
  return `${subscriptionId}_${month}`;
}

export function dueDateFor(month: string, billingDay: number): string {
  return `${month}-${String(billingDay).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (value - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function situationOf(charge: Pick<Charge, 'status' | 'dueDate'>, today: string) {
  if (charge.status !== 'pending') return charge.status;
  if (charge.dueDate < today) return 'overdue';
  if (charge.dueDate <= addDays(today, DUE_SOON_DAYS)) return 'due_soon';
  return 'pending';
}

/** Months whose automatic charge should exist today for this subscription. */
export function chargesDue(
  subscription: Pick<
    Subscription,
    'status' | 'billingDay' | 'billingStartsOn' | 'monthlyPriceCents'
  >,
  today: string,
): { competence: string; dueDate: string }[] {
  const { billingDay, billingStartsOn } = subscription;
  if (
    subscription.status !== 'active' ||
    billingDay === null ||
    billingStartsOn === null ||
    subscription.monthlyPriceCents === 0
  )
    return [];
  const earliest = addDays(today, -GENERATION_GRACE_DAYS);
  const latest = addDays(today, GENERATION_LEAD_DAYS);
  const current = today.slice(0, 7);
  return [-1, 0, 1]
    .map((delta) => shiftMonth(current, delta))
    .map((month) => ({ competence: month, dueDate: dueDateFor(month, billingDay) }))
    .filter(
      ({ dueDate }) => dueDate >= billingStartsOn && dueDate >= earliest && dueDate <= latest,
    );
}

/** Next due date on or after today, for subscriptions with billing terms. */
export function nextDueDate(
  subscription: Pick<Subscription, 'status' | 'billingDay' | 'billingStartsOn'>,
  today: string,
): string | null {
  const { billingDay, billingStartsOn } = subscription;
  if (subscription.status !== 'active' || billingDay === null || billingStartsOn === null)
    return null;
  const from = billingStartsOn > today ? billingStartsOn : today;
  const month = from.slice(0, 7);
  const candidate = dueDateFor(month, billingDay);
  return candidate >= from ? candidate : dueDateFor(shiftMonth(month, 1), billingDay);
}
