import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { useTenantApi } from '@/session/SessionContext';

/** Empresa ativa (GET /tenants/current), com cache isolado pelo id da empresa. */
export function useTenant() {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.tenantCurrent(tenantId),
    queryFn: () => unwrap(api.GET('/api/v1/tenants/current', { params: { header } })),
    staleTime: 5 * 60_000,
  });
}
