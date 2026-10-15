import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor } from '../../../shared/types/context.js';
import type { FinancialExecution } from '../../../shared/schemas/financialExecutions.js';
import * as s from '../../../shared/schemas/finance.js';
import * as r from '../../../shared/schemas/returns.js';
import { orderEventSchema } from '../../../shared/schemas/orders.js';
import { financialGuardSchema } from '../../receivables/orderReceivables.js';
import { financialEventHash } from '../financialBook.js';
import { returnEventHash } from '../../returns/returnService.js';
import { returnState } from '../../returns/calculation.js';
import type { ResolutionPhases } from './executionPhases.js';
import { sourcePlanSchema, ensure, type ResolutionPlan } from './executionModel.js';
import { generationSchema, activeGenerationId } from './sourceIndex.js';
import {
  orderLifecycleSchema,
  returnResolutionHeaderSchema,
  compactHeaderHash,
  proofManifestSchema,
  proofManifestHash,
  sourceProofHash,
} from './proofRecords.js';
import { proofChunkSchema } from './proofStorage.js';
import { verifyProofMembership } from './proofs.js';
import { digest, stableJson } from '../../../shared/utils/crypto.js';

export interface ReturnPublication {
  event: z.infer<typeof r.returnEventV2Schema>;
  header: z.infer<typeof returnResolutionHeaderSchema>;
}
export class ExecutionPublication {
  constructor(readonly phases: ResolutionPhases) {}
  async prepareReturn(
    e: FinancialExecution,
    p: ResolutionPlan,
    actor: Actor,
    now: string,
  ): Promise<ReturnPublication | null> {
    if (!e.returnId) return null;
    ensure(p.returnInfo && p.returnInfo.scanned === p.returnInfo.lineCount);
    const repo = this.phases.repo;
    const lines: r.Return['lines'] = [],
      beforeLines: r.Return['lines'] = [];
    let offset = 0;
    while (offset < p.returnInfo.lineCount) {
      const page = await repo
        .ref(e.tenantId, 'financialExecutionSourcePlans', 'placeholder')
        .parent.where('executionId', '==', e.id)
        .where('collection', '==', 'orderReturnLines')
        .orderBy('linePosition')
        .startAt(offset)
        .limit(25)
        .get();
      ensure(!page.empty);
      for (const doc of page.docs) {
        const record = sourcePlanSchema.parse(doc.data());
        ensure(
          record.collection === 'orderReturnLines' &&
            record.executionId === e.id &&
            record.tenantId === e.tenantId &&
            record.returnId === e.returnId &&
            record.linePosition === offset &&
            record.entry &&
            record.entry.collection === 'orderReturnLines' &&
            stableJson(record.entry.lineAfter) === stableJson(record.lineAfter),
        );
        const chunk = proofChunkSchema.parse(
          (await repo.ref(e.tenantId, 'financialProofChunks', record.entry.id).get()).data(),
        );
        ensure(
          stableJson(chunk.entry) === stableJson(record.entry) &&
            record.entry.hash === sourceProofHash(record.entry) &&
            chunk.siblings &&
            verifyProofMembership(
              { tenantId: e.tenantId, executionId: e.id, entryCount: e.proofEntryCount },
              e.proofRootHash!,
              record.entry.position,
              record.entry.hash,
              chunk.siblings,
            ),
        );
        lines.push(record.lineAfter);
        beforeLines.push(record.lineBefore);
        offset++;
      }
    }
    ensure(offset === p.returnInfo.lineCount);
    ensure(
      digest(
        stableJson(r.returnSnapshotSchema.parse({ ...p.returnInfo.fields, lines: beforeLines })),
      ) === p.returnInfo.beforeSnapshotHash,
    );
    const after = r.returnSnapshotSchema.parse({
      ...p.returnInfo.fields,
      lines,
      status: returnState(lines),
      version: p.returnInfo.fields.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
      reason: e.reason,
    });
    const header = returnResolutionHeaderSchema.parse({
      tenantId: e.tenantId,
      orderId: e.orderId,
      returnId: e.returnId,
      executionId: e.id,
      sourceHash: p.returnInfo.rawHash,
      sourceVersion: p.returnInfo.rawVersion,
      version: after.version,
      status: after.status,
      reason: after.reason,
      updatedAt: now,
      updatedBy: actor.uid,
      eventSequence: p.returnInfo.eventSequence + 1,
      headHash: '0'.repeat(64),
      headEventId: digest(`return-event:${e.id}`),
      lineCount: lines.length,
      schemaVersion: 1,
    });
    const content = {
      id: header.headEventId,
      tenantId: e.tenantId,
      orderId: e.orderId,
      returnId: e.returnId,
      operationId: e.id,
      type: 'resolved' as const,
      sequence: header.eventSequence,
      previousHash: p.returnInfo.headHash,
      actorUid: actor.uid,
      occurredAt: now,
      reason: e.reason,
      requestId: actor.requestId,
      executionId: e.id,
      manifestId: e.id,
      rootHash: e.proofRootHash!,
      entryCount: e.proofEntryCount,
      lineCount: lines.length,
      beforeSnapshotHash: p.returnInfo.beforeSnapshotHash,
      afterSnapshotHash: digest(stableJson(after)),
      headerHash: compactHeaderHash(header),
      schemaVersion: 2 as const,
    };
    const event = r.returnEventV2Schema.parse({ ...content, hash: returnEventHash(content) });
    header.headHash = event.hash;
    return { event, header };
  }
  async publish(
    tx: Transaction,
    e: FinancialExecution,
    p: ResolutionPlan,
    actor: Actor,
    now: string,
    returned: ReturnPublication | null,
  ) {
    ensure(
      p.finalChecked === e.proofEntryCount &&
        p.finalChain === p.sealedChain &&
        e.progress.applied === e.proofEntryCount &&
        e.progress.validated === e.proofEntryCount &&
        (e.kind !== 'cancellation' || e.progress.releasedReservations === e.baseline.lineCount),
    );
    const finance = this.phases.finance,
      repo = finance.repo;
    const book = await finance.book.load(tx, e.tenantId, e.orderId);
    ensure(
      stableJson(book.state) === stableJson(e.baseline.state) &&
        stableJson(book.guard) === stableJson(e.baseline.guard) &&
        stableJson(book.titles) === stableJson(e.baseline.titles) &&
        digest(stableJson(book.order)) === e.baseline.orderHash,
    );
    if (returned) {
      const raw = (await tx.get(repo.ref(e.tenantId, 'returns', e.returnId!))).data();
      ensure(
        digest(stableJson(raw)) === p.returnInfo!.rawHash && returned.header.executionId === e.id,
      );
    }
    const cash = p.afterState.transferredCashCents - e.baseline.state.transferredCashCents;
    const destinations = finance.destinations(
      book,
      e.id,
      now,
      cash,
      e.disposition,
      e.kind === 'cancellation' ? 'order_cancellation' : 'order_return',
    );
    const lifecycle =
      e.kind === 'cancellation'
        ? orderLifecycleSchema.parse({
            tenantId: e.tenantId,
            orderId: e.orderId,
            executionId: e.id,
            sourceHash: e.baseline.orderHash,
            sourceVersion: e.baseline.orderVersion,
            version: e.baseline.orderVersion + 1,
            status: 'canceled',
            updatedAt: now,
            updatedBy: actor.uid,
            canceledAt: now,
            canceledBy: actor.uid,
            schemaVersion: 1,
          })
        : null;
    const state = s.financialStateSchema.parse({
      ...p.afterState,
      activeReturnCount:
        e.baseline.state.activeReturnCount -
        (returned?.header.status === 'closed' && p.returnInfo!.fields.status !== 'closed' ? 1 : 0),
    });
    const after = finance.book.snapshot(state, p.afterTitles);
    const manifestBody = {
      tenantId: e.tenantId,
      executionId: e.id,
      orderId: e.orderId,
      entryCount: e.proofEntryCount,
      rootHash: e.proofRootHash!,
      beforeSnapshotHash: digest(stableJson(e.baseline.snapshot)),
      afterSnapshotHash: digest(stableJson(after)),
      ...(lifecycle ? { orderLifecycleHash: compactHeaderHash(lifecycle) } : {}),
      ...(returned
        ? {
            returnEventId: returned.event.id,
            returnEventHash: returned.event.hash,
            returnHeaderHash: returned.event.headerHash,
          }
        : {}),
      schemaVersion: 1 as const,
    };
    const manifest = proofManifestSchema.parse({
      ...manifestBody,
      hash: proofManifestHash(manifestBody),
    });
    const content = {
      id: digest(`financial-event:${e.id}`),
      tenantId: e.tenantId,
      orderId: e.orderId,
      customerId: e.baseline.customerId,
      operationId: e.id,
      type:
        e.kind === 'cancellation'
          ? ('financial_cancellation' as const)
          : ('return_resolved' as const),
      amountCents: e.amountCents,
      reason: e.reason,
      actorUid: actor.uid,
      occurredAt: now,
      requestId: actor.requestId,
      sequence: e.baseline.state.eventSequence + 1,
      previousHash: e.baseline.state.headHash,
      before: e.baseline.snapshot,
      after,
      references: [
        e.id,
        ...(e.returnId ? [e.returnId] : []),
        ...(destinations.creditLotId ? [destinations.creditLotId] : []),
        ...(destinations.refundObligationId ? [destinations.refundObligationId] : []),
      ],
      proof: {
        executionId: e.id,
        manifestId: e.id,
        rootHash: manifest.rootHash,
        entryCount: manifest.entryCount,
        beforeSnapshotHash: manifest.beforeSnapshotHash,
        afterSnapshotHash: manifest.afterSnapshotHash,
        ...(lifecycle ? { orderLifecycleHash: manifest.orderLifecycleHash } : {}),
        ...(returned
          ? {
              returnEventId: manifest.returnEventId,
              returnEventHash: manifest.returnEventHash,
              returnHeaderHash: manifest.returnHeaderHash,
            }
          : {}),
      },
      schemaVersion: 2 as const,
    };
    const event = s.eventV2Schema.parse({ ...content, hash: financialEventHash(content) });
    const nextState = s.financialStateSchema.parse({
      ...state,
      version: e.baseline.state.version + 1,
      eventSequence: event.sequence,
      headHash: event.hash,
      headEventId: event.id,
      journalVersion: 2,
    });
    const guard = financialGuardSchema.parse({
      ...e.baseline.guard,
      version: e.baseline.guard.version + 1,
      paymentCount: e.baseline.guard.paymentCount + 1,
      receivedCents: state.cashSettledCents + state.creditSettledCents,
    });
    e.status = 'COMPLETED';
    e.publishedAt = now;
    e.phase = 'publish';
    e.publication = { eventId: event.id, eventHash: event.hash, manifestHash: manifest.hash };
    e.result = s.financialResult.parse({
      operationId: e.id,
      orderId: e.orderId,
      orderVersion: lifecycle?.version ?? e.baseline.orderVersion,
      guardVersion: guard.version,
      eventId: event.id,
      resourceId: e.returnId,
      creditLotId: destinations.creditLotId,
      refundObligationId: destinations.refundObligationId,
      amountCents: e.amountCents,
    });
    e.leaseOwner = null;
    e.leaseUntil = null;
    for (const title of p.afterTitles)
      tx.set(repo.ref(e.tenantId, 'financialTitles', title.id), title);
    tx.set(repo.ref(e.tenantId, 'financialOrderStates', e.orderId), nextState);
    tx.set(repo.ref(e.tenantId, 'orderFinancialGuards', e.orderId), guard);
    tx.create(repo.ref(e.tenantId, 'financialEvents', event.id), event);
    tx.create(repo.ref(e.tenantId, 'financialProofManifests', e.id), manifest);
    finance.createDestinations(tx, destinations);
    if (lifecycle) {
      tx.update(repo.ref(e.tenantId, 'orders', e.orderId), { status: 'canceled' });
      tx.create(repo.ref(e.tenantId, 'orderLifecycleStates', e.orderId), lifecycle);
      const id = digest(`order-finance-event:${e.id}`);
      tx.create(
        repo.ref(e.tenantId, 'orderEvents', id),
        orderEventSchema.parse({
          id,
          tenantId: e.tenantId,
          orderId: e.orderId,
          version: lifecycle.version,
          type: 'canceled',
          previousStatus: 'confirmed',
          status: 'canceled',
          occurredAt: now,
          actorUid: actor.uid,
          reason: e.reason,
          requestId: actor.requestId,
          operationId: digest(`orders:${e.id}`),
          schemaVersion: 1,
        }),
      );
    }
    if (returned) {
      tx.set(repo.ref(e.tenantId, 'returnResolutionStates', e.returnId!), returned.header);
      tx.create(repo.ref(e.tenantId, 'returnEvents', returned.event.id), returned.event);
    }
    if (p.generation) {
      const retained = e.amountCents === 0;
      const meta = generationSchema.parse({
        ...p.generation,
        id: activeGenerationId(e.tenantId, e.orderId),
        kind: 'active',
        generationId: retained ? p.generation.generationId : p.nextGenerationId,
        certified: p.generation.certified,
        rowCount: p.generation.certified ? (retained ? p.generation.rowCount : p.nextRows) : null,
        stateVersion: nextState.version,
        eventSequence: nextState.eventSequence,
        headHash: nextState.headHash,
        totals: p.afterTitles.map((t) => ({
          titleId: t.id,
          cashCents: t.cashCents,
          creditCents: t.creditCents,
        })),
        updatedAt: now,
      });
      tx.set(repo.ref(e.tenantId, 'financialSourceGenerations', meta.id), meta);
      tx.set(repo.ref(e.tenantId, 'financialSourceGenerations', meta.generationId), {
        ...meta,
        id: meta.generationId,
        kind: 'generation',
      });
    }
  }
}
