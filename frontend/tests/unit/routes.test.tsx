import { act, screen, waitFor } from 'expo-router/testing-library';
import { createFakeApi, membership, ok } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const ana = {
  uid: 'u1',
  email: 'ana@lastro.test',
  password: 'senha-de-teste',
  emailVerified: true,
};

function world(
  memberships: ReturnType<typeof membership>[],
  opts: { signedIn?: boolean; platformAdmin?: boolean } = {},
) {
  const gateway = new FakeGateway({
    accounts: [ana],
    initialUser:
      opts.signedIn === false ? null : { uid: 'u1', email: ana.email, emailVerified: true },
  });
  const server = createFakeApi().on('GET', '/api/v1/me', () =>
    ok({ uid: 'u1', email: ana.email, platformAdmin: !!opts.platformAdmin, memberships }),
  );
  return { gateway, server };
}

describe('proteção de rotas', () => {
  it('sem sessão, rota privada leva a entrar sem mostrar a tela privada', async () => {
    const { gateway, server } = world([membership('t1')], { signedIn: false });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque' });
    expect(await screen.findByText('tela:entrar')).toBeTruthy();
    expect(screen.queryByText('tela:estoque')).toBeNull();
  });

  it('com sessão e uma empresa, entrar redireciona para o início', async () => {
    const { gateway, server } = world([membership('t1')]);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/entrar' });
    expect(await screen.findByText('tela:inicio')).toBeTruthy();
  });

  it('várias empresas: vai para a escolha', async () => {
    const { gateway, server } = world([membership('t1'), membership('t2')]);
    await renderApp({ gateway, fetch: server.fetch });
    expect(await screen.findByText('tela:empresas')).toBeTruthy();
  });

  it('assinatura suspensa: área da empresa fica inacessível', async () => {
    const { gateway, server } = world([membership('t1', 'administrator', 'suspended')]);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque' });
    expect(await screen.findByText('tela:acesso-bloqueado')).toBeTruthy();
    expect(screen.queryByText('tela:estoque')).toBeNull();
  });

  it('plataforma só para Super Admin', async () => {
    const common = world([membership('t1')]);
    await renderApp({
      gateway: common.gateway,
      fetch: common.server.fetch,
      initialUrl: '/plataforma',
    });
    expect(await screen.findByText('tela:inicio')).toBeTruthy();
    expect(screen.queryByText('tela:plataforma')).toBeNull();
  });

  it('Super Admin sem empresa cai direto na plataforma', async () => {
    const { gateway, server } = world([], { platformAdmin: true });
    await renderApp({ gateway, fetch: server.fetch });
    expect(await screen.findByText('tela:plataforma')).toBeTruthy();
  });

  it('conta sem empresa vê orientação, não a área da empresa', async () => {
    const { gateway, server } = world([]);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/' });
    expect(await screen.findByText('tela:sem-empresa')).toBeTruthy();
  });

  it('convite abre com ou sem sessão', async () => {
    const out = world([], { signedIn: false });
    await renderApp({ gateway: out.gateway, fetch: out.server.fetch, initialUrl: '/convite' });
    expect(await screen.findByText('tela:convite')).toBeTruthy();
  });

  it('logout volta para entrar', async () => {
    const { gateway, server } = world([membership('t1')]);
    await renderApp({ gateway, fetch: server.fetch });
    expect(await screen.findByText('tela:inicio')).toBeTruthy();
    await act(async () => {
      await gateway.signOut();
    });
    await waitFor(() => expect(screen.getByText('tela:entrar')).toBeTruthy());
    expect(screen.queryByText('tela:inicio')).toBeNull();
  });
});
