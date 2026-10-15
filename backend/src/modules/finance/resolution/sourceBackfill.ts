import { FieldPath, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { financialOperationSchema, type FinancialCommands } from '../financialCommands.js';
import { FinancialBook, financialEventHash, initialFinancialHash } from '../financialBook.js';
import type { Actor } from '../../../shared/types/context.js';
import { opaqueId, instant } from '../../../shared/schemas/models.js';
import * as s from '../../../shared/schemas/finance.js';
import { financialGuardSchema } from '../../receivables/orderReceivables.js';
import {
  executionSchema,
  executionLockSchema,
} from '../../../shared/schemas/financialExecutions.js';
import { digest, stableJson } from '../../../shared/utils/crypto.js';
import { requireCondition } from '../../../shared/errors/appError.js';
import { recordAudit } from '../../../shared/audit/audit.js';
import {
  generationSchema,
  activeSourceSchema,
  activeGenerationId,
  activeSourceId,
} from './sourceIndex.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().nonnegative().safe();
export const sourceBuildSchema = z
  .strictObject({
    id: hash,
    kind: z.literal('build'),
    tenantId: opaqueId,
    orderId: opaqueId,
    customerId: opaqueId,
    generationId: hash,
    createdBy: opaqueId,
    phase: z.enum(['journal', 'cash', 'credit', 'validating', 'complete']),
    revision: counter.positive(),
    state: s.financialStateSchema,
    titles: z.array(s.titleSchema).min(1).max(12),
    guardVersion: counter.positive(),
    rawOrderVersion: counter.positive(),
    rawOrderStatus: z.string(),
    journalCount: counter,
    expectedSources: counter,
    lastEventId: opaqueId.nullable(),
    lastEventHash: hash,
    lastSnapshotHash: hash,
    finalSnapshotHash: hash,
    cursorId: opaqueId.nullable(),
    cursorHash: hash.nullable(),
    examined: counter,
    rowCount: counter,
    cashReceivedCents: counter,
    totals: generationSchema.shape.totals,
    validatedRows: counter,
    validatedTotals: generationSchema.shape.totals,
    createdAt: instant,
    updatedAt: instant,
    schemaVersion: z.literal(1),
  })
  .refine(
    (build) =>
      build.state.tenantId === build.tenantId &&
      build.state.orderId === build.orderId &&
      build.state.customerId === build.customerId &&
      build.expectedSources <= build.journalCount &&
      build.examined <= build.expectedSources &&
      build.validatedRows <= build.rowCount &&
      new Set(build.titles.map((title) => title.id)).size === build.titles.length &&
      build.titles.every(
        (title, index) =>
          title.tenantId === build.tenantId &&
          title.orderId === build.orderId &&
          title.customerId === build.customerId &&
          build.totals[index]?.titleId === title.id &&
          build.validatedTotals[index]?.titleId === title.id,
      ) &&
      build.totals.length === build.titles.length &&
      build.validatedTotals.length === build.titles.length,
    'Checkpoint de fontes inconsistente',
  );
type Build = z.infer<typeof sourceBuildSchema>;
type ActiveSource = z.infer<typeof activeSourceSchema>;

function integrity(condition: unknown): asserts condition {
  requireCondition(condition, 409, 'FINANCIAL_INTEGRITY', 'Backfill financeiro inconsistente');
}
function boundedDocument(value: unknown) {
  integrity(Buffer.byteLength(stableJson(value), 'utf8') <= 256 * 1024);
}

/** Internal migration boundary, also fenced by the resumable execution owner. */
export class SourceBackfill {
  private readonly book: FinancialBook;
  constructor(
    private readonly commands: FinancialCommands,
    private readonly owner?: { id: string; fence: number; revision: number; uid: string },
  ) {
    this.book = new FinancialBook(commands.repo);
  }
  private get repo() {
    return this.commands.repo;
  }
  private async assertOrderContext(tx: Transaction, tenantId: string, orderId: string) {
    if (!this.owner) return this.commands.locks.assertOrderAvailable(tx, tenantId, orderId);
    const root = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'financialExecutions', this.owner.id),
      executionSchema,
      tx,
    );
    const lock = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'financialExecutionOrderLocks', orderId),
      executionLockSchema,
      tx,
    );
    requireCondition(
      root?.tenantId === tenantId &&
        root.orderId === orderId &&
        root.status === 'INDEXING' &&
        root.revision === this.owner.revision &&
        root.fencingToken === this.owner.fence &&
        root.leaseOwner === this.owner.uid &&
        root.authorizedBy === this.owner.uid &&
        root.leaseUntil &&
        root.leaseUntil > this.commands.clock().toISOString() &&
        lock?.tenantId === tenantId &&
        lock.resourceId === orderId &&
        lock.executionId === root.id,
      409,
      'EXECUTION_CONFLICT',
      'Proprietário da indexação mudou',
    );
  }

  start(actor: Actor, tenantId: string, orderId: string, key: string): Promise<Build> {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'financial_source_index_start',
      orderId,
      {},
      'payments:manage',
      sourceBuildSchema,
      false,
      async (tx, ctx, id, now) => {
        await this.assertOrderContext(tx, tenantId, orderId);
        const book = await this.book.load(tx, tenantId, orderId);
        const [rawOrder] = await tx.getAll(this.repo.ref(tenantId, 'orders', orderId), {
          fieldMask: ['version', 'status'],
        });
        integrity(rawOrder?.exists);
        const finalSnapshot = this.book.snapshot(book.state, book.titles);
        const initialSnapshot =
          book.state.eventSequence === 0
            ? finalSnapshot
            : s.ledgerSnapshot.parse({
                cashReceivedCents: 0,
                cashSettledCents: 0,
                creditSettledCents: 0,
                transferredCashCents: 0,
                canceledCents: 0,
                activeReturnCount: 0,
                titles: book.titles.map((t) => ({
                  id: t.id,
                  originalCents: t.originalCents,
                  outstandingCents: t.originalCents,
                  cashCents: 0,
                  creditCents: 0,
                  canceledCents: 0,
                  version: 1,
                })),
              });
        const build = sourceBuildSchema.parse({
          id,
          kind: 'build',
          tenantId,
          orderId,
          customerId: book.order.customerId,
          generationId: digest(`financial-source-build:${tenantId}:${id}`),
          createdBy: ctx.actor.uid,
          phase: 'journal',
          revision: 1,
          state: book.state,
          titles: book.titles,
          guardVersion: book.guard.version,
          rawOrderVersion: rawOrder.get('version'),
          rawOrderStatus: rawOrder.get('status'),
          journalCount: 0,
          expectedSources: 0,
          lastEventId: null,
          lastEventHash: initialFinancialHash(tenantId, orderId),
          lastSnapshotHash: digest(stableJson(initialSnapshot)),
          finalSnapshotHash: digest(stableJson(finalSnapshot)),
          cursorId: null,
          cursorHash: null,
          examined: 0,
          rowCount: 0,
          cashReceivedCents: 0,
          totals: book.titles.map((t) => ({ titleId: t.id, cashCents: 0, creditCents: 0 })),
          validatedRows: 0,
          validatedTotals: book.titles.map((t) => ({
            titleId: t.id,
            cashCents: 0,
            creditCents: 0,
          })),
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1,
        });
        boundedDocument(build);
        tx.create(this.repo.ref(tenantId, 'financialSourceGenerations', id), build);
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          'finance.source_index_started',
          orderId,
          now,
          { buildId: id, generationId: build.generationId },
        );
        return build;
      },
    );
  }

  advance(
    actor: Actor,
    tenantId: string,
    id: string,
    key: string,
    expectedRevision: number,
  ): Promise<Build> {
    counter.positive().parse(expectedRevision);
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'financial_source_index_advance',
      id,
      { expectedRevision },
      'payments:manage',
      sourceBuildSchema,
      false,
      async (tx, _ctx, _operationId, now) => {
        const build = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'financialSourceGenerations', id),
          sourceBuildSchema,
          tx,
        );
        requireCondition(
          build?.id === id && build.tenantId === tenantId,
          404,
          'RESOURCE_NOT_FOUND',
          'Geração não encontrada',
        );
        requireCondition(
          build.revision === expectedRevision,
          409,
          'CONFLICT',
          'Checkpoint desatualizado',
        );
        if (build.phase === 'complete') return build;
        await this.assertOrderContext(tx, tenantId, build.orderId);
        await this.assertPinned(tx, build);
        const next = sourceBuildSchema.parse(build);
        const staged: ActiveSource[] = [];
        const deadline = performance.now() + 3000;
        if (build.phase === 'journal') await this.journal(tx, next, deadline);
        else if (build.phase === 'validating') await this.validateRows(tx, next, deadline);
        else await this.sources(tx, next, staged, deadline);
        next.revision++;
        next.updatedAt = now;
        integrity(
          sourceBuildSchema.safeParse(next).success &&
            next.examined <= next.journalCount &&
            next.cashReceivedCents <= next.state.cashReceivedCents &&
            next.totals.every((total) => {
              const expected = next.titles.find((t) => t.id === total.titleId);
              return (
                expected &&
                total.cashCents <= expected.cashCents &&
                total.creditCents <= expected.creditCents
              );
            }),
        );
        boundedDocument(next);
        for (const row of staged) {
          boundedDocument(row);
          tx.create(this.repo.ref(tenantId, 'financialActiveSources', row.id), row);
        }
        if (next.phase === 'complete') this.certify(tx, next, now);
        tx.set(this.repo.ref(tenantId, 'financialSourceGenerations', id), next);
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          'finance.source_index_advanced',
          build.orderId,
          now,
          {
            buildId: id,
            phase: next.phase,
            revision: next.revision,
            examined: next.examined,
            rowCount: next.rowCount,
            journalCount: next.journalCount,
          },
        );
        return next;
      },
    );
  }

  private async assertPinned(tx: Transaction, build: Build) {
    const [order] = await tx.getAll(this.repo.ref(build.tenantId, 'orders', build.orderId), {
      fieldMask: ['id', 'tenantId', 'customerId', 'version', 'status'],
    });
    const state = await this.repo.foundation.read(
      this.repo.ref(build.tenantId, 'financialOrderStates', build.orderId),
      s.financialStateSchema,
      tx,
    );
    const guard = await this.repo.foundation.read(
      this.repo.ref(build.tenantId, 'orderFinancialGuards', build.orderId),
      financialGuardSchema,
      tx,
    );
    let valid =
      order?.exists &&
      order.id === build.orderId &&
      order.get('id') === build.orderId &&
      order.get('tenantId') === build.tenantId &&
      order.get('customerId') === build.customerId &&
      order.get('version') === build.rawOrderVersion &&
      order.get('status') === build.rawOrderStatus &&
      guard?.version === build.guardVersion &&
      guard.tenantId === build.tenantId &&
      guard.orderId === build.orderId &&
      (state ? stableJson(state) === stableJson(build.state) : build.state.eventSequence === 0);
    for (const title of build.titles) {
      const current = await this.repo.foundation.read(
        this.repo.ref(build.tenantId, 'financialTitles', title.id),
        s.titleSchema,
        tx,
      );
      valid =
        valid &&
        (current ? stableJson(current) === stableJson(title) : build.state.eventSequence === 0);
    }
    requireCondition(
      valid,
      409,
      'FINANCIAL_SOURCE_GENERATION_STALE',
      'Pedido ou diário mudou durante o backfill; iniciar nova geração',
    );
  }

  private async journal(tx: Transaction, build: Build, deadline: number) {
    if (build.lastEventId) {
      const boundary = await this.repo.foundation.read(
        this.repo.ref(build.tenantId, 'financialEvents', build.lastEventId),
        s.eventSchema,
        tx,
      );
      integrity(
        boundary?.id === build.lastEventId &&
          boundary.tenantId === build.tenantId &&
          boundary.orderId === build.orderId &&
          boundary.sequence === build.journalCount &&
          boundary.hash === build.lastEventHash &&
          boundary.hash === financialEventHash(boundary) &&
          digest(stableJson(boundary.after)) === build.lastSnapshotHash,
      );
    }
    let query = this.repo
      .ref(build.tenantId, 'financialEvents', 'placeholder')
      .parent.where('orderId', '==', build.orderId)
      .orderBy('sequence')
      .orderBy(FieldPath.documentId());
    if (build.lastEventId) query = query.startAfter(build.journalCount, build.lastEventId);
    // Query only scalar headers. Read potentially large v1 events one at a time.
    const page = await tx.get(query.select('sequence').limit(21));
    let processed = 0;
    for (const header of page.docs.slice(0, 20)) {
      if (processed > 0 && performance.now() >= deadline) break;
      const event = await this.repo.foundation.read(header.ref, s.eventSchema, tx);
      integrity(
        event?.id === header.id &&
          event.tenantId === build.tenantId &&
          event.orderId === build.orderId &&
          event.customerId === build.customerId &&
          event.sequence === build.journalCount + 1 &&
          event.sequence <= build.state.eventSequence &&
          event.previousHash === build.lastEventHash &&
          event.hash === financialEventHash(event) &&
          digest(stableJson(event.before)) === build.lastSnapshotHash,
      );
      build.journalCount++;
      if (event.type === 'receipt' || event.type === 'credit_application') build.expectedSources++;
      build.lastEventId = event.id;
      build.lastEventHash = event.hash;
      build.lastSnapshotHash = digest(stableJson(event.after));
      processed++;
    }
    if (processed === page.size) {
      integrity(
        build.journalCount === build.state.eventSequence &&
          build.lastEventId === build.state.headEventId &&
          build.lastEventHash === build.state.headHash &&
          build.lastSnapshotHash === build.finalSnapshotHash,
      );
      build.phase = 'cash';
    }
  }

  private async sources(tx: Transaction, build: Build, staged: ActiveSource[], deadline: number) {
    const kind = build.phase === 'cash' ? 'cash' : 'credit';
    const collection = kind === 'cash' ? 'payments' : 'creditApplications';
    const schema: z.ZodType<z.infer<typeof s.paymentSchema> | z.infer<typeof s.creditSchema>> =
      kind === 'cash' ? s.paymentSchema : s.creditSchema;
    if (build.cursorId) {
      const boundary = await this.repo.foundation.read(
        this.repo.ref(build.tenantId, collection, build.cursorId),
        schema,
        tx,
      );
      integrity(
        boundary?.id === build.cursorId &&
          boundary.tenantId === build.tenantId &&
          boundary.orderId === build.orderId &&
          digest(stableJson(boundary)) === build.cursorHash,
      );
    }
    let query = this.repo
      .ref(build.tenantId, collection, 'placeholder')
      .parent.where('orderId', '==', build.orderId)
      .orderBy(FieldPath.documentId());
    if (build.cursorId) query = query.startAfter(build.cursorId);
    const limit = kind === 'cash' ? 10 : 3;
    const page = await tx.get(query.limit(limit + 1));
    let processed = 0;
    for (const doc of page.docs.slice(0, limit)) {
      if (processed > 0 && performance.now() >= deadline) break;
      const source = await this.repo.foundation.readSnapshot(doc, schema, tx);
      integrity(
        source?.id === doc.id &&
          source.tenantId === build.tenantId &&
          source.orderId === build.orderId &&
          source.customerId === build.customerId &&
          new Set(source.allocations.map((a) => a.receivableId)).size === source.allocations.length,
      );
      const positive = source.allocations.filter((a) => a.remainingCents > 0);
      if (staged.length + positive.length > 72) break;
      const originId = digest(`financial-event:${source.id}`);
      const origin = await this.repo.foundation.read(
        this.repo.ref(build.tenantId, 'financialEvents', originId),
        s.eventSchema,
        tx,
      );
      integrity(
        origin?.id === originId &&
          origin.tenantId === build.tenantId &&
          origin.orderId === build.orderId &&
          origin.customerId === build.customerId &&
          origin.sequence <= build.state.eventSequence &&
          origin.hash === financialEventHash(origin) &&
          origin.operationId === source.id &&
          origin.references.includes(source.id) &&
          origin.amountCents === source.amountCents &&
          origin.actorUid === source.createdBy &&
          origin.type === (kind === 'cash' ? 'receipt' : 'credit_application'),
      );
      const sourceHash = digest(stableJson(source));
      const operation = await this.repo.foundation.read(
        this.repo.ref(build.tenantId, 'financialOperations', source.id),
        financialOperationSchema,
        tx,
      );
      const result = s.financialResult.safeParse(operation?.result);
      integrity(
        operation?.actorUid === source.createdBy &&
          operation.resourceId === build.orderId &&
          operation.action === (kind === 'cash' ? 'receipt' : 'credit_application') &&
          result.success &&
          result.data.operationId === source.id &&
          result.data.resourceId === source.id &&
          result.data.orderId === build.orderId &&
          result.data.eventId === originId &&
          result.data.amountCents === source.amountCents,
      );
      const isCash = 'recordedAt' in source;
      integrity(
        isCash === (kind === 'cash') &&
          origin.occurredAt === (isCash ? source.recordedAt : source.createdAt),
      );
      if (isCash) build.cashReceivedCents += source.amountCents - source.reversedCents;
      else {
        integrity(origin.references.includes(source.creditLotId));
        await this.verifyLot(tx, build, source.creditLotId);
      }
      for (const allocation of source.allocations) {
        const total = build.totals.find((t) => t.titleId === allocation.receivableId);
        const before = origin.before.titles.find((t) => t.id === allocation.receivableId);
        const after = origin.after.titles.find((t) => t.id === allocation.receivableId);
        integrity(
          total &&
            before &&
            after &&
            allocation.amountCents ===
              (kind === 'cash'
                ? after.cashCents - before.cashCents
                : after.creditCents - before.creditCents),
        );
        if (kind === 'cash') total.cashCents += allocation.remainingCents;
        else total.creditCents += allocation.remainingCents;
        if (allocation.remainingCents > 0)
          staged.push(
            activeSourceSchema.parse({
              id: activeSourceId(
                build.tenantId,
                build.generationId,
                kind,
                source.id,
                allocation.receivableId,
              ),
              tenantId: build.tenantId,
              orderId: build.orderId,
              customerId: build.customerId,
              generationId: build.generationId,
              titleId: allocation.receivableId,
              kind,
              sourceId: source.id,
              sourceVersion: source.version,
              sourceHash,
              sourceTime: isCash ? source.recordedAt : source.createdAt,
              remainingCents: allocation.remainingCents,
              lotId: isCash ? null : source.creditLotId,
              originEventId: originId,
              proofEventId: build.state.headEventId,
              proofEntryId: null,
              schemaVersion: 1,
            }),
          );
      }
      build.examined++;
      build.rowCount += positive.length;
      build.cursorId = source.id;
      build.cursorHash = sourceHash;
      processed++;
    }
    if (processed === page.size) {
      build.phase = kind === 'cash' ? 'credit' : 'validating';
      build.cursorId = null;
      build.cursorHash = null;
    }
  }

  private async validateRows(tx: Transaction, build: Build, deadline: number) {
    if (build.cursorId) {
      const boundary = await this.repo.foundation.read(
        this.repo.ref(build.tenantId, 'financialActiveSources', build.cursorId),
        activeSourceSchema,
        tx,
      );
      integrity(
        boundary?.id === build.cursorId &&
          boundary.tenantId === build.tenantId &&
          boundary.generationId === build.generationId &&
          digest(stableJson(boundary)) === build.cursorHash,
      );
    }
    let query = this.repo
      .ref(build.tenantId, 'financialActiveSources', 'placeholder')
      .parent.where('generationId', '==', build.generationId)
      .orderBy(FieldPath.documentId());
    if (build.cursorId) query = query.startAfter(build.cursorId);
    const page = await tx.get(query.limit(11));
    let processed = 0;
    for (const doc of page.docs.slice(0, 10)) {
      if (processed > 0 && performance.now() >= deadline) break;
      const row = activeSourceSchema.safeParse(doc.data());
      integrity(
        row.success &&
          row.data.id === doc.id &&
          row.data.tenantId === build.tenantId &&
          row.data.orderId === build.orderId &&
          row.data.customerId === build.customerId &&
          row.data.generationId === build.generationId &&
          row.data.proofEventId === build.state.headEventId &&
          row.data.originEventId === digest(`financial-event:${row.data.sourceId}`) &&
          row.data.proofEntryId === null &&
          row.data.id ===
            activeSourceId(
              build.tenantId,
              build.generationId,
              row.data.kind,
              row.data.sourceId,
              row.data.titleId,
            ),
      );
      const source =
        row.data.kind === 'cash'
          ? await this.repo.foundation.read(
              this.repo.ref(build.tenantId, 'payments', row.data.sourceId),
              s.paymentSchema,
              tx,
            )
          : await this.repo.foundation.read(
              this.repo.ref(build.tenantId, 'creditApplications', row.data.sourceId),
              s.creditSchema,
              tx,
            );
      const allocation = source?.allocations.find((a) => a.receivableId === row.data.titleId);
      integrity(
        source?.id === row.data.sourceId &&
          source.tenantId === build.tenantId &&
          source.orderId === build.orderId &&
          source.customerId === build.customerId &&
          source.version === row.data.sourceVersion &&
          digest(stableJson(source)) === row.data.sourceHash &&
          allocation?.remainingCents === row.data.remainingCents &&
          row.data.sourceTime === ('recordedAt' in source ? source.recordedAt : source.createdAt) &&
          row.data.lotId === ('creditLotId' in source ? source.creditLotId : null),
      );
      const total = build.validatedTotals.find((t) => t.titleId === row.data.titleId);
      integrity(total);
      if (row.data.kind === 'cash') total.cashCents += row.data.remainingCents;
      else total.creditCents += row.data.remainingCents;
      build.validatedRows++;
      integrity(build.validatedRows <= build.rowCount);
      build.cursorId = row.data.id;
      build.cursorHash = digest(stableJson(row.data));
      processed++;
    }
    if (processed === page.size) {
      integrity(
        build.validatedRows === build.rowCount &&
          stableJson(build.validatedTotals) === stableJson(build.totals),
      );
      build.phase = 'complete';
      build.cursorId = null;
      build.cursorHash = null;
    }
  }

  private async verifyLot(tx: Transaction, build: Build, lotId: string) {
    const lot = await this.repo.foundation.read(
      this.repo.ref(build.tenantId, 'creditLots', lotId),
      s.lotSchema,
      tx,
    );
    integrity(
      lot?.id === lotId && lot.tenantId === build.tenantId && lot.customerId === build.customerId,
    );
    const origin = await this.repo.foundation.read(
      this.repo.ref(build.tenantId, 'financialEvents', lot.originReference),
      s.eventSchema,
      tx,
    );
    integrity(
      origin?.id === lot.originReference &&
        origin.tenantId === build.tenantId &&
        origin.customerId === build.customerId &&
        origin.orderId === lot.originOrderId &&
        origin.hash === financialEventHash(origin) &&
        origin.references.includes(lot.id) &&
        origin.after.transferredCashCents - origin.before.transferredCashCents ===
          lot.issuedCents &&
        origin.type ===
          (lot.origin === 'order_cancellation' ? 'financial_cancellation' : 'return_resolved'),
    );
    const [order] = await tx.getAll(this.repo.ref(build.tenantId, 'orders', lot.originOrderId), {
      fieldMask: ['id', 'tenantId', 'customerId'],
    });
    integrity(
      order?.exists &&
        order.get('id') === lot.originOrderId &&
        order.get('tenantId') === build.tenantId &&
        order.get('customerId') === build.customerId,
    );
  }

  private certify(tx: Transaction, build: Build, now: string) {
    integrity(
      build.journalCount === build.state.eventSequence &&
        build.examined === build.expectedSources &&
        build.validatedRows === build.rowCount &&
        stableJson(build.validatedTotals) === stableJson(build.totals) &&
        build.lastEventHash === build.state.headHash &&
        build.lastSnapshotHash === build.finalSnapshotHash &&
        build.cashReceivedCents === build.state.cashReceivedCents &&
        stableJson(build.totals) ===
          stableJson(
            build.titles.map((t) => ({
              titleId: t.id,
              cashCents: t.cashCents,
              creditCents: t.creditCents,
            })),
          ),
    );
    const meta = generationSchema.parse({
      id: activeGenerationId(build.tenantId, build.orderId),
      kind: 'active',
      tenantId: build.tenantId,
      orderId: build.orderId,
      generationId: build.generationId,
      certified: true,
      rowCount: build.rowCount,
      stateVersion: build.state.version,
      eventSequence: build.state.eventSequence,
      headHash: build.state.headHash,
      totals: build.totals,
      createdAt: build.createdAt,
      updatedAt: now,
      schemaVersion: 1,
    });
    boundedDocument(meta);
    tx.set(this.repo.ref(build.tenantId, 'financialSourceGenerations', meta.id), meta);
    tx.create(this.repo.ref(build.tenantId, 'financialSourceGenerations', build.generationId), {
      ...meta,
      id: build.generationId,
      kind: 'generation',
    });
  }
}
