import { fireEvent, screen } from 'expo-router/testing-library';
import AppLayout from '@/app/(app)/_layout';
import Inventory from '@/app/(app)/estoque/index';
import Settings from '@/app/(app)/configuracoes/index';
import PlatformLayout from '@/app/plataforma/_layout';
import PlatformCompanies from '@/app/plataforma/empresas/index';
import { createFakeApi, membership, ok, page, tenant } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const ana = {
  uid: 'u1',
  email: 'ana@lastro.test',
  password: 'senha-de-teste',
  emailVerified: true,
};

function world(role: 'administrator' | 'seller', platformAdmin = false) {
  const gateway = new FakeGateway({
    accounts: [ana],
    initialUser: { uid: 'u1', email: ana.email, emailVerified: true },
  });
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({ uid: 'u1', email: ana.email, platformAdmin, memberships: [membership('t1', role)] }),
    )
    .on('GET', '/api/v1/tenants/current', () => ok(tenant('t1', 'Distribuidora Teste')));
  return { gateway, server };
}

describe('permissões vindas do /me', () => {
  it('vendedor vê só o disponível no estoque, sem ações nem saldos internos', async () => {
    const { gateway, server } = world('seller');
    server
      .on('GET', '/api/v1/categories', () => ok(page([])))
      .on('GET', '/api/v1/inventory', () =>
        ok(
          page([{ productId: 'p1', name: 'Água 500 ml', sku: 'AGUA', unit: 'UN', available: '7' }]),
        ),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque',
      overrides: { '(app)/_layout': AppLayout, '(app)/estoque/index': Inventory },
    });
    expect(await screen.findByText('Água 500 ml')).toBeTruthy();
    expect(screen.queryByText('Você não tem acesso a esta área')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Registrar entrada' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ajustar saldo' })).toBeNull();
    expect(screen.queryByText('Reservado')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Movimentações' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Inativos' })).toBeNull();
    const call = server.calls.find((c) => c.path === '/api/v1/inventory');
    expect(call?.query.status).toBe('active');
  });

  it('administrador vê o estoque e o menu', async () => {
    const { gateway, server } = world('administrator');
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque',
      overrides: { '(app)/_layout': AppLayout, '(app)/estoque/index': Inventory },
    });
    expect(await screen.findByText('Como ler os saldos')).toBeTruthy();
    expect(screen.queryByText('Você não tem acesso a esta área')).toBeNull();
    expect(screen.getByRole('link', { name: 'Registrar entrada' })).toBeTruthy();
  });

  it('vendedor não vê gestão de usuários nas configurações', async () => {
    const { gateway, server } = world('seller');
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes',
      overrides: { '(app)/_layout': AppLayout, '(app)/configuracoes/index': Settings },
    });
    expect(await screen.findByText('Empresa')).toBeTruthy();
    expect(screen.queryByText('Usuários e convites')).toBeNull();
  });

  it('o seletor de perfil da prévia não existe mais na área autenticada', async () => {
    const { gateway, server } = world('administrator');
    await renderApp({
      gateway,
      fetch: server.fetch,
      overrides: { '(app)/_layout': AppLayout },
    });
    expect(await screen.findByText('tela:inicio')).toBeTruthy();
    expect(screen.queryByText(/ver como/i)).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Vendedor' })).toBeNull();
  });
});

/** Campos de uma linha de /admin/companies além dos dados da empresa. */
const companyFields = {
  tenantStatus: 'active',
  subscriptionId: 't1',
  subscriptionVersion: 1,
  subscriptionStatus: 'active',
  planCode: 'profissional',
  planName: 'Profissional',
  monthlyPriceCents: 19900,
  billingDay: 10,
  nextDueDate: null,
  activeUsers: 1,
  userLimit: 2,
  contact: null,
  openCharges: { count: 0, overdueCount: 0, amountCents: 0 },
};

describe('Super Admin', () => {
  it('login antigo pede a senha antes de chamar rotas da plataforma', async () => {
    const { gateway, server } = world('administrator', true);
    server.on('GET', '/api/v1/admin/companies', () =>
      ok({ items: [{ ...tenant('t1', 'Distribuidora Teste'), ...companyFields }], total: 1 }),
    );
    gateway.authTimeSeconds = Math.floor(Date.now() / 1000) - 3600;
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/empresas',
      overrides: {
        'plataforma/_layout': PlatformLayout,
        'plataforma/empresas/index': PlatformCompanies,
      },
    });
    expect(await screen.findByText('Confirme sua senha')).toBeTruthy();
    expect(server.calls.some((c) => c.path === '/api/v1/admin/companies')).toBe(false);

    await fireEvent.changeText(screen.getByLabelText('Senha'), ana.password);
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Distribuidora Teste')).toBeTruthy();
    // A área da plataforma não envia empresa: usa só rotas /admin.
    const call = server.calls.find((c) => c.path === '/api/v1/admin/companies');
    expect(call?.headers['x-tenant-id']).toBeUndefined();
  });
});
