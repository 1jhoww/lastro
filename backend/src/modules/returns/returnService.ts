import type { Transaction, Query } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import type { z } from 'zod';
import * as s from '../../shared/schemas/returns.js';
import { stockReservationSchema } from '../../shared/schemas/orders.js';
import type { Actor } from '../../shared/types/context.js';
import type { Book } from '../finance/financialBook.js';
import type { FinancialService } from '../finance/financialService.js';
import type { ReturnStockAdapter } from '../inventory/returnStockAdapter.js';
import { reservationIdFor } from '../inventory/orderStockAdapter.js';
import { parseQuantity, formatQuantity } from '../inventory/quantities.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { digest, stableJson, decodeCursor, encodeCursor } from '../../shared/utils/crypto.js';
import { assertDocumentFits } from '../orders/technicalSize.js';
import { cumulativeReturnedCents, returnedValueLimits, returnState } from './calculation.js';

export const returnEventHash = (
  event: Omit<z.infer<typeof s.returnEventSchema>, 'hash'> | z.infer<typeof s.returnEventSchema>,
) => {
  const { hash: _hash, ...body } = 'hash' in event ? event : { ...event, hash: '' };
  return digest(stableJson(body));
};
export class ReturnService {
  constructor(
    readonly finance: FinancialService,
    readonly stock: ReturnStockAdapter,
  ) {}
  get repo() {
    return this.finance.repo;
  }
  async load(tx: Transaction, tenantId: string, id: string) {
    const value = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'returns', id),
      s.returnSchema,
      tx,
    );
    requireCondition(
      value?.tenantId === tenantId && value.id === id,
      404,
      'RESOURCE_NOT_FOUND',
      'Devolução não encontrada',
    );
    const head = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'returnEvents', value.headEventId),
      s.returnEventSchema,
      tx,
    );
    requireCondition(
      head?.tenantId === tenantId &&
        head.returnId === id &&
        head.orderId === value.orderId &&
        head.sequence === value.eventSequence &&
        head.hash === value.headHash &&
        head.hash === returnEventHash(head) &&
        (head.schemaVersion === 1
          ? stableJson(head.after) === stableJson(s.returnSnapshotSchema.parse(value))
          : head.afterSnapshotHash === digest(stableJson(s.returnSnapshotSchema.parse(value)))) &&
        value.status === returnState(value.lines),
      409,
      'RETURN_INTEGRITY',
      'Histórico de devolução inconsistente',
    );
    return value;
  }
  async guards(tx: Transaction, book: Pick<Book, 'order'>, lineIds: string[]) {
    const order = book.order;
    const eventCache = new Map<string, Promise<z.infer<typeof s.returnEventSchema> | null>>();
    requireCondition(
      order.status === 'dispatched' && order.dispatchReference,
      409,
      'RETURN_SOURCE_INVALID',
      'Devolução exige pedido expedido',
    );
    return new Map<string, s.ReturnGuard>(
      await Promise.all(
        lineIds.map(async (lineId) => {
          const line = order.lines.find((l) => l.id === lineId);
          requireCondition(line, 404, 'RESOURCE_NOT_FOUND', 'Linha não pertence ao pedido');
          const expeditedScaled = parseQuantity(line.quantity, line.unit),
            id = digest(`return-line:${order.tenantId}:${order.id}:${lineId}`);
          const reservation = await this.repo.foundation.read(
            this.repo.ref(
              order.tenantId,
              'stockReservations',
              reservationIdFor(order.tenantId, order.id, line.id, line.productId),
            ),
            stockReservationSchema,
            tx,
          );
          requireCondition(
            reservation?.tenantId === order.tenantId &&
              reservation.orderId === order.id &&
              reservation.lineId === line.id &&
              reservation.productId === line.productId &&
              reservation.unit === line.unit &&
              reservation.quantityScaled === expeditedScaled &&
              reservation.status === 'dispatched',
            409,
            'RETURN_SOURCE_INVALID',
            'Expedição original não comprovada',
          );
          const persisted = await this.repo.foundation.read(
            this.repo.ref(order.tenantId, 'orderReturnLines', id),
            s.returnGuardSchema,
            tx,
          );
          if (persisted) {
            let read = persisted.lastEventId ? eventCache.get(persisted.lastEventId) : undefined;
            if (persisted.lastEventId && !read) {
              read = this.repo.foundation.read(
                this.repo.ref(order.tenantId, 'returnEvents', persisted.lastEventId),
                s.returnEventSchema,
                tx,
              );
              eventCache.set(persisted.lastEventId, read);
            }
            const event = read ? await read : null;
            const proof =
              event?.schemaVersion === 2
                ? await this.repo.foundation.provenSource(
                    order.tenantId,
                    'orderReturnLines',
                    id,
                    event.executionId,
                    tx,
                  )
                : null;
            requireCondition(
              persisted.id === id &&
                persisted.tenantId === order.tenantId &&
                persisted.orderId === order.id &&
                persisted.lineId === lineId &&
                persisted.productId === line.productId &&
                persisted.unit === line.unit &&
                persisted.expeditedScaled === expeditedScaled &&
                persisted.valueResolvedCents ===
                  cumulativeReturnedCents(
                    line.totalCents,
                    persisted.resolvedSellableScaled + persisted.acceptedDamagedScaled,
                    expeditedScaled,
                  ) -
                    (persisted.damagedValueReductionCents ?? 0) &&
                event?.tenantId === order.tenantId &&
                event.orderId === order.id &&
                event.hash === returnEventHash(event) &&
                (event.schemaVersion === 1
                  ? stableJson(event.guards.find((g) => g.id === id)) === stableJson(persisted)
                  : proof?.collection === 'orderReturnLines' &&
                    proof.returnId === event.returnId &&
                    stableJson(proof.after) === stableJson(persisted)),
              409,
              'RETURN_INTEGRITY',
              'Guard cumulativo de devolução inconsistente',
            );
          }
          const value =
            persisted ??
            s.returnGuardSchema.parse({
              id,
              tenantId: order.tenantId,
              orderId: order.id,
              lineId,
              productId: line.productId,
              unit: line.unit,
              expeditedScaled,
              pendingScaled: 0,
              receivedScaled: 0,
              sellableScaled: 0,
              damagedScaled: 0,
              resolvedSellableScaled: 0,
              acceptedDamagedScaled: 0,
              rejectedDamagedScaled: 0,
              valueResolvedCents: 0,
              version: 1,
              lastEventId: null,
              schemaVersion: 1,
            });
          return [lineId, { ...value }] as const;
        }),
      ),
    );
  }
  finish(
    tx: Transaction,
    book: Book,
    actor: Actor,
    op: string,
    now: string,
    type: z.infer<typeof s.returnEventSchema>['type'],
    reason: string,
    before: s.Return | null,
    lines: s.Return['lines'],
    guards: Map<string, s.ReturnGuard>,
    amount = 0,
    prepared?: Awaited<ReturnType<FinancialService['prepareRebate']>>,
  ) {
    const id = before?.id ?? digest(`return:${op}`),
      eventId = digest(`return-event:${op}`),
      status = returnState(lines);
    const after = s.returnSnapshotSchema.parse({
      id,
      orderId: book.order.id,
      dispatchReference: book.order.dispatchReference,
      customerId: book.order.customerId,
      status,
      lines,
      version: (before?.version ?? 0) + 1,
      reason,
      createdAt: before?.createdAt ?? now,
      createdBy: before?.createdBy ?? actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
    });
    const nextGuards = [...guards.values()].map((g) =>
      s.returnGuardSchema.parse({ ...g, version: g.version + 1, lastEventId: eventId }),
    );
    const content = {
      id: eventId,
      tenantId: book.order.tenantId,
      orderId: book.order.id,
      returnId: id,
      operationId: op,
      type,
      sequence: (before?.eventSequence ?? 0) + 1,
      previousHash: before?.headHash ?? digest(`return:${book.order.tenantId}:${id}`),
      before: before ? s.returnSnapshotSchema.parse(before) : null,
      after,
      guards: nextGuards,
      actorUid: actor.uid,
      occurredAt: now,
      reason,
      requestId: actor.requestId,
      schemaVersion: 1 as const,
    };
    const event = s.returnEventSchema.parse({ ...content, hash: returnEventHash(content) }),
      value = s.returnSchema.parse({
        ...after,
        tenantId: book.order.tenantId,
        eventSequence: event.sequence,
        headHash: event.hash,
        headEventId: eventId,
        schemaVersion: 1,
      });
    assertDocumentFits(this.repo.ref(value.tenantId, 'returns', id).path, value);
    assertDocumentFits(this.repo.ref(value.tenantId, 'returnEvents', eventId).path, event);
    for (const guard of nextGuards)
      tx.set(this.repo.ref(value.tenantId, 'orderReturnLines', guard.id), guard);
    tx.set(this.repo.ref(value.tenantId, 'returns', id), value);
    tx.create(this.repo.ref(value.tenantId, 'returnEvents', eventId), event);
    const state = {
      ...(prepared?.state ?? book.state),
      activeReturnCount:
        book.state.activeReturnCount +
        (!before ? 1 : 0) -
        (status === 'closed' && before?.status !== 'closed' ? 1 : 0),
    };
    const result = this.finance.book.save(
      tx,
      book,
      actor,
      op,
      now,
      `return_${type}`,
      amount,
      reason,
      prepared?.titles ?? book.titles,
      state,
      [id, eventId, ...(prepared?.references ?? [])],
      prepared?.projection,
    );
    return s.returnResult.parse({
      ...result,
      returnId: id,
      returnVersion: value.version,
      status,
      creditLotId: prepared?.destinations.creditLotId ?? null,
      refundObligationId: prepared?.destinations.refundObligationId ?? null,
    });
  }
  create(
    actor: Actor,
    tenantId: string,
    orderId: string,
    input: z.infer<typeof s.returnCreate>,
    key: string,
  ) {
    return this.finance.commands.execute(
      actor,
      tenantId,
      key,
      'return_intent',
      orderId,
      input,
      'returns:manage',
      s.returnResult,
      true,
      async (tx, _ctx, op, now) => {
        const book = await this.finance.book.load(tx, tenantId, orderId);
        this.finance.book.assertVersions(book, input);
        const guards = await this.guards(
          tx,
          book,
          input.lines.map((l) => l.lineId),
        );
        const lines = input.lines.map((l) => {
          const g = guards.get(l.lineId)!,
            requestedScaled = parseQuantity(l.quantity, g.unit);
          requireCondition(
            requestedScaled > 0 &&
              g.pendingScaled + g.receivedScaled + requestedScaled <= g.expeditedScaled,
            409,
            'RETURN_LIMIT',
            'Intenção excede quantidade expedida ainda disponível',
          );
          g.pendingScaled += requestedScaled;
          return s.returnLineSchema.parse({
            lineId: g.lineId,
            productId: g.productId,
            unit: g.unit,
            requestedScaled,
            receivedScaled: 0,
            sellableScaled: 0,
            damagedScaled: 0,
            resolvedSellableScaled: 0,
            acceptedDamagedScaled: 0,
            rejectedDamagedScaled: 0,
            valueResolvedCents: 0,
          });
        });
        return this.finish(tx, book, actor, op, now, 'intent', input.reason, null, lines, guards);
      },
    );
  }
  mutate<T extends z.infer<typeof s.returnCancel>>(
    actor: Actor,
    tenantId: string,
    id: string,
    input: T,
    key: string,
    type: 'edited' | 'canceled' | 'received' | 'resolved',
    work: (
      tx: Transaction,
      book: Book,
      value: s.Return,
      guards: Map<string, s.ReturnGuard>,
      op: string,
      now: string,
    ) => Promise<{
      lines: s.Return['lines'];
      amount?: number;
      prepared?: Awaited<ReturnType<FinancialService['prepareRebate']>>;
      apply?: () => void;
    }>,
    additionalIds: string[] = [],
  ) {
    return this.finance.commands.execute(
      actor,
      tenantId,
      key,
      `return_${type}`,
      id,
      input,
      'returns:manage',
      s.returnResult,
      true,
      async (tx, _ctx, op, now) => {
        const value = await this.load(tx, tenantId, id),
          book = await this.finance.book.load(tx, tenantId, value.orderId);
        this.finance.book.assertVersions(book, input);
        requireCondition(
          value.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão da devolução desatualizada',
        );
        requireCondition(
          value.status !== 'closed' &&
            book.state.activeReturnCount > 0 &&
            value.dispatchReference === book.order.dispatchReference &&
            value.customerId === book.order.customerId,
          409,
          'RETURN_CLOSED',
          'Devolução encerrada ou bloqueio inconsistente',
        );
        const guards = await this.guards(tx, book, [
          ...new Set([...value.lines.map((l) => l.lineId), ...additionalIds]),
        ]);
        for (const l of value.lines) {
          const g = guards.get(l.lineId)!;
          requireCondition(
            g.pendingScaled >= l.requestedScaled - l.receivedScaled &&
              g.receivedScaled >= l.receivedScaled &&
              g.sellableScaled >= l.sellableScaled &&
              g.damagedScaled >= l.damagedScaled &&
              (g.damagedValueReductionCents ?? 0) >= (l.damagedValueReductionCents ?? 0) &&
              g.valueResolvedCents >= l.valueResolvedCents,
            409,
            'RETURN_INTEGRITY',
            'Intenção diverge de limites cumulativos',
          );
        }
        const result = await work(tx, book, value, guards, op, now);
        result.apply?.();
        result.prepared?.apply();
        return this.finish(
          tx,
          book,
          actor,
          op,
          now,
          type,
          input.reason,
          value,
          result.lines,
          guards,
          result.amount ?? 0,
          result.prepared,
        );
      },
    );
  }
  update(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.returnUpdate>,
    key: string,
  ) {
    return this.mutate(
      actor,
      tenantId,
      id,
      input,
      key,
      'edited',
      async (_tx, _book, value, guards) => {
        const lines = value.lines.map((l) => ({ ...l })),
          wanted = new Map(input.lines.map((l) => [l.lineId, l.quantity]));
        for (const g of guards.values()) {
          const old = lines.find((l) => l.lineId === g.lineId);
          const requested = wanted.has(g.lineId)
            ? parseQuantity(wanted.get(g.lineId)!, g.unit)
            : (old?.receivedScaled ?? 0);
          requireCondition(
            requested > 0 || !wanted.has(g.lineId),
            422,
            'INVALID_QUANTITY',
            'Quantidade deve ser positiva',
          );
          requireCondition(
            requested >= (old?.receivedScaled ?? 0),
            409,
            'RETURN_LIMIT',
            'Correção não pode remover recebimento físico',
          );
          const delta = requested - (old?.requestedScaled ?? 0);
          requireCondition(
            g.pendingScaled + g.receivedScaled + delta <= g.expeditedScaled &&
              g.pendingScaled + delta >= 0,
            409,
            'RETURN_LIMIT',
            'Correção excede expedição',
          );
          g.pendingScaled += delta;
          if (old) old.requestedScaled = requested;
          else
            lines.push(
              s.returnLineSchema.parse({
                lineId: g.lineId,
                productId: g.productId,
                unit: g.unit,
                requestedScaled: requested,
                receivedScaled: 0,
                sellableScaled: 0,
                damagedScaled: 0,
                resolvedSellableScaled: 0,
                acceptedDamagedScaled: 0,
                rejectedDamagedScaled: 0,
                valueResolvedCents: 0,
              }),
            );
        }
        return { lines };
      },
      input.lines.map((l) => l.lineId),
    );
  }
  cancel(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.returnCancel>,
    key: string,
  ) {
    return this.mutate(
      actor,
      tenantId,
      id,
      input,
      key,
      'canceled',
      async (_tx, _book, value, guards) => {
        requireCondition(
          value.lines.some((l) => l.requestedScaled > l.receivedScaled),
          409,
          'RETURN_NO_PENDING',
          'Não há saldo físico pendente para cancelar',
        );
        return {
          lines: value.lines.map((l) => {
            guards.get(l.lineId)!.pendingScaled -= l.requestedScaled - l.receivedScaled;
            return { ...l, requestedScaled: l.receivedScaled };
          }),
        };
      },
    );
  }
  receive(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.returnReceive>,
    key: string,
  ) {
    return this.mutate(
      actor,
      tenantId,
      id,
      input,
      key,
      'received',
      async (tx, book, value, guards, op, now) => {
        const lines = value.lines.map((l) => ({ ...l })),
          chunks = input.lines.map((row) => {
            const l = lines.find((l) => l.lineId === row.lineId);
            requireCondition(l, 404, 'RESOURCE_NOT_FOUND', 'Linha não pertence à intenção');
            const sellable = row.sellableQuantity ? parseQuantity(row.sellableQuantity, l.unit) : 0,
              damaged = row.damagedQuantity ? parseQuantity(row.damagedQuantity, l.unit) : 0,
              qty = sellable + damaged;
            requireCondition(
              qty > 0 && qty <= l.requestedScaled - l.receivedScaled,
              409,
              'RETURN_LIMIT',
              'Recebimento excede saldo físico da intenção',
            );
            const g = guards.get(l.lineId)!;
            g.pendingScaled -= qty;
            g.receivedScaled += qty;
            g.sellableScaled += sellable;
            g.damagedScaled += damaged;
            l.receivedScaled += qty;
            l.sellableScaled += sellable;
            l.damagedScaled += damaged;
            return {
              lineId: l.lineId,
              productId: l.productId,
              unit: l.unit,
              sellableScaled: sellable,
              damagedScaled: damaged,
            };
          });
        const prepared = await this.stock.prepare(
          tx,
          book,
          chunks
            .filter((c) => c.sellableScaled > 0)
            .map((c) => ({ lineId: c.lineId, quantityScaled: c.sellableScaled })),
          actor,
          id,
          op,
          now,
        );
        const receipt = s.returnReceiptSchema.parse({
          id: op,
          tenantId: book.order.tenantId,
          orderId: book.order.id,
          returnId: id,
          dispatchReference: book.order.dispatchReference,
          actorUid: actor.uid,
          recordedAt: now,
          reason: input.reason,
          lines: chunks.map((c) => ({
            ...c,
            movementId: prepared.movementIds.get(c.lineId) ?? null,
          })),
          schemaVersion: 1,
        });
        assertDocumentFits(this.repo.ref(tenantId, 'returnReceipts', op).path, receipt);
        return {
          lines,
          apply: () => {
            prepared.apply();
            tx.create(this.repo.ref(tenantId, 'returnReceipts', op), receipt);
          },
        };
      },
    );
  }
  resolve(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.returnResolve>,
    key: string,
  ) {
    return this.mutate(
      actor,
      tenantId,
      id,
      input,
      key,
      'resolved',
      async (tx, book, value, guards, op, now) => {
        const lines = value.lines.map((l) => ({ ...l })),
          decisions = new Map(input.damagedDecisions?.map((d) => [d.lineId, d]) ?? []);
        let amount = 0,
          count = 0;
        for (const l of lines) {
          const sellable = l.sellableScaled - l.resolvedSellableScaled,
            damaged = l.damagedScaled - l.acceptedDamagedScaled - l.rejectedDamagedScaled,
            g = guards.get(l.lineId)!;
          requireCondition(
            !damaged || decisions.has(l.lineId),
            422,
            'DAMAGED_ACCEPTANCE_REQUIRED',
            'Aceite ou rejeição administrativa obrigatório para produto danificado',
          );
          const decision = decisions.get(l.lineId),
            accepted = damaged && decision?.accept === true ? damaged : 0,
            rejected = damaged - accepted,
            original = book.order.lines.find((o) => o.id === l.lineId)!,
            limits = returnedValueLimits(
              original.totalCents,
              g.expeditedScaled,
              g.resolvedSellableScaled + g.acceptedDamagedScaled,
              sellable,
              accepted,
            ),
            acceptedCents = decision?.acceptedCents ?? limits.damagedLimitCents;
          requireCondition(
            acceptedCents <= limits.damagedLimitCents,
            409,
            'RETURN_VALUE_LIMIT',
            'Valor aceito excede limite cumulativo do dano recebido',
          );
          const reduction = limits.damagedLimitCents - acceptedCents,
            delta = limits.sellableCents + acceptedCents;
          if (sellable || damaged) count++;
          if (damaged) decisions.delete(l.lineId);
          g.resolvedSellableScaled += sellable;
          g.acceptedDamagedScaled += accepted;
          g.rejectedDamagedScaled += rejected;
          if (reduction) {
            g.damagedValueReductionCents = (g.damagedValueReductionCents ?? 0) + reduction;
            l.damagedValueReductionCents = (l.damagedValueReductionCents ?? 0) + reduction;
          }
          g.valueResolvedCents += delta;
          l.resolvedSellableScaled += sellable;
          l.acceptedDamagedScaled += accepted;
          l.rejectedDamagedScaled += rejected;
          l.valueResolvedCents += delta;
          amount += delta;
        }
        requireCondition(
          count > 0 && decisions.size === 0,
          422,
          'RETURN_NOT_RESOLVABLE',
          'Nenhuma quantidade pendente ou decisão sem recebimento danificado',
        );
        const prepared = await this.finance.prepareRebate(
          tx,
          book,
          amount,
          op,
          now,
          input.disposition,
        );
        return { lines, amount, prepared };
      },
    );
  }
  view(value: s.Return) {
    return s.returnView.parse({
      ...value,
      lines: value.lines.map((l) => ({
        lineId: l.lineId,
        productId: l.productId,
        unit: l.unit,
        requested: formatQuantity(l.requestedScaled),
        received: formatQuantity(l.receivedScaled),
        pending: formatQuantity(l.requestedScaled - l.receivedScaled),
        sellableReceived: formatQuantity(l.sellableScaled),
        damagedReceived: formatQuantity(l.damagedScaled),
        financialResolved: formatQuantity(
          l.resolvedSellableScaled + l.acceptedDamagedScaled + l.rejectedDamagedScaled,
        ),
        acceptedDamaged: formatQuantity(l.acceptedDamagedScaled),
        rejectedDamaged: formatQuantity(l.rejectedDamagedScaled),
        valueResolvedCents: l.valueResolvedCents,
        damagedValueReductionCents: l.damagedValueReductionCents ?? 0,
      })),
    });
  }
  async get(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.finance.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        return this.view(await this.load(tx, tenantId, id));
      },
      { readOnly: true },
    );
  }
  async resolutionPreview(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.finance.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        const value = await this.load(tx, tenantId, id),
          book = await this.finance.book.load(tx, tenantId, value.orderId),
          guards = await this.guards(
            tx,
            book,
            value.lines.map((l) => l.lineId),
          );
        return s.returnResolutionPreview.parse({
          returnId: id,
          expectedVersion: value.version,
          expectedOrderVersion: book.order.version,
          expectedGuardVersion: book.guard.version,
          lines: value.lines.map((l) => {
            const g = guards.get(l.lineId)!,
              original = book.order.lines.find((o) => o.id === l.lineId)!,
              sellable = l.sellableScaled - l.resolvedSellableScaled,
              damaged = l.damagedScaled - l.acceptedDamagedScaled - l.rejectedDamagedScaled;
            return {
              lineId: l.lineId,
              sellableQuantity: formatQuantity(sellable),
              damagedQuantity: formatQuantity(damaged),
              ...returnedValueLimits(
                original.totalCents,
                g.expeditedScaled,
                g.resolvedSellableScaled + g.acceptedDamagedScaled,
                sellable,
                damaged,
              ),
            };
          }),
        });
      },
      { readOnly: true },
    );
  }
  async list(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.returnsQuery>,
    returnId?: string,
    kind: 'returns' | 'returnEvents' | 'returnReceipts' = 'returns',
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.finance.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
        if (returnId) await this.load(tx, tenantId, returnId);
        const scope = digest(
          stableJson({ actor: actor.uid, tenantId, returnId, kind, ...input, cursor: undefined }),
        );
        let query: Query = this.repo.ref(tenantId, kind, 'placeholder').parent;
        if (returnId) query = query.where('returnId', '==', returnId);
        if (input.orderId) query = query.where('orderId', '==', input.orderId);
        query = query.orderBy(FieldPath.documentId());
        const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
        if (cursor) query = query.startAfter(cursor);
        const limit = Number(input.limit ?? '25'),
          page = await tx.get(query.limit(limit + 1)),
          docs = page.docs.slice(0, limit);
        const items = await Promise.all(
          docs.map(async (d) => {
            if (kind === 'returns') return this.view(await this.load(tx, tenantId, d.id));
            if (kind === 'returnEvents') {
              const event = await this.repo.foundation.readSnapshot(d, s.returnEventSchema, tx);
              requireCondition(
                event &&
                  event.id === d.id &&
                  event.tenantId === tenantId &&
                  event.returnId === returnId &&
                  event.hash === returnEventHash(event),
                409,
                'RETURN_INTEGRITY',
                'Evento de devolução inconsistente',
              );
              return event;
            }
            const receipt = s.returnReceiptSchema.parse(d.data());
            requireCondition(
              receipt.id === d.id && receipt.tenantId === tenantId && receipt.returnId === returnId,
              409,
              'RETURN_INTEGRITY',
              'Recebimento físico inconsistente',
            );
            return s.returnReceiptView.parse({
              ...receipt,
              lines: receipt.lines.map((l) => ({
                ...l,
                sellableQuantity: formatQuantity(l.sellableScaled),
                damagedQuantity: formatQuantity(l.damagedScaled),
              })),
            });
          }),
        );
        return {
          items,
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
