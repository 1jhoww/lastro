import { createHmac } from 'node:crypto';
import { FieldPath, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { Actor } from '../../../shared/types/context.js';
import {
  executionSchema,
  executionLockSchema,
  type FinancialExecution,
} from '../../../shared/schemas/financialExecutions.js';
import * as s from '../../../shared/schemas/finance.js';
import * as r from '../../../shared/schemas/returns.js';
import { AppError, requireCondition } from '../../../shared/errors/appError.js';
import { recordAudit } from '../../../shared/audit/audit.js';
import {
  digest,
  stableJson,
  equalDigest,
  encodeCursor,
  decodeCursor,
} from '../../../shared/utils/crypto.js';
import type { FinancialService } from '../financialService.js';
import type { ReturnService } from '../../returns/returnService.js';
import { returnEventHash } from '../../returns/returnService.js';
import { ResolutionPhases } from './executionPhases.js';
import { ExecutionPublication } from './executionPublication.js';
import { FinancialBatchMeter, SplitFinancialBatch } from './budget.js';
import { batchReads } from './batchReads.js';
import { SourceBackfill, sourceBuildSchema } from './sourceBackfill.js';
import { activeGenerationId, generationSchema } from './sourceIndex.js';
import { proofChunkSchema, proofNodeSchema, siblingIntervals } from './proofStorage.js';
import {
  sourceProofHash,
  returnResolutionHeaderSchema,
  compactHeaderHash,
} from './proofRecords.js';
import { verifyProofMembership } from './proofs.js';
import { assertExecutionTransition } from './transitions.js';
import {
  planSchema,
  planId,
  chainStart,
  appendChain,
  allocateIntent,
  metricsSchema,
  attemptSchema,
  advanceInput,
  resumeInput,
  executionView,
  executionsQuery,
  proofReconciliationView,
  ensure,
  move,
  view,
  type ResolutionPlan,
} from './executionModel.js';

const terminal = (e: FinancialExecution) => ['COMPLETED', 'ABORTED'].includes(e.status);
const uuidFor = (value: string) => {
  const h = digest(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const lease = (now: string) => new Date(Date.parse(now) + 30_000).toISOString();
export class FinancialExecutions {
  readonly phases: ResolutionPhases;
  readonly publication: ExecutionPublication;
  constructor(
    readonly finance: FinancialService,
    readonly returns: ReturnService,
  ) {
    this.phases = new ResolutionPhases(finance, returns);
    this.publication = new ExecutionPublication(this.phases);
  }
  get repo() {
    return this.finance.repo;
  }
  get clock() {
    return this.finance.commands.clock;
  }
  async load(tx: Transaction, tenantId: string, id: string) {
    const e = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'financialExecutions', id),
      executionSchema,
      tx,
    );
    requireCondition(
      e?.id === id && e.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Execução não encontrada',
    );
    const p = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'financialExecutionPlans', planId(id)),
      planSchema,
      tx,
    );
    ensure(p?.tenantId === tenantId && p.executionId === id && p.id === planId(id));
    return { e, p };
  }
  async get(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(async (tx) => {
      await this.finance.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
      const { e, p } = await this.load(tx, tenantId, id);
      return view(e, p);
    });
  }
  async list(actor: Actor, tenantId: string, input: z.infer<typeof executionsQuery>) {
    const limit = Number(input.limit ?? '25');
    const scope = `financial-executions:${tenantId}:${actor.uid}:${stableJson({ ...input, cursor: null })}`;
    const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
    return this.repo.foundation.db.runTransaction(async (tx) => {
      await this.finance.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
      let query = this.repo
        .ref(tenantId, 'financialExecutions', 'placeholder')
        .parent.orderBy(FieldPath.documentId());
      if (input.status) query = query.where('status', '==', input.status);
      if (input.orderId) query = query.where('orderId', '==', input.orderId);
      if (input.pending === 'true' && !input.status)
        query = query.where('status', 'in', [
          'ACCEPTED',
          'INDEXING',
          'PLANNING',
          'SEALING',
          'VALIDATING',
          'READY',
          'APPLYING',
          'FINALIZABLE',
          'PAUSED',
          'NEEDS_REVIEW',
        ]);
      if (input.pending === 'false' && !input.status)
        query = query.where('status', 'in', ['COMPLETED', 'ABORTED']);
      if (cursor) query = query.startAfter(cursor);
      const page = await tx.get(query.limit(limit + 1)),
        items = [];
      for (const d of page.docs.slice(0, limit)) {
        const { e, p } = await this.load(tx, tenantId, d.id);
        items.push(view(e, p));
      }
      return {
        items,
        nextCursor:
          page.size > limit
            ? encodeCursor(this.repo.secret, scope, page.docs[limit - 1]!.id)
            : null,
      };
    });
  }
  startCancellation(
    actor: Actor,
    tenantId: string,
    orderId: string,
    input: z.infer<typeof s.cancellationInput>,
    key: string,
  ) {
    return this.start(actor, tenantId, orderId, null, input, key);
  }
  startReturn(
    actor: Actor,
    tenantId: string,
    returnId: string,
    input: z.infer<typeof r.returnResolve>,
    key: string,
  ) {
    return this.start(actor, tenantId, null, returnId, input, key);
  }
  private async start(
    actor: Actor,
    tenantId: string,
    orderId: string | null,
    returnId: string | null,
    input: z.infer<typeof s.cancellationInput> | z.infer<typeof r.returnResolve>,
    key: string,
  ) {
    const started = await this.finance.commands.execute(
      actor,
      tenantId,
      key,
      returnId ? 'return_resolution_execution' : 'financial_cancellation_execution',
      returnId ?? orderId!,
      input,
      returnId ? 'returns:manage' : 'financial-cancellation:manage',
      executionView,
      true,
      async (tx, _ctx, operationId, now) => {
        const document = returnId
          ? await tx.get(this.repo.ref(tenantId, 'returns', returnId))
          : null;
        requireCondition(
          !returnId || document?.exists,
          404,
          'RESOURCE_NOT_FOUND',
          'Devolução não encontrada',
        );
        const parsed = document ? r.returnSchema.safeParse(document.data()) : null;
        ensure(!parsed || parsed.success);
        const raw = parsed?.data ?? null;
        if (raw) ensure(raw.tenantId === tenantId && raw.id === returnId);
        const id = digest(`financial-execution:${tenantId}:${operationId}`),
          book = await this.finance.book.load(tx, tenantId, raw?.orderId ?? orderId!);
        await this.finance.commands.locks.assertOrderAvailable(tx, tenantId, book.order.id);
        this.finance.book.assertVersions(book, input);
        if (!raw) {
          this.finance.book.assertOpen(book);
          requireCondition(
            book.order.status === 'confirmed',
            409,
            'RETURN_REQUIRED',
            'Expedido exige devolução',
          );
        } else ensure(book.order.status === 'dispatched' && book.state.activeReturnCount > 0);
        let info: ResolutionPlan['returnInfo'] = null;
        if (raw) {
          const header = await this.repo.foundation.read(
            this.repo.ref(tenantId, 'returnResolutionStates', raw.id),
            returnResolutionHeaderSchema,
            tx,
          );
          if (!header) {
            const latest = await tx.get(
              this.repo
                .ref(tenantId, 'returnEvents', 'placeholder')
                .parent.where('returnId', '==', raw.id)
                .where('schemaVersion', '==', 2)
                .orderBy('sequence', 'desc')
                .limit(1),
            );
            ensure(latest.empty || raw.eventSequence >= latest.docs[0]!.get('sequence'));
          }
          const h = header && raw.version < header.version ? header : null;
          if (h)
            ensure(
              h.tenantId === tenantId &&
                h.orderId === book.order.id &&
                h.returnId === raw.id &&
                h.sourceVersion === raw.version &&
                h.sourceHash === digest(stableJson(raw)),
            );
          const headId = h?.headEventId ?? raw.headEventId;
          const head = await this.repo.foundation.read(
            this.repo.ref(tenantId, 'returnEvents', headId),
            r.returnEventSchema,
            tx,
          );
          ensure(
            head &&
              head.hash === returnEventHash(head) &&
              head.tenantId === tenantId &&
              head.returnId === raw.id &&
              head.orderId === book.order.id &&
              head.sequence === (h?.eventSequence ?? raw.eventSequence) &&
              head.hash === (h?.headHash ?? raw.headHash),
          );
          if (h) ensure(head.schemaVersion === 2 && head.headerHash === compactHeaderHash(h));
          requireCondition(
            'expectedVersion' in input && input.expectedVersion === (h?.version ?? raw.version),
            409,
            'CONFLICT',
            'Versão da devolução desatualizada',
          );
          const fields = r.returnSnapshotSchema.omit({ lines: true }).parse({
            ...raw,
            ...(h
              ? {
                  version: h.version,
                  status: h.status,
                  reason: h.reason,
                  updatedAt: h.updatedAt,
                  updatedBy: h.updatedBy,
                }
              : {}),
          });
          info = {
            rawHash: digest(stableJson(raw)),
            rawVersion: raw.version,
            fields,
            headId,
            headHash: head.hash,
            eventSequence: head.sequence,
            beforeSnapshotHash:
              head.schemaVersion === 1 ? digest(stableJson(head.after)) : head.afterSnapshotHash,
            lineCount: raw.lines.length,
            scanned: 0,
            eligibleLines: 0,
            decisions: 'damagedDecisions' in input ? (input.damagedDecisions ?? []) : [],
            seenDecisions: 0,
          };
        }
        const chain = chainStart({ tenantId, id }),
          snapshot = this.finance.book.snapshot(book.state, book.titles);
        const e = executionSchema.parse({
          id,
          tenantId,
          orderId: book.order.id,
          returnId,
          kind: returnId ? 'return_resolution' : 'cancellation',
          disposition: input.disposition,
          amountCents: 0,
          reason: input.reason,
          payloadHash: digest(stableJson(input)),
          createdBy: actor.uid,
          authorizedBy: actor.uid,
          createdAt: now,
          updatedAt: now,
          status: 'ACCEPTED',
          phase: returnId ? 'return-lines' : 'stock',
          resumeStatus: null,
          resumePhase: null,
          revision: 1,
          fencingToken: 1,
          leaseOwner: actor.uid,
          leaseUntil: lease(now),
          applicationStartedAt: null,
          publishedAt: null,
          proofRootHash: null,
          proofEntryCount: 0,
          progress: {
            examined: 0,
            eligible: 0,
            planned: 0,
            sealed: 0,
            validated: 0,
            applied: 0,
            releasedReservations: 0,
            total: null,
          },
          checkpoint: {
            phase: returnId ? 'return-lines' : 'stock',
            lastId: null,
            lastTime: null,
            position: 0,
            sequence: 0,
            hash: chain,
            totals: [],
            frontier: [],
          },
          baseline: {
            orderVersion: book.order.version,
            orderHash: digest(stableJson(book.order)),
            lineCount: book.order.lines.length,
            customerId: book.order.customerId,
            guard: book.guard,
            state: book.state,
            titles: book.titles,
            snapshot,
          },
          publication: null,
          result: null,
          review: null,
          schemaVersion: 1,
        });
        const p = planSchema.parse({
          id: planId(id),
          tenantId,
          executionId: id,
          generation: book.generation,
          nextGenerationId: digest(`financial-next-generation:${id}`),
          builderId: null,
          builderRevision: 0,
          returnInfo: info,
          stockPlanned: 0,
          amountKnown: false,
          afterTitles: book.titles,
          afterState: book.state,
          targets: book.titles.map((t) => ({
            titleId: t.id,
            cashTarget: 0,
            creditTarget: 0,
            cashLeft: 0,
            creditLeft: 0,
          })),
          titleIndex: 0,
          sourceKind: 'credit',
          sourceCount: 0,
          scannedRows: 0,
          scannedTotals: book.titles.map((t) => ({ titleId: t.id, cashCents: 0, creditCents: 0 })),
          nextTotals: book.titles.map((t) => ({ titleId: t.id, cashCents: 0, creditCents: 0 })),
          nextRows: 0,
          lotCount: 0,
          planFence: 1,
          sealedChain: chain,
          validatedChain: chain,
          appliedChain: chain,
          finalChain: chain,
          finalChecked: 0,
          recoveryPosition: null,
          recoveryPhase: null,
          recoveryChain: chain,
          metrics: metricsSchema.parse({
            commits: 0,
            reads: 0,
            writes: 0,
            estimatedBytes: 0,
            maxReads: 0,
            maxWrites: 0,
            maxEstimatedBytes: 0,
            maxDocumentBytes: 0,
            maxSampledHeapDeltaBytes: 0,
            maxSampledRssBytes: 0,
          }),
          schemaVersion: 1,
        });
        if (!returnId) allocateIntent(e, p, book.order.totalCents - book.state.canceledCents, now);
        tx.create(this.repo.ref(tenantId, 'financialExecutions', id), executionSchema.parse(e));
        tx.create(this.repo.ref(tenantId, 'financialExecutionPlans', p.id), planSchema.parse(p));
        tx.set(
          this.repo.ref(tenantId, 'financialExecutionOrderLocks', book.order.id),
          executionLockSchema.parse({
            tenantId,
            resourceId: book.order.id,
            executionId: id,
            fencingToken: 1,
            baselineVersion: book.order.version,
            createdAt: now,
            schemaVersion: 1,
          }),
        );
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          'financial_execution.accepted',
          id,
          now,
          { kind: e.kind, orderId: e.orderId, returnId },
        );
        return view(e, p);
      },
    );
    return this.get(actor, tenantId, started.id);
  }
  private async authority(
    tx: Transaction,
    actor: Actor,
    e: FinancialExecution,
    now: string,
    fence: number,
  ) {
    const ctx = await this.finance.commands.access.tenant(
      actor,
      e.tenantId,
      e.kind === 'cancellation' ? 'financial-cancellation:manage' : 'returns:manage',
      tx,
    );
    const lock = await this.repo.foundation.read(
      this.repo.ref(e.tenantId, 'financialExecutionOrderLocks', e.orderId),
      executionLockSchema,
      tx,
    );
    requireCondition(
      e.leaseOwner === actor.uid &&
        e.authorizedBy === actor.uid &&
        e.fencingToken === fence &&
        e.leaseUntil &&
        e.leaseUntil > now &&
        lock?.tenantId === e.tenantId &&
        lock.executionId === e.id &&
        lock.resourceId === e.orderId,
      409,
      'EXECUTION_LEASE_CONFLICT',
      'Lease expirado ou proprietário mudou; retome a execução',
    );
    return ctx;
  }
  async advance(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof advanceInput>,
    key: string,
  ) {
    z.string().uuid().parse(key);
    const attemptId = digest(`financial-step:${id}:${key}`),
      payloadHash = digest(stableJson(input)),
      deadline = Date.now() + 3000;
    let result: z.infer<typeof executionView> | null = null,
      limit = 25;
    for (let batch = 0; batch < 5; batch++) {
      const snapshot = await this.repo.foundation.db.runTransaction(async (tx) => {
        await this.finance.commands.access.tenant(actor, tenantId, 'payments:manage', tx);
        const loaded = await this.load(tx, tenantId, id),
          prior = await this.repo.foundation.read(
            this.repo.ref(tenantId, 'financialExecutionSteps', attemptId),
            attemptSchema,
            tx,
          );
        if (prior) {
          requireCondition(
            prior.actorUid === actor.uid &&
              prior.payloadHash === payloadHash &&
              prior.executionId === id,
            409,
            'CONFLICT',
            'Chave de passo já utilizada',
          );
          if (prior.done) {
            ensure(prior.result);
            return { ...loaded, replay: prior.result };
          }
        }
        requireCondition(
          loaded.e.revision === (prior?.revision ?? input.expectedRevision),
          409,
          'EXECUTION_CONFLICT',
          'Revisão desatualizada',
        );
        if (!terminal(loaded.e))
          await this.authority(tx, actor, loaded.e, this.clock().toISOString(), input.fencingToken);
        return { ...loaded, replay: null };
      });
      if (snapshot.replay) return snapshot.replay;
      const { e, p } = snapshot;
      let indexed: z.infer<typeof sourceBuildSchema> | null = null;
      let returned: Awaited<ReturnType<ExecutionPublication['prepareReturn']>> = null;
      try {
        if (e.status === 'INDEXING') indexed = await this.index(actor, e, p);
        if (e.status === 'FINALIZABLE')
          returned = await this.publication.prepareReturn(e, p, actor, this.clock().toISOString());
        result = await this.repo.foundation.db.runTransaction(async (rawTx) => {
          const meter = new FinancialBatchMeter(),
            tx = meter.wrap(rawTx),
            now = this.clock().toISOString(),
            heap = process.memoryUsage().heapUsed;
          const ctx = await this.finance.commands.access.tenant(
            actor,
            tenantId,
            'payments:manage',
            tx,
          );
          const current = await this.load(tx, tenantId, id),
            a = await this.repo.foundation.read(
              this.repo.ref(tenantId, 'financialExecutionSteps', attemptId),
              attemptSchema,
              tx,
            );
          if (a?.done) {
            ensure(a.result && a.actorUid === actor.uid && a.payloadHash === payloadHash);
            return a.result;
          }
          requireCondition(
            current.e.revision === e.revision &&
              current.e.revision === (a?.revision ?? input.expectedRevision),
            409,
            'EXECUTION_CONFLICT',
            'Revisão mudou',
          );
          const root = current.e,
            plan = current.p;
          if (terminal(root)) {
            const output = view(root, plan);
            tx.set(
              this.repo.ref(tenantId, 'financialExecutionSteps', attemptId),
              attemptSchema.parse({
                actorUid: actor.uid,
                payloadHash,
                executionId: id,
                revision: root.revision,
                batches: a?.batches ?? 0,
                done: true,
                result: output,
                schemaVersion: 1,
              }),
            );
            return output;
          }
          if (!terminal(root)) await this.authority(tx, actor, root, now, input.fencingToken);
          if (plan.recoveryPosition !== null) await this.recover(tx, root, plan, limit);
          else if (root.status === 'ACCEPTED') {
            if (root.returnId) await this.phases.planning(tx, root, plan, limit, now);
            else
              move(
                root,
                plan.generation?.certified ? 'PLANNING' : 'INDEXING',
                plan.generation?.certified ? 'stock' : 'journal',
              );
          } else if (root.status === 'INDEXING') {
            ensure(
              indexed &&
                indexed.tenantId === tenantId &&
                indexed.orderId === root.orderId &&
                stableJson(indexed.state) === stableJson(root.baseline.state),
            );
            const stored = await this.repo.foundation.read(
              this.repo.ref(tenantId, 'financialSourceGenerations', indexed.id),
              sourceBuildSchema,
              tx,
            );
            ensure(stored?.revision === indexed.revision);
            plan.builderId = indexed.id;
            plan.builderRevision = indexed.revision;
            root.checkpoint.sequence = indexed.journalCount;
            root.checkpoint.hash = indexed.lastEventHash;
            if (indexed.phase === 'complete') {
              const gen = await this.repo.foundation.read(
                this.repo.ref(
                  tenantId,
                  'financialSourceGenerations',
                  activeGenerationId(tenantId, root.orderId),
                ),
                generationSchema,
                tx,
              );
              ensure(
                gen?.certified &&
                  gen.generationId === indexed.generationId &&
                  gen.stateVersion === root.baseline.state.version &&
                  gen.headHash === root.baseline.state.headHash,
              );
              plan.generation = gen;
              move(root, 'PLANNING', root.returnId ? 'credits' : 'stock');
            }
          } else if (root.status === 'PLANNING')
            await this.phases.planning(tx, root, plan, limit, now);
          else if (root.status === 'SEALING') await this.phases.sealing(tx, root, plan, limit, now);
          else if (root.status === 'VALIDATING') await this.phases.validate(tx, root, plan, limit);
          else if (root.status === 'READY') {
            move(root, 'APPLYING', 'sources');
            await this.phases.applySources(tx, root, plan, limit, now);
            if (root.proofEntryCount === 0 && root.kind === 'cancellation')
              await this.phases.stock(tx, root, ctx, limit, now);
          } else if (root.status === 'APPLYING') {
            if (root.phase === 'sources')
              await this.phases.applySources(tx, root, plan, limit, now);
            else if (root.phase === 'stock') await this.phases.stock(tx, root, ctx, limit, now);
            else if (root.phase === 'final-check')
              await this.phases.finalCheck(tx, root, plan, limit);
            else ensure(false);
          } else if (root.status === 'FINALIZABLE') {
            assertExecutionTransition(root, 'COMPLETED');
            await this.publication.publish(tx, root, plan, actor, now, returned);
          }
          if (!terminal(root)) {
            root.leaseUntil = lease(now);
          }
          root.revision++;
          root.updatedAt = now;
          const done =
            terminal(root) ||
            ['PAUSED', 'NEEDS_REVIEW'].includes(root.status) ||
            (a?.batches ?? 0) + 1 >= 5 ||
            Date.now() >= deadline;
          const output = view(root, plan);
          tx.set(this.repo.ref(tenantId, 'financialExecutions', id), executionSchema.parse(root));
          tx.set(
            this.repo.ref(tenantId, 'financialExecutionSteps', attemptId),
            attemptSchema.parse({
              actorUid: actor.uid,
              payloadHash,
              executionId: id,
              revision: root.revision,
              batches: (a?.batches ?? 0) + 1,
              done,
              result: done ? output : null,
              schemaVersion: 1,
            }),
          );
          recordAudit(
            this.repo.foundation,
            tx,
            actor,
            tenantId,
            'financial_execution.step',
            id,
            now,
            {
              revision: root.revision,
              status: root.status,
              phase: root.phase,
              fencingToken: root.fencingToken,
            },
          );
          tx.create(
            this.repo.ref(
              tenantId,
              'financialExecutionEvents',
              digest(`execution-event:${id}:${root.revision}`),
            ),
            {
              tenantId,
              executionId: id,
              revision: root.revision,
              status: root.status,
              phase: root.phase,
              progress: root.progress,
              fencingToken: root.fencingToken,
              actorUid: actor.uid,
              requestId: actor.requestId,
              occurredAt: now,
              schemaVersion: 1,
            },
          );
          plan.metrics.commits++;
          plan.metrics.reads += meter.reads;
          plan.metrics.writes += meter.writes + 1;
          plan.metrics.maxReads = Math.max(plan.metrics.maxReads, meter.reads);
          plan.metrics.maxWrites = Math.max(plan.metrics.maxWrites, meter.writes + 1);
          plan.metrics.maxSampledHeapDeltaBytes = Math.max(
            plan.metrics.maxSampledHeapDeltaBytes,
            Math.max(0, process.memoryUsage().heapUsed - heap),
          );
          plan.metrics.maxSampledRssBytes = Math.max(
            plan.metrics.maxSampledRssBytes,
            process.memoryUsage().rss,
          );
          const planBytes = Buffer.byteLength(stableJson(plan)) * 2 + 512;
          plan.metrics.estimatedBytes += meter.bytes + planBytes;
          plan.metrics.maxEstimatedBytes = Math.max(
            plan.metrics.maxEstimatedBytes,
            meter.bytes + planBytes,
          );
          plan.metrics.maxDocumentBytes = Math.max(
            plan.metrics.maxDocumentBytes,
            meter.maxDocumentBytes,
            Math.ceil(planBytes / 2),
          );
          tx.set(
            this.repo.ref(tenantId, 'financialExecutionPlans', plan.id),
            planSchema.parse(plan),
          );
          return output;
        });
        const attempt = attemptSchema.parse(
          (await this.repo.ref(tenantId, 'financialExecutionSteps', attemptId).get()).data(),
        );
        if (attempt.done) return result;
      } catch (error) {
        if (error instanceof SplitFinancialBatch && limit > 1) {
          limit = Math.max(1, Math.floor(limit / 2));
          batch--;
          continue;
        }
        if (
          error instanceof AppError &&
          [
            'EXECUTION_CONFLICT',
            'EXECUTION_LEASE_CONFLICT',
            'FORBIDDEN',
            'SUBSCRIPTION_INACTIVE',
          ].includes(error.code)
        )
          throw error;
        if (
          !(error instanceof AppError) &&
          !(error instanceof z.ZodError) &&
          !(error instanceof SplitFinancialBatch)
        )
          throw error;
        return this.pause(actor, tenantId, id, input, key, error, e.revision);
      }
    }
    ensure(result);
    return result;
  }
  private async index(actor: Actor, e: FinancialExecution, p: ResolutionPlan) {
    const key = uuidFor(`financial-index:${e.tenantId}:${e.id}`),
      id = digest(`finance:${key}`);
    const builder = new SourceBackfill(this.finance.commands, {
      id: e.id,
      fence: e.fencingToken,
      revision: e.revision,
      uid: actor.uid,
    });
    const existing = await this.repo.ref(e.tenantId, 'financialSourceGenerations', id).get();
    if (!existing.exists) return builder.start(actor, e.tenantId, e.orderId, key);
    const build = sourceBuildSchema.parse(existing.data());
    if (build.revision > p.builderRevision || build.phase === 'complete') return build;
    return builder.advance(
      actor,
      e.tenantId,
      id,
      uuidFor(`financial-index-step:${e.id}:${e.fencingToken}:${e.revision}`),
      build.revision,
    );
  }
  private async pause(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof advanceInput>,
    key: string,
    error: Error,
    revision: number,
  ) {
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const { e, p } = await this.load(tx, tenantId, id),
        now = this.clock().toISOString();
      await this.authority(tx, actor, e, now, input.fencingToken);
      requireCondition(
        e.revision === revision,
        409,
        'EXECUTION_CONFLICT',
        'Revisão mudou após falha',
      );
      requireCondition(!terminal(e), 409, 'EXECUTION_CONFLICT', 'Execução já concluída');
      const status =
        e.status === 'ACCEPTED' ||
        e.status === 'READY' ||
        (error instanceof AppError && error.code === 'FINANCIAL_LOT_LOCKED')
          ? 'PAUSED'
          : 'NEEDS_REVIEW';
      e.resumeStatus = e.status;
      e.resumePhase = e.phase;
      assertExecutionTransition(e, status);
      e.status = status;
      e.revision++;
      e.updatedAt = now;
      e.review = {
        code: error instanceof AppError ? error.code : 'FINANCIAL_INTEGRITY',
        reference: digest(`review:${e.id}:${e.revision}`),
        detectedAt: now,
      };
      const output = view(e, p);
      tx.set(this.repo.ref(tenantId, 'financialExecutions', id), executionSchema.parse(e));
      tx.set(
        this.repo.ref(tenantId, 'financialExecutionSteps', digest(`financial-step:${id}:${key}`)),
        attemptSchema.parse({
          actorUid: actor.uid,
          payloadHash: digest(stableJson(input)),
          executionId: id,
          revision: e.revision,
          batches: 0,
          done: true,
          result: output,
          schemaVersion: 1,
        }),
      );
      recordAudit(
        this.repo.foundation,
        tx,
        actor,
        tenantId,
        'financial_execution.review',
        id,
        now,
        { code: e.review.code, reference: e.review.reference, status: e.status },
      );
      return output;
    });
  }
  control(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof resumeInput>,
    key: string,
    abort = false,
  ) {
    return this.finance.commands.execute(
      actor,
      tenantId,
      key,
      abort ? 'financial_execution_abort' : 'financial_execution_resume',
      id,
      input,
      'payments:manage',
      executionView,
      true,
      async (tx, _ctx, _op, now) => {
        const { e, p } = await this.load(tx, tenantId, id);
        requireCondition(
          e.revision === input.expectedRevision && !terminal(e),
          409,
          'EXECUTION_CONFLICT',
          'Revisão desatualizada ou execução terminal',
        );
        if (abort) {
          assertExecutionTransition(e, 'ABORTED');
          e.status = 'ABORTED';
          e.leaseOwner = null;
          e.leaseUntil = null;
        } else {
          requireCondition(
            e.leaseOwner === actor.uid ||
              !e.leaseUntil ||
              e.leaseUntil <= now ||
              ['PAUSED', 'NEEDS_REVIEW'].includes(e.status),
            409,
            'EXECUTION_LEASE_CONFLICT',
            'Lease pertence a outro administrador',
          );
          const review = e.status === 'NEEDS_REVIEW';
          if (['PAUSED', 'NEEDS_REVIEW'].includes(e.status)) {
            ensure(e.resumeStatus && e.resumePhase);
            assertExecutionTransition(e, e.resumeStatus, true);
            e.status = e.resumeStatus;
            e.phase = e.resumePhase;
          }
          if (review && e.proofEntryCount > 0) {
            p.recoveryPosition = 0;
            p.recoveryPhase = e.phase;
            p.recoveryChain = chainStart(e);
          }
          e.fencingToken++;
          e.authorizedBy = actor.uid;
          e.leaseOwner = actor.uid;
          e.leaseUntil = lease(now);
          e.review = null;
          e.resumeStatus = null;
          e.resumePhase = null;
        }
        e.revision++;
        e.updatedAt = now;
        tx.set(this.repo.ref(tenantId, 'financialExecutions', id), executionSchema.parse(e));
        tx.set(this.repo.ref(tenantId, 'financialExecutionPlans', p.id), planSchema.parse(p));
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          abort ? 'financial_execution.aborted' : 'financial_execution.resumed',
          id,
          now,
          {
            reason: input.reason,
            fencingToken: e.fencingToken,
            revision: e.revision,
            applicationStartedAt: e.applicationStartedAt,
          },
        );
        return view(e, p);
      },
    );
  }
  private async recover(tx: Transaction, e: FinancialExecution, p: ResolutionPlan, limit: number) {
    ensure(p.recoveryPosition !== null);
    const page = await tx.get(
      this.repo
        .ref(e.tenantId, 'financialProofChunks', 'placeholder')
        .parent.where('executionId', '==', e.id)
        .orderBy('position')
        .startAt(p.recoveryPosition)
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
    const missing = [];
    for (const doc of page.docs.slice(0, limit)) {
      const chunk = proofChunkSchema.parse(doc.data()),
        entry = chunk.entry;
      const context = { tenantId: e.tenantId, executionId: e.id, entryCount: e.proofEntryCount };
      if (e.proofRootHash && !chunk.siblings) {
        chunk.siblings = [];
        for (const i of siblingIntervals(context, entry.position)) {
          const node = proofNodeSchema.parse(
            (await tx.get(this.repo.ref(e.tenantId, 'financialProofNodes', i.id))).data(),
          );
          ensure(
            node.tenantId === e.tenantId &&
              node.executionId === e.id &&
              node.start === i.start &&
              node.count === i.count,
          );
          chunk.siblings.push(node.hash);
        }
      }
      ensure(
        entry.position === p.recoveryPosition &&
          chunk.tenantId === e.tenantId &&
          chunk.executionId === e.id &&
          chunk.entryId === entry.id &&
          entry.hash === sourceProofHash(entry) &&
          (!e.proofRootHash ||
            (chunk.siblings &&
              verifyProofMembership(
                context,
                e.proofRootHash,
                entry.position,
                entry.hash,
                chunk.siblings,
              ))),
      );
      const ref = this.repo.ref(e.tenantId, 'financialProofEntries', entry.id),
        stored = await tx.get(ref);
      if (stored.exists) ensure(stableJson(stored.data()) === stableJson(entry));
      else missing.push({ ref, entry });
      await this.phases.assertCanonical(tx, e, entry, entry.position < e.progress.applied);
      p.recoveryPosition++;
      p.recoveryChain = appendChain(p.recoveryChain, entry);
    }
    if (page.size <= limit) {
      ensure(p.recoveryPosition === e.proofEntryCount && p.recoveryChain === p.sealedChain);
      p.recoveryPosition = null;
      p.recoveryPhase = null;
    }
    for (const item of missing) tx.create(item.ref, item.entry);
  }
  async reconcile(actor: Actor, tenantId: string, id: string, limit: number, cursor?: string) {
    const secret = this.repo.secret;
    const checkpoint = z.strictObject({
      next: z.number().int().nonnegative().safe(),
      checked: z.number().int().nonnegative().safe(),
      consistent: z.boolean(),
      chain: z.string().regex(/^[a-f0-9]{64}$/),
      boundary: z.string().nullable(),
      boundaryHash: z.string().nullable(),
      pin: z.string(),
    });
    const sign = (payload: string) =>
      createHmac('sha256', secret)
        .update(`financial-proof-reconciliation:v1:${payload}`)
        .digest('base64url');
    return this.repo.foundation.db.runTransaction(async (tx) => {
      await this.finance.commands.access.tenant(actor, tenantId, 'receivables:read', tx);
      const { e, p } = await this.load(tx, tenantId, id);
      requireCondition(
        e.proofRootHash && e.progress.validated === e.proofEntryCount,
        409,
        'EXECUTION_NOT_SEALED',
        'Provas ainda não validadas',
      );
      const pin = digest(
        stableJson({
          tenantId,
          id,
          uid: actor.uid,
          root: e.proofRootHash,
          count: e.proofEntryCount,
          limit,
        }),
      );
      let c: z.infer<typeof checkpoint> = {
        next: 0,
        checked: 0,
        consistent: true,
        chain: chainStart(e),
        boundary: null,
        boundaryHash: null,
        pin,
      };
      if (cursor) {
        try {
          const [payload, signature, extra] = cursor.split('.');
          ensure(
            payload &&
              signature &&
              !extra &&
              cursor.length <= 1024 &&
              equalDigest(sign(payload), signature),
          );
          c = checkpoint.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
          ensure(c.pin === pin);
        } catch {
          throw new AppError(422, 'VALIDATION_ERROR', 'Cursor de provas inválido');
        }
      }
      if (c.boundary) {
        const b = await tx.get(this.repo.ref(tenantId, 'financialProofChunks', c.boundary));
        if (!b.exists || digest(stableJson(b.data())) !== c.boundaryHash) c.consistent = false;
      }
      const page = await tx.get(
        this.repo
          .ref(tenantId, 'financialProofChunks', 'placeholder')
          .parent.where('executionId', '==', id)
          .orderBy('position')
          .startAt(c.next)
          .limit(limit + 1),
      );
      for (const doc of page.docs.slice(0, limit)) {
        const parsed = proofChunkSchema.safeParse(doc.data());
        c.checked++;
        if (!parsed.success) {
          c.consistent = false;
          c.next++;
          continue;
        }
        const chunk = parsed.data,
          entry = chunk.entry,
          stored = await tx.get(this.repo.ref(tenantId, 'financialProofEntries', entry.id));
        if (
          chunk.position !== c.next ||
          chunk.tenantId !== tenantId ||
          chunk.executionId !== id ||
          entry.tenantId !== tenantId ||
          entry.executionId !== id ||
          chunk.entryId !== entry.id ||
          entry.hash !== sourceProofHash(entry) ||
          !chunk.siblings ||
          !verifyProofMembership(
            { tenantId, executionId: id, entryCount: e.proofEntryCount },
            e.proofRootHash!,
            entry.position,
            entry.hash,
            chunk.siblings,
          ) ||
          stableJson(stored.data()) !== stableJson(entry)
        )
          c.consistent = false;
        c.next = chunk.position + 1;
        c.chain = appendChain(c.chain, entry);
        c.boundary = doc.id;
        c.boundaryHash = digest(stableJson(doc.data()));
      }
      const complete = page.size <= limit;
      if (complete && (c.checked !== e.proofEntryCount || c.chain !== p.sealedChain))
        c.consistent = false;
      const encoded = Buffer.from(JSON.stringify(c)).toString('base64url');
      return proofReconciliationView.parse({
        executionId: id,
        scope: 'proofs',
        consistent: c.consistent,
        complete,
        checkedEntries: c.checked,
        expectedEntries: e.proofEntryCount,
        nextCursor: complete ? null : `${encoded}.${sign(encoded)}`,
      });
    });
  }
}
