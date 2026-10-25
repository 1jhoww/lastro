import { FieldPath, type Transaction, type Query } from 'firebase-admin/firestore';
import type { z } from 'zod';
import * as s from '../../shared/schemas/finance.js';
import { orderSchema } from '../../shared/schemas/orders.js';
import { receivableSchema, financialGuardSchema } from '../receivables/orderReceivables.js';
import { pageQuery } from '../../shared/schemas/http.js';
import { accountRead, checkReadBudget } from '../../shared/operations/readBudget.js';
import type { Actor } from '../../shared/types/context.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { digest, stableJson, decodeCursor, encodeCursor } from '../../shared/utils/crypto.js';
import { FinancialCommands } from './financialCommands.js';
import { readCheckpoint, signCheckpoint, type Checkpoint } from './reconciliationCursor.js';
import {
  FinancialBook,
  financialEventHash,
  initialFinancialHash,
  receivableBasis,
} from './financialBook.js';

export class FinancialReads {
  readonly book: FinancialBook;
  constructor(readonly commands: FinancialCommands) {
    this.book = new FinancialBook(commands.repo);
  }
  get repo() {
    return this.commands.repo;
  }
  async state(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        const book = await this.book.load(tx, tenantId, id);
        return s.financialStateView.parse({
          ...book.state,
          orderVersion: book.order.version,
          guardVersion: book.guard.version,
          financialVersion: book.state.version,
          titles: book.titles.map((t) => ({
            ...t,
            status: s.titleStatus(t),
            customerName: book.order.customerName ?? '',
          })),
        });
      },
      { readOnly: true },
    );
  }
  private async header(tx: Transaction, tenantId: string, orderId: string) {
    const [order, guard, state] = await Promise.all([
      this.repo.foundation.read(this.repo.ref(tenantId, 'orders', orderId), orderSchema, tx),
      this.repo.foundation.read(
        this.repo.ref(tenantId, 'orderFinancialGuards', orderId),
        financialGuardSchema,
        tx,
      ),
      this.repo.foundation.read(
        this.repo.ref(tenantId, 'financialOrderStates', orderId),
        s.financialStateSchema,
        tx,
      ),
    ]);
    const head = state?.headEventId
      ? await this.repo.foundation.read(
          this.repo.ref(tenantId, 'financialEvents', state.headEventId),
          s.eventSchema,
          tx,
        )
      : null;
    const unknownPayments =
      !state &&
      !(
        await tx.get(
          this.repo
            .ref(tenantId, 'payments', 'placeholder')
            .parent.where('orderId', '==', orderId)
            .limit(1),
        )
      ).empty;
    return { order, guard, state, head, unknownPayments };
  }
  private async inspect(
    tx: Transaction,
    tenantId: string,
    baseline: z.infer<typeof receivableSchema>,
    cache = new Map<string, ReturnType<FinancialReads['header']>>(),
  ) {
    let load = cache.get(baseline.orderId);
    if (!load) {
      if (cache.size >= 4) cache.delete(cache.keys().next().value!);
      load = this.header(tx, tenantId, baseline.orderId);
      cache.set(baseline.orderId, load);
    }
    const { order, guard, state, head, unknownPayments } = await load;
    requireCondition(
      order?.tenantId === tenantId &&
        order.customerId &&
        guard?.tenantId === tenantId &&
        guard.orderId === order.id,
      409,
      'FINANCIAL_INTEGRITY',
      'Origem do título inconsistente',
    );
    const p = order.installments.find((p) => p.id === baseline.id);
    requireCondition(
      p &&
        baseline.tenantId === tenantId &&
        baseline.installmentId === p.id &&
        baseline.originalCents === p.amountCents &&
        baseline.installmentNumber === p.number &&
        baseline.dueDate === p.dueDate &&
        baseline.originReference === order.id &&
        baseline.receivedCents === 0,
      409,
      'FINANCIAL_INTEGRITY',
      'Título original inconsistente',
    );
    const overlay = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'financialTitles', baseline.id),
      s.titleSchema,
      tx,
    );
    let title: s.FinancialTitle;
    if (overlay) {
      requireCondition(
        state &&
          state.tenantId === tenantId &&
          state.orderId === order.id &&
          state.customerId === order.customerId &&
          overlay.tenantId === tenantId &&
          overlay.id === baseline.id &&
          overlay.orderId === order.id &&
          overlay.customerId === order.customerId &&
          overlay.basisHash === receivableBasis(baseline) &&
          overlay.originalCents === baseline.originalCents &&
          overlay.installmentNumber === baseline.installmentNumber &&
          overlay.dueDate === baseline.dueDate &&
          guard.receivedCents === state.cashSettledCents + state.creditSettledCents,
        409,
        'FINANCIAL_INTEGRITY',
        'Projeção do título inconsistente',
      );
      requireCondition(
        baseline.status === 'open' && baseline.outstandingCents === baseline.originalCents,
        409,
        'FINANCIAL_INTEGRITY',
        'Origem histórica foi alterada',
      );
      requireCondition(
        head?.tenantId === tenantId &&
          head.orderId === order.id &&
          head.hash === state.headHash &&
          head.sequence === state.eventSequence &&
          head.hash === financialEventHash(head) &&
          stableJson(head.after.titles.find((t) => t.id === baseline.id)) ===
            stableJson(s.titleAmounts.parse(overlay)),
        409,
        'FINANCIAL_INTEGRITY',
        'Título diverge do diário',
      );
      title = overlay;
    } else {
      requireCondition(
        !state &&
          !unknownPayments &&
          guard.receivedCents === 0 &&
          guard.paymentCount === 0 &&
          ((baseline.status === 'open' && baseline.outstandingCents === baseline.originalCents) ||
            (baseline.status === 'canceled' && baseline.outstandingCents === 0)),
        409,
        'LEGACY_FINANCIAL_REVIEW_REQUIRED',
        'Legado financeiro exige revisão de origem',
      );
      title = s.titleSchema.parse({
        id: baseline.id,
        tenantId,
        orderId: order.id,
        customerId: order.customerId,
        installmentNumber: baseline.installmentNumber,
        dueDate: baseline.dueDate,
        originalCents: baseline.originalCents,
        outstandingCents: baseline.outstandingCents,
        cashCents: 0,
        creditCents: 0,
        canceledCents: baseline.status === 'canceled' ? baseline.originalCents : 0,
        version: 1,
        basisHash: receivableBasis(baseline),
        createdAt: baseline.createdAt,
        updatedAt: baseline.updatedAt,
        schemaVersion: 1,
      });
    }
    return s.titleView.parse({
      ...title,
      status: s.titleStatus(title),
      customerName: order.customerName ?? '',
    });
  }
  async title(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        const baseline = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'receivables', id),
          receivableSchema,
          tx,
        );
        requireCondition(
          baseline?.id === id && baseline.tenantId === tenantId,
          404,
          'RESOURCE_NOT_FOUND',
          'Recurso não encontrado',
        );
        return this.inspect(tx, tenantId, baseline);
      },
      { readOnly: true },
    );
  }
  async titles(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.titleQuery>,
    requirePublished = false,
  ) {
    return this.repo.foundation.readBudget.run(() =>
      this.titlePage(actor, tenantId, input, requirePublished),
    );
  }
  private async titlePage(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.titleQuery>,
    requirePublished: boolean,
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        const scope = digest(
          stableJson({ kind: 'titles', actor: actor.uid, tenantId, ...input, cursor: undefined }),
        );
        let query: Query = this.repo.ref(tenantId, 'receivables', 'placeholder').parent;
        if (input.orderId) query = query.where('orderId', '==', input.orderId);
        if (input.from) query = query.where('dueDate', '>=', input.from);
        if (input.to) query = query.where('dueDate', '<=', input.to);
        query = query.orderBy('dueDate').orderBy(FieldPath.documentId());
        const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
        if (cursor) {
          const prior = await tx.get(this.repo.ref(tenantId, 'receivables', cursor));
          requireCondition(prior.exists, 422, 'VALIDATION_ERROR', 'Cursor indisponível');
          query = query.startAfter(prior);
        }
        const limit = Number(input.limit ?? '25'),
          page = await tx.get(query.limit(limit + 1)),
          docs = page.docs.slice(0, limit);
        const cache = new Map<string, ReturnType<FinancialReads['header']>>();
        const values: z.infer<typeof s.titleView>[] = [];
        for (const d of docs) {
          checkReadBudget();
          const baseline = receivableSchema.safeParse(d.data());
          requireCondition(
            baseline.success && baseline.data.id === d.id && baseline.data.tenantId === tenantId,
            500,
            'INTERNAL_ERROR',
            'Erro interno do servidor',
          );
          if (requirePublished)
            await this.commands.locks.assertOrderAvailable(tx, tenantId, baseline.data.orderId);
          values.push(await this.inspect(tx, tenantId, baseline.data, cache));
        }
        return {
          items: values.filter(
            (t) =>
              (!input.customerId || t.customerId === input.customerId) &&
              (!input.status || t.status === input.status),
          ),
          nextCursor:
            page.size > limit
              ? encodeCursor(this.repo.secret, scope, docs[docs.length - 1]!.id)
              : null,
        };
      },
      { readOnly: true },
    );
  }
  /**
   * Every title due in the window, with the same validated projection as the title list. Each
   * order header is read once for the whole report instead of through the list's small cache.
   * The caller already holds `receivables:read` in this transaction.
   */
  async reportTitles(
    tx: Transaction,
    tenantId: string,
    window: { from?: string | undefined; to?: string | undefined },
    cap: number,
  ) {
    let query: Query = this.repo.ref(tenantId, 'receivables', 'placeholder').parent;
    if (window.from) query = query.where('dueDate', '>=', window.from);
    if (window.to) query = query.where('dueDate', '<=', window.to);
    const page = await tx.get(
      query
        .orderBy('dueDate')
        .orderBy(FieldPath.documentId())
        .limit(cap + 1),
    );
    requireCondition(
      page.size <= cap,
      422,
      'REPORT_TOO_LARGE',
      `A consulta passa de ${cap} parcelas. Reduza o período ou aplique filtros.`,
    );
    const baselines = page.docs.map((d) => {
      accountRead(d.data());
      const baseline = receivableSchema.safeParse(d.data());
      requireCondition(
        baseline.success && baseline.data.id === d.id && baseline.data.tenantId === tenantId,
        500,
        'INTERNAL_ERROR',
        'Erro interno do servidor',
      );
      return baseline.data;
    });
    const cache = new Map<string, ReturnType<FinancialReads['header']>>();
    const orderIds = [...new Set(baselines.map((b) => b.orderId))];
    for (let i = 0; i < orderIds.length; i += 16) {
      checkReadBudget();
      await Promise.all(
        orderIds.slice(i, i + 16).map((id) => {
          const load = this.header(tx, tenantId, id);
          cache.set(id, load);
          return load;
        }),
      );
    }
    const titles: (z.infer<typeof s.titleView> & { commercialId: string; sellerUid: string })[] =
      [];
    for (let i = 0; i < baselines.length; i += 16) {
      checkReadBudget();
      titles.push(
        ...(await Promise.all(
          baselines.slice(i, i + 16).map(async (baseline) => {
            const view = await this.inspect(tx, tenantId, baseline, cache);
            const { order } = await cache.get(baseline.orderId)!;
            return { ...view, commercialId: order!.commercialId, sellerUid: order!.sellerUid };
          }),
        )),
      );
    }
    return titles;
  }
  async list(
    actor: Actor,
    tenantId: string,
    collection: 'payments' | 'creditLots' | 'refundObligations' | 'creditApplications',
    input: z.infer<typeof s.financialQuery>,
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        const scope = digest(
          stableJson({ actor: actor.uid, tenantId, collection, ...input, cursor: undefined }),
        );
        let query: Query = this.repo.ref(tenantId, collection, 'placeholder').parent;
        if (input.customerId) query = query.where('customerId', '==', input.customerId);
        if (input.orderId)
          query = query.where(
            collection === 'creditLots' ? 'originOrderId' : 'orderId',
            '==',
            input.orderId,
          );
        query = query.orderBy(FieldPath.documentId());
        const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
        if (cursor) query = query.startAfter(cursor);
        const limit = Number(input.limit ?? '25'),
          page = await tx.get(query.limit(limit + 1)),
          docs = page.docs.slice(0, limit);
        return {
          items: await Promise.all(
            docs.map(async (d) => {
              const value = await this.repo.foundation.readSnapshot<
                | z.infer<typeof s.paymentSchema>
                | z.infer<typeof s.lotSchema>
                | z.infer<typeof s.creditSchema>
                | z.infer<typeof s.refundSchema>
              >(
                d,
                collection === 'payments'
                  ? s.paymentSchema
                  : collection === 'creditLots'
                    ? s.lotSchema
                    : collection === 'creditApplications'
                      ? s.creditSchema
                      : s.refundSchema,
                tx,
              );
              requireCondition(
                value && value.id === d.id && value.tenantId === tenantId,
                500,
                'INTERNAL_ERROR',
                'Erro interno do servidor',
              );
              return value;
            }),
          ),
          nextCursor:
            page.size > limit
              ? encodeCursor(this.repo.secret, scope, docs[docs.length - 1]!.id)
              : null,
        };
      },
      { readOnly: true },
    );
  }
  /** Due-date corrections of one title, newest first, with both dates and the reason. */
  async dueDateChanges(actor: Actor, tenantId: string, receivableId: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        // Equality only (no composite index); a title is corrected a handful of times at most.
        const page = await tx.get(
          this.repo
            .ref(tenantId, 'receivableDueDateChanges', 'placeholder')
            .parent.where('receivableId', '==', receivableId)
            .limit(100),
        );
        const items = page.docs.map((d) => {
          const value = s.dueDateChangeSchema.safeParse(d.data());
          requireCondition(
            value.success && value.data.id === d.id && value.data.tenantId === tenantId,
            500,
            'INTERNAL_ERROR',
            'Erro interno do servidor',
          );
          return s.dueDateChangeView.parse(value.data);
        });
        items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
        return { items };
      },
      { readOnly: true },
    );
  }
  async payment(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        const value = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'payments', id),
          s.paymentSchema,
          tx,
        );
        requireCondition(
          value?.id === id && value.tenantId === tenantId,
          404,
          'RESOURCE_NOT_FOUND',
          'Recurso não encontrado',
        );
        return value;
      },
      { readOnly: true },
    );
  }
  async resource(
    actor: Actor,
    tenantId: string,
    collection: 'creditApplications' | 'refundObligations' | 'refundConfirmations',
    id: string,
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        const document = await tx.get(this.repo.ref(tenantId, collection, id));
        requireCondition(document.exists, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
        const value = await this.repo.foundation.readSnapshot<
          | z.infer<typeof s.creditSchema>
          | z.infer<typeof s.refundSchema>
          | z.infer<typeof s.refundConfirmationSchema>
        >(
          document,
          collection === 'creditApplications'
            ? s.creditSchema
            : collection === 'refundObligations'
              ? s.refundSchema
              : s.refundConfirmationSchema,
          tx,
        );
        requireCondition(
          value && value.id === id && value.tenantId === tenantId,
          500,
          'INTERNAL_ERROR',
          'Erro interno do servidor',
        );
        return value;
      },
      { readOnly: true },
    );
  }
  async history(
    actor: Actor,
    tenantId: string,
    orderId: string,
    input: z.infer<typeof pageQuery>,
    reconcile = false,
  ) {
    if (reconcile) return this.reconcile(actor, tenantId, orderId, input);
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        await this.book.load(tx, tenantId, orderId);
        const scope = digest(
          stableJson({
            actor: actor.uid,
            tenantId,
            orderId,
            kind: 'financial-history',
            limit: input.limit,
          }),
        );
        const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
        let query: Query = this.repo
          .ref(tenantId, 'financialEvents', 'placeholder')
          .parent.where('orderId', '==', orderId)
          .orderBy('sequence')
          .orderBy(FieldPath.documentId());
        if (cursor) {
          const previous = await this.repo.foundation.read(
            this.repo.ref(tenantId, 'financialEvents', cursor),
            s.eventSchema,
            tx,
          );
          requireCondition(
            previous?.tenantId === tenantId && previous.orderId === orderId,
            422,
            'VALIDATION_ERROR',
            'Cursor indisponível',
          );
          query = query.startAfter(previous.sequence, cursor);
        }
        const limit = Number(input.limit ?? '25'),
          page = await tx.get(query.limit(limit + 1)),
          docs = page.docs.slice(0, limit);
        const events = await Promise.all(
          docs.map(async (d) => {
            const value = await this.repo.foundation.readSnapshot(d, s.eventSchema, tx);
            requireCondition(
              value &&
                value.id === d.id &&
                value.tenantId === tenantId &&
                value.orderId === orderId,
              500,
              'INTERNAL_ERROR',
              'Erro interno do servidor',
            );
            return value;
          }),
        );
        const nextCursor =
          page.size > limit
            ? encodeCursor(this.repo.secret, scope, docs[docs.length - 1]!.id)
            : null;
        return { items: events, nextCursor };
      },
      { readOnly: true },
    );
  }
  async reconcile(
    actor: Actor,
    tenantId: string,
    orderId: string,
    input: z.infer<typeof pageQuery>,
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        const book = await this.book.load(tx, tenantId, orderId);
        const limit = Number(input.limit ?? '25');
        const scope = digest(
          stableJson({
            actor: actor.uid,
            tenantId,
            orderId,
            kind: 'financial-reconciliation-v1',
            limit,
          }),
        );
        const legacyScope = digest(
          stableJson({
            actor: actor.uid,
            tenantId,
            orderId,
            kind: 'financial-reconcile',
            limit: input.limit,
            head: book.state.headHash,
          }),
        );
        const checkpoint: Checkpoint = input.cursor
          ? readCheckpoint(
              this.repo.secret,
              input.cursor,
              scope,
              legacyScope,
              book.state.journalVersion ?? 1,
            )
          : {
              format: book.state.journalVersion ?? 1,
              scope,
              version: book.state.version,
              headHash: book.state.headHash,
              eventCount: book.state.eventSequence,
              sequence: 0,
              checked: 0,
              lastId: null,
              previousHash: initialFinancialHash(tenantId, orderId),
              snapshotHash: null,
              consistent: true,
            };
        requireCondition(
          checkpoint.version === book.state.version &&
            checkpoint.headHash === book.state.headHash &&
            checkpoint.eventCount === book.state.eventSequence,
          409,
          'CONFLICT',
          'Financeiro mudou; reinicie a reconciliação',
        );
        let query: Query = this.repo
          .ref(tenantId, 'financialEvents', 'placeholder')
          .parent.where('orderId', '==', orderId)
          .orderBy('sequence')
          .orderBy(FieldPath.documentId());
        if (checkpoint.lastId) {
          const previous = s.eventSchema.safeParse(
            (await tx.get(this.repo.ref(tenantId, 'financialEvents', checkpoint.lastId))).data(),
          );
          checkpoint.consistent &&=
            previous.success &&
            previous.data.id === checkpoint.lastId &&
            previous.data.tenantId === tenantId &&
            previous.data.orderId === orderId &&
            previous.data.sequence === checkpoint.sequence &&
            previous.data.hash === checkpoint.previousHash &&
            previous.data.hash === financialEventHash(previous.data) &&
            digest(stableJson(previous.data.after)) === checkpoint.snapshotHash;
          // Use the signed position even when the boundary event was removed or changed.
          query = query.startAfter(checkpoint.sequence, checkpoint.lastId);
        }
        const page = await tx.get(query.limit(limit + 1));
        const docs = page.docs.slice(0, limit);
        const events = docs.map((doc) => {
          const parsed = s.eventSchema.safeParse(doc.data());
          requireCondition(
            parsed.success &&
              parsed.data.id === doc.id &&
              parsed.data.tenantId === tenantId &&
              parsed.data.orderId === orderId,
            500,
            'INTERNAL_ERROR',
            'Erro interno do servidor',
          );
          return parsed.data;
        });
        for (const event of events) {
          checkpoint.consistent &&=
            event.sequence === checkpoint.sequence + 1 &&
            event.previousHash === checkpoint.previousHash &&
            event.hash === financialEventHash(event) &&
            (!checkpoint.snapshotHash ||
              checkpoint.snapshotHash === digest(stableJson(event.before)));
          checkpoint.sequence = event.sequence;
          checkpoint.checked++;
          checkpoint.lastId = event.id;
          checkpoint.previousHash = event.hash;
          checkpoint.snapshotHash = digest(stableJson(event.after));
        }
        const complete = page.size <= limit;
        if (complete)
          checkpoint.consistent &&=
            checkpoint.sequence === book.state.eventSequence &&
            checkpoint.checked === book.state.eventSequence &&
            checkpoint.lastId === book.state.headEventId &&
            checkpoint.previousHash === book.state.headHash &&
            (!checkpoint.snapshotHash
              ? book.state.eventSequence === 0
              : checkpoint.snapshotHash ===
                digest(stableJson(this.book.snapshot(book.state, book.titles))));
        return s.reconciliationView.parse({
          orderId,
          consistent: checkpoint.consistent,
          complete,
          checkedEvents: checkpoint.checked,
          ...(book.state.journalVersion === 2
            ? { scope: 'journal', sourceProofsVerified: false }
            : {}),
          nextCursor: complete ? null : signCheckpoint(this.repo.secret, checkpoint),
        });
      },
      { readOnly: true },
    );
  }
}
