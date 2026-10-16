import { Pressable, Text } from 'react-native';
import { router, type Href } from 'expo-router';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Finance from '@/app/(app)/financeiro/index';
import Receivables from '@/app/(app)/financeiro/receber';
import Title from '@/app/(app)/financeiro/[id]';
import { useSession } from '@/session/SessionContext';
import { intentLedger } from '@/lib/intent';
import { createFakeApi, fail, membership, ok, page, tenant } from '../support/fakeApi';
import {
  financialResult,
  financialState,
  method,
  receivable,
  receiptBody,
} from '../support/financeFixtures';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

let mockSize: 'compact' | 'expanded' = 'compact';
jest.mock('@/theme/useLayoutSize', () => ({
  ...jest.requireActual('@/theme/useLayoutSize'),
  useLayoutSize: () => mockSize,
}));
const overrides = {
  '(app)/financeiro/index': Finance,
  '(app)/financeiro/receber': Receivables,
  '(app)/financeiro/[id]': Title,
};
beforeEach(() => {
  mockSize = 'compact';
  intentLedger.reset();
});
function world(role: 'administrator' | 'seller' = 'administrator', permissions?: string[]) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
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
    .on('GET', '/api/v1/receivables', () => ok(page([receivable()])))
    .on('GET', '/api/v1/receivables/r1', () => ok(receivable()))
    .on('GET', '/api/v1/orders/o1/financial-state', () => ok(financialState()))
    .on('GET', '/api/v1/payments', () => ok(page([])))
    .on('GET', '/api/v1/orders/o1/financial-history', () => ok(page([])))
    .on('GET', '/api/v1/financial-executions', () => ok(page([])))
    .on('GET', '/api/v1/refund-obligations', () => ok(page([])))
    .on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([method])));
  return { gateway, server };
}
async function openReceipt() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Registrar pagamento' })).toBeEnabled(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar pagamento' }));
  await screen.findByRole('radio', { name: 'Pix conferido' });
}
async function fillReceipt(amount: string | null = '500') {
  await openReceipt();
  if (amount !== null) await fireEvent.changeText(screen.getByLabelText('Valor recebido'), amount);
  await fireEvent.press(screen.getByRole('radio', { name: 'Pix conferido' }));
  await fireEvent.changeText(screen.getByLabelText('Data do pagamento'), '13/10/2026');
  await fireEvent.press(screen.getByRole('button', { name: 'Mais detalhes' }));
  await fireEvent.changeText(screen.getByLabelText('Observação'), 'Recebimento conferido');
  await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('button', { name: 'Confirmar pagamento' });
}
const postCalls = (s: ReturnType<typeof createFakeApi>) =>
  s.calls.filter((c) => c.method === 'POST');

describe('financeiro: telas e isolamento', () => {
  it('nega vendedor sem executar consultas financeiras', async () => {
    const { gateway, server } = world('seller');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    expect(await screen.findByText('Você não tem acesso a esta área')).toBeTruthy();
    expect(server.calls.filter((c) => c.path.includes('receivables'))).toHaveLength(0);
  });
  it('nega vendedor mesmo com permissão indevida', async () => {
    const { gateway, server } = world('seller', ['receivables:read', 'payments:manage']);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro', overrides });
    expect(await screen.findByText('Você não tem acesso a esta área')).toBeTruthy();
    expect(server.calls.filter((c) => c.path.includes('receivables'))).toHaveLength(0);
  });
  it('lista compacta mostra cliente, saldo e situação de cobrança', async () => {
    const { gateway, server } = world();
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/receber',
      overrides,
    });
    expect(await screen.findByText('Mercado Central')).toBeTruthy();
    expect(screen.getByText('R$ 20,00')).toBeTruthy();
    expect(await screen.findByText('Vencido')).toBeTruthy();
    expect(screen.getByText(/01\/10\/2026/)).toBeTruthy();
    expect(server.calls.find((c) => c.path === '/api/v1/receivables')?.headers['x-tenant-id']).toBe(
      't1',
    );
  });
  it('desktop mostra colunas de valor, recebido e saldo', async () => {
    mockSize = 'expanded';
    const { gateway, server } = world();
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/receber',
      overrides,
    });
    await screen.findByText('Mercado Central');
    expect(screen.getByText('Valor')).toBeTruthy();
    expect(screen.getByText('Recebido')).toBeTruthy();
    expect(screen.getByText('Saldo')).toBeTruthy();
  });
  it('link antigo com pedido abre a lista filtrada; página vazia continua pelo cursor', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/receivables', (c) =>
      c.query.cursor ? ok(page([receivable()])) : ok(page([], 'next')),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro?pedido=o1',
      overrides,
    });
    await screen.findByText('Mercado Central');
    expect(server.calls.filter((c) => c.path === '/api/v1/receivables')[1]?.query).toMatchObject({
      cursor: 'next',
      orderId: 'o1',
      limit: '25',
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Período' }));
    await fireEvent.changeText(screen.getByLabelText('Vencimento de'), '01/10/2026');
    await fireEvent.changeText(screen.getByLabelText('Vencimento até'), '13/10/2026');
    await waitFor(() =>
      expect(
        server.calls.some((c) => c.query.from === '2026-10-01' && c.query.to === '2026-10-13'),
      ).toBe(true),
    );
  });
  it('vencidos usa limite do servidor até ontem e esconde quitados', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/receivables', () =>
      ok(
        page([
          receivable(),
          receivable({
            id: 'r2',
            customerName: 'Cliente quitado',
            outstandingCents: 0,
            cashCents: 2000,
            status: 'paid',
          }),
        ]),
      ),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/receber?situacao=overdue',
      overrides,
    });
    await screen.findByText('Mercado Central');
    expect(screen.queryByText('Cliente quitado')).toBeNull();
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/v1/receivables' && c.query.to)).toBe(true),
    );
  });
  it('erro de lista mostra ação de recarga', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/receivables', () => fail(403, 'FORBIDDEN'));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/receber',
      overrides,
    });
    expect(await screen.findByText('Não foi possível carregar a lista')).toBeTruthy();
    server.on('GET', '/api/v1/receivables', () => ok(page([receivable()])));
    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Mercado Central')).toBeTruthy();
  });
  it('detalhe mostra saldo, vencimento e históricos vazios', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await screen.findByText('Mercado Central');
    expect(await screen.findByText('Nenhum pagamento registrado neste pedido.')).toBeTruthy();
    expect(screen.getByText(/Vencimento 01\/10\/2026/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Histórico completo do pedido' }));
    expect(await screen.findByText('Nenhum evento financeiro')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir pedido' })).toBeTruthy();
  });
  it('pagamento parcial só envia após confirmação e recarrega saldo oficial', async () => {
    const { gateway, server } = world();
    server.on('POST', '/api/v1/orders/o1/receipts', () => {
      const updated = receivable({
        cashCents: 500,
        outstandingCents: 1500,
        status: 'partially_paid',
        version: 4,
      });
      server.on('GET', '/api/v1/receivables/r1', () => ok(updated));
      server.on('GET', '/api/v1/orders/o1/financial-state', () =>
        ok(financialState([updated], { guardVersion: 8 })),
      );
      return ok(financialResult);
    });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await fillReceipt();
    expect(screen.getByText('Restam R$ 15,00 em aberto')).toBeTruthy();
    expect(postCalls(server)).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar pagamento' }));
    await screen.findByText('Pagamento registrado!');
    expect(postCalls(server)[0]?.body).toEqual(receiptBody);
    expect((await screen.findAllByText('Parcial')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('R$ 15,00').length).toBeGreaterThan(0);
  });
  it('valor sugerido é o saldo atual e quita a parcela', async () => {
    const { gateway, server } = world();
    server.on('POST', '/api/v1/orders/o1/receipts', () =>
      ok({ ...financialResult, amountCents: 2000 }),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await openReceipt();
    expect(screen.getByLabelText('Valor recebido').props.value).toBe('R$ 20,00');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    await fillReceipt(null);
    expect(screen.getByText('Parcela quitada')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar pagamento' }));
    await screen.findByText('Pagamento registrado!');
    expect(postCalls(server)[0]?.body).toMatchObject({
      amountCents: 2000,
      allocations: [{ amountCents: 2000 }],
    });
  });
  it('valor acima do saldo não pode seguir para confirmação', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await openReceipt();
    await fireEvent.changeText(screen.getByLabelText('Valor recebido'), '2500');
    expect(await screen.findByText('Máximo R$ 20,00 (saldo da parcela)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    expect(postCalls(server)).toHaveLength(0);
  });
  it('data futura não é aceita', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await openReceipt();
    await fireEvent.changeText(screen.getByLabelText('Data do pagamento'), '31/12/2099');
    expect(await screen.findByText(/Use data até/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('A data do pagamento não pode ser futura.')).toBeTruthy();
    expect(postCalls(server)).toHaveLength(0);
  });
  it('sem formas ativas mostra estado vazio com acesso ao cadastro', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Registrar pagamento' })).toBeEnabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pagamento' }));
    expect(await screen.findByText('Nenhuma forma de pagamento ativa')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cadastrar forma de pagamento' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });
  it('resposta perdida mantém intenção ao fechar tela; repete mesma chave e corpo', async () => {
    const { gateway, server } = world();
    let attempts = 0;
    server.on('POST', '/api/v1/orders/o1/receipts', () => {
      if (++attempts === 1) throw new TypeError('Resposta perdida');
      return ok(financialResult);
    });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await fillReceipt();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar pagamento' }));
    await screen.findByText('Ainda não sabemos se o pagamento foi registrado');
    expect(postCalls(server)).toHaveLength(1);
    await act(() => router.replace('/financeiro/receber'));
    await screen.findByText('Mercado Central');
    await act(() => router.push('/financeiro/r1' as Href));
    await screen.findByText('Ainda não sabemos se o pagamento foi registrado');
    expect(screen.getByRole('button', { name: 'Registrar pagamento' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Conferir pagamento' }));
    await screen.findByText('Pagamento registrado!');
    expect(postCalls(server)[0]?.headers['idempotency-key']).toBe(
      postCalls(server)[1]?.headers['idempotency-key'],
    );
    expect(postCalls(server)[0]?.body).toEqual(postCalls(server)[1]?.body);
  });
  it('sem payments:manage não mostra a ação nem busca formas', async () => {
    const { gateway, server } = world('administrator', ['receivables:read']);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await screen.findByText('Nenhum pagamento registrado neste pedido.');
    expect(screen.queryByRole('button', { name: 'Registrar pagamento' })).toBeNull();
    expect(server.calls.some((c) => c.path.endsWith('payment-options/methods'))).toBe(false);
  });
  it('devolução ativa bloqueia pagamento', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/orders/o1/financial-state', () =>
      ok(financialState(undefined, { activeReturnCount: 1 })),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await screen.findByText('Pagamento indisponível no momento');
    expect(screen.getByRole('button', { name: 'Registrar pagamento' })).toBeDisabled();
    expect(postCalls(server)).toHaveLength(0);
  });
  it('202 pendente nunca mostra conclusão e bloqueia pagamento', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/financial-executions', () =>
      ok(
        page([
          {
            id: 'exec1',
            kind: 'cancellation',
            status: 'ACCEPTED',
            financialCompleted: false,
            publishedAt: null,
          },
        ]),
      ),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await screen.findByText('Operação financeira pendente');
    expect(screen.queryByText('Pagamento registrado!')).toBeNull();
    expect(screen.queryByText('Concluída')).toBeNull();
    expect(screen.getByRole('button', { name: 'Registrar pagamento' })).toBeDisabled();
  });
  it('troca de empresa remonta formulário e não mostra saldo anterior', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [membership('t1'), membership('t2')],
      }),
    );
    server.on('GET', '/api/v1/receivables/r1', (c) =>
      c.headers['x-tenant-id'] === 't2'
        ? ok(
            receivable({
              customerName: 'Empresa B cliente',
              originalCents: 9000,
              outstandingCents: 9000,
            }),
          )
        : ok(receivable()),
    );
    function SwitchTitle() {
      const { selectTenant } = useSession();
      return (
        <>
          <Pressable onPress={() => selectTenant('t2')}>
            <Text>Trocar para B</Text>
          </Pressable>
          <Title />
        </>
      );
    }
    function Choice() {
      const { selectTenant } = useSession();
      return (
        <Pressable onPress={() => selectTenant('t1')}>
          <Text>Escolher A</Text>
        </Pressable>
      );
    }
    const { queryClient } = await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/r1',
      overrides: { ...overrides, '(app)/financeiro/[id]': SwitchTitle, empresas: Choice },
    });
    await fireEvent.press(await screen.findByText('Escolher A'));
    await act(() => router.push('/financeiro/r1' as Href));
    await openReceipt();
    await fireEvent.press(screen.getByRole('button', { name: 'Mais detalhes' }));
    await fireEvent.changeText(screen.getByLabelText('Observação'), 'Corpo da empresa A');
    await fireEvent.press(screen.getByText('Trocar para B'));
    await screen.findByText('Empresa B cliente');
    expect(screen.queryByText('Mercado Central')).toBeNull();
    expect(screen.queryByDisplayValue('Corpo da empresa A')).toBeNull();
    expect(queryClient.getQueryCache().findAll({ queryKey: ['tenant', 't1'] })).toHaveLength(0);
  });
});
