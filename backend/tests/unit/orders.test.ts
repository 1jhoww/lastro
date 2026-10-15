import { describe, it, expect } from 'vitest';
import {
  snapshotLine,
  priceOrder,
  installmentsFor,
  companyDate,
  validateDates,
} from '../../src/modules/orders/calculation.js';
import { productSchema } from '../../src/shared/schemas/commercial.js';
import { orderCreate, calendarDate, discountInput } from '../../src/shared/schemas/orders.js';
const product = (unit: 'UN' | 'KG' = 'UN', priceCents = 2050) =>
  productSchema.parse({
    id: 'product',
    tenantId: 'tenant',
    name: 'Teste',
    nameKey: 'teste',
    description: '',
    sku: 'TEST',
    unit,
    quantityPrecision: unit === 'KG' ? 3 : 0,
    priceCents,
    categoryId: null,
    catalogVisible: false,
    image: null,
    status: 'active',
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdBy: 'actor',
    updatedBy: 'actor',
    schemaVersion: 1,
  });
describe('Cálculos de pedidos', () => {
  it('calcula preço exclusivamente a partir do produto', () =>
    expect(snapshotLine('line', product(), '2').totalCents).toBe(4100));
  it('arredonda meio centavo para cima usando BigInt', () =>
    expect(snapshotLine('line', product('KG', 5), '0.100').subtotalCents).toBe(1));
  it('mantém precisão de milésimos sem arredondar a quantidade', () =>
    expect(snapshotLine('line', product('KG', 100000), '0.001')).toMatchObject({
      quantity: '0.001',
      subtotalCents: 100,
    }));
  it.each(['0', '-1', '1.1', '1e3'])('rejeita quantidade UN %s', (quantity) =>
    expect(() => snapshotLine('line', product(), quantity)).toThrow(),
  );
  it('rejeita overflow monetário antes de converter BigInt', () =>
    expect(() => snapshotLine('line', product('UN', 100000000), '1000000000')).toThrow());
  it('distribui desconto fixo proporcional pelo maior resto e ordem de linha', () => {
    const lines = [
      snapshotLine('a', product('UN', 1), '1'),
      snapshotLine('b', product('UN', 2), '1'),
    ];
    expect(
      priceOrder(lines, { type: 'fixed', value: 1, reason: 'Teste' }).lines.map(
        (l) => l.discountCents,
      ),
    ).toEqual([0, 1]);
  });
  it('desempata restos pela ordem original', () => {
    const lines = ['a', 'b', 'c'].map((id) => snapshotLine(id, product('UN', 1), '1'));
    expect(
      priceOrder(lines, { type: 'fixed', value: 2, reason: 'Teste' }).lines.map(
        (l) => l.discountCents,
      ),
    ).toEqual([1, 1, 0]);
  });
  it('percentual usa pontos base e arredondamento half-up', () =>
    expect(
      priceOrder([snapshotLine('a', product('UN', 101), '1')], {
        type: 'percentage',
        value: 5000,
        reason: 'Teste',
      }).totalCents,
    ).toBe(50));
  it('desconto total não deixa total ou linha negativa', () =>
    expect(
      priceOrder([snapshotLine('a', product(), '1')], {
        type: 'percentage',
        value: 10000,
        reason: 'Teste',
      }).totalCents,
    ).toBe(0));
  it('rejeita desconto superior ao subtotal', () =>
    expect(() =>
      priceOrder([snapshotLine('a', product(), '1')], {
        type: 'fixed',
        value: 2051,
        reason: 'Teste',
      }),
    ).toThrow());
  it('divide 100000 em 33334 + 33333 + 33333 e preserva IDs', () => {
    const dates = ['2026-10-08', '2026-11-07', '2026-12-08'];
    const result = installmentsFor('order', 100000, dates);
    expect(result.map((p) => p.amountCents)).toEqual([33334, 33333, 33333]);
    expect(installmentsFor('order', 99999, dates).map((p) => p.id)).toEqual(
      result.map((p) => p.id),
    );
  });
  it.each([1, 2, 3, 12])('soma exata para %i parcelas', (count) =>
    expect(
      installmentsFor(
        'o',
        100001,
        Array.from({ length: count }, () => '2027-01-01'),
      ).reduce((a, p) => a + p.amountCents, 0),
    ).toBe(100001),
  );
  it('calendário usa data da empresa na virada de UTC', () =>
    expect(companyDate(new Date('2026-10-09T01:00:00Z'), 'America/Sao_Paulo')).toBe('2026-10-08'));
  it.each(['2026-02-29', '2026-04-31', '2026-13-01'])('rejeita data inexistente %s', (date) =>
    expect(calendarDate.safeParse(date).success).toBe(false),
  );
  it('valida dias passados e ordem sem presumir intervalo', () => {
    expect(() =>
      validateDates(
        ['2026-10-08', '2026-10-20'],
        new Date('2026-10-09T01:00:00Z'),
        'America/Sao_Paulo',
      ),
    ).not.toThrow();
    expect(() =>
      validateDates(['2026-10-07'], new Date('2026-10-09T01:00:00Z'), 'America/Sao_Paulo'),
    ).toThrow();
    expect(() =>
      validateDates(
        ['2026-11-01', '2026-10-20'],
        new Date('2026-10-08T12:00:00Z'),
        'America/Sao_Paulo',
      ),
    ).toThrow();
  });
  it('aceita linhas sem teto comercial, rejeita duplicatas, preços externos e parcelamento inválido', () => {
    const body = {
      customerId: 'c',
      lines: [{ productId: 'p', quantity: '1' }],
      payment: { type: 'cash', dueDates: ['2027-01-01'] },
    };
    expect(orderCreate.safeParse(body).success).toBe(true);
    expect(orderCreate.safeParse({ ...body, priceCents: 1 }).success).toBe(false);
    expect(orderCreate.safeParse({ ...body, lines: [...body.lines, ...body.lines] }).success).toBe(
      false,
    );
    expect(
      orderCreate.safeParse({
        ...body,
        lines: Array.from({ length: 11 }, (_, i) => ({ productId: `p${i}`, quantity: '1' })),
      }).success,
    ).toBe(true);
    expect(
      orderCreate.safeParse({
        ...body,
        payment: { type: 'installments', dueDates: ['2027-01-01'] },
      }).success,
    ).toBe(false);
  });
  it('limita percentual e exige motivo', () => {
    expect(
      discountInput.safeParse({ type: 'percentage', value: 10001, reason: 'Teste' }).success,
    ).toBe(false);
    expect(discountInput.safeParse({ type: 'fixed', value: -1, reason: 'Teste' }).success).toBe(
      false,
    );
  });
});
