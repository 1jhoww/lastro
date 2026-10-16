import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { Customer, CustomerCreate, CustomerUpdate, StatusFilter } from '@/api/types';
import { listParams, useCursorList } from '@/features/catalog/useCursorList';
import { useTenantApi } from '@/session/SessionContext';

export type CustomerFilters = {
  q: string;
  status: StatusFilter;
  /** Só administrador: UID de vendedor ou 'unassigned'. */
  assignedTo?: string;
  /** CPF/CNPJ normalizado: busca exata, no lugar da busca por nome. */
  document?: string;
};

/**
 * Clientes. O vendedor só recebe a própria carteira: o servidor filtra; o app não amplia nada
 * por filtro. Cliente fora da carteira responde 404, sem confirmar existência.
 */
export function useCustomerList(filters: CustomerFilters) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList(queryKeys.customerList(tenantId, filters), async (cursor) =>
    unwrap(
      api.GET('/api/v1/customers', {
        params: {
          header,
          query: {
            ...listParams(filters),
            ...(filters.assignedTo ? { assignedTo: filters.assignedTo } : {}),
            ...(filters.document ? { document: filters.document } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
}

export function useCustomer(id: string) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.customer(tenantId, id),
    queryFn: () => unwrap(api.GET('/api/v1/customers/{id}', { params: { header, path: { id } } })),
  });
}

function useCustomerCache() {
  const { tenantId } = useTenantApi();
  const queryClient = useQueryClient();
  return (customer: Customer) => {
    queryClient.setQueryData(queryKeys.customer(tenantId, customer.id), customer);
    // Listas dependem de nome/situação/responsável: recarregam na próxima exibição.
    queryClient.invalidateQueries({
      queryKey: [...queryKeys.customers(tenantId), 'list'],
    });
  };
}

/** Conflito de versão em ação direta (sem formulário): recarrega o cadastro para nova decisão. */
function useReloadOnConflict(id: string) {
  const { tenantId } = useTenantApi();
  const queryClient = useQueryClient();
  return (error: unknown) => {
    if (toApiError(error).code === 'CONFLICT')
      queryClient.invalidateQueries({ queryKey: queryKeys.customer(tenantId, id) });
  };
}

/** Criação sem Idempotency-Key no contrato: nunca repetir automaticamente. */
export function useCreateCustomer() {
  const { api, header } = useTenantApi();
  const store = useCustomerCache();
  return useMutation({
    mutationFn: (body: CustomerCreate) =>
      unwrap(api.POST('/api/v1/customers', { params: { header }, body })),
    onSuccess: store,
  });
}

export function useUpdateCustomer(id: string) {
  const { api, header } = useTenantApi();
  const store = useCustomerCache();
  return useMutation({
    mutationFn: (body: CustomerUpdate) =>
      unwrap(api.PATCH('/api/v1/customers/{id}', { params: { header, path: { id } }, body })),
    onSuccess: store,
  });
}

/** Desativação lógica (DELETE com versão). Reativar é PATCH status=active. Só administrador. */
export function useSetCustomerStatus(id: string) {
  const { api, header } = useTenantApi();
  const store = useCustomerCache();
  const reload = useReloadOnConflict(id);
  return useMutation({
    mutationFn: ({ active, expectedVersion }: { active: boolean; expectedVersion: number }) =>
      active
        ? unwrap(
            api.PATCH('/api/v1/customers/{id}', {
              params: { header, path: { id } },
              body: { status: 'active', expectedVersion },
            }),
          )
        : unwrap(
            api.DELETE('/api/v1/customers/{id}', {
              params: { header, path: { id } },
              body: { expectedVersion },
            }),
          ),
    onSuccess: store,
    onError: reload,
  });
}

/** Transferência de carteira. null = sem responsável. Só administrador. */
export function useAssignCustomer(id: string) {
  const { api, header } = useTenantApi();
  const store = useCustomerCache();
  const reload = useReloadOnConflict(id);
  return useMutation({
    mutationFn: ({
      assignedTo,
      expectedVersion,
    }: {
      assignedTo: string | null;
      expectedVersion: number;
    }) =>
      unwrap(
        api.PATCH('/api/v1/customers/{id}/assignment', {
          params: { header, path: { id } },
          body: { assignedTo, expectedVersion },
        }),
      ),
    onSuccess: store,
    onError: reload,
  });
}
