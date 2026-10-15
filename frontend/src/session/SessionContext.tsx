import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createApiClient, unwrap, type ApiClient } from '@/api/client';
import { toApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { Me, Membership, Role } from '@/api/types';
import type { AuthGateway, AuthUser } from '@/auth/gateway';
import { kvStorage } from '@/lib/kvStorage';
import { resolveGate, type Gate } from './gate';
import { SessionTransportGuard } from './transportGuard';
import createPublicClient from 'openapi-fetch';
import type { paths } from '@/api/schema';
import { resetPrivateFiles } from '@/features/files/fileEpoch';
import { clearOrphanFiles } from '@/features/files/presentation';

export type { Role };

export type SessionDeps = {
  gateway: AuthGateway;
  apiBaseUrl: string;
  fetch?: typeof globalThis.fetch;
};

/** Aviso exibido na tela de entrada depois de uma saída involuntária. */
export type SessionNotice = 'expired' | null;

export type Session = {
  gate: Gate;
  user: AuthUser | null;
  me: Me | undefined;
  /** Vínculo ativo (empresa escolhida e liberada). */
  membership: Membership | null;
  tenantId: string | null;
  role: Role | null;
  /** Permissões do vínculo ativo, como o backend enviou em /me. Vazio fora de uma empresa. */
  permissions: readonly string[];
  isPlatformAdmin: boolean;
  /** Cliente sem empresa: /me, aceite de convite e rotas da plataforma. */
  api: ApiClient;
  publicApi: ApiClient;
  apiBaseUrl: string;
  /** Cliente preso à empresa ativa; null fora de uma empresa. */
  tenantApi: ApiClient | null;
  /** Cliente para uma empresa específica (ex.: ler o nome de cada empresa na escolha). */
  apiFor: (tenantId: string) => ApiClient;
  gateway: AuthGateway;
  notice: SessionNotice;
  clearNotice: () => void;
  selectTenant: (tenantId: string) => void;
  signOut: () => Promise<void>;
  refetchMe: () => Promise<unknown>;
  /**
   * Token de convite aberto antes do login. Só em memória: sobrevive à navegação entre entrar,
   * criar conta e confirmar e-mail, mas não é gravado em disco.
   */
  pendingInvite: string | null;
  setPendingInvite: (token: string | null) => void;
};

const SessionContext = createContext<Session | null>(null);
const preferenceKey = (uid: string) => `lastro.tenant.${uid}`;

export function SessionProvider({ deps, children }: { deps: SessionDeps; children: ReactNode }) {
  const queryClient = useQueryClient();
  const { gateway } = deps;
  const [auth, setAuth] = useState<{
    status: 'initializing' | 'signedOut' | 'signedIn';
    user: AuthUser | null;
  }>({ status: 'initializing', user: null });
  const [notice, setNotice] = useState<SessionNotice>(null);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ uid: string; tenantId: string | null } | null>(null);
  const lastUid = useRef<string | null>(null);
  const [transportGuard] = useState(() => new SessionTransportGuard());
  const [tenantEpochValue, setTenantEpochValue] = useState(0);
  const publicApi = useMemo(
    () => createPublicClient<paths>({ baseUrl: deps.apiBaseUrl, fetch: deps.fetch }),
    [deps.apiBaseUrl, deps.fetch],
  );
  useEffect(() => {
    resetPrivateFiles();
    try {
      clearOrphanFiles();
    } catch {
      /* Nova tentativa antes da próxima gravação nativa. */
    }
    return resetPrivateFiles;
  }, []);

  // Sessão do provedor. Troca de conta (outro uid) descarta todo o cache da anterior.
  useEffect(
    () =>
      gateway.onChange((user) => {
        if (lastUid.current !== (user?.uid ?? null)) {
          resetPrivateFiles();
          queryClient.clear();
        }
        lastUid.current = user?.uid ?? null;
        transportGuard.changeUser(user?.uid ?? null);
        setAuth({ status: user ? 'signedIn' : 'signedOut', user });
      }),
    [gateway, queryClient, transportGuard],
  );

  const expire = useCallback(() => {
    // Idempotente: várias respostas 401 simultâneas só repetem limpar e sair.
    setNotice('expired');
    resetPrivateFiles();
    queryClient.clear();
    gateway.signOut().catch(() => {});
  }, [gateway, queryClient]);

  const clientFor = useCallback(
    (tenantId: string | null) => {
      return createApiClient({
        baseUrl: deps.apiBaseUrl,
        getIdToken: (force) => gateway.getIdToken(force),
        tenantId,
        onSessionExpired: expire,
        fetch: deps.fetch,
        beforeSend: transportGuard.capture(auth.user?.uid ?? null, tenantId, tenantEpochValue),
      });
    },
    [
      deps.apiBaseUrl,
      deps.fetch,
      gateway,
      expire,
      auth.user?.uid,
      tenantEpochValue,
      transportGuard,
    ],
  );
  const api = useMemo(() => clientFor(null), [clientFor]);

  const uid = auth.user?.uid ?? null;
  const meQuery = useQuery({
    queryKey: queryKeys.me(uid ?? 'anon'),
    queryFn: () => unwrap(api.GET('/api/v1/me')),
    enabled: auth.status === 'signedIn',
  });

  // Última empresa escolhida por esta conta neste aparelho (preferência, não autorização).
  useEffect(() => {
    if (!uid) return;
    let active = true;
    kvStorage.get(preferenceKey(uid)).then((tenantId) => {
      if (active) setSelected({ uid, tenantId });
    });
    return () => {
      active = false;
    };
  }, [uid]);

  const preferenceLoading = auth.status === 'signedIn' && selected?.uid !== uid;
  const gate = resolveGate({
    auth: auth.status,
    me: meQuery.data,
    meFailed: meQuery.isError,
    preferenceLoading,
    selectedTenantId: selected?.uid === uid ? selected.tenantId : null,
  });

  const membership = gate.kind === 'tenant' ? gate.membership : null;
  const tenantId = membership?.tenantId ?? null;
  const tenantApi = useMemo(() => (tenantId ? clientFor(tenantId) : null), [clientFor, tenantId]);

  const selectTenant = useCallback(
    (next: string) => {
      if (!uid) return;
      const current = selected?.uid === uid ? selected.tenantId : null;
      if (current !== next) {
        resetPrivateFiles();
        transportGuard.changeTenant();
        setTenantEpochValue((v) => v + 1);
        // Nada da empresa anterior sobrevive à troca: consultas em andamento são canceladas e
        // todo o cache com prefixo ['tenant'] é removido.
        queryClient.cancelQueries({ queryKey: queryKeys.tenantRoot });
        queryClient.removeQueries({ queryKey: queryKeys.tenantRoot });
      }
      setSelected({ uid, tenantId: next });
      kvStorage.set(preferenceKey(uid), next);
    },
    [queryClient, selected, uid, transportGuard],
  );

  const signOut = useCallback(async () => {
    resetPrivateFiles();
    transportGuard.changeTenant();
    setTenantEpochValue((v) => v + 1);
    if (uid) await kvStorage.remove(preferenceKey(uid));
    setSelected(null);
    queryClient.clear();
    await gateway.signOut();
  }, [gateway, queryClient, uid, transportGuard]);

  // Erros de acesso no meio da sessão (assinatura suspensa, vínculo removido): relê /me para o
  // roteamento levar à tela certa, em vez de deixar cada tela tratar sozinha.
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return;
        if (event.query.queryKey[0] !== 'tenant') return;
        const err = toApiError(event.action.error);
        if (err.kind === 'subscription' || err.code === 'TENANT_ACCESS_DENIED')
          queryClient.invalidateQueries({ queryKey: ['me'] });
      }),
    [queryClient],
  );

  const value = useMemo<Session>(
    () => ({
      gate,
      user: auth.user,
      me: meQuery.data,
      membership,
      tenantId,
      role: membership?.role ?? null,
      permissions: membership?.permissions ?? [],
      isPlatformAdmin: meQuery.data?.platformAdmin ?? false,
      api,
      publicApi,
      apiBaseUrl: deps.apiBaseUrl,
      tenantApi,
      apiFor: clientFor,
      gateway,
      notice,
      clearNotice: () => setNotice(null),
      selectTenant,
      signOut,
      refetchMe: () => meQuery.refetch(),
      pendingInvite,
      setPendingInvite,
    }),
    [
      gate,
      auth.user,
      meQuery,
      membership,
      tenantId,
      api,
      publicApi,
      deps.apiBaseUrl,
      tenantApi,
      clientFor,
      gateway,
      notice,
      selectTenant,
      signOut,
      pendingInvite,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession fora de SessionProvider');
  return ctx;
}

/** Cliente da empresa ativa. Só usar dentro de rotas (app), onde o roteamento garante empresa. */
export function useTenantApi(): {
  api: ApiClient;
  tenantId: string;
  /** Parâmetro de cabeçalho exigido pelo contrato nas rotas da empresa. */
  header: { 'X-Tenant-Id': string };
} {
  const { tenantApi, tenantId } = useSession();
  if (!tenantApi || !tenantId) throw new Error('useTenantApi fora de uma empresa ativa');
  return { api: tenantApi, tenantId, header: tenantHeader(tenantId) };
}

export const tenantHeader = (tenantId: string) => ({ 'X-Tenant-Id': tenantId });

export const roleLabel: Record<Role, string> = {
  administrator: 'Administrador',
  seller: 'Vendedor',
};
