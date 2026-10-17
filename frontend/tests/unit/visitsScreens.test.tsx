import { Text } from 'react-native';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import CustomerDetail from '@/app/(app)/clientes/[id]/index';
import OrderDetail from '@/app/(app)/pedidos/[id]/index';
import Visits from '@/app/(app)/visitas/index';
import NewVisit from '@/app/(app)/visitas/nova';
import Repurchase from '@/app/(app)/visitas/recompra';
import { todayIn } from '@/features/orders/rules';
import { visibleDestinations } from '@/navigation/destinations';
import {
  createFakeApi,
  customer,
  membership,
  ok,
  order,
  orderEvent,
  orderLine,
  page,
  tenant,
} from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

let mockSize: 'compact' | 'medium' | 'expanded' = 'expanded';
jest.mock('@/theme/useLayoutSize', () => ({
  ...jest.requireActual('@/theme/useLayoutSize'),
  useLayoutSize: () => mockSize,
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = todayIn('America/Sao_Paulo');

const visit = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  customerId: 'c1',
  customerName: 'Mercado Sol',
  source: 'manual',
  kind: 'in_person',
  visitDate: '2026-10-15',
  responsibleUid: 'u1',
  responsibleName: 'Ana',
  notes: 'Apresentou a linha nova',
  orderId: null,
  orderCommercialId: null,
  orderAccessible: false,
  createdAt: '2026-10-15T12:00:00.000Z',
  createdBy: 'u1',
  ...overrides,
});
const delivery = visit('v2', {
  source: 'automatic',
  kind: 'delivery',
  visitDate: '2026-10-16',
  responsibleUid: 'v9abcdef',
  responsibleName: 'Bruno',
  notes: 'Recebido por Maria.',
  orderId: 'o1',
  orderCommercialId: 'PED-ABCDEF123456',
  orderAccessible: true,
  createdBy: 'u1',
});

const CustomerMarker = () => <Text>tela:cliente</Text>;
const overrides = {
  '(app)/visitas/index': Visits,
  '(app)/visitas/nova': NewVisit,
  '(app)/visitas/recompra': Repurchase,
  '(app)/clientes/[id]/index': CustomerMarker,
};

function world(role: 'administrator' | 'seller' = 'administrator', permissions?: string[]) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const base = membership('t1', role);
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        name: 'Ana',
        platformAdmin: false,
        memberships: [{ ...base, permissions: permissions ?? base.permissions }],
      }),
    )
    .on('GET', '/api/v1/tenants/current', () => ok(tenant('t1', 'Distribuidora Sol')))
    .on('GET', '/api/v1/users', () => ok({ ...page([]), pendingInvitations: [] }))
    .on('GET', '/api/v1/categories', () => ok(page([])))
    .on('GET', '/api/v1/products', () => ok(page([])))
    .on('GET', '/api/v1/inventory', () => ok(page([])))
    .on('GET', '/api/v1/orders/payment-options/conditions', () => ok(page([])))
    .on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([])));
  return { gateway, server };
}
const calls = (server: ReturnType<typeof createFakeApi>, method: string, path: string) =>
  server.calls.filter((c) => c.method === method && c.path === path);

beforeEach(() => {
  mockSize = 'expanded';
});

describe('visitas: lista', () => {
  it('distingue visita manual de entrega automática e liga o pedido acessível', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/visits', () => ok(page([delivery, visit('v1')])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/visitas', overrides });
    expect(await screen.findByText('Visita presencial')).toBeTruthy();
    expect(screen.getByText('Entrega confirmada')).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.getByText('Automático')).toBeTruthy();
    // A entrega nunca aparece como visita presencial.
    expect(screen.getAllByText('Visita presencial')).toHaveLength(1);
    expect(screen.getByLabelText('Abrir pedido PED-ABCDEF12')).toBeTruthy();
    expect(screen.getByText('Bruno')).toBeTruthy();
  });

  it('filtro de origem envia source ao servidor', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/visits', () => ok(page([])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/visitas', overrides });
    expect(await screen.findByText('Nenhuma visita registrada')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Entregas' }));
    await waitFor(() =>
      expect(calls(server, 'GET', '/api/v1/visits').at(-1)!.query.source).toBe('automatic'),
    );
    expect(await screen.findByText('Nenhum registro encontrado')).toBeTruthy();
  });

  it('sem a permissão do plano, a área não abre nem consulta o servidor', async () => {
    const seller = membership('t1', 'seller').permissions.filter((p) => p !== 'visits:own:manage');
    const { gateway, server } = world('seller', seller);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/visitas', overrides });
    expect(await screen.findByText('Você não tem acesso a esta área')).toBeTruthy();
    expect(calls(server, 'GET', '/api/v1/visits')).toHaveLength(0);
    expect(visibleDestinations(seller).map((d) => d.key)).not.toContain('visitas');
    expect(visibleDestinations(membership('t1', 'seller').permissions).map((d) => d.key)).toContain(
      'visitas',
    );
  });
});

describe('visitas: registro manual', () => {
  it('vendedor registra sem responsável nem pedido, com Idempotency-Key, e volta para a ficha', async () => {
    const { gateway, server } = world('seller');
    server
      .on('GET', '/api/v1/customers/c1', () =>
        ok(customer('c1', { name: 'Mercado Sol', assignedTo: 'u1' })),
      )
      .on('GET', '/api/v1/orders', () => ok(page([])))
      .on('POST', '/api/v1/visits', () => ok(visit('v1'), 201));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/visitas/nova?customerId=c1',
      overrides,
    });
    expect(await screen.findByText('Mercado Sol')).toBeTruthy();
    expect(screen.getByText('O atendimento fica registrado em seu nome.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar visita' }));
    expect(
      await screen.findByText('Descreva o atendimento com pelo menos 3 caracteres.'),
    ).toBeTruthy();
    expect(calls(server, 'POST', '/api/v1/visits')).toHaveLength(0);
    await fireEvent.changeText(
      screen.getByLabelText('Observações do atendimento'),
      'Apresentou a linha nova',
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Contato remoto' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar visita' }));
    expect(await screen.findByText('tela:cliente')).toBeTruthy();
    const post = calls(server, 'POST', '/api/v1/visits')[0]!;
    expect(post.body).toEqual({
      customerId: 'c1',
      visitDate: today,
      kind: 'remote',
      notes: 'Apresentou a linha nova',
    });
    expect(post.headers['idempotency-key']).toMatch(UUID);
  });
});

describe('visitas: recompra', () => {
  const row = (customerId: string, overrides: Record<string, unknown>) => ({
    customerId,
    customerName: `Cliente ${customerId}`,
    sellerUid: 'v9abcdef',
    sellerName: 'Bruno',
    lastPurchaseOn: '2026-09-01',
    purchaseCount: 3,
    frequencyDays: 30,
    nextEstimatedOn: '2026-10-01',
    status: 'overdue',
    daysFromEstimate: 5,
    ...overrides,
  });

  it('mostra última compra, frequência, estimativa e situação, sem prometer pedido', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/repurchase', () =>
      ok({
        items: [
          row('c1', {}),
          row('c2', { status: 'on_track', nextEstimatedOn: '2026-10-20', daysFromEstimate: -3 }),
          row('c3', {
            status: 'insufficient_history',
            frequencyDays: null,
            nextEstimatedOn: null,
            daysFromEstimate: null,
            purchaseCount: 1,
          }),
        ],
        nextCursor: null,
        totals: { insufficient_history: 1, on_track: 1, overdue: 1 },
        lookbackDays: 365,
        minimumPurchases: 3,
        generatedAt: '2026-10-17T12:00:00.000Z',
      }),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/visitas/recompra', overrides });
    expect(await screen.findByText('01/10/2026 · vencida há 5 dias')).toBeTruthy();
    expect(screen.getByText('20/10/2026 · em 3 dias')).toBeTruthy();
    expect(screen.getByText('Histórico insuficiente')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Estimativa vencida (1)' })).toBeTruthy();
    expect(screen.getAllByText('A cada 30 dias').length).toBe(2);
    expect(screen.getByText(/não uma data garantida/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Estimativa vencida (1)' }));
    await waitFor(() =>
      expect(calls(server, 'GET', '/api/v1/repurchase').at(-1)!.query.status).toBe('overdue'),
    );
  });
});

describe('visitas: integração com cliente e pedido', () => {
  it('ficha do cliente separa última compra, última entrega e estimativa', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/customers/c1', () => ok(customer('c1', { name: 'Mercado Sol' })))
      .on('GET', '/api/v1/customers/c1/repurchase', () =>
        ok({
          customerId: 'c1',
          lastPurchaseOn: '2026-10-10',
          lastDeliveryOn: '2026-10-02',
          purchaseCount: 4,
          frequencyDays: 30,
          nextEstimatedOn: '2026-11-09',
          status: 'on_track',
          daysFromEstimate: -23,
          lookbackDays: 365,
          minimumPurchases: 3,
        }),
      )
      .on('GET', '/api/v1/customers/c1/timeline', () =>
        ok({
          customerId: 'c1',
          hasMore: false,
          items: [
            {
              id: 'purchase-o2',
              type: 'purchase',
              date: '2026-10-10',
              responsibleUid: 'v9abcdef',
              responsibleName: 'Bruno',
              kind: null,
              notes: null,
              order: {
                id: 'o2',
                commercialId: 'PED-ZZZ111222333',
                status: 'confirmed',
                accessible: false,
              },
            },
            {
              id: 'v1',
              type: 'visit',
              date: '2026-10-05',
              responsibleUid: 'u1',
              responsibleName: 'Ana',
              kind: 'in_person',
              notes: 'Apresentou a linha nova',
              order: null,
            },
          ],
        }),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/clientes/c1',
      overrides: { ...overrides, '(app)/clientes/[id]/index': CustomerDetail },
    });
    // Última compra no painel e a compra no histórico.
    expect((await screen.findAllByText('10/10/2026')).length).toBe(2);
    expect(screen.getByText('Última compra (pedido confirmado)')).toBeTruthy();
    expect(screen.getByText('02/10/2026')).toBeTruthy();
    expect(screen.getByText('09/11/2026 · em 23 dias')).toBeTruthy();
    expect(screen.getByText('Dentro do intervalo')).toBeTruthy();
    expect(await screen.findByText('Compra confirmada')).toBeTruthy();
    expect(screen.getByText('Visita manual')).toBeTruthy();
    // Pedido de outro vendedor: aparece no histórico, sem link.
    expect(screen.getByText('Pedido PED-ZZZ11122')).toBeTruthy();
    expect(screen.queryByLabelText('Abrir pedido PED-ZZZ11122')).toBeNull();
  });

  it('pedido expedido oferece confirmar entrega; pedido confirmado não', async () => {
    const { gateway, server } = world('seller');
    const dispatched = order('o1', {
      lines: [orderLine('p1', '2', 1000)],
      payment: { type: 'cash', dueDates: ['2099-01-10'] },
      installments: [
        { id: 'i1', orderId: 'o1', number: 1, amountCents: 2000, dueDate: '2099-01-10' },
      ],
      status: 'dispatched',
      version: 5,
      confirmedAt: '2026-10-13T12:00:00.000Z',
      confirmedBy: 'u1',
      dispatchedAt: `${today}T12:00:00.000Z`,
      dispatchedBy: 'u1',
    });
    server
      .on('GET', '/api/v1/orders/o1', () => ok(dispatched))
      .on('GET', '/api/v1/orders/o1/history', () => ok(page([orderEvent('e1')])))
      .on('GET', '/api/v1/orders/o1/delivery', () => ok({ delivery: null }))
      .on('POST', '/api/v1/orders/o1/delivery', (c) =>
        ok({
          orderId: 'o1',
          orderCommercialId: dispatched.commercialId,
          customerId: 'c1',
          sellerUid: 'u1',
          deliveredOn: (c.body as { deliveredOn: string }).deliveredOn,
          receivedBy: 'Maria',
          notes: '',
          confirmedAt: `${today}T15:00:00.000Z`,
          confirmedBy: 'u1',
          visitId: 'v2',
        }),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/pedidos/o1',
      overrides: { '(app)/pedidos/[id]/index': OrderDetail },
    });
    expect(await screen.findByText(/entrega ainda não confirmada/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar entrega' }));
    expect(await screen.findByText(/Não altera o pedido, o estoque nem o financeiro/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Recebido por'), 'Maria');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Confirmar entrega' }).at(-1)!);
    expect(await screen.findByText('Recebido por')).toBeTruthy();
    expect(screen.getByText('Maria')).toBeTruthy();
    expect(calls(server, 'POST', '/api/v1/orders/o1/delivery')[0]!.body).toEqual({
      deliveredOn: today,
      receivedBy: 'Maria',
    });
  });
});
