import type { z } from 'zod';
import type { Transaction } from 'firebase-admin/firestore';
import * as s from '../../shared/schemas/finance.js';
import type { Actor } from '../../shared/types/context.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { companyDate } from '../orders/calculation.js';
import { FinancialCommands } from './financialCommands.js';
import { FinancialBook, type Book } from './financialBook.js';
import { PaymentSettingsService } from './paymentSettingsService.js';
import type { OrderStockPort } from '../inventory/orderStockContract.js';
import { assertDocumentFits } from '../orders/technicalSize.js';
import { FieldPath } from 'firebase-admin/firestore';
import { orderSchema, orderEventSchema } from '../../shared/schemas/orders.js';
import { digest } from '../../shared/utils/crypto.js';
import { reservationIdFor } from '../inventory/orderStockAdapter.js';
import { parseQuantity } from '../inventory/quantities.js';
import { financialEventHash, receivableBasis } from './financialBook.js';
import { receivableSchema } from '../receivables/orderReceivables.js';
import { recordAudit } from '../../shared/audit/audit.js';
import type { SourceChange } from './resolution/sourceIndex.js';
export class FinancialService {
  readonly book: FinancialBook;
  constructor(
    readonly commands: FinancialCommands,
    readonly settings: PaymentSettingsService,
    readonly stock: OrderStockPort,
  ) {
    this.book = new FinancialBook(commands.repo);
  }
  get repo() {
    return this.commands.repo;
  }
  validateAmount(amount: number, allocations: z.infer<typeof s.allocationsInput>) {
    requireCondition(
      amount === allocations.reduce((a, r) => a + r.amountCents, 0),
      422,
      'INVALID_ALLOCATION',
      'Alocações devem somar o valor informado',
    );
  }
  allocate(
    book: Book,
    allocations: z.infer<typeof s.allocationsInput>,
    kind: 'cashCents' | 'creditCents',
    now: string,
    direction: 1 | -1 = 1,
  ) {
    const titles = book.titles.map((t) => ({ ...t }));
    for (const allocation of allocations) {
      const title = titles.find((t) => t.id === allocation.receivableId);
      requireCondition(title, 404, 'RESOURCE_NOT_FOUND', 'Título não pertence a este pedido');
      requireCondition(
        title.version === allocation.expectedVersion,
        409,
        'CONFLICT',
        'Versão de título desatualizada',
      );
      requireCondition(
        direction === 1
          ? title.outstandingCents >= allocation.amountCents
          : title[kind] >= allocation.amountCents,
        409,
        'EXCESS_PAYMENT',
        'Valor excede saldo ou liquidação reversível',
      );
      title.outstandingCents -= direction * allocation.amountCents;
      title[kind] += direction * allocation.amountCents;
      title.version++;
      title.updatedAt = now;
    }
    return titles;
  }
  receipt(
    actor: Actor,
    tenantId: string,
    orderId: string,
    input: z.infer<typeof s.receiptInput>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'receipt',
      orderId,
      input,
      'payments:manage',
      s.financialResult,
      false,
      async (tx, ctx, operationId, now) => {
        const book = await this.book.load(tx, tenantId, orderId);
        this.book.assertVersions(book, input);
        this.book.assertOpen(book);
        requireCondition(
          book.order.customerId === input.customerId,
          404,
          'RESOURCE_NOT_FOUND',
          'Cliente não corresponde ao pedido',
        );
        requireCondition(
          input.receivedOn <= companyDate(new Date(now), ctx.tenant.timezone),
          422,
          'INVALID_PAYMENT_DATE',
          'Recebimento não pode ter data futura',
        );
        this.validateAmount(input.amountCents, input.allocations);
        requireCondition(
          input.amountCents <= book.titles.reduce((a, t) => a + t.outstandingCents, 0),
          409,
          'EXCESS_PAYMENT',
          'Recebimento superior ao saldo devido',
        );
        const method = await this.settings.activeMethod(
          tx,
          tenantId,
          input.methodId,
          input.methodVersion,
        );
        const titles = this.allocate(book, input.allocations, 'cashCents', now);
        const payment = s.paymentSchema.parse({
          id: operationId,
          tenantId,
          orderId,
          customerId: input.customerId,
          amountCents: input.amountCents,
          reversedCents: 0,
          transferredCents: 0,
          allocations: input.allocations.map((a) => ({
            receivableId: a.receivableId,
            amountCents: a.amountCents,
            remainingCents: a.amountCents,
          })),
          method,
          receivedOn: input.receivedOn,
          recordedAt: now,
          createdBy: actor.uid,
          reference: input.reference ?? '',
          version: 1,
          schemaVersion: 1,
        });
        assertDocumentFits(this.repo.ref(tenantId, 'payments', operationId).path, payment);
        const state = {
          ...book.state,
          cashReceivedCents: book.state.cashReceivedCents + input.amountCents,
          cashSettledCents: book.state.cashSettledCents + input.amountCents,
        };
        const projection = await this.book.sources.prepare(tx, book, [
          { kind: 'cash', before: null, after: payment },
        ]);
        tx.create(this.repo.ref(tenantId, 'payments', operationId), payment);
        const result = this.book.save(
          tx,
          book,
          actor,
          operationId,
          now,
          'receipt',
          input.amountCents,
          input.reason,
          titles,
          state,
          [operationId],
          projection,
        );
        return { ...result, resourceId: operationId };
      },
    );
  }
  async paymentFor(tx: Transaction, tenantId: string, id: string) {
    const payment = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'payments', id),
      s.paymentSchema,
      tx,
    );
    requireCondition(
      payment?.id === id && payment.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return payment;
  }
  async assertAtomicResolutionFits(tx: Transaction, book: Book) {
    for (const collection of ['payments', 'creditApplications'] as const) {
      const page = await tx.get(
        this.repo
          .ref(book.order.tenantId, collection, 'placeholder')
          .parent.where('orderId', '==', book.order.id)
          .limit(101),
      );
      requireCondition(
        page.size <= 100,
        409,
        'FINANCIAL_RESUMABLE_REQUIRED',
        'Histórico exige endpoint financeiro retomável',
      );
    }
  }
  paymentReversal(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.reversalInput>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'payment_reversal',
      id,
      input,
      'payments:reverse',
      s.financialResult,
      true,
      async (tx, _ctx, op, now) => {
        const payment = await this.paymentFor(tx, tenantId, id),
          book = await this.book.load(tx, tenantId, payment.orderId);
        this.book.assertVersions(book, input);
        this.book.assertOpen(book);
        this.validateAmount(input.amountCents, input.allocations);
        requireCondition(
          payment.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão do recebimento desatualizada',
        );
        const allocations = this.reverseAllocations(payment.allocations, input.allocations);
        const titles = this.allocate(book, input.allocations, 'cashCents', now, -1);
        const next = s.paymentSchema.parse({
          ...payment,
          allocations,
          reversedCents: payment.reversedCents + input.amountCents,
          version: payment.version + 1,
        });
        const projection = await this.book.sources.prepare(tx, book, [
          { kind: 'cash', before: payment, after: next },
        ]);
        tx.set(this.repo.ref(tenantId, 'payments', id), next);
        return {
          ...this.book.save(
            tx,
            book,
            actor,
            op,
            now,
            'payment_reversal',
            input.amountCents,
            input.reason,
            titles,
            {
              ...book.state,
              cashReceivedCents: book.state.cashReceivedCents - input.amountCents,
              cashSettledCents: book.state.cashSettledCents - input.amountCents,
            },
            [id],
            projection,
          ),
          resourceId: id,
        };
      },
    );
  }
  reverseAllocations(
    previous: z.infer<typeof s.allocation>[],
    input: z.infer<typeof s.allocationsInput>,
  ) {
    const rows = previous.map((a) => ({ ...a }));
    for (const a of input) {
      const row = rows.find((r) => r.receivableId === a.receivableId);
      requireCondition(
        row && row.remainingCents >= a.amountCents,
        409,
        'REVERSAL_LIMIT',
        'Valor excede alocação ainda reversível',
      );
      row.remainingCents -= a.amountCents;
    }
    return rows;
  }
  async lotFor(tx: Transaction, tenantId: string, id: string) {
    await this.commands.locks.assertLotAvailable(tx, tenantId, id);
    const lot = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'creditLots', id),
      s.lotSchema,
      tx,
    );
    requireCondition(
      lot?.id === id && lot.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Crédito não encontrado',
    );
    const event = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'financialEvents', lot.originReference),
      s.eventSchema,
      tx,
    );
    const source = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'orders', lot.originOrderId),
      orderSchema,
      tx,
    );
    requireCondition(
      source?.tenantId === tenantId &&
        source.customerId === lot.customerId &&
        event?.tenantId === tenantId &&
        event.orderId === lot.originOrderId &&
        event.customerId === lot.customerId &&
        event.references.includes(id) &&
        event.hash === financialEventHash(event) &&
        event.after.transferredCashCents - event.before.transferredCashCents === lot.issuedCents &&
        (lot.origin === 'order_cancellation'
          ? event.type === 'financial_cancellation'
          : event.type === 'return_resolved'),
      409,
      'CREDIT_ORIGIN_INVALID',
      'Origem de crédito não comprovada',
    );
    return lot;
  }
  creditApplication(
    actor: Actor,
    tenantId: string,
    orderId: string,
    input: z.infer<typeof s.creditInput>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'credit_application',
      orderId,
      input,
      'payments:manage',
      s.financialResult,
      false,
      async (tx, _ctx, op, now) => {
        const book = await this.book.load(tx, tenantId, orderId);
        this.book.assertVersions(book, input);
        this.book.assertOpen(book);
        this.validateAmount(input.amountCents, input.allocations);
        const lot = await this.lotFor(tx, tenantId, input.creditLotId);
        requireCondition(
          book.order.customerId === input.customerId && lot.customerId === input.customerId,
          404,
          'RESOURCE_NOT_FOUND',
          'Crédito não pertence ao cliente do pedido',
        );
        requireCondition(
          lot.version === input.expectedLotVersion,
          409,
          'CONFLICT',
          'Versão do crédito desatualizada',
        );
        requireCondition(
          lot.availableCents >= input.amountCents,
          409,
          'CREDIT_LIMIT',
          'Saldo de crédito insuficiente',
        );
        const titles = this.allocate(book, input.allocations, 'creditCents', now);
        const credit = s.creditSchema.parse({
          id: op,
          tenantId,
          orderId,
          customerId: input.customerId,
          creditLotId: lot.id,
          amountCents: input.amountCents,
          reversedCents: 0,
          restoredByCancellationCents: 0,
          allocations: input.allocations.map((a) => ({
            receivableId: a.receivableId,
            amountCents: a.amountCents,
            remainingCents: a.amountCents,
          })),
          status: 'active',
          version: 1,
          createdAt: now,
          createdBy: actor.uid,
          schemaVersion: 1,
        });
        const projection = await this.book.sources.prepare(tx, book, [
          { kind: 'credit', before: null, after: credit },
        ]);
        tx.set(
          this.repo.ref(tenantId, 'creditLots', lot.id),
          s.lotSchema.parse({
            ...lot,
            availableCents: lot.availableCents - input.amountCents,
            appliedCents: lot.appliedCents + input.amountCents,
            version: lot.version + 1,
            updatedAt: now,
          }),
        );
        tx.create(this.repo.ref(tenantId, 'creditApplications', op), credit);
        return {
          ...this.book.save(
            tx,
            book,
            actor,
            op,
            now,
            'credit_application',
            input.amountCents,
            input.reason,
            titles,
            {
              ...book.state,
              creditSettledCents: book.state.creditSettledCents + input.amountCents,
            },
            [op, lot.id],
            projection,
          ),
          resourceId: op,
          creditLotId: lot.id,
        };
      },
    );
  }
  async creditFor(tx: Transaction, tenantId: string, id: string) {
    const credit = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'creditApplications', id),
      s.creditSchema,
      tx,
    );
    requireCondition(
      credit?.tenantId === tenantId && credit.id === id,
      404,
      'RESOURCE_NOT_FOUND',
      'Aplicação não encontrada',
    );
    return credit;
  }
  creditReversal(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.creditReversalInput>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'credit_reversal',
      id,
      input,
      'payments:reverse',
      s.financialResult,
      true,
      async (tx, _ctx, op, now) => {
        const credit = await this.creditFor(tx, tenantId, id),
          book = await this.book.load(tx, tenantId, credit.orderId);
        this.book.assertVersions(book, input);
        this.book.assertOpen(book);
        this.validateAmount(input.amountCents, input.allocations);
        const lot = await this.lotFor(tx, tenantId, credit.creditLotId);
        requireCondition(
          credit.version === input.expectedVersion && lot.version === input.expectedLotVersion,
          409,
          'CONFLICT',
          'Versão de crédito desatualizada',
        );
        const allocations = this.reverseAllocations(credit.allocations, input.allocations),
          titles = this.allocate(book, input.allocations, 'creditCents', now, -1);
        const remaining = allocations.reduce((a, r) => a + r.remainingCents, 0);
        const nextCredit = s.creditSchema.parse({
          ...credit,
          allocations,
          reversedCents: credit.reversedCents + input.amountCents,
          status: remaining ? 'active' : 'reversed',
          version: credit.version + 1,
        });
        const projection = await this.book.sources.prepare(tx, book, [
          { kind: 'credit', before: credit, after: nextCredit },
        ]);
        tx.set(this.repo.ref(tenantId, 'creditApplications', id), nextCredit);
        tx.set(
          this.repo.ref(tenantId, 'creditLots', lot.id),
          s.lotSchema.parse({
            ...lot,
            availableCents: lot.availableCents + input.amountCents,
            appliedCents: lot.appliedCents - input.amountCents,
            version: lot.version + 1,
            updatedAt: now,
          }),
        );
        return {
          ...this.book.save(
            tx,
            book,
            actor,
            op,
            now,
            'credit_reversal',
            input.amountCents,
            input.reason,
            titles,
            {
              ...book.state,
              creditSettledCents: book.state.creditSettledCents - input.amountCents,
            },
            [id, lot.id],
            projection,
          ),
          resourceId: id,
          creditLotId: lot.id,
        };
      },
    );
  }
  async activeCredits(tx: Transaction, tenantId: string, orderId: string) {
    const values: z.infer<typeof s.creditSchema>[] = [];
    let after: string | undefined;
    for (;;) {
      let query = this.repo
        .ref(tenantId, 'creditApplications', 'placeholder')
        .parent.where('orderId', '==', orderId)
        .where('status', '==', 'active')
        .orderBy(FieldPath.documentId())
        .limit(100);
      if (after) query = query.startAfter(after);
      const page = await tx.get(query);
      for (const doc of page.docs) {
        const value = await this.repo.foundation.readSnapshot(doc, s.creditSchema, tx);
        requireCondition(
          value && value.id === doc.id && value.orderId === orderId && value.tenantId === tenantId,
          409,
          'FINANCIAL_INTEGRITY',
          'Aplicação de crédito inconsistente',
        );
        values.push(value);
      }
      if (page.size < 100) break;
      after = page.docs[page.size - 1]!.id;
    }
    return values;
  }
  async settlementSources(tx: Transaction, book: Book) {
    const credits = await this.activeCredits(tx, book.order.tenantId, book.order.id);
    const lotIds = [...new Set(credits.map((c) => c.creditLotId))],
      lots = new Map<string, z.infer<typeof s.lotSchema>>();
    for (const id of lotIds) lots.set(id, await this.lotFor(tx, book.order.tenantId, id));
    requireCondition(
      credits.every((c) => c.customerId === book.order.customerId) &&
        credits.reduce((a, c) => a + c.allocations.reduce((b, r) => b + r.remainingCents, 0), 0) ===
          book.state.creditSettledCents,
      409,
      'FINANCIAL_INTEGRITY',
      'Fontes de crédito divergem dos títulos',
    );
    for (const title of book.titles)
      requireCondition(
        credits.reduce(
          (a, c) =>
            a +
            c.allocations
              .filter((r) => r.receivableId === title.id)
              .reduce((b, r) => b + r.remainingCents, 0),
          0,
        ) === title.creditCents,
        409,
        'FINANCIAL_INTEGRITY',
        'Alocações de crédito divergem do título',
      );
    return { credits, lots };
  }
  async cashSources(tx: Transaction, book: Book) {
    const values: z.infer<typeof s.paymentSchema>[] = [];
    let after: string | undefined;
    for (;;) {
      let query = this.repo
        .ref(book.order.tenantId, 'payments', 'placeholder')
        .parent.where('orderId', '==', book.order.id)
        .orderBy(FieldPath.documentId())
        .limit(100);
      if (after) query = query.startAfter(after);
      const page = await tx.get(query);
      for (const d of page.docs) {
        const value = await this.repo.foundation.readSnapshot(d, s.paymentSchema, tx);
        requireCondition(
          value &&
            value.id === d.id &&
            value.tenantId === book.order.tenantId &&
            value.orderId === book.order.id &&
            value.customerId === book.order.customerId,
          409,
          'FINANCIAL_INTEGRITY',
          'Fonte de caixa inconsistente',
        );
        values.push(value);
      }
      if (page.size < 100) break;
      after = page.docs[page.size - 1]!.id;
    }
    for (const t of book.titles)
      requireCondition(
        values.reduce(
          (a, p) =>
            a +
            p.allocations
              .filter((r) => r.receivableId === t.id)
              .reduce((b, r) => b + r.remainingCents, 0),
          0,
        ) === t.cashCents,
        409,
        'FINANCIAL_INTEGRITY',
        'Alocações de caixa divergem dos títulos',
      );
    return values.sort(
      (a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id),
    );
  }
  prepareCashTransfer(
    book: Book,
    payments: z.infer<typeof s.paymentSchema>[],
    titles: s.FinancialTitle[],
  ) {
    const changes: z.infer<typeof s.paymentSchema>[] = [];
    const sourceChanges: SourceChange[] = [];
    const remaining = new Map(
      titles.map((t) => [
        t.id,
        book.titles.find((old) => old.id === t.id)!.cashCents - t.cashCents,
      ]),
    );
    for (const payment of payments) {
      let transferred = 0;
      const allocations = payment.allocations.map((a) => {
        const take = Math.min(a.remainingCents, remaining.get(a.receivableId) ?? 0);
        remaining.set(a.receivableId, (remaining.get(a.receivableId) ?? 0) - take);
        transferred += take;
        return { ...a, remainingCents: a.remainingCents - take };
      });
      if (transferred) {
        const after = s.paymentSchema.parse({
          ...payment,
          allocations,
          transferredCents: payment.transferredCents + transferred,
          version: payment.version + 1,
        });
        changes.push(after);
        sourceChanges.push({ kind: 'cash', before: payment, after });
      }
    }
    requireCondition(
      [...remaining.values()].every((v) => v === 0),
      409,
      'FINANCIAL_INTEGRITY',
      'Transferência sem fonte monetária',
    );
    return {
      references: changes.map((p) => p.id),
      sourceChanges,
      apply: (tx: Transaction) =>
        changes.forEach((p) => tx.set(this.repo.ref(book.order.tenantId, 'payments', p.id), p)),
    };
  }
  // Prepare destinations before writing; used by cancellation and return resolution.
  destinations(
    book: Book,
    op: string,
    now: string,
    amount: number,
    disposition: 'customer_credit' | 'refund',
    origin: 'order_cancellation' | 'order_return',
  ) {
    const creditLotId = amount && disposition === 'customer_credit' ? digest(`credit:${op}`) : null,
      refundObligationId = amount && disposition === 'refund' ? digest(`refund:${op}`) : null;
    const eventId = digest(`financial-event:${op}`);
    const lot = creditLotId
      ? s.lotSchema.parse({
          id: creditLotId,
          tenantId: book.order.tenantId,
          customerId: book.order.customerId,
          originOrderId: book.order.id,
          originReference: eventId,
          origin,
          issuedCents: amount,
          availableCents: amount,
          appliedCents: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1,
        })
      : null;
    const refund = refundObligationId
      ? s.refundSchema.parse({
          id: refundObligationId,
          tenantId: book.order.tenantId,
          orderId: book.order.id,
          customerId: book.order.customerId,
          originReference: eventId,
          origin,
          originalCents: amount,
          outstandingCents: amount,
          refundedCents: 0,
          version: 1,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1,
        })
      : null;
    return { creditLotId, refundObligationId, lot, refund };
  }
  createDestinations(tx: Transaction, value: ReturnType<FinancialService['destinations']>) {
    if (value.lot)
      tx.create(this.repo.ref(value.lot.tenantId, 'creditLots', value.lot.id), value.lot);
    if (value.refund)
      tx.create(
        this.repo.ref(value.refund.tenantId, 'refundObligations', value.refund.id),
        value.refund,
      );
  }
  async prepareRebate(
    tx: Transaction,
    book: Book,
    amount: number,
    op: string,
    now: string,
    disposition: 'customer_credit' | 'refund',
  ) {
    await this.assertAtomicResolutionFits(tx, book);
    requireCondition(
      Number.isSafeInteger(amount) &&
        amount >= 0 &&
        amount <= book.titles.reduce((a, t) => a + t.originalCents - t.canceledCents, 0),
      409,
      'RETURN_VALUE_LIMIT',
      'Devolução excede valor ainda disponível',
    );
    const { credits, lots } = await this.settlementSources(tx, book),
      payments = await this.cashSources(tx, book),
      titles = book.titles.map((t) => ({ ...t })),
      applications = credits.map((c) => ({
        ...c,
        allocations: c.allocations.map((a) => ({ ...a })),
      }));
    const originalApplications = new Map(credits.map((c) => [c.id, c]));
    const sorted = [...titles].sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.installmentNumber - b.installmentNumber,
    );
    let left = amount,
      restored = 0,
      cash = 0;
    const changedTitles = new Set<string>(),
      changedCredits = new Set<string>(),
      changedLots = new Set<string>();
    for (const t of sorted) {
      const take = Math.min(left, t.outstandingCents);
      t.outstandingCents -= take;
      t.canceledCents += take;
      left -= take;
      if (take) changedTitles.add(t.id);
    }
    applications.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const t of sorted) {
      for (const c of applications) {
        const a = c.allocations.find((a) => a.receivableId === t.id);
        if (!a || !left) continue;
        const take = Math.min(left, a.remainingCents);
        if (!take) continue;
        const lot = lots.get(c.creditLotId)!;
        a.remainingCents -= take;
        c.restoredByCancellationCents += take;
        t.creditCents -= take;
        t.canceledCents += take;
        lot.availableCents += take;
        lot.appliedCents -= take;
        left -= take;
        restored += take;
        changedTitles.add(t.id);
        changedCredits.add(c.id);
        changedLots.add(lot.id);
      }
    }
    for (const t of sorted) {
      const take = Math.min(left, t.cashCents);
      t.cashCents -= take;
      t.canceledCents += take;
      cash += take;
      left -= take;
      if (take) changedTitles.add(t.id);
    }
    requireCondition(
      left === 0,
      409,
      'FINANCIAL_INTEGRITY',
      'Valor de devolução sem origem comprovada',
    );
    for (const t of titles)
      if (changedTitles.has(t.id)) {
        t.version++;
        t.updatedAt = now;
      }
    const destinations = this.destinations(book, op, now, cash, disposition, 'order_return');
    const transfer = this.prepareCashTransfer(book, payments, titles);
    const creditChanges: SourceChange[] = applications
      .filter((c) => changedCredits.has(c.id))
      .map((c) => ({
        kind: 'credit',
        before: originalApplications.get(c.id)!,
        after: s.creditSchema.parse({
          ...c,
          status: c.allocations.some((a) => a.remainingCents) ? 'active' : 'restored',
          version: c.version + 1,
        }),
      }));
    const projection = await this.book.sources.prepare(tx, book, [
      ...transfer.sourceChanges,
      ...creditChanges,
    ]);
    return {
      projection,
      titles,
      state: {
        ...book.state,
        cashSettledCents: book.state.cashSettledCents - cash,
        creditSettledCents: book.state.creditSettledCents - restored,
        transferredCashCents: book.state.transferredCashCents + cash,
        canceledCents: book.state.canceledCents + amount,
      },
      destinations,
      references: [
        ...transfer.references,
        ...changedCredits,
        ...changedLots,
        ...(destinations.creditLotId ? [destinations.creditLotId] : []),
        ...(destinations.refundObligationId ? [destinations.refundObligationId] : []),
      ],
      apply: () => {
        transfer.apply(tx);
        for (const c of creditChanges)
          tx.set(this.repo.ref(book.order.tenantId, 'creditApplications', c.after.id), c.after);
        for (const id of changedLots) {
          const lot = lots.get(id)!;
          tx.set(
            this.repo.ref(book.order.tenantId, 'creditLots', id),
            s.lotSchema.parse({ ...lot, version: lot.version + 1, updatedAt: now }),
          );
        }
        this.createDestinations(tx, destinations);
      },
    };
  }
  /**
   * Corrects the due date of one title with an open balance. Amounts, payments, credits,
   * stock, the financial journal and the commercial terms snapshot taken at confirmation stay
   * exactly as they were, so the order keeps every path it had (including plain cancellation
   * while nothing was received).
   *
   * Allowed: order confirmed or dispatched, no return in progress and no financial execution
   * holding the order; title open or partially paid with an outstanding balance. Refused: draft
   * (edited through the order), canceled order, title paid, canceled or zero. The new date is
   * today or later and keeps installments in order (between the previous and the next one).
   *
   * One transaction rewrites the date wherever it is mirrored (order installment and payment
   * schedule, original receivable, title projection and its basis hash) and records the change
   * with both dates in an immutable record, the audit log and the order history. Order, guard
   * and title versions reject stale or concurrent attempts; the Idempotency-Key replays the
   * same result.
   */
  changeDueDate(
    actor: Actor,
    tenantId: string,
    orderId: string,
    input: z.infer<typeof s.dueDateChangeInput>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'due_date_change',
      orderId,
      input,
      'receivables:manage',
      s.dueDateChangeResult,
      false,
      async (tx, ctx, operationId, now) => {
        const book = await this.book.load(tx, tenantId, orderId);
        this.book.assertVersions(book, input);
        this.book.assertOpen(book);
        const index = book.titles.findIndex((t) => t.id === input.receivableId);
        requireCondition(
          index >= 0,
          404,
          'RESOURCE_NOT_FOUND',
          'Título não pertence a este pedido',
        );
        const title = book.titles[index]!;
        requireCondition(
          title.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão de título desatualizada',
        );
        const status = s.titleStatus(title);
        requireCondition(
          (status === 'open' || status === 'partially_paid') && title.outstandingCents > 0,
          409,
          'DUE_DATE_LOCKED',
          'Parcela quitada, cancelada ou sem saldo não muda de vencimento',
        );
        requireCondition(
          input.dueDate !== title.dueDate,
          422,
          'DUE_DATE_UNCHANGED',
          'Informe uma data diferente do vencimento atual',
        );
        requireCondition(
          input.dueDate >= companyDate(new Date(now), ctx.tenant.timezone),
          422,
          'INVALID_DUE_DATE',
          'Vencimento não pode ser anterior a hoje',
        );
        const previous = book.order.installments[index - 1],
          next = book.order.installments[index + 1];
        requireCondition(
          (!previous || input.dueDate >= previous.dueDate) &&
            (!next || input.dueDate <= next.dueDate),
          422,
          'DUE_DATE_ORDER',
          'Vencimento precisa ficar entre a parcela anterior e a seguinte',
        );
        const baselineRef = this.repo.ref(tenantId, 'receivables', title.id),
          overlayRef = this.repo.ref(tenantId, 'financialTitles', title.id);
        const [baseline, overlay] = await Promise.all([
          this.repo.foundation.read(baselineRef, receivableSchema, tx),
          this.repo.foundation.read(overlayRef, s.titleSchema, tx),
        ]);
        // book.load already proved baseline, projection and order agree on the current date.
        requireCondition(
          baseline?.id === title.id && baseline.dueDate === title.dueDate,
          409,
          'FINANCIAL_INTEGRITY',
          'Título original inconsistente',
        );
        const nextBaseline = receivableSchema.parse({
          ...baseline,
          dueDate: input.dueDate,
          updatedAt: now,
        });
        // The projection exists only after the first financial event. When it does, amounts and
        // version stay (the journal head still matches them) and only date and basis move.
        const nextOverlay = overlay
          ? s.titleSchema.parse({
              ...overlay,
              dueDate: input.dueDate,
              basisHash: receivableBasis(nextBaseline),
              updatedAt: now,
            })
          : null;
        const dueDates = book.order.installments.map((p, i) =>
          i === index ? input.dueDate : p.dueDate,
        );
        const nextOrder = orderSchema.parse({
          ...book.order,
          installments: book.order.installments.map((p, i) =>
            i === index ? { ...p, dueDate: input.dueDate } : p,
          ),
          payment: { ...book.order.payment!, dueDates },
          version: book.order.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        const orderRef = this.repo.ref(tenantId, 'orders', orderId);
        assertDocumentFits(orderRef.path, nextOrder);
        const change = s.dueDateChangeSchema.parse({
          id: operationId,
          tenantId,
          orderId,
          customerId: book.order.customerId,
          receivableId: title.id,
          installmentNumber: title.installmentNumber,
          previousDueDate: title.dueDate,
          dueDate: input.dueDate,
          reason: input.reason,
          orderVersion: nextOrder.version,
          actorUid: actor.uid,
          requestId: actor.requestId,
          occurredAt: now,
          schemaVersion: 1,
        });
        // Reads are over; every write below commits together or not at all.
        tx.set(baselineRef, nextBaseline);
        if (nextOverlay) tx.set(overlayRef, nextOverlay);
        tx.set(orderRef, nextOrder);
        tx.create(this.repo.ref(tenantId, 'receivableDueDateChanges', operationId), change);
        const orderEventId = digest(`order-due-date-event:${operationId}`);
        tx.create(
          this.repo.ref(tenantId, 'orderEvents', orderEventId),
          orderEventSchema.parse({
            id: orderEventId,
            tenantId,
            orderId,
            version: nextOrder.version,
            type: 'due_date_changed',
            previousStatus: book.order.status,
            status: book.order.status,
            occurredAt: now,
            actorUid: actor.uid,
            reason: input.reason,
            requestId: actor.requestId,
            operationId,
            schemaVersion: 1,
          }),
        );
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          'finance.due_date_changed',
          title.id,
          now,
          {
            operationId,
            orderId,
            receivableId: title.id,
            installmentNumber: title.installmentNumber,
            previousDueDate: title.dueDate,
            dueDate: input.dueDate,
            reason: input.reason,
          },
        );
        return {
          change: s.dueDateChangeView.parse(change),
          orderVersion: nextOrder.version,
          guardVersion: book.guard.version,
        };
      },
    );
  }
  cancel(
    actor: Actor,
    tenantId: string,
    orderId: string,
    input: z.infer<typeof s.cancellationInput>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'financial_cancellation',
      orderId,
      input,
      'financial-cancellation:manage',
      s.financialResult,
      true,
      async (tx, ctx, op, now) => {
        const book = await this.book.load(tx, tenantId, orderId);
        this.book.assertVersions(book, input);
        this.book.assertOpen(book);
        requireCondition(
          book.order.status === 'confirmed',
          409,
          'RETURN_REQUIRED',
          'Expedido exige fluxo próprio de devolução',
        );
        await this.assertAtomicResolutionFits(tx, book);
        const { credits, lots } = await this.settlementSources(tx, book),
          payments = await this.cashSources(tx, book);
        const prepared = await this.stock.prepare(tx, {
          context: ctx,
          orderId,
          orderVersion: book.order.version,
          operationKey: op,
          occurredAt: now,
          type: 'STOCK_RESERVATION_RELEASE',
          items: book.order.lines.map((l) => ({
            lineId: l.id,
            productId: l.productId,
            quantityScaled: parseQuantity(l.quantity, l.unit),
            reservationId: reservationIdFor(tenantId, orderId, l.id, l.productId),
          })),
        });
        const destinations = this.destinations(
          book,
          op,
          now,
          book.state.cashSettledCents,
          input.disposition,
          'order_cancellation',
        );
        const nextOrder = orderSchema.parse({
          ...book.order,
          status: 'canceled',
          version: book.order.version + 1,
          canceledAt: now,
          canceledBy: actor.uid,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        const titles = book.titles.map((t) => ({
          ...t,
          outstandingCents: 0,
          cashCents: 0,
          creditCents: 0,
          canceledCents: t.originalCents,
          version: t.version + 1,
          updatedAt: now,
        }));
        const transfer = this.prepareCashTransfer(book, payments, titles);
        const creditChanges: SourceChange[] = [];
        for (const credit of credits) {
          const restore = credit.allocations.reduce((a, r) => a + r.remainingCents, 0),
            lot = lots.get(credit.creditLotId)!;
          lots.set(lot.id, {
            ...lot,
            availableCents: lot.availableCents + restore,
            appliedCents: lot.appliedCents - restore,
          });
          creditChanges.push({
            kind: 'credit',
            before: credit,
            after: s.creditSchema.parse({
              ...credit,
              allocations: credit.allocations.map((a) => ({ ...a, remainingCents: 0 })),
              restoredByCancellationCents: credit.restoredByCancellationCents + restore,
              status: 'restored',
              version: credit.version + 1,
            }),
          });
        }
        const projection = await this.book.sources.prepare(tx, book, [
          ...transfer.sourceChanges,
          ...creditChanges,
        ]);
        transfer.apply(tx);
        for (const c of creditChanges)
          tx.set(this.repo.ref(tenantId, 'creditApplications', c.after.id), c.after);
        for (const lot of lots.values())
          tx.set(
            this.repo.ref(tenantId, 'creditLots', lot.id),
            s.lotSchema.parse({ ...lot, version: lot.version + 1, updatedAt: now }),
          );
        this.createDestinations(tx, destinations);
        prepared.apply();
        tx.set(this.repo.ref(tenantId, 'orders', orderId), nextOrder);
        tx.create(
          this.repo.ref(tenantId, 'orderEvents', digest(`order-finance-event:${op}`)),
          orderEventSchema.parse({
            id: digest(`order-finance-event:${op}`),
            tenantId,
            orderId,
            version: nextOrder.version,
            type: 'canceled',
            previousStatus: 'confirmed',
            status: 'canceled',
            occurredAt: now,
            actorUid: actor.uid,
            reason: input.reason,
            requestId: actor.requestId,
            operationId: op,
            schemaVersion: 1,
          }),
        );
        const result = this.book.save(
          tx,
          book,
          actor,
          op,
          now,
          'financial_cancellation',
          book.order.totalCents,
          input.reason,
          titles,
          {
            ...book.state,
            cashSettledCents: 0,
            creditSettledCents: 0,
            transferredCashCents: book.state.transferredCashCents + book.state.cashSettledCents,
            canceledCents: book.order.totalCents,
          },
          [
            ...transfer.references,
            ...credits.map((c) => c.id),
            ...lots.keys(),
            ...(destinations.creditLotId ? [destinations.creditLotId] : []),
            ...(destinations.refundObligationId ? [destinations.refundObligationId] : []),
          ],
          projection,
        );
        return {
          ...result,
          orderVersion: nextOrder.version,
          creditLotId: destinations.creditLotId,
          refundObligationId: destinations.refundObligationId,
        };
      },
    );
  }
  refund(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.refundInput>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'refund',
      id,
      input,
      'refunds:manage',
      s.financialResult,
      true,
      async (tx, ctx, op, now) => {
        const refund = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'refundObligations', id),
          s.refundSchema,
          tx,
        );
        requireCondition(
          refund?.id === id && refund.tenantId === tenantId,
          404,
          'RESOURCE_NOT_FOUND',
          'Obrigação não encontrada',
        );
        const book = await this.book.load(tx, tenantId, refund.orderId);
        this.book.assertVersions(book, input);
        requireCondition(
          refund.customerId === book.order.customerId && refund.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Obrigação alterada ou inconsistente',
        );
        const origin = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'financialEvents', refund.originReference),
          s.eventSchema,
          tx,
        );
        requireCondition(
          origin?.orderId === book.order.id &&
            origin.tenantId === tenantId &&
            origin.references.includes(id) &&
            origin.hash === financialEventHash(origin) &&
            origin.after.transferredCashCents - origin.before.transferredCashCents ===
              refund.originalCents,
          409,
          'FINANCIAL_INTEGRITY',
          'Origem de devolução inconsistente',
        );
        requireCondition(
          input.amountCents <= refund.outstandingCents &&
            input.amountCents <= book.state.transferredCashCents,
          409,
          'REFUND_LIMIT',
          'Valor excede obrigação ainda pendente',
        );
        requireCondition(
          input.refundedOn <= companyDate(new Date(now), ctx.tenant.timezone),
          422,
          'INVALID_PAYMENT_DATE',
          'Devolução não pode ter data futura',
        );
        const method = await this.settings.activeMethod(
          tx,
          tenantId,
          input.methodId,
          input.methodVersion,
        );
        const outstanding = refund.outstandingCents - input.amountCents;
        tx.set(
          this.repo.ref(tenantId, 'refundObligations', id),
          s.refundSchema.parse({
            ...refund,
            outstandingCents: outstanding,
            refundedCents: refund.refundedCents + input.amountCents,
            status: outstanding ? 'partially_refunded' : 'confirmed',
            version: refund.version + 1,
            updatedAt: now,
          }),
        );
        // Effective method/date/reference are immutable proof of the manual confirmation.
        const result = this.book.save(
          tx,
          book,
          actor,
          op,
          now,
          'refund',
          input.amountCents,
          input.reason,
          book.titles,
          {
            ...book.state,
            cashReceivedCents: book.state.cashReceivedCents - input.amountCents,
            transferredCashCents: book.state.transferredCashCents - input.amountCents,
          },
          [id, method.id, op],
        );
        tx.create(
          this.repo.ref(tenantId, 'refundConfirmations', op),
          s.refundConfirmationSchema.parse({
            id: op,
            tenantId,
            orderId: book.order.id,
            refundObligationId: id,
            amountCents: input.amountCents,
            method,
            refundedOn: input.refundedOn,
            reference: input.reference,
            reason: input.reason,
            actorUid: actor.uid,
            recordedAt: now,
            schemaVersion: 1,
          }),
        );
        return { ...result, resourceId: id, refundObligationId: id };
      },
    );
  }
}
