import { formatQuantity, fromApiQuantity, parseQuantityInput, toApiQuantity } from '@/lib/quantity';

describe('quantidades (escala 1000)', () => {
  it('aceita vírgula ou ponto e respeita a precisão da unidade', () => {
    expect(parseQuantityInput('1,25', 'KG')).toBe(1250);
    expect(parseQuantityInput('1.250', 'L')).toBe(1250);
    expect(parseQuantityInput('10', 'UN')).toBe(10000);
    expect(parseQuantityInput('1,5', 'CX')).toBeNull();
    expect(parseQuantityInput('0,0001', 'KG')).toBeNull();
    expect(parseQuantityInput('abc', 'UN')).toBeNull();
    expect(parseQuantityInput('-1', 'UN')).toBeNull();
  });

  it('recusa acima do limite do backend', () => {
    expect(parseQuantityInput('1000000000', 'UN')).toBe(1_000_000_000_000);
    expect(parseQuantityInput('1000000001', 'UN')).toBeNull();
  });

  it('converte para o texto canônico da API sem zeros finais', () => {
    expect(toApiQuantity(1250)).toBe('1.25');
    expect(toApiQuantity(10000)).toBe('10');
    expect(toApiQuantity(1)).toBe('0.001');
    expect(fromApiQuantity('1.25')).toBe(1250);
    expect(fromApiQuantity('7')).toBe(7000);
  });

  it('formata em pt-BR', () => {
    expect(formatQuantity(1_250_500, 'KG')).toBe('1.250,5 kg');
    expect(formatQuantity(3000, 'CX')).toBe('3 cx');
    expect(formatQuantity(-2000)).toBe('−2');
  });
});
