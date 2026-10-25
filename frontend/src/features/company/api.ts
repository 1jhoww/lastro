import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { Tenant } from '@/api/types';
import { blobToDataUri } from '@/lib/blob';
import { prepareImage, type PickedImage } from '@/lib/imageFiles';
import { useTenantApi } from '@/session/SessionContext';

/** Lado maior enviado pelo navegador; o servidor guarda o logotipo com até 1024 px. */
const LOGO_EDGE = 1024;

/**
 * Empresa salva: a resposta do servidor substitui o cache de tenants/current (cabeçalho,
 * configurações, escolha de empresa), sem esperar nova leitura.
 */
function useStoreTenant() {
  const { tenantId } = useTenantApi();
  const queryClient = useQueryClient();
  return (tenant: Tenant) => {
    queryClient.setQueryData(queryKeys.tenantCurrent(tenantId), tenant);
    void queryClient.invalidateQueries({ queryKey: queryKeys.tenantSummary(tenantId) });
  };
}
/** Em conflito de versão, relê a empresa para a próxima tentativa partir do estado atual. */
function useReloadTenant() {
  const { tenantId } = useTenantApi();
  const queryClient = useQueryClient();
  return (error: unknown) => {
    if (error instanceof ApiError && error.kind === 'conflict')
      void queryClient.invalidateQueries({ queryKey: queryKeys.tenantCurrent(tenantId) });
  };
}

export function useRenameCompany() {
  const { api, header } = useTenantApi();
  const store = useStoreTenant();
  const reload = useReloadTenant();
  return useMutation({
    mutationFn: ({ name, expectedVersion }: { name: string; expectedVersion: number }) =>
      unwrap(
        api.PATCH('/api/v1/tenants/current', {
          params: { header },
          body: { name, expectedVersion },
        }),
      ),
    onSuccess: store,
    onError: reload,
  });
}

/** Mesmo fluxo das fotos de produto: PUT com bytes crus e o formato real do arquivo. */
export function useUploadCompanyLogo() {
  const { api, header } = useTenantApi();
  const store = useStoreTenant();
  const reload = useReloadTenant();
  return useMutation({
    mutationFn: async ({
      image,
      expectedVersion,
    }: {
      image: PickedImage;
      expectedVersion: number;
    }) => {
      const { body, type } = await prepareImage(image, LOGO_EDGE);
      return unwrap(
        api.PUT('/api/v1/tenants/current/logo', {
          params: { header, query: { expectedVersion: String(expectedVersion) } },
          body: body as never,
          bodySerializer: (b: unknown) => b as BodyInit,
          headers: { 'Content-Type': type },
        }),
      );
    },
    onSuccess: store,
    onError: reload,
  });
}

export function useRemoveCompanyLogo() {
  const { api, header } = useTenantApi();
  const store = useStoreTenant();
  const reload = useReloadTenant();
  return useMutation({
    mutationFn: (expectedVersion: number) =>
      unwrap(
        api.DELETE('/api/v1/tenants/current/logo', {
          params: { header, query: { expectedVersion: String(expectedVersion) } },
        }),
      ),
    onSuccess: store,
    onError: reload,
  });
}

/**
 * Logotipo privado: bytes buscados com sessão e empresa, nunca por URL pública. Vira data URI só
 * em memória, descartado com o cache da empresa.
 */
export function useCompanyLogo(tenant: Pick<Tenant, 'logo'> | undefined) {
  const { api, tenantId, header } = useTenantApi();
  const logoId = tenant?.logo?.id;
  return useQuery({
    queryKey: queryKeys.tenantLogo(tenantId, logoId ?? ''),
    enabled: Boolean(logoId),
    staleTime: Infinity,
    queryFn: async () => {
      const res = await api.GET('/api/v1/tenants/current/logo', {
        params: { header },
        parseAs: 'blob',
      });
      if (!res.response.ok || !res.data)
        throw new ApiError(res.response.status, 'IMAGE_UNAVAILABLE', 'Logotipo indisponível');
      return blobToDataUri(res.data as Blob);
    },
  });
}
