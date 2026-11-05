import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import PurchasesRoute from '@/app/(app)/compras/index';
import PurchaseRoute from '@/app/(app)/compras/[id]/index';
import PayableRoute from '@/app/(app)/financeiro/pagar/[id]';
import PayablesRoute from '@/app/(app)/financeiro/pagar/index';
import ManagementRoute from '@/app/(app)/financeiro/gestao';
import { emptyCustomerForm, formToCreate, formToUpdate } from '@/features/customers/form';
import { movementFormSchema, toEntryBody } from '@/features/inventory/movementRules';
import {
  draftTotals,
  formatMargin,
  installmentsTotal,
  lineSubtotal,
} from '@/features/management/presentation';
import { visibleDestinations } from '@/navigation/destinations';
import { createFakeApi, fail, membership, ok, page } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

jest.mock('@/theme/useLayoutSize', () => ({
  ...jest.requireActual('@/theme/useLayoutSize'),
  useLayoutSize: () => 'expanded',
}));

const gestaoPermissions = [
  'tenant:read',
  'orders:payment-options:read',
  'purchases:read',
  'purchases:create',
  'purchases:edit',
  'purchases:confirm',
  'purchases:receive',
  'purchases:close',
  'costs:read',
  'payables:read',
  'payables:manage',
  'payables:pay',
  'payables:reverse',
  'financial-reports:read',
];
function world(permissions: string[] = gestaoPermissions) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [{ ...membership('t1'), permissions }],
      }),
    )
    .on('GET', '/api/v1/tenants/current', () =>
      ok({
        id: 't1',
        name: 'Empresa',
        logo: null,
        timezone: 'America/Sao_Paulo',
        status: 'active',
        version: 1,
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
      }),
    );
  return { gateway, server };
}
const overrides = {
  '(app)/compras/index': PurchasesRoute,
  '(app)/compras/[id]/index': PurchaseRoute,
  '(app)/financeiro/pagar/index': PayablesRoute,
  '(app)/financeiro/pagar/[id]': PayableRoute,
  '(app)/financeiro/gestao': ManagementRoute,
};
const purchase = (extra: object = {}) => ({
  id: 'p1',
  number: 125,
  commercialId: '000125',
  supplierId: 's1',
  supplierName: 'Distribuidora Exemplo',
  supplierDocument: null,
  purchaseDate: '2026-11-01',
  expectedDeliveryDate: null,
  paymentCondition: null,
  notes: '',
  status: 'confirmed',
  pendingReceipt: true,
  responsibleUid: 'u1',
  lines: [
    {
      id: 'l1',
      productId: 'a',
      name: 'Shampoo Neutro',
      sku: 'SN',
      unit: 'UN',
      quantity: '100',
      suggestedUnitCostCents: null,
      unitCostCents: 1000,
      subtotalCents: 100000,
      discountCents: 0,
      totalCents: 100000,
      allocatedCents: 0,
      landedCents: 100000,
      receivedQuantity: '60',
      pendingQuantity: '40',
      receivedValueCents: 60000,
    },
  ],
  subtotalCents: 100000,
  lineDiscountCents: 0,
  freightCents: 0,
  otherCostsCents: 0,
  discountCents: 0,
  totalCents: 100000,
  installments: [],
  titleGeneration: 1,
  receiptCount: 1,
  version: 3,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
  createdBy: 'u1',
  updatedBy: 'u1',
  confirmedAt: '2026-11-01T12:00:00.000Z',
  confirmedBy: 'u1',
  canceledAt: null,
  canceledBy: null,
  cancelReason: null,
  ...extra,
});
const payable = (extra: object = {}) => ({
  id: 't1',
  beneficiaryId: null,
  beneficiaryName: 'Imobiliária',
  description: 'Aluguel',
  categoryId: null,
  categoryName: 'Aluguel',
  origin: 'expense',
  originReference: null,
  installmentNumber: null,
  installmentCount: null,
  originalCents: 300000,
  paidCents: 100000,
  canceledCents: 0,
  outstandingCents: 200000,
  issueDate: '2026-11-01',
  competenceDate: '2026-11-01',
  dueDate: '2026-11-10',
  paidOn: null,
  status: 'partially_paid',
  situation: 'overdue',
  hasBalance: true,
  notes: '',
  paymentCount: 1,
  version: 2,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
  createdBy: 'u1',
  updatedBy: 'u1',
  canceledAt: null,
  cancelReason: null,
  ...extra,
});

describe('prévia dos valores da compra', () => {
  it('soma itens, frete, despesas e descontos', () => {
    const lines = [{ milli: 2500, unitCostCents: 1000, discountCents: 100 }];
    expect(lineSubtotal(lines[0]!)).toBe(2500);
    expect(
      draftTotals(lines, { freightCents: 300, otherCostsCents: 200, discountCents: 400 }),
    ).toEqual({ subtotalCents: 2500, lineDiscountCents: 100, totalCents: 2500 });
  });
  it('confere a soma das parcelas', () => {
    expect(installmentsTotal([{ amountCents: 3334 }, { amountCents: 3333 }])).toBe(6667);
  });
  it('mostra a margem em porcentagem', () => {
    expect(formatMargin(4714)).toBe('47,14%');
    expect(formatMargin(null)).toBe('—');
  });
});

describe('navegação do Gestão', () => {
  const keys = (permissions: string[]) => visibleDestinations(permissions).map((d) => d.key);
  it('compras só aparece com a permissão do plano', () => {
    expect(keys(['tenant:read'])).not.toContain('compras');
    expect(keys(['tenant:read', 'purchases:read'])).toContain('compras');
  });
  it('quem tem financeiro chega às contas a pagar por ele', () => {
    expect(keys(['receivables:read', 'payables:read'])).toEqual(['financeiro']);
    expect(keys(['payables:read'])).toEqual(['contas-pagar']);
  });
});

describe('entrada avulsa', () => {
  const values = { quantity: '10', direction: 'in' as const, reason: '', notes: '' };
  it('não exige motivo nem envia motivo vazio', () => {
    expect(movementFormSchema('UN', 'entry').safeParse(values).success).toBe(true);
    expect(toEntryBody('p1', values, 'UN')).toEqual({ productId: 'p1', quantity: '10' });
  });
  it('ajuste continua exigindo motivo', () => {
    expect(movementFormSchema('UN', 'adjustment').safeParse(values).success).toBe(false);
  });
});

describe('cadastro de cliente e fornecedor', () => {
  const address = {
    postalCode: '01310-100',
    street: 'Avenida Paulista',
    number: '1000',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
  };
  const form = { ...emptyCustomerForm, ...address, name: 'Distribuidora' };
  it('cliente simples não envia relacionamento', () => {
    expect(formToCreate(form)).not.toHaveProperty('relationships');
  });
  it('fornecedor envia o relacionamento escolhido', () => {
    expect(formToCreate({ ...form, isCustomer: false, isSupplier: true }).relationships).toEqual([
      'supplier',
    ]);
  });
  it('cliente que vira fornecedor mantém os dois', () => {
    expect(formToUpdate({ ...form, isSupplier: true }, 2, ['customer']).relationships).toEqual([
      'customer',
      'supplier',
    ]);
  });
});

describe('telas do Gestão', () => {
  it('sem permissão, compras nem consulta o servidor', async () => {
    const { gateway, server } = world(['tenant:read']);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/compras', overrides });
    expect(await screen.findByText('Você não tem acesso a esta área')).toBeTruthy();
    expect(server.calls.some((c) => c.path === '/api/v1/purchases')).toBe(false);
  });
  it('lista compras e filtra as pendentes de recebimento', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/purchases', () => ok(page([purchase()])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/compras', overrides });
    expect(await screen.findByText('Distribuidora Exemplo')).toBeTruthy();
    await fireEvent.press(screen.getByText('A receber'));
    await waitFor(() =>
      expect(server.calls.some((c) => c.query.pendingReceipt === 'true')).toBe(true),
    );
  });
  it('recebimento envia o que chegou, com chave de idempotência', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/purchases/p1', () => ok(purchase()))
      .on('GET', '/api/v1/purchases/p1/receipts', () => ok(page([])))
      .on('GET', '/api/v1/purchases/p1/history', () => ok(page([])))
      .on('POST', '/api/v1/purchases/p1/receipts', () =>
        ok({ purchase: purchase(), receipt: {} }, 201),
      );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/compras/p1', overrides });
    await fireEvent.press(await screen.findByText('Receber mercadoria'));
    await fireEvent.press(await screen.findByText('Registrar recebimento'));
    await waitFor(() =>
      expect(server.calls.some((c) => c.method === 'POST' && c.path.endsWith('/receipts'))).toBe(
        true,
      ),
    );
    const call = server.calls.find((c) => c.method === 'POST' && c.path.endsWith('/receipts'))!;
    expect(call.headers['idempotency-key']).toBeTruthy();
    expect(call.body).toMatchObject({
      expectedVersion: 3,
      items: [{ lineId: 'l1', quantity: '40' }],
    });
  });
  const impact = (extra: object = {}) => ({
    treatment: 'abatement',
    undeliveredValueCents: 40000,
    openBalanceCents: 30000,
    paidCents: 70000,
    abatedCents: 30000,
    excessCents: 10000,
    creditCents: 10000,
    items: [
      {
        lineId: 'l1',
        productId: 'a',
        name: 'Shampoo Neutro',
        sku: 'SN',
        unit: 'UN',
        orderedQuantity: '100',
        receivedQuantity: '60',
        undeliveredQuantity: '40',
        undeliveredValueCents: 40000,
      },
    ],
    titles: [],
    ...extra,
  });
  const partial = () =>
    purchase({ status: 'partially_received', closure: null, canceledAt: null });
  const closing = (server: ReturnType<typeof world>['server']) =>
    server
      .on('GET', '/api/v1/purchases/p1', () => ok(partial()))
      .on('GET', '/api/v1/purchases/p1/receipts', () => ok(page([])))
      .on('GET', '/api/v1/purchases/p1/history', () => ok(page([])))
      .on('POST', '/api/v1/purchases/p1/closure-preview', () => ok(impact()))
      .on('POST', '/api/v1/purchases/p1/close', () =>
        ok({ purchase: partial(), closure: impact() }, 201),
      );
  it('encerrar saldo exige decisão, motivo e destino do valor pago a maior', async () => {
    const { gateway, server } = world();
    closing(server);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/compras/p1', overrides });
    await fireEvent.press(await screen.findByText('Encerrar saldo pendente'));
    expect(screen.queryByText('Cancelar compra')).toBeNull();
    await fireEvent.press(
      await screen.findByLabelText('O que acontece com o valor não entregue: Escolha'),
    );
    await fireEvent.press(await screen.findByLabelText('Abater dos títulos'));
    expect(await screen.findByText('R$ 100,00 pagos a maior')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Motivo'), 'Fornecedor sem estoque');
    await fireEvent.press(screen.getByText('Encerrar saldo'));
    expect(server.calls.some((c) => c.path.endsWith('/close'))).toBe(false);
    await fireEvent.press(screen.getByLabelText('Valor pago a maior: Escolha'));
    await fireEvent.press(await screen.findByLabelText('Valor a recuperar'));
    await fireEvent.press(screen.getByText('Encerrar saldo'));
    await waitFor(() => expect(server.calls.some((c) => c.path.endsWith('/close'))).toBe(true));
    const call = server.calls.find((c) => c.path.endsWith('/close'))!;
    expect(call.headers['idempotency-key']).toBeTruthy();
    expect(call.body).toEqual({
      expectedVersion: 3,
      treatment: 'abatement',
      reason: 'Fornecedor sem estoque',
      excessAs: 'recoverable',
      expectedUndeliveredCents: 40000,
      expectedExcessCents: 10000,
    });
  });
  it('sem a permissão, encerrar saldo não aparece', async () => {
    const { gateway, server } = world(gestaoPermissions.filter((p) => p !== 'purchases:close'));
    closing(server);
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/compras/p1', overrides });
    expect(await screen.findByText('Receber mercadoria')).toBeTruthy();
    expect(screen.queryByText('Encerrar saldo pendente')).toBeNull();
  });
  it('compra encerrada mostra a decisão e não oferece receber nem estornar', async () => {
    const { gateway, server } = world();
    const line = { ...partial().lines[0]!, pendingQuantity: '0', undeliveredQuantity: '40' };
    server
      .on('GET', '/api/v1/purchases/p1', () =>
        ok(
          purchase({
            status: 'closed',
            pendingReceipt: false,
            lines: [line],
            closure: {
              id: 'c1',
              treatment: 'supplier_credit',
              undeliveredValueCents: 40000,
              abatedCents: 0,
              excessCents: 0,
              creditId: 'cr1',
              closedOn: '2026-11-02',
              closedAt: '2026-11-02T12:00:00.000Z',
              closedBy: 'u1',
              reason: 'Fornecedor sem estoque',
            },
          }),
        ),
      )
      .on('GET', '/api/v1/purchases/p1/closure', () => ok(impact({ treatment: 'supplier_credit' })))
      .on('GET', '/api/v1/purchases/p1/receipts', () =>
        ok(
          page([
            {
              id: 'r1',
              purchaseId: 'p1',
              number: 1,
              receivedOn: '2026-11-02',
              notes: '',
              items: [],
              status: 'active',
              reversedAt: null,
              reversedBy: null,
              reversalReason: null,
              createdAt: '2026-11-02T12:00:00.000Z',
              createdBy: 'u1',
            },
          ]),
        ),
      )
      .on('GET', '/api/v1/purchases/p1/history', () => ok(page([])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/compras/p1', overrides });
    expect(await screen.findByText('Saldo encerrado')).toBeTruthy();
    expect(screen.getByText('Crédito do fornecedor')).toBeTruthy();
    expect(screen.getByText('Ver crédito do fornecedor')).toBeTruthy();
    expect(screen.queryByText('Receber mercadoria')).toBeNull();
    expect(screen.queryByText('Estornar')).toBeNull();
  });
  it('título vencido mostra saldo, e recusa do servidor vira mensagem clara', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/payables/t1', () => ok(payable()))
      .on('GET', '/api/v1/payable-payments', () => ok(page([])))
      .on('GET', '/api/v1/orders/payment-options/methods', () =>
        ok(page([{ id: 'm1', name: 'PIX', version: 1, kind: 'pix' }])),
      )
      .on('POST', '/api/v1/payables/t1/payments', () => fail(409, 'PAYMENT_EXCEEDS_BALANCE'));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/pagar/t1',
      overrides,
    });
    expect(await screen.findByText('Vencido')).toBeTruthy();
    expect(screen.getByText('R$ 2.000,00')).toBeTruthy();
  });
  it('painel apresenta caixa não informado sem inventar saldo', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/finance/management', () =>
      ok({
        period: { from: '2026-11-01', to: '2026-11-04' },
        today: '2026-11-04',
        receivables: {
          openCents: 0,
          overdueCents: 0,
          next7DaysCents: 0,
          futureCents: 0,
          receivedInPeriodCents: 0,
        },
        payables: {
          openCents: 0,
          overdueCents: 0,
          next7DaysCents: 0,
          futureCents: 0,
          paidInPeriodCents: 0,
          recurringForecastCents: 0,
        },
        cash: { balanceCents: null, openingDate: null, periodBalanceCents: 0 },
        realized: [],
        projected: [],
        profitability: {
          revenueCents: 0,
          costedRevenueCents: 0,
          cogsCents: 0,
          grossProfitCents: 0,
          grossMarginBp: null,
          operatingExpensesCents: 0,
          estimatedResultCents: 0,
          ordersWithoutCost: 0,
        },
        notes: ['Títulos não pagos aparecem somente como previsão.'],
      }),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/financeiro/gestao',
      overrides,
    });
    expect(await screen.findByText('Não informado')).toBeTruthy();
    expect(screen.getByText('Sem vendas nem despesas neste período.')).toBeTruthy();
  });
});
