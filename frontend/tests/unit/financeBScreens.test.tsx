import { Pressable, Text } from 'react-native';
import { router, type Href } from 'expo-router';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Settings from '@/app/(app)/financeiro/configuracoes';
import Credits from '@/app/(app)/financeiro/creditos';
import Refunds from '@/app/(app)/financeiro/reembolsos';
import Operations from '@/app/(app)/financeiro/pedidos/[id]';
import { useSession } from '@/session/SessionContext';
import { intentLedger } from '@/lib/intent';
import {
  createFakeApi,
  fail,
  membership,
  ok,
  order,
  orderLine,
  page,
  tenant,
} from '../support/fakeApi';
import { financialResult, financialState, method } from '../support/financeFixtures';
import {
  application,
  condition,
  lot,
  payment,
  refund,
  settingMethod,
} from '../support/financeBFixtures';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';
const overrides = {
  '(app)/financeiro/configuracoes': Settings,
  '(app)/financeiro/creditos': Credits,
  '(app)/financeiro/reembolsos': Refunds,
  '(app)/financeiro/pedidos/[id]': Operations,
};
beforeEach(() => intentLedger.reset());
function world(role: 'administrator' | 'seller' = 'administrator', permissions?: string[]) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
    accounts: [
      { uid: 'u1', email: 'ana@lastro.test', password: 'senha-teste', emailVerified: true },
    ],
  });
  const m = membership('t1', role);
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [{ ...m, ...(permissions ? { permissions } : {}) }],
      }),
    )
    .on('GET', '/api/v1/tenants/current', () => ok(tenant('t1', 'Empresa A')))
    .on('GET', '/api/v1/orders/o1', () =>
      ok(
        order('o1', {
          status: 'confirmed',
          confirmedAt: '2026-10-01T12:00:00.000Z',
          customerId: 'c1',
          lines: [orderLine('p1', '2', 1000)],
        }),
      ),
    )
    .on('GET', '/api/v1/orders/o1/financial-state', () => ok(financialState()))
    .on('GET', '/api/v1/financial-executions', () => ok(page([])))
    .on('GET', '/api/v1/payments', () => ok(page([payment()])))
    .on('GET', '/api/v1/payments/p1', () => ok(payment()))
    .on('GET', '/api/v1/customers/c1/credits', () => ok(page([lot()])))
    .on('GET', '/api/v1/credit-applications', () => ok(page([application()])))
    .on('GET', '/api/v1/credit-applications/a1', () => ok(application()))
    .on('GET', '/api/v1/refund-obligations', () => ok(page([refund()])))
    .on('GET', '/api/v1/refund-obligations/f1', () => ok(refund()))
    .on('GET', '/api/v1/payment-conditions', () => ok(page([condition()])))
    .on('GET', '/api/v1/payment-methods', () => ok(page([settingMethod()])))
    .on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([method])));
  return { gateway, server };
}
const posts = (s: ReturnType<typeof createFakeApi>) =>
  s.calls.filter((c) => c.method === 'POST' || c.method === 'PATCH');
async function choose(label: string, radio: string) {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: new RegExp(`^${label}:`) })).toBeEnabled(),
  );
  await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
  await fireEvent.press(await screen.findByRole('radio', { name: radio }));
}
async function economic(kind = 'Aplicar crédito', source = /l1 · disponível/) {
  await screen.findByText('Operações financeiras');
  if (kind !== 'Aplicar crédito') await choose('Tipo de operação', kind);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Origem da operação:/ })).toBeEnabled(),
  );
  await fireEvent.press(screen.getByRole('button', { name: /^Origem da operação:/ }));
  await fireEvent.press(await screen.findByRole('radio', { name: source }));
  if (kind !== 'Registrar reembolso realizado') {
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Parcela da operação:/ })).toBeEnabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: /^Parcela da operação:/ }));
    await fireEvent.press(await screen.findByRole('radio', { name: /^1ª parcela/ }));
  }
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Revisar operação financeira' })).toBeEnabled(),
  );
  await fireEvent.changeText(screen.getByLabelText('Valor da operação'), '200');
  await fireEvent.changeText(
    screen.getByLabelText('Justificativa financeira'),
    'Conferência administrativa',
  );
}
describe('financeiro B: fluxos de tela', () => {
  it('troca de personalizado inválido para preset não valida campos ocultos', async () => {
    const { gateway, server } = world();
    server.on('POST', '/api/v1/payment-conditions', () =>
      ok(
        condition({
          id: 'new1',
          name: 'Condição revisada',
          schedule: [{ offsetDays: 30, weight: 1 }],
        }),
        201,
      ),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/configuracoes',
      overrides,
    });
    await screen.findByText('Prazo 30 e 60');
    await fireEvent.press(screen.getByRole('button', { name: 'Nova condição' }));
    await fireEvent.changeText(screen.getByLabelText('Nome da condição'), 'Condição revisada');
    await choose('Modelo de prazos', 'Personalizado');
    await fireEvent.changeText(screen.getByLabelText('Peso da parcela 1'), '0');
    await choose('Modelo de prazos', '30 dias');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar condição' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Cadastro confirmado');
    expect(posts(server)[0]?.body).toMatchObject({ preset: 'net30' });
    expect(posts(server)[0]?.body).not.toHaveProperty('schedule');
  });
  it('execução pendente bloqueia B sem iniciar ou avançar executor', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/financial-executions', () =>
      ok(page([{ id: 'exec1', status: 'ACCEPTED' }])),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pedidos/o1',
      overrides,
    });
    await screen.findByText('Execução financeira pendente');
    expect(screen.getByRole('button', { name: 'Revisar operação financeira' })).toBeDisabled();
    expect(posts(server)).toHaveLength(0);
  });
  it('403 recente no servidor pede senha e repete mesma intenção sem loop', async () => {
    const { gateway, server } = world();
    let attempts = 0;
    server.on('POST', '/api/v1/payments/p1/reversals', () =>
      ++attempts === 1
        ? fail(403, 'REAUTHENTICATION_REQUIRED')
        : ok({ ...financialResult, amountCents: 200 }),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pedidos/o1',
      overrides,
    });
    await economic('Estornar recebimento', /p1 · Pix/);
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar operação financeira' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Confirme sua senha');
    await fireEvent.changeText(screen.getByLabelText('Senha'), 'senha-teste');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Operação confirmada');
    expect(posts(server)).toHaveLength(2);
    expect(posts(server)[0]?.headers['idempotency-key']).toBe(
      posts(server)[1]?.headers['idempotency-key'],
    );
  });
  it('desconto com resposta perdida consulta aprovação oficial sem segundo PATCH', async () => {
    const { gateway, server } = world();
    const draft = order('o1', {
      status: 'draft',
      confirmedAt: null,
      version: 4,
      lines: [orderLine('p1', '2', 1000)],
    });
    server.on('GET', '/api/v1/orders/o1', () => ok(draft));
    server.on('PATCH', '/api/v1/orders/o1', () => {
      server.on('GET', '/api/v1/orders/o1', () =>
        ok({
          ...draft,
          version: 5,
          updatedBy: 'u1',
          discountCents: 100,
          discount: {
            type: 'fixed',
            value: 100,
            reason: 'Aprovação administrativa',
            approvedBy: 'u1',
            approvedAt: '2026-10-13T12:00:00Z',
            approvedVersion: 5,
          },
        }),
      );
      throw new TypeError('Resposta perdida depois do commit');
    });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pedidos/o1',
      overrides,
    });
    await screen.findByText('Desconto administrativo');
    await fireEvent.changeText(screen.getByLabelText('Valor do desconto'), '100');
    await fireEvent.changeText(
      screen.getByLabelText('Justificativa do desconto'),
      'Aprovação administrativa',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar desconto' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Aprovar desconto' }));
    await screen.findByText('Desconto com resultado desconhecido');
    await fireEvent.press(screen.getByRole('button', { name: 'Conferir desconto oficial' }));
    await screen.findByText('Estado oficial confirma desconto solicitado. Não houve novo PATCH.');
    expect(posts(server)).toHaveLength(1);
  });
  it.each([
    '/financeiro/configuracoes',
    '/financeiro/creditos',
    '/financeiro/reembolsos',
    '/financeiro/pedidos/o1',
  ])('nega vendedor sem consultas financeiras: %s', async (url) => {
    const { gateway, server } = world('seller');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: url, overrides });
    await screen.findByText('Você não tem acesso a esta área');
    expect(
      server.calls.filter((c) => c.path !== '/api/v1/me' && c.path !== '/api/v1/tenants/current'),
    ).toHaveLength(0);
  });
  it('Super Admin não entra mesmo com vínculo e permissões financeiras', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: true,
        memberships: [membership('t1')],
      }),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/configuracoes',
      overrides,
    });
    await screen.findByText('Você não tem acesso a esta área');
    expect(server.calls.some((c) => c.path === '/api/v1/payment-methods')).toBe(false);
  });
  it('créditos mostram fonte e histórico, com página vazia e cursor', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/customers/c1/credits', (c) =>
      c.query.cursor ? ok(page([lot()])) : ok(page([], 'next')),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/creditos?cliente=c1',
      overrides,
    });
    await screen.findByText('Nenhuma fonte de crédito');
    await fireEvent.press(screen.getByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('Cancelamento de pedido');
    expect(screen.getByText(/Disponível R\$ 7,50/)).toBeTruthy();
    expect(screen.getByText(/Estornado R\$ 1,00 · restaurado R\$ 1,00/)).toBeTruthy();
  });
  it('aplicação só envia após revisão, com versões oficiais', async () => {
    const { gateway, server } = world();
    server.on('POST', '/api/v1/orders/o1/credit-applications', () =>
      ok({ ...financialResult, amountCents: 200 }),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pedidos/o1',
      overrides,
    });
    await economic();
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar operação financeira' }));
    expect(posts(server)).toHaveLength(0);
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Operação confirmada');
    expect(posts(server)[0]?.body).toMatchObject({
      expectedOrderVersion: 4,
      expectedGuardVersion: 7,
      expectedLotVersion: 6,
      amountCents: 200,
    });
  });
  it('estorno exige reautenticação antes de enviar', async () => {
    const { gateway, server } = world();
    gateway.authTimeSeconds = 1;
    server.on('POST', '/api/v1/payments/p1/reversals', () =>
      ok({ ...financialResult, amountCents: 200 }),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pedidos/o1',
      overrides,
    });
    await economic('Estornar recebimento', /p1 · Pix/);
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar operação financeira' }));
    await screen.findByText('Confirme sua senha');
    expect(posts(server)).toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText('Senha'), 'senha-teste');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Operação confirmada');
    expect(posts(server)[0]?.body).toMatchObject({
      expectedVersion: 8,
      allocations: [{ expectedVersion: 3, amountCents: 200 }],
    });
  });
  it('estorno de crédito usa aplicação e lote originais', async () => {
    const { gateway, server } = world();
    server.on('POST', '/api/v1/credit-applications/a1/reversals', () =>
      ok({ ...financialResult, amountCents: 200 }),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pedidos/o1',
      overrides,
    });
    await economic('Estornar aplicação de crédito', /a1 · original/);
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar operação financeira' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Operação confirmada');
    expect(posts(server)[0]?.body).toMatchObject({ expectedVersion: 9, expectedLotVersion: 6 });
  });
  it('reembolso sem confirmação externa não envia; comprovante é consultado após sucesso', async () => {
    const { gateway, server } = world();
    server.on('POST', '/api/v1/refund-obligations/f1/confirm', () =>
      ok({ ...financialResult, amountCents: 200 }),
    );
    server.on('GET', '/api/v1/refund-confirmations/op1', () =>
      ok({
        id: 'op1',
        orderId: 'o1',
        refundObligationId: 'f1',
        amountCents: 200,
        method,
        refundedOn: '2026-10-13',
        reference: 'comprovante',
        reason: 'Conferência administrativa',
        actorUid: 'u1',
        recordedAt: '2026-10-13T12:00:00Z',
      }),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pedidos/o1',
      overrides,
    });
    await economic('Registrar reembolso realizado', /f1 · pendente/);
    await choose('Forma do reembolso realizado', 'Pix conferido');
    await fireEvent.changeText(screen.getByLabelText('Dinheiro devolvido em'), '2026-10-13');
    await fireEvent.changeText(screen.getByLabelText('Referência do comprovante'), 'comprovante');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar operação financeira' }));
    await screen.findByText('Revise a operação');
    expect(posts(server)).toHaveLength(0);
    await fireEvent.press(
      screen.getByRole('checkbox', {
        name: 'Confirmo que o dinheiro já foi devolvido fora do Lastro',
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar operação financeira' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Comprovante administrativo');
    expect(screen.getByText(/Registro não executou transferência bancária/)).toBeTruthy();
  });
  it('resposta perdida bloqueia nova operação e recupera mesma intenção', async () => {
    const { gateway, server } = world();
    let attempts = 0;
    server.on('POST', '/api/v1/orders/o1/credit-applications', () => {
      if (++attempts === 1) throw new TypeError('Resposta perdida');
      return ok({ ...financialResult, amountCents: 200 });
    });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pedidos/o1',
      overrides,
    });
    await economic();
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar operação financeira' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Operação com resultado desconhecido');
    expect(screen.getByRole('button', { name: 'Revisar operação financeira' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Recuperar mesma operação' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Operação confirmada');
    expect(posts(server)[0]?.headers['idempotency-key']).toBe(
      posts(server)[1]?.headers['idempotency-key'],
    );
    expect(posts(server)[0]?.body).toEqual(posts(server)[1]?.body);
  });
  it('condição cria preset, edita prazo e desativa com versão', async () => {
    const { gateway, server } = world();
    server.on('POST', '/api/v1/payment-conditions', () => ok(condition(), 201));
    server.on('PATCH', '/api/v1/payment-conditions/cond1', () =>
      ok(condition({ version: 2, status: 'inactive' })),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/configuracoes',
      overrides,
    });
    await screen.findByText('Prazo 30 e 60');
    await fireEvent.press(screen.getByRole('button', { name: 'Nova condição' }));
    await fireEvent.changeText(screen.getByLabelText('Nome da condição'), 'Condição E2E');
    await choose('Modelo de prazos', '30 e 60 dias');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar condição' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Cadastro confirmado');
    expect(posts(server)[0]?.body).toMatchObject({ name: 'Condição E2E', preset: '30_60' });
    await fireEvent.press(screen.getByRole('button', { name: 'Fechar editor de condição' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Editar condição Prazo 30 e 60' }));
    await fireEvent.changeText(screen.getByLabelText('Prazo da parcela 1'), '15');
    await choose('Situação da condição', 'Inativa');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar condição' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() =>
      expect(posts(server)[1]?.body).toMatchObject({
        expectedVersion: 1,
        status: 'inactive',
        schedule: [
          { offsetDays: 15, weight: 1 },
          { offsetDays: 60, weight: 1 },
        ],
      }),
    );
  });
  it('forma cria, trata resposta perdida e desativa com versão', async () => {
    const { gateway, server } = world();
    let attempts = 0;
    server.on('POST', '/api/v1/payment-methods', () => {
      if (++attempts === 1) throw new TypeError('Resposta perdida');
      return ok(settingMethod(), 201);
    });
    server.on('PATCH', '/api/v1/payment-methods/m1', () =>
      ok(settingMethod({ version: 6, status: 'inactive' })),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/configuracoes',
      overrides,
    });
    await screen.findByText('Pix conferido');
    await fireEvent.press(screen.getByRole('button', { name: 'Nova forma' }));
    await fireEvent.changeText(screen.getByLabelText('Nome da forma'), 'Pix conferido');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar forma' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Cadastro com resultado desconhecido');
    await fireEvent.press(screen.getByRole('button', { name: 'Recuperar mesmo cadastro' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Cadastro confirmado');
    expect(posts(server)[0]?.headers['idempotency-key']).toBe(
      posts(server)[1]?.headers['idempotency-key'],
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Fechar editor de forma' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Editar forma Pix conferido' }));
    await choose('Situação da forma', 'Inativa');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar forma' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() =>
      expect(posts(server)[2]?.body).toMatchObject({ expectedVersion: 5, status: 'inactive' }),
    );
  });
  it('conflito de cadastro mostra recusa sem criar outra forma', async () => {
    const { gateway, server } = world();
    server.on('PATCH', '/api/v1/payment-methods/m1', () => fail(409, 'CONFLICT'));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/configuracoes',
      overrides,
    });
    await screen.findByText('Pix conferido');
    await fireEvent.press(screen.getByRole('button', { name: 'Editar forma Pix conferido' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar forma' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar operação' }));
    await screen.findByText('Cadastro não confirmado');
    expect(posts(server)).toHaveLength(1);
  });
  it('sem payments:manage bloqueia aplicação mesmo com leitura', async () => {
    const { gateway, server } = world('administrator', ['receivables:read']);
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pedidos/o1',
      overrides,
    });
    await screen.findByText('Operação não autorizada');
    expect(screen.getByRole('button', { name: 'Revisar operação financeira' })).toBeDisabled();
    expect(posts(server)).toHaveLength(0);
  });
  it('troca de empresa remonta editor e mantém intenção anterior isolada', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [membership('t1'), membership('t2')],
      }),
    );
    server.on('GET', '/api/v1/payment-methods', (c) =>
      ok(
        page([settingMethod({ name: c.headers['x-tenant-id'] === 't2' ? 'Forma B' : 'Forma A' })]),
      ),
    );
    function Choice() {
      const { selectTenant } = useSession();
      return (
        <Pressable onPress={() => selectTenant('t1')}>
          <Text>Escolher A</Text>
        </Pressable>
      );
    }
    function Switching() {
      const { selectTenant } = useSession();
      return (
        <>
          <Pressable onPress={() => selectTenant('t2')}>
            <Text>Trocar B</Text>
          </Pressable>
          <Settings />
        </>
      );
    }
    const { queryClient } = await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/configuracoes',
      overrides: { ...overrides, empresas: Choice, '(app)/financeiro/configuracoes': Switching },
    });
    await fireEvent.press(await screen.findByText('Escolher A'));
    await act(() => router.push('/financeiro/configuracoes' as Href));
    await screen.findByText('Forma A');
    await fireEvent.press(screen.getByRole('button', { name: 'Nova forma' }));
    await fireEvent.changeText(screen.getByLabelText('Nome da forma'), 'Corpo empresa A');
    await fireEvent.press(screen.getByText('Trocar B'));
    await screen.findByText('Forma B');
    expect(screen.queryByLabelText('Nome da forma')).toBeNull();
    expect(screen.queryByText('Forma A')).toBeNull();
    expect(queryClient.getQueryCache().findAll({ queryKey: ['tenant', 't1'] })).toHaveLength(0);
  });
  it('desconto só PATCH de rascunho, após revisão; histórico confirmado permanece readonly', async () => {
    const { gateway, server } = world();
    const draft = order('o1', {
      status: 'draft',
      confirmedAt: null,
      version: 4,
      customerId: 'c1',
      payment: { type: 'cash', dueDates: ['2099-01-10'] },
      lines: [orderLine('p1', '2', 1000)],
    });
    server.on('GET', '/api/v1/orders/o1', () => ok(draft));
    server.on('PATCH', '/api/v1/orders/o1', () => ok({ ...draft, version: 5 }));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pedidos/o1',
      overrides,
    });
    await screen.findByText('Desconto administrativo');
    await fireEvent.changeText(screen.getByLabelText('Valor do desconto'), '100');
    await fireEvent.changeText(
      screen.getByLabelText('Justificativa do desconto'),
      'Aprovação administrativa',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar desconto' }));
    expect(posts(server)).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Aprovar desconto' }));
    await waitFor(() =>
      expect(posts(server)[0]?.body).toMatchObject({
        expectedVersion: 4,
        discount: { type: 'fixed', value: 100 },
      }),
    );
    expect(posts(server)[0]?.headers['idempotency-key']).toBeUndefined();
  });
});
