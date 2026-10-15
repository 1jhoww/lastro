import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import SignIn from '@/app/(auth)/entrar';
import ResetPassword from '@/app/(auth)/recuperar-senha';
import AcceptInvitation from '@/app/convite';
import { createFakeApi, fail, membership, ok } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const ana = {
  uid: 'u1',
  email: 'ana@lastro.test',
  password: 'senha-de-teste',
  emailVerified: true,
};
const token = `t1.inv1.${'a'.repeat(43)}`;

function world(
  memberships: ReturnType<typeof membership>[] = [membership('t1')],
  initialUser: { uid: string; email: string; emailVerified: boolean } | null = null,
) {
  const gateway = new FakeGateway({ accounts: [ana], initialUser });
  const server = createFakeApi().on('GET', '/api/v1/me', () =>
    ok({ uid: 'u1', email: ana.email, platformAdmin: false, memberships }),
  );
  return { gateway, server };
}

const overrides = {
  '(auth)/entrar': SignIn,
  '(auth)/recuperar-senha': ResetPassword,
  convite: AcceptInvitation,
};

async function fillAndSubmit(email: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText('E-mail'), email);
  await fireEvent.changeText(screen.getByLabelText('Senha'), password);
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
}

describe('entrar', () => {
  it('credencial inválida mostra mensagem e continua na tela', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/entrar', overrides });
    await screen.findByRole('header', { name: 'Entrar' });
    await fillAndSubmit(ana.email, 'errada');
    expect(await screen.findByText('E-mail ou senha incorretos.')).toBeTruthy();
    expect(screen.queryByText('tela:inicio')).toBeNull();
  });

  it('campos vazios são validados antes de chamar o provedor', async () => {
    const { gateway, server } = world();
    const spy = jest.spyOn(gateway, 'signIn');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/entrar', overrides });
    await screen.findByRole('header', { name: 'Entrar' });
    await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Informe seu e-mail.')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('login válido leva ao início da empresa', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/entrar', overrides });
    await screen.findByRole('header', { name: 'Entrar' });
    await fillAndSubmit(ana.email, ana.password);
    expect(await screen.findByText('tela:inicio')).toBeTruthy();
  });
});

describe('recuperar senha', () => {
  it('confirma o envio sem revelar se a conta existe', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/recuperar-senha', overrides });
    await screen.findByRole('header', { name: 'Recuperar senha' });
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'ninguem@lastro.test');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar link' }));
    expect(await screen.findByText('Confira seu e-mail')).toBeTruthy();
  });

  it('falha de rede é explicada', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/recuperar-senha', overrides });
    await screen.findByRole('header', { name: 'Recuperar senha' });
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'offline@lastro.test');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar link' }));
    expect(
      await screen.findByText('Sem conexão. Verifique a internet e tente de novo.'),
    ).toBeTruthy();
  });
});

describe('convite', () => {
  const signedIn = { uid: 'u1', email: ana.email, emailVerified: true };

  it('link sem token explica o problema', async () => {
    const { gateway, server } = world([], null);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/convite', overrides });
    expect(await screen.findByText('Link de convite incompleto')).toBeTruthy();
  });

  it('sem login oferece criar conta ou entrar', async () => {
    const { gateway, server } = world([], null);
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: `/convite?token=${token}`,
      overrides,
    });
    expect(await screen.findByRole('button', { name: 'Criar conta' })).toBeTruthy();
  });

  it('conta existente ao criar: orienta a entrar', async () => {
    const { gateway, server } = world([], null);
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: `/convite?token=${token}`,
      overrides,
    });
    await screen.findByRole('button', { name: 'Criar conta' });
    await fireEvent.changeText(screen.getByLabelText('E-mail convidado'), ana.email);
    await fireEvent.changeText(screen.getByLabelText('Senha'), 'outra-senha-1');
    await fireEvent.changeText(screen.getByLabelText('Repita a senha'), 'outra-senha-1');
    await fireEvent.press(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('Você já tem uma conta')).toBeTruthy();
  });

  it('conta nova recebe pedido de confirmação de e-mail antes do aceite', async () => {
    const { gateway, server } = world([], null);
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: `/convite?token=${token}`,
      overrides,
    });
    await screen.findByRole('button', { name: 'Criar conta' });
    await fireEvent.changeText(screen.getByLabelText('E-mail convidado'), 'novo@lastro.test');
    await fireEvent.changeText(screen.getByLabelText('Senha'), 'senha-nova-1');
    await fireEvent.changeText(screen.getByLabelText('Repita a senha'), 'senha-nova-1');
    await fireEvent.press(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('Confirme seu e-mail')).toBeTruthy();
    expect(gateway.verificationsSent).toBe(1);
    expect(server.calls.some((c) => c.path.endsWith('/accept'))).toBe(false);
  });

  it('convite válido: aceita, escolhe a empresa e entra', async () => {
    let accepted = false;
    const gateway = new FakeGateway({ accounts: [ana], initialUser: signedIn });
    const server = createFakeApi()
      .on('GET', '/api/v1/me', () =>
        ok({
          uid: 'u1',
          email: ana.email,
          platformAdmin: false,
          memberships: accepted ? [membership('t9', 'seller')] : [],
        }),
      )
      .on('POST', '/api/v1/users/invitations/accept', (c) => {
        accepted = true;
        expect(c.body).toEqual({ token });
        expect(c.headers['x-tenant-id']).toBeUndefined();
        return ok({ tenantId: 't9', user: { id: 'u1' } });
      });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: `/convite?token=${token}`,
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Aceitar convite' }));
    expect(await screen.findByText('tela:inicio')).toBeTruthy();
  });

  it.each([
    [410, 'INVITATION_EXPIRED', 'Este convite venceu'],
    [403, 'INVITATION_INVALID', 'Convite não pode ser usado'],
    [409, 'USER_LIMIT_REACHED', 'A empresa atingiu o limite de usuários'],
    [409, 'CONFLICT', 'Você já faz parte desta empresa'],
    [403, 'FORBIDDEN', 'Sua conta não pode aceitar convites'],
  ])('erro %i %s', async (status, code, title) => {
    const gateway = new FakeGateway({ accounts: [ana], initialUser: signedIn });
    const server = createFakeApi()
      .on('GET', '/api/v1/me', () =>
        ok({ uid: 'u1', email: ana.email, platformAdmin: false, memberships: [] }),
      )
      .on('POST', '/api/v1/users/invitations/accept', () => fail(status, code));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: `/convite?token=${token}`,
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Aceitar convite' }));
    expect(await screen.findByText(title)).toBeTruthy();
  });

  it('falha de rede permite tentar de novo', async () => {
    const gateway = new FakeGateway({ accounts: [ana], initialUser: signedIn });
    const server = createFakeApi().on('GET', '/api/v1/me', () =>
      ok({ uid: 'u1', email: ana.email, platformAdmin: false, memberships: [] }),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: `/convite?token=${token}`,
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Aceitar convite' }));
    expect(await screen.findByText('Não foi possível aceitar agora')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Aceitar convite' })).toBeTruthy(),
    );
  });
});
