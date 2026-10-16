import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap, type ApiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type {
  ReturnCreateInput,
  ReturnReceiveInput,
  ReturnCancelInput,
  ReturnUpdateInput,
} from '@/api/types';
import { intentLedger, outcomeOf, PendingIntentError, withDeadline } from '@/lib/intent';
import { tenantHeader, useSession, useTenantApi } from '@/session/SessionContext';
import { receiptResultSchema } from '@/features/finance/rules';

export type ReturnCommand =
  | { kind: 'create'; id: string; orderId: string; body: ReturnCreateInput }
  | { kind: 'receive'; id: string; orderId: string; body: ReturnReceiveInput }
  | { kind: 'cancel'; id: string; orderId: string; body: ReturnCancelInput }
  | { kind: 'edit'; id: string; orderId: string; body: ReturnUpdateInput };

const running = new Set<string>();
/** Persiste corpo e chave antes do envio. Resposta ambígua nunca libera uma nova intenção. */
export async function sendReturn(
  api: ApiClient,
  tenantId: string,
  scope: string,
  command: ReturnCommand,
  beforeSend = () => {},
) {
  if (scope.split(':')[1] !== tenantId || !scope.endsWith(`:return-command:${command.orderId}`))
    throw new ApiError(403, 'FORBIDDEN', 'Escopo de devolução divergente');
  if (running.has(scope)) throw new PendingIntentError();
  running.add(scope);
  let ambiguous = intentLedger.get(scope)?.unknown ?? false;
  try {
    ambiguous ||= await intentLedger.persistedPending(scope);
    const key = await intentLedger.prepare(scope, command);
    beforeSend();
    const params = {
      header: { ...tenantHeader(tenantId), 'Idempotency-Key': key },
      path: { id: command.id },
    };
    const result = await withDeadline((signal) => {
      switch (command.kind) {
        case 'create':
          return unwrap(
            api.POST('/api/v1/orders/{id}/returns', { params, body: command.body, signal }),
          );
        case 'receive':
          return unwrap(
            api.POST('/api/v1/returns/{id}/receipts', { params, body: command.body, signal }),
          );
        case 'cancel':
          return unwrap(
            api.POST('/api/v1/returns/{id}/cancel-pending', { params, body: command.body, signal }),
          );
        case 'edit':
          return unwrap(api.PATCH('/api/v1/returns/{id}', { params, body: command.body, signal }));
      }
    });
    if (
      !receiptResultSchema.safeParse(result).success ||
      result.orderId !== command.orderId ||
      !result.returnId ||
      !Number.isSafeInteger(result.returnVersion) ||
      result.returnVersion < 1 ||
      !['pending', 'partially_received', 'received', 'closed'].includes(result.status) ||
      (command.kind !== 'create' && result.returnId !== command.id)
    )
      throw new ApiError(503, 'REQUEST_OUTCOME_UNKNOWN', 'Resultado de devolução divergente');
    await intentLedger.finish(scope);
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

export function useReturnCommand(scope: string) {
  const session = useSession();
  const { api, tenantId } = useTenantApi();
  const cache = useQueryClient();
  const latest = useRef(session),
    active = useRef(true);
  useEffect(() => {
    latest.current = session;
  }, [session]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return useMutation({
    retry: false,
    mutationFn: (command: ReturnCommand) => {
      const guard = () => {
        if (
          !active.current ||
          latest.current.user?.uid !== session.user?.uid ||
          latest.current.tenantId !== tenantId ||
          !latest.current.permissions.includes('returns:manage')
        )
          throw new ApiError(403, 'FORBIDDEN', 'Sessão sem autorização para devoluções');
      };
      guard();
      return sendReturn(api, tenantId, scope, command, guard);
    },
    onSettled: async (_data, _error, command) => {
      // Revalida só o pedido e suas devoluções. Estoque invisível fica apenas marcado como antigo.
      await Promise.all([
        cache.invalidateQueries({
          queryKey: queryKeys.order(tenantId, command.orderId),
          exact: true,
        }),
        cache.invalidateQueries({ queryKey: queryKeys.orderFinance(tenantId, command.orderId) }),
        cache.invalidateQueries({ queryKey: queryKeys.inventory(tenantId), refetchType: 'none' }),
        cache.invalidateQueries({
          queryKey: queryKeys.finance(tenantId),
          predicate: (q) =>
            ['returns', 'return', 'return-history', 'return-preview'].includes(
              String(q.queryKey[3]),
            ) && [command.orderId, command.id, 'all'].includes(String(q.queryKey[4])),
        }),
      ]);
    },
  });
}
