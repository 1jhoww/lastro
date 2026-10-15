import { Pressable, Text } from 'react-native';
import { router, type Href } from 'expo-router';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Executions from '@/app/(app)/financeiro/execucoes';
import Execution from '@/app/(app)/financeiro/execucoes/[id]';
import Returns from '@/app/(app)/financeiro/devolucoes';
import Return from '@/app/(app)/financeiro/devolucoes/[id]';
import Operations from '@/app/(app)/financeiro/pedidos/[id]';
import { intentLedger, intentScope } from '@/lib/intent';
import { useSession } from '@/session/SessionContext';
import { createFakeApi, ok, page, fail, membership, order, tenant } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';
import {
  cancellationInput,
  execution,
  publishedExecution,
  returnPreview,
  returnView,
} from '../support/financeCFixtures';
import { financialResult, financialState } from '../support/financeFixtures';
const overrides = {
  '(app)/financeiro/execucoes/index': Executions,
  '(app)/financeiro/execucoes/[id]': Execution,
  '(app)/financeiro/devolucoes/index': Returns,
  '(app)/financeiro/devolucoes/[id]': Return,
  '(app)/financeiro/pedidos/[id]': Operations,
};
const posts = (server: ReturnType<typeof createFakeApi>) =>
  server.calls.filter((c) => c.method === 'POST' || c.method === 'PATCH');
beforeEach(() => intentLedger.reset());
function world(role: 'administrator' | 'seller' = 'administrator', permissions?: string[]) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
    accounts: [
      { uid: 'u1', email: 'ana@lastro.test', emailVerified: true, password: 'senha-teste' },
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
    .on('GET', '/api/v1/financial-executions', () => ok(page([execution()])))
    .on('GET', '/api/v1/financial-executions/exec1', () => ok(execution()))
    .on('GET', '/api/v1/orders/o1', () =>
      ok(order('o1', { version: 4, status: 'confirmed', confirmedAt: '2026-10-01T12:00:00.000Z' })),
    )
    .on('GET', '/api/v1/orders/o1/financial-state', () => ok(financialState()))
    .on('GET', '/api/v1/returns', () => ok(page([returnView()])))
    .on('GET', '/api/v1/returns/ret1', () => ok(returnView()))
    .on('GET', '/api/v1/returns/ret1/resolution-preview', () => ok(returnPreview()))
    .on('GET', '/api/v1/returns/ret1/history', () => ok(page([])))
    .on('GET', '/api/v1/payments', () => ok(page([])))
    .on('GET', '/api/v1/customers/c1/credits', () => ok(page([])))
    .on('GET', '/api/v1/credit-applications', () => ok(page([])))
    .on('GET', '/api/v1/refund-obligations', () => ok(page([])))
    .on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([])));
  return { gateway, server };
}
async function choose(label: string, radio: string) {
  await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
  await fireEvent.press(await screen.findByRole('radio', { name: radio }));
}
it('lista informa status, fase e denominador não certificado sem iniciar POST', async () => {
  const { server, gateway } = world();
  await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/execucoes', overrides });
  await screen.findByText(/Entradas técnicas: planejadas 0 · aplicadas 0 · total não certificado/);
  expect(screen.queryByText('Publicação financeira comprovada pelo servidor')).toBeNull();
  expect(posts(server)).toHaveLength(0);
});
it('continuação exige revisão explícita e versões oficiais; consulta GET depois do passo', async () => {
  const { server, gateway } = world();
  let official = execution();
  server.on('GET', '/api/v1/financial-executions/exec1', () => ok(official));
  server.on('POST', '/api/v1/financial-executions/exec1/advance', () => {
    official = execution({ status: 'PLANNING', phase: 'payments', revision: 4 });
    return ok(official, 202);
  });
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/financeiro/execucoes/exec1',
    overrides,
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'Continuar execução' }));
  expect(posts(server)).toHaveLength(0);
  await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar decisão' }));
  await screen.findByText(/Fase payments · revisão 4 · fence 1/);
  expect(posts(server)).toHaveLength(1);
  expect(posts(server)[0]?.body).toEqual({ expectedRevision: 1, fencingToken: 1 });
  expect(screen.queryByText('Publicação financeira confirmada')).toBeNull();
});
it('reinício restaura passo e chave; abrir tela não avança nem repete POST', async () => {
  const { server, gateway } = world();
  const scope = intentScope('u1', 't1', 'finance-step', 'o1');
  const command = {
    kind: 'advance',
    id: 'exec1',
    orderId: 'o1',
    body: { expectedRevision: 1, fencingToken: 1 },
  };
  const key = await intentLedger.prepare(scope, command, 'exec1');
  intentLedger.reset();
  server.on('POST', '/api/v1/financial-executions/exec1/advance', () =>
    ok(execution({ revision: 2 }), 202),
  );
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/financeiro/execucoes/exec1',
    overrides,
  });
  await screen.findByText('Passo com resposta desconhecida preservado');
  expect(posts(server)).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: 'Revisar passo original' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar decisão' }));
  await waitFor(() => expect(posts(server)).toHaveLength(1));
  expect(posts(server)[0]?.headers['idempotency-key']).toBe(key);
});
it('GET publicado encerra checkpoint local sem repetir início ou movimento', async () => {
  const { server, gateway } = world();
  const scope = intentScope('u1', 't1', 'finance-resolution', 'o1');
  await intentLedger.prepare(scope, {
    kind: 'cancel-start',
    id: 'o1',
    orderId: 'o1',
    body: cancellationInput,
  });
  await intentLedger.accepted(scope, 'exec1', 1, 1);
  intentLedger.reset();
  server.on('GET', '/api/v1/financial-executions/exec1', () => ok(publishedExecution()));
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/financeiro/execucoes/exec1',
    overrides,
  });
  await screen.findByText('Publicação financeira confirmada');
  await waitFor(() => expect(intentLedger.get(scope)).toBeUndefined());
  expect(posts(server)).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Continuar execução' })).toBeNull();
});
it.each(['PAUSED', 'NEEDS_REVIEW'] as const)(
  '%s mostra referência e exige retomada auditada',
  async (status) => {
    const { server, gateway } = world();
    server.on('GET', '/api/v1/financial-executions/exec1', () =>
      ok(
        execution({
          status,
          review: {
            code: 'PROOF_MISSING',
            reference: 'safe-ref',
            detectedAt: '2026-10-13T12:00:00Z',
          },
        }),
      ),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/execucoes/exec1',
      overrides,
    });
    await screen.findByText(/PROOF_MISSING · referência safe-ref/);
    expect(screen.getByRole('button', { name: 'Continuar execução' })).toBeDisabled();
    expect(posts(server)).toHaveLength(0);
    await fireEvent.changeText(
      screen.getByLabelText('Justificativa da retomada ou abort'),
      'Conferência administrativa de origem',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar retomada' }));
    await screen.findByText('Retomar execução com novo fence');
    expect(posts(server)).toHaveLength(0);
  },
);
it('lease expirado bloqueia avanço; senha antiga pede reauth para retomar', async () => {
  const { server, gateway } = world();
  gateway.authTimeSeconds = Math.floor(Date.now() / 1000) - 600;
  server.on('GET', '/api/v1/financial-executions/exec1', () =>
    ok(execution({ leaseUntil: new Date(0).toISOString() })),
  );
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/financeiro/execucoes/exec1',
    overrides,
  });
  await screen.findByRole('button', { name: 'Continuar execução' });
  expect(screen.getByRole('button', { name: 'Continuar execução' })).toBeDisabled();
  await fireEvent.changeText(
    screen.getByLabelText('Justificativa da retomada ou abort'),
    'Assumir lease expirado',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Revisar retomada' }));
  await screen.findByText('Confirme sua senha');
  expect(posts(server)).toHaveLength(0);
});
it('sem payments:manage consulta detalhes sem controles de execução', async () => {
  const { server, gateway } = world('administrator', ['receivables:read']);
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/financeiro/execucoes/exec1',
    overrides,
  });
  await screen.findByText('Progresso técnico');
  expect(screen.queryByRole('button', { name: 'Continuar execução' })).toBeNull();
  expect(posts(server)).toHaveLength(0);
});
it.each([
  '/financeiro/execucoes',
  '/financeiro/execucoes/exec1',
  '/financeiro/devolucoes',
  '/financeiro/devolucoes/ret1',
])('vendedor não consulta rota financeira direta %s', async (initialUrl) => {
  const { server, gateway } = world('seller');
  await renderApp({ gateway, fetch: server.fetch, initialUrl, overrides });
  await screen.findByText(/não tem acesso/);
  expect(
    server.calls.some(
      (c) => c.path.includes('financial-executions') || c.path.includes('/returns'),
    ),
  ).toBe(false);
});
it('Super Admin navega para plataforma sem consultar execução comercial', async () => {
  const { server, gateway } = world();
  server.on('GET', '/api/v1/me', () =>
    ok({ uid: 'u1', email: 'ana@lastro.test', platformAdmin: true, memberships: [] }),
  );
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/financeiro/execucoes/exec1',
    overrides,
  });
  await screen.findByText('tela:plataforma');
  expect(server.calls.some((c) => c.path.includes('financial-executions'))).toBe(false);
});
it('devolução usa preview oficial, exige decisão de dano e envia centavos inteiros', async () => {
  const { server, gateway } = world();
  server.on('GET', '/api/v1/financial-executions', () => ok(page([])));
  server.on('GET', '/api/v1/orders/o1', () =>
    ok(order('o1', { version: 4, status: 'dispatched', confirmedAt: '2026-10-01T12:00:00.000Z' })),
  );
  server.on('POST', '/api/v1/returns/ret1/resolve', () =>
    ok({
      ...financialResult,
      amountCents: 1250,
      returnId: 'ret1',
      returnVersion: 4,
      status: 'partially_received',
    }),
  );
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/financeiro/devolucoes/ret1',
    overrides,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Revisar resolução financeira' })).toBeEnabled(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Revisar resolução financeira' }));
  await screen.findByText('Decida cada dano recebido antes de revisar.');
  expect(posts(server)).toHaveLength(0);
  await choose('Decisão do dano line1', 'Aceitar valor parcial');
  await fireEvent.changeText(screen.getByLabelText('Valor aceito line1'), '250');
  await fireEvent.changeText(
    screen.getByLabelText('Justificativa da resolução'),
    'Aceite parcial conferido',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Revisar resolução financeira' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar decisão' }));
  await screen.findByText('Resolução atômica confirmada');
  expect(posts(server)[0]?.body).toMatchObject({
    expectedVersion: 3,
    expectedGuardVersion: 7,
    damagedDecisions: [{ lineId: 'line1', accept: true, acceptedCents: 250 }],
  });
  expect(posts(server).some((c) => c.path.endsWith('/receipts'))).toBe(false);
});
it('journal incompleto mantém divergência mesmo se última página vier consistente', async () => {
  const { server, gateway } = world();
  server.on('GET', '/api/v1/financial-executions/exec1', () => ok(publishedExecution()));
  server.on('GET', '/api/v1/orders/o1/financial-reconciliation', (call) =>
    ok(
      call.query.cursor
        ? {
            orderId: 'o1',
            scope: 'journal',
            consistent: true,
            complete: true,
            checkedEvents: 3,
            nextCursor: null,
          }
        : {
            orderId: 'o1',
            scope: 'journal',
            consistent: false,
            complete: false,
            checkedEvents: 2,
            nextCursor: 'signed-cursor',
          },
    ),
  );
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/financeiro/execucoes/exec1',
    overrides,
  });
  await screen.findByText('Publicação financeira confirmada');
  await fireEvent.press(screen.getAllByRole('button', { name: 'Consultar reconciliação' })[0]!);
  await screen.findByText('Divergência acumulada');
  expect(screen.queryByText('Consulta completa e consistente neste escopo')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Consultar próxima página de reconciliação' }),
  );
  await screen.findByText('Verificados cumulativamente: 3');
  expect(screen.getByText('Divergência acumulada')).toBeTruthy();
});
it('cancelamento pede revisão e não inicia automaticamente retomável após recusa', async () => {
  const { server, gateway } = world();
  server.on('GET', '/api/v1/financial-executions', () => ok(page([])));
  server.on('POST', '/api/v1/orders/o1/financial-cancellation', () =>
    fail(409, 'FINANCIAL_RESUMABLE_REQUIRED'),
  );
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/financeiro/pedidos/o1',
    overrides,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Revisar resolução financeira' })).toBeEnabled(),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Justificativa da resolução'),
    'Cancelar pedido por decisão administrativa',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Revisar resolução financeira' }));
  expect(posts(server)).toHaveLength(0);
  await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar decisão' }));
  await screen.findByText(/FINANCIAL_RESUMABLE_REQUIRED/);
  expect(posts(server)).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Revisar caminho retomável' }));
  expect(posts(server)).toHaveLength(1);
});
it('troca de empresa esconde intenção anterior e preserva chave em disco', async () => {
  const { server, gateway } = world();
  server.on('GET', '/api/v1/me', () =>
    ok({
      uid: 'u1',
      email: 'ana@lastro.test',
      platformAdmin: false,
      memberships: [membership('t1'), membership('t2')],
    }),
  );
  const scope = intentScope('u1', 't1', 'finance-step', 'o1'),
    key = await intentLedger.prepare(
      scope,
      {
        kind: 'advance',
        id: 'exec1',
        orderId: 'o1',
        body: { expectedRevision: 1, fencingToken: 1 },
      },
      'exec1',
    );
  function Switch() {
    const session = useSession();
    return (
      <>
        <Executions />
        <Pressable onPress={() => session.selectTenant('t2')}>
          <Text>Trocar para B</Text>
        </Pressable>
      </>
    );
  }
  function SelectA() {
    const session = useSession();
    return (
      <Pressable
        onPress={() => {
          session.selectTenant('t1');
          router.replace('/financeiro/execucoes' as Href);
        }}
      >
        <Text>Escolher A</Text>
      </Pressable>
    );
  }
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/financeiro/execucoes',
    overrides: { ...overrides, empresas: SelectA, '(app)/financeiro/execucoes/index': Switch },
  });
  await fireEvent.press(await screen.findByText('Escolher A'));
  await screen.findByText('Intenções locais preservadas');
  await fireEvent.press(screen.getByText('Trocar para B'));
  await waitFor(() => expect(screen.queryByText('Intenções locais preservadas')).toBeNull());
  expect(intentLedger.get(scope)?.key).toBe(key);
  expect(posts(server)).toHaveLength(0);
});
