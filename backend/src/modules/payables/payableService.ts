import { randomUUID } from 'node:crypto';
import { FieldPath, type Query, type Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor, TenantContext } from '../../shared/types/context.js';
import * as s from '../../shared/schemas/management.js';
import { customerSchema } from '../../shared/schemas/commercial.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
import { cursorPage } from '../../shared/operations/cursorPage.js';
import type { FinancialCommands } from '../finance/financialCommands.js';
import type { PaymentSettingsService } from '../finance/paymentSettingsService.js';
import { companyDate } from '../orders/calculation.js';
import { canceledTitle, manualTitle, situationOf, titleStatus } from './titles.js';

const lockedForPurchase = [
  'beneficiaryId',
  'beneficiaryName',
  'categoryId',
  'description',
] as const;

/**
 * Accounts payable. A title keeps its original value; payments live in their own records, and a
 * reversal marks one of them instead of erasing it. Paying money is unrelated to receiving goods.
 */
export class PayableService {
  constructor(
    readonly commands: FinancialCommands,
    readonly paymentSettings: PaymentSettingsService,
  ) {}
  private get repo() {
    return this.commands.repo;
  }
  private today(ctx: TenantContext) {
    return companyDate(this.commands.clock(), ctx.tenant.timezone);
  }
  view(title: s.Payable, today: string) {
    return s.payableView.parse({ ...title, situation: situationOf(title, today) });
  }
  private async load(tx: Transaction, tenantId: string, id: string) {
    const title = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'payables', id),
      s.payableSchema,
      tx,
    );
    requireCondition(
      title?.id === id && title.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return title;
  }
  /** Beneficiary: a record of the company, or a free name such as a landlord or an employee. */
  async beneficiary(
    tx: Transaction,
    tenantId: string,
    id: string | null | undefined,
    name: string | null | undefined,
  ) {
    if (!id) return { beneficiaryId: null, beneficiaryName: name?.trim() || null };
    const record = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'customers', id),
      customerSchema,
      tx,
    );
    requireCondition(
      record?.tenantId === tenantId && record.id === id,
      422,
      'INVALID_BENEFICIARY',
      'Beneficiário indisponível nesta empresa',
    );
    return { beneficiaryId: record.id, beneficiaryName: record.name };
  }
  async category(tx: Transaction, tenantId: string, id: string | null | undefined) {
    if (!id) return { categoryId: null, categoryName: null };
    const category = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'expenseCategories', id),
      s.expenseCategorySchema,
      tx,
    );
    requireCondition(
      category?.tenantId === tenantId && category.id === id && category.status === 'active',
      422,
      'INVALID_CATEGORY',
      'Categoria indisponível nesta empresa',
    );
    return { categoryId: category.id, categoryName: category.name };
  }
  async get(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.commands.access.tenant(actor, tenantId, 'payables:read', tx);
        return this.view(await this.load(tx, tenantId, id), this.today(ctx));
      },
      { readOnly: true },
    );
  }
  async list(actor: Actor, tenantId: string, input: z.infer<typeof s.payableQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.commands.access.tenant(actor, tenantId, 'payables:read', tx);
        const today = this.today(ctx);
        const situation = input.situation ?? 'open';
        const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000)
          .toISOString()
          .slice(0, 10);
        let query: Query = this.repo.ref(tenantId, 'payables', 'placeholder').parent;
        if (situation === 'open' || situation === 'overdue')
          query = query.where('hasBalance', '==', true);
        else if (situation !== 'all') query = query.where('status', '==', situation);
        if (input.beneficiaryId) query = query.where('beneficiaryId', '==', input.beneficiaryId);
        if (input.categoryId) query = query.where('categoryId', '==', input.categoryId);
        if (input.origin) query = query.where('origin', '==', input.origin);
        if (input.originReference)
          query = query.where('originReference', '==', input.originReference);
        if (input.from) query = query.where('dueDate', '>=', input.from);
        const to =
          situation === 'overdue' && (!input.to || input.to > yesterday) ? yesterday : input.to;
        if (to) query = query.where('dueDate', '<=', to);
        const page = await cursorPage({
          repo: this.repo,
          tx,
          tenantId,
          collection: 'payables',
          scope: digest(stableJson({ actor: actor.uid, tenantId, ...input, cursor: undefined })),
          query: query.orderBy('dueDate').orderBy(FieldPath.documentId()),
          input,
          schema: s.payableSchema,
        });
        return { items: page.items.map((t) => this.view(t, today)), nextCursor: page.nextCursor };
      },
      { readOnly: true },
    );
  }
  async payments(actor: Actor, tenantId: string, input: z.infer<typeof s.payablePaymentQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'payables:read', tx);
        let query: Query = this.repo.ref(tenantId, 'payablePayments', 'placeholder').parent;
        if (input.payableId) query = query.where('payableId', '==', input.payableId);
        if (input.from) query = query.where('paidOn', '>=', input.from);
        if (input.to) query = query.where('paidOn', '<=', input.to);
        return cursorPage({
          repo: this.repo,
          tx,
          tenantId,
          collection: 'payablePayments',
          scope: digest(stableJson({ actor: actor.uid, tenantId, ...input, cursor: undefined })),
          query: query.orderBy('paidOn', 'desc').orderBy(FieldPath.documentId(), 'desc'),
          input,
          schema: s.payablePaymentSchema,
        });
      },
      { readOnly: true },
    );
  }
  create(actor: Actor, tenantId: string, input: z.infer<typeof s.payableCreate>, key: string) {
    const id = randomUUID();
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'payable.create',
      'new',
      input,
      'payables:manage',
      s.payableView,
      false,
      async (tx, ctx, _operationId, now) => {
        const today = this.today(ctx);
        const title = manualTitle({
          id,
          tenantId,
          origin: input.kind,
          ...(await this.beneficiary(tx, tenantId, input.beneficiaryId, input.beneficiaryName)),
          ...(await this.category(tx, tenantId, input.categoryId)),
          description: input.description,
          amountCents: input.amountCents,
          issueDate: input.issueDate ?? today,
          dueDate: input.dueDate,
          notes: input.notes ?? '',
          actor,
          now,
        });
        tx.create(this.repo.ref(tenantId, 'payables', id), title);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'payable.created', id, now, {
          origin: title.origin,
          originalCents: title.originalCents,
        });
        return this.view(title, today);
      },
    );
  }
  update(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.payableUpdate>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'payable.update',
      id,
      input,
      'payables:manage',
      s.payableView,
      false,
      async (tx, ctx, _operationId, now) => {
        const title = await this.load(tx, tenantId, id);
        requireCondition(
          title.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão desatualizada',
        );
        requireCondition(
          title.hasBalance,
          409,
          'PAYABLE_CLOSED',
          'Título quitado ou cancelado não pode ser alterado',
        );
        if (title.origin === 'purchase')
          requireCondition(
            input.amountCents === undefined &&
              lockedForPurchase.every((field) => input[field] === undefined),
            409,
            'PAYABLE_ORIGIN_LOCKED',
            'Título de compra só permite corrigir vencimento e observações',
          );
        requireCondition(
          input.amountCents === undefined || title.paidCents === 0,
          409,
          'PAYABLE_HAS_PAYMENTS',
          'Título com pagamento não permite alterar o valor',
        );
        const beneficiary =
          input.beneficiaryId !== undefined || input.beneficiaryName !== undefined
            ? await this.beneficiary(tx, tenantId, input.beneficiaryId, input.beneficiaryName)
            : {};
        const category =
          input.categoryId !== undefined ? await this.category(tx, tenantId, input.categoryId) : {};
        const amount = input.amountCents ?? title.originalCents;
        const next = s.payableSchema.parse({
          ...title,
          ...beneficiary,
          ...category,
          description: input.description ?? title.description,
          dueDate: input.dueDate ?? title.dueDate,
          notes: input.notes ?? title.notes,
          originalCents: amount,
          outstandingCents: amount - title.paidCents - title.canceledCents,
          version: title.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        tx.set(this.repo.ref(tenantId, 'payables', id), next);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'payable.updated', id, now, {
          reason: input.reason,
          previous: {
            dueDate: title.dueDate,
            originalCents: title.originalCents,
            description: title.description,
          },
          next: {
            dueDate: next.dueDate,
            originalCents: next.originalCents,
            description: next.description,
          },
        });
        return this.view(next, this.today(ctx));
      },
    );
  }
  cancel(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.payableCancel>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'payable.cancel',
      id,
      input,
      'payables:manage',
      s.payableView,
      false,
      async (tx, ctx, _operationId, now) => {
        const title = await this.load(tx, tenantId, id);
        requireCondition(
          title.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão desatualizada',
        );
        requireCondition(
          title.origin !== 'purchase',
          409,
          'PAYABLE_ORIGIN_LOCKED',
          'Título de compra é cancelado pela própria compra',
        );
        requireCondition(title.status !== 'canceled', 409, 'PAYABLE_CLOSED', 'Título já cancelado');
        requireCondition(
          title.paidCents === 0,
          409,
          'PAYABLE_HAS_PAYMENTS',
          'Estorne os pagamentos antes de cancelar o título',
        );
        const next = canceledTitle(title, actor, input.reason, now);
        tx.set(this.repo.ref(tenantId, 'payables', id), next);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'payable.canceled', id, now, {
          reason: input.reason,
          originalCents: title.originalCents,
        });
        return this.view(next, this.today(ctx));
      },
    );
  }
  pay(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.payablePaymentInput>,
    key: string,
  ) {
    const paymentId = randomUUID();
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'payable.pay',
      id,
      input,
      'payables:pay',
      s.payablePaymentResult,
      false,
      async (tx, ctx, _operationId, now) => {
        const today = this.today(ctx);
        const title = await this.load(tx, tenantId, id);
        requireCondition(
          title.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão desatualizada',
        );
        requireCondition(title.hasBalance, 409, 'PAYABLE_CLOSED', 'Título sem saldo em aberto');
        requireCondition(
          input.principalCents <= title.outstandingCents,
          409,
          'PAYMENT_EXCEEDS_BALANCE',
          'Pagamento acima do saldo em aberto',
        );
        requireCondition(
          input.paidOn <= today,
          422,
          'INVALID_PAYMENT_DATE',
          'O pagamento não pode ter data futura',
        );
        const interestCents = input.interestCents ?? 0;
        const penaltyCents = input.penaltyCents ?? 0;
        const discountCents = input.discountCents ?? 0;
        const gross = input.principalCents + interestCents + penaltyCents;
        requireCondition(
          discountCents <= gross,
          422,
          'INVALID_DISCOUNT',
          'Desconto acima do valor pago',
        );
        const method = await this.paymentSettings.activeMethod(
          tx,
          tenantId,
          input.methodId,
          input.methodVersion,
        );
        const paidCents = title.paidCents + input.principalCents;
        const outstandingCents = title.outstandingCents - input.principalCents;
        const next = s.payableSchema.parse({
          ...title,
          paidCents,
          outstandingCents,
          hasBalance: outstandingCents > 0,
          status: titleStatus({ outstandingCents, paidCents }),
          paidOn: outstandingCents === 0 ? input.paidOn : null,
          paymentCount: title.paymentCount + 1,
          version: title.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        const payment = s.payablePaymentSchema.parse({
          id: paymentId,
          tenantId,
          payableId: id,
          beneficiaryName: title.beneficiaryName,
          description: title.description,
          origin: title.origin,
          principalCents: input.principalCents,
          interestCents,
          penaltyCents,
          discountCents,
          cashCents: gross - discountCents,
          paidOn: input.paidOn,
          method,
          notes: input.notes ?? '',
          status: 'active',
          recordedAt: now,
          createdBy: actor.uid,
          reversedAt: null,
          reversedBy: null,
          reversalReason: null,
          requestId: actor.requestId,
          schemaVersion: 1,
        });
        tx.set(this.repo.ref(tenantId, 'payables', id), next);
        tx.create(this.repo.ref(tenantId, 'payablePayments', paymentId), payment);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'payable.paid', id, now, {
          paymentId,
          principalCents: payment.principalCents,
          cashCents: payment.cashCents,
        });
        return s.payablePaymentResult.parse({ payable: this.view(next, today), payment });
      },
    );
  }
  reverse(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.paymentReversalInput>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'payable.reverse',
      id,
      input,
      'payables:reverse',
      s.payablePaymentResult,
      false,
      async (tx, ctx, _operationId, now) => {
        const payment = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'payablePayments', id),
          s.payablePaymentSchema,
          tx,
        );
        requireCondition(
          payment?.id === id && payment.tenantId === tenantId,
          404,
          'RESOURCE_NOT_FOUND',
          'Recurso não encontrado',
        );
        requireCondition(
          payment.status === 'active',
          409,
          'PAYMENT_ALREADY_REVERSED',
          'Pagamento já estornado',
        );
        const title = await this.load(tx, tenantId, payment.payableId);
        const paidCents = title.paidCents - payment.principalCents;
        const outstandingCents = title.outstandingCents + payment.principalCents;
        const next = s.payableSchema.parse({
          ...title,
          paidCents,
          outstandingCents,
          hasBalance: true,
          status: titleStatus({ outstandingCents, paidCents }),
          paidOn: null,
          paymentCount: title.paymentCount - 1,
          version: title.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        const reversed = s.payablePaymentSchema.parse({
          ...payment,
          status: 'reversed',
          reversedAt: now,
          reversedBy: actor.uid,
          reversalReason: input.reason,
        });
        tx.set(this.repo.ref(tenantId, 'payables', title.id), next);
        tx.set(this.repo.ref(tenantId, 'payablePayments', id), reversed);
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          'payable.payment.reversed',
          title.id,
          now,
          {
            paymentId: id,
            reason: input.reason,
            principalCents: payment.principalCents,
          },
        );
        return s.payablePaymentResult.parse({
          payable: this.view(next, this.today(ctx)),
          payment: reversed,
        });
      },
    );
  }
}
