import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { expectedVersion, unit, priceCents } from './commercial.js';
import { quantityText } from './inventory.js';
import { pageQuery, pageOf } from './http.js';
import { termsSnapshot, methodSnapshot } from './paymentSettings.js';
export const MAX_ORDER_CENTS = 100_000_000;
export const cents = z.number().int().min(0).max(MAX_ORDER_CENTS);
export const orderStatus = z.enum(['draft', 'confirmed', 'dispatched', 'canceled']);
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T12:00:00Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, 'Data de calendário inválida');
export const paymentInput = z
  .strictObject({
    type: z.enum(['cash', 'installments']),
    dueDates: z.array(calendarDate).min(1).max(12),
  })
  .refine(
    (v) => (v.type === 'cash' ? v.dueDates.length === 1 : v.dueDates.length >= 2),
    'Condição incompatível com o número de parcelas',
  );
export const discountInput = z
  .strictObject({
    type: z.enum(['fixed', 'percentage']),
    value: z.number().int().positive().max(MAX_ORDER_CENTS),
    reason: z.string().trim().min(3).max(200),
  })
  .refine(
    (v) => v.type !== 'percentage' || v.value <= 10_000,
    'Percentual em pontos base deve ser até 10000',
  );
export const discountApproval = discountInput.safeExtend({
  approvedBy: opaqueId,
  approvedAt: instant,
  approvedVersion: expectedVersion,
  fingerprint: z.string(),
  beforeCents: cents,
  afterCents: cents,
});
export const lineInput = z.strictObject({
  productId: opaqueId,
  quantity: quantityText
    .refine((v) => !/^0(?:\.0+)?$/.test(v), 'Quantidade deve ser positiva')
    .describe('Quantidade positiva, compatível com a precisão da unidade; sem mínimo comercial.'),
});
export const linesInput = z
  .array(lineInput)
  .refine((v) => new Set(v.map((l) => l.productId)).size === v.length, 'Produto repetido')
  .describe(
    'Produtos distintos, sem teto comercial de linhas. Rascunho admite array vazio; confirmação exige pelo menos uma linha válida. Limites técnicos de bytes e transação continuam aplicáveis.',
  );
export const orderCreate = z
  .strictObject({
    customerId: opaqueId.nullable().optional(),
    sellerUid: opaqueId.optional(),
    lines: linesInput.optional(),
    payment: paymentInput.nullable().optional(),
    notes: z.string().trim().max(1000).optional(),
    discount: discountInput.optional(),
    paymentConditionId: opaqueId.nullable().optional(),
    paymentConditionVersion: expectedVersion.optional(),
    intendedPaymentMethodId: opaqueId.nullable().optional(),
    intendedPaymentMethodVersion: expectedVersion.optional(),
  })
  .refine(paymentSelectionValid, 'Seleção de pagamento exige ID e versão correspondentes');
export const orderUpdate = z
  .strictObject({
    expectedVersion,
    customerId: opaqueId.nullable().optional(),
    sellerUid: opaqueId.optional(),
    lines: linesInput.optional(),
    payment: paymentInput.nullable().optional(),
    notes: z.string().trim().max(1000).optional(),
    discount: discountInput.nullable().optional(),
    paymentConditionId: opaqueId.nullable().optional(),
    paymentConditionVersion: expectedVersion.optional(),
    intendedPaymentMethodId: opaqueId.nullable().optional(),
    intendedPaymentMethodVersion: expectedVersion.optional(),
  })
  .refine(paymentSelectionValid, 'Seleção de pagamento exige ID e versão correspondentes');
function paymentSelectionValid(v: {
  paymentConditionId?: string | null | undefined;
  paymentConditionVersion?: number | undefined;
  intendedPaymentMethodId?: string | null | undefined;
  intendedPaymentMethodVersion?: number | undefined;
  payment?: unknown;
}) {
  return (
    (typeof v.paymentConditionId === 'string') === (v.paymentConditionVersion !== undefined) &&
    (typeof v.intendedPaymentMethodId === 'string') ===
      (v.intendedPaymentMethodVersion !== undefined) &&
    !(v.payment && v.paymentConditionId)
  );
}
export const orderCommand = z.strictObject({ expectedVersion });
export const cancelCommand = orderCommand.extend({ reason: z.string().trim().min(3).max(200) });
export const lineSnapshot = z.object({
  id: opaqueId,
  productId: opaqueId,
  name: z.string().max(160),
  sku: z.string().max(64),
  description: z.string().max(2000),
  unit,
  quantity: quantityText,
  unitPriceCents: priceCents,
  subtotalCents: cents,
  discountCents: cents,
  totalCents: cents,
});
export const installment = z.object({
  id: opaqueId,
  orderId: opaqueId,
  number: z.number().int().min(1).max(12),
  amountCents: cents,
  dueDate: calendarDate,
});
export const orderView = z.object({
  id: opaqueId,
  commercialId: z.string(),
  customerId: opaqueId.nullable(),
  customerName: z.string().nullable(),
  sellerUid: opaqueId,
  status: orderStatus,
  lines: z.array(lineSnapshot),
  subtotalCents: cents,
  discountCents: cents,
  totalCents: cents,
  discount: discountApproval.nullable(),
  payment: paymentInput.nullable(),
  paymentTerms: termsSnapshot.optional(),
  intendedPaymentMethod: methodSnapshot.optional(),
  installments: z.array(installment).max(12),
  notes: z.string().max(1000),
  version: expectedVersion,
  createdAt: instant,
  updatedAt: instant,
  createdBy: opaqueId,
  updatedBy: opaqueId,
  confirmedAt: instant.nullable(),
  confirmedBy: opaqueId.nullable(),
  dispatchedAt: instant.nullable(),
  dispatchedBy: opaqueId.nullable(),
  canceledAt: instant.nullable(),
  canceledBy: opaqueId.nullable(),
  dispatchReference: opaqueId.nullable(),
});
export const orderSchema = orderView
  .extend({ tenantId: opaqueId, schemaVersion: z.literal(1) })
  .strict()
  .refine(
    (v) =>
      v.lines.reduce((a, l) => a + l.subtotalCents, 0) === v.subtotalCents &&
      v.lines.reduce((a, l) => a + l.discountCents, 0) === v.discountCents &&
      v.lines.every((l) => l.totalCents === l.subtotalCents - l.discountCents) &&
      v.totalCents === v.subtotalCents - v.discountCents &&
      (v.payment === null ||
        v.installments.reduce((a, p) => a + p.amountCents, 0) === v.totalCents) &&
      v.installments.every(
        (p, i) => p.orderId === v.id && p.number === i + 1 && p.dueDate === v.payment?.dueDates[i],
      ) &&
      v.installments.length === (v.payment?.dueDates.length ?? 0) &&
      (v.payment !== null || v.installments.length === 0) &&
      (v.status === 'draft' ||
        (v.status === 'canceled' && v.confirmedAt === null) ||
        (v.customerId !== null && v.payment !== null && v.lines.length > 0 && v.totalCents > 0)) &&
      new Set(v.lines.map((l) => l.productId)).size === v.lines.length,
    'Pedido inconsistente',
  );
export const orderEvent = z.object({
  id: opaqueId,
  orderId: opaqueId,
  version: expectedVersion,
  type: z.enum(['created', 'edited', 'confirmed', 'dispatched', 'canceled', 'due_date_changed']),
  previousStatus: orderStatus.nullable(),
  status: orderStatus,
  occurredAt: instant,
  actorUid: opaqueId,
  reason: z.string().nullable(),
  requestId: z.string().uuid(),
  operationId: opaqueId.nullable(),
});
export const orderEventSchema = orderEvent
  .extend({ tenantId: opaqueId, schemaVersion: z.literal(1) })
  .strict();
export const orderQuery = z.strictObject({
  ...pageQuery.shape,
  status: orderStatus.optional(),
  customerId: opaqueId.optional(),
  direction: z.enum(['asc', 'desc']).optional(),
});
export const ordersPage = pageOf(orderView);
export const eventsPage = pageOf(orderEvent);
export const paymentPreviewInput = z
  .strictObject({
    expectedVersion,
    paymentConditionId: opaqueId,
    paymentConditionVersion: expectedVersion,
    intendedPaymentMethodId: opaqueId.optional(),
    intendedPaymentMethodVersion: expectedVersion.optional(),
  })
  .refine(
    (v) =>
      (v.intendedPaymentMethodId !== undefined) === (v.intendedPaymentMethodVersion !== undefined),
    'Forma exige ID e versão',
  );
export const paymentPreviewView = z.object({
  orderId: opaqueId,
  orderVersion: expectedVersion,
  subtotalCents: cents,
  discountCents: cents,
  totalCents: cents,
  paymentTerms: termsSnapshot,
  intendedPaymentMethod: methodSnapshot.nullable(),
  installments: z.array(installment).min(1).max(12),
  discountRequiresApproval: z.boolean(),
});
export const stockReservationSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  orderId: opaqueId,
  lineId: opaqueId,
  productId: opaqueId,
  unit,
  quantityScaled: z.number().int().positive().max(1_000_000_000_000),
  status: z.enum(['reserved', 'dispatched', 'released']),
  createdAt: instant,
  updatedAt: instant,
  operationId: opaqueId,
  schemaVersion: z.literal(1),
});
export type Order = z.infer<typeof orderSchema>;
export const orderOperationSchema = z.strictObject({
  actorUid: opaqueId,
  orderId: opaqueId,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: orderSchema,
  createdAt: instant,
  schemaVersion: z.literal(1),
});
export type OrderLine = z.infer<typeof lineSnapshot>;
export type Discount = z.infer<typeof discountInput>;
