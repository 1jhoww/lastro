import {
  filterSchema,
  isOverdue,
  receiptFormSchema,
  toReceiptBody,
} from '@/features/finance/rules';
import { canReadFinance } from '@/features/finance/FinanceAccess';
import { financialState, method, receivable, receiptBody } from '../support/financeFixtures';

const values = {
  amountCents: 500,
  methodId: 'm1',
  receivedOn: '2026-10-13',
  reference: '',
  reason: 'Recebimento conferido',
};

describe('financeiro: dados de entrada', () => {
  it('recebimento parcial preserva versões oficiais e centavos', () => {
    expect(toReceiptBody(values, financialState(), 'r1', method)).toEqual(receiptBody);
  });
  it('recebimento total usa saldo inteiro oficial', () => {
    const body = toReceiptBody({ ...values, amountCents: 2000 }, financialState(), 'r1', method);
    expect(body.amountCents).toBe(2000);
    expect(body.allocations[0]?.amountCents).toBe(2000);
  });
  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'recusa centavos inválidos: %s',
    (amountCents) => {
      expect(receiptFormSchema.safeParse({ ...values, amountCents }).success).toBe(false);
    },
  );
  it('recusa excedente sem distribuir noutra parcela', () => {
    expect(() =>
      toReceiptBody({ ...values, amountCents: 2001 }, financialState(), 'r1', method),
    ).toThrow('Valor excede');
  });
  it('recusa título ou método divergente', () => {
    expect(() => toReceiptBody(values, financialState(), 'outro', method)).toThrow();
    expect(() => toReceiptBody(values, financialState(), 'r1', { ...method, id: 'm2' })).toThrow();
  });
  it('normaliza motivo e referência sem tocar dinheiro', () => {
    expect(
      toReceiptBody(
        { ...values, reason: '  conferido  ', reference: '  comprovante  ' },
        financialState(),
        'r1',
        method,
      ),
    ).toMatchObject({ reason: 'conferido', reference: 'comprovante' });
  });
  it.each(['2026-02-30', '13/10/2026', '', '2026-13-01'])(
    'recusa data inválida ou não ISO: %s',
    (receivedOn) => {
      expect(receiptFormSchema.safeParse({ ...values, receivedOn }).success).toBe(false);
    },
  );
  it('filtro aceita vazio e rejeita período invertido', () => {
    expect(filterSchema.safeParse({ orderId: '', from: '', to: '' }).success).toBe(true);
    expect(
      filterSchema.safeParse({ orderId: '', from: '2026-10-15', to: '2026-10-01' }).success,
    ).toBe(false);
  });
  it('vencido exige saldo positivo e dia anterior', () => {
    expect(isOverdue(receivable(), '2026-10-13')).toBe(true);
    expect(isOverdue(receivable(), '2026-10-01')).toBe(false);
    expect(isOverdue(receivable({ outstandingCents: 0, status: 'paid' }), '2026-10-13')).toBe(
      false,
    );
  });
  it('nega vendedor e Super Admin mesmo com permissão financeira indevida', () => {
    const session = {
      role: 'administrator',
      isPlatformAdmin: false,
      permissions: ['receivables:read'],
    };
    expect(canReadFinance(session)).toBe(true);
    expect(canReadFinance({ ...session, role: 'seller' })).toBe(false);
    expect(canReadFinance({ ...session, isPlatformAdmin: true })).toBe(false);
    expect(canReadFinance({ ...session, permissions: [] })).toBe(false);
  });
});
