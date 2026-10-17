import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ApiClient } from '@/api/client';
import { unwrap } from '@/api/client';
import { ApiError, retryAfterSeconds } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { ReportId, ReportQuery } from '@/api/types';
import { readDownload } from '@/features/files/contracts';
import { useTenantApi } from '@/session/SessionContext';

/** Relatório completo calculado no servidor para a empresa ativa. */
export function useReport(id: ReportId, query: ReportQuery, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: queryKeys.report(tenantId, id, query),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: (count, error) =>
      count < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/reports/{report}', {
          params: { header, path: { report: id }, query },
          signal,
        }),
      ),
  });
}

/** Arquivo com todas as linhas do relatório e os mesmos filtros da tela. */
export async function reportFile(
  api: ApiClient,
  tenantId: string,
  id: ReportId,
  query: ReportQuery,
  format: 'csv' | 'pdf',
  signal?: AbortSignal,
) {
  const params = { header: { 'X-Tenant-Id': tenantId }, path: { report: id }, query };
  const options = { params, parseAs: 'stream' as const, cache: 'no-store' as const, signal };
  const result =
    format === 'csv'
      ? await api.GET('/api/v1/reports/{report}/export.csv', options)
      : await api.GET('/api/v1/reports/{report}/export.pdf', options);
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
  return readDownload(result.response, format === 'csv' ? 'text/csv' : 'application/pdf', {
    maxBytes: 8 * 1024 * 1024,
    maxRows: null,
  });
}
