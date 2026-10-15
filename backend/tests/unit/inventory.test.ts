import { describe, it, expect } from 'vitest';
import {
  parseQuantity,
  formatQuantity,
  transition,
  MAX_SCALED,
} from '../../src/modules/inventory/quantities.js';
import { entryInput } from '../../src/shared/schemas/inventory.js';
describe('Quantidades exatas e invariantes de estoque', () => {
  it.each(['UN', 'CX', 'PCT'] as const)('aceita inteiros em %s e rejeita fração', (unit) => {
    expect(parseQuantity('12', unit)).toBe(12000);
    expect(() => parseQuantity('1.0', unit)).toThrow();
    expect(() => parseQuantity('1.25', unit)).toThrow();
  });
  it.each(['KG', 'L'] as const)('preserva três casas em %s sem aritmética float', (unit) => {
    expect(parseQuantity('1.250', unit)).toBe(1250);
    expect(formatQuantity(parseQuantity('1.250', unit))).toBe('1.25');
    expect(parseQuantity('0.001', unit)).toBe(1);
    expect(parseQuantity('0.1', unit) + parseQuantity('0.2', unit)).toBe(300);
    expect(() => parseQuantity('1.2501', unit)).toThrow();
  });
  it.each(['-1', '+1', '1,250', '1e3', 'NaN', 'Infinity', '01', '1.', ' 1 ', '1000000000.001'])(
    'rejeita quantidade pública inválida %s',
    (quantity) => expect(() => parseQuantity(quantity, 'KG')).toThrow(),
  );
  it('limita números e tipos; entrada só recebe texto', () => {
    expect(parseQuantity('1000000000', 'UN')).toBe(MAX_SCALED);
    expect(entryInput.safeParse({ productId: 'id', quantity: 1.25, reason: 'Teste' }).success).toBe(
      false,
    );
    expect(parseQuantity('-1.250', 'KG', true)).toBe(-1250);
  });
  it('prepara aritmética de reserva/liberação/expedição/devolução sem persistir pedidos', () => {
    const reservation = transition(10000, 0, 'STOCK_RESERVATION', 5000);
    expect(reservation).toEqual({ physicalScaled: 10000, reservedScaled: 5000 });
    expect(transition(10000, 5000, 'STOCK_RESERVATION_RELEASE', 2000)).toEqual({
      physicalScaled: 10000,
      reservedScaled: 3000,
    });
    expect(transition(10000, 5000, 'STOCK_DISPATCH', 5000)).toEqual({
      physicalScaled: 5000,
      reservedScaled: 0,
    });
    expect(transition(5000, 0, 'STOCK_RETURN', 1000)).toEqual({
      physicalScaled: 6000,
      reservedScaled: 0,
    });
  });
  it.each([
    'STOCK_ADJUSTMENT_OUT',
    'STOCK_RESERVATION',
    'STOCK_RESERVATION_RELEASE',
    'STOCK_DISPATCH',
  ] as const)('protege invariantes de %s', (type) => {
    expect(() => transition(1000, 900, type, 2000)).toThrow();
  });
  it('ajuste não reduz físico abaixo da reserva e entrada não ultrapassa limite', () => {
    expect(() => transition(10000, 9000, 'STOCK_ADJUSTMENT_OUT', 2000)).toThrow();
    expect(() => transition(MAX_SCALED, 0, 'STOCK_ENTRY', 1)).toThrow();
    expect(() => transition(10, 11, 'STOCK_ENTRY', 1)).toThrow();
    expect(() => transition(0, 0, 'STOCK_ENTRY', 0)).toThrow();
  });
});
