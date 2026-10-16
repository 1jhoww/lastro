import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type ApiClient } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type {
  ConditionOption,
  MethodOption,
  Order,
  OrderCreate,
  OrderStatus,
  OrderUpdate,
} from '@/api/types';
import { useCursorList } from '@/features/catalog/useCursorList';
import {
  intentLedger,
  outcomeOf,
  PendingIntentError,
  withDeadline,
  type OrderCommandKind,
} from '@/lib/intent';
import { tenantHeader, useTenantApi, useSession } from '@/session/SessionContext';

/* ---------- Consultas ---------- */

export type OrderFilters = {
  status?: OrderStatus;
  customerId?: string;
  direction: 'desc' | 'asc';
};

/**
 * `GET /orders`. O vendedor recebe só os próprios pedidos com clientes da carteira (o servidor
 * filtra; uma página pode vir com menos itens que o limite e ainda ter cursor).
 */
export function useOrderList(filters: OrderFilters, limit = 25, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList(
    queryKeys.orderList(tenantId, { ...filters, limit }),
    (cursor) =>
      unwrap(
        api.GET('/api/v1/orders', {
          params: {
            header,
            query: {
              limit: String(limit),
              direction: filters.direction,
              ...(filters.status ? { status: filters.status } : {}),
              ...(filters.customerId ? { customerId: filters.customerId } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
    enabled,
  );
}

export function useOrder(id: string | undefined) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.order(tenantId, id ?? ''),
    enabled: Boolean(id),
    queryFn: () =>
      unwrap(api.GET('/api/v1/orders/{id}', { params: { header, path: { id: id! } } })),
  });
}

/** Eventos do pedido em ordem de versão (criado, editado, confirmado...). */
export function useOrderHistory(id: string) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList(queryKeys.orderHistory(tenantId, id), (cursor) =>
    unwrap(
      api.GET('/api/v1/orders/{id}/history', {
        params: { header, path: { id }, query: { limit: '50', ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
}

async function allPages<T>(
  fetch: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const page = await fetch(cursor);
    all.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

/** Condições de pagamento ativas que o pedido pode usar (vendedor e administrador). */
export function useConditionOptions(enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery<ConditionOption[]>({
    queryKey: queryKeys.paymentOptions(tenantId, 'conditions'),
    enabled,
    staleTime: 60_000,
    queryFn: () =>
      allPages((cursor) =>
        unwrap(
          api.GET('/api/v1/orders/payment-options/conditions', {
            params: { header, query: { limit: '100', ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
}

/** Formas de pagamento pretendidas (informativas no pedido). */
export function useMethodOptions(enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery<MethodOption[]>({
    queryKey: queryKeys.paymentOptions(tenantId, 'methods'),
    enabled,
    staleTime: 60_000,
    queryFn: () =>
      allPages((cursor) =>
        unwrap(
          api.GET('/api/v1/orders/payment-options/methods', {
            params: { header, query: { limit: '100', ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
}

/**
 * Estado financeiro do pedido (só administrador com `receivables:read`). Existe a partir da
 * confirmação; rascunhos não têm títulos.
 */
export function useOrderFinance(id: string, enabled: boolean) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.orderFinance(tenantId, id),
    enabled,
    retry: false,
    queryFn: async () => {
      const [state, executions] = await Promise.all([
        unwrap(
          api.GET('/api/v1/orders/{id}/financial-state', { params: { header, path: { id } } }),
        ),
        unwrap(
          api.GET('/api/v1/financial-executions', {
            params: { header, query: { orderId: id, limit: '20' } },
          }),
        ),
      ]);
      return { state, executions: executions.items };
    },
  });
}

/* ---------- Rascunho ---------- */

/** Cache do pedido salvo e listas/painéis que dependem dele. */
function useStoreOrder() {
  const { tenantId } = useTenantApi();
  const session = useSession(),
    latest = useRef(session),
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
  const queryClient = useQueryClient();
  return (order: Order) => {
    if (
      !active.current ||
      latest.current.user?.uid !== session.user?.uid ||
      latest.current.tenantId !== tenantId
    )
      return;
    queryClient.setQueryData(queryKeys.order(tenantId, order.id), order);
    queryClient.invalidateQueries({
      queryKey: queryKeys.orders(tenantId),
      predicate: (q) =>
        q.queryKey[3] === 'list' || (q.queryKey[4] === order.id && q.queryKey[3] !== 'detail'),
    });
  };
}

/**
 * Criação de rascunho. O contrato não tem Idempotency-Key aqui: nunca repetir sozinho. Falha sem
 * resposta é tratada na tela ("pode ter sido criado; confira os rascunhos").
 */
export function useCreateOrder() {
  const { api, header } = useTenantApi();
  const store = useStoreOrder();
  return useMutation({
    mutationFn: (body: OrderCreate) =>
      withDeadline((signal) =>
        unwrap(api.POST('/api/v1/orders', { params: { header }, body, signal })),
      ),
    onSuccess: store,
  });
}

/** Edição de rascunho com `expectedVersion`; em CONFLICT o pedido é recarregado. */
export function useUpdateOrder(id: string) {
  const { api, tenantId, header } = useTenantApi();
  const queryClient = useQueryClient();
  const store = useStoreOrder();
  return useMutation({
    mutationFn: (body: OrderUpdate) =>
      withDeadline((signal) =>
        unwrap(
          api.PATCH('/api/v1/orders/{id}', { params: { header, path: { id } }, body, signal }),
        ),
      ),
    onSuccess: store,
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.order(tenantId, id) }),
  });
}

/* ---------- Confirmar, expedir, cancelar ---------- */

export type OrderCommandInput =
  | {
      kind: 'confirm';
      orderId: string;
      scope: string;
      body: { expectedVersion: number };
    }
  | {
      kind: 'dispatch';
      orderId: string;
      scope: string;
      body: { expectedVersion: number };
    }
  | {
      kind: 'cancel';
      orderId: string;
      scope: string;
      body: { expectedVersion: number; reason: string };
    };

function sendCommand(api: ApiClient, tenantId: string, input: OrderCommandInput, key: string) {
  const params = {
    header: { ...tenantHeader(tenantId), 'Idempotency-Key': key },
    path: { id: input.orderId },
  };
  return withDeadline((signal) =>
    input.kind === 'confirm'
      ? unwrap(api.POST('/api/v1/orders/{id}/confirm', { params, body: input.body, signal }))
      : input.kind === 'dispatch'
        ? unwrap(api.POST('/api/v1/orders/{id}/dispatch', { params, body: input.body, signal }))
        : unwrap(api.POST('/api/v1/orders/{id}/cancel', { params, body: input.body, signal })),
  );
}

/**
 * Transição crítica do pedido, sempre com Idempotency-Key por intenção (`lib/intent`).
 * A reserva (confirmar), a baixa física (expedir) e a liberação (cancelar) são feitas pelo
 * servidor de forma atômica; aqui só se envia o comando e se atualiza o cache com a resposta.
 */
export function useOrderCommand() {
  const { api, tenantId } = useTenantApi();
  const queryClient = useQueryClient();
  const store = useStoreOrder();
  const refreshStock = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory(tenantId) });
  return useMutation<Order, unknown, OrderCommandInput>({
    mutationFn: (input) =>
      sendCommand(api, tenantId, input, intentLedger.keyFor(input.scope, input.body)),
    onSuccess: (order, input) => {
      intentLedger.clear(input.scope);
      store(order);
      refreshStock();
    },
    onError: (error, input) => {
      if (error instanceof PendingIntentError) return;
      if (outcomeOf(error).status === 'unknown') intentLedger.markUnknown(input.scope);
      else intentLedger.markRejected(input.scope);
      // Estado ou versão podem ter mudado (ou o comando pode ter sido aplicado): relê tudo.
      queryClient.invalidateQueries({ queryKey: queryKeys.orders(tenantId) });
      refreshStock();
    },
  });
}

export type { OrderCommandKind };
