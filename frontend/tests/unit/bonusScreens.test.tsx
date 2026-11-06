import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Bonuses from '@/app/(app)/bonificacoes/index';
import NewBonus from '@/app/(app)/bonificacoes/nova';
import BonusDetail from '@/app/(app)/bonificacoes/[id]';
import OrderDetail from '@/app/(app)/pedidos/[id]/index';
import NewOrder from '@/app/(app)/pedidos/novo';
import {
  createFakeApi,
  customer,
  membership,
  ok,
  order,
  orderEvent,
  orderLine,
  page,
  product,
  stockAvailability,
  tenant,
} from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

jest.mock('@/theme/useLayoutSize', () => ({
  ...jest.requireActual('@/theme/useLayoutSize'),
  useLayoutSize: () => 'expanded',
}));

const overrides = {
  '(app)/bonificacoes/index': Bonuses,
  '(app)/bonificacoes/nova': NewBonus,
  '(app)/bonificacoes/[id]': BonusDetail,
  '(app)/pedidos/novo': NewOrder,
  '(app)/pedidos/[id]/index': OrderDetail,
};

const line = {
  id: 'l1',
  productId: 'p1',
  name: 'Água 500 ml',
  sku: 'AG-1',
  unit: 'UN',
  quantity: '3',
  returnedSellable: '0',
  returnedDamaged: '0',
};
const bonus = (overrides: Record<string, unknown> = {}) => ({
  id: 'b1',
  commercialId: 'BON-B1000000-0000-4000-8000-000000000000',
  kind: 'standalone',
  orderId: null,
  orderCommercialId: null,
  customerId: 'c1',
  customerName: 'Mercado Central',
  responsibleUid: 'u1',
  responsibleName: 'Ana',
  status: 'dispatched',
  lines: [line],
  reason: 'sample',
  reasonDetail: null,
  notes: '',
  occurredAt: '2026-11-06T12:00:00.000Z',
  dispatchedAt: '2026-11-06T12:00:00.000Z',
  canceledAt: null,
  canceledBy: null,
  version: 1,
  createdAt: '2026-11-06T12:00:00.000Z',
  createdBy: 'u1',
  updatedAt: '2026-11-06T12:00:00.000Z',
  updatedBy: 'u1',
  cost: null,
  history: [],
  ...overrides,
});

function world(role: 'administrator' | 'seller', grant = true) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const base = membership('t1', role);
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [
          {
            ...base,
            permissions: grant
              ? [...base.permissions, 'bonuses:grant']
              : base.permissions.filter((p: string) => p !== 'bonuses:grant'),
          },
        ],
      }),
    )
    .on('GET', '/api/v1/tenants/current', () => ok(tenant('t1', 'Distribuidora')))
    .on('GET', '/api/v1/categories', () => ok(page([])))
    .on('GET', '/api/v1/users', () => ok({ ...page([]), pendingInvitations: [] }))
    .on('GET', '/api/v1/orders/payment-options/conditions', () => ok(page([])))
    .on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([])))
    .on('GET', '/api/v1/customers', () => ok(page([customer('c1', { name: 'Mercado Central' })])))
    .on('GET', '/api/v1/products', () =>
      ok(page([product('p1', { name: 'Água 500 ml', priceCents: 250 })])),
    )
    .on('GET', '/api/v1/inventory', () => ok(page([stockAvailability('p1', '10')])));
  return { gateway, server };
}

describe('Bonificações', () => {
  it('Novo pedido oferece a bonificação para quem pode conceder', async () => {
    const allowed = world('seller');
    await renderApp({
      gateway: allowed.gateway,
      fetch: allowed.server.fetch,
      initialUrl: '/pedidos/novo',
      overrides,
    });
    const offer = await screen.findByRole('button', { name: 'Adicionar bonificação' });
    await fireEvent.press(offer);
    expect(await screen.findByText('Bonificação · sem cobrança')).toBeTruthy();
  });

  it('Novo pedido não mostra a bonificação sem a permissão', async () => {
    const denied = world('seller', false);
    await renderApp({
      gateway: denied.gateway,
      fetch: denied.server.fetch,
      initialUrl: '/pedidos/novo',
      overrides,
    });
    await screen.findByRole('button', { name: 'Salvar rascunho' });
    expect(screen.queryByRole('button', { name: 'Adicionar bonificação' })).toBeNull();
  });

  it('avulsa: resumo antes de movimentar; a saída só vai ao servidor na confirmação', async () => {
    const { gateway, server } = world('administrator');
    let sent: unknown;
    let key: string | null = null;
    server
      .on('POST', '/api/v1/bonuses', (c) => {
        sent = c.body;
        key = c.headers['idempotency-key'] ?? null;
        return ok(bonus(), 201);
      })
      .on('GET', '/api/v1/bonuses/b1', () => ok(bonus()));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/bonificacoes/nova', overrides });
    await fireEvent(await screen.findByLabelText('Cliente'), 'focus');
    await fireEvent.press(await screen.findByRole('button', { name: 'Escolher Mercado Central' }));
    const input = (await screen.findAllByLabelText('Quantidade de Água 500 ml'))[0]!;
    await fireEvent.changeText(input, '3');
    await fireEvent(input, 'blur');
    await fireEvent.press(await screen.findByLabelText(/^Motivo/));
    await fireEvent.press(await screen.findByRole('radio', { name: /Amostra/ }));

    await fireEvent.press(screen.getByRole('button', { name: 'Revisar bonificação' }));
    expect(await screen.findByText('Confirmar bonificação?')).toBeTruthy();
    expect(screen.getByLabelText('Resumo da bonificação')).toBeTruthy();
    expect(server.calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar e dar saída' }));
    await waitFor(() => expect(sent).toBeTruthy());
    expect(sent).toEqual({
      customerId: 'c1',
      lines: [{ productId: 'p1', quantity: '3' }],
      reason: 'sample',
    });
    expect(key).toBeTruthy();
    expect(await screen.findByRole('header', { name: /BON-B1000000/ })).toBeTruthy();
  });

  it('ficha do pedido separa o bonificado, sem valor, e mantém o total', async () => {
    const { gateway, server } = world('administrator');
    const o1 = order('o1', {
      lines: [orderLine('p1', '2', 1000)],
      bonus: {
        id: 'o1',
        commercialId: 'BON-O1-0000-4000-8000-000000000000',
        status: 'confirmed',
        lines: [line],
        reason: null,
        reasonDetail: null,
      },
    });
    server
      .on('GET', '/api/v1/orders/o1', () => ok(o1))
      .on('GET', '/api/v1/orders/o1/history', () => ok(page([orderEvent('e1')])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/pedidos/o1', overrides });
    expect(await screen.findByText('Bonificação (1)')).toBeTruthy();
    expect(screen.getByLabelText('Itens bonificados')).toBeTruthy();
    expect(screen.getByText('Sem cobrança')).toBeTruthy();
    expect(screen.getAllByText('R$ 20,00').length).toBeGreaterThan(0);
  });

  it('administrador vê retorno e, quando o servidor envia, o custo', async () => {
    const admin = world('administrator');
    admin.server.on('GET', '/api/v1/bonuses/b1', () =>
      ok(
        bonus({
          cost: {
            grossCents: 1500,
            netCents: 1500,
            missingLines: 0,
            lines: [{ lineId: 'l1', costCents: 1500 }],
          },
        }),
      ),
    );
    await renderApp({
      gateway: admin.gateway,
      fetch: admin.server.fetch,
      initialUrl: '/bonificacoes/b1',
      overrides,
    });
    expect(await screen.findByText('Registrar retorno')).toBeTruthy();
    expect(screen.getByText('Custo das unidades')).toBeTruthy();
  });

  it('vendedor não vê retorno nem custo', async () => {
    const seller = world('seller');
    seller.server.on('GET', '/api/v1/bonuses/b1', () => ok(bonus()));
    await renderApp({
      gateway: seller.gateway,
      fetch: seller.server.fetch,
      initialUrl: '/bonificacoes/b1',
      overrides,
    });
    await screen.findByText('Registro');
    expect(screen.queryByText('Registrar retorno')).toBeNull();
    expect(screen.queryByText('Custo das unidades')).toBeNull();
  });

  it('histórico lista bonificações e leva à nova, separada do Novo pedido', async () => {
    const { gateway, server } = world('administrator');
    server.on('GET', '/api/v1/bonuses', () => ok(page([bonus()])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/bonificacoes', overrides });
    expect(await screen.findByText('Mercado Central')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nova bonificação' })).toBeTruthy();
  });
});
