import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type ApiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { FinancialResult, ReceiptInput, ReceivableStatus } from '@/api/types';
import { useCursorList } from '@/features/catalog/useCursorList';
import { intentLedger, outcomeOf, PendingIntentError, withDeadline } from '@/lib/intent';
import { tenantHeader, useSession, useTenantApi } from '@/session/SessionContext';
import { canReadFinance } from './FinanceAccess';
import { applyConfirmedReceipt, refreshAfterFinanceCommand } from './cacheUpdates';
import { OVERVIEW_MAX_PAGES, OVERVIEW_PAGE_SIZE } from './overview';
import { receiptResultSchema } from './rules';

export type ReceivableFilters = {
  status?: ReceivableStatus;
  customerId?: string;
  orderId?: string;
  from?: string;
  to?: string;
};

export function useReceivables(filters: ReceivableFilters, limit = 25) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useCursorList(
    queryKeys.receivables(tenantId, { ...filters, limit }),
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/receivables', {
          params: {
            header,
            query: { ...filters, limit: String(limit), ...(cursor ? { cursor } : {}) },
          },
          signal,
        }),
      ),
    allowed,
  );
}

async function scanPages<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < OVERVIEW_MAX_PAGES; i++) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    if (!page.nextCursor) return { items, complete: true };
    cursor = page.nextCursor;
  }
  return { items, complete: false };
}

/** Leitura integral (limitada) para o painel; indicadores incompletos não são exibidos. */
export function useFinanceOverview() {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useQuery({
    queryKey: [...queryKeys.finance(tenantId), 'overview'],
    enabled: allowed,
    retry: false,
    queryFn: async ({ signal }) => {
      const limit = String(OVERVIEW_PAGE_SIZE);
      const [titles, payments] = await Promise.all([
        scanPages((cursor) =>
          unwrap(
            api.GET('/api/v1/receivables', {
              params: { header, query: { limit, ...(cursor ? { cursor } : {}) } },
              signal,
            }),
          ),
        ),
        scanPages((cursor) =>
          unwrap(
            api.GET('/api/v1/payments', {
              params: { header, query: { limit, ...(cursor ? { cursor } : {}) } },
              signal,
            }),
          ),
        ),
      ]);
      return { titles, payments, fetchedAt: new Date().toISOString() };
    },
  });
}

export function useReceivable(id: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useQuery({
    queryKey: queryKeys.receivable(tenantId, id),
    enabled: allowed && Boolean(id),
    retry: false,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/receivables/{id}', {
          params: { header, path: { id } },
          signal,
        }),
      ),
  });
}

export function useFinancialState(orderId: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useQuery({
    queryKey: queryKeys.orderFinance(tenantId, orderId).concat('state'),
    enabled: allowed && Boolean(orderId),
    retry: false,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/orders/{id}/financial-state', {
          params: { header, path: { id: orderId } },
          signal,
        }),
      ),
  });
}

export function usePayments(orderId: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useCursorList(
    queryKeys.payments(tenantId, orderId),
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/payments', {
          params: { header, query: { orderId, limit: '25', ...(cursor ? { cursor } : {}) } },
          signal,
        }),
      ),
    allowed && Boolean(orderId),
  );
}

export function usePendingExecutions(orderId: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useCursorList(
    [...queryKeys.finance(tenantId), 'pending', orderId],
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/financial-executions', {
          params: {
            header,
            query: { orderId, pending: 'true', limit: '25', ...(cursor ? { cursor } : {}) },
          },
          signal,
        }),
      ),
    allowed && Boolean(orderId),
  );
}

export function useFinancialHistory(orderId: string) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  return useCursorList(
    queryKeys.financialHistory(tenantId, orderId),
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/orders/{id}/financial-history', {
          params: {
            header,
            path: { id: orderId },
            query: { limit: '25', ...(cursor ? { cursor } : {}) },
          },
          signal,
        }),
      ),
    allowed && Boolean(orderId),
  );
}

const inFlight = new Set<string>();

/** Protege contra dois envios simultâneos, inclusive entre instâncias do formulário. */
export async function sendReceipt(
  api: ApiClient,
  tenantId: string,
  orderId: string,
  scope: string,
  body: ReceiptInput,
  beforeSend: () => void = () => {},
) {
  if (scope.split(':')[1] !== tenantId)
    throw new ApiError(403, 'TENANT_ACCESS_DENIED', 'Intenção pertence a outra empresa');
  if (inFlight.has(scope)) throw new PendingIntentError();
  inFlight.add(scope);
  let wasUnknown = intentLedger.get(scope)?.unknown;
  try {
    wasUnknown = wasUnknown || (await intentLedger.persistedPending(scope));
    const key = await intentLedger.prepare(scope, body);
    body = intentLedger.get(scope)!.body as ReceiptInput;
    beforeSend();
    const result = await withDeadline((signal) =>
      unwrap(
        api.POST('/api/v1/orders/{id}/receipts', {
          params: {
            header: { ...tenantHeader(tenantId), 'Idempotency-Key': key },
            path: { id: orderId },
          },
          body,
          signal,
        }),
      ),
    );
    const confirmed = receiptResultSchema.safeParse(result);
    if (
      !confirmed.success ||
      confirmed.data.orderId !== orderId ||
      confirmed.data.amountCents !== body.amountCents
    )
      throw new ApiError(
        503,
        'REQUEST_OUTCOME_UNKNOWN',
        'Resposta financeira incompleta ou divergente',
      );
    await intentLedger.finish(scope);
    return result;
  } catch (error) {
    if (!(error instanceof PendingIntentError)) {
      if (wasUnknown || outcomeOf(error).status === 'unknown') intentLedger.markUnknown(scope);
      else await intentLedger.reject(scope);
    }
    throw error;
  } finally {
    inFlight.delete(scope);
  }
}

export function useReceipt(orderId: string, scope: string) {
  const session = useSession();
  const { api, tenantId } = useTenantApi();
  const cache = useQueryClient();
  const current = useRef(session),
    active = useRef(true);
  useEffect(() => {
    current.current = session;
  }, [session]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return useMutation<FinancialResult, unknown, ReceiptInput>({
    retry: false,
    mutationFn: async (body) => {
      if (!canReadFinance(session) || !session.permissions.includes('payments:manage'))
        throw new ApiError(403, 'FORBIDDEN', 'Sem permissão para registrar recebimento');
      if (intentLedger.get(scope)?.unknown)
        await unwrap(
          api.GET('/api/v1/orders/{id}/financial-state', {
            params: { header: tenantHeader(tenantId), path: { id: orderId } },
          }),
        );
      return sendReceipt(api, tenantId, orderId, scope, body, () => {
        if (
          !active.current ||
          current.current.user?.uid !== session.user?.uid ||
          current.current.tenantId !== tenantId ||
          !canReadFinance(current.current) ||
          !current.current.permissions.includes('payments:manage')
        )
          throw new ApiError(403, 'TENANT_ACCESS_DENIED', 'Sessão mudou antes do recebimento');
      });
    },
    // Saldo novo aparece junto com a confirmação; nada é aplicado antes da resposta da API.
    onSuccess: (result, body) => applyConfirmedReceipt(cache, tenantId, body, result),
    // Sem `return`: a confirmação não espera as consultas de atualização terminarem.
    onSettled: (_result, _error, body) => {
      void refreshAfterFinanceCommand(cache, tenantId, [
        orderId,
        body.customerId,
        ...body.allocations.map((a) => a.receivableId),
      ]);
    },
  });
}
