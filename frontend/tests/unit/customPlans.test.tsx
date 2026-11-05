import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import PlatformLayout from '@/app/plataforma/_layout';
import CustomPlans from '@/app/plataforma/planos/index';
import NewCustomPlan from '@/app/plataforma/planos/novo';
import CustomPlanScreen from '@/app/plataforma/planos/[id]';
import Company from '@/app/plataforma/empresas/[id]';
import type { PlanCatalog, PlanFeature } from '@/api/types';
import { toggleFeature, parseUserLimit } from '@/features/platform/customPlans/rules';
import { planLabel } from '@/features/platform/copy';
import { createFakeApi, fail, ok } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const overrides = {
  'plataforma/_layout': PlatformLayout,
  'plataforma/planos/index': CustomPlans,
  'plataforma/planos/novo': NewCustomPlan,
  'plataforma/planos/[id]': CustomPlanScreen,
  'plataforma/empresas/[id]': Company,
};
const now = '2026-10-01T12:00:00.000Z';

const definition = (
  code: PlanFeature,
  label: string,
  category: string,
  requires: PlanFeature[] = [],
) => ({ code, label, description: `Descrição de ${label}.`, category, requires });

const features = [
  definition('users.invite', 'Convite de usuários adicionais', 'commercial'),
  definition('commercial.sellers', 'Vendedores e carteiras de clientes', 'commercial', [
    'users.invite',
  ]),
  definition('catalog.public', 'Catálogo / vitrine virtual', 'storefront'),
  definition('purchasing.suppliers', 'Fornecedores', 'purchasing'),
  definition('costing.products', 'Custos de aquisição, margens e rentabilidade', 'purchasing'),
  definition('finance.payables', 'Contas a pagar e despesas', 'finance'),
  definition('purchasing.orders', 'Compras e recebimento de mercadorias', 'purchasing', [
    'purchasing.suppliers',
    'costing.products',
    'finance.payables',
  ]),
];
const catalog: PlanCatalog = {
  items: [
    {
      code: 'gestao',
      name: 'Gestão',
      version: 1,
      referencePriceCents: 29900,
      userLimit: 5,
      features: [{ code: 'users.invite', label: 'Convite de usuários adicionais' }],
      offered: true,
    },
  ],
  features,
  categories: [
    { code: 'commercial', label: 'Equipe e comercial' },
    { code: 'storefront', label: 'Catálogo e marca' },
    { code: 'purchasing', label: 'Compras e custos' },
    { code: 'finance', label: 'Financeiro' },
  ],
  baseResources: [
    { code: 'customers-orders', label: 'Clientes e pedidos', description: 'Base comercial.' },
  ],
};

const plan = (extra: object = {}) => ({
  id: 'plan-1',
  name: 'Oferta Acme',
  description: 'Negociada com a diretoria',
  status: 'active',
  monthlyPriceCents: 25000,
  userLimit: 4,
  features: ['users.invite', 'catalog.public'],
  sourcePlanCode: null,
  duplicatedFromId: null,
  version: 2,
  createdAt: now,
  updatedAt: now,
  ...extra,
});

function platformWorld() {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'admin@lastro.test', emailVerified: true },
  });
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({ uid: 'u1', email: 'admin@lastro.test', platformAdmin: true, memberships: [] }),
    )
    .on('GET', '/api/v1/admin/plan-catalog', () => ok(catalog));
  return { gateway, server };
}

function companyDetail(subscription: object = {}) {
  return {
    tenant: {
      id: 'ta',
      name: 'Distribuidora Alfa',
      timezone: 'America/Sao_Paulo',
      status: 'active',
      version: 2,
      createdAt: now,
      updatedAt: now,
    },
    subscription: {
      id: 'ta',
      tenantId: 'ta',
      planId: 'plan-1',
      planVersion: 1,
      status: 'active',
      signupFeeCents: 0,
      monthlyPriceCents: 22000,
      userLimit: 4,
      startsAt: now,
      commercialNotes: null,
      planCode: 'custom',
      billingDay: 10,
      billingStartsOn: '2026-10-01',
      billingContact: null,
      version: 3,
      createdAt: now,
      updatedAt: now,
      planName: 'Oferta Acme',
      nextDueDate: '2026-11-10',
      features: ['users.invite', 'catalog.public'],
      customContract: {
        planName: 'Oferta Acme',
        sourcePlanCode: 'gestao',
        features: ['users.invite', 'catalog.public'],
        contractedAt: now,
        origin: {
          monthlyPriceCents: 25000,
          userLimit: 4,
          features: ['users.invite', 'catalog.public'],
        },
      },
      ...subscription,
    },
    capacity: { userLimit: 4, activeUsers: 1, reservedInvitations: 0, available: 3 },
    users: [],
    invitations: [],
    publicCatalogEnabled: false,
  };
}
const terms = (monthlyPriceCents: number, added: string[] = []) => ({
  monthlyPriceCents,
  userLimit: 4,
  features: ['users.invite', 'catalog.public', ...added],
});
const same = {
  monthlyPriceDeltaCents: 0,
  userLimitDelta: 0,
  addedFeatures: [],
  removedFeatures: [],
  same: true,
};
const diff = {
  planId: 'plan-1',
  planName: 'Oferta Acme',
  contractedVersion: 1,
  currentVersion: 2,
  planStatus: 'active',
  contract: terms(22000),
  origin: terms(25000),
  current: terms(26000, ['branding.custom']),
  againstOrigin: { ...same, monthlyPriceDeltaCents: -3000, same: false },
  againstCurrent: {
    ...same,
    monthlyPriceDeltaCents: -4000,
    removedFeatures: ['branding.custom'],
    same: false,
  },
};

describe('Regras de dependência da oferta', () => {
  it('incluir compras traz o que elas exigem e avisa o que entrou junto', () => {
    const result = toggleFeature([], 'purchasing.orders', features);
    expect(result.included.sort()).toEqual([
      'costing.products',
      'finance.payables',
      'purchasing.suppliers',
    ]);
    expect(result.features).toHaveLength(4);
  });
  it('retirar um recurso leva junto quem depende dele', () => {
    const selected = toggleFeature([], 'purchasing.orders', features).features;
    const result = toggleFeature(selected, 'purchasing.suppliers', features);
    expect(result.removed).toEqual(['purchasing.orders']);
    expect(result.features).not.toContain('purchasing.orders');
    expect(result.features).toContain('finance.payables');
  });
  it('limite de usuários segue a regra do backend', () => {
    expect(parseUserLimit('1')).toBe(1);
    expect(parseUserLimit('100')).toBe(100);
    for (const value of ['0', '101', '', '2,5']) expect(parseUserLimit(value)).toBeNull();
  });
  it('contrato personalizado sem nome aparece como Personalizado, não como Legado', () => {
    expect(planLabel('custom')).toBe('Personalizado');
    expect(planLabel(null)).toBe('Legado');
  });
});

describe('Super Admin: planos personalizados', () => {
  it('lista ofertas com empresas vinculadas e situação', async () => {
    const { gateway, server } = platformWorld();
    server.on('GET', '/api/v1/admin/custom-plans', () =>
      ok({ items: [{ ...plan(), linkedCompanies: 2 }] }),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/plataforma/planos', overrides });
    expect(await screen.findByText('Oferta Acme')).toBeTruthy();
    expect(screen.getAllByText(/2 empresas/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Planos personalizados').length).toBeGreaterThan(0);
    expect(server.calls.at(-1)?.query).toEqual({ status: 'active' });
  });
  it('não envia oferta sem nome nem valor', async () => {
    const { gateway, server } = platformWorld();
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/planos/novo',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Criar plano' }));
    expect(await screen.findByText('Informe a mensalidade negociada.')).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('mostra o erro de dependência devolvido pelo backend', async () => {
    const { gateway, server } = platformWorld();
    server.on('POST', '/api/v1/admin/custom-plans', () => fail(422, 'PLAN_DEPENDENCY_MISSING'));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/planos/novo',
      overrides,
    });
    await fireEvent.changeText(await screen.findByLabelText('Nome do plano'), 'Oferta Beta');
    await fireEvent.changeText(screen.getByLabelText('Mensalidade negociada'), '25000');
    await fireEvent.press(screen.getByRole('button', { name: 'Criar plano' }));
    expect(await screen.findByText(/depende de outro que ficou de fora/)).toBeTruthy();
  });
  it('detalhe mostra empresas com versão contratada e aviso de oferta alterada', async () => {
    const { gateway, server } = platformWorld();
    server
      .on('GET', '/api/v1/admin/custom-plans/plan-1', () =>
        ok({
          plan: plan(),
          companies: [
            {
              tenantId: 'ta',
              tenantName: 'Distribuidora Alfa',
              subscriptionId: 'ta',
              subscriptionStatus: 'active',
              monthlyPriceCents: 22000,
              userLimit: 4,
              planVersion: 1,
              outdated: true,
              adjusted: true,
            },
          ],
        }),
      )
      .on('GET', '/api/v1/admin/custom-plans/plan-1/history', () =>
        ok({
          items: [
            {
              id: 'h1',
              action: 'custom_plan.updated',
              actorUid: 'u1',
              occurredAt: now,
              changes: { version: 2, reason: 'Reajuste' },
            },
          ],
        }),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/planos/plan-1',
      overrides,
    });
    expect(await screen.findByText('Distribuidora Alfa')).toBeTruthy();
    expect(screen.getAllByText('Oferta mudou').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ajustado').length).toBeGreaterThan(0);
    expect(
      await screen.findByText(/Contratos existentes não mudaram\. Motivo: Reajuste/),
    ).toBeTruthy();
  });
  it('desativar confirma o efeito nas empresas e exige motivo', async () => {
    const { gateway, server } = platformWorld();
    server
      .on('GET', '/api/v1/admin/custom-plans/plan-1', () =>
        ok({
          plan: plan(),
          companies: [
            {
              tenantId: 'ta',
              tenantName: 'Distribuidora Alfa',
              subscriptionId: 'ta',
              subscriptionStatus: 'active',
              monthlyPriceCents: 25000,
              userLimit: 4,
              planVersion: 2,
              outdated: false,
              adjusted: false,
            },
          ],
        }),
      )
      .on('GET', '/api/v1/admin/custom-plans/plan-1/history', () => ok({ items: [] }))
      .on('POST', '/api/v1/admin/custom-plans/plan-1/deactivate', () =>
        ok(plan({ status: 'inactive' })),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/planos/plan-1',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Desativar' }));
    expect(await screen.findByText(/A empresa vinculada continua/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Desativar plano' }));
    expect(await screen.findByText('Informe o motivo (mínimo 3 caracteres).')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Motivo'), 'Campanha encerrada');
    await fireEvent.press(screen.getByRole('button', { name: 'Desativar plano' }));
    await waitFor(() => {
      const call = server.calls.find((c) => c.path.endsWith('/deactivate'));
      expect(call?.body).toEqual({ expectedVersion: 2, reason: 'Campanha encerrada' });
    });
  });
});

describe('Super Admin: contrato da empresa', () => {
  const companyWorld = () => {
    const { gateway, server } = platformWorld();
    server
      .on('GET', '/api/v1/admin/companies/ta', () => ok(companyDetail()))
      .on('GET', '/api/v1/admin/subscriptions/ta/history', () => ok({ items: [] }))
      .on('GET', '/api/v1/admin/subscriptions/ta/contract-diff', () => ok(diff))
      .on('GET', '/api/v1/admin/charges', () => ok({ items: [], nextCursor: null }));
    return { gateway, server };
  };
  it('mostra diferenças em relação ao contratado e à oferta atual', async () => {
    const { gateway, server } = companyWorld();
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/empresas/ta',
      overrides,
    });
    expect(await screen.findByText('Contrato personalizado')).toBeTruthy();
    expect(await screen.findByText('Versão 1 de 2')).toBeTruthy();
    expect(screen.getByText(/Valor: -R\$\s?30,00 por mês/)).toBeTruthy();
    expect(screen.getByText(/A menos: Logotipo e fotos/)).toBeTruthy();
    expect(screen.getByText('A oferta mudou depois deste contrato')).toBeTruthy();
  });
  it('alteração individual exige confirmação explícita antes de enviar', async () => {
    const { gateway, server } = companyWorld();
    server.on('POST', '/api/v1/admin/subscriptions/ta/contract', () =>
      ok(companyDetail().subscription),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/empresas/ta',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Alterar contrato' }));
    await fireEvent.changeText(await screen.findByLabelText('Valor mensal contratado'), '20000');
    await fireEvent.changeText(screen.getByLabelText('Motivo'), 'Nova negociação');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(await screen.findByText('Confirme a alteração para continuar.')).toBeTruthy();
    expect(server.calls.some((c) => c.path.endsWith('/contract'))).toBe(false);
    await fireEvent.press(
      screen.getByRole('checkbox', { name: 'Confirmo a alteração individual deste contrato' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar contrato' }));
    await waitFor(() => {
      const call = server.calls.find((c) => c.path.endsWith('/contract'));
      expect(call?.body).toMatchObject({
        expectedVersion: 3,
        monthlyPriceCents: 20000,
        confirmed: true,
        acknowledgedLostFeatures: [],
      });
    });
  });
  it('vínculo bloqueia quando a empresa não cabe no limite da oferta', async () => {
    const { gateway, server } = companyWorld();
    server
      .on('GET', '/api/v1/admin/custom-plans', () =>
        ok({ items: [{ ...plan({ userLimit: 1 }), linkedCompanies: 0 }] }),
      )
      .on('GET', '/api/v1/admin/subscriptions/ta/custom-plan-change', () =>
        ok({
          subscriptionVersion: 3,
          planId: 'plan-1',
          planVersion: 2,
          planName: 'Oferta Acme',
          targetUserLimit: 1,
          activeUsers: 2,
          reservedInvitations: 0,
          excessSeats: 1,
          lostFeatures: ['catalog.public'],
          gainedFeatures: [],
          publicCatalogEnabled: true,
          monthlyPriceCents: 22000,
          offerPriceCents: 25000,
        }),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/empresas/ta',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Plano personalizado' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Plano personalizado: Escolha' }),
    );
    await fireEvent.press(await screen.findByRole('radio', { name: 'Oferta Acme' }));
    expect(
      await screen.findByText('A empresa ocupa mais vagas do que o plano permite'),
    ).toBeTruthy();
    expect(screen.getByText(/A vitrine publicada sai do ar/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar vínculo' })).toBeDisabled();
  });
});

describe('Super Admin: criação de plano', () => {
  it('oferta nova sem valor não vira gratuita sem escolha explícita', async () => {
    const { gateway, server } = platformWorld();
    server.on('POST', '/api/v1/admin/custom-plans', () => ok(plan(), 201));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/planos/novo',
      overrides,
    });
    await fireEvent.changeText(await screen.findByLabelText('Nome do plano'), 'Cortesia');
    await fireEvent.press(screen.getByRole('button', { name: 'Criar plano' }));
    expect(await screen.findByText('Informe a mensalidade negociada.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Plano gratuito' }));
    expect(screen.queryByLabelText('Mensalidade negociada')).toBeNull();
    expect(screen.getAllByText('Gratuito').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Criar plano' }));
    await waitFor(() => {
      const call = server.calls.find((c) => c.method === 'POST');
      expect(call?.body).toMatchObject({ name: 'Cortesia', monthlyPriceCents: 0 });
    });
  });
  it('cria oferta com recursos do backend, incluindo dependências automaticamente', async () => {
    const { gateway, server } = platformWorld();
    server
      .on('POST', '/api/v1/admin/custom-plans', () => ok(plan({ id: 'plan-9' }), 201))
      .on('GET', '/api/v1/admin/custom-plans/plan-9', () =>
        ok({ plan: plan({ id: 'plan-9' }), companies: [] }),
      )
      .on('GET', '/api/v1/admin/custom-plans/plan-9/history', () => ok({ items: [] }));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/planos/novo',
      overrides,
    });
    expect(await screen.findByText('Clientes e pedidos')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Nome do plano'), 'Oferta Beta');
    await fireEvent.changeText(screen.getByLabelText('Mensalidade negociada'), '25000');
    await fireEvent.press(screen.getByRole('checkbox', { name: /Compras e recebimento/ }));
    expect(await screen.findByText('Incluídos automaticamente')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Criar plano' }));
    await waitFor(() => expect(server.calls.some((c) => c.method === 'POST')).toBe(true));
    const call = server.calls.find((c) => c.method === 'POST');
    expect(call?.headers['idempotency-key']).toBeTruthy();
    expect(call?.body).toMatchObject({
      name: 'Oferta Beta',
      monthlyPriceCents: 25000,
      sourcePlanCode: null,
    });
    expect((call?.body as { features: string[] }).features.sort()).toEqual([
      'costing.products',
      'finance.payables',
      'purchasing.orders',
      'purchasing.suppliers',
    ]);
  });
});
