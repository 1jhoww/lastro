import { QueryClient } from '@tanstack/react-query';
import { toApiError, type ErrorKind } from './errors';

const retryable: ErrorKind[] = ['network', 'server', 'rateLimited'];

/**
 * Erros que mudam o acesso (sessão, assinatura, vínculo) são tratados uma vez, no
 * SessionProvider, que observa o cache. Aqui fica só a política de repetição.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Só repete leituras quando a falha é transitória; 4xx não muda com nova tentativa.
        retry: (count, e) => count < 2 && retryable.includes(toApiError(e).kind),
        refetchOnWindowFocus: true,
      },
      mutations: {
        // Nunca repetir escrita às cegas: criações sem Idempotency-Key podem duplicar.
        // Transições idempotentes repetem explicitamente com a MESMA chave (ver lib/idempotency).
        retry: false,
      },
    },
  });
}
