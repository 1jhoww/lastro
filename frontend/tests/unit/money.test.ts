import { centsFromDigits, formatBasisPoints, formatCents } from '@/lib/money';

describe('dinheiro em centavos', () => {
  it('formata BRL sem ponto flutuante', () => {
    expect(formatCents(0)).toBe('R$ 0,00');
    expect(formatCents(12990)).toBe('R$ 129,90');
    expect(formatCents(123456789)).toBe('R$ 1.234.567,89');
    expect(formatCents(-500)).toBe('−R$ 5,00');
  });

  it('recusa valor não inteiro', () => {
    expect(() => formatCents(10.5)).toThrow(RangeError);
  });

  it('lê dígitos deslocando pela direita e limita ao teto', () => {
    expect(centsFromDigits('R$ 1,234')).toBe(1234);
    expect(centsFromDigits('')).toBe(0);
    expect(centsFromDigits('999999999999', 100_000_000)).toBe(100_000_000);
  });

  it('formata pontos base', () => {
    expect(formatBasisPoints(1000)).toBe('10%');
    expect(formatBasisPoints(1250)).toBe('12,5%');
  });
});
