import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type {
  InventoryItem,
  MovementResult,
  MovementType,
  StatusFilter,
  StockAdjustmentBody,
  StockEntryBody,
} from '@/api/types';
import { listParams, useCursorList } from '@/features/catalog/useCursorList';
import { productQuery } from '@/features/products/api';
import { fromApiQuantity } from '@/lib/quantity';
import { useTenantApi } from '@/session/SessionContext';
import {
  criticalRequest,
  intentLedger,
  outcomeOf,
  PendingIntentError,
  withDeadline,
  type MovementKind,
} from '@/lib/intent';

/* ---------- Saldos ---------- */

export type InventoryFilters = {
  stockState?: 'all' | 'low' | 'empty' | 'available' | 'reserved';
  /** Busca por início do nome (exige ordenação por nome crescente no servidor). */
  q: string;
  /** SKU exato; o servidor compara em maiúsculas. */
  sku?: string;
  /** Só administrador; vendedor recebe apenas ativos. */
  status: StatusFilter;
  categoryId?: string;
  order: 'name' | 'recent';
};

/** `GET /inventory`: administrador recebe físico/reservado/disponível; vendedor, só disponível. */
export function useInventoryList(filters: InventoryFilters, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  const searching = filters.q.trim().length > 0;
  return useCursorList(
    queryKeys.inventoryList(tenantId, filters),
    (cursor) =>
      unwrap(
        api.GET('/api/v1/inventory', {
          params: {
            header,
            query: {
              ...listParams(filters),
              ...(filters.stockState ? { stockState: filters.stockState } : {}),
              // Mais recentes só sem busca: o servidor exige name asc com `q`.
              ...(filters.order === 'recent' && !searching
                ? { sort: 'createdAt' as const, direction: 'desc' as const }
                : {}),
              ...(filters.sku ? { sku: filters.sku } : {}),
              ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
    enabled,
  );
}

/** Saldo de um produto. Mesma chave na ficha do produto e na tela de estoque. */
export function useInventoryItem(productId: string | undefined, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.inventoryItem(tenantId, productId ?? ''),
    enabled: enabled && Boolean(productId),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/inventory/{productId}', {
          params: { header, path: { productId: productId! } },
        }),
      ),
  });
}

/* ---------- Histórico ---------- */
export function useInventorySummary(enabled: boolean) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...queryKeys.inventory(tenantId), 'summary'],
    enabled,
    staleTime: 60_000,
    queryFn: () => unwrap(api.GET('/api/v1/inventory/summary', { params: { header } })),
  });
}

export type MovementFilters = {
  productId?: string;
  type?: MovementType;
  /** Instantes ISO UTC, como o servidor exige. */
  from?: string;
  to?: string;
  direction: 'asc' | 'desc';
};

/** `GET /inventory/movements` (só administrador), paginado por cursor. */
export function useMovements(filters: MovementFilters, limit = 25, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList(
    queryKeys.movements(tenantId, { ...filters, limit }),
    (cursor) =>
      unwrap(
        api.GET('/api/v1/inventory/movements', {
          params: {
            header,
            query: {
              limit: String(limit),
              direction: filters.direction,
              ...(filters.productId ? { productId: filters.productId } : {}),
              ...(filters.type ? { type: filters.type } : {}),
              ...(filters.from ? { from: filters.from } : {}),
              ...(filters.to ? { to: filters.to } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
    enabled,
  );
}

/**
 * Nome dos produtos citados no histórico. O histórico traz só o id; o nome vem da ficha, com a
 * mesma chave de cache da tela de produto (nada é buscado duas vezes).
 */
export function useProductNames(ids: string[]) {
  const { api, tenantId } = useTenantApi();
  const unique = [...new Set(ids)];
  const results = useQueries({
    queries: unique.map((id) => ({ ...productQuery(api, tenantId, id), staleTime: 5 * 60_000 })),
  });
  const names = new Map<string, string>();
  results.forEach((r, i) => {
    if (r.data) names.set(unique[i]!, r.data.name);
  });
  return names;
}

/* ---------- Reposição ---------- */

export type ReplenishmentFilters = {
  q: string;
  categoryId?: string;
  status: StatusFilter;
  sort: 'shortfall' | 'name';
};

/** `GET /inventory/replenishment`: só itens com disponível abaixo do mínimo. */
export function useReplenishment(filters: ReplenishmentFilters, limit = 50, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  const q = filters.q.trim();
  // Busca por nome exige name asc; sem busca, "maior necessidade" ordena pela falta, decrescente.
  const order =
    q || filters.sort === 'name'
      ? { sort: 'name' as const, direction: 'asc' as const }
      : { sort: 'shortfall' as const, direction: 'desc' as const };
  return useCursorList(
    queryKeys.replenishment(tenantId, { ...filters, limit }),
    (cursor, signal) =>
      unwrap(
        api.GET('/api/v1/inventory/replenishment', {
          params: {
            header,
            query: {
              limit: String(limit),
              status: filters.status,
              ...order,
              ...(q ? { q: q.slice(0, 80) } : {}),
              ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
          signal,
        }),
      ),
    enabled,
  );
}

/* ---------- Entradas e ajustes ---------- */

/** Prazo das movimentações (o mesmo das demais operações críticas). */
export const movementRequest = criticalRequest;

type MovementInput =
  | { kind: 'entry'; scope: string; body: StockEntryBody }
  | { kind: 'adjustment'; scope: string; body: StockAdjustmentBody };

/**
 * Registra entrada ou ajuste. Nunca repete sozinho; o sucesso só existe quando a API confirma.
 * Depois do sucesso, o saldo devolvido pelo servidor substitui o do cache e listas, histórico e
 * reposição são recarregados.
 */
export function useRecordMovement() {
  const { api, tenantId, header } = useTenantApi();
  const queryClient = useQueryClient();
  return useMutation<MovementResult, unknown, MovementInput>({
    mutationFn: async (input) => {
      const key = intentLedger.keyFor(input.scope, input.body);
      const params = { header: { ...header, 'Idempotency-Key': key } };
      return withDeadline((signal) =>
        input.kind === 'entry'
          ? unwrap(
              api.POST('/api/v1/inventory/entries', {
                params,
                body: input.body,
                signal,
              }),
            )
          : unwrap(
              api.POST('/api/v1/inventory/adjustments', {
                params,
                body: input.body,
                signal,
              }),
            ),
      );
    },
    onSuccess: (result, input) => {
      intentLedger.clear(input.scope);
      queryClient.setQueryData(
        queryKeys.inventoryItem(tenantId, result.stock.productId),
        result.stock,
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory(tenantId),
        predicate: (q) => q.queryKey[3] !== 'item',
      });
    },
    onError: (error, input) => {
      // Nada foi enviado: outra intenção do mesmo produto ainda está pendente.
      if (error instanceof PendingIntentError) return;
      if (outcomeOf(error).status === 'unknown') intentLedger.markUnknown(input.scope);
      else intentLedger.markRejected(input.scope);
      // Versão mudou, saldo insuficiente ou resposta incerta: recarrega o saldo para revisão.
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventoryItem(tenantId, input.body.productId),
      });
    },
  });
}

export type { MovementKind };

/**
 * Disponível (em milésimos) dos produtos informados, a partir do mesmo cache de
 * `GET /inventory/{productId}` usado pelo estoque. Só busca no servidor até `fetchLimit`
 * produtos (evita centenas de chamadas em carrinhos grandes); acima disso usa só o que já está
 * em cache. A disponibilidade final é sempre decidida na confirmação.
 */
export function useAvailability(productIds: readonly string[], fetchLimit = 50) {
  const { api, tenantId, header } = useTenantApi();
  const fetchAll = productIds.length <= fetchLimit;
  const results = useQueries({
    queries: productIds.map((productId) => ({
      queryKey: queryKeys.inventoryItem(tenantId, productId),
      enabled: fetchAll,
      queryFn: () =>
        unwrap(
          api.GET('/api/v1/inventory/{productId}', { params: { header, path: { productId } } }),
        ),
    })),
  });
  const available = new Map<string, number>();
  results.forEach((r, i) => {
    if (r.data) available.set(productIds[i]!, fromApiQuantity(r.data.available));
  });
  return available;
}

/** Guarda saldos vindos de uma lista no cache por produto (sem nova consulta depois). */
export function useSeedInventoryItems() {
  const { tenantId } = useTenantApi();
  const queryClient = useQueryClient();
  return (items: readonly InventoryItem[]) => {
    for (const item of items)
      queryClient.setQueryData(queryKeys.inventoryItem(tenantId, item.productId), item);
  };
}
