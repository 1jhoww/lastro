import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type {
  DeliveryInput,
  RepurchasePage,
  RepurchaseStatus,
  VisitCreate,
  VisitSource,
} from '@/api/types';
import { useCursorList } from '@/features/catalog/useCursorList';
import { useIntentKey } from '@/lib/idempotency';
import { useTenantApi } from '@/session/SessionContext';

export type VisitFilters = {
  customerId?: string;
  responsibleUid?: string;
  source?: VisitSource;
  from?: string;
  to?: string;
};

/**
 * `GET /visits`, mais recentes primeiro. O vendedor recebe só clientes da carteira atual (o
 * servidor filtra; uma página pode vir com menos itens e ainda ter cursor).
 */
export function useVisitList(filters: VisitFilters, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList(
    queryKeys.visitList(tenantId, filters),
    (cursor) =>
      unwrap(
        api.GET('/api/v1/visits', {
          params: {
            header,
            query: {
              limit: '25',
              ...Object.fromEntries(Object.entries(filters).filter(([, v]) => Boolean(v))),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
    enabled,
  );
}

export type RepurchaseFilters = {
  status?: RepurchaseStatus;
  /** Só administrador: UID do vendedor ou 'unassigned'. */
  sellerUid?: string;
  q?: string;
};

/** Oportunidades de recompra calculadas no servidor a partir dos pedidos confirmados. */
export function useRepurchaseList(filters: RepurchaseFilters) {
  const { api, tenantId, header } = useTenantApi();
  const list = useCursorList(queryKeys.repurchase(tenantId, filters), (cursor) =>
    unwrap(
      api.GET('/api/v1/repurchase', {
        params: {
          header,
          query: {
            limit: '50',
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.sellerUid ? { sellerUid: filters.sellerUid } : {}),
            ...(filters.q?.trim() ? { q: filters.q.trim().slice(0, 80) } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
  // Totais e parâmetros do cálculo vêm na primeira página (mesmos em todas).
  const first = list.query.data?.pages[0] as RepurchasePage | undefined;
  return { ...list, totals: first?.totals, meta: first };
}

export function useCustomerRepurchase(customerId: string, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.customerRepurchase(tenantId, customerId),
    enabled,
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/customers/{id}/repurchase', {
          params: { header, path: { id: customerId } },
        }),
      ),
  });
}

export function useCustomerTimeline(customerId: string, limit: number, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.customerTimeline(tenantId, customerId, limit),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/customers/{id}/timeline', {
          params: { header, path: { id: customerId }, query: { limit: String(limit) } },
        }),
      ),
  });
}

/**
 * Registro manual. A Idempotency-Key acompanha a intenção: repetir depois de falha de rede usa a
 * mesma chave (o servidor devolve o mesmo registro); mudar o conteúdo pede `resetKey()`.
 */
export function useCreateVisit() {
  const { api, tenantId, header } = useTenantApi();
  const queryClient = useQueryClient();
  const intent = useIntentKey();
  const mutation = useMutation({
    mutationFn: (body: VisitCreate) =>
      unwrap(
        api.POST('/api/v1/visits', {
          params: { header: { ...header, 'Idempotency-Key': intent.current() } },
          body,
        }),
      ),
    onSuccess: () => {
      intent.reset();
      queryClient.invalidateQueries({ queryKey: queryKeys.visits(tenantId) });
    },
  });
  return { ...mutation, resetKey: intent.reset };
}

export function useOrderDelivery(orderId: string, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.orderDelivery(tenantId, orderId),
    enabled,
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/orders/{id}/delivery', { params: { header, path: { id: orderId } } }),
      ),
  });
}

/**
 * Confirmação de entrega. Uma por pedido: repetir com os mesmos dados devolve a mesma entrega,
 * então tentar de novo após falha de rede é seguro.
 */
export function useConfirmDelivery(orderId: string) {
  const { api, tenantId, header } = useTenantApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DeliveryInput) =>
      unwrap(
        api.POST('/api/v1/orders/{id}/delivery', {
          params: { header, path: { id: orderId } },
          body,
        }),
      ),
    onSuccess: (delivery) => {
      queryClient.setQueryData(queryKeys.orderDelivery(tenantId, orderId), { delivery });
      queryClient.invalidateQueries({ queryKey: queryKeys.visits(tenantId) });
    },
    onError: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.orderDelivery(tenantId, orderId) }),
  });
}
