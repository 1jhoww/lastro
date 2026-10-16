import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import PlatformLayout from '@/app/plataforma/_layout';
import Overview from '@/app/plataforma/index';
import Companies from '@/app/plataforma/empresas/index';
import Company from '@/app/plataforma/empresas/[id]';
import Charges from '@/app/plataforma/cobrancas';
import Invitations from '@/app/plataforma/convites';
import Users from '@/app/(app)/configuracoes/usuarios';
import { createFakeApi, membership, ok } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const overrides = {
  'plataforma/_layout': PlatformLayout,
  'plataforma/index': Overview,
  'plataforma/empresas/index': Companies,
  'plataforma/empresas/[id]': Company,
  'plataforma/cobrancas': Charges,
  'plataforma/convites': Invitations,
  '(app)/configuracoes/usuarios': Users,
};
const now = '2026-10-01T12:00:00.000Z';

function platformWorld() {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'admin@lastro.test', emailVerified: true },
  });
  const server = createFakeApi().on('GET', '/api/v1/me', () =>
    ok({ uid: 'u1', email: 'admin@lastro.test', platformAdmin: true, memberships: [] }),
  );
  return { gateway, server };
}

const charge = (extra: object = {}) => ({
  id: 'sub-a_2026-10',
  tenantId: 'ta',
  subscriptionId: 'ta',
  competence: '2026-10',
  amountCents: 19900,
  dueDate: '2026-10-10',
  status: 'pending',
  situation: 'overdue',
  paidAt: null,
  paidAmountCents: null,
  notes: null,
  origin: 'automatic',
  planCode: 'profissional',
  version: 1,
  createdAt: now,
  updatedAt: now,
  ...extra,
});

const companyRow = (extra: object = {}) => ({
  id: 'ta',
  name: 'Distribuidora Alfa',
  tenantStatus: 'active',
  createdAt: now,
  subscriptionId: 'ta',
  subscriptionVersion: 3,
  subscriptionStatus: 'active',
  planCode: 'profissional',
  planName: 'Profissional',
  monthlyPriceCents: 19900,
  billingDay: 10,
  nextDueDate: '2026-11-10',
  activeUsers: 2,
  userLimit: 2,
  contact: { name: null, email: 'dono@alfa.test', phone: null },
  openCharges: { count: 1, overdueCount: 1, amountCents: 19900 },
  ...extra,
});

const catalog = {
  items: [
    {
      code: 'essencial',
      name: 'Essencial',
      version: 1,
      referencePriceCents: 11900,
      userLimit: 1,
      features: [],
      offered: true,
    },
    {
      code: 'profissional',
      name: 'Profissional',
      version: 1,
      referencePriceCents: 19900,
      userLimit: 2,
      features: [
        { code: 'users.invite', label: 'Convite de usuários adicionais' },
        { code: 'catalog.public', label: 'Catálogo / vitrine virtual' },
        { code: 'commercial.sellers', label: 'Vendedores e carteiras de clientes' },
      ],
      offered: true,
    },
  ],
  features: [],
};

function companyDetail() {
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
      planId: 'profissional',
      planVersion: 1,
      status: 'active',
      signupFeeCents: 0,
      monthlyPriceCents: 19900,
      userLimit: 2,
      startsAt: now,
      commercialNotes: null,
      planCode: 'profissional',
      billingDay: 10,
      billingStartsOn: '2026-10-01',
      billingContact: null,
      version: 3,
      createdAt: now,
      updatedAt: now,
      planName: 'Profissional',
      nextDueDate: '2026-11-10',
      features: ['users.invite', 'catalog.public', 'commercial.sellers'],
    },
    capacity: { userLimit: 2, activeUsers: 1, reservedInvitations: 0, available: 1 },
    users: [
      {
        uid: 'owner',
        name: null,
        email: 'dono@alfa.test',
        role: 'administrator',
        status: 'active',
        seatExempt: false,
        createdAt: now,
      },
    ],
    invitations: [],
    publicCatalogEnabled: true,
  };
}

describe('Super Admin: visão geral', () => {
  it('mostra indicadores persistidos, alerta de vencidas e próximos vencimentos', async () => {
    const { gateway, server } = platformWorld();
    server.on('GET', '/api/v1/admin/overview', () =>
      ok({
        today: '2026-10-16',
        totalCompanies: 3,
        subscriptions: { active: 2, pending: 1, suspended: 0, canceled: 0 },
        plans: { essencial: 1, profissional: 2, legacy: 0 },
        mrrCents: 31800,
        openCharges: { count: 1, amountCents: 19900 },
        overdueCharges: { count: 1, amountCents: 19900 },
        receivedThisMonthCents: 11900,
        upcoming: [{ ...charge(), tenantName: 'Distribuidora Alfa' }],
      }),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/plataforma', overrides });
    expect(await screen.findByLabelText(/Receita mensal contratada: R\$\s?318,00/)).toBeTruthy();
    expect(screen.getByLabelText(/Recebido no mês: R\$\s?119,00/)).toBeTruthy();
    expect(screen.getByLabelText('Empresas: 3')).toBeTruthy();
    expect(screen.getByText('1 cobrança vencida')).toBeTruthy();
    expect(screen.getByText('1 assinatura aguarda ativação da cobrança')).toBeTruthy();
    expect(screen.getAllByText('Distribuidora Alfa').length).toBeGreaterThan(0);
    for (const label of ['Visão geral', 'Empresas', 'Assinaturas', 'Cobranças', 'Convites'])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });
});

describe('Super Admin: empresas', () => {
  it('filtra por plano no servidor e mostra vagas e situação', async () => {
    const { gateway, server } = platformWorld();
    server.on('GET', '/api/v1/admin/companies', (c) =>
      ok({
        items: c.query.planCode === 'essencial' ? [] : [companyRow()],
        total: 1,
      }),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/empresas',
      overrides,
    });
    expect(await screen.findByText('Distribuidora Alfa')).toBeTruthy();
    // Celular (ambiente de teste): linha empilhada com vagas por extenso.
    expect(screen.getByText(/2 de 2 usuários/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Com cobrança vencida'));
    await waitFor(() =>
      expect(
        server.calls.some(
          (c) => c.path === '/api/v1/admin/companies' && c.query.attention === 'overdue',
        ),
      ).toBe(true),
    );
  });

  it('downgrade só é enviado com recursos confirmados, motivo e valor preservado', async () => {
    const { gateway, server } = platformWorld();
    server
      .on('GET', '/api/v1/admin/companies/ta', () => ok(companyDetail()))
      .on('GET', '/api/v1/admin/charges', () => ok({ items: [], nextCursor: null }))
      .on('GET', '/api/v1/admin/subscriptions/ta/history', () => ok({ items: [] }))
      .on('GET', '/api/v1/admin/plan-catalog', () => ok(catalog))
      .on('GET', '/api/v1/admin/subscriptions/ta/plan-change', () =>
        ok({
          subscriptionVersion: 3,
          currentPlanCode: 'profissional',
          targetPlanCode: 'essencial',
          targetUserLimit: 1,
          activeUsers: 1,
          reservedInvitations: 0,
          excessSeats: 0,
          lostFeatures: ['users.invite', 'catalog.public', 'commercial.sellers'],
          publicCatalogEnabled: true,
          monthlyPriceCents: 19900,
          referencePriceCents: 11900,
        }),
      )
      .on('POST', '/api/v1/admin/subscriptions/ta/plan', (c) =>
        ok({ ...companyDetail().subscription, ...(c.body as object), planCode: 'essencial' }),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/empresas/ta',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Trocar plano' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Essencial' }));
    expect(
      await screen.findByText('A vitrine publicada sai do ar; a configuração fica guardada.'),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Motivo'), 'Cliente pediu o Essencial');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar troca' }));
    expect(await screen.findByText('Confirme cada recurso que a empresa perderá.')).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false);
    for (const label of [
      'Convite de usuários adicionais',
      'Catálogo / vitrine virtual',
      'Vendedores e carteiras de clientes',
    ])
      await fireEvent.press(screen.getByRole('checkbox', { name: label }));
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar troca' }));
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'POST')?.body).toEqual({
        expectedVersion: 3,
        planCode: 'essencial',
        acknowledgedLostFeatures: ['users.invite', 'catalog.public', 'commercial.sellers'],
        reason: 'Cliente pediu o Essencial',
      }),
    );
  });

  it('downgrade com vagas excedentes explica a resolução e não envia', async () => {
    const { gateway, server } = platformWorld();
    server
      .on('GET', '/api/v1/admin/companies/ta', () => ok(companyDetail()))
      .on('GET', '/api/v1/admin/charges', () => ok({ items: [], nextCursor: null }))
      .on('GET', '/api/v1/admin/subscriptions/ta/history', () => ok({ items: [] }))
      .on('GET', '/api/v1/admin/plan-catalog', () => ok(catalog))
      .on('GET', '/api/v1/admin/subscriptions/ta/plan-change', () =>
        ok({
          subscriptionVersion: 3,
          currentPlanCode: 'profissional',
          targetPlanCode: 'essencial',
          targetUserLimit: 1,
          activeUsers: 2,
          reservedInvitations: 0,
          excessSeats: 1,
          lostFeatures: [],
          publicCatalogEnabled: false,
          monthlyPriceCents: 19900,
          referencePriceCents: 11900,
        }),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/empresas/ta',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Trocar plano' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Essencial' }));
    expect(
      await screen.findByText('A empresa ocupa mais vagas do que o plano permite'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar troca' })).toBeDisabled();
  });
});

describe('Super Admin: cobranças e convites', () => {
  it('registra pagamento com data e valor recebidos', async () => {
    const { gateway, server } = platformWorld();
    server
      .on('GET', '/api/v1/admin/charges', () => ok({ items: [charge()], nextCursor: null }))
      .on('GET', '/api/v1/admin/companies', () => ok({ items: [companyRow()], total: 1 }))
      .on('POST', '/api/v1/admin/charges/sub-a_2026-10/pay', (c) =>
        ok({ ...charge(), status: 'paid', situation: 'paid', ...(c.body as object) }),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/cobrancas',
      overrides,
    });
    expect(await screen.findByText('Vencida')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pagamento' }));
    await fireEvent.changeText(await screen.findByLabelText('Observações'), 'PIX');
    const buttons = screen.getAllByRole('button', { name: 'Registrar pagamento' });
    await fireEvent.press(buttons[buttons.length - 1]!);
    await waitFor(() => {
      const call = server.calls.find((c) => c.method === 'POST');
      expect(call?.body).toMatchObject({
        expectedVersion: 1,
        paidAmountCents: 19900,
        notes: 'PIX',
      });
      expect((call?.body as { paidAt: string }).paidAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renova convite do primeiro administrador com chave de intenção', async () => {
    const { gateway, server } = platformWorld();
    server
      .on('GET', '/api/v1/admin/invitations', () =>
        ok({
          items: [
            {
              tenantId: 'tc',
              tenantName: 'Empresa Nova',
              tenantVersion: 1,
              planCode: 'essencial',
              createdAt: now,
              invitation: {
                id: 'i1',
                email: 'dono@nova.test',
                status: 'pending',
                expired: true,
                expiresAt: now,
                token: null,
              },
            },
          ],
        }),
      )
      .on('POST', '/api/v1/admin/tenants/tc/owner-invitations', () =>
        ok(
          {
            invitation: {
              id: 'i2',
              email: 'dono@nova.test',
              role: 'administrator',
              expiresAt: now,
              seatExempt: false,
            },
            token: 'tc.i2.' + 'x'.repeat(43),
          },
          201,
        ),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/plataforma/convites',
      overrides,
    });
    expect(await screen.findByText('Vencido')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copiar link' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Renovar convite' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Gerar novo convite' }));
    expect(await screen.findByText('Convite criado para dono@nova.test')).toBeTruthy();
    const call = server.calls.find((c) => c.method === 'POST')!;
    expect(call.body).toEqual({ ownerEmail: 'dono@nova.test', expectedVersion: 1 });
    expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Empresa: usuários e limites do plano', () => {
  function tenantWorld(plan: object, capacity: object) {
    const gateway = new FakeGateway({
      initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
    });
    const server = createFakeApi()
      .on('GET', '/api/v1/me', () =>
        ok({
          uid: 'u1',
          email: 'ana@lastro.test',
          platformAdmin: false,
          memberships: [{ ...membership('t1'), plan }],
        }),
      )
      .on('GET', '/api/v1/users', () =>
        ok({
          items: [
            {
              id: 'u1',
              role: 'administrator',
              status: 'active',
              seatExempt: false,
              version: 1,
              createdAt: now,
              updatedAt: now,
            },
          ],
          nextCursor: null,
          pendingInvitations: [],
          capacity,
        }),
      );
    return { gateway, server };
  }

  it('Essencial mostra a vaga ocupada e não oferece convite', async () => {
    const { gateway, server } = tenantWorld(
      { code: 'essencial', name: 'Essencial', userLimit: 1, features: [] },
      { userLimit: 1, activeUsers: 1, reservedInvitations: 0, available: 0 },
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/usuarios',
      overrides,
    });
    expect(await screen.findByText('Plano Essencial')).toBeTruthy();
    expect(screen.getByText('Convites adicionais não fazem parte do seu plano')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gerar convite' })).toBeNull();
  });

  it('Profissional com vaga livre oferece convite com perfil vendedor', async () => {
    const { gateway, server } = tenantWorld(
      {
        code: 'profissional',
        name: 'Profissional',
        userLimit: 2,
        features: ['users.invite', 'catalog.public', 'commercial.sellers'],
      },
      { userLimit: 2, activeUsers: 1, reservedInvitations: 0, available: 1 },
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/usuarios',
      overrides,
    });
    expect(await screen.findByText('1 livre(s)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gerar convite' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Vendedor' })).toBeTruthy();
  });

  it('Profissional sem vagas livres orienta a liberar uma vaga', async () => {
    const { gateway, server } = tenantWorld(
      {
        code: 'profissional',
        name: 'Profissional',
        userLimit: 2,
        features: ['users.invite', 'catalog.public', 'commercial.sellers'],
      },
      { userLimit: 2, activeUsers: 1, reservedInvitations: 1, available: 0 },
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/usuarios',
      overrides,
    });
    expect(await screen.findByText('Todas as vagas do plano estão ocupadas')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gerar convite' })).toBeNull();
  });
});
