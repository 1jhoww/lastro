import {
  buildEconomicCommand,
  conditionFormSchema,
  discountBody,
  discountFormSchema,
  emptyEconomicValues,
  methodFormSchema,
  scheduleSchema,
} from '@/features/finance/administrationRules';
import { financialState, method, receivable } from '../support/financeFixtures';
import { application, lot, payment, refund } from '../support/financeBFixtures';
const sources = {
  lots: [lot()],
  payments: [payment()],
  applications: [application()],
  refunds: [refund()],
  methods: [method],
};
const values = {
  ...emptyEconomicValues,
  amountCents: 200,
  reason: 'Conferência administrativa',
  sourceId: 'l1',
  titleId: 'r1',
};
describe('financeiro B: contratos e limites', () => {
  it('aplica crédito com versões oficiais de fonte, guarda e parcela', () => {
    expect(buildEconomicCommand('apply-credit', values, financialState(), sources)).toMatchObject({
      id: 'o1',
      body: {
        customerId: 'c1',
        expectedLotVersion: 6,
        expectedGuardVersion: 7,
        expectedOrderVersion: 4,
        amountCents: 200,
        allocations: [{ receivableId: 'r1', expectedVersion: 3, amountCents: 200 }],
      },
    });
  });
  it('não distribui excedente do crédito nem da parcela', () => {
    expect(() =>
      buildEconomicCommand(
        'apply-credit',
        { ...values, amountCents: 751 },
        financialState(),
        sources,
      ),
    ).toThrow('Saldo de crédito insuficiente');
    expect(() =>
      buildEconomicCommand(
        'apply-credit',
        values,
        financialState([receivable({ outstandingCents: 100 })]),
        sources,
      ),
    ).toThrow('saldo da parcela');
  });
  it('nega fonte de outro cliente', () => {
    expect(() =>
      buildEconomicCommand('apply-credit', values, financialState(), {
        ...sources,
        lots: [lot({ customerId: 'other' })],
      }),
    ).toThrow();
  });
  it('estorno parcial considera remainingCents, não valor original', () => {
    expect(
      buildEconomicCommand(
        'reverse-payment',
        { ...values, sourceId: 'p1' },
        financialState(),
        sources,
      ),
    ).toMatchObject({
      kind: 'reverse-payment',
      id: 'p1',
      body: { expectedVersion: 8, amountCents: 200 },
    });
    expect(() =>
      buildEconomicCommand(
        'reverse-payment',
        { ...values, sourceId: 'p1', amountCents: 301 },
        financialState(),
        sources,
      ),
    ).toThrow('reversível');
  });
  it('nega recebimento de outro pedido ou parcela não alocada', () => {
    expect(() =>
      buildEconomicCommand('reverse-payment', { ...values, sourceId: 'p1' }, financialState(), {
        ...sources,
        payments: [payment({ orderId: 'other' })],
      }),
    ).toThrow();
    expect(() =>
      buildEconomicCommand(
        'reverse-payment',
        { ...values, sourceId: 'p1', titleId: 'other' },
        financialState(),
        sources,
      ),
    ).toThrow();
  });
  it('estorno de crédito exige versão da aplicação e fonte original', () => {
    expect(
      buildEconomicCommand(
        'reverse-credit',
        { ...values, sourceId: 'a1' },
        financialState(),
        sources,
      ),
    ).toMatchObject({ body: { expectedVersion: 9, expectedLotVersion: 6 } });
    expect(() =>
      buildEconomicCommand('reverse-credit', { ...values, sourceId: 'a1' }, financialState(), {
        ...sources,
        lots: [],
      }),
    ).toThrow('fonte original');
  });
  it('confirmar reembolso exige dinheiro já devolvido, data, forma e referência', () => {
    const v = {
      ...values,
      sourceId: 'f1',
      titleId: '',
      methodId: 'm1',
      date: '2026-10-13',
      reference: 'comprovante',
      transferConfirmed: true,
    };
    expect(buildEconomicCommand('confirm-refund', v, financialState(), sources)).toMatchObject({
      id: 'f1',
      body: {
        expectedVersion: 10,
        methodVersion: 5,
        refundedOn: '2026-10-13',
        reference: 'comprovante',
      },
    });
    expect(() =>
      buildEconomicCommand(
        'confirm-refund',
        { ...v, transferConfirmed: false },
        financialState(),
        sources,
      ),
    ).toThrow();
    expect(() =>
      buildEconomicCommand('confirm-refund', { ...v, reference: '' }, financialState(), sources),
    ).toThrow();
    expect(() =>
      buildEconomicCommand(
        'confirm-refund',
        { ...v, date: '2026-02-30' },
        financialState(),
        sources,
      ),
    ).toThrow();
    expect(() =>
      buildEconomicCommand('confirm-refund', { ...v, amountCents: 501 }, financialState(), sources),
    ).toThrow('obrigação');
  });
  it.each([0, -1, 1.5, 100_000_001])('rejeita valores fora do contrato: %s', (amountCents) => {
    expect(() =>
      buildEconomicCommand('apply-credit', { ...values, amountCents }, financialState(), sources),
    ).toThrow();
  });
  it('prazos aceitam até doze parcelas e pesos positivos sem ratear centavos no cliente', () => {
    expect(
      scheduleSchema.safeParse(
        Array.from({ length: 12 }, (_, i) => ({ offsetDays: i * 30, weight: i + 1 })),
      ).success,
    ).toBe(true);
    expect(
      scheduleSchema.safeParse(Array.from({ length: 13 }, (_, i) => ({ offsetDays: i, weight: 1 })))
        .success,
    ).toBe(false);
    expect(
      scheduleSchema.safeParse([
        { offsetDays: 30, weight: 1 },
        { offsetDays: 0, weight: 1 },
      ]).success,
    ).toBe(false);
  });
  it.each([
    { offsetDays: -1, weight: 1 },
    { offsetDays: 0, weight: 0 },
    { offsetDays: 1.5, weight: 1 },
    { offsetDays: 0, weight: 1.5 },
  ])('valida prazo e peso: %s', (row) =>
    expect(scheduleSchema.safeParse([row]).success).toBe(false),
  );
  it('cadastros normalizam nomes e aceitam status lógico', () => {
    expect(methodFormSchema.parse({ name: '  Pix  ', kind: 'pix', status: 'inactive' }).name).toBe(
      'Pix',
    );
    expect(
      conditionFormSchema.safeParse({
        name: '30 dias',
        description: '',
        mode: 'net30',
        schedule: [{ offsetDays: 0, weight: 1 }],
        status: 'active',
      }).success,
    ).toBe(true);
    expect(
      methodFormSchema.safeParse({ name: 'Pix', kind: 'bank-api', status: 'active' }).success,
    ).toBe(false);
  });
  it('desconto usa PATCH autorizado com expectedVersion e pontos base', () => {
    expect(discountBody(4, { type: 'percentage', value: 1000, reason: '  Aprovação  ' })).toEqual({
      expectedVersion: 4,
      discount: { type: 'percentage', value: 1000, reason: 'Aprovação' },
    });
    expect(
      discountFormSchema.safeParse({ type: 'percentage', value: 10001, reason: 'Aprovação' })
        .success,
    ).toBe(false);
  });
});
