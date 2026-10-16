import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { Member, Role, UsersPage } from '@/api/types';
import { useSession, useTenantApi } from '@/session/SessionContext';

/**
 * Membros da empresa (GET /users, só administrador). Nome e e-mail vêm da conta de acesso de
 * cada pessoa quando existem; sem eles, a pessoa aparece pelo perfil e um código curto.
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

const roleNoun: Record<Role, string> = { administrator: 'Administrador', seller: 'Vendedor' };

/** Nome legível de um membro: nome, e-mail ou, sem nenhum dos dois, perfil e código curto. */
export function memberLabel(m: Pick<Member, 'id' | 'role' | 'name' | 'email'>): string {
  return m.name || m.email || `${roleNoun[m.role]} ${shortId(m.id)}`;
}

/** Rótulo do responsável por um cliente, do ponto de vista de quem está logado. */
export function useAssigneeLabel() {
  const { user, permissions } = useSession();
  const members = useMembers(permissions.includes('users:manage'));
  return (assignedTo: string | null) => {
    if (assignedTo === null) return 'Sem responsável';
    if (assignedTo === user?.uid) return 'Você';
    const member = members.data?.find((m) => m.id === assignedTo);
    return member ? memberLabel(member) : `Vendedor ${shortId(assignedTo)}`;
  };
}

/**
 * Perfil e situação de um membro. São duas operações do contrato, cada uma com a versão do
 * vínculo; quando as duas mudam, a segunda usa a versão devolvida pela primeira. O servidor
 * recusa tirar o último administrador ativo (LAST_ADMIN_REQUIRED) e estourar o plano.
 */
export function useUpdateMember() {
  const { api, tenantId, header } = useTenantApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      member,
      role,
      status,
    }: {
      member: Member;
      role: Role;
      status: Member['status'];
    }) => {
      let current = member;
      const path = { id: member.id };
      if (role !== current.role) {
        const next = await unwrap(
          api.PATCH('/api/v1/users/{id}/role', {
            params: { header, path },
            body: { role, expectedVersion: current.version },
          }),
        );
        current = { ...current, ...next };
      }
      if (status !== current.status) {
        const next = await unwrap(
          api.PATCH('/api/v1/users/{id}/status', {
            params: { header, path },
            body: { status, expectedVersion: current.version },
          }),
        );
        current = { ...current, ...next };
      }
      // A resposta das alterações não traz nome e e-mail: mantém os da listagem.
      return { ...current, name: member.name, email: member.email };
    },
    // Falha no meio (ex.: perfil salvo, situação recusada): recarrega para mostrar o estado real.
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.users(tenantId) }),
    onSuccess: (updated) => {
      // Atualização localizada na lista paginada; a lista completa (seletores) recarrega depois.
      queryClient.setQueryData<InfiniteData<UsersPage>>(queryKeys.users(tenantId), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                items: p.items.map((m) => (m.id === updated.id ? updated : m)),
              })),
            }
          : data,
      );
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.users(tenantId), 'all'],
      });
    },
  });
}
