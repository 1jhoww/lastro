import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { useCursorList } from '@/features/catalog/useCursorList';
import { RECENT_AUTH_SECONDS } from '@/features/platform/ReauthGate';
import { intentLedger } from '@/lib/intent';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { refreshAfterFinanceCommand } from './cacheUpdates';
import { canManageFinance, canReadFinance } from './FinanceAccess';
import {
  commandPermission,
  sensitiveCommand,
  sendFinanceCommand,
  type FinanceCommand,
} from './commands';

export type FinanceFilters = { orderId?: string; customerId?: string };
export function useCustomerCredits(customerId: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useCursorList(
    [...queryKeys.finance(tenantId), 'lots', customerId],
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/customers/{id}/credits', {
          params: {
            header,
            path: { id: customerId },
            query: { limit: '25', ...(cursor ? { cursor } : {}) },
          },
          signal,
        }),
      ),
    allowed && Boolean(customerId),
  );
}
export function useCreditApplications(filters: FinanceFilters) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useCursorList(
    [...queryKeys.finance(tenantId), 'applications', filters],
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/credit-applications', {
          params: { header, query: { ...filters, limit: '25', ...(cursor ? { cursor } : {}) } },
          signal,
        }),
      ),
    allowed,
  );
}
export function useRefundObligations(filters: FinanceFilters) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useCursorList(
    [...queryKeys.finance(tenantId), 'refunds', filters],
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/refund-obligations', {
          params: { header, query: { ...filters, limit: '25', ...(cursor ? { cursor } : {}) } },
          signal,
        }),
      ),
    allowed,
  );
}
export function usePaymentRecord(id: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useQuery({
    queryKey: [...queryKeys.finance(tenantId), 'payment', id],
    enabled: allowed && Boolean(id),
    retry: false,
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/payments/{id}', { params: { header, path: { id } }, signal })),
  });
}
export function useCreditApplicationRecord(id: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useQuery({
    queryKey: [...queryKeys.finance(tenantId), 'application', id],
    enabled: allowed && Boolean(id),
    retry: false,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/credit-applications/{id}', { params: { header, path: { id } }, signal }),
      ),
  });
}
export function useRefundRecord(id: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useQuery({
    queryKey: [...queryKeys.finance(tenantId), 'refund', id],
    enabled: allowed && Boolean(id),
    retry: false,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/refund-obligations/{id}', { params: { header, path: { id } }, signal }),
      ),
  });
}
export function useRefundConfirmation(id: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useQuery({
    queryKey: [...queryKeys.finance(tenantId), 'refund-confirmation', id],
    enabled: allowed && Boolean(id),
    retry: false,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/refund-confirmations/{id}', { params: { header, path: { id } }, signal }),
      ),
  });
}
export function usePaymentConditions(status: 'all' | 'active' | 'inactive') {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canManageFinance(useSession(), 'payment-settings:manage');
  return useCursorList(
    [...queryKeys.finance(tenantId), 'conditions', status],
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/payment-conditions', {
          params: { header, query: { status, limit: '25', ...(cursor ? { cursor } : {}) } },
          signal,
        }),
      ),
    allowed,
  );
}
export function usePaymentMethods(status: 'all' | 'active' | 'inactive') {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canManageFinance(useSession(), 'payment-settings:manage');
  return useCursorList(
    [...queryKeys.finance(tenantId), 'methods', status],
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/payment-methods', {
          params: { header, query: { status, limit: '25', ...(cursor ? { cursor } : {}) } },
          signal,
        }),
      ),
    allowed,
  );
}
export function useFinanceCommand(scope: string) {
  const session = useSession();
  const { api, tenantId } = useTenantApi();
  const cache = useQueryClient();
  const active = useRef(true);
  const latestSession = useRef(session);
  useEffect(() => {
    latestSession.current = session;
  }, [session]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return useMutation({
    retry: false,
    mutationFn: async (command: FinanceCommand) => {
      if (!canManageFinance(session, commandPermission(command)))
        throw new ApiError(403, 'FORBIDDEN', 'Operação financeira não autorizada');
      if (sensitiveCommand(command)) {
        const authTime = await session.gateway.authTime();
        if (
          authTime === null ||
          Date.now() / 1000 - authTime >= RECENT_AUTH_SECONDS ||
          authTime > Date.now() / 1000 + 30
        )
          throw new ApiError(
            403,
            'REAUTHENTICATION_REQUIRED',
            'Confirme sua senha antes desta operação',
          );
      }
      if (
        !active.current ||
        latestSession.current.user?.uid !== session.user?.uid ||
        latestSession.current.tenantId !== tenantId ||
        !canManageFinance(latestSession.current, commandPermission(command))
      )
        throw new ApiError(403, 'TENANT_ACCESS_DENIED', 'Sessão ou empresa mudou antes do envio');
      if ('orderId' in command && intentLedger.get(scope)?.unknown)
        await unwrap(
          api.GET('/api/v1/orders/{id}/financial-state', {
            params: { header: { 'X-Tenant-Id': tenantId }, path: { id: command.orderId } },
          }),
        );
      return sendFinanceCommand(api, tenantId, scope, command, () => {
        if (
          !active.current ||
          latestSession.current.user?.uid !== session.user?.uid ||
          latestSession.current.tenantId !== tenantId ||
          !canManageFinance(latestSession.current, commandPermission(command))
        )
          throw new ApiError(
            403,
            'TENANT_ACCESS_DENIED',
            'Sessão mudou durante a gravação da intenção',
          );
      });
    },
    onSettled: (_result, _error, command) => {
      if ('orderId' in command) {
        const body = command.body as {
          customerId?: string;
          allocations?: { receivableId: string }[];
        };
        void refreshAfterFinanceCommand(cache, tenantId, [
          command.orderId,
          command.id,
          body.customerId,
          ...(body.allocations ?? []).map((a) => a.receivableId),
        ]);
        return;
      }
      // Cadastros: listas de condições/formas e opções usadas por pedidos e recebimentos.
      cache.invalidateQueries({ queryKey: [...queryKeys.finance(tenantId), 'conditions'] });
      cache.invalidateQueries({ queryKey: [...queryKeys.finance(tenantId), 'methods'] });
      void cache.invalidateQueries({ queryKey: ['tenant', tenantId, 'payment-options'] });
    },
  });
}
