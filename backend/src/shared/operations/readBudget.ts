import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../errors/appError.js';

interface Budget {
  deadline: number;
  bytes: number;
  maxBytes: number;
  signal?: AbortSignal | undefined;
  policy: ReadPolicy;
}
interface ReadPolicy {
  busyCode: string;
  timeoutCode: string;
  timeoutStatus: number;
}
const defaultPolicy: ReadPolicy = {
  busyCode: 'READ_BUSY',
  timeoutCode: 'READ_TIME_LIMIT',
  timeoutStatus: 503,
};
export const documentPolicy: ReadPolicy = {
  busyCode: 'DOCUMENT_BUSY',
  timeoutCode: 'DOCUMENT_TIME_LIMIT',
  timeoutStatus: 413,
};
export const exportPolicy: ReadPolicy = {
  busyCode: 'EXPORT_BUSY',
  timeoutCode: 'EXPORT_TIME_LIMIT',
  timeoutStatus: 413,
};
const budgets = new AsyncLocalStorage<Budget>();
const requests = new AsyncLocalStorage<AbortSignal>();
export const MAX_READ_BYTES = 32 * 1024 * 1024;
export const READ_OPERATION_MS = 30_000;
export const requestSignal = () => requests.getStore();
export const withRequestSignal = <T>(signal: AbortSignal, work: () => T) =>
  requests.run(signal, work);
export function checkReadBudget() {
  const budget = budgets.getStore();
  if (!budget) return;
  if (budget.signal?.aborted) throw new AppError(503, 'READ_CANCELLED', 'Leitura cancelada');
  if (performance.now() >= budget.deadline)
    throw new AppError(
      budget.policy.timeoutStatus,
      budget.policy.timeoutCode,
      'Leitura excede orçamento técnico; tente novamente',
    );
}
export function accountRead(value: unknown) {
  checkReadBudget();
  const budget = budgets.getStore();
  if (!budget) return;
  // Cumulative serialized bytes with 2x margin. This is an admission budget, not an RSS measurement.
  budget.bytes += Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') * 2;
  if (budget.bytes > budget.maxBytes)
    throw new AppError(
      413,
      'READ_MEMORY_LIMIT',
      'Página excede orçamento técnico; reduza limit e continue pelo cursor',
    );
}
export class ReadGate {
  private active = 0;
  constructor(
    readonly maxConcurrent = 2,
    readonly timeoutMs = READ_OPERATION_MS,
    readonly maxBytes = MAX_READ_BYTES,
  ) {}
  run<T>(work: () => Promise<T>, signal = requestSignal(), policy = defaultPolicy): Promise<T> {
    const parent = budgets.getStore();
    if (parent) {
      checkReadBudget();
      return work();
    }
    if (this.active >= this.maxConcurrent)
      return Promise.reject(new AppError(429, policy.busyCode, 'Leitura ocupada; tente novamente'));
    this.active++;
    const budget: Budget = {
      deadline: performance.now() + this.timeoutMs,
      bytes: 0,
      maxBytes: this.maxBytes,
      signal,
      policy,
    };
    let timer: ReturnType<typeof setTimeout>;
    let cancel: () => void;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AppError(
              policy.timeoutStatus,
              policy.timeoutCode,
              'Leitura excede orçamento técnico; tente novamente',
            ),
          ),
        this.timeoutMs,
      );
      cancel = () => reject(new AppError(503, 'READ_CANCELLED', 'Leitura cancelada'));
      signal?.addEventListener('abort', cancel, { once: true });
    });
    const running = budgets.run(budget, async () => {
      try {
        checkReadBudget();
        const result = await work();
        checkReadBudget();
        return result;
      } finally {
        this.active--;
      }
    });
    // A response deadline never releases the semaphore for an RPC that is still running.
    return Promise.race([running, expiry]).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    });
  }
}
