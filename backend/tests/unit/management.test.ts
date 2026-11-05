import { describe, expect, it } from 'vitest';
import {
  averageAfterReceipt,
  averageAfterReversal,
  costOf,
  distribute,
  grossMargin,
  milliToCents,
  unitCostMilli,
} from '../../src/modules/costing/calculation.js';
import {
  allocateLanded,
  conditionInstallments,
  lineAmounts,
  purchaseTotals,
  receiptValue,
  receivingStatus,
  requireValidInstallments,
} from '../../src/modules/purchasing/calculation.js';
import { dueDatesThrough, nextDueDate } from '../../src/modules/payables/recurrence.js';
import { situationOf, titleStatus } from '../../src/modules/payables/titles.js';
import { closedLines, closureImpact } from '../../src/modules/purchasing/closure.js';
import type { Payable, PurchaseLine } from '../../src/shared/schemas/management.js';
import { permissionsFor, validateSellerOperations } from '../../src/modules/users/permissions.js';
import { AppError } from '../../src/shared/errors/appError.js';

const line = (over: Partial<PurchaseLine>): PurchaseLine => ({
  id: 'l1',
  productId: 'p1',
  name: 'Produto',
  sku: 'SKU',
  unit: 'UN',
  quantity: '10',
  suggestedUnitCostCents: null,
  unitCostCents: 1000,
  subtotalCents: 10000,
  discountCents: 0,
  totalCents: 10000,
  allocatedCents: 0,
  landedCents: 10000,
  undeliveredQuantity: '0',
  receivedQuantity: '0',
  pendingQuantity: '10',
  receivedValueCents: 0,
  ...over,
});

describe('Custo e margem', () => {
  it('margem do exemplo: custo 18,50 e venda 35,00', () => {
    expect(grossMargin(3500, 1850)).toEqual({ unitGrossProfitCents: 1650, grossMarginBp: 4714 });
  });
  it('sem custo não inventa margem', () => {
    expect(grossMargin(3500, null)).toEqual({ unitGrossProfitCents: null, grossMarginBp: null });
  });
  it('custo unitário preserva frações de centavo', () => {
    const unit = unitCostMilli(1000, 3000);
    expect(unit).toBe(333333);
    expect(milliToCents(unit)).toBe(333);
    expect(costOf(unit, 3000)).toBe(1000);
  });
  it('quantidade fracionada usa a escala do estoque', () => {
    expect(unitCostMilli(1000, 500)).toBe(2_000_000);
  });
});

describe('Custo médio ponderado', () => {
  const base = { physicalScaled: 10_000, averageCostMilli: 1_000_000, referenceCostCents: null };
  it('pondera estoque existente e entrada', () => {
    expect(averageAfterReceipt(base, 40000, 20_000)).toBe(1_666_667);
  });
  it('sem estoque, o custo recebido vira o médio', () => {
    expect(averageAfterReceipt({ ...base, physicalScaled: 0 }, 40000, 20_000)).toBe(2_000_000);
  });
  it('estoque sem custo conhecido não entra na média', () => {
    expect(averageAfterReceipt({ ...base, averageCostMilli: null }, 40000, 20_000)).toBe(2_000_000);
  });
  it('sem médio, o custo de referência valoriza o estoque existente', () => {
    expect(
      averageAfterReceipt(
        { physicalScaled: 10_000, averageCostMilli: null, referenceCostCents: 1000 },
        40000,
        20_000,
      ),
    ).toBe(1_666_667);
  });
  it('estorno desfaz a ponderação', () => {
    const after = averageAfterReceipt(base, 40000, 20_000);
    expect(averageAfterReversal(30_000, after, 40000, 20_000)).toBe(1_000_001);
  });
  it('estorno que zera o estoque mantém o médio', () => {
    expect(averageAfterReversal(20_000, 2_000_000, 40000, 20_000)).toBe(2_000_000);
  });
});

describe('Compra: valores', () => {
  it('subtotal, desconto do item e quantidade fracionada', () => {
    expect(lineAmounts({ quantity: '1.5', unitCostCents: 1001, discountCents: 2 }, 'KG')).toEqual({
      subtotalCents: 1502,
      discountCents: 2,
      totalCents: 1500,
    });
  });
  it('total soma frete e despesas e abate o desconto', () => {
    expect(
      purchaseTotals([{ subtotalCents: 10000, discountCents: 100 }], {
        freightCents: 500,
        otherCostsCents: 200,
        discountCents: 300,
      }),
    ).toEqual({ subtotalCents: 10000, lineDiscountCents: 100, totalCents: 10300 });
  });
  it('recusa desconto acima do valor da compra', () => {
    expect(() =>
      purchaseTotals([{ subtotalCents: 100, discountCents: 0 }], {
        freightCents: 0,
        otherCostsCents: 0,
        discountCents: 101,
      }),
    ).toThrow(AppError);
  });
  it('rateio bate exatamente com o total, inclusive com sobra de centavos', () => {
    const lines = allocateLanded(
      [
        line({ id: 'a', totalCents: 3333, landedCents: 3333 }),
        line({ id: 'b', totalCents: 3333, landedCents: 3333 }),
        line({ id: 'c', totalCents: 3334, landedCents: 3334 }),
      ],
      { freightCents: 100, otherCostsCents: 1, discountCents: 0 },
    );
    expect(lines.reduce((a, l) => a + l.landedCents, 0)).toBe(10101);
    expect(lines.reduce((a, l) => a + l.allocatedCents, 0)).toBe(101);
  });
  it('desconto da compra reduz o custo apropriado', () => {
    const [only] = allocateLanded([line({})], {
      freightCents: 0,
      otherCostsCents: 0,
      discountCents: 500,
    });
    expect(only).toMatchObject({ allocatedCents: -500, landedCents: 9500 });
  });
  it('distribuição proporcional soma o valor exato', () => {
    expect(distribute(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(distribute(10, [0, 0])).toEqual([10, 0]);
  });
});

describe('Compra: parcelas', () => {
  const terms = [
    { offsetDays: 30, weight: 1 },
    { offsetDays: 60, weight: 1 },
    { offsetDays: 90, weight: 1 },
  ];
  it('calcula vencimentos a partir da data da compra e soma exata', () => {
    const rows = conditionInstallments(10000, '2026-11-01', terms);
    expect(rows.map((r) => r.amountCents)).toEqual([3334, 3333, 3333]);
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-12-01', '2026-12-31', '2027-01-30']);
  });
  it('parcelas ajustadas precisam somar o total', () => {
    expect(() =>
      requireValidInstallments([{ amountCents: 1, dueDate: '2026-11-02' }], 2, '2026-11-01'),
    ).toThrow('A soma das parcelas');
  });
  it('vencimento não pode anteceder a compra nem sair de ordem', () => {
    expect(() =>
      requireValidInstallments([{ amountCents: 2, dueDate: '2026-10-31' }], 2, '2026-11-01'),
    ).toThrow('Vencimentos');
    expect(() =>
      requireValidInstallments(
        [
          { amountCents: 1, dueDate: '2026-11-10' },
          { amountCents: 1, dueDate: '2026-11-05' },
        ],
        2,
        '2026-11-01',
      ),
    ).toThrow('Vencimentos');
  });
});

describe('Recebimento', () => {
  it('parciais somam exatamente o valor apropriado do item', () => {
    let current = line({ landedCents: 1000, quantity: '3' });
    const values = [1000, 2000, 3000].map((received) => {
      const value = receiptValue(current, 3000, received);
      current = { ...current, receivedValueCents: current.receivedValueCents + value };
      return value;
    });
    expect(values).toEqual([333, 334, 333]);
    expect(values.reduce((a, b) => a + b, 0)).toBe(1000);
  });
  it('situação depende só do que foi recebido', () => {
    expect(receivingStatus([line({})])).toBe('confirmed');
    expect(receivingStatus([line({ receivedQuantity: '4' })])).toBe('partially_received');
    expect(receivingStatus([line({ receivedQuantity: '10' })])).toBe('received');
  });
});

describe('Títulos', () => {
  const title = { status: 'open' as const, dueDate: '2026-11-10', hasBalance: true };
  it('vencido é derivado da data e do saldo', () => {
    expect(situationOf(title, '2026-11-10')).toBe('open');
    expect(situationOf(title, '2026-11-11')).toBe('overdue');
    expect(situationOf({ ...title, status: 'paid', hasBalance: false }, '2026-12-01')).toBe('paid');
  });
  it('situação do título acompanha o pagamento', () => {
    expect(titleStatus({ outstandingCents: 300, paidCents: 0 })).toBe('open');
    expect(titleStatus({ outstandingCents: 200, paidCents: 100 })).toBe('partially_paid');
    expect(titleStatus({ outstandingCents: 0, paidCents: 300 })).toBe('paid');
  });
});

describe('Recorrência', () => {
  const monthly = {
    frequency: 'monthly' as const,
    dueDay: 10,
    startDate: '2026-11-20',
    endDate: null,
    generatedThrough: null,
  };
  it('primeira ocorrência é a primeira data depois do início', () => {
    expect(dueDatesThrough(monthly, '2027-02-15')).toEqual([
      '2026-12-10',
      '2027-01-10',
      '2027-02-10',
    ]);
  });
  it('mês mais curto usa o último dia', () => {
    expect(
      dueDatesThrough({ ...monthly, dueDay: 31, startDate: '2027-01-01' }, '2027-03-31'),
    ).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });
  it('não repete o que já foi gerado e respeita o término', () => {
    expect(
      dueDatesThrough(
        { ...monthly, generatedThrough: '2026-12-10', endDate: '2027-01-31' },
        '2027-12-31',
      ),
    ).toEqual(['2027-01-10']);
  });
  it('frequências trimestral e anual', () => {
    expect(
      dueDatesThrough(
        { ...monthly, frequency: 'quarterly', startDate: '2026-11-01' },
        '2027-06-01',
      ),
    ).toEqual(['2026-11-10', '2027-02-10', '2027-05-10']);
    expect(
      dueDatesThrough({ ...monthly, frequency: 'yearly', startDate: '2026-11-01' }, '2028-12-01'),
    ).toEqual(['2026-11-10', '2027-11-10', '2028-11-10']);
  });
  it('próximo vencimento só em recorrência ativa', () => {
    expect(nextDueDate({ ...monthly, status: 'active' }, '2026-12-10')).toBe('2027-01-10');
    expect(nextDueDate({ ...monthly, status: 'paused' }, '2026-12-10')).toBeNull();
  });
});

describe('Permissões de gestão', () => {
  it('vendedor não recebe compras, custos nem contas a pagar por padrão', () => {
    const seller = permissionsFor('seller');
    for (const permission of ['costs:read', 'purchases:read', 'payables:read'] as const)
      expect(seller).not.toContain(permission);
  });
  it('compras exigem autorização explícita de custos', () => {
    expect(() => validateSellerOperations(['purchases.view'])).toThrow('Visualizar custos');
    expect(validateSellerOperations(['costs.view', 'purchases.view', 'products.view'])).toEqual([
      'costs.view',
      'products.view',
      'purchases.view',
    ]);
  });
  it('fornecedores continuam administrativos', () => {
    expect(() => validateSellerOperations(['suppliers.manage'])).toThrow(AppError);
  });
});

describe('encerramento de saldo pendente', () => {
  const title = (over: Partial<Payable>) =>
    ({
      id: 't1',
      dueDate: '2026-01-10',
      installmentNumber: 1,
      paidCents: 0,
      outstandingCents: 10000,
      hasBalance: true,
      ...over,
    }) as Payable;
  const partial = line({
    quantity: '10',
    landedCents: 30000,
    receivedQuantity: '4',
    pendingQuantity: '6',
    receivedValueCents: 12000,
  });
  const three = [
    title({ id: 't1', installmentNumber: 1, dueDate: '2026-01-10' }),
    title({ id: 't2', installmentNumber: 2, dueDate: '2026-02-10' }),
    title({ id: 't3', installmentNumber: 3, dueDate: '2026-03-10' }),
  ];

  it('abate a partir do último vencimento, sem valores negativos', () => {
    const impact = closureImpact({ lines: [partial] }, three, 'abatement');
    expect(impact.undeliveredValueCents).toBe(18000);
    expect(impact.titles.map((r) => [r.payableId, r.abatedCents, r.outstandingAfterCents])).toEqual(
      [
        ['t3', 10000, 0],
        ['t2', 8000, 2000],
      ],
    );
    expect(impact.excessCents).toBe(0);
  });
  it('usa o número da parcela quando os vencimentos coincidem', () => {
    const same = three.map((t) => ({ ...t, dueDate: '2026-01-10' }));
    const impact = closureImpact({ lines: [partial] }, same, 'abatement');
    expect(impact.titles[0]!.payableId).toBe('t3');
  });
  it('o que os títulos não absorvem vira excesso', () => {
    const rows = [
      title({ id: 't1', outstandingCents: 0, hasBalance: false, paidCents: 25000 }),
      title({ id: 't2', outstandingCents: 5000, paidCents: 0 }),
    ];
    const impact = closureImpact({ lines: [partial] }, rows, 'abatement');
    expect(impact).toMatchObject({
      abatedCents: 5000,
      excessCents: 13000,
      creditCents: 13000,
      paidCents: 25000,
    });
  });
  it('cobrança integral não mexe em título nem gera crédito', () => {
    const impact = closureImpact({ lines: [partial] }, three, 'full_charge');
    expect(impact).toMatchObject({ abatedCents: 0, excessCents: 0, creditCents: 0, titles: [] });
  });
  it('crédito do fornecedor registra o valor sem mexer em título', () => {
    const impact = closureImpact({ lines: [partial] }, three, 'supplier_credit');
    expect(impact).toMatchObject({
      abatedCents: 0,
      excessCents: 0,
      creditCents: 18000,
      titles: [],
    });
  });
  it('ignora linhas já recebidas e registra o não entregue', () => {
    const done = line({
      id: 'l2',
      receivedQuantity: '10',
      pendingQuantity: '0',
      receivedValueCents: 10000,
    });
    expect(closureImpact({ lines: [partial, done] }, three, 'abatement').items).toHaveLength(1);
    const [closed, complete] = closedLines([partial, done]);
    expect(closed).toMatchObject({ pendingQuantity: '0', undeliveredQuantity: '6' });
    expect(complete).toMatchObject({ undeliveredQuantity: '0' });
  });
});
