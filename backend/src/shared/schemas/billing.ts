import { z } from 'zod';
import { calendarDate, instant, opaqueId, planCode, termsShape } from './models.js';
import { chargeSituation, chargeStatus, competence } from '../../modules/billing/charges.js';

const expectedVersion = z.number().int().positive();
const reason = z.string().trim().min(3).max(200);
const amount = termsShape.monthlyPriceCents;
const notes = z.string().trim().max(500).nullable();

export const chargeView = z.object({
  id: opaqueId,
  tenantId: opaqueId,
  subscriptionId: opaqueId,
  competence,
  amountCents: z.number(),
  dueDate: calendarDate,
  status: chargeStatus,
  /** Derived for alerts: overdue and due soon are pending charges by due date. */
  situation: chargeSituation,
  paidAt: calendarDate.nullable(),
  paidAmountCents: z.number().nullable(),
  notes: z.string().nullable(),
  origin: z.enum(['automatic', 'manual']),
  planCode: planCode.nullable(),
  version: z.number(),
  createdAt: instant,
  updatedAt: instant,
});
export const chargeListQuery = z.strictObject({
  situation: z.enum(['all', 'open', 'overdue', 'due_soon', 'paid', 'canceled']).optional(),
  tenantId: opaqueId.optional(),
  limit: z
    .string()
    .regex(/^(?:[1-9][0-9]?|100)$/)
    .optional(),
  cursor: z.string().max(1024).optional(),
});
export const chargePage = z.object({
  items: z.array(chargeView),
  nextCursor: z.string().nullable(),
});
export const createChargeInput = z.strictObject({
  tenantId: opaqueId,
  competence,
  amountCents: amount,
  dueDate: calendarDate,
  notes: notes.optional(),
  reason,
});
export const payChargeInput = z.strictObject({
  expectedVersion,
  paidAt: calendarDate,
  /** Defaults to the charged amount. */
  paidAmountCents: amount.optional(),
  notes: notes.optional(),
});
export const correctChargeInput = z.strictObject({
  expectedVersion,
  /** Reopening a paid charge clears the payment; reopening a canceled one restores it. */
  status: z.enum(['pending', 'paid']).optional(),
  amountCents: amount.optional(),
  dueDate: calendarDate.optional(),
  paidAt: calendarDate.optional(),
  paidAmountCents: amount.optional(),
  notes: notes.optional(),
  reason,
});
export const cancelChargeInput = z.strictObject({ expectedVersion, reason });
export const generationResult = z.object({
  examined: z.number(),
  created: z.number(),
  existing: z.number(),
  skipped: z.number(),
  failed: z.number(),
});
export const chargeHistoryView = z.object({
  items: z.array(
    z.object({
      id: opaqueId,
      action: z.string(),
      actorUid: opaqueId,
      occurredAt: instant,
      changes: z.record(z.string(), z.unknown()),
    }),
  ),
});
