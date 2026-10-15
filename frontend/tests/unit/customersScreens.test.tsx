import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import CustomerDetail from '@/app/(app)/clientes/[id]/index';
import EditCustomer from '@/app/(app)/clientes/[id]/editar';
import Customers from '@/app/(app)/clientes/index';
import NewCustomer from '@/app/(app)/clientes/novo';
import { createFakeApi, customer, fail, membership, ok, page } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const overrides = {
  '(app)/clientes/index': Customers,
  '(app)/clientes/novo': NewCustomer,
  '(app)/clientes/[id]/index': CustomerDetail,
  '(app)/clientes/[id]/editar': EditCustomer,
};

function world(role: 'administrator' | 'seller') {
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
        items: [
          { id: 'u1', role, status: 'active', version: 1, createdAt: '', updatedAt: '' },
          {
            id: 'seller2',
            role: 'seller',
            status: 'active',
            version: 1,
            createdAt: '',
            updatedAt: '',
          },
        ],
        nextCursor: null,
        pendingInvitations: [],
      }),
    );
  return { gateway, server };
}

const listCalls = (server: ReturnType<typeof createFakeApi>) =>
  server.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/customers');

describe('clientes: lista', () => {
  it('lista com o cabeçalho da empresa e ordenação por nome', async () => {
    const { gateway, server } = world('administrator');
    server.on('GET', '/api/v1/customers', () =>
      ok(
        page([
          customer('c1', { name: 'Mercado Bom Preço' }),
          customer('c2', { name: 'Padaria Sol' }),
        ]),
      ),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes', overrides });
    expect(await screen.findByText('Mercado Bom Preço')).toBeTruthy();
    expect(screen.getByText('Padaria Sol')).toBeTruthy();
    const call = listCalls(server)[0]!;
    expect(call.headers['x-tenant-id']).toBe('t1');
    expect(call.query).toMatchObject({ sort: 'name', direction: 'asc', status: 'active' });
  });

  it('busca por prefixo envia q com ordenação por nome crescente', async () => {
    const { gateway, server } = world('administrator');
    server.on('GET', '/api/v1/customers', (c) =>
      ok(page(c.query.q === 'merc' ? [customer('c1', { name: 'Mercado Bom Preço' })] : [])),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes', overrides });
    await screen.findByText('Nenhum cliente cadastrado');
    await fireEvent.changeText(screen.getByLabelText('Buscar clientes'), 'merc');
    expect(await screen.findByText('Mercado Bom Preço')).toBeTruthy();
    expect(listCalls(server).at(-1)?.query).toMatchObject({
      q: 'merc',
      sort: 'name',
      direction: 'asc',
    });
  });

  it('busca sem resultado mostra estado específico', async () => {
    const { gateway, server } = world('administrator');
    server.on('GET', '/api/v1/customers', () => ok(page([])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes', overrides });
    await screen.findByText('Nenhum cliente cadastrado');
    await fireEvent.changeText(screen.getByLabelText('Buscar clientes'), 'zz');
    expect(await screen.findByText('Nenhum cliente encontrado')).toBeTruthy();
  });

  it('filtro de situação envia status', async () => {
    const { gateway, server } = world('administrator');
    server.on('GET', '/api/v1/customers', () => ok(page([])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes', overrides });
    await screen.findByText('Nenhum cliente cadastrado');
    await fireEvent.press(screen.getByRole('radio', { name: 'Inativos' }));
    await waitFor(() => expect(listCalls(server).at(-1)?.query.status).toBe('inactive'));
  });

  it('carregar mais usa o cursor devolvido pelo servidor', async () => {
    const { gateway, server } = world('administrator');
    server.on('GET', '/api/v1/customers', (c) =>
      c.query.cursor === 'next1'
        ? ok(page([customer('c2', { name: 'Segunda Página' })]))
        : ok(page([customer('c1', { name: 'Primeira Página' })], 'next1')),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes', overrides });
    await screen.findByText('Primeira Página');
    await fireEvent.press(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Segunda Página')).toBeTruthy();
    expect(screen.getByText('Primeira Página')).toBeTruthy();
  });

  it('erro de carregamento oferece nova tentativa', async () => {
    const { gateway, server } = world('administrator');
    server.on('GET', '/api/v1/customers', () => fail(500, 'INTERNAL_ERROR'));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes', overrides });
    expect(
      await screen.findByText('Não foi possível carregar a lista', {}, { timeout: 8000 }),
    ).toBeTruthy();
  }, 15000);

  it('vendedor não tem filtro de responsável e não envia assignedTo', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/customers', () => ok(page([customer('c1', { assignedTo: 'u1' })])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes', overrides });
    expect(await screen.findByText('Cliente c1')).toBeTruthy();
    expect(screen.getByText('Os clientes da sua carteira.')).toBeTruthy();
    expect(screen.queryByLabelText(/Responsável/)).toBeNull();
    expect(listCalls(server)[0]?.query.assignedTo).toBeUndefined();
    expect(server.calls.some((c) => c.path === '/api/v1/users')).toBe(false);
  });
});

describe('clientes: cadastro', () => {
  it('valida antes de enviar: nome obrigatório e CPF inválido', async () => {
    const { gateway, server } = world('seller');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/novo', overrides });
    await screen.findByRole('header', { name: 'Novo cliente' });
    await fireEvent.changeText(screen.getByLabelText('CPF ou CNPJ'), '123.456.789-00');
    await fireEvent.press(screen.getByRole('button', { name: 'Cadastrar cliente' }));
    expect(await screen.findByText('Informe o nome com pelo menos 2 caracteres.')).toBeTruthy();
    expect(screen.getByText('CPF ou CNPJ inválido. Confira os dígitos.')).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('vendedor cadastra sem enviar responsável e vai para o detalhe', async () => {
    const { gateway, server } = world('seller');
    let sent: unknown;
    server
      .on('POST', '/api/v1/customers', (c) => {
        sent = c.body;
        return ok(customer('c9', { name: 'Mercado Novo', assignedTo: 'u1' }), 201);
      })
      .on('GET', '/api/v1/customers/c9', () =>
        ok(customer('c9', { name: 'Mercado Novo', assignedTo: 'u1' })),
      );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/novo', overrides });
    await screen.findByRole('header', { name: 'Novo cliente' });
    await fireEvent.changeText(screen.getByLabelText('Nome ou razão social'), 'Mercado Novo');
    await fireEvent.press(screen.getByRole('button', { name: 'Cadastrar cliente' }));
    expect(await screen.findByRole('header', { name: 'Mercado Novo' })).toBeTruthy();
    expect(sent).toEqual({ name: 'Mercado Novo' });
    expect(screen.getByText('Na sua carteira.')).toBeTruthy();
  });

  it('CPF/CNPJ duplicado volta para o campo', async () => {
    const { gateway, server } = world('administrator');
    server.on('POST', '/api/v1/customers', () => fail(409, 'DUPLICATE_DOCUMENT'));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/novo', overrides });
    await screen.findByRole('header', { name: 'Novo cliente' });
    await fireEvent.changeText(screen.getByLabelText('Nome ou razão social'), 'Mercado');
    await fireEvent.changeText(screen.getByLabelText('CPF ou CNPJ'), '529.982.247-25');
    await fireEvent.press(screen.getByRole('button', { name: 'Cadastrar cliente' }));
    expect(
      await screen.findByText('Já existe um cliente com este CPF/CNPJ nesta empresa.'),
    ).toBeTruthy();
  });
});

describe('clientes: detalhe e edição', () => {
  it('cliente fora da carteira (404) não revela existência', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/customers/cx', () => fail(404, 'RESOURCE_NOT_FOUND'));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/cx', overrides });
    expect(await screen.findByText('Cadastro não encontrado')).toBeTruthy();
  });

  it('vendedor não vê desativar nem transferência de carteira', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/customers/c1', () => ok(customer('c1', { assignedTo: 'u1' })));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/c1', overrides });
    await screen.findByRole('header', { name: 'Cliente c1' });
    // Editar é um link para a rota de edição.
    expect(screen.getByRole('link', { name: 'Editar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desativar' })).toBeNull();
    expect(screen.queryByText('Transferir para')).toBeNull();
  });

  it('administrador desativa com confirmação e versão esperada', async () => {
    const { gateway, server } = world('administrator');
    let current = customer('c1', { version: 2 });
    server
      .on('GET', '/api/v1/customers/c1', () => ok(current))
      .on('DELETE', '/api/v1/customers/c1', (c) => {
        expect(c.body).toEqual({ expectedVersion: 2 });
        current = customer('c1', { version: 3, status: 'inactive' });
        return ok(current);
      });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/c1', overrides });
    await fireEvent.press(await screen.findByRole('button', { name: 'Desativar' }));
    expect(screen.getByText('Desativar cliente?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Desativar cliente' }));
    expect(await screen.findByText('Cliente inativo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reativar' })).toBeTruthy();
  });

  it('administrador transfere carteira após confirmar', async () => {
    const { gateway, server } = world('administrator');
    let assigned: unknown;
    server
      .on('GET', '/api/v1/customers/c1', () => ok(customer('c1')))
      .on('PATCH', '/api/v1/customers/c1/assignment', (c) => {
        assigned = c.body;
        return ok(customer('c1', { assignedTo: 'seller2', version: 2 }));
      });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/c1', overrides });
    await screen.findByRole('header', { name: 'Cliente c1' });
    await fireEvent.press(await screen.findByLabelText('Transferir para: Sem responsável'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Vendedor SELLER' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Transferir cliente' }));
    await waitFor(() => expect(assigned).toEqual({ assignedTo: 'seller2', expectedVersion: 1 }));
    expect(await screen.findAllByText('Vendedor SELLER')).toBeTruthy();
  });

  it('conflito de versão na edição pede recarga e reenvia com a versão nova', async () => {
    const { gateway, server } = world('administrator');
    let version = 1;
    const patches: unknown[] = [];
    server
      .on('GET', '/api/v1/customers/c1', () => ok(customer('c1', { name: 'Mercado', version })))
      .on('PATCH', '/api/v1/customers/c1', (c) => {
        patches.push(c.body);
        if ((c.body as { expectedVersion: number }).expectedVersion !== version)
          return fail(409, 'CONFLICT');
        return ok(customer('c1', { name: 'Mercado Central', version: version + 1 }));
      });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/c1/editar', overrides });
    await screen.findByLabelText('Nome ou razão social');
    version = 2; // outra pessoa salvou enquanto a tela estava aberta
    await fireEvent.changeText(screen.getByLabelText('Nome ou razão social'), 'Mercado Central');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Alguém alterou este cadastro')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Carregar versão atual' }));
    await waitFor(() => expect(screen.queryByText('Alguém alterou este cadastro')).toBeNull());
    await fireEvent.changeText(screen.getByLabelText('Nome ou razão social'), 'Mercado Central');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Salvar alterações' }));
    });
    await waitFor(() => expect(patches).toHaveLength(2));
    expect((patches[1] as { expectedVersion: number }).expectedVersion).toBe(2);
  });
});
