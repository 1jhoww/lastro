import type { ExecutionStatus } from '../../../shared/schemas/financialExecutions.js';
import { requireCondition } from '../../../shared/errors/appError.js';

const transitions: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  ACCEPTED: ['INDEXING', 'PLANNING', 'PAUSED', 'ABORTED'],
  INDEXING: ['PLANNING', 'PAUSED', 'NEEDS_REVIEW', 'ABORTED'],
  PLANNING: ['SEALING', 'PAUSED', 'NEEDS_REVIEW', 'ABORTED'],
  SEALING: ['VALIDATING', 'PAUSED', 'NEEDS_REVIEW', 'ABORTED'],
  VALIDATING: ['READY', 'PAUSED', 'NEEDS_REVIEW', 'ABORTED'],
  READY: ['APPLYING', 'PAUSED', 'ABORTED'],
  APPLYING: ['FINALIZABLE', 'PAUSED', 'NEEDS_REVIEW'],
  FINALIZABLE: ['COMPLETED', 'PAUSED', 'NEEDS_REVIEW'],
  PAUSED: [],
  NEEDS_REVIEW: [],
  COMPLETED: [],
  ABORTED: [],
};
export function assertExecutionTransition(
  execution: {
    status: ExecutionStatus;
    resumeStatus: ExecutionStatus | null;
    applicationStartedAt: string | null;
  },
  next: ExecutionStatus,
  reviewed = false,
) {
  const paused = execution.status === 'PAUSED' || execution.status === 'NEEDS_REVIEW';
  const allowed = paused
    ? (next === 'ABORTED' && execution.applicationStartedAt === null) ||
      (next === execution.resumeStatus && (execution.status !== 'NEEDS_REVIEW' || reviewed))
    : transitions[execution.status].includes(next);
  requireCondition(
    next !== 'ABORTED' || execution.applicationStartedAt === null,
    409,
    'EXECUTION_ABORT_NOT_ALLOWED',
    'Execução aplicada deve ser retomada, não abortada',
  );
  requireCondition(allowed, 409, 'EXECUTION_CONFLICT', 'Transição financeira não permitida');
}
