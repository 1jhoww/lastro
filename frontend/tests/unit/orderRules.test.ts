import type { ConditionOption, MethodOption, Order } from '@/api/types';
import {
  actionsFor,
  addDays,
  cartFromOrder,
  cartTotalPreview,
  dueDatesFor,
  executionDone,
  lineSubtotalPreview,
  parseCalendarDate,
  paymentBody,
  paymentChoiceOf,
  paymentSummary,
  shortOrderId,
  todayIn,
  toLinesInput,
  type CartLine,
} from '@/features/orders/rules';
import { order, orderLine } from '../support/fakeApi';
import { financialResult } from '../support/financeFixtures';

const admin = [
  'orders:own:create',
  'orders:own:confirm',
  'orders:own:dispatch',
  'orders:own:read',
  'orders:all:manage',
];
const seller = [
  'orders:own:create',
  'orders:own:confirm',
  'orders:own:dispatch',
  'orders:own:read',
];

const line = (o: Partial<CartLine>): CartLine => ({
  productId: 'p1',
  name: 'P',
  sku: 'P',
  unit: 'UN',
  unitPriceCents: 1000,
  quantityMilli: 1000,
  ...o,
});

describe('prévia de valores', () => {
  it('subtotal arredonda meio para cima como o servidor', () => {
    expect(lineSubtotalPreview(1999, 1500)).toBe(2999); // 2998,5 → 2999
    expect(lineSubtotalPreview(333, 1)).toBe(0); // 0,333 → 0
    expect(lineSubtotalPreview(500, 1)).toBe(1); // 0,5 → 1
  });

  it('BigInt evita perda acima de 2^53', () => {
    // 100.000.000 centavos × 1.000.000.000.000 milésimos ultrapassa Number.MAX_SAFE_INTEGER
    expect(lineSubtotalPreview(100_000_000, 1_000)).toBe(100_000_000);
    // 99.999.999 × 123.456.789 = 12.345.678.776.543.211 (acima de 2^53) → /1000 = 12.345.678.776.543
    expect(lineSubtotalPreview(99_999_999, 123_456_789)).toBe(12_345_678_776_543);
  });

  it('total do carrinho soma subtotais inteiros', () => {
    expect(
      cartTotalPreview([
        line({ quantityMilli: 2000, unitPriceCents: 250 }),
        line({ productId: 'p2', unit: 'KG', quantityMilli: 1255, unitPriceCents: 4590 }),
      ]),
    ).toBe(500 + 5760);
  });

  it('linhas vão no texto canônico, sem ponto flutuante', () => {
    expect(
      toLinesInput([
        line({ quantityMilli: 3000 }),
        line({ productId: 'p2', unit: 'KG', quantityMilli: 1255 }),
        line({ productId: 'p3', unit: 'L', quantityMilli: 1 }),
      ]),
    ).toEqual([
      { productId: 'p1', quantity: '3' },
      { productId: 'p2', quantity: '1.255' },
      { productId: 'p3', quantity: '0.001' },
    ]);
  });

  it('rascunho volta ao carrinho com os preços registrados', () => {
    const o = order('o1', {
      lines: [orderLine('p1', '2.5', 4590, { unit: 'KG' })],
    }) as unknown as Order;
    expect(cartFromOrder(o)).toEqual([
      expect.objectContaining({
        productId: 'p1',
        unit: 'KG',
        quantityMilli: 2500,
        unitPriceCents: 4590,
      }),
    ]);
  });

  it('identificador curto do pedido', () => {
    expect(shortOrderId('PED-1A2B3C4D-0000-4000')).toBe('PED-1A2B3C4D');
  });
});

describe('ações por situação e perfil', () => {
  it('rascunho: editar, confirmar e (admin) cancelar', () => {
    expect(actionsFor('draft', admin)).toEqual(['edit', 'confirm', 'cancel']);
    expect(actionsFor('draft', seller)).toEqual(['edit', 'confirm']);
  });

  it('confirmado: expedir e (admin) cancelar; sem edição', () => {
    expect(actionsFor('confirmed', admin)).toEqual(['dispatch', 'cancel']);
    expect(actionsFor('confirmed', seller)).toEqual(['dispatch']);
  });

  it('expedido e cancelado não têm transições', () => {
    expect(actionsFor('dispatched', admin)).toEqual([]);
    expect(actionsFor('canceled', admin)).toEqual([]);
  });
});

describe('pagamento', () => {
  const conditions: ConditionOption[] = [
    { id: 'cond1', name: '30/60', version: 4, schedule: [{ offsetDays: 30, weight: 1 }] },
  ];
  const method: MethodOption = { id: 'm1', name: 'Pix', version: 2, kind: 'pix' };
  const today = '2026-10-13';

  it('condição cadastrada envia ID e versão; nunca payment junto', () => {
    expect(
      paymentBody({ mode: 'condition', conditionId: 'cond1' }, conditions, method, today),
    ).toEqual({
      ok: true,
      body: {
        paymentConditionId: 'cond1',
        paymentConditionVersion: 4,
        intendedPaymentMethodId: 'm1',
        intendedPaymentMethodVersion: 2,
      },
    });
  });

  it('manual limpa a condição e gera vencimentos', () => {
    expect(
      paymentBody(
        { mode: 'manual', type: 'installments', first: '2026-10-20', count: 3, interval: 30 },
        conditions,
        null,
        today,
      ),
    ).toEqual({
      ok: true,
      body: {
        paymentConditionId: null,
        payment: { type: 'installments', dueDates: ['2026-10-20', '2026-11-19', '2026-12-19'] },
        intendedPaymentMethodId: null,
      },
    });
  });

  it('recusa data passada, inválida e condição sumida', () => {
    expect(
      paymentBody(
        { mode: 'manual', type: 'cash', first: '2026-10-12', count: 2, interval: 30 },
        [],
        null,
        today,
      ).ok,
    ).toBe(false);
    expect(
      paymentBody(
        { mode: 'manual', type: 'cash', first: '', count: 2, interval: 30 },
        [],
        null,
        today,
      ).ok,
    ).toBe(false);
    expect(paymentBody({ mode: 'condition', conditionId: 'x' }, conditions, null, today).ok).toBe(
      false,
    );
  });

  it('definir depois limpa pagamento e condição', () => {
    expect(paymentBody({ mode: 'later' }, conditions, null, today)).toEqual({
      ok: true,
      body: { paymentConditionId: null, payment: null, intendedPaymentMethodId: null },
    });
  });

  it('datas de calendário sem fuso', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(dueDatesFor('2026-01-31', 2, 30)).toEqual(['2026-01-31', '2026-03-02']);
    expect(parseCalendarDate('20/10/2026')).toBe('2026-10-20');
    expect(parseCalendarDate('31/02/2026')).toBeNull();
    expect(todayIn('America/Sao_Paulo', new Date('2026-10-14T02:00:00Z'))).toBe('2026-10-13');
  });

  it('escolha inicial reflete o rascunho salvo', () => {
    expect(paymentChoiceOf(undefined)).toEqual({ mode: 'later' });
    const manual = order('o1', {
      payment: { type: 'installments', dueDates: ['2026-11-01', '2026-11-15'] },
    }) as unknown as Order;
    expect(paymentChoiceOf(manual)).toEqual({
      mode: 'manual',
      type: 'installments',
      first: '2026-11-01',
      count: 2,
      interval: 14,
    });
    expect(paymentSummary(manual)).toBe('Parcelado em 2 vezes');
  });
});

describe('execução financeira', () => {
  it('aceita/processando nunca é concluída; exige confirmação e publicação', () => {
    expect(executionDone({ status: 'ACCEPTED', financialCompleted: false })).toBe(false);
    expect(executionDone({ status: 'APPLYING', financialCompleted: false })).toBe(false);
    expect(executionDone({ status: 'COMPLETED', financialCompleted: true })).toBe(false);
    expect(
      executionDone({
        status: 'COMPLETED',
        financialCompleted: true,
        publishedAt: '2026-10-13T12:00:00.000Z',
        result: null,
      }),
    ).toBe(false);
    expect(
      executionDone({
        status: 'COMPLETED',
        financialCompleted: true,
        publishedAt: '2026-10-13T12:00:00.000Z',
        result: financialResult,
      }),
    ).toBe(true);
    expect(executionDone({ status: 'ABORTED', financialCompleted: false })).toBe(true);
  });
});
