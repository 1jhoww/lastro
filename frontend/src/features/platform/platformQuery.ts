import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { toApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { useReauth } from './ReauthGate';

/**
 * Consulta da plataforma. Só REAUTHENTICATION_REQUIRED (login antigo) pede a senha de novo;
 * FORBIDDEN e as demais recusas aparecem com a própria mensagem.
 */
export function usePlatformQuery<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  options: { enabled?: boolean } = {},
) {
  const { requireReauth } = useReauth();
  const query = useQuery({ queryKey, queryFn, retry: false, ...options });
  const stale = query.isError && toApiError(query.error).code === 'REAUTHENTICATION_REQUIRED';
  useEffect(() => {
    if (stale) requireReauth();
  }, [stale, requireReauth]);
  return query;
}

/** Lista paginada por cursor da plataforma, com o mesmo tratamento de login antigo. */
export function usePlatformInfiniteQuery<T extends { nextCursor: string | null }>(
  queryKey: QueryKey,
  queryFn: (cursor: string | undefined) => Promise<T>,
) {
  const { requireReauth } = useReauth();
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => queryFn(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const stale = query.isError && toApiError(query.error).code === 'REAUTHENTICATION_REQUIRED';
  useEffect(() => {
    if (stale) requireReauth();
  }, [stale, requireReauth]);
  return query;
}

/**
 * Comando administrativo. Depois do sucesso, todo o cache da plataforma é renovado: indicadores,
 * listas e detalhes dependem uns dos outros. Login antigo pede a senha sem perder a tela.
 */
export function usePlatformMutation<V, T>(
  mutationFn: (variables: V) => Promise<T>,
  options: { onSuccess?: (data: T) => void } = {},
) {
  const { requireReauth } = useReauth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      options.onSuccess?.(data);
      // Prévias de troca de plano valem só para o estado anterior: descartadas, nunca refeitas
      // contra o contrato já alterado.
      queryClient.removeQueries({
        queryKey: queryKeys.platformRoot,
        predicate: (query) => query.queryKey.includes('plan-change'),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.platformRoot });
    },
    onError: (error) => {
      // Only a stale login asks for the password; any other refusal shows its own message.
      if (toApiError(error).code === 'REAUTHENTICATION_REQUIRED') requireReauth();
    },
  });
}
