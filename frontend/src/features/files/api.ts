import type { ApiClient } from '@/api/client';
import { ApiError, retryAfterSeconds } from '@/api/errors';
import { readDownload } from './contracts';
export type ExportResource = 'customers' | 'products' | 'orders' | 'receivables';
export async function orderDocument(
  api: ApiClient,
  tenantId: string,
  id: string,
  kind: 'commercial' | 'packing',
  signal?: AbortSignal,
) {
  const params = { header: { 'X-Tenant-Id': tenantId }, path: { id } };
  const result =
    kind === 'commercial'
      ? await api.GET('/api/v1/orders/{id}/documents/commercial.pdf', {
          params,
          parseAs: 'stream',
          cache: 'no-store',
          signal,
        })
      : await api.GET('/api/v1/orders/{id}/documents/packing.pdf', {
          params,
          parseAs: 'stream',
          cache: 'no-store',
          signal,
        });
  // openapi-fetch já consome o JSON de erro; usa o envelope original quando presente.
  if (!result.response.ok && result.error) {
    const body = result.error as { error?: { code: string; message: string; requestId?: string } };
    throw new ApiError(
      result.response.status,
      body.error?.code ?? 'DOWNLOAD_ERROR',
      body.error?.message ?? 'Falha no download',
      body.error?.requestId,
      retryAfterSeconds(result.response),
    );
  }
  return readDownload(result.response, 'application/pdf');
}

type Query<
  P extends
    | '/api/v1/exports/customers.csv'
    | '/api/v1/exports/products.csv'
    | '/api/v1/exports/orders.csv'
    | '/api/v1/exports/receivables.csv',
> = import('@/api/schema').paths[P]['get']['parameters']['query'];
export type ExportRequest =
  | { resource: 'customers'; query: Query<'/api/v1/exports/customers.csv'> }
  | { resource: 'products'; query: Query<'/api/v1/exports/products.csv'> }
  | { resource: 'orders'; query: Query<'/api/v1/exports/orders.csv'> }
  | { resource: 'receivables'; query: Query<'/api/v1/exports/receivables.csv'> };
export async function exportPage(
  api: ApiClient,
  tenantId: string,
  request: ExportRequest,
  signal?: AbortSignal,
) {
  const header = { 'X-Tenant-Id': tenantId };
  const options = { parseAs: 'stream' as const, cache: 'no-store' as const, signal };
  const result =
    request.resource === 'customers'
      ? await api.GET('/api/v1/exports/customers.csv', {
          ...options,
          params: { header, query: request.query },
        })
      : request.resource === 'products'
        ? await api.GET('/api/v1/exports/products.csv', {
            ...options,
            params: { header, query: request.query },
          })
        : request.resource === 'orders'
          ? await api.GET('/api/v1/exports/orders.csv', {
              ...options,
              params: { header, query: request.query },
            })
          : await api.GET('/api/v1/exports/receivables.csv', {
              ...options,
              params: { header, query: request.query },
            });
  if (!result.response.ok && result.error) {
    const body = result.error as { error?: { code: string; message: string; requestId?: string } };
    const wait = result.response.headers.get('Retry-After');
    throw new ApiError(
      result.response.status,
      body.error?.code ?? 'DOWNLOAD_ERROR',
      `${body.error?.message ?? 'Falha no download'}${wait ? ` Aguarde ${wait} segundos.` : ''}`,
      body.error?.requestId,
      retryAfterSeconds(result.response),
    );
  }
  return readDownload(result.response, 'text/csv');
}
