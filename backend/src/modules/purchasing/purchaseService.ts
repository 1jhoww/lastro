import { randomUUID } from 'node:crypto';
import { FieldPath, type Query, type Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor, TenantContext } from '../../shared/types/context.js';
import * as s from '../../shared/schemas/management.js';
import { customerSchema, productSchema } from '../../shared/schemas/commercial.js';
import { movementSchema } from '../../shared/schemas/inventory.js';
import type { pageQuery } from '../../shared/schemas/http.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
import { cursorPage } from '../../shared/operations/cursorPage.js';
import type { FinancialCommands } from '../finance/financialCommands.js';
import type { PaymentSettingsService } from '../finance/paymentSettingsService.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import { movementHash } from '../inventory/inventoryService.js';
import { parseQuantity, transition } from '../inventory/quantities.js';
import { projectStock } from '../inventory/stockProjection.js';
import { assertDocumentFits } from '../orders/technicalSize.js';
import { companyDate } from '../orders/calculation.js';
import { costEvent, suggestedCost } from '../costing/costService.js';
import {
  averageAfterReceipt,
  averageAfterReversal,
  milliToCents,
  unitCostMilli,
} from '../costing/calculation.js';
import { abatedTitle, canceledTitle, purchaseTitle } from '../payables/titles.js';
import { supplierCreditRecord } from '../payables/supplierCreditService.js';
import {
  allocateLanded,
  conditionInstallments,
  lineAmounts,
  pending,
  purchaseTotals,
  receiptValue,
  receivingStatus,
  requireValidInstallments,
  withReceived,
} from './calculation.js';
import { closedLines, closureImpact } from './closure.js';

const pendingReceipt = (status: s.Purchase['status']) =>
  status === 'confirmed' || status === 'partially_received';
const commercialId = (number: number) => String(number).padStart(6, '0');

/**
 * Purchase orders. Confirming is a commercial and financial commitment (payable titles), receiving
 * is the physical entry (stock and costs): one never implies the other. Every command is
 * idempotent, versioned and atomic, and nothing here deletes history.
 */
export class PurchaseService {
  constructor(
    readonly commands: FinancialCommands,
    readonly paymentSettings: PaymentSettingsService,
    readonly inventory: InventoryService,
  ) {}
  private get repo() {
    return this.commands.repo;
  }
  private async load(tx: Transaction, tenantId: string, id: string) {
    const purchase = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'purchases', id),
      s.purchaseSchema,
      tx,
    );
    requireCondition(
      purchase?.id === id && purchase.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return purchase;
  }
  private requireVersion(purchase: s.Purchase, expectedVersion: number) {
    requireCondition(purchase.version === expectedVersion, 409, 'CONFLICT', 'Versão desatualizada');
  }
  private requireDraft(purchase: s.Purchase) {
    requireCondition(
      purchase.status === 'draft',
      409,
      'INVALID_PURCHASE_STATE',
      'Somente rascunhos permitem esta operação',
    );
  }
  private async supplier(tx: Transaction, tenantId: string, id: string, active: boolean) {
    const supplier = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'customers', id),
      customerSchema,
      tx,
    );
    requireCondition(
      supplier?.tenantId === tenantId &&
        supplier.id === id &&
        supplier.relationships.includes('supplier'),
      422,
      'INVALID_SUPPLIER',
      'Fornecedor indisponível nesta empresa',
    );
    requireCondition(
      !active || supplier.status === 'active',
      409,
      'SUPPLIER_INACTIVE',
      'Fornecedor inativo',
    );
    return supplier;
  }
  private async snapshotLines(
    tx: Transaction,
    tenantId: string,
    purchaseId: string,
    inputs: z.infer<typeof s.purchaseLineInput>[],
  ) {
    const productRefs = inputs.map((i) => this.repo.ref(tenantId, 'products', i.productId));
    const costRefs = inputs.map((i) => this.repo.ref(tenantId, 'productCosts', i.productId));
    const [products, costs] = await Promise.all([
      this.repo.foundation.readMany(productRefs, productSchema, tx),
      this.repo.foundation.readMany(costRefs, s.productCostSchema, tx),
    ]);
    return inputs.map((input, index) => {
      const product = products[index];
      requireCondition(
        product?.tenantId === tenantId &&
          product.id === input.productId &&
          product.status === 'active',
        409,
        'PRODUCT_UNAVAILABLE',
        'Produto indisponível nesta empresa',
      );
      const amounts = lineAmounts(input, product.unit);
      return s.purchaseLine.parse({
        id: digest(`purchase-line:${purchaseId}:${product.id}`),
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        quantity: input.quantity,
        suggestedUnitCostCents: suggestedCost(costs[index] ?? null),
        unitCostCents: input.unitCostCents,
        ...amounts,
        allocatedCents: 0,
        landedCents: amounts.totalCents,
        receivedQuantity: '0',
        pendingQuantity: input.quantity,
        receivedValueCents: 0,
      });
    });
  }
  private async paymentCondition(
    tx: Transaction,
    tenantId: string,
    id: string | null | undefined,
    version: number | null | undefined,
  ) {
    if (!id) return null;
    requireCondition(version, 422, 'VALIDATION_ERROR', 'Condição exige versão');
    const condition = await this.paymentSettings.activeCondition(tx, tenantId, id, version);
    return {
      id: condition.id,
      version: condition.version,
      name: condition.name,
      schedule: condition.schedule,
    };
  }
  private event(
    tx: Transaction,
    actor: Actor,
    purchase: s.Purchase,
    previousStatus: s.Purchase['status'] | null,
    type: z.infer<typeof s.purchaseEvent>['type'],
    reason: string | null,
    now: string,
  ) {
    const id = randomUUID();
    tx.create(
      this.repo.ref(purchase.tenantId, 'purchaseEvents', id),
      s.purchaseEventSchema.parse({
        id,
        tenantId: purchase.tenantId,
        purchaseId: purchase.id,
        version: purchase.version,
        type,
        previousStatus,
        status: purchase.status,
        reason,
        actorUid: actor.uid,
        occurredAt: now,
        requestId: actor.requestId,
        schemaVersion: 1,
      }),
    );
  }
  private store(tx: Transaction, purchase: s.Purchase) {
    const ref = this.repo.ref(purchase.tenantId, 'purchases', purchase.id);
    assertDocumentFits(ref.path, purchase);
    tx.set(ref, purchase);
  }
  async get(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'purchases:read', tx);
        return this.load(tx, tenantId, id);
      },
      { readOnly: true },
    );
  }
  async list(actor: Actor, tenantId: string, input: z.infer<typeof s.purchaseQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'purchases:read', tx);
        let query: Query = this.repo.ref(tenantId, 'purchases', 'placeholder').parent;
        if (input.status) query = query.where('status', '==', input.status);
        if (input.supplierId) query = query.where('supplierId', '==', input.supplierId);
        if (input.pendingReceipt) query = query.where('pendingReceipt', '==', true);
        return cursorPage({
          repo: this.repo,
          tx,
          tenantId,
          collection: 'purchases',
          scope: digest(stableJson({ actor: actor.uid, tenantId, ...input, cursor: undefined })),
          query: query.orderBy('number', 'desc').orderBy(FieldPath.documentId(), 'desc'),
          input,
          schema: s.purchaseSchema,
        });
      },
      { readOnly: true },
    );
  }
  async history(actor: Actor, tenantId: string, id: string, input: z.infer<typeof pageQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'purchases:read', tx);
        await this.load(tx, tenantId, id);
        return cursorPage({
          repo: this.repo,
          tx,
          tenantId,
          collection: 'purchaseEvents',
          scope: digest(stableJson({ actor: actor.uid, tenantId, id, limit: input.limit })),
          query: this.repo
            .ref(tenantId, 'purchaseEvents', 'placeholder')
            .parent.where('purchaseId', '==', id)
            .orderBy('occurredAt', 'desc')
            .orderBy(FieldPath.documentId(), 'desc'),
          input,
          schema: s.purchaseEventSchema,
        });
      },
      { readOnly: true },
    );
  }
  async receipts(actor: Actor, tenantId: string, id: string, input: z.infer<typeof pageQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'purchases:read', tx);
        await this.load(tx, tenantId, id);
        return cursorPage({
          repo: this.repo,
          tx,
          tenantId,
          collection: 'purchaseReceipts',
          scope: digest(stableJson({ actor: actor.uid, tenantId, id, limit: input.limit })),
          query: this.repo
            .ref(tenantId, 'purchaseReceipts', 'placeholder')
            .parent.where('purchaseId', '==', id)
            .orderBy('number', 'desc')
            .orderBy(FieldPath.documentId(), 'desc'),
          input,
          schema: s.receiptSchema,
        });
      },
      { readOnly: true },
    );
  }
  async preview(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.purchasePreviewInput>,
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'purchases:read', tx);
        const purchase = await this.load(tx, tenantId, id);
        const condition = await this.paymentSettings.activeCondition(
          tx,
          tenantId,
          input.paymentConditionId,
          input.paymentConditionVersion,
        );
        return {
          totalCents: purchase.totalCents,
          installments: conditionInstallments(
            purchase.totalCents,
            purchase.purchaseDate,
            condition.schedule,
          ).map((p) => ({ ...p, payableId: null })),
        };
      },
      { readOnly: true },
    );
  }
  create(actor: Actor, tenantId: string, input: z.infer<typeof s.purchaseCreate>, key: string) {
    const id = randomUUID();
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'purchase.create',
      'new',
      input,
      'purchases:create',
      s.purchaseView,
      false,
      async (tx, ctx, _operationId, now) => {
        const counterRef = this.repo.ref(tenantId, 'purchaseCounters', 'current');
        const counter = await this.repo.foundation.read(counterRef, s.purchaseCounterSchema, tx);
        const number = (counter?.last ?? 0) + 1;
        const supplier = input.supplierId
          ? await this.supplier(tx, tenantId, input.supplierId, true)
          : null;
        const condition = await this.paymentCondition(
          tx,
          tenantId,
          input.paymentConditionId,
          input.paymentConditionVersion,
        );
        const lines = await this.snapshotLines(tx, tenantId, id, input.lines ?? []);
        const extras = {
          freightCents: input.freightCents ?? 0,
          otherCostsCents: input.otherCostsCents ?? 0,
          discountCents: input.discountCents ?? 0,
        };
        const purchase = s.purchaseSchema.parse({
          id,
          tenantId,
          number,
          commercialId: commercialId(number),
          supplierId: supplier?.id ?? null,
          supplierName: supplier?.name ?? null,
          supplierDocument: supplier?.document ?? null,
          purchaseDate: input.purchaseDate ?? companyDate(new Date(now), ctx.tenant.timezone),
          expectedDeliveryDate: input.expectedDeliveryDate ?? null,
          paymentCondition: condition,
          notes: input.notes ?? '',
          status: 'draft',
          pendingReceipt: false,
          responsibleUid: actor.uid,
          lines,
          ...extras,
          ...purchaseTotals(lines, extras),
          installments: [],
          titleGeneration: 1,
          receiptCount: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.uid,
          updatedBy: actor.uid,
          confirmedAt: null,
          confirmedBy: null,
          canceledAt: null,
          canceledBy: null,
          cancelReason: null,
          schemaVersion: 1,
        });
        tx.set(counterRef, { last: number, schemaVersion: 1 });
        this.store(tx, purchase);
        this.event(tx, actor, purchase, null, 'created', null, now);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'purchase.created', id, now, {
          number,
          totalCents: purchase.totalCents,
        });
        return s.purchaseView.parse(purchase);
      },
    );
  }
  update(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.purchaseUpdate>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'purchase.update',
      id,
      input,
      'purchases:edit',
      s.purchaseView,
      false,
      async (tx, _ctx, _operationId, now) => {
        const purchase = await this.load(tx, tenantId, id);
        this.requireVersion(purchase, input.expectedVersion);
        this.requireDraft(purchase);
        const supplier =
          input.supplierId === undefined
            ? undefined
            : input.supplierId
              ? await this.supplier(tx, tenantId, input.supplierId, true)
              : null;
        const condition =
          input.paymentConditionId === undefined
            ? purchase.paymentCondition
            : await this.paymentCondition(
                tx,
                tenantId,
                input.paymentConditionId,
                input.paymentConditionVersion,
              );
        const lines = input.lines
          ? await this.snapshotLines(tx, tenantId, id, input.lines)
          : purchase.lines;
        const extras = {
          freightCents: input.freightCents ?? purchase.freightCents,
          otherCostsCents: input.otherCostsCents ?? purchase.otherCostsCents,
          discountCents: input.discountCents ?? purchase.discountCents,
        };
        const next = s.purchaseSchema.parse({
          ...purchase,
          ...(supplier !== undefined
            ? {
                supplierId: supplier?.id ?? null,
                supplierName: supplier?.name ?? null,
                supplierDocument: supplier?.document ?? null,
              }
            : {}),
          purchaseDate: input.purchaseDate ?? purchase.purchaseDate,
          expectedDeliveryDate:
            input.expectedDeliveryDate === undefined
              ? purchase.expectedDeliveryDate
              : input.expectedDeliveryDate,
          paymentCondition: condition,
          notes: input.notes ?? purchase.notes,
          lines,
          ...extras,
          ...purchaseTotals(lines, extras),
          version: purchase.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        this.store(tx, next);
        this.event(tx, actor, next, purchase.status, 'edited', null, now);
        return s.purchaseView.parse(next);
      },
    );
  }
  confirm(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.purchaseConfirm>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'purchase.confirm',
      id,
      input,
      'purchases:confirm',
      s.purchaseView,
      false,
      async (tx, _ctx, _operationId, now) => {
        const purchase = await this.load(tx, tenantId, id);
        this.requireVersion(purchase, input.expectedVersion);
        this.requireDraft(purchase);
        requireCondition(
          purchase.supplierId,
          422,
          'SUPPLIER_REQUIRED',
          'Confirmação exige fornecedor',
        );
        requireCondition(
          purchase.lines.length > 0,
          422,
          'PURCHASE_LINES_REQUIRED',
          'Confirmação exige ao menos um produto',
        );
        requireCondition(
          purchase.totalCents > 0,
          422,
          'ORDER_TOTAL_REQUIRED',
          'Confirmação exige total positivo',
        );
        requireCondition(
          purchase.paymentCondition,
          422,
          'PAYMENT_CONDITION_REQUIRED',
          'Confirmação exige condição de pagamento',
        );
        const supplier = await this.supplier(tx, tenantId, purchase.supplierId, true);
        const condition = await this.paymentSettings.activeCondition(
          tx,
          tenantId,
          purchase.paymentCondition.id,
          purchase.paymentCondition.version,
        );
        // Re-validates products; lines keep the costs the user negotiated.
        const inputs = purchase.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCostCents: l.unitCostCents,
          discountCents: l.discountCents,
        }));
        await this.snapshotLines(tx, tenantId, id, inputs);
        const rows = input.installments
          ? input.installments.map((p, i) => ({ ...p, number: i + 1 }))
          : conditionInstallments(purchase.totalCents, purchase.purchaseDate, condition.schedule);
        requireValidInstallments(rows, purchase.totalCents, purchase.purchaseDate);
        const lines = allocateLanded(purchase.lines, purchase);
        const titles = rows.map((row) =>
          purchaseTitle(purchase, supplier, row, rows.length, actor, now),
        );
        const next = s.purchaseSchema.parse({
          ...purchase,
          supplierName: supplier.name,
          supplierDocument: supplier.document,
          lines,
          status: 'confirmed',
          pendingReceipt: true,
          installments: rows.map((row, i) => ({ ...row, payableId: titles[i]!.id })),
          confirmedAt: now,
          confirmedBy: actor.uid,
          version: purchase.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        for (const title of titles) tx.create(this.repo.ref(tenantId, 'payables', title.id), title);
        this.store(tx, next);
        this.event(tx, actor, next, purchase.status, 'confirmed', null, now);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'purchase.confirmed', id, now, {
          totalCents: next.totalCents,
          installments: rows.length,
        });
        return s.purchaseView.parse(next);
      },
    );
  }
  /** After confirmation only dates and notes change here, always with a reason on record. */
  amend(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.purchaseAmendment>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'purchase.amend',
      id,
      input,
      'purchases:edit',
      s.purchaseView,
      false,
      async (tx, _ctx, _operationId, now) => {
        const purchase = await this.load(tx, tenantId, id);
        this.requireVersion(purchase, input.expectedVersion);
        requireCondition(
          pendingReceipt(purchase.status),
          409,
          'INVALID_PURCHASE_STATE',
          'Somente compras confirmadas e não concluídas permitem esta alteração',
        );
        const next = s.purchaseSchema.parse({
          ...purchase,
          expectedDeliveryDate:
            input.expectedDeliveryDate === undefined
              ? purchase.expectedDeliveryDate
              : input.expectedDeliveryDate,
          notes: input.notes ?? purchase.notes,
          version: purchase.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        this.store(tx, next);
        this.event(tx, actor, next, purchase.status, 'amended', input.reason, now);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'purchase.amended', id, now, {
          previousExpectedDeliveryDate: purchase.expectedDeliveryDate,
          expectedDeliveryDate: next.expectedDeliveryDate,
          reason: input.reason,
        });
        return s.purchaseView.parse(next);
      },
    );
  }
  /** Titles of the current confirmation; the caller decides what a paid one blocks. */
  private async titles(tx: Transaction, purchase: s.Purchase) {
    const refs = purchase.installments.map((p) =>
      this.repo.ref(purchase.tenantId, 'payables', p.payableId!),
    );
    const titles = await this.repo.foundation.readMany(refs, s.payableSchema, tx);
    return titles.map((title) => {
      requireCondition(title, 409, 'PURCHASE_INTEGRITY', 'Títulos da compra inconsistentes');
      return title;
    });
  }
  private requireUntouched(purchase: s.Purchase, titles: s.Payable[]) {
    requireCondition(
      purchase.lines.every((l) => parseQuantity(l.receivedQuantity, l.unit) === 0),
      409,
      'PURCHASE_HAS_RECEIPTS',
      'Estorne os recebimentos antes de continuar',
    );
    requireCondition(
      titles.every((t) => t.paidCents === 0),
      409,
      'PURCHASE_HAS_PAYMENTS',
      'Estorne os pagamentos dos títulos antes de continuar',
    );
    requireCondition(
      titles.every((t) => t.canceledCents === 0),
      409,
      'PURCHASE_HAS_CREDITS',
      'Estorne os créditos usados nos títulos antes de continuar',
    );
  }
  private cancelTitles(
    tx: Transaction,
    titles: s.Payable[],
    actor: Actor,
    reason: string,
    now: string,
  ) {
    for (const title of titles)
      if (title.status !== 'canceled')
        tx.set(
          this.repo.ref(title.tenantId, 'payables', title.id),
          canceledTitle(title, actor, reason, now),
        );
  }
  /** Back to draft, for changes of values: open titles are canceled, never rewritten. */
  reopen(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.purchaseReasonCommand>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'purchase.reopen',
      id,
      input,
      'purchases:edit',
      s.purchaseView,
      false,
      async (tx, _ctx, _operationId, now) => {
        const purchase = await this.load(tx, tenantId, id);
        this.requireVersion(purchase, input.expectedVersion);
        requireCondition(
          purchase.status === 'confirmed',
          409,
          'INVALID_PURCHASE_STATE',
          'Somente compras confirmadas sem recebimento podem voltar a rascunho',
        );
        const titles = await this.titles(tx, purchase);
        this.requireUntouched(purchase, titles);
        const next = s.purchaseSchema.parse({
          ...purchase,
          status: 'draft',
          pendingReceipt: false,
          lines: purchase.lines.map((l) => ({
            ...l,
            allocatedCents: 0,
            landedCents: l.totalCents,
          })),
          installments: [],
          titleGeneration: purchase.titleGeneration + 1,
          confirmedAt: null,
          confirmedBy: null,
          version: purchase.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        this.cancelTitles(tx, titles, actor, input.reason, now);
        this.store(tx, next);
        this.event(tx, actor, next, purchase.status, 'reopened', input.reason, now);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'purchase.reopened', id, now, {
          reason: input.reason,
          canceledTitles: titles.length,
        });
        return s.purchaseView.parse(next);
      },
    );
  }
  /**
   * Cancellation keeps the purchase and its titles as history. With goods received or titles paid
   * it is refused: those are reversed explicitly first, so no stock or cash disappears by itself.
   */
  cancel(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.purchaseReasonCommand>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'purchase.cancel',
      id,
      input,
      'purchases:edit',
      s.purchaseView,
      false,
      async (tx, _ctx, _operationId, now) => {
        const purchase = await this.load(tx, tenantId, id);
        this.requireVersion(purchase, input.expectedVersion);
        requireCondition(
          purchase.status !== 'canceled',
          409,
          'INVALID_PURCHASE_STATE',
          'Compra já cancelada',
        );
        const titles = purchase.status === 'draft' ? [] : await this.titles(tx, purchase);
        this.requireUntouched(purchase, titles);
        const next = s.purchaseSchema.parse({
          ...purchase,
          status: 'canceled',
          pendingReceipt: false,
          canceledAt: now,
          canceledBy: actor.uid,
          cancelReason: input.reason,
          version: purchase.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        this.cancelTitles(tx, titles, actor, input.reason, now);
        this.store(tx, next);
        this.event(tx, actor, next, purchase.status, 'canceled', input.reason, now);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'purchase.canceled', id, now, {
          reason: input.reason,
          canceledTitles: titles.length,
        });
        return s.purchaseView.parse(next);
      },
    );
  }
  private requireClosable(purchase: s.Purchase) {
    requireCondition(
      purchase.status !== 'closed',
      409,
      'PURCHASE_ALREADY_CLOSED',
      'O saldo desta compra já foi encerrado',
    );
    requireCondition(
      purchase.status === 'partially_received',
      409,
      'INVALID_PURCHASE_STATE',
      'Somente compras parcialmente recebidas permitem encerrar o saldo',
    );
  }
  /** What closing would do right now. Writes nothing. */
  async closurePreview(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.purchaseClosurePreviewInput>,
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'purchases:close', tx);
        const purchase = await this.load(tx, tenantId, id);
        this.requireClosable(purchase);
        return closureImpact(purchase, await this.titles(tx, purchase), input.treatment);
      },
      { readOnly: true },
    );
  }
  async closure(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'purchases:read', tx);
        const purchase = await this.load(tx, tenantId, id);
        requireCondition(purchase.closure, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
        const closure = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'purchaseClosures', purchase.closure.id),
          s.purchaseClosureSchema,
          tx,
        );
        requireCondition(closure, 409, 'PURCHASE_INTEGRITY', 'Encerramento indisponível');
        return s.purchaseClosureView.parse(closure);
      },
      { readOnly: true },
    );
  }
  /**
   * Closes what the supplier will not deliver. Stock entries and payments stay untouched; open
   * titles only change on an abatement, latest due date first and never below zero. Value paid
   * beyond what arrived becomes a credit or a value to recover. The closure id comes from the
   * purchase, so it can exist only once, and there is no way back: reversing receipts is refused.
   */
  close(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.purchaseClosureInput>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'purchase.close',
      id,
      input,
      'purchases:close',
      s.purchaseClosureResult,
      false,
      async (tx, ctx, operationId, now) => {
        const purchase = await this.load(tx, tenantId, id);
        this.requireVersion(purchase, input.expectedVersion);
        this.requireClosable(purchase);
        const closureId = digest(`purchase-closure:${id}`);
        const closureRef = this.repo.ref(tenantId, 'purchaseClosures', closureId);
        requireCondition(
          !(await tx.get(closureRef)).exists,
          409,
          'PURCHASE_ALREADY_CLOSED',
          'O saldo desta compra já foi encerrado',
        );
        const titles = await this.titles(tx, purchase);
        const impact = closureImpact(purchase, titles, input.treatment);
        requireCondition(
          impact.undeliveredValueCents === input.expectedUndeliveredCents &&
            impact.excessCents === input.expectedExcessCents,
          409,
          'CLOSURE_VALUES_CHANGED',
          'Os valores mudaram desde a prévia. Revise antes de encerrar',
        );
        requireCondition(
          impact.excessCents === 0 || input.excessAs,
          422,
          'EXCESS_DESTINATION_REQUIRED',
          'Informe se o valor pago a maior será crédito ou valor a recuperar',
        );
        const closedOn = companyDate(new Date(now), ctx.tenant.timezone);
        const kind = input.treatment === 'supplier_credit' ? 'credit' : (input.excessAs ?? null);
        const credit =
          impact.creditCents > 0
            ? supplierCreditRecord({
                purchase,
                closureId,
                kind: kind!,
                amountCents: impact.creditCents,
                issuedOn: closedOn,
                actor,
                now,
              })
            : null;
        const closure = s.purchaseClosureSchema.parse({
          ...impact,
          id: closureId,
          tenantId,
          purchaseId: id,
          excessAs: impact.excessCents > 0 ? kind : null,
          creditId: credit?.id ?? null,
          reason: input.reason,
          notes: input.notes ?? '',
          closedOn,
          closedAt: now,
          closedBy: actor.uid,
          requestId: actor.requestId,
          operationId,
          schemaVersion: 1,
        });
        const next = s.purchaseSchema.parse({
          ...purchase,
          lines: closedLines(purchase.lines),
          status: 'closed',
          pendingReceipt: false,
          closure: {
            id: closureId,
            treatment: closure.treatment,
            undeliveredValueCents: closure.undeliveredValueCents,
            abatedCents: closure.abatedCents,
            excessCents: closure.excessCents,
            creditId: closure.creditId,
            closedOn,
            closedAt: now,
            closedBy: actor.uid,
            reason: closure.reason,
          },
          version: purchase.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        const byId = new Map(titles.map((title) => [title.id, title]));
        for (const row of impact.titles)
          tx.set(
            this.repo.ref(tenantId, 'payables', row.payableId),
            abatedTitle(
              byId.get(row.payableId)!,
              row.abatedCents,
              actor,
              input.reason,
              closedOn,
              now,
            ),
          );
        tx.create(closureRef, closure);
        if (credit) tx.create(this.repo.ref(tenantId, 'supplierCredits', credit.id), credit);
        this.store(tx, next);
        this.event(tx, actor, next, purchase.status, 'closed', input.reason, now);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'purchase.closed', id, now, {
          closureId,
          treatment: closure.treatment,
          undeliveredValueCents: closure.undeliveredValueCents,
          abatedCents: closure.abatedCents,
          excessCents: closure.excessCents,
          creditId: closure.creditId,
          reason: closure.reason,
        });
        return s.purchaseClosureResult.parse({ purchase: next, closure });
      },
    );
  }
  private async stockMovement(
    tx: Transaction,
    ctx: TenantContext,
    productId: string,
    type: 'STOCK_PURCHASE_ENTRY' | 'STOCK_PURCHASE_REVERSAL',
    quantityScaled: number,
    purchaseId: string,
    receiptId: string,
    movementId: string,
    operationId: string,
    now: string,
  ) {
    const tenantId = ctx.tenant.id;
    const product = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'products', productId),
      productSchema,
      tx,
    );
    requireCondition(
      product?.id === productId && product.tenantId === tenantId,
      409,
      'PRODUCT_UNAVAILABLE',
      'Produto indisponível nesta empresa',
    );
    const stock = await this.inventory.stockFor(product, tx);
    const balances = transition(stock.physicalScaled, stock.reservedScaled, type, quantityScaled);
    const content = {
      id: movementId,
      tenantId,
      productId,
      type,
      unit: product.unit,
      quantityScaled,
      previousPhysicalScaled: stock.physicalScaled,
      previousReservedScaled: stock.reservedScaled,
      ...balances,
      sequence: stock.movementCount + 1,
      origin: 'purchase' as const,
      originReference: purchaseId,
      actorUid: ctx.actor.uid,
      reason: type === 'STOCK_PURCHASE_ENTRY' ? 'Recebimento de compra' : 'Estorno de recebimento',
      notes: `receipt:${receiptId}`,
      occurredAt: now,
      requestId: ctx.actor.requestId,
      operationId,
      previousHash: stock.lastMovementHash,
      schemaVersion: 1 as const,
    };
    const movement = movementSchema.parse({ ...content, hash: movementHash(content) });
    const next = projectStock(
      product,
      {
        ...stock,
        ...balances,
        version: stock.version + 1,
        movementCount: movement.sequence,
        lastMovementId: movementId,
        lastMovementHash: movement.hash,
        lastMovementAt: now,
      },
      now,
    );
    return {
      physicalBefore: stock.physicalScaled,
      apply: () => {
        tx.set(this.repo.ref(tenantId, 'inventory', productId), next);
        tx.create(this.repo.ref(tenantId, 'inventoryMovements', movementId), movement);
      },
    };
  }
  /**
   * Physical entry of a purchase. Quantities above the pending balance are refused; the key and
   * the expected version make a repeated request a replay or a conflict, never a second entry.
   */
  receive(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.receiptInput>,
    key: string,
  ) {
    const receiptId = randomUUID();
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'purchase.receive',
      id,
      input,
      'purchases:receive',
      s.receiptResult,
      false,
      async (tx, ctx, operationId, now) => {
        const purchase = await this.load(tx, tenantId, id);
        this.requireVersion(purchase, input.expectedVersion);
        requireCondition(
          pendingReceipt(purchase.status),
          409,
          'INVALID_PURCHASE_STATE',
          'Esta compra não aguarda recebimento',
        );
        requireCondition(
          input.receivedOn <= companyDate(new Date(now), ctx.tenant.timezone),
          422,
          'INVALID_RECEIPT_DATE',
          'O recebimento não pode ter data futura',
        );
        const linesById = new Map(purchase.lines.map((l) => [l.id, l]));
        const prepared = await Promise.all(
          input.items.map(async (item) => {
            const line = linesById.get(item.lineId);
            requireCondition(line, 422, 'VALIDATION_ERROR', 'Item fora da compra');
            const quantityScaled = parseQuantity(item.quantity, line.unit);
            requireCondition(
              quantityScaled <= pending(line),
              409,
              'RECEIPT_EXCEEDS_PENDING',
              `Quantidade acima do pendente: ${line.name}`,
            );
            const orderedScaled = parseQuantity(line.quantity, line.unit);
            const receivedAfter = parseQuantity(line.receivedQuantity, line.unit) + quantityScaled;
            const valueCents = receiptValue(line, orderedScaled, receivedAfter);
            const movementId = digest(`purchase-receipt:${operationId}:${line.id}`);
            const stock = await this.stockMovement(
              tx,
              ctx,
              line.productId,
              'STOCK_PURCHASE_ENTRY',
              quantityScaled,
              id,
              receiptId,
              movementId,
              operationId,
              now,
            );
            const costRef = this.repo.ref(tenantId, 'productCosts', line.productId);
            const cost = await this.repo.foundation.read(costRef, s.productCostSchema, tx);
            const unit = unitCostMilli(valueCents, quantityScaled);
            const nextCost = s.productCostSchema.parse({
              id: line.productId,
              tenantId,
              // The reference is the company's own figure; a receipt only fills an empty one.
              referenceCostCents: cost?.referenceCostCents ?? milliToCents(unit),
              averageCostMilli: averageAfterReceipt(
                {
                  physicalScaled: stock.physicalBefore,
                  averageCostMilli: cost?.averageCostMilli ?? null,
                  referenceCostCents: cost?.referenceCostCents ?? null,
                },
                valueCents,
                quantityScaled,
              ),
              lastPurchaseCostMilli: unit,
              lastReceiptId: receiptId,
              version: (cost?.version ?? 0) + 1,
              updatedAt: now,
              updatedBy: actor.uid,
              schemaVersion: 1,
            });
            return {
              line,
              quantityScaled,
              receivedAfter,
              valueCents,
              movementId,
              stock,
              costRef,
              cost,
              nextCost,
              unit,
              quantity: item.quantity,
            };
          }),
        );
        const changed = new Map(prepared.map((p) => [p.line.id, p]));
        const lines = purchase.lines.map((line) => {
          const p = changed.get(line.id);
          return p
            ? withReceived(line, p.receivedAfter, line.receivedValueCents + p.valueCents)
            : line;
        });
        const status = receivingStatus(lines);
        const next = s.purchaseSchema.parse({
          ...purchase,
          lines,
          status,
          pendingReceipt: pendingReceipt(status),
          receiptCount: purchase.receiptCount + 1,
          version: purchase.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        const receipt = s.receiptSchema.parse({
          id: receiptId,
          tenantId,
          purchaseId: id,
          number: next.receiptCount,
          receivedOn: input.receivedOn,
          notes: input.notes ?? '',
          items: prepared.map((p) => ({
            lineId: p.line.id,
            productId: p.line.productId,
            name: p.line.name,
            sku: p.line.sku,
            unit: p.line.unit,
            quantity: p.quantity,
            valueCents: p.valueCents,
            movementId: p.movementId,
            reversalMovementId: null,
            previousLastCostMilli: p.cost?.lastPurchaseCostMilli ?? null,
          })),
          status: 'active',
          reversedAt: null,
          reversedBy: null,
          reversalReason: null,
          createdAt: now,
          createdBy: actor.uid,
          requestId: actor.requestId,
          operationId,
          schemaVersion: 1,
        });
        for (const p of prepared) {
          p.stock.apply();
          tx.set(p.costRef, p.nextCost);
          const eventId = randomUUID();
          tx.create(
            this.repo.ref(tenantId, 'productCostEvents', eventId),
            costEvent({
              id: eventId,
              tenantId,
              productId: p.line.productId,
              type: 'purchase_received',
              previous: p.cost,
              next: p.nextCost,
              quantityScaled: p.quantityScaled,
              valueCents: p.valueCents,
              unitCostMilli: p.unit,
              purchaseId: id,
              receiptId,
              actor,
              occurredAt: now,
            }),
          );
        }
        tx.create(this.repo.ref(tenantId, 'purchaseReceipts', receiptId), receipt);
        this.store(tx, next);
        this.event(tx, actor, next, purchase.status, 'received', null, now);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'purchase.received', id, now, {
          receiptId,
          items: prepared.length,
          valueCents: prepared.reduce((a, p) => a + p.valueCents, 0),
        });
        return s.receiptResult.parse({ purchase: next, receipt });
      },
    );
  }
  /**
   * Takes a receipt out of the stock again, with its own movements and the average recomputed.
   * Refused when that stock is already reserved or gone. Titles and payments are not touched.
   */
  reverseReceipt(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.receiptReversalInput>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'purchase.receipt.reverse',
      id,
      input,
      'purchases:receive',
      s.receiptResult,
      false,
      async (tx, ctx, operationId, now) => {
        const receipt = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'purchaseReceipts', id),
          s.receiptSchema,
          tx,
        );
        requireCondition(
          receipt?.id === id && receipt.tenantId === tenantId,
          404,
          'RESOURCE_NOT_FOUND',
          'Recurso não encontrado',
        );
        requireCondition(
          receipt.status === 'active',
          409,
          'RECEIPT_ALREADY_REVERSED',
          'Recebimento já estornado',
        );
        const purchase = await this.load(tx, tenantId, receipt.purchaseId);
        requireCondition(
          purchase.status !== 'closed',
          409,
          'PURCHASE_CLOSED',
          'Compra com saldo encerrado não permite estornar recebimentos',
        );
        const linesById = new Map(purchase.lines.map((l) => [l.id, l]));
        const prepared = await Promise.all(
          receipt.items.map(async (item) => {
            const line = linesById.get(item.lineId);
            requireCondition(line, 409, 'PURCHASE_INTEGRITY', 'Recebimento inconsistente');
            const quantityScaled = parseQuantity(item.quantity, line.unit);
            const movementId = digest(`purchase-reversal:${operationId}:${line.id}`);
            const stock = await this.stockMovement(
              tx,
              ctx,
              line.productId,
              'STOCK_PURCHASE_REVERSAL',
              quantityScaled,
              purchase.id,
              id,
              movementId,
              operationId,
              now,
            );
            const costRef = this.repo.ref(tenantId, 'productCosts', line.productId);
            const cost = await this.repo.foundation.read(costRef, s.productCostSchema, tx);
            requireCondition(cost, 409, 'PURCHASE_INTEGRITY', 'Custo do produto indisponível');
            const nextCost = s.productCostSchema.parse({
              ...cost,
              averageCostMilli:
                cost.averageCostMilli === null
                  ? null
                  : averageAfterReversal(
                      stock.physicalBefore,
                      cost.averageCostMilli,
                      item.valueCents,
                      quantityScaled,
                    ),
              lastPurchaseCostMilli:
                cost.lastReceiptId === id ? item.previousLastCostMilli : cost.lastPurchaseCostMilli,
              lastReceiptId: cost.lastReceiptId === id ? null : cost.lastReceiptId,
              version: cost.version + 1,
              updatedAt: now,
              updatedBy: actor.uid,
            });
            return { item, line, quantityScaled, movementId, stock, costRef, cost, nextCost };
          }),
        );
        const changed = new Map(prepared.map((p) => [p.line.id, p]));
        const lines = purchase.lines.map((line) => {
          const p = changed.get(line.id);
          return p
            ? withReceived(
                line,
                parseQuantity(line.receivedQuantity, line.unit) - p.quantityScaled,
                line.receivedValueCents - p.item.valueCents,
              )
            : line;
        });
        const status = receivingStatus(lines);
        const next = s.purchaseSchema.parse({
          ...purchase,
          lines,
          status,
          pendingReceipt: pendingReceipt(status),
          version: purchase.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        const reversed = s.receiptSchema.parse({
          ...receipt,
          status: 'reversed',
          items: receipt.items.map((item) => ({
            ...item,
            reversalMovementId: changed.get(item.lineId)!.movementId,
          })),
          reversedAt: now,
          reversedBy: actor.uid,
          reversalReason: input.reason,
        });
        for (const p of prepared) {
          p.stock.apply();
          tx.set(p.costRef, p.nextCost);
          const eventId = randomUUID();
          tx.create(
            this.repo.ref(tenantId, 'productCostEvents', eventId),
            costEvent({
              id: eventId,
              tenantId,
              productId: p.line.productId,
              type: 'receipt_reversed',
              previous: p.cost,
              next: p.nextCost,
              quantityScaled: p.quantityScaled,
              valueCents: p.item.valueCents,
              purchaseId: purchase.id,
              receiptId: id,
              reason: input.reason,
              actor,
              occurredAt: now,
            }),
          );
        }
        tx.set(this.repo.ref(tenantId, 'purchaseReceipts', id), reversed);
        this.store(tx, next);
        this.event(tx, actor, next, purchase.status, 'receipt_reversed', input.reason, now);
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          'purchase.receipt.reversed',
          id,
          now,
          {
            purchaseId: purchase.id,
            reason: input.reason,
          },
        );
        return s.receiptResult.parse({ purchase: next, receipt: reversed });
      },
    );
  }
}
