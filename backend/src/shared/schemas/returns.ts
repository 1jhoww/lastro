import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { expectedVersion, unit } from './commercial.js';
import { quantityText } from './inventory.js';
import { cents } from './orders.js';
import { MAX_SCALED } from '../../modules/inventory/quantities.js';
import { financialResult } from './finance.js';
import { pageOf, pageQuery } from './http.js';
const scaled = z.number().int().nonnegative().max(MAX_SCALED);
const positiveQuantity = quantityText.refine(
  (v) => !/^0(?:\.0+)?$/.test(v),
  'Quantidade deve ser positiva',
);
const reason = z.string().trim().min(3).max(500),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const returnLineSchema = z
  .strictObject({
    lineId: opaqueId,
    productId: opaqueId,
    unit,
    requestedScaled: scaled,
    receivedScaled: scaled,
    sellableScaled: scaled,
    damagedScaled: scaled,
    resolvedSellableScaled: scaled,
    acceptedDamagedScaled: scaled,
    rejectedDamagedScaled: scaled,
    valueResolvedCents: cents,
    damagedValueReductionCents: cents.optional(),
  })
  .refine(
    (v) =>
      v.receivedScaled === v.sellableScaled + v.damagedScaled &&
      v.receivedScaled <= v.requestedScaled &&
      v.resolvedSellableScaled <= v.sellableScaled &&
      v.acceptedDamagedScaled + v.rejectedDamagedScaled <= v.damagedScaled,
    'Quantidades de devolução inconsistentes',
  );
export const returnGuardSchema = z
  .strictObject({
    id: opaqueId,
    tenantId: opaqueId,
    orderId: opaqueId,
    lineId: opaqueId,
    productId: opaqueId,
    unit,
    expeditedScaled: scaled.positive(),
    pendingScaled: scaled,
    receivedScaled: scaled,
    sellableScaled: scaled,
    damagedScaled: scaled,
    resolvedSellableScaled: scaled,
    acceptedDamagedScaled: scaled,
    rejectedDamagedScaled: scaled,
    valueResolvedCents: cents,
    damagedValueReductionCents: cents.optional(),
    version: expectedVersion,
    lastEventId: opaqueId.nullable(),
    schemaVersion: z.literal(1),
  })
  .refine(
    (v) =>
      v.receivedScaled === v.sellableScaled + v.damagedScaled &&
      v.receivedScaled + v.pendingScaled <= v.expeditedScaled &&
      v.resolvedSellableScaled <= v.sellableScaled &&
      v.acceptedDamagedScaled + v.rejectedDamagedScaled <= v.damagedScaled,
    'Limites cumulativos de devolução inconsistentes',
  );
export const returnStatus = z.enum(['pending', 'partially_received', 'received', 'closed']);
export const returnSnapshotSchema = z.object({
  id: opaqueId,
  orderId: opaqueId,
  dispatchReference: opaqueId,
  customerId: opaqueId,
  status: returnStatus,
  lines: z.array(returnLineSchema),
  version: expectedVersion,
  reason,
  createdAt: instant,
  createdBy: opaqueId,
  updatedAt: instant,
  updatedBy: opaqueId,
});
export const returnSchema = returnSnapshotSchema
  .extend({
    tenantId: opaqueId,
    eventSequence: z.number().int().positive().safe(),
    headHash: hash,
    headEventId: opaqueId,
    schemaVersion: z.literal(1),
  })
  .strict()
  .refine((v) => new Set(v.lines.map((l) => l.lineId)).size === v.lines.length, 'Linha repetida');
export const returnEventV1Schema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  orderId: opaqueId,
  returnId: opaqueId,
  operationId: opaqueId,
  type: z.enum(['intent', 'edited', 'canceled', 'received', 'resolved']),
  sequence: z.number().int().positive().safe(),
  previousHash: hash,
  hash,
  before: returnSnapshotSchema.nullable(),
  after: returnSnapshotSchema,
  guards: z.array(returnGuardSchema),
  actorUid: opaqueId,
  occurredAt: instant,
  reason,
  requestId: z.string().uuid(),
  schemaVersion: z.literal(1),
});
export const returnEventV2Schema = returnEventV1Schema
  .omit({ before: true, after: true, guards: true })
  .extend({
    schemaVersion: z.literal(2),
    type: z.literal('resolved'),
    executionId: opaqueId,
    manifestId: opaqueId,
    rootHash: hash,
    entryCount: z.number().int().positive().safe(),
    lineCount: z.number().int().positive().safe(),
    beforeSnapshotHash: hash,
    afterSnapshotHash: hash,
    headerHash: hash,
  });
export const returnEventSchema = z.discriminatedUnion('schemaVersion', [
  returnEventV1Schema,
  returnEventV2Schema,
]);
export const returnEventView = z.union([
  returnEventV2Schema.omit({ tenantId: true }).strip(),
  returnEventV1Schema.omit({ tenantId: true, schemaVersion: true }).strip(),
]);
const requestedLines = z
  .array(z.strictObject({ lineId: opaqueId, quantity: positiveQuantity }))
  .min(1)
  .refine((v) => new Set(v.map((l) => l.lineId)).size === v.length, 'Linha repetida');
const versions = { expectedOrderVersion: expectedVersion, expectedGuardVersion: expectedVersion };
export const returnCreate = z.strictObject({ ...versions, lines: requestedLines, reason });
export const returnUpdate = z.strictObject({
  ...versions,
  expectedVersion,
  lines: requestedLines,
  reason,
});
export const returnCancel = z.strictObject({ ...versions, expectedVersion, reason });
export const returnReceive = z.strictObject({
  ...versions,
  expectedVersion,
  reason,
  lines: z
    .array(
      z
        .strictObject({
          lineId: opaqueId,
          sellableQuantity: positiveQuantity.optional(),
          damagedQuantity: positiveQuantity.optional(),
        })
        .refine(
          (v) => v.sellableQuantity !== undefined || v.damagedQuantity !== undefined,
          'Informe quantidade realmente recebida',
        ),
    )
    .min(1)
    .refine((v) => new Set(v.map((l) => l.lineId)).size === v.length, 'Linha repetida'),
});
export const returnResolve = z.strictObject({
  ...versions,
  expectedVersion,
  reason,
  disposition: z.enum(['customer_credit', 'refund']),
  damagedDecisions: z
    .array(
      z
        .strictObject({ lineId: opaqueId, accept: z.boolean(), acceptedCents: cents.optional() })
        .refine(
          (v) => v.accept || v.acceptedCents === undefined || v.acceptedCents === 0,
          'Rejeição de dano não pode aceitar valor positivo',
        ),
    )
    .refine((v) => new Set(v.map((l) => l.lineId)).size === v.length, 'Decisão repetida')
    .optional(),
});
export const returnReceiptSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  orderId: opaqueId,
  returnId: opaqueId,
  dispatchReference: opaqueId,
  actorUid: opaqueId,
  recordedAt: instant,
  reason,
  lines: z.array(
    z.strictObject({
      lineId: opaqueId,
      productId: opaqueId,
      unit,
      sellableScaled: scaled,
      damagedScaled: scaled,
      movementId: opaqueId.nullable(),
    }),
  ),
  schemaVersion: z.literal(1),
});
export const returnView = z.object({
  id: opaqueId,
  orderId: opaqueId,
  dispatchReference: opaqueId,
  customerId: opaqueId,
  status: returnStatus,
  version: expectedVersion,
  reason,
  createdAt: instant,
  createdBy: opaqueId,
  updatedAt: instant,
  updatedBy: opaqueId,
  lines: z.array(
    z.object({
      lineId: opaqueId,
      productId: opaqueId,
      unit,
      requested: quantityText,
      received: quantityText,
      pending: quantityText,
      sellableReceived: quantityText,
      damagedReceived: quantityText,
      financialResolved: quantityText,
      acceptedDamaged: quantityText,
      rejectedDamaged: quantityText,
      valueResolvedCents: cents,
      damagedValueReductionCents: cents,
    }),
  ),
});
export const returnReceiptView = z.object({
  id: opaqueId,
  orderId: opaqueId,
  returnId: opaqueId,
  dispatchReference: opaqueId,
  actorUid: opaqueId,
  recordedAt: instant,
  reason,
  lines: z.array(
    z.object({
      lineId: opaqueId,
      productId: opaqueId,
      unit,
      sellableQuantity: quantityText,
      damagedQuantity: quantityText,
      movementId: opaqueId.nullable(),
    }),
  ),
});
export const returnResult = financialResult.extend({
  returnId: opaqueId,
  returnVersion: expectedVersion,
  status: returnStatus,
});
export const returnResolutionPreview = z.object({
  returnId: opaqueId,
  ...versions,
  expectedVersion,
  lines: z.array(
    z.object({
      lineId: opaqueId,
      sellableQuantity: quantityText,
      damagedQuantity: quantityText,
      sellableCents: cents,
      damagedLimitCents: cents,
    }),
  ),
});
export const returnsQuery = z.strictObject({ ...pageQuery.shape, orderId: opaqueId.optional() });
export const returnsPage = pageOf(returnView),
  returnEventsPage = pageOf(returnEventView),
  returnReceiptsPage = pageOf(returnReceiptView);
export type Return = z.infer<typeof returnSchema>;
export type ReturnGuard = z.infer<typeof returnGuardSchema>;
