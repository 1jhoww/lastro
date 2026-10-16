import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, toApiError } from '@/api/errors';
import { unwrap, type ApiClient } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { Product, ProductCreate, ProductUpdate, StatusFilter } from '@/api/types';
import { listParams, useCursorList } from '@/features/catalog/useCursorList';
import { tenantHeader, useTenantApi } from '@/session/SessionContext';
import { blobToDataUri } from '@/lib/blob';

export type ProductFilters = {
  q: string;
  status: StatusFilter;
  categoryId?: string;
  catalogVisible?: 'true' | 'false';
};

/** Vendedor recebe só produtos ativos: o servidor ignora outros status para ele. */
export function useProductList(filters: ProductFilters) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList(queryKeys.productList(tenantId, filters), (cursor) =>
    unwrap(
      api.GET('/api/v1/products', {
        params: {
          header,
          query: {
            ...listParams(filters),
            ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
            ...(filters.catalogVisible ? { catalogVisible: filters.catalogVisible } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
}

/** Consulta da ficha; reutilizada onde só o nome é preciso (histórico de estoque). */
export function productQuery(api: ApiClient, tenantId: string, id: string) {
  const header = tenantHeader(tenantId);
  return {
    queryKey: queryKeys.product(tenantId, id),
    queryFn: () => unwrap(api.GET('/api/v1/products/{id}', { params: { header, path: { id } } })),
  };
}

export function useProduct(id: string) {
  const { api, tenantId } = useTenantApi();
  return useQuery(productQuery(api, tenantId, id));
}

function useProductCache() {
  const { tenantId } = useTenantApi();
  const queryClient = useQueryClient();
  return (product: Product) => {
    queryClient.setQueryData(queryKeys.product(tenantId, product.id), product);
    queryClient.invalidateQueries({ queryKey: [...queryKeys.products(tenantId), 'list'] });
  };
}

/** Conflito de versão em ação direta: recarrega o produto para nova decisão. */
function useReloadOnConflict(id: string) {
  const { tenantId } = useTenantApi();
  const queryClient = useQueryClient();
  return (error: unknown) => {
    if (toApiError(error).code === 'CONFLICT')
      queryClient.invalidateQueries({ queryKey: queryKeys.product(tenantId, id) });
  };
}

/** Criação sem Idempotency-Key no contrato; SKU duplicado volta DUPLICATE_SKU. */
export function useCreateProduct() {
  const { api, header } = useTenantApi();
  const store = useProductCache();
  return useMutation({
    mutationFn: (body: ProductCreate) =>
      unwrap(api.POST('/api/v1/products', { params: { header }, body })),
    onSuccess: store,
  });
}

export function useUpdateProduct(id: string) {
  const { api, header } = useTenantApi();
  const store = useProductCache();
  return useMutation({
    mutationFn: (body: ProductUpdate) =>
      unwrap(api.PATCH('/api/v1/products/{id}', { params: { header, path: { id } }, body })),
    onSuccess: store,
  });
}

export function useSetProductStatus(id: string) {
  const { api, header } = useTenantApi();
  const store = useProductCache();
  const reload = useReloadOnConflict(id);
  return useMutation({
    mutationFn: ({ active, expectedVersion }: { active: boolean; expectedVersion: number }) =>
      active
        ? unwrap(
            api.PATCH('/api/v1/products/{id}', {
              params: { header, path: { id } },
              body: { status: 'active', expectedVersion },
            }),
          )
        : unwrap(
            api.DELETE('/api/v1/products/{id}', {
              params: { header, path: { id } },
              body: { expectedVersion },
            }),
          ),
    onSuccess: store,
    onError: reload,
  });
}

/* ---------- Imagem ---------- */

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export type PickedImage = { uri: string; type: ImageType; sizeBytes?: number };

/**
 * Upload pelo único fluxo do contrato: PUT com os bytes crus e o Content-Type da imagem
 * (sem multipart, URL ou SVG). O backend valida, converte para WebP e grava no Storage da
 * empresa; a resposta é o produto com a nova versão. Usado pelo hook abaixo e pelo cadastro,
 * logo depois de criar o produto.
 */
export async function uploadProductImage(
  api: ApiClient,
  tenantId: string,
  id: string,
  image: PickedImage,
  expectedVersion: number,
): Promise<Product> {
  if (image.sizeBytes !== undefined && image.sizeBytes > IMAGE_MAX_BYTES)
    throw new ApiError(422, 'INVALID_IMAGE', 'Imagem acima de 5 MB');
  let bytes: Blob;
  try {
    bytes = await (await fetch(image.uri)).blob();
  } catch (e) {
    throw toApiError(e);
  }
  if (bytes.size > IMAGE_MAX_BYTES)
    throw new ApiError(422, 'INVALID_IMAGE', 'Imagem acima de 5 MB');
  return unwrap(
    api.PUT('/api/v1/products/{id}/image', {
      params: {
        header: tenantHeader(tenantId),
        path: { id },
        query: { expectedVersion: String(expectedVersion) },
      },
      body: bytes as never,
      bodySerializer: (b: unknown) => b as BodyInit,
      headers: { 'Content-Type': image.type },
    }),
  );
}

export function useUploadProductImage(id: string) {
  const { api, tenantId } = useTenantApi();
  const store = useProductCache();
  const reload = useReloadOnConflict(id);
  return useMutation({
    mutationFn: ({ image, expectedVersion }: { image: PickedImage; expectedVersion: number }) =>
      uploadProductImage(api, tenantId, id, image, expectedVersion),
    onSuccess: store,
    onError: reload,
  });
}

/** Grava o produto devolvido por uma operação feita fora dos hooks (ex.: imagem no cadastro). */
export function useStoreProduct() {
  return useProductCache();
}

export function useRemoveProductImage(id: string) {
  const { api, header } = useTenantApi();
  const store = useProductCache();
  const reload = useReloadOnConflict(id);
  return useMutation({
    mutationFn: (expectedVersion: number) =>
      unwrap(
        api.DELETE('/api/v1/products/{id}/image', {
          params: { header, path: { id }, query: { expectedVersion: String(expectedVersion) } },
        }),
      ),
    onSuccess: store,
    onError: reload,
  });
}

/**
 * Imagem privada: bytes WebP buscados com Bearer e empresa, nunca por URL pública. Vira um
 * data URI só em memória (cache do Query), descartado com o cache da empresa.
 */
export function useProductImage(product: Pick<Product, 'id' | 'image'> | undefined) {
  const { api, tenantId, header } = useTenantApi();
  const imageId = product?.image?.id;
  return useQuery({
    queryKey: queryKeys.productImage(tenantId, product?.id ?? '', imageId ?? ''),
    enabled: Boolean(product && imageId),
    staleTime: Infinity,
    queryFn: async () => {
      const res = await api.GET('/api/v1/products/{id}/image', {
        params: { header, path: { id: product!.id } },
        parseAs: 'blob',
      });
      if (!res.response.ok || !res.data)
        throw new ApiError(res.response.status, 'IMAGE_UNAVAILABLE', 'Imagem indisponível');
      return blobToDataUri(res.data as Blob);
    },
  });
}

const skuPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Busca exata por SKU, ao lado da busca por início do nome (o contrato tem as duas, mas não
 * combinadas). Só consulta quando o texto tem forma de SKU; devolve no máximo um produto.
 */
export function useProductSkuMatch(filters: ProductFilters) {
  const { api, tenantId, header } = useTenantApi();
  const sku = filters.q.trim();
  const enabled = skuPattern.test(sku);
  return useQuery({
    queryKey: queryKeys.productList(tenantId, { ...filters, q: '', sku: sku.toUpperCase() }),
    enabled,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/products', {
          params: {
            header,
            query: {
              ...listParams({ status: filters.status }, 1),
              sku,
              ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
              ...(filters.catalogVisible ? { catalogVisible: filters.catalogVisible } : {}),
            },
          },
          signal,
        }),
      ).then((page) => page.items),
    select: (items) => (enabled ? items : []),
  });
}
