import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { useSession } from '@/session/SessionContext';
import { personName } from '@/features/auth/schemas';

/**
 * Primeiro nome para a saudação ("João Henrique" → "João"), preservando acentos e grafia.
 * Null quando o nome não foi informado: nunca usa e-mail ou nome da empresa no lugar.
 */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first && /\p{L}/u.test(first) && !first.includes('@') ? first : null;
}

/** Atualiza o nome da própria pessoa; a resposta de /me substitui o cache da sessão. */
export function useUpdateMyName() {
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(api.PATCH('/api/v1/me', { body: { name: personName.parse(name) } })),
    onSuccess: (me) => {
      if (user) queryClient.setQueryData(queryKeys.me(user.uid), me);
    },
  });
}
