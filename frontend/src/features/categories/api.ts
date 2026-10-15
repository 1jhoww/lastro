import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { Category, CategoryCreate, CategoryUpdate, StatusFilter } from '@/api/types';
import { listParams, useCursorList } from '@/features/catalog/useCursorList';
import { useTenantApi } from '@/session/SessionContext';

export type CategoryFilters = { q: string; status: StatusFilter };

export function useCategoryList(filters: CategoryFilters) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList(queryKeys.categoryList(tenantId, filters), (cursor) =>
    unwrap(
      api.GET('/api/v1/categories', {
        params: { header, query: { ...listParams(filters), ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
}

/**
 * Todas as categorias (ativas e inativas), para seletores e para mostrar o nome da categoria
 * nas listas de produtos. Percorre as páginas até o fim; empresas pequenas têm poucas.
 */
export function useCategoryLookup() {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.categoryLookup(tenantId),
    staleTime: 60_000,
    queryFn: async () => {
      const all: Category[] = [];
      let cursor: string | undefined;
      // Limite de segurança: 20 páginas de 100.
      for (let i = 0; i < 20; i++) {
        const page = await unwrap(
          api.GET('/api/v1/categories', {
            params: {
              header,
              query: { ...listParams({ status: 'all' }, 100), ...(cursor ? { cursor } : {}) },
            },
          }),
        );
        all.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return all;
    },
  });
}

function useCategoryCache() {
  const { tenantId } = useTenantApi();
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.categories(tenantId) });
    // Nome/situação da categoria aparecem nas telas de produto.
    queryClient.invalidateQueries({ queryKey: queryKeys.products(tenantId) });
  };
}

export function useCreateCategory() {
  const { api, header } = useTenantApi();
  const refresh = useCategoryCache();
  return useMutation({
    mutationFn: (body: CategoryCreate) =>
      unwrap(api.POST('/api/v1/categories', { params: { header }, body })),
    onSuccess: refresh,
  });
}

export function useUpdateCategory() {
  const { api, header } = useTenantApi();
  const refresh = useCategoryCache();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CategoryUpdate }) =>
      unwrap(api.PATCH('/api/v1/categories/{id}', { params: { header, path: { id } }, body })),
    onSuccess: refresh,
    // Conflito de versão: atualiza a lista para a pessoa decidir sobre a versão atual.
    onError: refresh,
  });
}

/**
 * Desativar não apaga: produtos já vinculados mantêm a categoria, mas ela deixa de aceitar
 * novos vínculos (INVALID_CATEGORY). Reativar é PATCH status=active.
 */
export function useSetCategoryStatus() {
  const { api, header } = useTenantApi();
  const refresh = useCategoryCache();
  return useMutation({
    mutationFn: ({
      id,
      active,
      expectedVersion,
    }: {
      id: string;
      active: boolean;
      expectedVersion: number;
    }) =>
      active
        ? unwrap(
            api.PATCH('/api/v1/categories/{id}', {
              params: { header, path: { id } },
              body: { status: 'active', expectedVersion },
            }),
          )
        : unwrap(
            api.DELETE('/api/v1/categories/{id}', {
              params: { header, path: { id } },
              body: { expectedVersion },
            }),
          ),
    onSuccess: refresh,
    onError: refresh,
  });
}
