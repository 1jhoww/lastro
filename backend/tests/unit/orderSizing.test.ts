import { describe, it, expect } from 'vitest';
import { orderCreate, lineInput } from '../../src/shared/schemas/orders.js';
import {
  documentSize,
  assertDocumentFits,
  FIRESTORE_DOCUMENT_BYTES,
  valueSize,
} from '../../src/modules/orders/technicalSize.js';
describe('Pedidos sem restrição comercial de tamanho/mínimo', () => {
  it.each([20, 50, 100, 200, 1000])('schema aceita %i produtos distintos', (count) => {
    expect(
      orderCreate.safeParse({
        lines: Array.from({ length: count }, (_, i) => ({ productId: `p${i}`, quantity: '1' })),
      }).success,
    ).toBe(true);
  });
  it('rascunho vazio e sem cliente/condição é válido', () => {
    expect(orderCreate.safeParse({}).success).toBe(true);
    expect(orderCreate.safeParse({ customerId: null, lines: [], payment: null }).success).toBe(
      true,
    );
  });
  it.each(['0', '0.000', '-1', '0.0001'])(
    'rejeita quantidade %s sem mínimo comercial',
    (quantity) => expect(lineInput.safeParse({ productId: 'p', quantity }).success).toBe(false),
  );
  it('aceita quantidade mínima representável e uma unidade', () => {
    for (const quantity of ['0.001', '1'])
      expect(lineInput.safeParse({ productId: 'p', quantity }).success).toBe(true);
  });
  it('calcula exemplo oficial de documento de 147 bytes', () =>
    expect(
      documentSize('users/jeff/tasks/my_task_id', {
        type: 'Personal',
        done: false,
        priority: 1,
        description: 'Learn Cloud Firestore',
      }),
    ).toBe(147));
  it('conta UTF-8 e mapas/arrays, não caracteres JSON', () => {
    expect(valueSize('界')).toBe(4);
    expect(valueSize(['界', 2, null])).toBe(13);
    expect(valueSize({ a: '界' })).toBe(38);
  });
  it('rejeita documento maior que 1 MiB sem limite por número de linhas', () => {
    expect(() =>
      assertDocumentFits('tenants/t/orders/o', {
        description: 'x'.repeat(FIRESTORE_DOCUMENT_BYTES),
      }),
    ).toThrow(/tamanho técnico/);
    expect(() =>
      assertDocumentFits('tenants/t/orders/o', {
        lines: Array.from({ length: 1000 }, () => ({ quantity: '1' })),
      }),
    ).not.toThrow();
  });
});
