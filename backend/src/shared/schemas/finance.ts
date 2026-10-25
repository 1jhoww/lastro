import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { cents, calendarDate } from './orders.js';
import { expectedVersion } from './commercial.js';
import { methodSnapshot } from './paymentSettings.js';
import { pageQuery, pageOf } from './http.js';
import { digest, stableJson } from '../utils/crypto.js';
const positiveCents = cents.refine((v) => v > 0, 'Valor deve ser positivo');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().trim().min(3).max(500);
export const titleStatus = (t: {
  originalCents: number;
  outstandingCents: number;
  cashCents: number;
  creditCents: number;
  canceledCents: number;
}) =>
  t.canceledCents === t.originalCents && t.originalCents > 0
    ? ('canceled' as const)
    : t.originalCents === 0
      ? ('zero' as const)
      : t.outstandingCents === 0
        ? ('paid' as const)
        : t.cashCents + t.creditCents > 0
          ? ('partially_paid' as const)
          : ('open' as const);
export const titleAmounts = z
  .object({
    id: opaqueId,
    originalCents: cents,
    outstandingCents: cents,
    cashCents: cents,
    creditCents: cents,
    canceledCents: cents,
    version: expectedVersion,
  })
  .refine(
    (v) => v.originalCents === v.outstandingCents + v.cashCents + v.creditCents + v.canceledCents,
    'Componentes do título inconsistentes',
  );
export const titleSchema = titleAmounts
  .safeExtend({
    tenantId: opaqueId,
    orderId: opaqueId,
    customerId: opaqueId,
    installmentNumber: z.number().int().min(1).max(12),
    dueDate: calendarDate,
    basisHash: hash,
    createdAt: instant,
    updatedAt: instant,
    schemaVersion: z.literal(1),
  })
  .strict();
export const titleView = z
  .object(titleSchema.shape)
  .omit({ tenantId: true, basisHash: true, schemaVersion: true })
  .extend({
    status: z.enum(['open', 'partially_paid', 'paid', 'canceled', 'zero']),
    customerName: z.string(),
  });
export const fundsSchema = z
  .object({
    cashReceivedCents: cents,
    cashSettledCents: cents,
    creditSettledCents: cents,
    transferredCashCents: cents,
    canceledCents: cents,
    activeReturnCount: z.number().int().nonnegative().safe(),
  })
  .refine(
    (v) => v.cashReceivedCents === v.cashSettledCents + v.transferredCashCents,
    'Origem de caixa inconsistente',
  );
export const financialStateSchema = fundsSchema
  .safeExtend({
    tenantId: opaqueId,
    orderId: opaqueId,
    customerId: opaqueId,
    version: expectedVersion,
    eventSequence: z.number().int().nonnegative().safe(),
    headHash: hash,
    headEventId: opaqueId.nullable(),
    journalVersion: z.literal(2).optional(),
    schemaVersion: z.literal(1),
  })
  .strict();
export const ledgerSnapshot = fundsSchema
  .safeExtend({ titles: z.array(titleAmounts).min(1).max(12) })
  .refine(
    (v) =>
      v.cashSettledCents === v.titles.reduce((a, t) => a + t.cashCents, 0) &&
      v.creditSettledCents === v.titles.reduce((a, t) => a + t.creditCents, 0) &&
      v.canceledCents === v.titles.reduce((a, t) => a + t.canceledCents, 0),
    'Diário inconsistente',
  );
export const eventV1Schema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  orderId: opaqueId,
  customerId: opaqueId,
  operationId: opaqueId,
  type: z.enum([
    'receipt',
    'payment_reversal',
    'credit_application',
    'credit_reversal',
    'financial_cancellation',
    'refund',
    'return_intent',
    'return_edited',
    'return_canceled',
    'return_received',
    'return_resolved',
  ]),
  amountCents: cents,
  reason,
  actorUid: opaqueId,
  occurredAt: instant,
  requestId: z.string().uuid(),
  sequence: z.number().int().positive().safe(),
  previousHash: hash,
  hash,
  before: ledgerSnapshot,
  after: ledgerSnapshot,
  references: z.array(opaqueId),
  schemaVersion: z.literal(1),
});
export const financialEventProofSchema = z.strictObject({
  executionId: opaqueId,
  manifestId: opaqueId,
  rootHash: hash,
  entryCount: z.number().int().nonnegative().safe(),
  beforeSnapshotHash: hash,
  afterSnapshotHash: hash,
  orderLifecycleHash: hash.optional(),
  returnEventId: opaqueId.optional(),
  returnEventHash: hash.optional(),
  returnHeaderHash: hash.optional(),
});
export const eventV2Schema = eventV1Schema
  .extend({
    schemaVersion: z.literal(2),
    type: z.enum(['financial_cancellation', 'return_resolved']),
    references: z.array(opaqueId).max(4),
    proof: financialEventProofSchema,
  })
  .refine(
    (v) =>
      v.proof.beforeSnapshotHash === digest(stableJson(v.before)) &&
      v.proof.afterSnapshotHash === digest(stableJson(v.after)),
    'Snapshots da prova financeira inconsistentes',
  );
export const eventSchema = z.discriminatedUnion('schemaVersion', [eventV1Schema, eventV2Schema]);
export const eventView = z.union([
  z.object(eventV2Schema.shape).omit({ tenantId: true }).strip(),
  eventV1Schema.omit({ tenantId: true, schemaVersion: true }).strip(),
]);
export const allocationInput = z.strictObject({
  receivableId: opaqueId,
  amountCents: positiveCents,
  expectedVersion,
});
export const allocationsInput = z
  .array(allocationInput)
  .min(1)
  .max(12)
  .refine((v) => new Set(v.map((a) => a.receivableId)).size === v.length, 'Título repetido');
export const allocation = z
  .strictObject({ receivableId: opaqueId, amountCents: positiveCents, remainingCents: cents })
  .refine((v) => v.remainingCents <= v.amountCents, 'Alocação inconsistente');
const orderVersions = {
  expectedOrderVersion: expectedVersion,
  expectedGuardVersion: expectedVersion,
};
export const receiptInput = z.strictObject({
  ...orderVersions,
  customerId: opaqueId,
  methodId: opaqueId,
  methodVersion: expectedVersion,
  amountCents: positiveCents,
  receivedOn: calendarDate,
  allocations: allocationsInput,
  reference: z.string().trim().max(200).optional(),
  reason,
});
export const paymentSchema = z
  .strictObject({
    id: opaqueId,
    tenantId: opaqueId,
    orderId: opaqueId,
    customerId: opaqueId,
    amountCents: positiveCents,
    reversedCents: cents,
    transferredCents: cents,
    allocations: z.array(allocation).min(1).max(12),
    method: methodSnapshot,
    receivedOn: calendarDate,
    recordedAt: instant,
    createdBy: opaqueId,
    reference: z.string().max(200),
    version: expectedVersion,
    schemaVersion: z.literal(1),
  })
  .refine(
    (v) =>
      v.reversedCents <= v.amountCents &&
      v.allocations.reduce((a, r) => a + r.amountCents, 0) === v.amountCents &&
      v.allocations.reduce((a, r) => a + r.remainingCents, 0) ===
        v.amountCents - v.reversedCents - v.transferredCents,
    'Recebimento inconsistente',
  );
export const paymentView = z
  .object(paymentSchema.shape)
  .omit({ tenantId: true, schemaVersion: true });
export const reversalInput = z.strictObject({
  ...orderVersions,
  expectedVersion,
  amountCents: positiveCents,
  allocations: allocationsInput,
  reason,
});
export const lotSchema = z
  .strictObject({
    id: opaqueId,
    tenantId: opaqueId,
    customerId: opaqueId,
    originOrderId: opaqueId,
    originReference: opaqueId,
    origin: z.enum(['order_cancellation', 'order_return']),
    issuedCents: positiveCents,
    availableCents: cents,
    appliedCents: cents,
    version: expectedVersion,
    createdAt: instant,
    updatedAt: instant,
    schemaVersion: z.literal(1),
  })
  .refine((v) => v.issuedCents === v.availableCents + v.appliedCents, 'Crédito inconsistente');
export const lotView = z.object(lotSchema.shape).omit({ tenantId: true, schemaVersion: true });
export const creditInput = z.strictObject({
  ...orderVersions,
  customerId: opaqueId,
  creditLotId: opaqueId,
  expectedLotVersion: expectedVersion,
  amountCents: positiveCents,
  allocations: allocationsInput,
  reason,
});
export const creditSchema = z
  .strictObject({
    id: opaqueId,
    tenantId: opaqueId,
    orderId: opaqueId,
    customerId: opaqueId,
    creditLotId: opaqueId,
    amountCents: positiveCents,
    reversedCents: cents,
    restoredByCancellationCents: cents,
    allocations: z.array(allocation).min(1).max(12),
    status: z.enum(['active', 'reversed', 'restored']),
    version: expectedVersion,
    createdAt: instant,
    createdBy: opaqueId,
    schemaVersion: z.literal(1),
  })
  .refine(
    (v) =>
      v.allocations.reduce((a, r) => a + r.amountCents, 0) === v.amountCents &&
      v.allocations.reduce((a, r) => a + r.remainingCents, 0) ===
        v.amountCents - v.reversedCents - v.restoredByCancellationCents,
    'Aplicação de crédito inconsistente',
  );
export const creditView = z
  .object(creditSchema.shape)
  .omit({ tenantId: true, schemaVersion: true });
export const creditReversalInput = reversalInput.extend({ expectedLotVersion: expectedVersion });
export const cancellationInput = z.strictObject({
  ...orderVersions,
  disposition: z.enum(['customer_credit', 'refund']),
  reason,
});
export const refundSchema = z
  .strictObject({
    id: opaqueId,
    tenantId: opaqueId,
    orderId: opaqueId,
    customerId: opaqueId,
    originReference: opaqueId,
    origin: z.enum(['order_cancellation', 'order_return']),
    originalCents: positiveCents,
    outstandingCents: cents,
    refundedCents: cents,
    version: expectedVersion,
    status: z.enum(['pending', 'partially_refunded', 'confirmed']),
    createdAt: instant,
    updatedAt: instant,
    schemaVersion: z.literal(1),
  })
  .refine(
    (v) => v.originalCents === v.outstandingCents + v.refundedCents,
    'Obrigação inconsistente',
  );
export const refundView = z
  .object(refundSchema.shape)
  .omit({ tenantId: true, schemaVersion: true });
export const refundConfirmationSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  orderId: opaqueId,
  refundObligationId: opaqueId,
  amountCents: positiveCents,
  method: methodSnapshot,
  refundedOn: calendarDate,
  reference: z.string().min(1).max(200),
  reason,
  actorUid: opaqueId,
  recordedAt: instant,
  schemaVersion: z.literal(1),
});
export const refundConfirmationView = refundConfirmationSchema
  .omit({ tenantId: true, schemaVersion: true })
  .strip();
export const refundInput = z.strictObject({
  ...orderVersions,
  expectedVersion,
  amountCents: positiveCents,
  methodId: opaqueId,
  methodVersion: expectedVersion,
  refundedOn: calendarDate,
  reference: z.string().trim().min(1).max(200),
  reason,
});
/**
 * Correction of one open title's due date. Amounts, payments, credits, stock, the journal and
 * the commercial terms snapshot taken at confirmation stay as they were; the change itself is
 * kept in this immutable record (both dates and the reason), in the audit log and in the
 * order history.
 */
export const dueDateChangeInput = z.strictObject({
  ...orderVersions,
  receivableId: opaqueId,
  /** Version of the title (financial projection) the person saw. */
  expectedVersion,
  dueDate: calendarDate,
  reason,
});
export const dueDateChangeSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  orderId: opaqueId,
  customerId: opaqueId,
  receivableId: opaqueId,
  installmentNumber: z.number().int().min(1).max(12),
  previousDueDate: calendarDate,
  dueDate: calendarDate,
  reason,
  /** Order version written by the change (its history entry carries the same version). */
  orderVersion: expectedVersion,
  actorUid: opaqueId,
  requestId: z.string().uuid(),
  occurredAt: instant,
  schemaVersion: z.literal(1),
});
export const dueDateChangeView = z
  .object(dueDateChangeSchema.shape)
  .omit({ tenantId: true, schemaVersion: true });
export const dueDateChangesView = z.object({ items: z.array(dueDateChangeView).max(100) });
export const dueDateChangeResult = z.object({
  change: dueDateChangeView,
  orderVersion: expectedVersion,
  guardVersion: expectedVersion,
});
export const financialResult = z.object({
  operationId: opaqueId,
  orderId: opaqueId,
  orderVersion: expectedVersion,
  guardVersion: expectedVersion,
  eventId: opaqueId,
  resourceId: opaqueId.nullable(),
  creditLotId: opaqueId.nullable(),
  refundObligationId: opaqueId.nullable(),
  amountCents: cents,
});
export const titleQuery = z
  .strictObject({
    ...pageQuery.shape,
    orderId: opaqueId.optional(),
    customerId: opaqueId.optional(),
    status: z.enum(['open', 'partially_paid', 'paid', 'canceled', 'zero']).optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Período inválido');
export const financialQuery = z.strictObject({
  ...pageQuery.shape,
  orderId: opaqueId.optional(),
  customerId: opaqueId.optional(),
});
export const titlesPage = pageOf(titleView),
  paymentsPage = pageOf(paymentView),
  lotsPage = pageOf(lotView),
  refundsPage = pageOf(refundView),
  financialEventsPage = pageOf(eventView);
export const creditsPage = pageOf(creditView);
export const reconciliationView = z.object({
  orderId: opaqueId,
  consistent: z.boolean(),
  complete: z.boolean(),
  checkedEvents: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  scope: z.literal('journal').optional(),
  sourceProofsVerified: z.literal(false).optional(),
});
export const financialStateView = fundsSchema.safeExtend({
  orderId: opaqueId,
  orderVersion: expectedVersion,
  guardVersion: expectedVersion,
  financialVersion: expectedVersion,
  titles: z.array(titleView).min(1).max(12),
});
export type FinancialTitle = z.infer<typeof titleSchema>;
export type FinancialState = z.infer<typeof financialStateSchema>;
export type LedgerSnapshot = z.infer<typeof ledgerSnapshot>;
