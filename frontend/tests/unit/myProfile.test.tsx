import { router } from 'expo-router';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import MyProfile from '@/app/meu-perfil';
import Home from '@/app/(app)/index';
import { createFakeApi, membership, ok, tenant } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const account = {
  uid: 'u1', email: 'ana@lastro.test', password: 'senha-de-teste', emailVerified: true,
};

function world(withCompany = true) {
  const gateway = new FakeGateway({
    accounts: [account],
    initialUser: { uid: account.uid, email: account.email, emailVerified: true },
  });
  let name = 'Ana Souza';
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () => ok({
      uid: account.uid, email: account.email, name, platformAdmin: !withCompany,
      memberships: withCompany ? [membership('t1')] : [],
    }))
    .on('PATCH', '/api/v1/me', (call) => {
      name = (call.body as { name: string }).name;
      return ok({ uid: account.uid, email: account.email, name, platformAdmin: !withCompany,
        memberships: withCompany ? [membership('t1')] : [] });
    })
    .on('GET', '/api/v1/tenants/current', () => ok(tenant('t1', 'Distribuidora Sol')))
    .on('GET', '/api/v1/me/email-change', () => ok({ emailChange: null }));
  return { gateway, server };
}

describe('Meu Perfil', () => {
  it('mostra identidade, empresa e função; atualiza o nome pela API existente', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/meu-perfil',
      overrides: { 'meu-perfil': MyProfile, '(app)/index': Home } });
    expect(await screen.findByRole('header', { name: 'Meu Perfil' })).toBeTruthy();
    expect(await screen.findByText('Distribuidora Sol')).toBeTruthy();
    expect(screen.getByText('Administrador')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Editar nome' }));
    await fireEvent.changeText(screen.getByLabelText('Nome e sobrenome'), 'Carolina Souza');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Carolina Souza')).toBeTruthy();
    expect(server.calls.some((call) => call.method === 'PATCH' && call.path === '/api/v1/me')).toBe(true);
    await act(async () => router.navigate('/'));
    expect(await screen.findByText('Olá, Carolina!')).toBeTruthy();
  });

  it('envia link de senha para o e-mail autenticado e mostra confirmação', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/meu-perfil',
      overrides: { 'meu-perfil': MyProfile } });
    await screen.findByRole('header', { name: 'Meu Perfil' });
    await fireEvent.press(screen.getByRole('button', { name: 'Alterar senha' }));
    await waitFor(() => expect(gateway.resetRequests).toEqual([account.email]));
    expect(screen.getByText('Confira seu e-mail')).toBeTruthy();
  });

  it('também abre para Super Admin sem empresa, sem consultar dados de empresa', async () => {
    const { gateway, server } = world(false);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/meu-perfil',
      overrides: { 'meu-perfil': MyProfile } });
    expect(await screen.findByRole('header', { name: 'Meu Perfil' })).toBeTruthy();
    expect(screen.getByText('Super Admin Lastro')).toBeTruthy();
    expect(server.calls.some((call) => call.path === '/api/v1/tenants/current')).toBe(false);
  });

  it('sair pelo perfil encerra a sessão e volta para entrar', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/meu-perfil',
      overrides: { 'meu-perfil': MyProfile } });
    await screen.findByRole('header', { name: 'Meu Perfil' });
    await fireEvent.press(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByText('tela:entrar')).toBeTruthy();
    expect(gateway.user).toBeNull();
  });
});
