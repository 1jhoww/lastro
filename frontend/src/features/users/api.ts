import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { Member } from '@/api/types';
import { useSession, useTenantApi } from '@/session/SessionContext';

/**
 * Membros da empresa (GET /users, só administrador). O contrato não traz nome nem e-mail de
 * cada membro, apenas id, perfil e situação; por isso vendedores aparecem por um código curto.
 */
export function useMembers(enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...queryKeys.users(tenantId), 'all'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const all: Member[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await unwrap(
          api.GET('/api/v1/users', {
            params: { header, query: { limit: '100', ...(cursor ? { cursor } : {}) } },
          }),
        );
        all.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return all;
    },
  });
}

export const shortId = (uid: string) => uid.slice(0, 6).toUpperCase();

/** Rótulo do responsável por um cliente, do ponto de vista de quem está logado. */
export function useAssigneeLabel() {
  const { user } = useSession();
  return (assignedTo: string | null) =>
    assignedTo === null
      ? 'Sem responsável'
      : assignedTo === user?.uid
        ? 'Você'
        : `Vendedor ${shortId(assignedTo)}`;
}
