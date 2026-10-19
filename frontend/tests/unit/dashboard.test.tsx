import { screen } from 'expo-router/testing-library';
import Home from '@/app/(app)/index';
import { createFakeApi, membership, ok, order, page, tenant } from '../support/fakeApi';
import { receivable } from '../support/financeFixtures';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const overrides = { '(app)/index': Home };

function world(role: 'administrator' | 'seller') {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const drafts = Array.from({ length: 50 }, (_, i) => order(`d${i}`, { status: 'draft' }));
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
    .on('GET', '/api/v1/orders', (c) =>
      c.query.status === 'draft'
        ? ok(page(drafts, 'mais-rascunhos'))
        : c.query.status === 'confirmed'
          ? ok(page([order('c1', { status: 'confirmed' })]))
          : ok(page([order('r1')])),
    )
    .on('GET', '/api/v1/inventory/replenishment', () => ok(page([])))
    .on('GET', '/api/v1/receivables', () =>
      ok(
        page([
          receivable({ id: 'r1', dueDate: '2000-01-10', outstandingCents: 2000 }),
          receivable({ id: 'r2', dueDate: '2099-01-10', outstandingCents: 0, status: 'paid' }),
        ]),
      ),
    )
    .on('GET', '/api/v1/payments', () => ok(page([])));
  return { gateway, server };
}

const called = (server: ReturnType<typeof createFakeApi>, path: string) =>
  server.calls.some((c) => c.path === path);

describe('início', () => {
  it('administrador vê pedidos, financeiro e estoque; contagem parcial aparece como 50+', async () => {
    const { gateway, server } = world('administrator');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/', overrides });
    // Uma página cheia com continuação: não inventa total, mostra "pelo menos 50".
    expect(await screen.findByLabelText('Pedidos em aberto: 50+')).toBeTruthy();
    expect(await screen.findByLabelText('Aguardando saída: 1')).toBeTruthy();
    expect(await screen.findByText('Pedidos aguardando saída')).toBeTruthy();
    expect(screen.getByText('1 para preparar · mais antigos primeiro')).toBeTruthy();
    // Financeiro lido por completo: soma só o que está em aberto.
    expect(await screen.findByLabelText('A receber: R$ 20,00')).toBeTruthy();
    expect(await screen.findByText('1 parcela vencida')).toBeTruthy();
    expect(screen.queryByText('Estoque baixo')).toBeNull();
    expect(called(server, '/api/v1/inventory/replenishment')).toBe(true);
  });

  it('vendedor vê só os próprios pedidos, sem financeiro nem estoque', async () => {
    const { gateway, server } = world('seller');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/', overrides });
    expect(await screen.findByLabelText('Aguardando saída: 1')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Novo pedido' })).toBeTruthy();
    expect(screen.queryByText('A receber')).toBeNull();
    expect(screen.queryByText('Estoque baixo')).toBeNull();
    for (const path of [
      '/api/v1/receivables',
      '/api/v1/payments',
      '/api/v1/inventory/replenishment',
    ])
      expect(called(server, path)).toBe(false);
  });
});
