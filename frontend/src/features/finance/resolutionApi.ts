import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { FinancialExecution } from '@/api/types';
import { useCursorList } from '@/features/catalog/useCursorList';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { intentLedger } from '@/lib/intent';
import { canManageFinance, canReadFinance } from './FinanceAccess';
import {
  getExecution,
  resolutionPermission,
  resolutionSensitive,
  sendResolution,
  type ResolutionCommand,
} from './resolutionCommands';
import { returnPreviewSchema } from './resolutionRules';

export function useExecutions(filters: {
  pending?: 'true' | 'false';
  status?: FinancialExecution['status'];
  orderId?: string;
}) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useCursorList(
    [...queryKeys.finance(tenantId), 'executions', filters],
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/financial-executions', {
          params: { header, query: { ...filters, limit: '25', ...(cursor ? { cursor } : {}) } },
          signal,
        }),
      ),
    allowed,
  );
}
export function useExecution(id: string) {
  const { api, tenantId } = useTenantApi();
  const session = useSession(),
    allowed = canReadFinance(session);
  return useQuery({
    queryKey: [...queryKeys.finance(tenantId), 'execution', session.user?.uid, id],
    queryFn: async ({ signal }) => {
      const e = await getExecution(api, tenantId, id, signal);
      if (!signal.aborted)
        await intentLedger.observeExecution(
          session.user!.uid,
          tenantId,
          e.id,
          e.revision,
          e.fencingToken,
          e.status,
        );
      return e;
    },
    enabled: allowed && !!id,
  });
}
export function useReturns(orderId?: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useCursorList(
    [...queryKeys.finance(tenantId), 'returns', orderId ?? 'all'],
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/returns', {
          params: {
            header,
            query: { ...(orderId ? { orderId } : {}), limit: '25', ...(cursor ? { cursor } : {}) },
          },
          signal,
        }),
      ),
    allowed,
  );
}
export function useReturn(id: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useQuery({
    queryKey: [...queryKeys.finance(tenantId), 'return', id],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/returns/{id}', { params: { header, path: { id } }, signal })),
    enabled: allowed && !!id,
  });
}
export function useReturnPreview(id: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useQuery({
    queryKey: [...queryKeys.finance(tenantId), 'return-preview', id],
    queryFn: async ({ signal }) => {
      const result = await unwrap(
        api.GET('/api/v1/returns/{id}/resolution-preview', {
          params: { header, path: { id } },
          signal,
        }),
      );
      if (result.returnId !== id || !returnPreviewSchema.safeParse(result).success)
        throw new ApiError(
          503,
          'REQUEST_OUTCOME_UNKNOWN',
          'Preview oficial incompleto ou divergente',
        );
      return result;
    },
    enabled: allowed && !!id,
  });
}
export function useReturnHistory(id: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useCursorList(
    [...queryKeys.finance(tenantId), 'return-history', id],
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/returns/{id}/history', {
          params: { header, path: { id }, query: { limit: '25', ...(cursor ? { cursor } : {}) } },
          signal,
        }),
      ),
    allowed && !!id,
  );
}
export function useResolution(scope: string) {
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
    mutationFn: async (c: ResolutionCommand) => {
      const guard = () => {
        if (
          !active.current ||
          latest.current.user?.uid !== session.user?.uid ||
          latest.current.tenantId !== tenantId ||
          !canManageFinance(latest.current, resolutionPermission(c))
        )
          throw new ApiError(403, 'FORBIDDEN', 'Operação não autorizada nesta sessão/empresa');
      };
      guard();
      if (resolutionSensitive(c)) {
        const time = await session.gateway.authTime(),
          now = Date.now() / 1000;
        if (time === null || now - time >= 270 || time > now + 30)
          throw new ApiError(403, 'REAUTHENTICATION_REQUIRED', 'Confirme senha recente');
      }
      guard();
      return sendResolution(api, tenantId, scope, c, guard);
    },
    onSettled: () => {
      // Inclui estoque, pedidos, fontes, históricos, obrigações e consultas de início.
      cache.invalidateQueries({ queryKey: queryKeys.tenant(tenantId) });
    },
  });
}
