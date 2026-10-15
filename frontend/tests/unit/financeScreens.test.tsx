import { Pressable, Text } from 'react-native';
import { router, type Href } from 'expo-router';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Finance from '@/app/(app)/financeiro/index';
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
const overrides = { '(app)/financeiro/index': Finance, '(app)/financeiro/[id]': Title };
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
    .on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([method])));
  return { gateway, server };
}
async function fillReceipt(amount = '500') {
  await screen.findByText('Registrar recebimento');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Revisar recebimento' })).toBeEnabled(),
  );
  await fireEvent.changeText(screen.getByLabelText('Valor recebido'), amount);
  await fireEvent.press(screen.getByRole('button', { name: 'Forma efetiva: Escolha' }));
  await fireEvent.press(await screen.findByRole('radio', { name: 'Pix conferido' }));
  await fireEvent.changeText(screen.getByLabelText('Recebido em'), '2026-10-13');
  await fireEvent.changeText(
    screen.getByLabelText('Motivo do recebimento'),
    'Recebimento conferido',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Revisar recebimento' }));
  await screen.findByText('Confirmar recebimento?');
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
  it('lista compacta mostra saldo, parcela e situação oficial', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro', overrides });
    expect(await screen.findByText('Mercado Central')).toBeTruthy();
    expect(screen.getByText('R$ 20,00')).toBeTruthy();
    expect(screen.getByText('Em aberto')).toBeTruthy();
    expect(await screen.findByText('Vencido')).toBeTruthy();
    expect(server.calls.find((c) => c.path === '/api/v1/receivables')?.headers['x-tenant-id']).toBe(
      't1',
    );
  });
  it('desktop mostra colunas financeiras', async () => {
    mockSize = 'expanded';
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro', overrides });
    await screen.findByText('Mercado Central');
    expect(screen.getByText('Original')).toBeTruthy();
    expect(screen.getByText('Saldo')).toBeTruthy();
  });
  it('página vazia com cursor conserva continuação e filtros suportados', async () => {
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
    await screen.findByText('Nenhum título nestes filtros');
    await fireEvent.press(screen.getByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('Mercado Central');
    expect(server.calls.filter((c) => c.path === '/api/v1/receivables')[1]?.query).toMatchObject({
      cursor: 'next',
      orderId: 'o1',
      limit: '25',
    });
    await fireEvent.changeText(screen.getByLabelText('Vencimento de'), '2026-10-01');
    await fireEvent.changeText(screen.getByLabelText('Vencimento até'), '2026-10-13');
    await fireEvent.press(screen.getByRole('button', { name: 'Aplicar período e pedido' }));
    await waitFor(() =>
      expect(
        server.calls.some((c) => c.query.from === '2026-10-01' && c.query.to === '2026-10-13'),
      ).toBe(true),
    );
  });
  it('erro de lista mostra ação de recarga', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/receivables', () => fail(403, 'FORBIDDEN'));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro', overrides });
    expect(await screen.findByText('Não foi possível carregar a lista')).toBeTruthy();
    server.on('GET', '/api/v1/receivables', () => ok(page([receivable()])));
    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Mercado Central')).toBeTruthy();
  });
  it('detalhe mostra saldos e históricos vazios', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await screen.findByText('Mercado Central · 1ª parcela');
    expect(await screen.findByText('Nenhum recebimento')).toBeTruthy();
    expect(await screen.findByText('Nenhum evento financeiro')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir pedido' })).toBeTruthy();
  });
  it('baixa parcial só envia após revisão e recarrega saldo oficial', async () => {
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
    expect(postCalls(server)).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar baixa' }));
    await screen.findByText('Recebimento confirmado');
    expect(postCalls(server)[0]?.body).toEqual(receiptBody);
    expect(await screen.findByText('Parcialmente recebido')).toBeTruthy();
    expect(screen.getAllByText('R$ 15,00').length).toBeGreaterThan(0);
  });
  it('botão de saldo total envia valor da projeção atual', async () => {
    const { gateway, server } = world();
    server.on('POST', '/api/v1/orders/o1/receipts', () =>
      ok({ ...financialResult, amountCents: 2000 }),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await fillReceipt('2000');
    await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
    await fireEvent.changeText(screen.getByLabelText('Valor recebido'), '1');
    await fireEvent.press(screen.getByRole('button', { name: 'Receber saldo total' }));
    expect(screen.getByLabelText('Valor recebido').props.value).toBe('R$ 20,00');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar recebimento' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Registrar baixa' }));
    await screen.findByText('Recebimento confirmado');
    expect(postCalls(server)[0]?.body).toMatchObject({
      amountCents: 2000,
      allocations: [{ amountCents: 2000 }],
    });
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
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar baixa' }));
    await screen.findByText('Resultado desconhecido');
    expect(postCalls(server)).toHaveLength(1);
    await act(() => router.replace('/financeiro'));
    await screen.findByText('Mercado Central');
    await act(() => router.push('/financeiro/r1' as Href));
    await screen.findByText('Resultado desconhecido');
    expect(screen.getByRole('button', { name: 'Revisar recebimento' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Repetir mesma baixa' }));
    await screen.findByText('Recebimento confirmado');
    expect(postCalls(server)[0]?.headers['idempotency-key']).toBe(
      postCalls(server)[1]?.headers['idempotency-key'],
    );
    expect(postCalls(server)[0]?.body).toEqual(postCalls(server)[1]?.body);
  });
  it('sem payments:manage não monta formulário nem busca formas', async () => {
    const { gateway, server } = world('administrator', ['receivables:read']);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await screen.findByText('Nenhum evento financeiro');
    expect(screen.queryByText('Registrar recebimento')).toBeNull();
    expect(server.calls.some((c) => c.path.endsWith('payment-options/methods'))).toBe(false);
  });
  it('devolução ativa bloqueia baixa', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/orders/o1/financial-state', () =>
      ok(financialState(undefined, { activeReturnCount: 1 })),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await screen.findByText('Recebimento bloqueado');
    expect(screen.getByRole('button', { name: 'Revisar recebimento' })).toBeDisabled();
    expect(postCalls(server)).toHaveLength(0);
  });
  it('202 pendente nunca mostra publicação concluída', async () => {
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
    expect(screen.queryByText('Recebimento confirmado')).toBeNull();
    expect(screen.getByRole('button', { name: 'Revisar recebimento' })).toBeDisabled();
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
    await screen.findByText('Registrar recebimento');
    await fireEvent.changeText(
      screen.getByLabelText('Motivo do recebimento'),
      'Corpo da empresa A',
    );
    await fireEvent.press(screen.getByText('Trocar para B'));
    await screen.findByText('Empresa B cliente · 1ª parcela');
    expect(screen.queryByText('Mercado Central · 1ª parcela')).toBeNull();
    expect(screen.getByLabelText('Motivo do recebimento').props.value).toBe('');
    expect(queryClient.getQueryCache().findAll({ queryKey: ['tenant', 't1'] })).toHaveLength(0);
  });
});
