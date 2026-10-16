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
 * Consulta da plataforma. Um 403 FORBIDDEN aqui significa, na prática, login antigo: o backend
 * usa o mesmo código para "não é Super Admin" e "reautenticação recente necessária". Como só
 * Super Admins chegam a esta área (pelo /me), tratamos como pedido de senha.
 */
export function usePlatformQuery<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  options: { enabled?: boolean } = {},
) {
  const { requireReauth } = useReauth();
  const query = useQuery({ queryKey, queryFn, retry: false, ...options });
  const forbidden = query.isError && toApiError(query.error).code === 'FORBIDDEN';
  useEffect(() => {
    if (forbidden) requireReauth();
  }, [forbidden, requireReauth]);
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
  const forbidden = query.isError && toApiError(query.error).code === 'FORBIDDEN';
  useEffect(() => {
    if (forbidden) requireReauth();
  }, [forbidden, requireReauth]);
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
      if (toApiError(error).code === 'FORBIDDEN') requireReauth();
    },
  });
}
