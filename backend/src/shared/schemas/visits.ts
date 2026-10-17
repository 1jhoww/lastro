import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { calendarDate, orderStatus } from './orders.js';
import { pageQuery, pageOf } from './http.js';

/**
 * Commercial follow-up of a customer. `manual` records are visits or contacts registered by a
 * user; `automatic` records exist only because a delivery was confirmed and are never presented
 * as an in-person visit by a seller.
 */
export const visitSource = z.enum(['manual', 'automatic']);
/** In-person visit, remote contact (phone, message) or confirmed delivery (automatic only). */
export const visitKind = z.enum(['in_person', 'remote', 'delivery']);
const notes = z.string().trim().max(1000);

export const visitView = z.object({
  id: opaqueId,
  customerId: opaqueId,
  customerName: z.string().max(160),
  source: visitSource,
  kind: visitKind,
  /** Local calendar date of the visit or of the delivery. */
  visitDate: calendarDate,
  /** Who attended the customer: chosen on manual records, the order's seller on deliveries. */
  responsibleUid: opaqueId,
  responsibleName: z.string().nullable(),
  notes: z.string().max(1000),
  orderId: opaqueId.nullable(),
  orderCommercialId: z.string().nullable(),
  /** Whether the caller can open the related order in Pedidos. */
  orderAccessible: z.boolean(),
  createdAt: instant,
  createdBy: opaqueId,
});
export const visitSchema = visitView
  .omit({ responsibleName: true, orderAccessible: true })
  .extend({
    tenantId: opaqueId,
    /** Manual records only: hash of the creation payload, for idempotent replays. */
    payloadHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    schemaVersion: z.literal(1),
  })
  .strict()
  .refine(
    (v) =>
      v.source === 'automatic'
        ? v.kind === 'delivery' && v.orderId !== null && v.payloadHash === null
        : v.kind !== 'delivery' && v.payloadHash !== null,
    'Registro de visita inconsistente',
  )
  .refine((v) => (v.orderId === null) === (v.orderCommercialId === null), 'Pedido inconsistente');
export type Visit = z.infer<typeof visitSchema>;

export const visitCreate = z.strictObject({
  customerId: opaqueId,
  visitDate: calendarDate,
  kind: z.enum(['in_person', 'remote']),
  /** Administrators only; sellers always register their own visits. */
  responsibleUid: opaqueId.optional(),
  notes: notes.min(3),
  orderId: opaqueId.nullable().optional(),
});
export const visitQuery = z.strictObject({
  ...pageQuery.shape,
  customerId: opaqueId.optional(),
  responsibleUid: opaqueId.optional(),
  source: visitSource.optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
});
export const visitsPage = pageOf(visitView);

/**
 * Effective delivery of a dispatched order, confirmed by a user. Dispatch is always integral in
 * Lastro, so there is at most one delivery per order (the document id is the order id).
 */
export const deliveryView = z.object({
  orderId: opaqueId,
  orderCommercialId: z.string(),
  customerId: opaqueId,
  sellerUid: opaqueId,
  deliveredOn: calendarDate,
  receivedBy: z.string().max(120).nullable(),
  notes: z.string().max(500),
  confirmedAt: instant,
  confirmedBy: opaqueId,
  visitId: opaqueId,
});
export const deliverySchema = deliveryView
  .extend({ id: opaqueId, tenantId: opaqueId, schemaVersion: z.literal(1) })
  .strict()
  .refine((v) => v.id === v.orderId, 'Entrega inconsistente');
export type Delivery = z.infer<typeof deliverySchema>;
export const deliveryInput = z.strictObject({
  deliveredOn: calendarDate,
  receivedBy: z.string().trim().min(2).max(120).nullable().optional(),
  notes: z.string().trim().max(500).optional(),
});
export const orderDeliveryView = z.object({ delivery: deliveryView.nullable() });

/** Repurchase situation. The estimate is never a guaranteed date. */
export const repurchaseStatus = z.enum(['insufficient_history', 'on_track', 'overdue']);
export const repurchaseEstimate = z.object({
  /** Local date of the last confirmed commercial order. */
  lastPurchaseOn: calendarDate.nullable(),
  /** Distinct purchase days inside the lookback window. */
  purchaseCount: z.number().int().min(0),
  /** Median of the intervals between purchase days, in days. */
  frequencyDays: z.number().int().positive().nullable(),
  nextEstimatedOn: calendarDate.nullable(),
  status: repurchaseStatus,
  /** Days past the estimate (overdue) or until it (on track); null without an estimate. */
  daysFromEstimate: z.number().int().nullable(),
});
export const customerRepurchaseView = repurchaseEstimate.extend({
  customerId: opaqueId,
  /** Local date of the last effectively confirmed delivery, independent from purchases. */
  lastDeliveryOn: calendarDate.nullable(),
  lookbackDays: z.number().int().positive(),
  minimumPurchases: z.number().int().positive(),
});
export const repurchaseRow = repurchaseEstimate.extend({
  customerId: opaqueId,
  customerName: z.string(),
  sellerUid: opaqueId.nullable(),
  sellerName: z.string().nullable(),
});
export const repurchaseQuery = z.strictObject({
  ...pageQuery.shape,
  status: repurchaseStatus.optional(),
  sellerUid: z.union([opaqueId, z.literal('unassigned')]).optional(),
  q: z.string().trim().min(1).max(80).optional(),
});
export const repurchasePage = z.object({
  items: z.array(repurchaseRow),
  nextCursor: z.string().nullable(),
  totals: z.object({
    insufficient_history: z.number().int().min(0),
    on_track: z.number().int().min(0),
    overdue: z.number().int().min(0),
  }),
  lookbackDays: z.number().int().positive(),
  minimumPurchases: z.number().int().positive(),
  generatedAt: instant,
});

/** Chronological relationship history of one customer. */
export const timelineEntry = z.object({
  id: z.string(),
  type: z.enum(['visit', 'delivery', 'purchase']),
  date: calendarDate,
  responsibleUid: opaqueId.nullable(),
  responsibleName: z.string().nullable(),
  kind: visitKind.nullable(),
  notes: z.string().nullable(),
  order: z
    .object({
      id: opaqueId,
      commercialId: z.string(),
      status: orderStatus.nullable(),
      accessible: z.boolean(),
    })
    .nullable(),
});
export const timelineQuery = z.strictObject({
  limit: z
    .string()
    .regex(/^(?:[1-9][0-9]?|100)$/)
    .optional(),
});
export const customerTimelineView = z.object({
  customerId: opaqueId,
  items: z.array(timelineEntry),
  /** Older entries exist beyond the requested limit. */
  hasMore: z.boolean(),
});
