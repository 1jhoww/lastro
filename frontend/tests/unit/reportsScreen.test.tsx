import { fireEvent, screen } from 'expo-router/testing-library';
import Reports from '@/app/(app)/relatorios/index';
import { createFakeApi, membership, ok, page, tenant } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const view = (report: string, title: string) => ({
  report,
  category: 'commercial',
  title,
  description: 'Pedidos confirmados ou expedidos, pela data de confirmação.',
  company: 'Distribuidora Sol',
  timezone: 'America/Sao_Paulo',
  generatedAt: '2026-10-16T12:00:00.000Z',
  period: { from: '2026-10-01', to: '2026-10-16', basis: 'Data de confirmação do pedido' },
  filters: [],
  summary: [
    { key: 'net', label: 'Vendas', kind: 'money', value: 123456, tone: 'default', caption: null },
    {
      key: 'orders',
      label: 'Pedidos vendidos',
      kind: 'count',
      value: 2,
      tone: 'default',
      caption: null,
    },
  ],
  columns: [
    { key: 'customer', label: 'Cliente', kind: 'text', align: 'left' },
    { key: 'net', label: 'Vendas', kind: 'money', align: 'right' },
  ],
  rows: [
    { cells: { customer: 'Mercado Bom Preço', net: 123456 }, link: { kind: 'customer', id: 'c1' } },
  ],
  chart: null,
  notes: ['Valor vendido não é dinheiro recebido.'],
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
        name: 'Ana',
        platformAdmin: false,
        memberships: [membership('t1', role)],
      }),
    )
    .on('GET', '/api/v1/tenants/current', () => ok(tenant('t1', 'Distribuidora Sol')))
    .on('GET', '/api/v1/users', () => ok(page([])))
    .on('GET', '/api/v1/reports/sales-period', () => ok(view('sales-period', 'Vendas por período')))
    .on('GET', '/api/v1/reports/sales-customers', () =>
      ok(view('sales-customers', 'Vendas por cliente')),
    );
  return { gateway, server };
}
const overrides = { '(app)/relatorios/index': Reports };

describe('relatórios', () => {
  it('mostra categorias, indicadores e linhas do servidor com valores em reais', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/relatorios', overrides });
    expect(await screen.findByLabelText('Vendas: R$ 1.234,56')).toBeTruthy();
    expect(screen.getByText('Comercial')).toBeTruthy();
    expect(screen.getByText('Financeiro')).toBeTruthy();
    expect(screen.getByText('Estoque')).toBeTruthy();
    expect(screen.getByText('Mercado Bom Preço')).toBeTruthy();
    expect(screen.getByText('Valor vendido não é dinheiro recebido.')).toBeTruthy();
    expect(screen.getByLabelText('Exportar Vendas por período em CSV')).toBeTruthy();
    // Período padrão não vai na consulta: o servidor decide e devolve o período usado.
    const first = server.calls.find((c) => c.path === '/api/v1/reports/sales-period')!;
    expect(first.query).toEqual({});
    await fireEvent.press(screen.getByText('Por cliente'));
    expect(await screen.findByText('Vendas por cliente')).toBeTruthy();
    expect(server.calls.some((c) => c.path === '/api/v1/reports/sales-customers')).toBe(true);
  });
  it('vendedor não acessa relatórios', async () => {
    const { gateway, server } = world('seller');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/relatorios', overrides });
    expect(await screen.findByText(/Relatórios e catálogo/)).toBeTruthy();
    expect(server.calls.some((c) => c.path.startsWith('/api/v1/reports'))).toBe(false);
  });
});
