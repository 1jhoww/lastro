import { unwrap, type ApiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type {
  CancellationInput,
  FinancialExecution,
  FinancialResult,
  ReturnResolutionInput,
} from '@/api/types';
import { intentLedger, outcomeOf, PendingIntentError, withDeadline } from '@/lib/intent';
import { tenantHeader } from '@/session/SessionContext';
import { executionDone } from '@/features/orders/rules';
import { executionResponseSchema } from './resolutionRules';
import { receiptResultSchema } from './rules';

export type ResolutionCommand =
  | { kind: 'cancel-atomic' | 'cancel-start'; id: string; orderId: string; body: CancellationInput }
  | {
      kind: 'return-atomic' | 'return-start';
      id: string;
      orderId: string;
      body: ReturnResolutionInput;
    }
  | {
      kind: 'advance';
      id: string;
      orderId: string;
      body: { expectedRevision: number; fencingToken: number };
    }
  | {
      kind: 'resume' | 'abort';
      id: string;
      orderId: string;
      body: { expectedRevision: number; reason: string };
    };
export const resolutionPermission = (c: ResolutionCommand) =>
  c.kind.startsWith('cancel')
    ? 'financial-cancellation:manage'
    : c.kind.startsWith('return')
      ? 'returns:manage'
      : 'payments:manage';
export const resolutionSensitive = (c: ResolutionCommand) => c.kind !== 'advance';
export const isExecutionCommand = (c: ResolutionCommand) => !c.kind.endsWith('atomic');
export const resolutionLabels: Record<ResolutionCommand['kind'], string> = {
  'cancel-atomic': 'Cancelar financeiramente',
  'cancel-start': 'Iniciar cancelamento retomável',
  'return-atomic': 'Resolver recebido financeiro',
  'return-start': 'Iniciar resolução retomável',
  advance: 'Continuar execução',
  resume: 'Retomar execução com novo fence',
  abort: 'Abortar execução antes da aplicação',
};
export async function getExecution(
  api: ApiClient,
  tenantId: string,
  id: string,
  signal?: AbortSignal,
): Promise<FinancialExecution> {
  const result = await unwrap(
    api.GET('/api/v1/financial-executions/{id}', {
      params: { header: tenantHeader(tenantId), path: { id } },
      signal,
    }),
  );
  if (!executionResponseSchema.safeParse(result).success || result.id !== id)
    throw new ApiError(503, 'REQUEST_OUTCOME_UNKNOWN', 'Estado de execução incompleto');
  return result;
}
const running = new Set<string>();
async function responseOf<T>(
  call: Promise<{ data?: { data: T }; error?: unknown; response: Response }>,
) {
  const response = await call;
  return { result: await unwrap(Promise.resolve(response)), http: response.response.status };
}
export async function sendResolution(
  api: ApiClient,
  tenantId: string,
  scope: string,
  c: ResolutionCommand,
  beforeSend: () => void = () => {},
): Promise<FinancialExecution | FinancialResult> {
  if (scope.split(':')[1] !== tenantId)
    throw new ApiError(403, 'TENANT_ACCESS_DENIED', 'Intenção pertence a outra empresa');
  if (running.has(scope)) throw new PendingIntentError();
  running.add(scope);
  let ambiguous = intentLedger.get(scope)?.unknown ?? false;
  const step = ['advance', 'resume', 'abort'].includes(c.kind);
  try {
    ambiguous = ambiguous || (await intentLedger.persistedPending(scope));
    // Recuperação nunca avança por GET. Mesmo corpo/chave permanece após consulta inconclusiva.
    if (ambiguous) {
      if (step) {
        const official = await getExecution(api, tenantId, c.id);
        if (c.kind === 'resume' && intentLedger.get(scope)?.body.kind === 'advance') {
          if (
            executionDone(official) ||
            official.revision !== c.body.expectedRevision ||
            official.orderId !== c.orderId
          )
            throw new ApiError(409, 'EXECUTION_CONFLICT', 'Atualize execução antes de retomar');
          await intentLedger.preserveAdvanceForResume(scope, c.id);
          ambiguous = false;
        }
      } else {
        await unwrap(
          api.GET('/api/v1/orders/{id}/financial-state', {
            params: { header: tenantHeader(tenantId), path: { id: c.orderId } },
          }),
        );
        await unwrap(
          api.GET('/api/v1/financial-executions', {
            params: {
              header: tenantHeader(tenantId),
              query: { orderId: c.orderId, pending: 'true', limit: '25' },
            },
          }),
        );
      }
    }
    const key = await intentLedger.prepare(scope, c, step ? c.id : null);
    c = intentLedger.get(scope)!.body as ResolutionCommand;
    beforeSend();
    const params = {
      header: { ...tenantHeader(tenantId), 'Idempotency-Key': key },
      path: { id: c.id },
    };
    const { result, http } = await withDeadline(async (signal) => {
      switch (c.kind) {
        case 'cancel-atomic':
          return responseOf(
            api.POST('/api/v1/orders/{id}/financial-cancellation', {
              params,
              body: c.body,
              signal,
            }),
          );
        case 'cancel-start':
          return responseOf(
            api.POST('/api/v1/orders/{id}/financial-cancellation-executions', {
              params,
              body: c.body,
              signal,
            }),
          );
        case 'return-atomic':
          return responseOf(
            api.POST('/api/v1/returns/{id}/resolve', { params, body: c.body, signal }),
          );
        case 'return-start':
          return responseOf(
            api.POST('/api/v1/returns/{id}/resolution-executions', {
              params,
              body: c.body,
              signal,
            }),
          );
        case 'advance':
          return responseOf(
            api.POST('/api/v1/financial-executions/{id}/advance', { params, body: c.body, signal }),
          );
        case 'resume':
          return responseOf(
            api.POST('/api/v1/financial-executions/{id}/resume', { params, body: c.body, signal }),
          );
        case 'abort':
          return responseOf(
            api.POST('/api/v1/financial-executions/{id}/abort', { params, body: c.body, signal }),
          );
      }
    });
    if (
      result.orderId !== c.orderId ||
      (isExecutionCommand(c)
        ? !executionResponseSchema.safeParse(result).success
        : !receiptResultSchema.safeParse(result).success) ||
      (step && (!('id' in result) || result.id !== c.id)) ||
      (c.kind === 'return-start' && (!('returnId' in result) || result.returnId !== c.id)) ||
      (c.kind === 'cancel-start' &&
        (!('kind' in result) || result.kind !== 'cancellation' || result.returnId !== null)) ||
      (c.kind === 'return-atomic' && (!('returnId' in result) || result.returnId !== c.id))
    )
      throw new ApiError(
        503,
        'REQUEST_OUTCOME_UNKNOWN',
        'Resultado divergente; consulte estado oficial',
      );
    if (
      isExecutionCommand(c) && 'financialCompleted' in result
        ? http !== (executionDone(result) ? 200 : 202)
        : http !== 200
    )
      throw new ApiError(503, 'REQUEST_OUTCOME_UNKNOWN', 'HTTP e estado financeiro divergentes');
    if ('financialCompleted' in result && !step && !executionDone(result))
      await intentLedger.accepted(scope, result.id, result.revision, result.fencingToken);
    else await intentLedger.finish(scope);
    // Snapshot idempotente não substitui GET atual. UI consulta novamente e não presume worker.
    return result;
  } catch (error) {
    if (!(error instanceof PendingIntentError)) {
      if (ambiguous || outcomeOf(error).status === 'unknown') intentLedger.markUnknown(scope);
      else await intentLedger.reject(scope);
    }
    throw error;
  } finally {
    running.delete(scope);
  }
}
