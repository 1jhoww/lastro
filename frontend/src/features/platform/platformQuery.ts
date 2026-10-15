import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toApiError } from '@/api/errors';
import { useReauth } from './ReauthGate';

/**
 * Consulta da plataforma. Um 403 FORBIDDEN aqui significa, na prática, login antigo: o backend
 * usa o mesmo código para "não é Super Admin" e "reautenticação recente necessária". Como só
 * Super Admins chegam a esta área (pelo /me), tratamos como pedido de senha.
 */
export function usePlatformQuery<T>(queryKey: QueryKey, queryFn: () => Promise<T>) {
  const { requireReauth } = useReauth();
  const query = useQuery({ queryKey, queryFn, retry: false });
  const forbidden = query.isError && toApiError(query.error).code === 'FORBIDDEN';
  useEffect(() => {
    if (forbidden) requireReauth();
  }, [forbidden, requireReauth]);
  return query;
}
