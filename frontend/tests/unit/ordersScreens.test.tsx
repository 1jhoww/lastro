import { Pressable, Text } from 'react-native';
import { router, useRouter, type Href } from 'expo-router';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import EditOrder from '@/app/(app)/pedidos/[id]/editar';
import OrderDetail from '@/app/(app)/pedidos/[id]/index';
import Orders from '@/app/(app)/pedidos/index';
import NewOrder from '@/app/(app)/pedidos/novo';
import { criticalRequest, intentLedger } from '@/lib/intent';
import { useSession } from '@/session/SessionContext';
import {
  createFakeApi,
  customer,
  fail,
  membership,
  ok,
  order,
  orderEvent,
  orderLine,
  page,
  product,
  stockAdmin,
  stockAvailability,
  tenant,
  type Call,
} from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

let mockSize: 'compact' | 'medium' | 'expanded' = 'compact';
jest.mock('@/theme/useLayoutSize', () => ({
  ...jest.requireActual('@/theme/useLayoutSize'),
  useLayoutSize: () => mockSize,
}));

const overrides = {
  '(app)/pedidos/index': Orders,
  '(app)/pedidos/novo': NewOrder,
  '(app)/pedidos/[id]/index': OrderDetail,
  '(app)/pedidos/[id]/editar': EditOrder,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUTURE = { type: 'cash', dueDates: ['2099-01-10'] };
const INSTALLMENT = [
  { id: 'i1', orderId: 'o1', number: 1, amountCents: 2000, dueDate: '2099-01-10' },
];

beforeEach(() => {
  mockSize = 'compact';
  intentLedger.reset();
  criticalRequest.timeoutMs = 20_000;
});

function world(role: 'administrator' | 'seller' = 'administrator') {
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
    .on('GET', '/api/v1/tenants/current', () => ok(tenant('t1', 'Distribuidora')))
    .on('GET', '/api/v1/categories', () => ok(page([])))
    .on('GET', '/api/v1/users', () =>
      ok({
        items: [
          {
            id: 'u1',
            role: 'administrator',
            status: 'active',
            version: 1,
            createdAt: '2026-10-01T12:00:00.000Z',
            updatedAt: '2026-10-01T12:00:00.000Z',
          },
          {
            id: 'v9abcdef',
            role: 'seller',
            status: 'active',
            version: 1,
            createdAt: '2026-10-01T12:00:00.000Z',
            updatedAt: '2026-10-01T12:00:00.000Z',
          },
        ],
        nextCursor: null,
        pendingInvitations: [],
      }),
    )
    .on('GET', '/api/v1/orders/payment-options/conditions', () => ok(page([])))
    .on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([])))
    .on('GET', '/api/v1/products', () => ok(page([])))
    .on('GET', '/api/v1/inventory', () => ok(page([])))
    .on('GET', '/api/v1/orders/o1/history', () => ok(page([orderEvent('e1')])));
  return { gateway, server };
}

const calls = (server: ReturnType<typeof createFakeApi>, method: string, path: string) =>
  server.calls.filter((c) => c.method === method && c.path === path);

const draft = (o: Record<string, unknown> = {}) =>
  order('o1', {
    lines: [orderLine('p1', '2', 1000)],
    payment: FUTURE,
    installments: INSTALLMENT,
    version: 3,
    ...o,
  });

/* ---------------- Lista ---------------- */

describe('pedidos: lista', () => {
  it('administrador no desktop vê tabela com responsável, situação e total', async () => {
    mockSize = 'expanded';
    const { gateway, server } = world();
    server.on('GET', '/api/v1/orders', () =>
      ok(
        page([
          draft({ customerName: 'Mercado Central' }),
          order('o2', {
            status: 'confirmed',
            sellerUid: 'v9abcdef',
            customerName: 'Padaria Sol',
            lines: [orderLine('p1', '1', 5000)],
          }),
        ]),
      ),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos', overrides });
    expect(await screen.findByText('Mercado Central')).toBeTruthy();
    expect(screen.getByText('Padaria Sol')).toBeTruthy();
    expect(screen.getAllByText('Responsável').length).toBeGreaterThan(0);
    expect(screen.getByText('Vendedor V9ABCD')).toBeTruthy();
    expect(screen.getAllByText('Confirmado').length).toBeGreaterThan(0);
    expect(screen.getByText('R$ 50,00')).toBeTruthy();
    expect(calls(server, 'GET', '/api/v1/orders')[0]!.query).toMatchObject({ direction: 'desc' });
  });

  it('vendedor não vê coluna de responsável', async () => {
    mockSize = 'expanded';
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/orders', () => ok(page([draft()])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos', overrides });
    expect(await screen.findByText('Mercado Central')).toBeTruthy();
    expect(screen.queryByText('Responsável')).toBeNull();
    expect(screen.getByText('Seus pedidos com clientes da sua carteira.')).toBeTruthy();
  });

  it('filtros de situação, cliente e ordem; paginação por cursor', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/orders', (c) =>
        c.query.cursor === 'c2'
          ? ok(page([order('o3', { customerName: 'Terceiro' })]))
          : ok(page([order('o2', { customerName: 'Primeiro' })], 'c2')),
      )
      .on('GET', '/api/v1/customers', () => ok(page([customer('c7', { name: 'Bar do Zé' })])));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/pedidos?situacao=draft',
      overrides,
    });
    expect(await screen.findByText('Primeiro')).toBeTruthy();
    expect(calls(server, 'GET', '/api/v1/orders')[0]!.query.status).toBe('draft');
    await fireEvent.press(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Terceiro')).toBeTruthy();
    expect(calls(server, 'GET', '/api/v1/orders').at(-1)!.query.cursor).toBe('c2');

    await fireEvent.press(screen.getByRole('radio', { name: 'Confirmados' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Mais antigos' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Filtrar por cliente' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Escolher Bar do Zé' }));
    await waitFor(() =>
      expect(calls(server, 'GET', '/api/v1/orders').at(-1)!.query).toMatchObject({
        status: 'confirmed',
        direction: 'asc',
        customerId: 'c7',
      }),
    );
  });

  it('vazio e erro', async () => {
    const { gateway, server } = world();
    let first = true;
    server.on('GET', '/api/v1/orders', () => {
      if (first) {
        first = false;
        return fail(403, 'FORBIDDEN');
      }
      return ok(page([]));
    });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos', overrides });
    expect(
      await screen.findByText('Não foi possível carregar a lista', {}, { timeout: 8000 }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Nenhum pedido ainda')).toBeTruthy();
  }, 15_000);
});

/* ---------------- Criação ---------------- */

describe('pedidos: criação', () => {
  function creationWorld(role: 'administrator' | 'seller' = 'seller') {
    const w = world(role);
    w.server
      .on('GET', '/api/v1/customers', () => ok(page([customer('c1', { name: 'Mercado Central' })])))
      .on('GET', '/api/v1/products', () =>
        ok(
          page([
            product('p1', { name: 'Água 500 ml', priceCents: 250 }),
            product('p2', { name: 'Queijo', unit: 'KG', quantityPrecision: 3, priceCents: 4590 }),
          ]),
        ),
      )
      .on('GET', '/api/v1/inventory', () =>
        ok(page([stockAvailability('p1', '10'), stockAvailability('p2', '0.5', 'KG')])),
      );
    return w;
  }

  async function buildCart() {
    await fireEvent.press(await screen.findByRole('button', { name: 'Escolher Mercado Central' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Adicionar Água 500 ml' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Adicionar Queijo' }));
    const water = screen.getByLabelText('Quantidade de Água 500 ml');
    await fireEvent.changeText(water, '3');
    await fireEvent(water, 'blur');
    const cheese = screen.getByLabelText('Quantidade de Queijo');
    await fireEvent.changeText(cheese, '1,255');
    await fireEvent(cheese, 'blur');
  }

  it('vendedor: cliente, carrinho com UN e KG, prévia, vencimento manual e rascunho', async () => {
    const { gateway, server } = creationWorld();
    let sent: unknown;
    server
      .on('POST', '/api/v1/orders', (c) => {
        sent = c.body;
        return ok(order('o9', { lines: [orderLine('p1', '3', 250)] }), 201);
      })
      .on('GET', '/api/v1/orders/o9/history', () => ok(page([])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/novo', overrides });
    await buildCart();

    // 3 × 2,50 + 1,255 kg × 45,90 (5.760,45 → 5.760) = 65,10
    expect(screen.getByLabelText('Total previsto R$ 65,10')).toBeTruthy();
    expect(screen.getByLabelText('Subtotal R$ 57,60')).toBeTruthy();
    // Disponível conhecido: 0,5 kg < 1,255 kg pedido.
    expect(
      screen.getByText('Disponível agora: 0,5 kg. A confirmação pode ser recusada.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Queijo já está no carrinho' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Revisar pedido' }));
    expect(screen.queryByText('Responsável pelo pedido')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Condição de pagamento: Definir depois'));
    await fireEvent.press(
      await screen.findByRole('radio', { name: /Definir vencimentos manualmente/ }),
    );
    await fireEvent.changeText(screen.getByLabelText('Vencimento'), '10/01/2099');
    await fireEvent.press(screen.getByRole('button', { name: 'Criar rascunho' }));

    expect(await screen.findByRole('header', { name: /PED-O9/ })).toBeTruthy();
    expect(sent).toEqual({
      customerId: 'c1',
      lines: [
        { productId: 'p1', quantity: '3' },
        { productId: 'p2', quantity: '1.255' },
      ],
      notes: '',
      payment: { type: 'cash', dueDates: ['2099-01-10'] },
    });
    expect(calls(server, 'POST', '/api/v1/orders')).toHaveLength(1);
  });

  it('condição cadastrada vai com ID e versão; admin escolhe o responsável', async () => {
    const { gateway, server } = creationWorld('administrator');
    let sent: Record<string, unknown> = {};
    server
      .on('GET', '/api/v1/orders/payment-options/conditions', () =>
        ok(
          page([
            {
              id: 'cond1',
              name: '30/60 dias',
              version: 7,
              schedule: [
                { offsetDays: 30, weight: 1 },
                { offsetDays: 60, weight: 1 },
              ],
            },
          ]),
        ),
      )
      .on('POST', '/api/v1/orders', (c) => {
        sent = c.body as Record<string, unknown>;
        return ok(order('o9'), 201);
      })
      .on('GET', '/api/v1/orders/o9/history', () => ok(page([])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/novo', overrides });
    await fireEvent.press(await screen.findByLabelText('Responsável pelo pedido: Você'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Vendedor V9ABCD' }));
    await buildCart();
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar pedido' }));
    await fireEvent.press(screen.getByLabelText('Condição de pagamento: Definir depois'));
    await fireEvent.press(await screen.findByRole('radio', { name: /30\/60 dias/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Criar rascunho' }));
    await screen.findByRole('header', { name: /PED-O9/ });
    expect(sent).toMatchObject({
      paymentConditionId: 'cond1',
      paymentConditionVersion: 7,
      sellerUid: 'v9abcdef',
    });
    expect(sent).not.toHaveProperty('payment');
  });

  it('vencimento no passado é recusado antes de enviar', async () => {
    const { gateway, server } = creationWorld();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/novo', overrides });
    await buildCart();
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar pedido' }));
    await fireEvent.press(screen.getByLabelText('Condição de pagamento: Definir depois'));
    await fireEvent.press(
      await screen.findByRole('radio', { name: /Definir vencimentos manualmente/ }),
    );
    await fireEvent.changeText(screen.getByLabelText('Vencimento'), '01/01/2000');
    await fireEvent.press(screen.getByRole('button', { name: 'Criar rascunho' }));
    expect(await screen.findByText('O vencimento não pode ser no passado.')).toBeTruthy();
    expect(calls(server, 'POST', '/api/v1/orders')).toHaveLength(0);
  });

  it('criação sem resposta não é repetida e orienta a conferir os rascunhos', async () => {
    const { gateway, server } = creationWorld();
    server.on('POST', '/api/v1/orders', () => {
      throw new TypeError('Network request failed');
    });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/novo', overrides });
    await buildCart();
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar pedido' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Criar rascunho' }));
    expect(await screen.findByText('Não sabemos se o rascunho foi criado')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver rascunhos' })).toBeTruthy();
    expect(calls(server, 'POST', '/api/v1/orders')).toHaveLength(1);
  });

  it('produto desativado entre montagem e gravação é explicado', async () => {
    const { gateway, server } = creationWorld();
    server.on('POST', '/api/v1/orders', () => fail(409, 'PRODUCT_UNAVAILABLE'));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/novo', overrides });
    await buildCart();
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar pedido' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Criar rascunho' }));
    expect(
      await screen.findByText(
        'Um dos produtos foi desativado ou mudou de unidade. Remova-o do carrinho e salve de novo.',
      ),
    ).toBeTruthy();
  });
});

/* ---------------- Edição ---------------- */

describe('pedidos: edição de rascunho', () => {
  it('salva com a versão base e todas as linhas', async () => {
    const { gateway, server } = world();
    let sent: Record<string, unknown> = {};
    server
      .on('GET', '/api/v1/orders/o1', () => ok(draft({ version: 5 })))
      .on('PATCH', '/api/v1/orders/o1', (c) => {
        sent = c.body as Record<string, unknown>;
        return ok(draft({ version: 6 }));
      });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/o1/editar', overrides });
    const qty = await screen.findByLabelText('Quantidade de Produto p1');
    await fireEvent.changeText(qty, '4');
    await fireEvent(qty, 'blur');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar pedido' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await screen.findByRole('header', { name: /PED-O1/ });
    expect(sent).toMatchObject({
      expectedVersion: 5,
      customerId: 'c1',
      lines: [{ productId: 'p1', quantity: '4' }],
      paymentConditionId: null,
      payment: FUTURE,
    });
  });

  it('conflito não sobrescreve: pede para carregar a versão atual', async () => {
    const { gateway, server } = world();
    let version = 5;
    server
      .on('GET', '/api/v1/orders/o1', () =>
        ok(draft({ version, lines: [orderLine('p1', version === 5 ? '2' : '9', 1000)] })),
      )
      .on('PATCH', '/api/v1/orders/o1', () => {
        version = 6;
        return fail(409, 'CONFLICT');
      });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/o1/editar', overrides });
    await screen.findByLabelText('Quantidade de Produto p1');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar pedido' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByRole('button', { name: 'Carregar versão atual' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Carregar versão atual' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Quantidade de Produto p1').props.value).toBe('9'),
    );
  });

  it('pedido confirmado não abre para edição', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/orders/o1', () => ok(draft({ status: 'confirmed' })));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/o1/editar', overrides });
    expect(await screen.findByText('Pedido confirmado não pode ser editado')).toBeTruthy();
    expect(screen.queryByLabelText('Quantidade de Produto p1')).toBeNull();
  });
});

/* ---------------- Confirmação ---------------- */

describe('pedidos: confirmação e reserva', () => {
  async function openAndConfirm(server: ReturnType<typeof createFakeApi>, gateway: FakeGateway) {
    const app = await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/pedidos/o1',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar pedido' }));
    expect(await screen.findByText('Confirmar pedido?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar e reservar' }));
    return app;
  }

  it('confirma com Idempotency-Key e versão; atualiza pedido e invalida estoque', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/orders/o1', () => ok(draft()))
      .on('POST', '/api/v1/orders/o1/confirm', () =>
        ok(
          draft({
            status: 'confirmed',
            version: 4,
            confirmedAt: '2026-10-13T12:00:00.000Z',
            confirmedBy: 'u1',
          }),
        ),
      );
    const app = await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/pedidos/o1',
      overrides,
    });
    const confirmButton = await screen.findByRole('button', { name: 'Confirmar pedido' });
    app.queryClient.setQueryData(['tenant', 't1', 'inventory', 'item', 'p1'], stockAdmin('p1'));
    await fireEvent.press(confirmButton);
    expect(
      screen.getByText(
        'O estoque de todos os itens será reservado agora e os títulos a receber serão gerados. Depois de confirmado, o pedido não pode ser editado.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar e reservar' }));
    expect(await screen.findByText('Estoque reservado')).toBeTruthy();
    const post = calls(server, 'POST', '/api/v1/orders/o1/confirm')[0]!;
    expect(post.body).toEqual({ expectedVersion: 3 });
    expect(post.headers['idempotency-key']).toMatch(UUID);
    expect(post.headers['x-tenant-id']).toBe('t1');
    expect(
      app.queryClient.getQueryState(['tenant', 't1', 'inventory', 'item', 'p1'])?.isInvalidated,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Confirmar pedido' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Registrar saída' })).toBeTruthy();
  });

  it('estoque insuficiente: nada reservado e divergência por item', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/orders/o1', () => ok(draft()))
      .on('POST', '/api/v1/orders/o1/confirm', () => fail(409, 'INSUFFICIENT_STOCK'))
      .on('GET', '/api/v1/inventory/p1', () => ok(stockAdmin('p1', { available: '1' })));
    await openAndConfirm(server, gateway);
    expect(await screen.findByText('Pedido não confirmado')).toBeTruthy();
    expect(
      screen.getByText(/Não há disponível suficiente para reservar todos os itens/),
    ).toBeTruthy();
    expect(await screen.findByText('Produto p1: pedido 2 un, disponível 1 un')).toBeTruthy();
  });

  it.each([
    ['PRODUCT_UNAVAILABLE', 'Um produto foi desativado ou mudou de unidade'],
    ['INVALID_RESERVATION', 'A reserva de estoque deste pedido está inconsistente'],
    ['INVALID_ORDER_STATE', 'O pedido mudou de situação'],
    ['CONFLICT', 'O pedido foi alterado desde que você abriu'],
    ['INCOMPLETE_ORDER', 'precisa de cliente, itens e condição de pagamento'],
  ])('recusa %s é explicada sem sucesso', async (code, text) => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/orders/o1', () => ok(draft()))
      .on('POST', '/api/v1/orders/o1/confirm', () =>
        fail(code === 'INCOMPLETE_ORDER' ? 422 : 409, code),
      );
    await openAndConfirm(server, gateway);
    expect(await screen.findByText(new RegExp(text))).toBeTruthy();
    expect(screen.queryByText('Estoque reservado')).toBeNull();
  });

  it('sem resposta: pendente, ações travadas, repetição com a MESMA chave', async () => {
    const { gateway, server } = world();
    let attempt = 0;
    server
      .on('GET', '/api/v1/orders/o1', () => ok(draft()))
      .on('POST', '/api/v1/orders/o1/confirm', () => {
        if (++attempt === 1) throw new TypeError('Network request failed');
        return ok(
          draft({
            status: 'confirmed',
            version: 4,
            confirmedAt: '2026-10-13T12:00:00.000Z',
            confirmedBy: 'u1',
          }),
        );
      });
    await openAndConfirm(server, gateway);
    expect(await screen.findByText('Não sabemos se o pedido foi confirmado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Editar rascunho' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Estoque reservado')).toBeTruthy();
    const [a, b] = calls(server, 'POST', '/api/v1/orders/o1/confirm') as [Call, Call];
    expect(b.headers['idempotency-key']).toBe(a.headers['idempotency-key']);
    expect(b.body).toEqual(a.body);
  });

  it('resposta perdida depois do commit: a consulta do pedido resolve sem repetir', async () => {
    const { gateway, server } = world();
    let committed = false;
    server
      .on('GET', '/api/v1/orders/o1', () =>
        ok(
          committed
            ? draft({
                status: 'confirmed',
                version: 4,
                confirmedAt: '2026-10-13T12:00:00.000Z',
                confirmedBy: 'u1',
              })
            : draft(),
        ),
      )
      .on('POST', '/api/v1/orders/o1/confirm', () => {
        committed = true; // o servidor gravou...
        throw new TypeError('Network request failed'); // ...mas a resposta se perdeu
      });
    await openAndConfirm(server, gateway);
    expect(await screen.findByText('Estoque reservado')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText('Não sabemos se o pedido foi confirmado')).toBeNull(),
    );
    expect(calls(server, 'POST', '/api/v1/orders/o1/confirm')).toHaveLength(1);
    expect(intentLedger.get('u1:t1:confirm:o1')).toBeUndefined();
  });

  it('timeout é resultado desconhecido', async () => {
    criticalRequest.timeoutMs = 50;
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/orders/o1', () => ok(draft()))
      .on('POST', '/api/v1/orders/o1/confirm', () => new Promise(() => {}));
    await openAndConfirm(server, gateway);
    expect(await screen.findByText('Não sabemos se o pedido foi confirmado')).toBeTruthy();
  });

  it('pendência sobrevive a sair e voltar e é isolada por pedido', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/orders/o1', () => ok(draft()))
      .on('GET', '/api/v1/orders/o2', () =>
        ok(order('o2', { lines: [orderLine('p1')], payment: FUTURE })),
      )
      .on('GET', '/api/v1/orders/o2/history', () => ok(page([])))
      .on('POST', '/api/v1/orders/o1/confirm', () => fail(503, 'UNAVAILABLE'));
    await openAndConfirm(server, gateway);
    expect(await screen.findByText('Não sabemos se o pedido foi confirmado')).toBeTruthy();
    await act(async () => router.navigate('/pedidos/o2' as Href));
    expect(await screen.findByRole('header', { name: /PED-O2/ })).toBeTruthy();
    expect(screen.queryByText('Não sabemos se o pedido foi confirmado')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeEnabled();
    await act(async () => router.navigate('/pedidos/o1' as Href));
    expect(await screen.findByText('Não sabemos se o pedido foi confirmado')).toBeTruthy();
  });
});

/* ---------------- Expedição e cancelamento ---------------- */

describe('pedidos: expedição e cancelamento', () => {
  const confirmed = (o: Record<string, unknown> = {}) =>
    draft({
      status: 'confirmed',
      version: 4,
      confirmedAt: '2026-10-13T12:00:00.000Z',
      confirmedBy: 'u1',
      ...o,
    });

  it('vendedor expede o próprio pedido (idempotente) e não vê cancelar', async () => {
    const { gateway, server } = world('seller');
    server
      .on('GET', '/api/v1/orders/o1', () => ok(confirmed()))
      .on('POST', '/api/v1/orders/o1/dispatch', () =>
        ok(
          confirmed({
            status: 'dispatched',
            version: 5,
            dispatchedAt: '2026-10-13T13:00:00.000Z',
            dispatchedBy: 'u1',
          }),
        ),
      );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/o1', overrides });
    await screen.findByRole('button', { name: 'Registrar saída' });
    expect(screen.queryByRole('button', { name: 'Cancelar pedido' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar saída' }));
    expect(await screen.findByText(/Os produtos sairão do estoque físico/)).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Registrar saída' }).at(-1)!);
    expect(await screen.findByText('Expedido')).toBeTruthy();
    const post = calls(server, 'POST', '/api/v1/orders/o1/dispatch')[0]!;
    expect(post.body).toEqual({ expectedVersion: 4 });
    expect(post.headers['idempotency-key']).toMatch(UUID);
    // Vendedor não consulta financeiro.
    expect(calls(server, 'GET', '/api/v1/orders/o1/financial-state')).toHaveLength(0);
  });

  it('administrador cancela com motivo obrigatório', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/orders/o1', () => ok(confirmed()))
      .on('POST', '/api/v1/orders/o1/cancel', () =>
        ok(
          confirmed({
            status: 'canceled',
            version: 5,
            canceledAt: '2026-10-13T13:00:00.000Z',
            canceledBy: 'u1',
          }),
        ),
      );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/o1', overrides });
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancelar pedido' }));
    expect(await screen.findByText(/Não há estorno bancário automático/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Motivo do cancelamento'), 'ab');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Cancelar pedido' }).at(-1)!);
    expect(calls(server, 'POST', '/api/v1/orders/o1/cancel')).toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText('Motivo do cancelamento'), 'Cliente desistiu');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Cancelar pedido' }).at(-1)!);
    expect((await screen.findAllByText('Cancelado')).length).toBeGreaterThan(0);
    expect(calls(server, 'POST', '/api/v1/orders/o1/cancel')[0]!.body).toEqual({
      expectedVersion: 4,
      reason: 'Cliente desistiu',
    });
  });

  it('pedido com recebimentos: cancelamento exige fluxo financeiro, nada cancelado', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/orders/o1', () => ok(confirmed()))
      .on('POST', '/api/v1/orders/o1/cancel', () => fail(409, 'FINANCIAL_CANCELLATION_REQUIRED'));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/o1', overrides });
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancelar pedido' }));
    await fireEvent.changeText(
      await screen.findByLabelText('Motivo do cancelamento'),
      'Cliente desistiu',
    );
    await fireEvent.press(screen.getAllByRole('button', { name: 'Cancelar pedido' }).at(-1)!);
    expect(await screen.findByText(/precisa do fluxo financeiro administrativo/)).toBeTruthy();
    expect(screen.queryByText('Cancelado')).toBeNull();
    expect(calls(server, 'POST', '/api/v1/orders/o1/cancel')).toHaveLength(1);
  });

  it('execução financeira aceita aparece como em andamento, nunca concluída', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/orders/o1', () => ok(confirmed()))
      .on('GET', '/api/v1/orders/o1/financial-state', () =>
        ok({
          orderId: 'o1',
          cashReceivedCents: 1000,
          cashSettledCents: 1000,
          creditSettledCents: 0,
          transferredCashCents: 0,
          canceledCents: 0,
          activeReturnCount: 0,
          orderVersion: 4,
          guardVersion: 2,
          financialVersion: 2,
          titles: [
            {
              id: 't1',
              installmentNumber: 1,
              dueDate: '2099-01-10',
              originalCents: 2000,
              outstandingCents: 1000,
              status: 'partially_paid',
            },
          ],
        }),
      )
      .on('GET', '/api/v1/financial-executions', () =>
        ok(
          page([
            {
              id: 'x1',
              orderId: 'o1',
              kind: 'cancellation',
              status: 'ACCEPTED',
              financialCompleted: false,
              publishedAt: null,
            },
          ]),
        ),
      );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/o1', overrides });
    expect(await screen.findByText('Operação financeira em andamento')).toBeTruthy();
    expect(screen.getByText(/Aceita, aguardando processamento/)).toBeTruthy();
    expect(screen.getByText('Parcialmente pago')).toBeTruthy();
    expect(screen.queryByText(/concluído/)).toBeNull();
    expect(calls(server, 'GET', '/api/v1/financial-executions')[0]!.query.orderId).toBe('o1');
  });

  it('histórico mostra eventos, responsável neutro e motivo', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/orders/o1', () => ok(confirmed({ status: 'canceled' })))
      .on('GET', '/api/v1/orders/o1/history', () =>
        ok(
          page([
            orderEvent('e1'),
            orderEvent('e2', {
              type: 'confirmed',
              version: 4,
              previousStatus: 'draft',
              status: 'confirmed',
              actorUid: 'v9abcdef',
            }),
            orderEvent('e3', {
              type: 'canceled',
              version: 5,
              status: 'canceled',
              reason: 'Cliente desistiu',
            }),
          ]),
        ),
      );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/o1', overrides });
    await fireEvent.press(await screen.findByRole('button', { name: 'Histórico do pedido' }));
    expect(await screen.findByText('Pedido confirmado (estoque reservado)')).toBeTruthy();
    expect(screen.getByText(/Usuário V9ABCD/)).toBeTruthy();
    expect(screen.getByText('Motivo: Cliente desistiu')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Registrar saída' })).toBeNull();
  });
});

/* ---------------- Permissões e empresa ---------------- */

describe('pedidos: permissões e empresa', () => {
  it('Super Admin sem vínculo não chega aos pedidos', async () => {
    const gateway = new FakeGateway({
      initialUser: { uid: 'root', email: 'root@lastro.test', emailVerified: true },
    });
    const server = createFakeApi().on('GET', '/api/v1/me', () =>
      ok({ uid: 'root', email: 'root@lastro.test', platformAdmin: true, memberships: [] }),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos', overrides });
    expect(await screen.findByText('tela:plataforma')).toBeTruthy();
    expect(server.calls.some((c) => c.path.startsWith('/api/v1/orders'))).toBe(false);
  });

  it('pedido fora da carteira aparece como não encontrado', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/orders/o1', () => fail(404, 'RESOURCE_NOT_FOUND'));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/o1', overrides });
    expect(await screen.findByText('Cadastro não encontrado')).toBeTruthy();
  });

  it('trocar de empresa isola lista e intenções pendentes', async () => {
    function Choose() {
      const session = useSession();
      const r = useRouter();
      return (
        <>
          {['t1', 't2'].map((t) => (
            <Pressable
              key={t}
              accessibilityRole="button"
              onPress={() => {
                session.selectTenant(t);
                r.replace('/pedidos');
              }}
            >
              <Text>{`usar ${t}`}</Text>
            </Pressable>
          ))}
        </>
      );
    }
    const gateway = new FakeGateway({
      initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
    });
    let release: () => void = () => {};
    const ready = new Promise<void>((r) => (release = r));
    const server = createFakeApi()
      .on('GET', '/api/v1/me', () =>
        ok({
          uid: 'u1',
          email: 'ana@lastro.test',
          platformAdmin: false,
          memberships: [membership('t1'), membership('t2', 'seller')],
        }),
      )
      .on('GET', '/api/v1/orders', async (c) => {
        if (c.headers['x-tenant-id'] === 't2') {
          await ready;
          return ok(page([order('b1', { customerName: 'Cliente da Empresa B' })]));
        }
        return ok(page([order('a1', { customerName: 'Cliente da Empresa A' })]));
      });
    await renderApp({
      gateway,
      fetch: server.fetch,
      overrides: { ...overrides, empresas: Choose },
    });
    await fireEvent.press(await screen.findByText('usar t1'));
    expect(await screen.findByText('Cliente da Empresa A')).toBeTruthy();
    intentLedger.keyFor('u1:t1:confirm:a1', { expectedVersion: 1 });
    intentLedger.markUnknown('u1:t1:confirm:a1');
    await act(async () => router.navigate('/empresas'));
    await fireEvent.press(await screen.findByText('usar t2'));
    await waitFor(() => expect(screen.queryByText('Cliente da Empresa A')).toBeNull());
    await act(async () => release());
    expect(await screen.findByText('Cliente da Empresa B')).toBeTruthy();
    expect(calls(server, 'GET', '/api/v1/orders').at(-1)!.headers['x-tenant-id']).toBe('t2');
    expect(intentLedger.get('u1:t2:confirm:a1')).toBeUndefined();
  });
});

/* ---------------- Carrinhos grandes ---------------- */

describe('pedidos: carrinhos grandes', () => {
  it.each([1, 20, 50, 100, 200])(
    'rascunho com %i produtos edita, consulta disponível com limite e salva todas as linhas',
    async (n) => {
      const { gateway, server } = world();
      const lines = Array.from({ length: n }, (_, i) => orderLine(`p${i + 1}`, '1', 100 + i));
      let saved: { lines: unknown[] } | undefined;
      let stockCalls = 0;
      server
        .on('GET', '/api/v1/orders/o1', () => ok(draft({ lines })))
        .on('PATCH', '/api/v1/orders/o1', (c) => {
          saved = c.body as { lines: unknown[] };
          return ok(draft({ lines, version: 4 }));
        });
      for (let i = 1; i <= n; i++)
        server.on('GET', `/api/v1/inventory/p${i}`, () => {
          stockCalls++;
          return ok(stockAvailability(`p${i}`, '100'));
        });
      await renderApp({
        gateway,
        fetch: server.fetch,
        initialUrl: '/pedidos/o1/editar',
        overrides,
      });
      expect(await screen.findByText(`Carrinho (${n} ${n === 1 ? 'item' : 'itens'})`)).toBeTruthy();
      expect(screen.getAllByLabelText(/^Remover Produto p/)).toHaveLength(n);

      const last = screen.getByLabelText(`Quantidade de Produto p${n}`);
      await fireEvent.changeText(last, '7');
      await fireEvent(last, 'blur');
      // Prévia: soma de (100 + i) centavos, com a última linha ×7.
      const expected = lines.reduce((a, l, i) => a + l.unitPriceCents * (i === n - 1 ? 7 : 1), 0);
      expect(
        screen.getByLabelText(
          `Total previsto ${`R$ ${Math.trunc(expected / 100).toLocaleString('pt-BR')},${String(expected % 100).padStart(2, '0')}`}`,
        ),
      ).toBeTruthy();

      await fireEvent.press(screen.getByRole('button', { name: 'Revisar pedido' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Salvar rascunho' }));
      await screen.findByRole('header', { name: /PED-O1/ });
      expect(saved?.lines).toHaveLength(n);
      expect(saved?.lines.at(-1)).toEqual({ productId: `p${n}`, quantity: '7' });
      // Até 50 itens consulta o disponível de cada produto; acima disso, não dispara centenas de chamadas.
      expect(stockCalls).toBe(n <= 50 ? n : 0);
    },
    60_000,
  );
});
