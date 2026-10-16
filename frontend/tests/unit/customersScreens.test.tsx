import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import CustomerDetail from '@/app/(app)/clientes/[id]/index';
import EditCustomer from '@/app/(app)/clientes/[id]/editar';
import Customers from '@/app/(app)/clientes/index';
import NewCustomer from '@/app/(app)/clientes/novo';
import { createFakeApi, customer, fail, membership, ok, page } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';
import { lookupPostalCode } from '@/features/customers/viaCep';

const lookup = lookupPostalCode as jest.Mock;

// ViaCEP fora da rede nos testes: só este CEP existe.
jest.mock('@/features/customers/viaCep', () => ({
  lookupPostalCode: jest.fn(async (cep: string) =>
    cep === '01310100'
      ? {
          kind: 'found',
          address: {
            street: 'Avenida Paulista',
            district: 'Bela Vista',
            city: 'São Paulo',
            state: 'SP',
          },
        }
      : { kind: 'notFound' },
  ),
}));

const fullAddress = {
  postalCode: '01310100',
  street: 'Avenida Paulista',
  number: '1000',
  district: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
};

/** CEP completo preenche logradouro, bairro, cidade e UF; o número é digitado. */
async function fillAddress() {
  await fireEvent.changeText(screen.getByLabelText('CEP'), '01310100');
  await waitFor(() =>
    expect(screen.getByLabelText('Logradouro').props.value).toBe('Avenida Paulista'),
  );
  expect(screen.getByLabelText('CEP').props.value).toBe('01310-100');
  await fireEvent.changeText(screen.getByLabelText('Número'), '1000');
}

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
    expect(screen.getByText('1 cliente')).toBeTruthy();
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
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar cliente' }));
    expect(await screen.findByText('Informe o nome com pelo menos 2 caracteres.')).toBeTruthy();
    expect(screen.getByText('CPF ou CNPJ inválido. Confira os dígitos.')).toBeTruthy();
    expect(screen.getByText('Informe o CEP.')).toBeTruthy();
    expect(screen.getByText('Informe o número ou marque "Sem número".')).toBeTruthy();
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
    await fillAddress();
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar cliente' }));
    expect(await screen.findByRole('header', { name: 'Mercado Novo' })).toBeTruthy();
    expect(sent).toEqual({ name: 'Mercado Novo', address: fullAddress });
    expect(screen.getByText('Na sua carteira.')).toBeTruthy();
  });

  it('CPF/CNPJ duplicado volta para o campo', async () => {
    const { gateway, server } = world('administrator');
    server.on('POST', '/api/v1/customers', () => fail(409, 'DUPLICATE_DOCUMENT'));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/novo', overrides });
    await screen.findByRole('header', { name: 'Novo cliente' });
    await fireEvent.changeText(screen.getByLabelText('Nome ou razão social'), 'Mercado');
    await fireEvent.changeText(screen.getByLabelText('CPF ou CNPJ'), '529.982.247-25');
    await fillAddress();
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar cliente' }));
    expect(
      await screen.findByText('Já existe um cliente com este CPF/CNPJ nesta empresa.'),
    ).toBeTruthy();
  });
});

describe('clientes: CEP e endereço', () => {
  const found = (street: string, city = 'São Paulo') => ({
    kind: 'found',
    address: { street, district: 'Centro', city, state: 'SP' },
  });
  const value = (label: string) => screen.getByLabelText(label).props.value;
  let restore: ((...args: unknown[]) => unknown) | undefined;
  beforeEach(() => {
    restore = lookup.getMockImplementation();
    lookup.mockClear();
  });
  afterEach(() => {
    if (restore) lookup.mockImplementation(restore);
  });

  async function openNew() {
    const { gateway, server } = world('seller');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/novo', overrides });
    await screen.findByRole('header', { name: 'Novo cliente' });
    return server;
  }

  it('CEP incompleto não consulta; completo consulta uma vez e mantém a máscara', async () => {
    await openNew();
    await fireEvent.changeText(screen.getByLabelText('CEP'), '0131');
    expect(lookup).not.toHaveBeenCalled();
    expect(value('CEP')).toBe('0131');
    await fireEvent.changeText(screen.getByLabelText('CEP'), '01310-100');
    await waitFor(() => expect(value('Logradouro')).toBe('Avenida Paulista'));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0][0]).toBe('01310100');
    // Digitação que não muda o CEP completo não consulta de novo.
    await fireEvent.changeText(screen.getByLabelText('CEP'), '01310-100');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('não sobrescreve o que a pessoa digitou e ignora resposta de CEP anterior', async () => {
    const pending: Record<string, (v: unknown) => void> = {};
    lookup.mockImplementation((cep: string) => new Promise((resolve) => (pending[cep] = resolve)));
    await openNew();
    await fireEvent.changeText(screen.getByLabelText('Logradouro'), 'Rua digitada à mão');
    await fireEvent.changeText(screen.getByLabelText('CEP'), '11111111');
    await fireEvent.changeText(screen.getByLabelText('CEP'), '22222222');
    await act(async () => pending['22222222']!(found('Rua do CEP novo', 'Campinas')));
    // Resposta atrasada do primeiro CEP chega depois: descartada.
    await act(async () => pending['11111111']!(found('Rua do CEP antigo', 'Santos')));
    expect(value('Logradouro')).toBe('Rua digitada à mão');
    expect(value('Cidade')).toBe('Campinas');
    expect(value('Bairro')).toBe('Centro');
  });

  it('CEP não encontrado ou serviço fora do ar libera preenchimento manual', async () => {
    lookup
      .mockResolvedValueOnce({ kind: 'notFound' })
      .mockResolvedValueOnce({ kind: 'unavailable' });
    await openNew();
    await fireEvent.changeText(screen.getByLabelText('CEP'), '99999999');
    expect(
      await screen.findByText('CEP não encontrado. Preencha o endereço manualmente.'),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('CEP'), '99999998');
    expect(
      await screen.findByText('Consulta de CEP indisponível agora. Preencha manualmente.'),
    ).toBeTruthy();
    expect(value('Logradouro')).toBe('');
  });

  it('"Sem número" grava S/N e trava o campo número', async () => {
    const server = await openNew();
    let sent: { address?: { number?: string } } | undefined;
    server.on('POST', '/api/v1/customers', (c) => {
      sent = c.body as typeof sent;
      return ok(customer('c9', { name: 'Sem número', assignedTo: 'u1' }), 201);
    });
    server.on('GET', '/api/v1/customers/c9', () => ok(customer('c9', { name: 'Sem número' })));
    await fireEvent.changeText(screen.getByLabelText('Nome ou razão social'), 'Sem número');
    await fireEvent.changeText(screen.getByLabelText('CEP'), '01310100');
    await waitFor(() => expect(value('Logradouro')).toBe('Avenida Paulista'));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Sem número' }));
    expect(screen.getByLabelText('Número').props.editable).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar cliente' }));
    await waitFor(() => expect(sent?.address?.number).toBe('S/N'));
  });

  it('edição de cliente antigo: não consulta o CEP salvo e exige completar o endereço', async () => {
    const { gateway, server } = world('administrator');
    const patches: unknown[] = [];
    server
      .on('GET', '/api/v1/customers/c1', () =>
        ok(
          customer('c1', {
            name: 'Antigo',
            address: { postalCode: '01310100', city: 'São Paulo', state: 'SP' },
          }),
        ),
      )
      .on('PATCH', '/api/v1/customers/c1', (c) => {
        patches.push(c.body);
        return ok(customer('c1', { name: 'Antigo', version: 2 }));
      });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/c1/editar', overrides });
    expect(await screen.findByText('Endereço incompleto')).toBeTruthy();
    expect(value('CEP')).toBe('01310-100');
    expect(value('Cidade')).toBe('São Paulo');
    expect(lookup).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar cliente' }));
    expect(await screen.findByText('Informe o logradouro.')).toBeTruthy();
    expect(patches).toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText('Logradouro'), 'Avenida Paulista');
    await fireEvent.changeText(screen.getByLabelText('Número'), '10');
    await fireEvent.changeText(screen.getByLabelText('Bairro'), 'Bela Vista');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar cliente' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect((patches[0] as { address: unknown }).address).toEqual({
      postalCode: '01310100',
      street: 'Avenida Paulista',
      number: '10',
      district: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('ficha de cliente antigo abre normalmente e oferece completar o endereço', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/customers/c1', () =>
      ok(customer('c1', { name: 'Antigo', assignedTo: 'u1', address: null })),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes/c1', overrides });
    expect(await screen.findByRole('header', { name: 'Antigo' })).toBeTruthy();
    expect(screen.getByText('Endereço incompleto')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Completar endereço' })).toBeTruthy();
  });

  it('busca por CPF/CNPJ completo usa o documento, não o nome', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/customers', () => ok(page([customer('c1', { assignedTo: 'u1' })])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/clientes', overrides });
    await screen.findByText('Cliente c1');
    await fireEvent.changeText(screen.getByLabelText('Buscar clientes'), '529.982.247-25');
    await waitFor(() =>
      expect(listCalls(server).at(-1)?.query).toMatchObject({ document: '52998224725' }),
    );
    expect(listCalls(server).at(-1)?.query.q).toBeUndefined();
    await fireEvent.changeText(screen.getByLabelText('Buscar clientes'), '529.982');
    await waitFor(() => expect(listCalls(server).at(-1)?.query.q).toBe('529.982'));
    expect(listCalls(server).at(-1)?.query.document).toBeUndefined();
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
      .on('GET', '/api/v1/customers/c1', () =>
        ok(customer('c1', { name: 'Mercado', version, address: fullAddress })),
      )
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
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar cliente' }));
    expect(await screen.findByText('Alguém alterou este cadastro')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Carregar versão atual' }));
    await waitFor(() => expect(screen.queryByText('Alguém alterou este cadastro')).toBeNull());
    await fireEvent.changeText(screen.getByLabelText('Nome ou razão social'), 'Mercado Central');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Salvar cliente' }));
    });
    await waitFor(() => expect(patches).toHaveLength(2));
    expect((patches[1] as { expectedVersion: number }).expectedVersion).toBe(2);
  });
});
