import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import UsersRoute from '@/app/(app)/configuracoes/usuarios';
import { createFakeApi, fail, membership, ok } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const overrides = { '(app)/configuracoes/usuarios': UsersRoute };

const member = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  name: null,
  email: null,
  role: 'seller',
  status: 'active',
  version: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  ...o,
});

function world(
  role: 'administrator' | 'seller' = 'administrator',
  items: unknown[] = [
    member('u1', { role: 'administrator', name: 'Ana Dona', email: 'ana@lastro.test' }),
    member('s1', { name: 'Bruno Vendas', email: 'bruno@lastro.test' }),
    member('s2', { email: 'carla@lastro.test', status: 'disabled' }),
  ],
) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [membership('t1', role)],
      }),
    )
    .on('GET', '/api/v1/users', () =>
      ok({
        items,
        nextCursor: null,
        pendingInvitations: [
          {
            id: 'inv1',
            email: 'novo@lastro.test',
            role: 'seller',
            expiresAt: '2099-01-01T12:00:00.000Z',
          },
        ],
      }),
    );
  return { gateway, server };
}

describe('usuários', () => {
  it('lista nome, e-mail, perfil e situação; a própria conta não tem edição', async () => {
    const { gateway, server } = world();
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/usuarios',
      overrides,
    });
    expect(await screen.findByText('Bruno Vendas')).toBeTruthy();
    expect(screen.getByText('Ana Dona')).toBeTruthy();
    // Sem nome cadastrado, o e-mail identifica a pessoa (nunca o ID técnico).
    expect(screen.getAllByText('carla@lastro.test').length).toBeGreaterThan(0);
    expect(screen.queryByText(/S2/)).toBeNull();
    expect(screen.getByText('Você')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Editar Ana Dona' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Editar Bruno Vendas' })).toBeTruthy();
    expect(screen.getByText('novo@lastro.test')).toBeTruthy();
    expect(screen.getByText(/2 ativos · 1 convite pendente/)).toBeTruthy();
  });

  it('promove vendedor com a versão do vínculo e atualiza a linha sem recarregar a lista', async () => {
    const { gateway, server } = world();
    let sent: unknown;
    server.on('PATCH', '/api/v1/users/s1/role', (c) => {
      sent = c.body;
      return ok(member('s1', { role: 'administrator', version: 2 }));
    });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/usuarios',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Editar Bruno Vendas' }));
    expect(await screen.findByText('Editar usuário')).toBeTruthy();
    // Perfil explicado em linguagem de uso.
    expect(
      screen.getByText('Atende a própria carteira: seus clientes, pedidos e documentos.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Administrador' }));
    const listCalls = () => server.calls.filter((c) => c.path === '/api/v1/users').length;
    const before = listCalls();
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar usuário' }));
    await waitFor(() => expect(sent).toEqual({ role: 'administrator', expectedVersion: 1 }));
    await waitFor(() => expect(screen.queryByText('Editar usuário')).toBeNull());
    // A linha passa a mostrar o novo perfil (Ana e Bruno administradores).
    expect(screen.getAllByText(/^Administrador/)).toHaveLength(2);
    // Nome continua na linha (a resposta da alteração não traz nome nem e-mail).
    expect(screen.getByText('Bruno Vendas')).toBeTruthy();
    expect(server.calls.some((c) => c.path === '/api/v1/users/s1/status')).toBe(false);
    // A página não recarrega a lista inteira para refletir a alteração.
    const pageReloads = server.calls
      .slice(before)
      .filter((c) => c.path === '/api/v1/users' && c.query.limit === '100' && !c.query.cursor);
    expect(pageReloads.length).toBeLessThanOrEqual(1);
  });

  it('desativar pede confirmação específica e explica limite do plano na reativação', async () => {
    const { gateway, server } = world();
    let status: unknown;
    server
      .on('PATCH', '/api/v1/users/s1/status', (c) => {
        status = c.body;
        return ok(member('s1', { status: 'disabled', version: 2 }));
      })
      .on('PATCH', '/api/v1/users/s2/status', () => fail(409, 'USER_LIMIT_REACHED'));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/usuarios',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Editar Bruno Vendas' }));
    await fireEvent(await screen.findByLabelText('Acesso ativo'), 'valueChange', false);
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar usuário' }));
    expect(await screen.findByText('Desativar acesso?')).toBeTruthy();
    expect(status).toBeUndefined();
    await fireEvent.press(screen.getByRole('button', { name: 'Desativar acesso' }));
    await waitFor(() => expect(status).toEqual({ status: 'disabled', expectedVersion: 1 }));

    await fireEvent.press(await screen.findByRole('button', { name: 'Editar carla@lastro.test' }));
    await fireEvent(await screen.findByLabelText('Acesso ativo'), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar usuário' }));
    expect(
      await screen.findByText(
        'O plano não tem vaga para reativar este acesso. Revogue um convite ou desative outra pessoa.',
      ),
    ).toBeTruthy();
  });

  it('com dois administradores ativos, qualquer um pode mudar de perfil', async () => {
    const { gateway, server } = world('administrator', [
      member('u1', { role: 'administrator', name: 'Ana Dona' }),
      member('a2', { role: 'administrator', name: 'Davi Admin', status: 'disabled' }),
      member('a3', { role: 'administrator', name: 'Eva Admin' }),
    ]);
    // Ana e Eva estão ativas (Davi está desativado): ninguém é o último administrador.
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/usuarios',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Editar Eva Admin' }));
    expect(screen.queryByText('Único administrador ativo')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Vendedor' })).toBeTruthy();
  });

  it('com um só administrador ativo, a tela protege o último', async () => {
    const { gateway, server } = world('administrator', [
      member('u1', { role: 'seller', name: 'Ana (vendedora)' }),
      member('a3', { role: 'administrator', name: 'Eva Admin' }),
    ]);
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/usuarios',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Editar Eva Admin' }));
    expect(await screen.findByText('Único administrador ativo')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Vendedor' })).toBeNull();
    expect(screen.getByLabelText('Acesso ativo').props.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Salvar usuário' })).toBeDisabled();
  });

  it('vendedor não acessa a gestão de usuários nem consulta a API', async () => {
    const { gateway, server } = world('seller');
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/usuarios',
      overrides,
    });
    expect(await screen.findByText('Você não tem acesso a esta área')).toBeTruthy();
    expect(server.calls.some((c) => c.path === '/api/v1/users')).toBe(false);
  });
});
