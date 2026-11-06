import { randomUUID } from 'node:crypto';
import { FieldPath, type Query, type Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import type { AccessService } from '../auth/accessService.js';
import type { Actor, TenantContext } from '../../shared/types/context.js';
import { customerSchema, productSchema } from '../../shared/schemas/commercial.js';
import { membershipSchema, identitySchema } from '../../shared/schemas/models.js';
import * as s from '../../shared/schemas/orders.js';
import { pageQuery } from '../../shared/schemas/http.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { digest, stableJson, encodeCursor, decodeCursor } from '../../shared/utils/crypto.js';
import { recordAudit } from '../../shared/audit/audit.js';
import {
  snapshotLine,
  priceOrder,
  installmentsFor,
  validateDates,
  approvalFingerprint,
} from './calculation.js';
import type { OrderStockPort } from '../inventory/orderStockContract.js';
import { reservationIdFor } from '../inventory/orderStockAdapter.js';
import { parseQuantity } from '../inventory/quantities.js';
import type { OrderReceivablesPort } from '../receivables/orderReceivables.js';
import { assertDocumentFits } from './technicalSize.js';
import type { PaymentSettingsService } from '../finance/paymentSettingsService.js';
import { termsAt, termsInstallments, commercialTerms } from '../finance/paymentCalculation.js';
import { termsSnapshot, methodSnapshot } from '../../shared/schemas/paymentSettings.js';
import { FinancialLocks } from '../finance/resolution/locks.js';
import { checkReadBudget } from '../../shared/operations/readBudget.js';
import { brandingAllowed, hasFeature } from '../plans/catalog.js';
import { bonusCostSnapshot, orderCostSnapshot } from '../costing/orderCosts.js';
import type { OrderCostSnapshot } from '../../shared/schemas/management.js';
import {
  bonusSchema,
  type Bonus,
  type BonusCostSnapshot,
  type OrderBonusInput,
} from '../../shared/schemas/bonuses.js';
import {
  bonusLine,
  bonusNumber,
  followOrder,
  linePrices,
  orderBonusFor,
  readOrderBonus,
  recordBonusEvent,
} from '../bonuses/orderBonus.js';
import { holds } from '../users/permissions.js';
const saleKey = (lines: readonly { productId: string; quantity: string }[]) =>
  JSON.stringify(
    lines
      .map((l) => [l.productId, Number(l.quantity)] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
/** Whether an edit keeps the sold products and quantities; prices are not the seller's to edit. */
const sameSale = (
  saved: readonly { productId: string; quantity: string }[],
  sent: readonly { productId: string; quantity: string }[] | undefined,
) => !sent || saleKey(saved) === saleKey(sent);
export class OrderService {
  readonly financialLocks: FinancialLocks;
  constructor(
    readonly repo: CommercialRepository,
    readonly access: AccessService,
    readonly stock: OrderStockPort,
    readonly financial: OrderReceivablesPort,
    readonly clock: () => Date,
    readonly paymentSettings: PaymentSettingsService,
  ) {
    this.financialLocks = new FinancialLocks(repo);
  }
  private async load(tx: Transaction, tenantId: string, id: string) {
    const order = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'orders', id),
      s.orderSchema,
      tx,
    );
    requireCondition(
      order?.id === id && order.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return order;
  }
  private async customer(
    tx: Transaction,
    ctx: TenantContext,
    id: string | null,
    active: boolean,
    owner?: string,
  ) {
    if (id === null) {
      requireCondition(
        !active && (ctx.membership.role === 'administrator' || owner === ctx.actor.uid),
        404,
        'RESOURCE_NOT_FOUND',
        'Recurso não encontrado',
      );
      return null;
    }
    const customer = await this.repo.foundation.read(
      this.repo.ref(ctx.tenant.id, 'customers', id),
      customerSchema,
      tx,
    );
    requireCondition(
      customer?.id === id &&
        customer.tenantId === ctx.tenant.id &&
        (ctx.membership.role === 'administrator' ||
          (customer.assignedTo === ctx.actor.uid && (!owner || owner === ctx.actor.uid))),
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    requireCondition(
      !active || customer.status === 'active',
      409,
      'CUSTOMER_INACTIVE',
      'Cliente inativo',
    );
    requireCondition(
      !active || customer.relationships.includes('customer'),
      409,
      'CUSTOMER_INACTIVE',
      'Cadastro sem relacionamento de cliente',
    );
    return customer;
  }
  private async responsible(tx: Transaction, ctx: TenantContext, uid: string) {
    const [member, identity] = await Promise.all([
      this.repo.foundation.read(
        this.repo.foundation.tenant(ctx.tenant.id, 'memberships', uid),
        membershipSchema,
        tx,
      ),
      this.repo.foundation.read(this.repo.foundation.global('identities', uid), identitySchema, tx),
    ]);
    requireCondition(
      member?.uid === uid &&
        member.tenantId === ctx.tenant.id &&
        member.status === 'active' &&
        identity?.status === 'active',
      422,
      'INVALID_RESPONSIBLE',
      'Responsável deve possuir vínculo ativo na empresa',
    );
  }
  private inputPolicy(
    ctx: TenantContext,
    input: { sellerUid?: string | undefined; discount?: unknown },
  ) {
    requireCondition(
      ctx.membership.role === 'administrator' ||
        (!('sellerUid' in input) && !('discount' in input)),
      403,
      'FORBIDDEN',
      'Operação não permitida',
    );
  }
  private async snapshots(
    tx: Transaction,
    tenantId: string,
    lines: readonly { id: string; productId: string; quantity: string; unit?: string }[],
  ) {
    const products = await this.repo.foundation.readMany(
      lines.map((line) => this.repo.ref(tenantId, 'products', line.productId)),
      productSchema,
      tx,
    );
    return lines.map((line, index) => {
      const product = products[index];
      requireCondition(
        product?.id === line.productId && product.tenantId === tenantId,
        404,
        'RESOURCE_NOT_FOUND',
        'Recurso não encontrado',
      );
      requireCondition(
        product.status === 'active' && (!line.unit || product.unit === line.unit),
        409,
        'PRODUCT_UNAVAILABLE',
        'Produto inativo ou unidade alterada',
      );
      return snapshotLine(line.id, product, line.quantity);
    });
  }
  /**
   * Bonus of a draft. Only reads, and returns what the caller writes with the order. `undefined`
   * keeps the lines and only follows the customer and seller of the draft; an empty list removes
   * the bonus, because a draft with no goods to give has nothing to record.
   */
  private async draftBonus(
    tx: Transaction,
    ctx: TenantContext,
    actor: Actor,
    order: s.Order,
    input: OrderBonusInput | null | undefined,
    previous: Bonus | null,
    now: string,
  ) {
    if (input !== undefined)
      requireCondition(holds(ctx, 'bonuses:grant'), 403, 'FORBIDDEN', 'Operação não permitida');
    const ref = this.repo.ref(order.tenantId, 'bonuses', order.id);
    const identity = {
      customerId: order.customerId,
      customerName: order.customerName,
      responsibleUid: order.sellerUid,
    };
    if (input === undefined) {
      if (!previous) return { bonus: null, write: () => undefined };
      const bonus = bonusSchema.parse({ ...previous, ...identity });
      return { bonus, write: () => tx.set(ref, bonus) };
    }
    if (!input?.lines.length)
      return { bonus: null, write: () => (previous ? void tx.delete(ref) : undefined) };
    const lines = await this.snapshots(
      tx,
      order.tenantId,
      input.lines.map((l) => ({ ...l, id: randomUUID() })),
    );
    const bonus = bonusSchema.parse({
      id: order.id,
      tenantId: order.tenantId,
      commercialId: bonusNumber(order.id),
      kind: 'order',
      orderId: order.id,
      orderCommercialId: order.commercialId,
      ...identity,
      status: 'draft',
      lines: lines.map(bonusLine),
      linePrices: linePrices(lines),
      reason: input.reason ?? null,
      reasonDetail: input.reasonDetail ?? null,
      notes: '',
      occurredAt: null,
      dispatchedAt: null,
      canceledAt: null,
      canceledBy: null,
      version: (previous?.version ?? 0) + 1,
      createdAt: previous?.createdAt ?? now,
      createdBy: previous?.createdBy ?? actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
      schemaVersion: 1,
    });
    assertDocumentFits(ref.path, bonus);
    return {
      bonus,
      write: () => {
        tx.set(ref, bonus);
        recordBonusEvent(this.repo, tx, actor, bonus, previous ? 'edited' : 'created', null, null);
      },
    };
  }
  /**
   * Who confirms a bonus without the grant relies on someone else's authorization, and that person
   * must still hold it, as a discount needs its approver. Revoking the grant stops pending bonuses.
   */
  private async bonusAuthorized(tx: Transaction, ctx: TenantContext, bonus: Bonus) {
    if (holds(ctx, 'bonuses:grant')) return;
    const uid = bonus.updatedBy;
    const [member, identity] = await Promise.all([
      this.repo.foundation.read(
        this.repo.foundation.tenant(ctx.tenant.id, 'memberships', uid),
        membershipSchema,
        tx,
      ),
      this.repo.foundation.read(this.repo.foundation.global('identities', uid), identitySchema, tx),
    ]);
    requireCondition(
      member?.uid === uid &&
        member.tenantId === ctx.tenant.id &&
        member.status === 'active' &&
        identity?.status === 'active' &&
        holds({ membership: member, entitlements: ctx.entitlements }, 'bonuses:grant'),
      403,
      'BONUS_AUTHORIZATION_REQUIRED',
      'Bonificação exige nova autorização de quem pode conceder',
    );
  }
  private async amounts(
    tx: Transaction,
    ctx: TenantContext,
    id: string,
    customerId: string | null,
    sellerUid: string,
    lines: readonly { id: string; productId: string; quantity: string; unit?: string }[],
    payment: z.infer<typeof s.paymentInput> | null,
    discount: s.Discount | null,
    version: number,
    now: string,
    terms?: z.infer<typeof termsSnapshot> | undefined,
    method?: z.infer<typeof methodSnapshot> | undefined,
  ) {
    if (payment) validateDates(payment.dueDates, new Date(now), ctx.tenant.timezone);
    requireCondition(
      !discount || (customerId && payment && lines.length),
      422,
      'INCOMPLETE_ORDER',
      'Aprovação exige cliente, linhas e condição de pagamento',
    );
    const snapshots = await this.snapshots(tx, ctx.tenant.id, lines);
    const pricing = priceOrder(snapshots, discount);
    return {
      ...pricing,
      payment,
      installments: terms
        ? termsInstallments(id, pricing.totalCents, terms)
        : payment
          ? installmentsFor(id, pricing.totalCents, payment.dueDates)
          : [],
      discount: discount
        ? {
            ...discount,
            approvedBy: ctx.actor.uid,
            approvedAt: now,
            approvedVersion: version,
            fingerprint: approvalFingerprint(
              customerId!,
              sellerUid,
              snapshots,
              this.fingerprintPayment(payment, terms, method),
            ),
            beforeCents: pricing.subtotalCents,
            afterCents: pricing.totalCents,
          }
        : null,
    };
  }
  private fingerprintPayment(
    payment: unknown,
    terms?: z.infer<typeof termsSnapshot>,
    method?: z.infer<typeof methodSnapshot>,
  ) {
    return terms
      ? commercialTerms(terms, method)
      : method
        ? { payment, intendedMethod: method }
        : payment;
  }
  private async selection(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      paymentConditionId?: string | null | undefined;
      paymentConditionVersion?: number | undefined;
      intendedPaymentMethodId?: string | null | undefined;
      intendedPaymentMethodVersion?: number | undefined;
      payment?: unknown;
    },
    now: string,
    previous?: s.Order,
  ) {
    const conditionId =
      input.paymentConditionId !== undefined
        ? input.paymentConditionId
        : previous?.paymentTerms?.id;
    const conditionVersion = input.paymentConditionVersion ?? previous?.paymentTerms?.version;
    requireCondition(
      !(conditionId && input.payment !== undefined),
      422,
      'INVALID_PAYMENT_SELECTION',
      'Não combine condição cadastrada com calendário manual',
    );
    const terms = conditionId
      ? termsAt(
          await this.paymentSettings.activeCondition(
            tx,
            ctx.tenant.id,
            conditionId,
            conditionVersion!,
          ),
          new Date(now),
          ctx.tenant.timezone,
        )
      : undefined;
    const methodId =
      input.intendedPaymentMethodId !== undefined
        ? input.intendedPaymentMethodId
        : previous?.intendedPaymentMethod?.id;
    const methodVersion =
      input.intendedPaymentMethodVersion ?? previous?.intendedPaymentMethod?.version;
    const method = methodId
      ? await this.paymentSettings.activeMethod(tx, ctx.tenant.id, methodId, methodVersion!)
      : undefined;
    return { terms, method };
  }
  async paymentPreview(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.paymentPreviewInput>,
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.access.tenant(actor, tenantId, 'orders:own:read', tx);
        const order = await this.load(tx, tenantId, id);
        await this.customer(tx, ctx, order.customerId, true, order.sellerUid);
        requireCondition(
          order.status === 'draft' && order.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Rascunho alterado ou indisponível',
        );
        const { terms, method } = await this.selection(tx, ctx, input, this.clock().toISOString());
        const lines = await this.snapshots(tx, tenantId, order.lines);
        const fingerprint = approvalFingerprint(
          order.customerId!,
          order.sellerUid,
          lines,
          this.fingerprintPayment(null, terms, method),
        );
        const invalid = Boolean(order.discount && order.discount.fingerprint !== fingerprint);
        const pricing = priceOrder(lines, invalid ? null : order.discount);
        return s.paymentPreviewView.parse({
          orderId: id,
          orderVersion: order.version,
          ...pricing,
          paymentTerms: terms,
          intendedPaymentMethod: method ?? null,
          installments: termsInstallments(id, pricing.totalCents, terms!),
          discountRequiresApproval: invalid,
        });
      },
      { readOnly: true },
    );
  }
  private event(
    tx: Transaction,
    actor: Actor,
    order: s.Order,
    previous: s.Order['status'] | null,
    type: z.infer<typeof s.orderEvent>['type'],
    reason: string | null,
    operationId: string | null,
  ) {
    const event = s.orderEventSchema.parse({
      id: randomUUID(),
      tenantId: order.tenantId,
      orderId: order.id,
      version: order.version,
      type,
      previousStatus: previous,
      status: order.status,
      occurredAt: order.updatedAt,
      actorUid: actor.uid,
      reason,
      requestId: actor.requestId,
      operationId,
      schemaVersion: 1,
    });
    tx.create(this.repo.ref(order.tenantId, 'orderEvents', event.id), event);
    recordAudit(
      this.repo.foundation,
      tx,
      actor,
      order.tenantId,
      `orders.${type}`,
      order.id,
      order.updatedAt,
      {
        previousStatus: previous,
        status: order.status,
        version: order.version,
        totalCents: order.totalCents,
        discountCents: order.discountCents,
        operationId,
        reason,
      },
    );
  }
  async create(actor: Actor, tenantId: string, input: z.infer<typeof s.orderCreate>) {
    const id = randomUUID(),
      now = this.clock().toISOString();
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'orders:own:create', tx);
      this.inputPolicy(ctx, input);
      const customer = await this.customer(
        tx,
        ctx,
        input.customerId ?? null,
        Boolean(input.customerId),
        actor.uid,
      );
      const sellerUid = input.sellerUid ?? actor.uid;
      await this.responsible(tx, ctx, sellerUid);
      const { terms, method } = await this.selection(tx, ctx, input, now);
      const amounts = await this.amounts(
        tx,
        ctx,
        id,
        customer?.id ?? null,
        sellerUid,
        (input.lines ?? []).map((l) => ({ ...l, id: randomUUID() })),
        terms
          ? {
              type: terms.dueDates.length === 1 ? 'cash' : 'installments',
              dueDates: terms.dueDates,
            }
          : (input.payment ?? null),
        input.discount ?? null,
        1,
        now,
        terms,
        method,
      );
      const order = s.orderSchema.parse({
        id,
        commercialId: `PED-${id.toUpperCase()}`,
        tenantId,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        sellerUid,
        status: 'draft',
        ...amounts,
        ...(terms ? { paymentTerms: terms } : {}),
        ...(method ? { intendedPaymentMethod: method } : {}),
        notes: input.notes ?? '',
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.uid,
        updatedBy: actor.uid,
        confirmedAt: null,
        confirmedBy: null,
        dispatchedAt: null,
        dispatchedBy: null,
        canceledAt: null,
        canceledBy: null,
        dispatchReference: null,
        schemaVersion: 1,
      });
      assertDocumentFits(this.repo.ref(tenantId, 'orders', id).path, order);
      const bonus = await this.draftBonus(tx, ctx, actor, order, input.bonus, null, now);
      tx.create(this.repo.ref(tenantId, 'orders', id), order);
      bonus.write();
      this.event(tx, actor, order, null, 'created', null, null);
      return s.orderDetailView.parse({ ...order, bonus: orderBonusFor(bonus.bonus) });
    });
  }
  async update(actor: Actor, tenantId: string, id: string, input: z.infer<typeof s.orderUpdate>) {
    const now = this.clock().toISOString();
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'orders:own:create', tx);
      this.inputPolicy(ctx, input);
      const order = await this.load(tx, tenantId, id);
      await this.customer(tx, ctx, order.customerId, false, order.sellerUid);
      await this.financialLocks.assertOrderAvailable(
        tx,
        tenantId,
        id,
        ctx.membership.role === 'seller',
      );
      requireCondition(
        order.status === 'draft' && order.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Rascunho alterado ou indisponível',
      );
      const customerId = input.customerId === undefined ? order.customerId : input.customerId;
      const customer = await this.customer(
        tx,
        ctx,
        customerId,
        Boolean(customerId),
        order.sellerUid,
      );
      const sellerUid = input.sellerUid ?? order.sellerUid;
      await this.responsible(tx, ctx, sellerUid);
      const lines = input.lines
        ? input.lines.map((l) => ({ ...l, id: randomUUID() }))
        : order.lines;
      const savedBonus = await readOrderBonus(this.repo, tx, tenantId, id);
      // The bonus was authorized for this customer and this sale. Without the grant, changing
      // either would hand an authorized bonus to a different deal.
      requireCondition(
        !savedBonus ||
          holds(ctx, 'bonuses:grant') ||
          (customerId === order.customerId && sameSale(order.lines, input.lines)),
        403,
        'BONUS_GRANT_REQUIRED',
        'Alterar cliente ou produtos de rascunho com bonificação exige "Conceder bonificações"',
      );
      // Every edit invalidates prior approval. Only an explicit administrator command reapproves.
      const { terms, method } = await this.selection(tx, ctx, input, now, order);
      const amounts = await this.amounts(
        tx,
        ctx,
        id,
        customer?.id ?? null,
        sellerUid,
        lines,
        terms
          ? {
              type: terms.dueDates.length === 1 ? 'cash' : 'installments',
              dueDates: terms.dueDates,
            }
          : input.payment === undefined
            ? input.paymentConditionId === null
              ? null
              : order.payment
            : input.payment,
        input.discount ?? null,
        order.version + 1,
        now,
        terms,
        method,
      );
      const { paymentTerms: _oldTerms, intendedPaymentMethod: _oldMethod, ...baseOrder } = order;
      const next = s.orderSchema.parse({
        ...baseOrder,
        ...amounts,
        ...(terms ? { paymentTerms: terms } : {}),
        ...(method ? { intendedPaymentMethod: method } : {}),
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        sellerUid,
        notes: input.notes ?? order.notes,
        version: order.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      });
      assertDocumentFits(this.repo.ref(tenantId, 'orders', id).path, next);
      const bonus = await this.draftBonus(tx, ctx, actor, next, input.bonus, savedBonus, now);
      tx.set(this.repo.ref(tenantId, 'orders', id), next);
      bonus.write();
      this.event(tx, actor, next, order.status, 'edited', input.discount?.reason ?? null, null);
      return s.orderDetailView.parse({ ...next, bonus: orderBonusFor(bonus.bonus) });
    });
  }
  async read(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.access.tenant(actor, tenantId, 'orders:own:read', tx);
        const order = await this.load(tx, tenantId, id);
        await this.customer(tx, ctx, order.customerId, false, order.sellerUid);
        const bonus = await readOrderBonus(this.repo, tx, tenantId, id);
        return s.orderDetailView.parse({ ...order, bonus: orderBonusFor(bonus) });
      },
      { readOnly: true },
    );
  }
  async authorizedSnapshot(tx: Transaction, actor: Actor, tenantId: string, id: string) {
    const ctx = await this.access.tenant(actor, tenantId, 'documents:own:read', tx);
    const order = await this.load(tx, tenantId, id);
    const customer = await this.customer(tx, ctx, order.customerId, false, order.sellerUid);
    await this.financialLocks.assertOrderAvailable(
      tx,
      tenantId,
      id,
      ctx.membership.role === 'seller',
    );
    // The plan decides the document identity at generation time: a downgrade never deletes
    // the stored logo, it only stops putting it (and product photos) in new documents.
    const branded = brandingAllowed(ctx.entitlements);
    return {
      order,
      bonus: await readOrderBonus(this.repo, tx, tenantId, id),
      customer,
      branded,
      tenant: {
        id: ctx.tenant.id,
        name: ctx.tenant.name,
        timezone: ctx.tenant.timezone,
        logo: branded ? ctx.tenant.logo : null,
      },
    };
  }
  async command(
    actor: Actor,
    tenantId: string,
    id: string,
    action: 'confirm' | 'dispatch' | 'cancel',
    input: z.infer<typeof s.orderCommand> | z.infer<typeof s.cancelCommand>,
    key: string,
  ) {
    const now = this.clock().toISOString(),
      operationId = digest(`orders:${key}`);
    const payloadHash = digest(stableJson({ id, action, input }));
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(
        actor,
        tenantId,
        action === 'cancel'
          ? 'orders:all:manage'
          : action === 'dispatch'
            ? 'orders:own:dispatch'
            : 'orders:own:confirm',
        tx,
      );
      const order = await this.load(tx, tenantId, id);
      const customer = await this.customer(tx, ctx, order.customerId, false, order.sellerUid);
      const operationRef = this.repo.ref(tenantId, 'orderOperations', operationId);
      const data = await this.repo.foundation.read(operationRef, s.orderOperationSchema, tx);
      let bonus = await readOrderBonus(this.repo, tx, tenantId, id);
      if (data) {
        requireCondition(
          data.actorUid === actor.uid && data.payloadHash === payloadHash && data.orderId === id,
          409,
          'CONFLICT',
          'Chave de idempotência já utilizada com outro comando',
        );
        const previous = data.result;
        requireCondition(
          previous.tenantId === tenantId && previous.id === id,
          409,
          'CONFLICT',
          'Resultado indisponível',
        );
        return s.orderDetailView.parse({
          ...previous,
          ...(bonus ? { bonus: orderBonusFor(bonus) } : {}),
        });
      }
      await this.financialLocks.assertOrderAvailable(
        tx,
        tenantId,
        id,
        ctx.membership.role === 'seller',
      );
      requireCondition(
        order.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão de pedido desatualizada',
      );
      requireCondition(
        action === 'confirm'
          ? order.status === 'draft'
          : action === 'dispatch'
            ? order.status === 'confirmed'
            : order.status === 'draft' || order.status === 'confirmed',
        409,
        'INVALID_ORDER_STATE',
        'Transição de pedido não permitida',
      );
      let next = { ...order, version: order.version + 1, updatedAt: now, updatedBy: actor.uid };
      let finance: { apply(): void } | undefined;
      let costs: OrderCostSnapshot | undefined;
      let bonusCosts: BonusCostSnapshot | undefined;
      if (action === 'confirm') {
        requireCondition(
          customer && order.payment && order.lines.length > 0,
          422,
          'INCOMPLETE_ORDER',
          'Confirmação exige cliente, linhas e condição de pagamento',
        );
        requireCondition(customer.status === 'active', 409, 'CUSTOMER_INACTIVE', 'Cliente inativo');
        if (!order.paymentTerms)
          validateDates(order.payment.dueDates, new Date(now), ctx.tenant.timezone);
        const { terms, method } = await this.selection(tx, ctx, {}, now, order);
        const lines = await this.snapshots(tx, tenantId, order.lines);
        if (order.discount) {
          const [approver, identity] = await Promise.all([
            this.repo.foundation.read(
              this.repo.foundation.tenant(tenantId, 'memberships', order.discount.approvedBy),
              membershipSchema,
              tx,
            ),
            this.repo.foundation.read(
              this.repo.foundation.global('identities', order.discount.approvedBy),
              identitySchema,
              tx,
            ),
          ]);
          requireCondition(
            approver?.uid === order.discount.approvedBy &&
              approver.tenantId === tenantId &&
              approver.status === 'active' &&
              approver.role === 'administrator' &&
              identity?.status === 'active' &&
              order.discount.approvedVersion === order.version &&
              order.discount.fingerprint ===
                approvalFingerprint(
                  customer.id,
                  order.sellerUid,
                  lines,
                  this.fingerprintPayment(order.payment, terms, method),
                ),
            409,
            'DISCOUNT_APPROVAL_REQUIRED',
            'Desconto exige nova aprovação administrativa',
          );
        }
        const pricing = priceOrder(lines, order.discount);
        requireCondition(
          pricing.totalCents > 0,
          422,
          'ORDER_TOTAL_REQUIRED',
          'Confirmação exige total final positivo',
        );
        next = {
          ...next,
          ...pricing,
          customerName: customer.name,
          installments: terms
            ? termsInstallments(id, pricing.totalCents, terms)
            : installmentsFor(id, pricing.totalCents, order.payment.dueDates),
          ...(terms
            ? {
                paymentTerms: terms,
                payment: {
                  type: terms.dueDates.length === 1 ? ('cash' as const) : ('installments' as const),
                  dueDates: terms.dueDates,
                },
              }
            : {}),
          status: 'confirmed',
          confirmedAt: now,
          confirmedBy: actor.uid,
        };
        finance = await this.financial.prepare(tx, next, 'confirm', now);
        // Sold cost is frozen with the sale: later receipts never restate past margins.
        if (hasFeature(ctx.entitlements, 'costing.products'))
          costs = await orderCostSnapshot(this.repo, tx, tenantId, id, next.lines, now);
        if (bonus) {
          await this.bonusAuthorized(tx, ctx, bonus);
          const refreshed = await this.snapshots(tx, tenantId, bonus.lines);
          bonus = {
            ...bonus,
            customerId: customer.id,
            customerName: customer.name,
            responsibleUid: order.sellerUid,
            lines: refreshed.map(bonusLine),
            linePrices: linePrices(refreshed),
          };
          if (hasFeature(ctx.entitlements, 'costing.products'))
            bonusCosts = await bonusCostSnapshot(this.repo, tx, tenantId, id, bonus.lines, now);
        }
      } else if (action === 'dispatch')
        next = {
          ...next,
          status: 'dispatched',
          dispatchedAt: now,
          dispatchedBy: actor.uid,
          dispatchReference: digest(`dispatch:${tenantId}:${id}`),
        };
      else {
        next = { ...next, status: 'canceled', canceledAt: now, canceledBy: actor.uid };
        if (order.status === 'confirmed')
          finance = await this.financial.prepare(tx, order, 'cancel', now);
      }
      const prepared =
        action === 'cancel' && order.status === 'draft'
          ? undefined
          : await this.stock.prepare(tx, {
              context: ctx,
              orderId: id,
              orderVersion: order.version,
              operationKey: key,
              occurredAt: now,
              type:
                action === 'confirm'
                  ? 'STOCK_RESERVATION'
                  : action === 'dispatch'
                    ? 'STOCK_DISPATCH'
                    : 'STOCK_RESERVATION_RELEASE',
              items: next.lines.map((l) => ({
                lineId: l.id,
                productId: l.productId,
                quantityScaled: parseQuantity(l.quantity, l.unit),
                reservationId: reservationIdFor(tenantId, id, l.id, l.productId),
              })),
            });
      const validated = s.orderSchema.parse(next);
      const operation = {
        actorUid: actor.uid,
        orderId: id,
        payloadHash,
        result: validated,
        createdAt: now,
        schemaVersion: 1,
      };
      assertDocumentFits(this.repo.ref(tenantId, 'orders', id).path, validated);
      assertDocumentFits(operationRef.path, operation);
      // All preparation above only reads. No external effect belongs inside this callback.
      prepared?.apply();
      finance?.apply();
      if (costs) tx.set(this.repo.ref(tenantId, 'orderCostSnapshots', id), costs);
      if (bonusCosts) tx.set(this.repo.ref(tenantId, 'bonusCostSnapshots', id), bonusCosts);
      if (bonus)
        bonus = followOrder(
          this.repo,
          tx,
          actor,
          bonus,
          validated,
          'reason' in input ? input.reason : null,
          operationId,
        );
      tx.set(this.repo.ref(tenantId, 'orders', id), validated);
      this.event(
        tx,
        actor,
        validated,
        order.status,
        action === 'confirm' ? 'confirmed' : action === 'dispatch' ? 'dispatched' : 'canceled',
        'reason' in input ? input.reason : null,
        operationId,
      );
      tx.create(operationRef, operation);
      return s.orderDetailView.parse({
        ...validated,
        ...(bonus ? { bonus: orderBonusFor(bonus) } : {}),
      });
    });
  }
  async list(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.orderQuery>,
    requirePublished = false,
  ) {
    return this.repo.foundation.readBudget.run(() =>
      this.listPage(actor, tenantId, input, requirePublished),
    );
  }
  private async listPage(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.orderQuery>,
    requirePublished: boolean,
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.access.tenant(actor, tenantId, 'orders:own:read', tx);
        const isSeller = ctx.membership.role === 'seller';
        let query: Query = this.repo.ref(tenantId, 'orders', 'placeholder').parent;
        if (isSeller) query = query.where('sellerUid', '==', actor.uid);
        if (input.status) query = query.where('status', '==', input.status);
        if (input.customerId) {
          await this.customer(tx, ctx, input.customerId, false);
          query = query.where('customerId', '==', input.customerId);
        }
        const scope = digest(
          stableJson({
            tenantId,
            actor: actor.uid,
            isSeller,
            input: { ...input, cursor: undefined },
          }),
        );
        const direction = input.direction ?? 'desc';
        query = query.orderBy('createdAt', direction).orderBy(FieldPath.documentId(), direction);
        const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
        if (cursor) {
          const order = await this.load(tx, tenantId, cursor);
          requireCondition(
            !isSeller || order.sellerUid === actor.uid,
            422,
            'VALIDATION_ERROR',
            'Cursor indisponível',
          );
          query = query.startAfter(order.createdAt, cursor);
        }
        const limit = Number(input.limit ?? '25'),
          page = await tx.get(query.select('createdAt').limit(limit + 1));
        const docs = page.docs.slice(0, limit);
        const candidates: (z.infer<typeof s.orderView> | null)[] = [];
        for (const doc of docs) {
          checkReadBudget();
          candidates.push(
            await (async () => {
              const order = await this.repo.foundation.read(doc.ref, s.orderSchema, tx);
              requireCondition(order, 500, 'INTERNAL_ERROR', 'Erro interno do servidor');
              requireCondition(
                order.id === doc.id && order.tenantId === tenantId,
                500,
                'INTERNAL_ERROR',
                'Erro interno do servidor',
              );
              if (requirePublished)
                await this.financialLocks.assertOrderAvailable(tx, tenantId, order.id, isSeller);
              if (isSeller) {
                if (order.sellerUid !== actor.uid) return null;
                if (order.customerId === null) return s.orderView.parse(order);
                const customer = await this.repo.foundation.read(
                  this.repo.ref(tenantId, 'customers', order.customerId),
                  customerSchema,
                  tx,
                );
                if (
                  order.sellerUid !== actor.uid ||
                  customer?.tenantId !== tenantId ||
                  customer.id !== order.customerId ||
                  customer.assignedTo !== actor.uid
                )
                  return null;
              }
              return s.orderView.parse(order);
            })(),
          );
        }
        return {
          items: candidates.filter((v) => v !== null),
          nextCursor:
            page.size > limit
              ? encodeCursor(this.repo.secret, scope, docs[docs.length - 1]!.id)
              : null,
        };
      },
      { readOnly: true },
    );
  }
  async history(actor: Actor, tenantId: string, id: string, input: z.infer<typeof pageQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.access.tenant(actor, tenantId, 'orders:own:read', tx);
        const order = await this.load(tx, tenantId, id);
        await this.customer(tx, ctx, order.customerId, false, order.sellerUid);
        const scope = digest(
          stableJson({ tenantId, actor: actor.uid, id, kind: 'history', limit: input.limit }),
        );
        let query: Query = this.repo
          .ref(tenantId, 'orderEvents', 'placeholder')
          .parent.where('orderId', '==', id)
          .orderBy('version')
          .orderBy(FieldPath.documentId());
        const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
        if (cursor) {
          const event = await this.repo.foundation.read(
            this.repo.ref(tenantId, 'orderEvents', cursor),
            s.orderEventSchema,
            tx,
          );
          requireCondition(
            event?.tenantId === tenantId && event.orderId === id,
            422,
            'VALIDATION_ERROR',
            'Cursor indisponível',
          );
          query = query.startAfter(event.version, cursor);
        }
        const limit = Number(input.limit ?? '25'),
          page = await tx.get(query.limit(limit + 1));
        const docs = page.docs.slice(0, limit);
        return {
          items: docs.map((doc) => {
            const parsed = s.orderEventSchema.safeParse(doc.data());
            requireCondition(parsed.success, 500, 'INTERNAL_ERROR', 'Erro interno do servidor');
            const event = parsed.data;
            requireCondition(
              event.id === doc.id && event.tenantId === tenantId && event.orderId === id,
              500,
              'INTERNAL_ERROR',
              'Erro interno do servidor',
            );
            return s.orderEvent.parse(event);
          }),
          nextCursor:
            page.size > limit
              ? encodeCursor(this.repo.secret, scope, docs[docs.length - 1]!.id)
              : null,
        };
      },
      { readOnly: true },
    );
  }
}
