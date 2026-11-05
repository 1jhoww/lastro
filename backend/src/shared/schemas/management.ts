import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { expectedVersion, priceCents, unit } from './commercial.js';
import { quantityText } from './inventory.js';
import { calendarDate, cents, MAX_ORDER_CENTS } from './orders.js';
import { methodSnapshot, schedule } from './paymentSettings.js';
import { pageOf, pageQuery } from './http.js';

/** Schemas of the Lastro Gestão modules: costs, purchases, payables and consolidated finance. */
const positiveCents = cents.refine((v) => v > 0, 'Valor deve ser positivo');
const positiveQuantity = quantityText.refine(
  (v) => !/^0(?:\.0+)?$/.test(v),
  'Quantidade deve ser positiva',
);
const reason = z.string().trim().min(3).max(500);
const notes = z.string().trim().max(1000);
/** Unit cost in thousandths of a cent, so weighted averages do not accumulate rounding. */
const costMilli = z.number().int().nonnegative().safe();
const signedCents = z.number().int().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/* ---------- Product costs ---------- */

export const productCostSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  referenceCostCents: priceCents.nullable(),
  averageCostMilli: costMilli.nullable(),
  lastPurchaseCostMilli: costMilli.nullable(),
  lastReceiptId: opaqueId.nullable(),
  version: expectedVersion,
  updatedAt: instant,
  updatedBy: opaqueId,
  schemaVersion: z.literal(1),
});
export const productCostView = z.object({
  productId: opaqueId,
  priceCents,
  referenceCostCents: priceCents.nullable(),
  averageCostCents: priceCents.nullable(),
  lastPurchaseCostCents: priceCents.nullable(),
  /** Cost the margin below was calculated from. */
  costBasis: z.enum(['average', 'reference']).nullable(),
  unitGrossProfitCents: signedCents.nullable(),
  /** Gross margin over the sale price, in basis points (4714 = 47,14%). */
  grossMarginBp: z.number().int().nullable(),
  version: z.number().int().min(0),
  updatedAt: instant.nullable(),
});
export const productCostUpdate = z.strictObject({
  expectedVersion: z.number().int().min(0),
  referenceCostCents: priceCents.nullable(),
  reason: reason.optional(),
});
export const costEventType = z.enum(['reference_updated', 'purchase_received', 'receipt_reversed']);
const costPosition = z.object({
  referenceCostCents: priceCents.nullable(),
  averageCostMilli: costMilli.nullable(),
  lastPurchaseCostMilli: costMilli.nullable(),
});
export const productCostEventSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  productId: opaqueId,
  type: costEventType,
  previous: costPosition,
  next: costPosition,
  quantityScaled: z.number().int().positive().nullable(),
  valueCents: cents.nullable(),
  unitCostMilli: costMilli.nullable(),
  purchaseId: opaqueId.nullable(),
  receiptId: opaqueId.nullable(),
  reason: z.string().max(500).nullable(),
  actorUid: opaqueId,
  occurredAt: instant,
  requestId: z.string().uuid(),
  schemaVersion: z.literal(1),
});
export const productCostEventView = z.object({
  id: opaqueId,
  productId: opaqueId,
  type: costEventType,
  referenceCostCents: priceCents.nullable(),
  averageCostCents: priceCents.nullable(),
  lastPurchaseCostCents: priceCents.nullable(),
  previousAverageCostCents: priceCents.nullable(),
  quantity: quantityText.nullable(),
  unitCostCents: priceCents.nullable(),
  purchaseId: opaqueId.nullable(),
  reason: z.string().nullable(),
  actorUid: opaqueId,
  occurredAt: instant,
});
export const productCostEventsPage = pageOf(productCostEventView);
export const costSuggestionView = z.object({
  productId: opaqueId,
  suggestedUnitCostCents: priceCents.nullable(),
});
/** Cost of each sold line, frozen at the confirmation of the order. */
export const orderCostSnapshotSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  orderId: opaqueId,
  lines: z.array(
    z.strictObject({
      lineId: opaqueId,
      productId: opaqueId,
      quantityScaled: z.number().int().positive(),
      unitCostMilli: costMilli.nullable(),
      source: z.enum(['average', 'reference', 'missing']),
      costCents: cents.nullable(),
    }),
  ),
  costCents: z.number().int().nonnegative().safe(),
  missingLines: z.number().int().nonnegative(),
  capturedAt: instant,
  schemaVersion: z.literal(1),
});
export type OrderCostSnapshot = z.infer<typeof orderCostSnapshotSchema>;
export type ProductCost = z.infer<typeof productCostSchema>;

/* ---------- Purchase orders ---------- */

export const purchaseStatus = z.enum([
  'draft',
  'confirmed',
  'partially_received',
  'received',
  /** Partially received, with the remaining balance closed: nothing more arrives. */
  'closed',
  'canceled',
]);
export const MAX_PURCHASE_LINES = 200;
export const purchaseLineInput = z.strictObject({
  productId: opaqueId,
  quantity: positiveQuantity,
  unitCostCents: priceCents,
  discountCents: cents.optional(),
});
const purchaseLinesInput = z
  .array(purchaseLineInput)
  .max(MAX_PURCHASE_LINES)
  .refine((v) => new Set(v.map((l) => l.productId)).size === v.length, 'Produto repetido');
const purchaseFields = {
  supplierId: opaqueId.nullable().optional(),
  purchaseDate: calendarDate.optional(),
  expectedDeliveryDate: calendarDate.nullable().optional(),
  paymentConditionId: opaqueId.nullable().optional(),
  paymentConditionVersion: expectedVersion.nullable().optional(),
  notes: notes.optional(),
  lines: purchaseLinesInput.optional(),
  freightCents: cents.optional(),
  otherCostsCents: cents.optional(),
  discountCents: cents.optional(),
};
export const purchaseCreate = z.strictObject(purchaseFields);
export const purchaseUpdate = z.strictObject({ ...purchaseFields, expectedVersion });
export const purchaseCommand = z.strictObject({ expectedVersion });
export const purchaseReasonCommand = z.strictObject({ expectedVersion, reason });
export const installmentInput = z.strictObject({
  amountCents: positiveCents,
  dueDate: calendarDate,
});
export const purchaseConfirm = z.strictObject({
  expectedVersion,
  /** Adjusted installments; omitted uses the payment condition as it is. */
  installments: z.array(installmentInput).min(1).max(12).optional(),
});
export const purchaseAmendment = z
  .strictObject({
    expectedVersion,
    expectedDeliveryDate: calendarDate.nullable().optional(),
    notes: notes.optional(),
    reason,
  })
  .refine(
    (v) => v.expectedDeliveryDate !== undefined || v.notes !== undefined,
    'Informe o que deve ser alterado',
  );
export const purchasePreviewInput = z.strictObject({
  paymentConditionId: opaqueId,
  paymentConditionVersion: expectedVersion,
});
export const purchaseInstallment = z.object({
  number: z.number().int().min(1).max(12),
  amountCents: cents,
  dueDate: calendarDate,
  payableId: opaqueId.nullable(),
});
export const purchasePreviewView = z.object({
  totalCents: cents,
  installments: z.array(purchaseInstallment).min(1).max(12),
});
export const purchaseLine = z.object({
  id: opaqueId,
  productId: opaqueId,
  name: z.string().max(160),
  sku: z.string().max(64),
  unit,
  quantity: quantityText,
  suggestedUnitCostCents: priceCents.nullable(),
  unitCostCents: priceCents,
  subtotalCents: cents,
  discountCents: cents,
  totalCents: cents,
  /** Share of freight, other costs and order discount; zero until confirmation. */
  allocatedCents: signedCents,
  /** Value this line brings into stock when fully received. */
  landedCents: cents,
  receivedQuantity: quantityText,
  pendingQuantity: quantityText,
  receivedValueCents: cents,
  /** What the supplier will not deliver, fixed when the pending balance is closed. */
  undeliveredQuantity: quantityText.default('0'),
});
export const closureTreatment = z.enum(['abatement', 'full_charge', 'supplier_credit']);
export const supplierCreditKind = z.enum(['credit', 'recoverable']);
export const purchaseClosureSummary = z.object({
  id: opaqueId,
  treatment: closureTreatment,
  undeliveredValueCents: cents,
  abatedCents: cents,
  excessCents: cents,
  creditId: opaqueId.nullable(),
  closedOn: calendarDate,
  closedAt: instant,
  closedBy: opaqueId,
  reason: z.string().max(500),
});
const purchaseShape = {
  id: opaqueId,
  number: z.number().int().positive(),
  commercialId: z.string(),
  supplierId: opaqueId.nullable(),
  supplierName: z.string().nullable(),
  supplierDocument: z.string().nullable(),
  purchaseDate: calendarDate,
  expectedDeliveryDate: calendarDate.nullable(),
  paymentCondition: z
    .object({ id: opaqueId, version: expectedVersion, name: z.string(), schedule })
    .nullable(),
  notes: z.string().max(1000),
  status: purchaseStatus,
  pendingReceipt: z.boolean(),
  responsibleUid: opaqueId,
  lines: z.array(purchaseLine).max(MAX_PURCHASE_LINES),
  subtotalCents: cents,
  lineDiscountCents: cents,
  freightCents: cents,
  otherCostsCents: cents,
  discountCents: cents,
  totalCents: cents,
  installments: z.array(purchaseInstallment).max(12),
  /** Bumped on reopening so a later confirmation issues new titles, never the same ones. */
  titleGeneration: z.number().int().min(1),
  receiptCount: z.number().int().min(0),
  version: expectedVersion,
  createdAt: instant,
  updatedAt: instant,
  createdBy: opaqueId,
  updatedBy: opaqueId,
  confirmedAt: instant.nullable(),
  confirmedBy: opaqueId.nullable(),
  canceledAt: instant.nullable(),
  canceledBy: opaqueId.nullable(),
  cancelReason: z.string().max(500).nullable(),
  closure: purchaseClosureSummary.nullable().default(null),
};
const purchaseConsistent = (v: {
  lines: { subtotalCents: number; discountCents: number; totalCents: number }[];
  subtotalCents: number;
  lineDiscountCents: number;
  freightCents: number;
  otherCostsCents: number;
  discountCents: number;
  totalCents: number;
  status: string;
  installments: { amountCents: number }[];
}) =>
  v.lines.reduce((a, l) => a + l.subtotalCents, 0) === v.subtotalCents &&
  v.lines.reduce((a, l) => a + l.discountCents, 0) === v.lineDiscountCents &&
  v.lines.every((l) => l.totalCents === l.subtotalCents - l.discountCents) &&
  v.totalCents ===
    v.subtotalCents - v.lineDiscountCents + v.freightCents + v.otherCostsCents - v.discountCents &&
  (v.status === 'draft' ||
    v.status === 'canceled' ||
    v.installments.reduce((a, p) => a + p.amountCents, 0) === v.totalCents);
export const purchaseView = z.object(purchaseShape);
export const purchaseSchema = z
  .strictObject({ ...purchaseShape, tenantId: opaqueId, schemaVersion: z.literal(1) })
  .refine(purchaseConsistent, 'Compra inconsistente');
export const purchasesPage = pageOf(purchaseView);
// The status already says whether goods are pending, so the two never travel together.
export const purchaseQuery = z
  .strictObject({
    ...pageQuery.shape,
    status: purchaseStatus.optional(),
    supplierId: opaqueId.optional(),
    pendingReceipt: z.enum(['true']).optional(),
  })
  .refine((v) => !v.status || !v.pendingReceipt, 'Use a situação ou o filtro de pendentes');
export const purchaseCounterSchema = z.strictObject({
  last: z.number().int().min(0),
  schemaVersion: z.literal(1),
});
export const purchaseEvent = z.object({
  id: opaqueId,
  purchaseId: opaqueId,
  version: expectedVersion,
  type: z.enum([
    'created',
    'edited',
    'confirmed',
    'amended',
    'reopened',
    'received',
    'receipt_reversed',
    'closed',
    'canceled',
  ]),
  previousStatus: purchaseStatus.nullable(),
  status: purchaseStatus,
  reason: z.string().nullable(),
  actorUid: opaqueId,
  occurredAt: instant,
  requestId: z.string().uuid(),
});
export const purchaseEventSchema = purchaseEvent
  .extend({ tenantId: opaqueId, schemaVersion: z.literal(1) })
  .strict();
export const purchaseEventsPage = pageOf(purchaseEvent);
export const receiptInput = z
  .strictObject({
    expectedVersion,
    receivedOn: calendarDate,
    notes: notes.optional(),
    items: z.array(z.strictObject({ lineId: opaqueId, quantity: positiveQuantity })).min(1),
  })
  .refine(
    (v) => new Set(v.items.map((i) => i.lineId)).size === v.items.length,
    'Item repetido no recebimento',
  );
export const receiptReversalInput = z.strictObject({ reason });
export const receiptItem = z.object({
  lineId: opaqueId,
  productId: opaqueId,
  name: z.string(),
  sku: z.string(),
  unit,
  quantity: quantityText,
  valueCents: cents,
  movementId: opaqueId,
  reversalMovementId: opaqueId.nullable(),
});
const receiptShape = {
  id: opaqueId,
  purchaseId: opaqueId,
  number: z.number().int().positive(),
  receivedOn: calendarDate,
  notes: z.string().max(1000),
  items: z.array(receiptItem).min(1),
  status: z.enum(['active', 'reversed']),
  reversedAt: instant.nullable(),
  reversedBy: opaqueId.nullable(),
  reversalReason: z.string().max(500).nullable(),
  createdAt: instant,
  createdBy: opaqueId,
};
export const receiptView = z.object(receiptShape);
export const receiptSchema = z.strictObject({
  ...receiptShape,
  /** Stored with the last cost each item replaced, so a reversal can restore it. */
  items: z.array(receiptItem.extend({ previousLastCostMilli: costMilli.nullable() })).min(1),
  tenantId: opaqueId,
  requestId: z.string().uuid(),
  operationId: hash,
  schemaVersion: z.literal(1),
});
export const receiptsPage = pageOf(receiptView);
export const receiptResult = z.object({ purchase: purchaseView, receipt: receiptView });
export type Purchase = z.infer<typeof purchaseSchema>;
export type PurchaseLine = z.infer<typeof purchaseLine>;
export type PurchaseReceipt = z.infer<typeof receiptSchema>;

/* ---------- Closing the pending balance ---------- */

export const purchaseClosurePreviewInput = z.strictObject({ treatment: closureTreatment });
export const purchaseClosureInput = z.strictObject({
  expectedVersion,
  treatment: closureTreatment,
  reason,
  notes: notes.optional(),
  /** Required when titles already paid exceed what was delivered. */
  excessAs: supplierCreditKind.optional(),
  /** Figures the user agreed to; anything else since the preview refuses the command. */
  expectedUndeliveredCents: cents,
  expectedExcessCents: cents,
});
const closureItem = z.object({
  lineId: opaqueId,
  productId: opaqueId,
  name: z.string(),
  sku: z.string(),
  unit,
  orderedQuantity: quantityText,
  receivedQuantity: quantityText,
  undeliveredQuantity: quantityText,
  undeliveredValueCents: cents,
});
const closureTitle = z.object({
  payableId: opaqueId,
  installmentNumber: z.number().int().min(1).max(12).nullable(),
  dueDate: calendarDate,
  outstandingBeforeCents: cents,
  abatedCents: cents,
  outstandingAfterCents: cents,
});
const closureImpactShape = {
  treatment: closureTreatment,
  undeliveredValueCents: cents,
  /** Open balance of the titles and what was already paid on them, before closing. */
  openBalanceCents: cents,
  paidCents: cents,
  abatedCents: cents,
  /** Value delivered less than paid: only an abatement can leave it. */
  excessCents: cents,
  /** Value recorded for the supplier to settle: the excess or the agreed credit. */
  creditCents: cents,
  items: z.array(closureItem),
  titles: z.array(closureTitle),
};
export const purchaseClosureImpact = z.object(closureImpactShape);
const closureShape = {
  ...closureImpactShape,
  id: opaqueId,
  purchaseId: opaqueId,
  excessAs: supplierCreditKind.nullable(),
  creditId: opaqueId.nullable(),
  reason: z.string().max(500),
  notes: z.string().max(1000),
  closedOn: calendarDate,
  closedAt: instant,
  closedBy: opaqueId,
};
export const purchaseClosureView = z.object(closureShape);
export const purchaseClosureSchema = z.strictObject({
  ...closureShape,
  tenantId: opaqueId,
  requestId: z.string().uuid(),
  operationId: hash,
  schemaVersion: z.literal(1),
});
export const purchaseClosureResult = z.object({
  purchase: purchaseView,
  closure: purchaseClosureView,
});
export type PurchaseClosure = z.infer<typeof purchaseClosureSchema>;

/* ---------- Accounts payable ---------- */

export const payableOrigin = z.enum(['purchase', 'expense', 'recurring', 'manual']);
export const payableStatus = z.enum(['open', 'partially_paid', 'paid', 'canceled']);
export const payableSituation = z.enum(['open', 'partially_paid', 'paid', 'overdue', 'canceled']);
const payableShape = {
  id: opaqueId,
  beneficiaryId: opaqueId.nullable(),
  beneficiaryName: z.string().max(160).nullable(),
  description: z.string().min(2).max(200),
  categoryId: opaqueId.nullable(),
  categoryName: z.string().max(100).nullable(),
  origin: payableOrigin,
  originReference: opaqueId.nullable(),
  installmentNumber: z.number().int().min(1).max(12).nullable(),
  installmentCount: z.number().int().min(1).max(12).nullable(),
  originalCents: cents,
  paidCents: cents,
  canceledCents: cents,
  outstandingCents: cents,
  issueDate: calendarDate,
  /** Date the expense belongs to in the accrual view of the results. */
  competenceDate: calendarDate,
  dueDate: calendarDate,
  /** Date of the payment that settled the title. */
  paidOn: calendarDate.nullable(),
  status: payableStatus,
  hasBalance: z.boolean(),
  notes: z.string().max(1000),
  paymentCount: z.number().int().min(0),
  version: expectedVersion,
  createdAt: instant,
  updatedAt: instant,
  createdBy: opaqueId,
  updatedBy: opaqueId,
  canceledAt: instant.nullable(),
  cancelReason: z.string().max(500).nullable(),
};
export const payableSchema = z
  .strictObject({ ...payableShape, tenantId: opaqueId, schemaVersion: z.literal(1) })
  .refine(
    (v) =>
      v.originalCents === v.outstandingCents + v.paidCents + v.canceledCents &&
      v.hasBalance === v.outstandingCents > 0,
    'Título inconsistente',
  );
export const payableView = z.object({ ...payableShape, situation: payableSituation });
export const payablesPage = pageOf(payableView);
// One filter besides the situation: each combination would be one more index on every title write.
export const payableQuery = z
  .strictObject({
    ...pageQuery.shape,
    situation: z.enum(['open', 'overdue', 'paid', 'canceled', 'all']).optional(),
    beneficiaryId: opaqueId.optional(),
    categoryId: opaqueId.optional(),
    origin: payableOrigin.optional(),
    originReference: opaqueId.optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
  })
  .refine(
    (v) => [v.beneficiaryId, v.categoryId, v.origin, v.originReference].filter(Boolean).length <= 1,
    'Use apenas um filtro além da situação',
  );
export const payableCreate = z.strictObject({
  kind: z.enum(['expense', 'manual']),
  beneficiaryId: opaqueId.nullable().optional(),
  beneficiaryName: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(2).max(200),
  categoryId: opaqueId.nullable().optional(),
  amountCents: positiveCents,
  issueDate: calendarDate.optional(),
  dueDate: calendarDate,
  notes: notes.optional(),
});
export const payableUpdate = z.strictObject({
  expectedVersion,
  beneficiaryId: opaqueId.nullable().optional(),
  beneficiaryName: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(2).max(200).optional(),
  categoryId: opaqueId.nullable().optional(),
  amountCents: positiveCents.optional(),
  dueDate: calendarDate.optional(),
  notes: notes.optional(),
  reason,
});
export const payableCancel = z.strictObject({ expectedVersion, reason });
export const payablePaymentInput = z.strictObject({
  expectedVersion,
  /** Amount taken off the open balance. */
  principalCents: positiveCents,
  interestCents: cents.optional(),
  penaltyCents: cents.optional(),
  discountCents: cents.optional(),
  paidOn: calendarDate,
  methodId: opaqueId,
  methodVersion: expectedVersion,
  notes: notes.optional(),
});
const payablePaymentShape = {
  id: opaqueId,
  payableId: opaqueId,
  beneficiaryName: z.string().nullable(),
  description: z.string(),
  origin: payableOrigin,
  principalCents: positiveCents,
  interestCents: cents,
  penaltyCents: cents,
  discountCents: cents,
  /** Money that left the company: principal + interest + penalty - discount. */
  cashCents: cents,
  paidOn: calendarDate,
  method: methodSnapshot,
  notes: z.string().max(1000),
  status: z.enum(['active', 'reversed']),
  recordedAt: instant,
  createdBy: opaqueId,
  reversedAt: instant.nullable(),
  reversedBy: opaqueId.nullable(),
  reversalReason: z.string().max(500).nullable(),
};
export const payablePaymentView = z.object(payablePaymentShape);
export const payablePaymentSchema = z
  .strictObject({
    ...payablePaymentShape,
    tenantId: opaqueId,
    requestId: z.string().uuid(),
    schemaVersion: z.literal(1),
  })
  .refine(
    (v) => v.cashCents === v.principalCents + v.interestCents + v.penaltyCents - v.discountCents,
    'Pagamento inconsistente',
  );
export const payablePaymentsPage = pageOf(payablePaymentView);
export const payablePaymentResult = z.object({
  payable: payableView,
  payment: payablePaymentView,
});
export const paymentReversalInput = z.strictObject({ reason });
export const payablePaymentQuery = z.strictObject({
  ...pageQuery.shape,
  payableId: opaqueId.optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
});
export type Payable = z.infer<typeof payableSchema>;
export type PayablePayment = z.infer<typeof payablePaymentSchema>;

/* ---------- Supplier credits ---------- */

const supplierCreditShape = {
  id: opaqueId,
  supplierId: opaqueId,
  supplierName: z.string().max(160),
  purchaseId: opaqueId,
  purchaseCode: z.string(),
  closureId: opaqueId,
  /** `credit` is used on future titles; `recoverable` is money the supplier should return. */
  kind: supplierCreditKind,
  originalCents: cents,
  appliedCents: cents,
  recoveredCents: cents,
  balanceCents: cents,
  hasBalance: z.boolean(),
  status: z.enum(['open', 'settled']),
  issuedOn: calendarDate,
  version: expectedVersion,
  createdAt: instant,
  updatedAt: instant,
  createdBy: opaqueId,
  updatedBy: opaqueId,
};
export const supplierCreditView = z.object(supplierCreditShape);
export const supplierCreditSchema = z
  .strictObject({ ...supplierCreditShape, tenantId: opaqueId, schemaVersion: z.literal(1) })
  .refine(
    (v) =>
      v.originalCents === v.balanceCents + v.appliedCents + v.recoveredCents &&
      v.hasBalance === v.balanceCents > 0 &&
      (v.status === 'open') === v.hasBalance,
    'Crédito inconsistente',
  );
export const supplierCreditsPage = pageOf(supplierCreditView);
export const supplierCreditQuery = z.strictObject({
  ...pageQuery.shape,
  status: z.enum(['open', 'settled', 'all']).optional(),
});
const creditMovementShape = {
  id: opaqueId,
  creditId: opaqueId,
  supplierId: opaqueId,
  /** `applied` lowers a title without moving money; `recovered` is cash coming back. */
  type: z.enum(['applied', 'recovered']),
  amountCents: positiveCents,
  date: calendarDate,
  payableId: opaqueId.nullable(),
  payableDescription: z.string().nullable(),
  notes: z.string().max(1000),
  status: z.enum(['active', 'reversed']),
  recordedAt: instant,
  createdBy: opaqueId,
  reversedAt: instant.nullable(),
  reversedBy: opaqueId.nullable(),
  reversalReason: z.string().max(500).nullable(),
};
export const supplierCreditMovementView = z.object(creditMovementShape);
export const supplierCreditMovementSchema = z.strictObject({
  ...creditMovementShape,
  tenantId: opaqueId,
  requestId: z.string().uuid(),
  schemaVersion: z.literal(1),
});
export const supplierCreditMovements = z.object({ items: z.array(supplierCreditMovementView) });
export const supplierCreditApplication = z.strictObject({
  expectedVersion,
  payableId: opaqueId,
  amountCents: positiveCents,
  notes: notes.optional(),
});
export const supplierCreditRecovery = z.strictObject({
  expectedVersion,
  amountCents: positiveCents,
  recoveredOn: calendarDate,
  notes: notes.optional(),
});
export const supplierCreditReversal = z.strictObject({ reason });
export const supplierCreditResult = z.object({
  credit: supplierCreditView,
  movement: supplierCreditMovementView,
});
export type SupplierCredit = z.infer<typeof supplierCreditSchema>;
export type SupplierCreditMovement = z.infer<typeof supplierCreditMovementSchema>;

/* ---------- Expense categories ---------- */

const categoryName = z.string().trim().min(2).max(100);
const categoryShape = {
  id: opaqueId,
  name: categoryName,
  status: z.enum(['active', 'inactive']),
  version: expectedVersion,
  createdAt: instant,
  updatedAt: instant,
  createdBy: opaqueId,
  updatedBy: opaqueId,
};
export const expenseCategoryView = z.object(categoryShape);
export const expenseCategorySchema = z.strictObject({
  ...categoryShape,
  tenantId: opaqueId,
  nameKey: z.string(),
  schemaVersion: z.literal(1),
});
export const expenseCategoriesPage = pageOf(expenseCategoryView);
export const expenseCategoryCreate = z.strictObject({ name: categoryName });
export const expenseCategoryUpdate = z.strictObject({
  expectedVersion,
  name: categoryName.optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
export const expenseCategoryQuery = z.strictObject({
  ...pageQuery.shape,
  status: z.enum(['active', 'inactive', 'all']).optional(),
});
export const seededCategories = z.object({ created: z.number().int().min(0) });
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

/* ---------- Recurring expenses ---------- */

export const frequency = z.enum(['monthly', 'quarterly', 'yearly']);
const recurringShape = {
  id: opaqueId,
  description: z.string().min(2).max(200),
  amountCents: positiveCents,
  categoryId: opaqueId.nullable(),
  categoryName: z.string().nullable(),
  beneficiaryId: opaqueId.nullable(),
  beneficiaryName: z.string().max(160).nullable(),
  frequency,
  /** Day of the due date; months without it fall on their last day. */
  dueDay: z.number().int().min(1).max(31),
  startDate: calendarDate,
  endDate: calendarDate.nullable(),
  status: z.enum(['active', 'paused', 'ended']),
  /** Last due date already issued or deliberately skipped. */
  generatedThrough: calendarDate.nullable(),
  notes: z.string().max(1000),
  version: expectedVersion,
  createdAt: instant,
  updatedAt: instant,
  createdBy: opaqueId,
  updatedBy: opaqueId,
};
export const recurringExpenseView = z.object({
  ...recurringShape,
  nextDueDate: calendarDate.nullable(),
});
export const recurringExpenseSchema = z.strictObject({
  ...recurringShape,
  tenantId: opaqueId,
  schemaVersion: z.literal(1),
});
export const recurringExpensesPage = pageOf(recurringExpenseView);
export const recurringExpenseQuery = z.strictObject({
  ...pageQuery.shape,
  status: z.enum(['active', 'paused', 'ended']).optional(),
});
export const recurringExpenseCreate = z
  .strictObject({
    description: z.string().trim().min(2).max(200),
    amountCents: positiveCents,
    categoryId: opaqueId.nullable().optional(),
    beneficiaryId: opaqueId.nullable().optional(),
    beneficiaryName: z.string().trim().max(160).nullable().optional(),
    frequency,
    dueDay: z.number().int().min(1).max(31),
    startDate: calendarDate,
    endDate: calendarDate.nullable().optional(),
    notes: notes.optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, 'Término antes do início');
export const recurringExpenseUpdate = z.strictObject({
  expectedVersion,
  description: z.string().trim().min(2).max(200).optional(),
  amountCents: positiveCents.optional(),
  categoryId: opaqueId.nullable().optional(),
  beneficiaryId: opaqueId.nullable().optional(),
  beneficiaryName: z.string().trim().max(160).nullable().optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  endDate: calendarDate.nullable().optional(),
  notes: notes.optional(),
});
export const recurringExpenseCommand = z.strictObject({
  expectedVersion,
  action: z.enum(['pause', 'resume', 'end']),
});
export const recurringGeneration = z.object({
  examined: z.number().int().min(0),
  created: z.number().int().min(0),
  failed: z.number().int().min(0),
});
export type RecurringExpense = z.infer<typeof recurringExpenseSchema>;

/* ---------- Consolidated finance ---------- */

export const financeSettingsSchema = z.strictObject({
  id: z.literal('current'),
  tenantId: opaqueId,
  /** Balance the company states it had at the start of `openingDate`. */
  openingBalanceCents: signedCents,
  openingDate: calendarDate,
  version: expectedVersion,
  updatedAt: instant,
  updatedBy: opaqueId,
  schemaVersion: z.literal(1),
});
export const financeSettingsView = z.object({
  openingBalanceCents: signedCents.nullable(),
  openingDate: calendarDate.nullable(),
  version: z.number().int().min(0),
});
export const financeSettingsInput = z.strictObject({
  expectedVersion: z.number().int().min(0),
  openingBalanceCents: signedCents.refine((v) => Math.abs(v) <= MAX_ORDER_CENTS * 10),
  openingDate: calendarDate,
});
export const managementQuery = z
  .strictObject({
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    horizonDays: z.enum(['30', '60', '90']).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Período inválido');
const flowPoint = z.object({
  key: z.string(),
  label: z.string(),
  inflowCents: z.number().int().safe(),
  outflowCents: z.number().int().safe(),
  balanceCents: z.number().int().safe(),
});
export const managementOverview = z.object({
  period: z.object({ from: calendarDate, to: calendarDate }),
  today: calendarDate,
  receivables: z.object({
    openCents: z.number().int().safe(),
    overdueCents: z.number().int().safe(),
    next7DaysCents: z.number().int().safe(),
    futureCents: z.number().int().safe(),
    receivedInPeriodCents: z.number().int().safe(),
  }),
  payables: z.object({
    openCents: z.number().int().safe(),
    overdueCents: z.number().int().safe(),
    next7DaysCents: z.number().int().safe(),
    futureCents: z.number().int().safe(),
    paidInPeriodCents: z.number().int().safe(),
    recurringForecastCents: z.number().int().safe(),
    /** Open balance of supplier credits and values to recover. */
    supplierCreditsCents: z.number().int().safe(),
  }),
  cash: z.object({
    /** Null until the company states an opening balance. */
    balanceCents: z.number().int().safe().nullable(),
    openingDate: calendarDate.nullable(),
    periodBalanceCents: z.number().int().safe(),
  }),
  realized: z.array(flowPoint),
  projected: z.array(flowPoint),
  profitability: z.object({
    revenueCents: z.number().int().safe(),
    /** Revenue of the orders that have a recorded cost. */
    costedRevenueCents: z.number().int().safe(),
    cogsCents: z.number().int().safe(),
    grossProfitCents: z.number().int().safe(),
    grossMarginBp: z.number().int().nullable(),
    operatingExpensesCents: z.number().int().safe(),
    /** Goods charged and never delivered: outside COGS and the gross margin, on its own line. */
    undeliveredLossCents: z.number().int().safe(),
    estimatedResultCents: z.number().int().safe(),
    ordersWithoutCost: z.number().int().min(0),
  }),
  notes: z.array(z.string()),
});
