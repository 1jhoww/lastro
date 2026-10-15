import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { SessionProvider, useSession, type Session } from '@/session/SessionContext';
import { createFakeApi, fail, membership, ok } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { testQueryClient } from '../support/testQueryClient';

const ana = {
  uid: 'u1',
  email: 'ana@lastro.test',
  password: 'senha-de-teste',
  emailVerified: true,
};

function setup(memberships: ReturnType<typeof membership>[], opts: { signedIn?: boolean } = {}) {
  const gateway = new FakeGateway({
    accounts: [ana],
    initialUser:
      opts.signedIn === false ? null : { uid: ana.uid, email: ana.email, emailVerified: true },
  });
  const server = createFakeApi();
  let meMemberships = memberships;
  server.on('GET', '/api/v1/me', () =>
    ok({ uid: 'u1', email: ana.email, platformAdmin: false, memberships: meMemberships }),
  );
  const queryClient: QueryClient = testQueryClient();
  const ref: { current: Session | null } = { current: null };
  function Probe() {
    ref.current = useSession();
    return null;
  }
  const ui = (
    <QueryClientProvider client={queryClient}>
      <SessionProvider deps={{ gateway, apiBaseUrl: 'http://api.test', fetch: server.fetch }}>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>
  );
  return {
    gateway,
    server,
    queryClient,
    session: () => ref.current!,
    setMemberships: (m: ReturnType<typeof membership>[]) => {
      meMemberships = m;
    },
    ui,
  };
}

describe('sessão', () => {
  it('login válido carrega /me e entra na única empresa', async () => {
    const t = setup([membership('t1')], { signedIn: false });
    await render(t.ui);
    await waitFor(() => expect(t.session().gate.kind).toBe('signedOut'));
    await act(async () => {
      await t.gateway.signIn(ana.email, ana.password);
    });
    await waitFor(() => expect(t.session().gate.kind).toBe('tenant'));
    expect(t.session().tenantId).toBe('t1');
    expect(t.session().permissions).toContain('users:manage');
  });

  it('login inválido mantém a sessão fechada', async () => {
    const t = setup([membership('t1')], { signedIn: false });
    await render(t.ui);
    await expect(t.gateway.signIn(ana.email, 'errada')).rejects.toMatchObject({
      code: 'auth/invalid-credential',
    });
    expect(t.session().gate.kind).toBe('signedOut');
  });

  it('logout limpa todo o cache', async () => {
    const t = setup([membership('t1')]);
    await render(t.ui);
    await waitFor(() => expect(t.session().gate.kind).toBe('tenant'));
    t.queryClient.setQueryData(['tenant', 't1', 'customers'], ['cliente sigiloso']);
    await act(async () => {
      await t.session().signOut();
    });
    await waitFor(() => expect(t.session().gate.kind).toBe('signedOut'));
    // Nada com dados sobrevive; só a consulta /me desativada da sessão anônima.
    expect(
      t.queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.state.data !== undefined),
    ).toEqual([]);
  });

  it('trocar de empresa remove os dados da empresa anterior', async () => {
    const t = setup([membership('t1'), membership('t2', 'seller')]);
    await render(t.ui);
    await waitFor(() => expect(t.session().gate.kind).toBe('chooseTenant'));
    await act(async () => t.session().selectTenant('t1'));
    await waitFor(() => expect(t.session().tenantId).toBe('t1'));
    t.queryClient.setQueryData(['tenant', 't1', 'customers'], ['cliente da t1']);

    await act(async () => t.session().selectTenant('t2'));
    await waitFor(() => expect(t.session().tenantId).toBe('t2'));
    expect(t.queryClient.getQueryData(['tenant', 't1', 'customers'])).toBeUndefined();
    expect(t.session().role).toBe('seller');
    expect(t.session().permissions).not.toContain('users:manage');
  });

  it('cliente da nova empresa envia o cabeçalho da nova empresa', async () => {
    const t = setup([membership('t1'), membership('t2')]);
    t.server.on('GET', '/api/v1/tenants/current', () => ok({}));
    await render(t.ui);
    await waitFor(() => expect(t.session().gate.kind).toBe('chooseTenant'));
    await act(async () => t.session().selectTenant('t2'));
    await waitFor(() => expect(t.session().tenantApi).not.toBeNull());
    await t.session().tenantApi!.GET('/api/v1/tenants/current', {
      params: { header: { 'X-Tenant-Id': 't2' } },
    });
    expect(t.server.calls.at(-1)?.headers['x-tenant-id']).toBe('t2');
  });

  it('assinatura suspensa no meio da sessão leva ao bloqueio', async () => {
    const t = setup([membership('t1')]);
    t.server.on('GET', '/api/v1/tenants/current', () => fail(403, 'SUBSCRIPTION_SUSPENDED'));
    await render(t.ui);
    await waitFor(() => expect(t.session().gate.kind).toBe('tenant'));
    t.setMemberships([membership('t1', 'administrator', 'suspended')]);
    await act(async () => {
      await t.queryClient
        .fetchQuery({
          queryKey: ['tenant', 't1', 'current'],
          queryFn: () =>
            unwrap(
              t.session().tenantApi!.GET('/api/v1/tenants/current', {
                params: { header: { 'X-Tenant-Id': 't1' } },
              }),
            ),
          retry: false,
        })
        .catch(() => {});
    });
    await waitFor(() => expect(t.session().gate.kind).toBe('tenantBlocked'));
    expect(t.session().tenantApi).toBeNull();
    expect(t.session().permissions).toEqual([]);
  });

  it('sessão expirada (401 depois de renovar) sai e avisa', async () => {
    const t = setup([membership('t1')]);
    await render(t.ui);
    await waitFor(() => expect(t.session().gate.kind).toBe('tenant'));
    t.server.on('GET', '/api/v1/tenants/current', () => fail(401, 'UNAUTHORIZED'));
    await act(async () => {
      await t
        .session()
        .tenantApi!.GET('/api/v1/tenants/current', { params: { header: { 'X-Tenant-Id': 't1' } } })
        .catch(() => {});
    });
    await waitFor(() => expect(t.session().gate.kind).toBe('signedOut'));
    expect(t.session().notice).toBe('expired');
  });

  it('falha de rede no /me mostra erro com nova tentativa', async () => {
    const t = setup([membership('t1')]);
    t.server.on('GET', '/api/v1/me', () => {
      throw new TypeError('Network request failed');
    });
    await render(t.ui);
    await waitFor(() => expect(t.session().gate.kind).toBe('meError'), { timeout: 8000 });
  }, 15000);
});
