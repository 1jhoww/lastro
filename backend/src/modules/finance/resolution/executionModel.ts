import { z } from 'zod';
import { opaqueId, instant } from '../../../shared/schemas/models.js';
import { pageQuery, pageOf } from '../../../shared/schemas/http.js';
import {
  executionStatusSchema,
  executionPhaseSchema,
  executionProgressSchema,
  type FinancialExecution,
} from '../../../shared/schemas/financialExecutions.js';
import * as s from '../../../shared/schemas/finance.js';
import * as r from '../../../shared/schemas/returns.js';
import { sourceProofSchema, type SourceProof } from './proofRecords.js';
import { generationSchema } from './sourceIndex.js';
import { digest, stableJson } from '../../../shared/utils/crypto.js';
import { requireCondition } from '../../../shared/errors/appError.js';
import { assertExecutionTransition } from './transitions.js';

const counter = z.number().int().nonnegative().safe(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const advanceInput = z.strictObject({
  expectedRevision: counter.positive(),
  fencingToken: counter.positive(),
});
export const resumeInput = z.strictObject({
  expectedRevision: counter.positive(),
  reason: z.string().trim().min(3).max(500),
});
export const abortInput = resumeInput;
export const executionView = z.object({
  id: opaqueId,
  orderId: opaqueId,
  returnId: opaqueId.nullable(),
  kind: z.enum(['cancellation', 'return_resolution']),
  status: executionStatusSchema,
  phase: executionPhaseSchema,
  revision: counter.positive(),
  fencingToken: counter.positive(),
  financialCompleted: z.boolean(),
  publishedAt: instant.nullable(),
  result: s.financialResult.nullable(),
  progress: executionProgressSchema,
  blockedResources: z.object({ order: z.boolean(), sharedLots: counter }),
  retryAfterSeconds: counter,
  review: z.object({ code: z.string(), reference: opaqueId, detectedAt: instant }).nullable(),
  createdAt: instant,
  updatedAt: instant,
  leaseUntil: instant.nullable(),
});
export const executionsQuery = pageQuery
  .extend({
    status: executionStatusSchema.optional(),
    orderId: opaqueId.optional(),
    pending: z.enum(['true', 'false']).optional(),
  })
  .strict()
  .refine(
    (v) =>
      !v.status ||
      !v.pending ||
      ['COMPLETED', 'ABORTED'].includes(v.status) === (v.pending === 'false'),
    'Status e pending incompatíveis',
  );
export const executionsPage = pageOf(executionView);
export const proofReconciliationView = z.object({
  executionId: opaqueId,
  scope: z.literal('proofs'),
  consistent: z.boolean(),
  complete: z.boolean(),
  checkedEntries: counter,
  expectedEntries: counter,
  nextCursor: z.string().nullable(),
});
export const returnInfoSchema = z.strictObject({
  rawHash: hash,
  rawVersion: counter.positive(),
  fields: r.returnSnapshotSchema.omit({ lines: true }),
  beforeSnapshotHash: hash,
  headId: opaqueId,
  headHash: hash,
  eventSequence: counter.positive(),
  lineCount: counter.positive(),
  scanned: counter,
  eligibleLines: counter,
  decisions: r.returnResolve.shape.damagedDecisions,
  seenDecisions: counter,
});
export const metricsSchema = z.strictObject({
  commits: counter,
  reads: counter,
  writes: counter,
  estimatedBytes: counter,
  maxReads: counter,
  maxWrites: counter,
  maxEstimatedBytes: counter,
  maxDocumentBytes: counter,
  maxSampledHeapDeltaBytes: counter,
  maxSampledRssBytes: counter,
});
export const planSchema = z.strictObject({
  id: hash,
  tenantId: opaqueId,
  executionId: opaqueId,
  generation: generationSchema.nullable(),
  nextGenerationId: hash,
  builderId: opaqueId.nullable(),
  builderRevision: counter,
  returnInfo: returnInfoSchema.nullable(),
  stockPlanned: counter,
  amountKnown: z.boolean(),
  afterTitles: z.array(s.titleSchema).min(1).max(12),
  afterState: s.financialStateSchema,
  targets: z
    .array(
      z.strictObject({
        titleId: opaqueId,
        cashTarget: counter,
        creditTarget: counter,
        cashLeft: counter,
        creditLeft: counter,
      }),
    )
    .min(1)
    .max(12),
  titleIndex: counter,
  sourceKind: z.enum(['cash', 'credit']),
  sourceCount: counter,
  scannedRows: counter,
  scannedTotals: generationSchema.shape.totals,
  nextTotals: generationSchema.shape.totals,
  nextRows: counter,
  lotCount: counter,
  planFence: counter.positive(),
  sealedChain: hash,
  validatedChain: hash,
  appliedChain: hash,
  finalChain: hash,
  finalChecked: counter,
  recoveryPosition: counter.nullable(),
  recoveryPhase: executionPhaseSchema.nullable(),
  recoveryChain: hash,
  metrics: metricsSchema,
  schemaVersion: z.literal(1),
});
export type ResolutionPlan = z.infer<typeof planSchema>;
const recordFields = {
  id: hash,
  tenantId: opaqueId,
  executionId: opaqueId,
  sourceId: opaqueId,
  entry: sourceProofSchema.nullable(),
  linePosition: counter.nullable(),
  schemaVersion: z.literal(1),
};
export const sourcePlanSchema = z.discriminatedUnion('collection', [
  z.strictObject({
    ...recordFields,
    collection: z.literal('payments'),
    before: s.paymentSchema,
    after: s.paymentSchema,
  }),
  z.strictObject({
    ...recordFields,
    collection: z.literal('creditApplications'),
    before: s.creditSchema,
    after: s.creditSchema,
  }),
  z.strictObject({
    ...recordFields,
    collection: z.literal('orderReturnLines'),
    returnId: opaqueId,
    before: r.returnGuardSchema,
    after: r.returnGuardSchema,
    lineBefore: r.returnLineSchema,
    lineAfter: r.returnLineSchema,
  }),
]);
export type SourcePlan = z.infer<typeof sourcePlanSchema>;
export const lotPlanSchema = z.strictObject({
  id: hash,
  tenantId: opaqueId,
  executionId: opaqueId,
  sourceId: opaqueId,
  amountCents: counter.positive(),
  entry: sourceProofSchema.nullable(),
  schemaVersion: z.literal(1),
});
export const stockPlanSchema = z.strictObject({
  id: hash,
  tenantId: opaqueId,
  executionId: opaqueId,
  position: counter,
  lineId: opaqueId,
  productId: opaqueId,
  quantityScaled: counter.positive(),
  reservationId: opaqueId,
  schemaVersion: z.literal(1),
});
export const attemptSchema = z.strictObject({
  actorUid: opaqueId,
  payloadHash: hash,
  executionId: opaqueId,
  revision: counter.positive(),
  batches: counter,
  done: z.boolean(),
  result: executionView.nullable(),
  schemaVersion: z.literal(1),
});
export const planId = (id: string) => digest(`financial-execution-plan:${id}`);
export const chainStart = (e: Pick<FinancialExecution, 'tenantId' | 'id'>) =>
  digest(`financial-sealed-chain:v1:${e.tenantId}:${e.id}`);
export const appendChain = (previous: string, entry: SourceProof) =>
  digest(stableJson({ previous, position: entry.position, hash: entry.hash }));
export function ensure(condition: unknown): asserts condition {
  requireCondition(condition, 409, 'FINANCIAL_INTEGRITY', 'Plano financeiro inconsistente');
}
export function move(
  e: FinancialExecution,
  status: FinancialExecution['status'],
  phase: FinancialExecution['phase'],
) {
  if (e.status !== status) assertExecutionTransition(e, status);
  e.status = status;
  e.phase = phase;
  e.checkpoint = {
    ...e.checkpoint,
    phase,
    lastId: null,
    lastTime: null,
    position: 0,
    frontier: [],
  };
}
export function view(e: FinancialExecution, p: ResolutionPlan) {
  return executionView.parse({
    ...e,
    financialCompleted: e.status === 'COMPLETED',
    blockedResources: {
      order: !['COMPLETED', 'ABORTED'].includes(e.status),
      sharedLots: ['COMPLETED', 'ABORTED'].includes(e.status) ? 0 : p.lotCount,
    },
    retryAfterSeconds: e.status === 'PAUSED' ? 2 : 0,
  });
}
export function allocateIntent(
  e: FinancialExecution,
  p: ResolutionPlan,
  amount: number,
  now: string,
) {
  const titles = e.baseline.titles.map((t) => ({ ...t }));
  const sorted = [...titles].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.installmentNumber - b.installmentNumber,
  );
  let left = amount,
    credit = 0,
    cash = 0;
  const changed = new Set<string>();
  for (const t of sorted) {
    const take = Math.min(left, t.outstandingCents);
    t.outstandingCents -= take;
    t.canceledCents += take;
    left -= take;
    if (take) changed.add(t.id);
  }
  for (const t of sorted) {
    const take = Math.min(left, t.creditCents);
    t.creditCents -= take;
    t.canceledCents += take;
    left -= take;
    credit += take;
    if (take) changed.add(t.id);
  }
  for (const t of sorted) {
    const take = Math.min(left, t.cashCents);
    t.cashCents -= take;
    t.canceledCents += take;
    left -= take;
    cash += take;
    if (take) changed.add(t.id);
  }
  ensure(
    left === 0 &&
      amount <= titles.reduce((n, t) => n + t.originalCents, 0) - e.baseline.state.canceledCents,
  );
  for (const t of titles)
    if (changed.has(t.id) || e.kind === 'cancellation') {
      t.version++;
      t.updatedAt = now;
    }
  p.targets = sorted.map((t) => ({
    titleId: t.id,
    creditTarget: e.baseline.titles.find((b) => b.id === t.id)!.creditCents - t.creditCents,
    cashTarget: e.baseline.titles.find((b) => b.id === t.id)!.cashCents - t.cashCents,
    creditLeft: e.baseline.titles.find((b) => b.id === t.id)!.creditCents - t.creditCents,
    cashLeft: e.baseline.titles.find((b) => b.id === t.id)!.cashCents - t.cashCents,
  }));
  p.afterTitles = titles.map((t) => s.titleSchema.parse(t));
  p.afterState = s.financialStateSchema.parse({
    ...e.baseline.state,
    cashSettledCents: e.baseline.state.cashSettledCents - cash,
    creditSettledCents: e.baseline.state.creditSettledCents - credit,
    transferredCashCents: e.baseline.state.transferredCashCents + cash,
    canceledCents: e.baseline.state.canceledCents + amount,
  });
  e.amountCents = amount;
  p.amountKnown = true;
}
