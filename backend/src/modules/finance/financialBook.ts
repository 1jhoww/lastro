import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import type { Actor } from '../../shared/types/context.js';
import { orderSchema, type Order } from '../../shared/schemas/orders.js';
import { customerSchema } from '../../shared/schemas/commercial.js';
import * as s from '../../shared/schemas/finance.js';
import { receivableSchema, financialGuardSchema } from '../receivables/orderReceivables.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
import { assertDocumentFits } from '../orders/technicalSize.js';
import { recordAudit } from '../../shared/audit/audit.js';
import {
  SourceIndex,
  type SourceGeneration,
  type PreparedSourceIndex,
} from './resolution/sourceIndex.js';
export const initialFinancialHash = (tenantId: string, orderId: string) =>
  digest(`financial:${tenantId}:${orderId}`);
export const financialEventHash = (
  event: Omit<z.infer<typeof s.eventSchema>, 'hash'> | z.infer<typeof s.eventSchema>,
) => {
  const { hash: _hash, ...body } = 'hash' in event ? event : { ...event, hash: '' };
  return digest(stableJson(body));
};
export const receivableBasis = (value: z.infer<typeof receivableSchema>) =>
  digest(
    stableJson({
      id: value.id,
      tenantId: value.tenantId,
      orderId: value.orderId,
      installmentId: value.installmentId,
      installmentNumber: value.installmentNumber,
      originalCents: value.originalCents,
      dueDate: value.dueDate,
      origin: value.origin,
      originReference: value.originReference,
      createdAt: value.createdAt,
    }),
  );
export interface Book {
  order: Order;
  titles: s.FinancialTitle[];
  state: s.FinancialState;
  guard: z.infer<typeof financialGuardSchema>;
  generation: SourceGeneration | null;
}
export class FinancialBook {
  readonly sources: SourceIndex;
  constructor(readonly repo: CommercialRepository) {
    this.sources = new SourceIndex(repo);
  }
  async load(tx: Transaction, tenantId: string, orderId: string): Promise<Book> {
    const order = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'orders', orderId),
      orderSchema,
      tx,
    );
    requireCondition(
      order?.tenantId === tenantId && order.id === orderId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    requireCondition(
      order.customerId && order.confirmedAt && order.installments.length > 0,
      409,
      'INVALID_ORDER_STATE',
      'Pedido ainda não tem títulos confirmados',
    );
    const customer = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'customers', order.customerId),
      customerSchema,
      tx,
    );
    requireCondition(
      customer?.id === order.customerId && customer.tenantId === tenantId,
      409,
      'FINANCIAL_INTEGRITY',
      'Cliente financeiro inconsistente',
    );
    const guard = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'orderFinancialGuards', orderId),
      financialGuardSchema,
      tx,
    );
    requireCondition(
      guard?.tenantId === tenantId && guard.orderId === orderId,
      409,
      'FINANCIAL_INTEGRITY',
      'Guard financeiro inconsistente',
    );
    const persisted = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'financialOrderStates', orderId),
      s.financialStateSchema,
      tx,
    );
    if (!persisted) {
      const payments = await tx.get(
        this.repo
          .ref(tenantId, 'payments', 'placeholder')
          .parent.where('orderId', '==', orderId)
          .limit(1),
      );
      requireCondition(
        guard.paymentCount === 0 && guard.receivedCents === 0 && payments.empty,
        409,
        'LEGACY_FINANCIAL_REVIEW_REQUIRED',
        'Legado financeiro exige revisão de origem antes de movimentar',
      );
    }
    const titles = await Promise.all(
      order.installments.map(async (p) => {
        const baseline = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'receivables', p.id),
          receivableSchema,
          tx,
        );
        requireCondition(
          baseline?.id === p.id &&
            baseline.tenantId === tenantId &&
            baseline.orderId === orderId &&
            baseline.installmentId === p.id &&
            baseline.installmentNumber === p.number &&
            baseline.originalCents === p.amountCents &&
            baseline.dueDate === p.dueDate &&
            baseline.originReference === orderId,
          409,
          'FINANCIAL_INTEGRITY',
          'Título original inconsistente',
        );
        requireCondition(
          baseline.receivedCents === 0 &&
            ((baseline.status === 'open' && baseline.outstandingCents === baseline.originalCents) ||
              (baseline.status === 'canceled' && baseline.outstandingCents === 0)),
          409,
          'LEGACY_FINANCIAL_REVIEW_REQUIRED',
          'Legado financeiro exige revisão de origem',
        );
        const overlay = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'financialTitles', p.id),
          s.titleSchema,
          tx,
        );
        if (overlay) {
          requireCondition(
            baseline.status === 'open' && baseline.outstandingCents === baseline.originalCents,
            409,
            'FINANCIAL_INTEGRITY',
            'Origem histórica foi alterada',
          );
          requireCondition(
            overlay.id === p.id &&
              overlay.tenantId === tenantId &&
              overlay.orderId === orderId &&
              overlay.customerId === order.customerId &&
              overlay.basisHash === receivableBasis(baseline) &&
              overlay.originalCents === p.amountCents &&
              overlay.dueDate === p.dueDate &&
              overlay.installmentNumber === p.number,
            409,
            'FINANCIAL_INTEGRITY',
            'Projeção de título inconsistente',
          );
          return overlay;
        }
        requireCondition(!persisted, 409, 'FINANCIAL_INTEGRITY', 'Projeção de título ausente');
        return s.titleSchema.parse({
          id: p.id,
          tenantId,
          orderId,
          customerId: order.customerId,
          installmentNumber: p.number,
          dueDate: p.dueDate,
          originalCents: p.amountCents,
          outstandingCents: baseline.outstandingCents,
          cashCents: 0,
          creditCents: 0,
          canceledCents: baseline.status === 'canceled' ? p.amountCents : 0,
          version: 1,
          basisHash: receivableBasis(baseline),
          createdAt: baseline.createdAt,
          updatedAt: baseline.updatedAt,
          schemaVersion: 1,
        });
      }),
    );
    const state =
      persisted ??
      s.financialStateSchema.parse({
        tenantId,
        orderId,
        customerId: order.customerId,
        cashReceivedCents: 0,
        cashSettledCents: 0,
        creditSettledCents: 0,
        transferredCashCents: 0,
        canceledCents: titles.reduce((a, t) => a + t.canceledCents, 0),
        activeReturnCount: 0,
        version: 1,
        eventSequence: 0,
        headHash: initialFinancialHash(tenantId, orderId),
        headEventId: null,
        schemaVersion: 1,
      });
    requireCondition(
      state.tenantId === tenantId &&
        state.orderId === orderId &&
        state.customerId === order.customerId &&
        guard.receivedCents === state.cashSettledCents + state.creditSettledCents &&
        guard.paymentCount >= state.eventSequence,
      409,
      'FINANCIAL_INTEGRITY',
      'Projeção financeira inconsistente',
    );
    const ledger = this.snapshot(state, titles);
    if (state.headEventId) {
      const event = await this.repo.foundation.read(
        this.repo.ref(tenantId, 'financialEvents', state.headEventId),
        s.eventSchema,
        tx,
      );
      requireCondition(
        event?.tenantId === tenantId &&
          event.orderId === orderId &&
          event.sequence === state.eventSequence &&
          event.hash === state.headHash &&
          event.hash === financialEventHash(event) &&
          stableJson(event.after) === stableJson(ledger),
        409,
        'FINANCIAL_INTEGRITY',
        'Cabeça do diário inconsistente',
      );
    } else
      requireCondition(
        state.eventSequence === 0 && state.headHash === initialFinancialHash(tenantId, orderId),
        409,
        'FINANCIAL_INTEGRITY',
        'Cabeça do diário ausente',
      );
    const generation = await this.sources.current(tx, tenantId, orderId, state, titles);
    return { order, titles, state, guard, generation };
  }
  snapshot(state: s.FinancialState, titles: s.FinancialTitle[]): s.LedgerSnapshot {
    const value = s.ledgerSnapshot.safeParse({
      ...state,
      titles: titles.map((t) => s.titleAmounts.parse(t)),
    });
    requireCondition(
      value.success,
      409,
      'FINANCIAL_INTEGRITY',
      'Componentes financeiros divergem da projeção',
    );
    return value.data;
  }
  assertVersions(
    book: Book,
    input: { expectedOrderVersion: number; expectedGuardVersion: number },
  ) {
    requireCondition(
      book.order.version === input.expectedOrderVersion &&
        book.guard.version === input.expectedGuardVersion,
      409,
      'CONFLICT',
      'Versão do pedido ou financeiro desatualizada',
    );
  }
  assertOpen(book: Book) {
    requireCondition(
      book.order.status === 'confirmed' || book.order.status === 'dispatched',
      409,
      'INVALID_ORDER_STATE',
      'Pedido não permite novas liquidações',
    );
    requireCondition(
      book.state.activeReturnCount === 0,
      409,
      'RETURN_FINANCIAL_BLOCK',
      'Pedido possui devolução em andamento',
    );
  }
  save(
    tx: Transaction,
    book: Book,
    actor: Actor,
    operationId: string,
    now: string,
    type: z.infer<typeof s.eventSchema>['type'],
    amountCents: number,
    reason: string,
    titles: s.FinancialTitle[],
    state: s.FinancialState,
    references: string[],
    projection?: PreparedSourceIndex,
  ) {
    const eventId = digest(`financial-event:${operationId}`);
    const content = {
      id: eventId,
      tenantId: book.order.tenantId,
      orderId: book.order.id,
      customerId: book.order.customerId!,
      operationId,
      type,
      amountCents,
      reason,
      actorUid: actor.uid,
      occurredAt: now,
      requestId: actor.requestId,
      sequence: book.state.eventSequence + 1,
      previousHash: book.state.headHash,
      before: this.snapshot(book.state, book.titles),
      after: this.snapshot(state, titles),
      references,
      schemaVersion: 1 as const,
    };
    const event = s.eventSchema.parse({ ...content, hash: financialEventHash(content) });
    const nextState = s.financialStateSchema.parse({
      ...state,
      version: book.state.version + 1,
      eventSequence: event.sequence,
      headHash: event.hash,
      headEventId: eventId,
    });
    const nextGuard = financialGuardSchema.parse({
      ...book.guard,
      receivedCents: state.cashSettledCents + state.creditSettledCents,
      paymentCount: book.guard.paymentCount + 1,
      version: book.guard.version + 1,
    });
    const writes = titles.map((t) => ({
      ref: this.repo.ref(book.order.tenantId, 'financialTitles', t.id),
      value: s.titleSchema.parse(t),
    }));
    for (const w of writes) assertDocumentFits(w.ref.path, w.value);
    assertDocumentFits(this.repo.ref(book.order.tenantId, 'financialEvents', eventId).path, event);
    assertDocumentFits(
      this.repo.ref(book.order.tenantId, 'financialOrderStates', book.order.id).path,
      nextState,
    );
    writes.forEach((w) => tx.set(w.ref, w.value));
    tx.set(this.repo.ref(book.order.tenantId, 'financialOrderStates', book.order.id), nextState);
    tx.set(this.repo.ref(book.order.tenantId, 'orderFinancialGuards', book.order.id), nextGuard);
    tx.create(this.repo.ref(book.order.tenantId, 'financialEvents', eventId), event);
    if (projection) projection(tx, nextState, titles, now);
    else {
      requireCondition(
        ![
          'receipt',
          'payment_reversal',
          'credit_application',
          'credit_reversal',
          'financial_cancellation',
        ].includes(type),
        409,
        'FINANCIAL_INTEGRITY',
        'Atualização de fontes financeiras ausente',
      );
      this.sources.unchanged(tx, book, nextState, titles, now);
    }
    recordAudit(
      this.repo.foundation,
      tx,
      actor,
      book.order.tenantId,
      `finance.${type}`,
      book.order.id,
      now,
      { operationId, eventId, amountCents, reason },
    );
    return s.financialResult.parse({
      operationId,
      orderId: book.order.id,
      orderVersion: book.order.version,
      guardVersion: nextGuard.version,
      eventId,
      resourceId: null,
      creditLotId: null,
      refundObligationId: null,
      amountCents,
    });
  }
}
