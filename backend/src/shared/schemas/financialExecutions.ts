import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { cents } from './orders.js';
import { expectedVersion } from './commercial.js';
import { financialResult, ledgerSnapshot, titleSchema, financialStateSchema } from './finance.js';
import { financialGuardSchema } from '../../modules/receivables/orderReceivables.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().nonnegative().safe();
export const executionStatusSchema = z.enum([
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
  'COMPLETED',
  'ABORTED',
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export const executionPhaseSchema = z.enum([
  'journal',
  'payments',
  'credits',
  'lot-locks',
  'sources',
  'merkle',
  'verify',
  'stock',
  'publish',
  'return-lines',
  'final-check',
]);
export const executionProgressSchema = z
  .strictObject({
    examined: counter,
    eligible: counter,
    planned: counter,
    sealed: counter,
    validated: counter,
    applied: counter,
    releasedReservations: counter,
    total: counter.nullable(),
  })
  .refine(
    (v) =>
      v.applied <= v.validated &&
      v.validated <= v.sealed &&
      v.sealed <= v.planned &&
      (v.total === null || v.planned <= v.total),
    'Progresso financeiro inconsistente',
  );
export const executionCheckpointSchema = z.strictObject({
  phase: executionPhaseSchema,
  lastId: opaqueId.nullable(),
  lastTime: instant.nullable(),
  position: counter,
  sequence: counter,
  hash,
  totals: z
    .array(z.strictObject({ titleId: opaqueId, cashCents: cents, creditCents: cents }))
    .max(12),
  frontier: z.array(z.strictObject({ start: counter, count: counter.positive(), hash })).max(53),
});
export const executionPublicationSchema = z.strictObject({
  eventId: opaqueId,
  eventHash: hash,
  manifestHash: hash,
});
export const executionSchema = z
  .strictObject({
    id: opaqueId,
    tenantId: opaqueId,
    orderId: opaqueId,
    returnId: opaqueId.nullable(),
    kind: z.enum(['cancellation', 'return_resolution']),
    disposition: z.enum(['customer_credit', 'refund']),
    amountCents: cents,
    reason: z.string().min(3).max(500),
    payloadHash: hash,
    createdBy: opaqueId,
    authorizedBy: opaqueId,
    createdAt: instant,
    updatedAt: instant,
    status: executionStatusSchema,
    phase: executionPhaseSchema,
    resumeStatus: executionStatusSchema.nullable(),
    resumePhase: executionPhaseSchema.nullable(),
    revision: expectedVersion,
    fencingToken: expectedVersion,
    leaseOwner: opaqueId.nullable(),
    leaseUntil: instant.nullable(),
    applicationStartedAt: instant.nullable(),
    publishedAt: instant.nullable(),
    proofRootHash: hash.nullable(),
    proofEntryCount: counter,
    progress: executionProgressSchema,
    checkpoint: executionCheckpointSchema,
    baseline: z.strictObject({
      orderVersion: expectedVersion,
      orderHash: hash,
      lineCount: counter,
      customerId: opaqueId,
      guard: financialGuardSchema,
      state: financialStateSchema,
      titles: z.array(titleSchema).min(1).max(12),
      snapshot: ledgerSnapshot,
    }),
    publication: executionPublicationSchema.nullable(),
    result: financialResult.nullable(),
    review: z
      .strictObject({
        code: z.string().regex(/^[A-Z_]{1,80}$/),
        reference: opaqueId,
        detectedAt: instant,
      })
      .nullable(),
    schemaVersion: z.literal(1),
  })
  .refine(
    (v) =>
      v.baseline.state.tenantId === v.tenantId &&
      v.baseline.state.orderId === v.orderId &&
      v.baseline.guard.tenantId === v.tenantId &&
      v.baseline.guard.orderId === v.orderId &&
      v.baseline.titles.every(
        (t) =>
          t.tenantId === v.tenantId &&
          t.orderId === v.orderId &&
          t.customerId === v.baseline.customerId,
      ) &&
      (v.status === 'COMPLETED'
        ? v.publication !== null && v.publishedAt !== null && v.result !== null
        : v.publication === null && v.publishedAt === null && v.result === null) &&
      (v.status !== 'ABORTED' || v.applicationStartedAt === null) &&
      ((v.status !== 'PAUSED' && v.status !== 'NEEDS_REVIEW') ||
        (v.resumeStatus !== null && v.resumePhase !== null)) &&
      (v.status !== 'NEEDS_REVIEW' || v.review !== null) &&
      ((v.progress.applied === 0 && v.progress.releasedReservations === 0) ||
        v.applicationStartedAt !== null),
    'Estado de execução financeira inconsistente',
  );
export type FinancialExecution = z.infer<typeof executionSchema>;

export const executionLockSchema = z.strictObject({
  tenantId: opaqueId,
  resourceId: opaqueId,
  executionId: opaqueId,
  fencingToken: expectedVersion,
  baselineVersion: expectedVersion,
  createdAt: instant,
  schemaVersion: z.literal(1),
});
