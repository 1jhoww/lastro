import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { BonusCreate, BonusKind, BonusReturnInput } from '@/api/types';
import { useCursorList } from '@/features/catalog/useCursorList';
import { useIntentKey } from '@/lib/idempotency';
import { useTenantApi } from '@/session/SessionContext';

export type BonusFilters = { kind?: BonusKind; customerId?: string; from?: string; to?: string };

/** Histórico. O vendedor recebe só as próprias, de clientes da carteira (o servidor filtra). */
export function useBonusList(filters: BonusFilters, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList(
    queryKeys.bonusList(tenantId, filters),
    (cursor) =>
      unwrap(
        api.GET('/api/v1/bonuses', {
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

export function useBonus(id: string | undefined) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.bonus(tenantId, id ?? ''),
    enabled: Boolean(id),
    queryFn: () =>
      unwrap(api.GET('/api/v1/bonuses/{id}', { params: { header, path: { id: id! } } })),
  });
}

/**
 * Lançamento avulso. A chave acompanha a intenção: repetir depois de falha de rede devolve o mesmo
 * lançamento e não baixa o estoque de novo; mudar o conteúdo pede `resetKey()`.
 */
export function useCreateBonus() {
  const { api, tenantId, header } = useTenantApi();
  const queryClient = useQueryClient();
  const intent = useIntentKey();
  const mutation = useMutation({
    mutationFn: (body: BonusCreate) =>
      unwrap(
        api.POST('/api/v1/bonuses', {
          params: { header: { ...header, 'Idempotency-Key': intent.current() } },
          body,
        }),
      ),
    onSuccess: () => {
      intent.reset();
      queryClient.invalidateQueries({ queryKey: queryKeys.bonuses(tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory(tenantId) });
    },
  });
  return { ...mutation, resetKey: intent.reset };
}

export function useReturnBonus(id: string) {
  const { api, tenantId, header } = useTenantApi();
  const queryClient = useQueryClient();
  const intent = useIntentKey();
  const mutation = useMutation({
    mutationFn: (body: BonusReturnInput) =>
      unwrap(
        api.POST('/api/v1/bonuses/{id}/returns', {
          params: { header: { ...header, 'Idempotency-Key': intent.current() }, path: { id } },
          body,
        }),
      ),
    onSuccess: () => {
      intent.reset();
      queryClient.invalidateQueries({ queryKey: queryKeys.bonuses(tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory(tenantId) });
    },
  });
  return { ...mutation, resetKey: intent.reset };
}
