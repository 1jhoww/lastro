import { z } from 'zod';
import { businessDate as calendarDate, instant, opaqueId } from './models.js';
import { expectedVersion, unit } from './commercial.js';
import { quantityText } from './inventory.js';
import { pageOf, pageQuery } from './http.js';

/**
 * Goods given to a customer without charge. A bonus never touches `orders.lines`, receivables or
 * revenue: `order` bonuses share the id of their order and follow its lifecycle; `standalone`
 * bonuses have no order at all and leave stock when they are registered.
 */
export const bonusKind = z.enum(['order', 'standalone']);
export const bonusStatus = z.enum(['draft', 'confirmed', 'dispatched', 'canceled']);
export const bonusReason = z.enum([
  'sample',
  'campaign',
  'relationship',
  'damage_replacement',
  'other',
]);
export const MAX_BONUS_LINES = 200;

const positiveQuantity = quantityText.refine(
  (v) => !/^0(?:\.0+)?$/.test(v),
  'Quantidade deve ser positiva',
);
export const bonusLineInput = z.strictObject({ productId: opaqueId, quantity: positiveQuantity });
export const bonusLinesInput = z
  .array(bonusLineInput)
  .max(MAX_BONUS_LINES)
  .refine((v) => new Set(v.map((l) => l.productId)).size === v.length, 'Produto repetido');

const reasonDetail = z.string().trim().min(3).max(200);
const reasonValid = (v: { reason?: unknown; reasonDetail?: unknown }) =>
  v.reason === 'other' ? Boolean(v.reasonDetail) : v.reasonDetail == null;
const reasonMessage = 'Descrição obrigatória somente para o motivo Outro';

/** Bonus attached to an order draft. An empty list (or null) removes it. */
export const orderBonusInput = z
  .strictObject({
    lines: bonusLinesInput,
    reason: bonusReason.nullable().optional(),
    reasonDetail: reasonDetail.nullable().optional(),
  })
  .refine(reasonValid, reasonMessage);
export type OrderBonusInput = z.infer<typeof orderBonusInput>;

export const bonusCreate = z
  .strictObject({
    customerId: opaqueId,
    responsibleUid: opaqueId.optional(),
    lines: bonusLinesInput.min(1),
    reason: bonusReason,
    reasonDetail: reasonDetail.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine(reasonValid, reasonMessage);

export const bonusReturnInput = z
  .strictObject({
    expectedVersion,
    reason: z.string().trim().min(3).max(200),
    lines: z
      .array(
        z
          .strictObject({
            lineId: opaqueId,
            sellable: quantityText.default('0'),
            damaged: quantityText.default('0'),
          })
          .refine(
            (l) => [l.sellable, l.damaged].some((q) => !/^0(?:\.0+)?$/.test(q)),
            'Informe a quantidade que retornou',
          ),
      )
      .min(1)
      .max(MAX_BONUS_LINES)
      .refine((v) => new Set(v.map((l) => l.lineId)).size === v.length, 'Linha repetida'),
  })
  .describe(
    'Vendável volta ao saldo físico; danificado fica registrado e não movimenta estoque. Quantidades cumulativas por linha nunca excedem o que saiu.',
  );

export const bonusLineSnapshot = z.object({
  id: opaqueId,
  productId: opaqueId,
  name: z.string().max(160),
  sku: z.string().max(64),
  unit,
  quantity: quantityText,
  returnedSellable: quantityText,
  returnedDamaged: quantityText,
});
const bonusFields = {
  id: opaqueId,
  commercialId: z.string(),
  kind: bonusKind,
  orderId: opaqueId.nullable(),
  orderCommercialId: z.string().nullable(),
  customerId: opaqueId.nullable(),
  customerName: z.string().nullable(),
  responsibleUid: opaqueId,
  status: bonusStatus,
  lines: z.array(bonusLineSnapshot).max(MAX_BONUS_LINES),
  reason: bonusReason.nullable(),
  reasonDetail: z.string().max(200).nullable(),
  notes: z.string().max(1000),
  /** Confirmation of the order, or registration of a standalone bonus. Null while in draft. */
  occurredAt: instant.nullable(),
  dispatchedAt: instant.nullable(),
  canceledAt: instant.nullable(),
  canceledBy: opaqueId.nullable(),
  version: expectedVersion,
  createdAt: instant,
  createdBy: opaqueId,
  updatedAt: instant,
  updatedBy: opaqueId,
};
export const bonusView = z.object(bonusFields);
export const bonusSchema = z
  .strictObject({
    ...bonusFields,
    tenantId: opaqueId,
    /** List price of each line at the time, kept for internal use and never printed. */
    linePrices: z.record(z.string(), z.number().int().min(0)),
    schemaVersion: z.literal(1),
  })
  .refine(
    (v) =>
      v.lines.length > 0 &&
      new Set(v.lines.map((l) => l.productId)).size === v.lines.length &&
      (v.kind === 'order'
        ? v.orderId === v.id
        : v.orderId === null && v.orderCommercialId === null && v.reason !== null) &&
      (v.status === 'draft'
        ? v.kind === 'order' && v.occurredAt === null
        : v.customerId !== null || v.occurredAt === null) &&
      (v.status === 'dispatched' ? v.occurredAt !== null && v.dispatchedAt !== null : true),
    'Bonificação inconsistente',
  );
export type Bonus = z.infer<typeof bonusSchema>;
export type BonusLine = z.infer<typeof bonusLineSnapshot>;

export const bonusEventType = z.enum([
  'created',
  'edited',
  'confirmed',
  'dispatched',
  'canceled',
  'returned',
]);
export const bonusEvent = z.object({
  id: opaqueId,
  bonusId: opaqueId,
  version: expectedVersion,
  type: bonusEventType,
  status: bonusStatus,
  occurredAt: instant,
  actorUid: opaqueId,
  reason: z.string().nullable(),
  lines: z
    .array(z.strictObject({ lineId: opaqueId, sellable: quantityText, damaged: quantityText }))
    .max(MAX_BONUS_LINES),
});
export const bonusEventSchema = bonusEvent
  .extend({
    tenantId: opaqueId,
    requestId: z.string().uuid(),
    operationId: opaqueId.nullable(),
    schemaVersion: z.literal(1),
  })
  .strict();

const costMilli = z.number().int().min(0).safe();
/** Cost of each bonus line, frozen with it. Apart from `bonuses`, which sellers may read. */
export const bonusCostSnapshotSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  bonusId: opaqueId,
  lines: z.array(
    z.strictObject({
      lineId: opaqueId,
      productId: opaqueId,
      quantityScaled: z.number().int().positive(),
      unitCostMilli: costMilli.nullable(),
      source: z.enum(['average', 'reference', 'missing']),
      costCents: z.number().int().nonnegative().safe().nullable(),
    }),
  ),
  costCents: z.number().int().nonnegative().safe(),
  missingLines: z.number().int().nonnegative(),
  capturedAt: instant,
  schemaVersion: z.literal(1),
});
export type BonusCostSnapshot = z.infer<typeof bonusCostSnapshotSchema>;

/** Present only for callers holding `costs:read`, on contracts that include costs. */
export const bonusCostView = z.object({
  grossCents: z.number().int().nonnegative().safe(),
  netCents: z.number().int().nonnegative().safe(),
  missingLines: z.number().int().nonnegative(),
  lines: z.array(z.object({ lineId: opaqueId, costCents: z.number().int().nullable() })),
});
export const bonusDetailView = bonusView.extend({
  responsibleName: z.string().nullable(),
  cost: bonusCostView.nullable(),
  history: z.array(bonusEvent),
});
export const bonusesPage = pageOf(bonusView.extend({ responsibleName: z.string().nullable() }));

export const bonusQuery = z
  .strictObject({
    ...pageQuery.shape,
    kind: bonusKind.optional(),
    customerId: opaqueId.optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
  })
  .refine((v) => !(v.kind && v.customerId), 'Combine tipo ou cliente, não os dois')
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Período inválido');

export const bonusOperationSchema = z.strictObject({
  actorUid: opaqueId,
  bonusId: opaqueId,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: bonusSchema,
  createdAt: instant,
  schemaVersion: z.literal(1),
});
