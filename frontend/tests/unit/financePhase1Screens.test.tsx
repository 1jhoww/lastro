import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Finance from '@/app/(app)/financeiro/index';
import Receivables from '@/app/(app)/financeiro/receber';
import Title from '@/app/(app)/financeiro/[id]';
import Settings from '@/app/(app)/financeiro/configuracoes';
import Refunds from '@/app/(app)/financeiro/reembolsos';
import OperationsHub from '@/app/(app)/financeiro/operacoes';
import { todayIn } from '@/features/orders/rules';
import { addDays, formatIsoDate, shiftMonth } from '@/lib/calendar';
import { intentLedger } from '@/lib/intent';
import { createFakeApi, membership, ok, order, page, tenant } from '../support/fakeApi';
import { financialState, method, receivable } from '../support/financeFixtures';
import { condition, payment, refund, settingMethod } from '../support/financeBFixtures';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const overrides = {
  '(app)/financeiro/index': Finance,
  '(app)/financeiro/receber': Receivables,
  '(app)/financeiro/[id]': Title,
  '(app)/financeiro/configuracoes': Settings,
  '(app)/financeiro/reembolsos': Refunds,
  '(app)/financeiro/operacoes': OperationsHub,
};
const today = todayIn('America/Sao_Paulo');
beforeEach(() => intentLedger.reset());
function world() {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [membership('t1')],
      }),
    )
    .on('GET', '/api/v1/tenants/current', () => ok(tenant('t1', 'Empresa A')))
    .on('GET', '/api/v1/receivables', () =>
      ok(
        page([
          receivable({ id: 'r1', dueDate: addDays(today, -10), outstandingCents: 1000 }),
          receivable({
            id: 'r2',
            customerId: 'c2',
            customerName: 'Padaria Sol',
            dueDate: today,
            originalCents: 300,
            outstandingCents: 300,
          }),
          receivable({
            id: 'r3',
            customerId: 'c9',
            customerName: 'Cliente quitado',
            dueDate: addDays(today, 3),
            outstandingCents: 0,
            cashCents: 2000,
            status: 'paid',
          }),
        ]),
      ),
    )
    .on('GET', '/api/v1/payments', () =>
      ok(
        page([
          payment({
            id: 'p1',
            receivedOn: today,
            amountCents: 500,
            reversedCents: 100,
            transferredCents: 0,
          }),
        ]),
      ),
    )
    .on('GET', '/api/v1/financial-executions', () => ok(page([])))
    .on('GET', '/api/v1/refund-obligations', () => ok(page([refund()])))
    .on('GET', '/api/v1/receivables/r1', () => ok(receivable()))
    .on('GET', '/api/v1/orders/o1/financial-state', () => ok(financialState()))
    .on('GET', '/api/v1/orders/o1/financial-history', () => ok(page([])))
    .on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([method])))
    .on('GET', '/api/v1/payment-conditions', () => ok(page([condition()])))
    .on('GET', '/api/v1/payment-methods', () => ok(page([settingMethod()])))
    .on('GET', '/api/v1/customers/c1', () =>
      ok({ id: 'c1', name: 'Mercado Central', status: 'active' }),
    );
  return { gateway, server };
}
const posts = (s: ReturnType<typeof createFakeApi>) =>
  s.calls.filter((c) => c.method === 'POST' || c.method === 'PATCH');

describe('Fase 1: painel, calendário, condições e reembolsos', () => {
  it('painel soma indicadores de leitura completa e lista próximos vencimentos', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro', overrides });
    expect(await screen.findByLabelText('Total a receber: R$ 13,00')).toBeTruthy();
    expect(screen.getByLabelText('Vencido: R$ 10,00')).toBeTruthy();
    expect(screen.getByLabelText('Vence em 7 dias: R$ 3,00')).toBeTruthy();
    expect(screen.getByLabelText(/^Recebido em .+: R\$ 4,00$/)).toBeTruthy();
    expect(screen.getAllByText('Mercado Central').length).toBeGreaterThan(0);
    expect(screen.getByText('Padaria Sol')).toBeTruthy();
    expect(screen.queryByText('Cliente quitado')).toBeNull();
    expect(screen.getByText('Reembolso a registrar')).toBeTruthy();
    expect(posts(server)).toHaveLength(0);
  });
  it('painel não apresenta total parcial como global quando a leitura não termina', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/receivables', () =>
      ok(page([receivable({ dueDate: addDays(today, -30) })], 'more')),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro', overrides });
    expect(await screen.findByLabelText('Total a receber: indisponível')).toBeTruthy();
    expect(screen.getByLabelText('Vencido: indisponível')).toBeTruthy();
    expect(screen.getAllByText(/muitos registros para somar/).length).toBeGreaterThan(0);
    expect(server.calls.filter((c) => c.path === '/api/v1/receivables')).toHaveLength(10);
  });
  it('calendário escolhe data passada e bloqueia dias futuros', async () => {
    const { gateway, server } = world();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Registrar pagamento' })).toBeEnabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pagamento' }));
    expect((await screen.findByLabelText('Data do pagamento')).props.value).toBe(
      formatIsoDate(today),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Abrir calendário: Data do pagamento' }),
    );
    const tomorrow = addDays(today, 1);
    if (tomorrow.slice(0, 7) === today.slice(0, 7))
      expect(screen.getByRole('button', { name: formatIsoDate(tomorrow) })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Mês anterior' }));
    const picked = `${shiftMonth(today, -1).slice(0, 7)}-10`;
    await fireEvent.press(screen.getByRole('button', { name: formatIsoDate(picked) }));
    expect(screen.getByLabelText('Data do pagamento').props.value).toBe(formatIsoDate(picked));
  });
  it('forma prevista no pedido vem sugerida, mas a forma efetiva é escolhida no registro', async () => {
    const { gateway, server } = world();
    const cash = { id: 'm2', name: 'Dinheiro', version: 1, kind: 'cash' as const };
    server.on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([method, cash])));
    server.on('GET', '/api/v1/orders/o1', () =>
      ok(order('o1', { status: 'confirmed', intendedPaymentMethod: cash })),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Registrar pagamento' })).toBeEnabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pagamento' }));
    expect(await screen.findByText(/Previsto no pedido: Dinheiro/)).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole('radio', { name: 'Dinheiro' }).props.accessibilityState,
      ).toMatchObject({ selected: true }),
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Pix conferido' }));
    expect(
      screen.getByRole('radio', { name: 'Pix conferido' }).props.accessibilityState,
    ).toMatchObject({ selected: true });
  });
  it('condição personalizada com proporções mostra prévia e envia prazos e pesos', async () => {
    const { gateway, server } = world();
    server.on('POST', '/api/v1/payment-conditions', () =>
      ok(condition({ id: 'n1', name: 'Entrada + 28' }), 201),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/configuracoes',
      overrides,
    });
    await screen.findByText('Prazo 30 e 60');
    expect(screen.getByText('2 parcelas · 30 e 60 dias')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Nova condição' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Criar condição' }));
    expect(await screen.findByText('Dê um nome à condição')).toBeTruthy();
    expect(posts(server)).toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText('Nome'), 'Entrada + 28');
    await fireEvent.press(screen.getByRole('radio', { name: 'Personalizada' }));
    await fireEvent.changeText(screen.getByLabelText('Dias da 1ª parcela'), '0');
    await fireEvent.press(screen.getByRole('button', { name: 'Adicionar parcela' }));
    await fireEvent.changeText(screen.getByLabelText('Dias da 2ª parcela'), '28');
    await fireEvent(
      screen.getByLabelText('Dividir o valor em partes iguais'),
      'valueChange',
      false,
    );
    await fireEvent.changeText(screen.getByLabelText('Parte da 2ª parcela'), '2');
    expect(screen.getByText('R$ 333,33')).toBeTruthy();
    expect(screen.getByText('R$ 666,67')).toBeTruthy();
    expect(screen.getByText('66,7% do valor')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Criar condição' }));
    await screen.findByText('Condição salva');
    expect(posts(server)[0]?.body).toEqual({
      name: 'Entrada + 28',
      description: '',
      schedule: [
        { offsetDays: 0, weight: 1 },
        { offsetDays: 28, weight: 2 },
      ],
    });
  });
  it('prazo fora de ordem não é enviado', async () => {
    const { gateway, server } = world();
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/configuracoes',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Nova condição' }));
    await fireEvent.changeText(screen.getByLabelText('Nome'), 'Fora de ordem');
    await fireEvent.press(screen.getByRole('radio', { name: 'Personalizada' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Adicionar parcela' }));
    await fireEvent.changeText(screen.getByLabelText('Dias da 2ª parcela'), '10');
    await fireEvent.press(screen.getByRole('button', { name: 'Criar condição' }));
    expect(
      (await screen.findAllByText('Use prazo igual ou maior que o da parcela anterior')).length,
    ).toBeGreaterThan(0);
    expect(posts(server)).toHaveLength(0);
  });
  it('reembolsos distinguem a devolver de devolução registrada', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/refund-obligations', () =>
      ok(
        page([
          refund(),
          refund({
            id: 'f2',
            status: 'confirmed',
            outstandingCents: 0,
            refundedCents: 700,
          }),
        ]),
      ),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/reembolsos',
      overrides,
    });
    expect(await screen.findByText('Devolvido em parte')).toBeTruthy();
    expect(screen.queryByText('Devolução registrada')).toBeNull();
    expect(screen.getByText(/ainda não é dinheiro devolvido/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Registrados' }));
    expect(await screen.findByText('Devolução registrada')).toBeTruthy();
    expect(screen.queryByText('Devolvido em parte')).toBeNull();
  });
  it('histórico e operações reúne o que não é rotina sem esconder recursos', async () => {
    const { gateway, server } = world();
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/operacoes',
      overrides,
    });
    expect(await screen.findByText('Operações em andamento')).toBeTruthy();
    expect(screen.getByText('Verificar integridade dos registros')).toBeTruthy();
    expect(screen.getByText('Créditos de clientes')).toBeTruthy();
    // Celular: seletor compacto dá acesso às seis seções, sem opções cortadas.
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Seção do financeiro: Histórico e operações. Trocar seção',
      }),
    );
    for (const name of [
      'Visão geral',
      'Contas a receber',
      'Condições e formas',
      'Créditos',
      'Reembolsos',
      'Histórico e operações',
    ])
      expect(screen.getByRole('link', { name })).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'Reembolsos' }));
    expect(await screen.findByText(/ainda não é dinheiro devolvido/)).toBeTruthy();
  });
});
