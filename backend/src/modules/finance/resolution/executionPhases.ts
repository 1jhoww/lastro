import { FieldPath, type Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { TenantContext } from '../../../shared/types/context.js';
import type { FinancialExecution } from '../../../shared/schemas/financialExecutions.js';
import { executionLockSchema } from '../../../shared/schemas/financialExecutions.js';
import { orderSchema, stockReservationSchema } from '../../../shared/schemas/orders.js';
import * as s from '../../../shared/schemas/finance.js';
import * as r from '../../../shared/schemas/returns.js';
import { financialOperationSchema } from '../financialCommands.js';
import type { FinancialService } from '../financialService.js';
import type { ReturnService } from '../../returns/returnService.js';
import { financialEventHash } from '../financialBook.js';
import { returnedValueLimits } from '../../returns/calculation.js';
import { parseQuantity } from '../../inventory/quantities.js';
import { reservationIdFor } from '../../inventory/orderStockAdapter.js';
import { digest, stableJson } from '../../../shared/utils/crypto.js';
import { requireCondition } from '../../../shared/errors/appError.js';
import {
  sourcePlanSchema,
  lotPlanSchema,
  stockPlanSchema,
  ensure,
  move,
  allocateIntent,
  appendChain,
  type ResolutionPlan,
  type SourcePlan,
} from './executionModel.js';
import { activeSourceSchema, activeSourceId } from './sourceIndex.js';
import {
  sealSourceProof,
  sourceProofSchema,
  sourceProofHash,
  sourceProofId,
  type SourceProof,
} from './proofRecords.js';
import {
  proofLeafHash,
  proofBranchHash,
  proofRootHash,
  emptyProofRootHash,
  verifyProofMembership,
} from './proofs.js';
import {
  proofChunkSchema,
  proofNodeSchema,
  proofNodeId,
  siblingIntervals,
} from './proofStorage.js';
import { batchReads } from './batchReads.js';

export class ResolutionPhases {
  constructor(
    readonly finance: FinancialService,
    readonly returns: ReturnService,
  ) {}
  get repo() {
    return this.finance.repo;
  }
  async order(tx: Transaction, e: FinancialExecution) {
    const order = await this.repo.foundation.read(
      this.repo.ref(e.tenantId, 'orders', e.orderId),
      orderSchema,
      tx,
    );
    ensure(
      order?.id === e.orderId &&
        order.tenantId === e.tenantId &&
        order.version === e.baseline.orderVersion &&
        digest(stableJson(order)) === e.baseline.orderHash,
    );
    return order;
  }
  async planning(
    tx: Transaction,
    e: FinancialExecution,
    p: ResolutionPlan,
    limit: number,
    now: string,
  ) {
    if (e.phase === 'stock') {
      const order = await this.order(tx, e);
      const items = order.lines.slice(p.stockPlanned, p.stockPlanned + limit);
      const plans = [];
      for (const line of items) {
        const reservationId = reservationIdFor(e.tenantId, e.orderId, line.id, line.productId);
        const reservation = await this.repo.foundation.read(
          this.repo.ref(e.tenantId, 'stockReservations', reservationId),
          stockReservationSchema,
          tx,
        );
        const quantityScaled = parseQuantity(line.quantity, line.unit);
        ensure(
          reservation?.tenantId === e.tenantId &&
            reservation.orderId === e.orderId &&
            reservation.lineId === line.id &&
            reservation.productId === line.productId &&
            reservation.quantityScaled === quantityScaled &&
            reservation.status === 'reserved',
        );
        plans.push(
          stockPlanSchema.parse({
            id: digest(`financial-stock-plan:${e.id}:${line.id}`),
            tenantId: e.tenantId,
            executionId: e.id,
            position: p.stockPlanned + plans.length,
            lineId: line.id,
            productId: line.productId,
            quantityScaled,
            reservationId,
            schemaVersion: 1,
          }),
        );
      }
      p.stockPlanned += plans.length;
      if (p.stockPlanned === e.baseline.lineCount) move(e, 'PLANNING', 'credits');
      for (const record of plans)
        tx.create(this.repo.ref(e.tenantId, 'financialExecutionStockPlans', record.id), record);
      return;
    }
    if (e.phase === 'return-lines') return this.returnLines(tx, e, p, limit, now);
    if (e.amountCents === 0) {
      if (p.generation) p.nextGenerationId = p.generation.generationId;
      p.planFence = e.fencingToken;
      move(e, 'SEALING', 'sources');
      return;
    }
    ensure(p.generation?.certified);
    const target = p.targets[p.titleIndex];
    if (!target) {
      ensure(
        p.scannedRows === p.generation.rowCount &&
          stableJson(p.scannedTotals) === stableJson(p.generation.totals) &&
          p.targets.every((t) => t.cashLeft === 0 && t.creditLeft === 0),
      );
      p.planFence = e.fencingToken;
      move(e, 'SEALING', 'sources');
      return;
    }
    const kind = p.sourceKind;
    let query = this.repo
      .ref(e.tenantId, 'financialActiveSources', 'placeholder')
      .parent.where('orderId', '==', e.orderId)
      .where('generationId', '==', p.generation.generationId)
      .where('kind', '==', kind)
      .where('titleId', '==', target.titleId)
      .orderBy('sourceTime')
      .orderBy('sourceId')
      .orderBy(FieldPath.documentId());
    if (e.checkpoint.lastId)
      query = query.startAfter(
        e.checkpoint.lastTime,
        e.checkpoint.lastId,
        activeSourceId(
          e.tenantId,
          p.generation.generationId,
          kind,
          e.checkpoint.lastId,
          target.titleId,
        ),
      );
    const page = await tx.get(query.limit(limit + 1));
    tx = await batchReads(
      tx,
      page.docs.slice(0, limit).flatMap((doc) => {
        const row = activeSourceSchema.parse(doc.data());
        const collection = kind === 'cash' ? 'payments' : 'creditApplications';
        return [
          this.repo.ref(e.tenantId, collection, row.sourceId),
          this.repo.ref(e.tenantId, 'financialEvents', digest(`financial-event:${row.sourceId}`)),
          this.repo.ref(e.tenantId, 'financialOperations', row.sourceId),
          this.repo.ref(
            e.tenantId,
            'financialExecutionSourcePlans',
            sourceProofId(e.tenantId, e.id, collection, row.sourceId),
          ),
          ...(row.lotId
            ? [
                this.repo.ref(
                  e.tenantId,
                  'financialExecutionLotPlans',
                  sourceProofId(e.tenantId, e.id, 'creditLots', row.lotId),
                ),
              ]
            : []),
        ];
      }),
    );
    const sourcePlans: SourcePlan[] = [],
      lots = new Map<string, z.infer<typeof lotPlanSchema>>();
    for (const doc of page.docs.slice(0, limit)) {
      const row = activeSourceSchema.parse(doc.data());
      ensure(
        row.id === doc.id &&
          row.tenantId === e.tenantId &&
          row.orderId === e.orderId &&
          row.customerId === e.baseline.customerId &&
          row.kind === kind &&
          row.titleId === target.titleId &&
          row.generationId === p.generation.generationId &&
          row.id === activeSourceId(e.tenantId, row.generationId, kind, row.sourceId, row.titleId),
      );
      const before =
        kind === 'cash'
          ? await this.finance.paymentFor(tx, e.tenantId, row.sourceId)
          : await this.finance.creditFor(tx, e.tenantId, row.sourceId);
      ensure(
        before.orderId === e.orderId &&
          before.customerId === e.baseline.customerId &&
          before.version === row.sourceVersion &&
          digest(stableJson(before)) === row.sourceHash &&
          before.allocations.find((a) => a.receivableId === row.titleId)?.remainingCents ===
            row.remainingCents,
      );
      await this.origin(tx, e, before, kind);
      const collection = kind === 'cash' ? 'payments' : 'creditApplications';
      const id = sourceProofId(e.tenantId, e.id, collection, before.id);
      const prior = await this.repo.foundation.read(
        this.repo.ref(e.tenantId, 'financialExecutionSourcePlans', id),
        sourcePlanSchema,
        tx,
      );
      if (prior) ensure(stableJson(prior.before) === stableJson(before));
      else p.sourceCount++;
      const record: SourcePlan =
        prior ??
        (kind === 'cash'
          ? sourcePlanSchema.parse({
              id,
              tenantId: e.tenantId,
              executionId: e.id,
              sourceId: before.id,
              collection: 'payments',
              before,
              after: before,
              entry: null,
              linePosition: null,
              schemaVersion: 1,
            })
          : sourcePlanSchema.parse({
              id,
              tenantId: e.tenantId,
              executionId: e.id,
              sourceId: before.id,
              collection: 'creditApplications',
              before,
              after: before,
              entry: null,
              linePosition: null,
              schemaVersion: 1,
            }));
      ensure(
        record.collection !== 'orderReturnLines' &&
          record.tenantId === e.tenantId &&
          record.executionId === e.id,
      );
      const take = Math.min(
        row.remainingCents,
        kind === 'cash' ? target.cashLeft : target.creditLeft,
      );
      record.after = {
        ...record.after,
        allocations: record.after.allocations.map((a) => ({
          ...a,
          remainingCents: a.remainingCents - (a.receivableId === row.titleId ? take : 0),
        })),
      };
      if (take) {
        if (record.collection === 'payments') {
          record.after.transferredCents += take;
          record.after.version = record.before.version + 1;
          target.cashLeft -= take;
        } else {
          record.after.restoredByCancellationCents += take;
          record.after.version = record.before.version + 1;
          record.after.status = record.after.allocations.some((a) => a.remainingCents)
            ? 'active'
            : 'restored';
          target.creditLeft -= take;
          const lotId = record.before.creditLotId,
            planId = sourceProofId(e.tenantId, e.id, 'creditLots', lotId);
          let lot = lots.get(lotId);
          if (!lot) {
            lot =
              (await this.repo.foundation.read(
                this.repo.ref(e.tenantId, 'financialExecutionLotPlans', planId),
                lotPlanSchema,
                tx,
              )) ??
              lotPlanSchema.parse({
                id: planId,
                tenantId: e.tenantId,
                executionId: e.id,
                sourceId: lotId,
                amountCents: take,
                entry: null,
                schemaVersion: 1,
              });
            if (
              lot.amountCents === take &&
              !(await tx.get(this.repo.ref(e.tenantId, 'financialExecutionLotPlans', planId)))
                .exists
            ) {
              p.lotCount++;
              lot.amountCents = 0;
            }
            lots.set(lotId, lot);
          }
          lot.amountCents += take;
        }
        e.progress.eligible++;
      }
      const total = p.scannedTotals.find((t) => t.titleId === row.titleId)!;
      if (kind === 'cash') total.cashCents += row.remainingCents;
      else total.creditCents += row.remainingCents;
      p.scannedRows++;
      e.progress.examined++;
      e.checkpoint.lastId = row.sourceId;
      e.checkpoint.lastTime = row.sourceTime;
      sourcePlans.push(sourcePlanSchema.parse(record));
    }
    if (page.size <= limit) {
      e.checkpoint.lastId = null;
      e.checkpoint.lastTime = null;
      if (kind === 'credit') p.sourceKind = 'cash';
      else {
        p.sourceKind = 'credit';
        p.titleIndex++;
      }
      e.phase = p.sourceKind === 'cash' ? 'payments' : 'credits';
      e.checkpoint.phase = e.phase;
    }
    for (const record of sourcePlans)
      tx.set(this.repo.ref(e.tenantId, 'financialExecutionSourcePlans', record.id), record);
    for (const lot of lots.values())
      tx.set(
        this.repo.ref(e.tenantId, 'financialExecutionLotPlans', lot.id),
        lotPlanSchema.parse(lot),
      );
  }
  private async origin(
    tx: Transaction,
    e: FinancialExecution,
    source: z.infer<typeof s.paymentSchema> | z.infer<typeof s.creditSchema>,
    kind: 'cash' | 'credit',
  ) {
    const originId = digest(`financial-event:${source.id}`);
    const origin = await this.repo.foundation.read(
      this.repo.ref(e.tenantId, 'financialEvents', originId),
      s.eventSchema,
      tx,
    );
    const operation = await this.repo.foundation.read(
      this.repo.ref(e.tenantId, 'financialOperations', source.id),
      financialOperationSchema,
      tx,
    );
    const result = operation ? s.financialResult.safeParse(operation.result) : null;
    const occurredAt = 'recordedAt' in source ? source.recordedAt : source.createdAt;
    ensure(
      origin?.id === originId &&
        origin.tenantId === e.tenantId &&
        origin.orderId === e.orderId &&
        origin.customerId === e.baseline.customerId &&
        origin.hash === financialEventHash(origin) &&
        origin.operationId === source.id &&
        origin.references.includes(source.id) &&
        origin.amountCents === source.amountCents &&
        origin.sequence <= e.baseline.state.eventSequence &&
        origin.type === (kind === 'cash' ? 'receipt' : 'credit_application') &&
        operation?.resourceId === e.orderId &&
        operation.actorUid === source.createdBy &&
        operation.createdAt === occurredAt &&
        origin.actorUid === source.createdBy &&
        origin.occurredAt === occurredAt &&
        result?.success &&
        result.data.operationId === source.id &&
        result.data.resourceId === source.id &&
        result.data.eventId === origin.id &&
        result.data.orderId === e.orderId &&
        result.data.amountCents === source.amountCents &&
        result.data.orderVersion <= e.baseline.orderVersion &&
        result.data.guardVersion <= e.baseline.guard.version &&
        operation.action === (kind === 'cash' ? 'receipt' : 'credit_application'),
    );
    for (const a of source.allocations) {
      const b = origin.before.titles.find((t) => t.id === a.receivableId),
        c = origin.after.titles.find((t) => t.id === a.receivableId);
      ensure(
        b &&
          c &&
          a.amountCents ===
            (kind === 'cash' ? c.cashCents - b.cashCents : c.creditCents - b.creditCents),
      );
    }
  }
  private async returnLines(
    tx: Transaction,
    e: FinancialExecution,
    p: ResolutionPlan,
    limit: number,
    now: string,
  ) {
    ensure(p.returnInfo && e.returnId);
    const order = await this.order(tx, e);
    const raw = r.returnSchema.parse(
      (await tx.get(this.repo.ref(e.tenantId, 'returns', e.returnId))).data(),
    );
    ensure(digest(stableJson(raw)) === p.returnInfo.rawHash);
    const beforeHeader = await this.repo.foundation.read(
      this.repo.ref(e.tenantId, 'returnResolutionStates', e.returnId),
      (await import('./proofRecords.js')).returnResolutionHeaderSchema,
      tx,
    );
    const lines = raw.lines.slice(p.returnInfo.scanned, p.returnInfo.scanned + limit);
    const guards = await this.returns.guards(
      tx,
      { order },
      lines.map((l) => l.lineId),
    );
    const records: SourcePlan[] = [];
    for (const rawLine of lines) {
      let line = rawLine;
      if (beforeHeader && raw.version < beforeHeader.version) {
        const proof = await this.repo.foundation.provenSource(
          e.tenantId,
          'orderReturnLines',
          digest(`return-line:${e.tenantId}:${e.orderId}:${rawLine.lineId}`),
          beforeHeader.executionId,
          tx,
        );
        ensure(proof.collection === 'orderReturnLines' && proof.returnId === e.returnId);
        line = proof.lineAfter;
      }
      const before = guards.get(line.lineId)!;
      const after = { ...before },
        nextLine = { ...line };
      const sellable = line.sellableScaled - line.resolvedSellableScaled;
      const damaged = line.damagedScaled - line.acceptedDamagedScaled - line.rejectedDamagedScaled;
      const decision = p.returnInfo.decisions?.find((d) => d.lineId === line.lineId);
      requireCondition(
        !damaged || decision,
        422,
        'DAMAGED_ACCEPTANCE_REQUIRED',
        'Aceite administrativo de dano obrigatório',
      );
      if (decision) {
        ensure(damaged > 0);
        p.returnInfo.seenDecisions++;
      }
      const accepted = damaged && decision?.accept ? damaged : 0,
        rejected = damaged - accepted;
      const original = order.lines.find((l) => l.id === line.lineId)!;
      const limits = returnedValueLimits(
        original.totalCents,
        before.expeditedScaled,
        before.resolvedSellableScaled + before.acceptedDamagedScaled,
        sellable,
        accepted,
      );
      const acceptedCents = decision?.acceptedCents ?? limits.damagedLimitCents;
      requireCondition(
        acceptedCents <= limits.damagedLimitCents,
        409,
        'RETURN_VALUE_LIMIT',
        'Valor de dano excede limite',
      );
      const delta = limits.sellableCents + acceptedCents,
        reduction = limits.damagedLimitCents - acceptedCents;
      for (const value of [after, nextLine]) {
        value.resolvedSellableScaled += sellable;
        value.acceptedDamagedScaled += accepted;
        value.rejectedDamagedScaled += rejected;
        value.valueResolvedCents += delta;
        if (reduction)
          value.damagedValueReductionCents = (value.damagedValueReductionCents ?? 0) + reduction;
      }
      after.version++;
      after.lastEventId = digest(`return-event:${e.id}`);
      records.push(
        sourcePlanSchema.parse({
          id: sourceProofId(e.tenantId, e.id, 'orderReturnLines', before.id),
          tenantId: e.tenantId,
          executionId: e.id,
          sourceId: before.id,
          collection: 'orderReturnLines',
          returnId: e.returnId,
          before,
          after,
          lineBefore: line,
          lineAfter: nextLine,
          entry: null,
          linePosition: p.returnInfo.scanned,
          schemaVersion: 1,
        }),
      );
      p.returnInfo.scanned++;
      if (sellable || damaged) p.returnInfo.eligibleLines++;
      e.amountCents += delta;
    }
    if (p.returnInfo.scanned === p.returnInfo.lineCount) {
      requireCondition(
        p.returnInfo.eligibleLines > 0 &&
          p.returnInfo.seenDecisions === (p.returnInfo.decisions?.length ?? 0),
        422,
        'RETURN_NOT_RESOLVABLE',
        'Nenhuma quantidade elegível ou decisão inválida',
      );
      allocateIntent(e, p, e.amountCents, now);
      move(
        e,
        p.generation?.certified || e.amountCents === 0 ? 'PLANNING' : 'INDEXING',
        p.generation?.certified || e.amountCents === 0 ? 'credits' : 'journal',
      );
    }
    for (const record of records)
      tx.create(this.repo.ref(e.tenantId, 'financialExecutionSourcePlans', record.id), record);
  }
  async sealing(
    tx: Transaction,
    e: FinancialExecution,
    p: ResolutionPlan,
    limit: number,
    now: string,
  ) {
    if (e.phase === 'merkle') return this.merkle(tx, e, p, limit);
    if (e.phase === 'lot-locks') return this.sealLots(tx, e, p, limit, now);
    let query = this.repo
      .ref(e.tenantId, 'financialExecutionSourcePlans', 'placeholder')
      .parent.where('executionId', '==', e.id)
      .orderBy(FieldPath.documentId());
    if (e.checkpoint.lastId) query = query.startAfter(e.checkpoint.lastId);
    const page = await tx.get(query.limit(limit + 1));
    const staged: (() => void)[] = [];
    for (const doc of page.docs.slice(0, limit)) {
      const record = sourcePlanSchema.parse(doc.data());
      ensure(record.id === doc.id && record.tenantId === e.tenantId && record.executionId === e.id);
      let entry: SourceProof | null = null;
      if (record.collection === 'orderReturnLines')
        entry = sealSourceProof({
          tenantId: e.tenantId,
          executionId: e.id,
          collection: record.collection,
          sourceId: record.sourceId,
          fence: p.planFence,
          position: e.proofEntryCount,
          before: record.before,
          after: record.after,
          returnId: record.returnId,
          lineBefore: record.lineBefore,
          lineAfter: record.lineAfter,
        });
      else {
        if (record.before.version !== record.after.version)
          entry =
            record.collection === 'payments'
              ? sealSourceProof({
                  tenantId: e.tenantId,
                  executionId: e.id,
                  collection: 'payments',
                  sourceId: record.sourceId,
                  fence: p.planFence,
                  position: e.proofEntryCount,
                  before: record.before,
                  after: record.after,
                })
              : sealSourceProof({
                  tenantId: e.tenantId,
                  executionId: e.id,
                  collection: 'creditApplications',
                  sourceId: record.sourceId,
                  fence: p.planFence,
                  position: e.proofEntryCount,
                  before: record.before,
                  after: record.after,
                });
        for (const allocation of record.after.allocations)
          if (allocation.remainingCents > 0) {
            const kind = record.collection === 'payments' ? 'cash' : 'credit';
            const row = activeSourceSchema.parse({
              id: activeSourceId(
                e.tenantId,
                p.nextGenerationId,
                kind,
                record.sourceId,
                allocation.receivableId,
              ),
              tenantId: e.tenantId,
              orderId: e.orderId,
              customerId: e.baseline.customerId,
              generationId: p.nextGenerationId,
              titleId: allocation.receivableId,
              kind,
              sourceId: record.sourceId,
              sourceVersion: record.after.version,
              sourceHash: digest(stableJson(record.after)),
              sourceTime:
                record.collection === 'payments' ? record.after.recordedAt : record.after.createdAt,
              remainingCents: allocation.remainingCents,
              lotId: record.collection === 'creditApplications' ? record.after.creditLotId : null,
              originEventId: digest(`financial-event:${record.sourceId}`),
              proofEventId: entry
                ? digest(`financial-event:${e.id}`)
                : p.generation!.headHash === e.baseline.state.headHash
                  ? e.baseline.state.headEventId
                  : null,
              proofEntryId: entry?.id ?? null,
              schemaVersion: 1,
            });
            const total = p.nextTotals.find((t) => t.titleId === allocation.receivableId)!;
            if (kind === 'cash') total.cashCents += allocation.remainingCents;
            else total.creditCents += allocation.remainingCents;
            p.nextRows++;
            staged.push(() =>
              tx.create(this.repo.ref(e.tenantId, 'financialActiveSources', row.id), row),
            );
          }
      }
      if (entry) {
        this.stageEntry(tx, e, p, entry, staged);
        record.entry = entry;
        staged.push(() => tx.set(doc.ref, sourcePlanSchema.parse(record)));
      }
      e.checkpoint.lastId = doc.id;
    }
    if (page.size <= limit) move(e, 'SEALING', 'lot-locks');
    staged.forEach((write) => write());
  }
  private stageEntry(
    tx: Transaction,
    e: FinancialExecution,
    p: ResolutionPlan,
    entry: SourceProof,
    writes: (() => void)[],
  ) {
    ensure(Buffer.byteLength(stableJson(entry)) <= 64 * 1024);
    writes.push(() =>
      tx.create(this.repo.ref(e.tenantId, 'financialProofEntries', entry.id), entry),
    );
    const chunk = proofChunkSchema.parse({
      tenantId: e.tenantId,
      executionId: e.id,
      entryId: entry.id,
      position: entry.position,
      entryHash: entry.hash,
      entry,
      siblings: null,
      schemaVersion: 1,
    });
    writes.push(() =>
      tx.create(this.repo.ref(e.tenantId, 'financialProofChunks', entry.id), chunk),
    );
    p.sealedChain = appendChain(p.sealedChain, entry);
    e.proofEntryCount++;
    e.progress.planned++;
    e.progress.sealed++;
  }
  private async sealLots(
    tx: Transaction,
    e: FinancialExecution,
    p: ResolutionPlan,
    limit: number,
    now: string,
  ) {
    let query = this.repo
      .ref(e.tenantId, 'financialExecutionLotPlans', 'placeholder')
      .parent.where('executionId', '==', e.id)
      .orderBy('sourceId');
    if (e.checkpoint.lastId) query = query.startAfter(e.checkpoint.lastId);
    const page = await tx.get(query.limit(limit + 1)),
      staged: (() => void)[] = [];
    for (const doc of page.docs.slice(0, limit)) {
      const record = lotPlanSchema.parse(doc.data());
      ensure(record.tenantId === e.tenantId && record.executionId === e.id);
      await this.finance.commands.locks.assertLotAvailable(tx, e.tenantId, record.sourceId);
      const before = await this.finance.lotFor(tx, e.tenantId, record.sourceId);
      ensure(
        before.customerId === e.baseline.customerId && before.appliedCents >= record.amountCents,
      );
      const after = s.lotSchema.parse({
        ...before,
        availableCents: before.availableCents + record.amountCents,
        appliedCents: before.appliedCents - record.amountCents,
        version: before.version + 1,
        updatedAt: now,
      });
      const entry = sealSourceProof({
        tenantId: e.tenantId,
        executionId: e.id,
        collection: 'creditLots',
        sourceId: before.id,
        fence: p.planFence,
        position: e.proofEntryCount,
        before,
        after,
      });
      const lock = executionLockSchema.parse({
        tenantId: e.tenantId,
        resourceId: before.id,
        executionId: e.id,
        fencingToken: e.fencingToken,
        baselineVersion: before.version,
        createdAt: now,
        schemaVersion: 1,
      });
      staged.push(() =>
        tx.set(this.repo.ref(e.tenantId, 'financialExecutionLotLocks', before.id), lock),
      );
      this.stageEntry(tx, e, p, entry, staged);
      record.entry = entry;
      staged.push(() => tx.set(doc.ref, record));
      e.checkpoint.lastId = record.sourceId;
    }
    if (page.size <= limit) {
      ensure(
        e.amountCents === 0 ||
          stableJson(p.nextTotals) ===
            stableJson(
              p.afterTitles.map((t) => ({
                titleId: t.id,
                cashCents: t.cashCents,
                creditCents: t.creditCents,
              })),
            ),
      );
      e.progress.total = e.proofEntryCount;
      move(e, 'SEALING', 'merkle');
      if (e.proofEntryCount === 0) {
        e.proofRootHash = emptyProofRootHash({
          tenantId: e.tenantId,
          executionId: e.id,
          entryCount: 0,
        });
        move(e, 'VALIDATING', 'verify');
      }
    }
    staged.forEach((write) => write());
  }
  private async merkle(tx: Transaction, e: FinancialExecution, p: ResolutionPlan, limit: number) {
    const context = { tenantId: e.tenantId, executionId: e.id, entryCount: e.proofEntryCount };
    const page = await tx.get(
      this.repo
        .ref(e.tenantId, 'financialProofEntries', 'placeholder')
        .parent.where('executionId', '==', e.id)
        .orderBy('position')
        .startAt(e.checkpoint.position)
        .limit(limit + 1),
    );
    const nodes: z.infer<typeof proofNodeSchema>[] = [];
    const addNode = (start: number, count: number, hash: string) =>
      nodes.push(
        proofNodeSchema.parse({
          tenantId: e.tenantId,
          executionId: e.id,
          start,
          count,
          hash,
          schemaVersion: 1,
        }),
      );
    for (const doc of page.docs.slice(0, limit)) {
      const entry = sourceProofSchema.parse(doc.data());
      ensure(
        entry.id === doc.id &&
          entry.tenantId === e.tenantId &&
          entry.executionId === e.id &&
          entry.position === e.checkpoint.position &&
          entry.hash === sourceProofHash(entry),
      );
      let node = {
        start: entry.position,
        count: 1,
        hash: proofLeafHash(context, entry.position, entry.hash),
      };
      addNode(node.start, node.count, node.hash);
      while (e.checkpoint.frontier.at(-1)?.count === node.count) {
        const left = e.checkpoint.frontier.pop()!;
        node = {
          start: left.start,
          count: left.count + node.count,
          hash: proofBranchHash(context, left.start, left.count + node.count, left.hash, node.hash),
        };
        addNode(node.start, node.count, node.hash);
      }
      e.checkpoint.frontier.push(node);
      e.checkpoint.position++;
    }
    if (page.size <= limit) {
      ensure(e.checkpoint.position === e.proofEntryCount);
      let root = e.checkpoint.frontier.pop()!;
      while (e.checkpoint.frontier.length) {
        const left = e.checkpoint.frontier.pop()!;
        root = {
          start: left.start,
          count: left.count + root.count,
          hash: proofBranchHash(context, left.start, left.count + root.count, left.hash, root.hash),
        };
        addNode(root.start, root.count, root.hash);
      }
      e.proofRootHash = proofRootHash(context, root.hash);
      move(e, 'VALIDATING', 'verify');
    }
    const priorNodes = nodes.length
      ? await tx.getAll(
          ...nodes.map((node) =>
            this.repo.ref(
              e.tenantId,
              'financialProofNodes',
              proofNodeId(context, node.start, node.count),
            ),
          ),
        )
      : [];
    for (const [index, node] of nodes.entries()) {
      const prior = priorNodes[index]!;
      if (prior.exists) ensure(stableJson(prior.data()) === stableJson(node));
    }
    for (const node of nodes)
      tx.set(
        this.repo.ref(
          e.tenantId,
          'financialProofNodes',
          proofNodeId(context, node.start, node.count),
        ),
        node,
      );
    ensure(p.sealedChain);
  }
  async validate(tx: Transaction, e: FinancialExecution, p: ResolutionPlan, limit: number) {
    const context = { tenantId: e.tenantId, executionId: e.id, entryCount: e.proofEntryCount };
    const page = await tx.get(
      this.repo
        .ref(e.tenantId, 'financialProofChunks', 'placeholder')
        .parent.where('executionId', '==', e.id)
        .orderBy('position')
        .startAt(e.progress.validated)
        .limit(limit + 1),
    );
    const chunks = page.docs.slice(0, limit).map((d) => proofChunkSchema.parse(d.data()));
    tx = await batchReads(
      tx,
      chunks.flatMap((chunk) => [
        this.repo.ref(e.tenantId, 'financialProofEntries', chunk.entry.id),
        this.repo.ref(e.tenantId, chunk.entry.collection, chunk.entry.sourceId),
      ]),
    );
    const intervals = new Map<string, { id: string; start: number; count: number }>();
    for (const chunk of chunks)
      for (const node of siblingIntervals(context, chunk.position)) intervals.set(node.id, node);
    const nodes = intervals.size
      ? await tx.getAll(
          ...[...intervals.keys()].map((id) =>
            this.repo.ref(e.tenantId, 'financialProofNodes', id),
          ),
        )
      : [];
    const byId = new Map(nodes.map((d) => [d.id, proofNodeSchema.parse(d.data())]));
    for (const chunk of chunks) {
      const entry = chunk.entry;
      ensure(
        chunk.position === e.progress.validated &&
          chunk.entryId === entry.id &&
          chunk.entryHash === entry.hash &&
          entry.hash === sourceProofHash(entry) &&
          entry.tenantId === e.tenantId &&
          entry.executionId === e.id,
      );
      chunk.siblings = siblingIntervals(context, chunk.position).map((i) => {
        const node = byId.get(i.id);
        ensure(
          node?.tenantId === e.tenantId &&
            node.executionId === e.id &&
            node.start === i.start &&
            node.count === i.count,
        );
        return node.hash;
      });
      ensure(
        verifyProofMembership(
          context,
          e.proofRootHash!,
          entry.position,
          entry.hash,
          chunk.siblings,
        ),
      );
      const stored = await tx.get(this.repo.ref(e.tenantId, 'financialProofEntries', entry.id));
      ensure(stableJson(stored.data()) === stableJson(entry));
      await this.assertCanonical(tx, e, entry, false);
      p.validatedChain = appendChain(p.validatedChain, entry);
      e.progress.validated++;
    }
    if (page.size <= limit) {
      ensure(e.progress.validated === e.proofEntryCount && p.validatedChain === p.sealedChain);
      move(e, 'READY', 'sources');
    }
    for (const chunk of chunks)
      tx.set(this.repo.ref(e.tenantId, 'financialProofChunks', chunk.entryId), chunk);
  }
  async assertCanonical(
    tx: Transaction,
    e: FinancialExecution,
    entry: SourceProof,
    applied: boolean,
  ) {
    const ref = this.repo.ref(e.tenantId, entry.collection, entry.sourceId);
    if (applied) {
      const raw = (await tx.get(ref)).data();
      ensure(
        raw?.pendingExecutionId === e.id &&
          raw.pendingProofEntryId === entry.id &&
          raw.pendingFence === entry.fence,
      );
      const {
        pendingExecutionId: _id,
        pendingProofEntryId: _entry,
        pendingFence: _fence,
        ...body
      } = raw;
      ensure(stableJson(body) === stableJson(entry.after));
    } else {
      const schema =
        entry.collection === 'payments'
          ? s.paymentSchema
          : entry.collection === 'creditApplications'
            ? s.creditSchema
            : entry.collection === 'creditLots'
              ? s.lotSchema
              : r.returnGuardSchema;
      const body = await this.repo.foundation.read<unknown>(ref, schema, tx);
      ensure(stableJson(body) === stableJson(entry.before));
    }
  }
  async applySources(
    tx: Transaction,
    e: FinancialExecution,
    p: ResolutionPlan,
    limit: number,
    now: string,
  ) {
    const page = await tx.get(
      this.repo
        .ref(e.tenantId, 'financialProofChunks', 'placeholder')
        .parent.where('executionId', '==', e.id)
        .orderBy('position')
        .startAt(e.progress.applied)
        .limit(limit + 1),
    );
    const entries: SourceProof[] = [];
    tx = await batchReads(
      tx,
      page.docs.slice(0, limit).flatMap((doc) => {
        const entry = proofChunkSchema.parse(doc.data()).entry;
        return [
          this.repo.ref(e.tenantId, 'financialProofEntries', entry.id),
          this.repo.ref(e.tenantId, entry.collection, entry.sourceId),
          ...(entry.collection === 'creditLots'
            ? [this.repo.ref(e.tenantId, 'financialExecutionLotLocks', entry.sourceId)]
            : []),
        ];
      }),
    );
    for (const doc of page.docs.slice(0, limit)) {
      const chunk = proofChunkSchema.parse(doc.data()),
        entry = chunk.entry;
      ensure(
        chunk.position === e.progress.applied &&
          chunk.tenantId === e.tenantId &&
          chunk.executionId === e.id &&
          chunk.siblings &&
          verifyProofMembership(
            { tenantId: e.tenantId, executionId: e.id, entryCount: e.proofEntryCount },
            e.proofRootHash!,
            entry.position,
            entry.hash,
            chunk.siblings,
          ) &&
          entry.hash === sourceProofHash(entry),
      );
      ensure(
        stableJson(
          (await tx.get(this.repo.ref(e.tenantId, 'financialProofEntries', entry.id))).data(),
        ) === stableJson(entry),
      );
      await this.assertCanonical(tx, e, entry, false);
      if (entry.collection === 'creditLots') {
        const lock = await this.repo.foundation.read(
          this.repo.ref(e.tenantId, 'financialExecutionLotLocks', entry.sourceId),
          executionLockSchema,
          tx,
        );
        ensure(lock?.executionId === e.id && lock.tenantId === e.tenantId);
      }
      entries.push(entry);
      e.progress.applied++;
      p.appliedChain = appendChain(p.appliedChain, entry);
    }
    if (entries.length) e.applicationStartedAt ??= now;
    if (page.size <= limit) {
      ensure(e.progress.applied === e.proofEntryCount && p.appliedChain === p.sealedChain);
      e.phase = e.kind === 'cancellation' ? 'stock' : 'final-check';
      e.checkpoint.phase = e.phase;
    }
    for (const entry of entries)
      tx.set(this.repo.ref(e.tenantId, entry.collection, entry.sourceId), {
        ...entry.after,
        pendingExecutionId: e.id,
        pendingProofEntryId: entry.id,
        pendingFence: entry.fence,
      });
  }
  async stock(
    tx: Transaction,
    e: FinancialExecution,
    ctx: TenantContext,
    limit: number,
    now: string,
  ) {
    const page = await tx.get(
      this.repo
        .ref(e.tenantId, 'financialExecutionStockPlans', 'placeholder')
        .parent.where('executionId', '==', e.id)
        .orderBy('position')
        .startAt(e.progress.releasedReservations)
        .limit(limit + 1),
    );
    const records = page.docs.slice(0, limit).map((d) => stockPlanSchema.parse(d.data()));
    for (const [index, record] of records.entries())
      ensure(
        record.tenantId === e.tenantId &&
          record.executionId === e.id &&
          record.position === e.progress.releasedReservations + index,
      );
    const prepared = records.length
      ? await this.finance.stock.prepareReleaseBatch(tx, {
          context: ctx,
          orderId: e.orderId,
          orderVersion: e.baseline.orderVersion,
          operationKey: e.id,
          occurredAt: now,
          type: 'STOCK_RESERVATION_RELEASE',
          items: records,
        })
      : null;
    if (records.length) e.applicationStartedAt ??= now;
    e.progress.releasedReservations += records.length;
    if (page.size <= limit) {
      ensure(e.progress.releasedReservations === e.baseline.lineCount);
      e.phase = 'final-check';
      e.checkpoint.phase = e.phase;
    }
    prepared?.apply();
  }
  async finalCheck(tx: Transaction, e: FinancialExecution, p: ResolutionPlan, limit: number) {
    const page = await tx.get(
      this.repo
        .ref(e.tenantId, 'financialProofChunks', 'placeholder')
        .parent.where('executionId', '==', e.id)
        .orderBy('position')
        .startAt(p.finalChecked)
        .limit(limit + 1),
    );
    tx = await batchReads(
      tx,
      page.docs.slice(0, limit).flatMap((doc) => {
        const entry = proofChunkSchema.parse(doc.data()).entry;
        return [
          this.repo.ref(e.tenantId, 'financialProofEntries', entry.id),
          this.repo.ref(e.tenantId, entry.collection, entry.sourceId),
        ];
      }),
    );
    for (const doc of page.docs.slice(0, limit)) {
      const chunk = proofChunkSchema.parse(doc.data()),
        entry = chunk.entry;
      ensure(
        entry.position === p.finalChecked &&
          chunk.siblings &&
          entry.hash === sourceProofHash(entry) &&
          verifyProofMembership(
            { tenantId: e.tenantId, executionId: e.id, entryCount: e.proofEntryCount },
            e.proofRootHash!,
            entry.position,
            entry.hash,
            chunk.siblings,
          ),
      );
      ensure(
        stableJson(
          (await tx.get(this.repo.ref(e.tenantId, 'financialProofEntries', entry.id))).data(),
        ) === stableJson(entry),
      );
      await this.assertCanonical(tx, e, entry, true);
      p.finalChecked++;
      p.finalChain = appendChain(p.finalChain, entry);
    }
    if (page.size <= limit) {
      ensure(p.finalChecked === e.proofEntryCount && p.finalChain === p.sealedChain);
      move(e, 'FINALIZABLE', 'publish');
    }
  }
}
