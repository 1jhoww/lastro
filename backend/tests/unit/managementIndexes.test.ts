import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { payableQuery, purchaseQuery } from '../../src/shared/schemas/management.js';

type Index = { collectionGroup: string; fields: { fieldPath: string; order?: string }[] };
const declared = (
  JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as { indexes: Index[] }
).indexes;
const shape = (i: Index) =>
  `${i.collectionGroup}:${i.fields
    .map((f) => `${f.fieldPath}${f.order === 'DESCENDING' ? '↓' : ''}`)
    .join(',')}`;
const shapes = new Set(declared.map(shape));
const requireIndex = (group: string, fields: string[]) =>
  expect(shapes, `${group}: ${fields.join(',')}`).toContain(`${group}:${fields.join(',')}`);

describe('Índices do Lastro Gestão', () => {
  it('não declara índices repetidos', () => {
    expect(shapes.size).toBe(declared.length);
  });
  it('cobre toda combinação aceita em contas a pagar', () => {
    for (const state of ['hasBalance', 'status', null])
      for (const filter of ['beneficiaryId', 'categoryId', 'origin', 'originReference', null]) {
        const equality = [state, filter].filter((v): v is string => v !== null);
        if (equality.length) requireIndex('payables', [...equality, 'dueDate']);
      }
  });
  it('cobre toda combinação aceita em compras', () => {
    for (const fields of [
      ['status'],
      ['supplierId'],
      ['pendingReceipt'],
      ['status', 'supplierId'],
      ['supplierId', 'pendingReceipt'],
    ])
      requireIndex('purchases', [...fields, 'number↓']);
  });
  it('cobre a aba de fornecedores e os créditos', () => {
    for (const filters of [[], ['status']])
      for (const order of ['nameKey', 'nameKey↓', 'createdAt', 'createdAt↓'])
        requireIndex('customers', ['isSupplier', ...filters, order]);
    requireIndex('supplierCredits', ['hasBalance', 'createdAt↓']);
  });
  it('recusa combinações sem índice', () => {
    const base = { situation: 'open' };
    expect(payableQuery.safeParse({ ...base, origin: 'purchase' }).success).toBe(true);
    expect(payableQuery.safeParse({ ...base, origin: 'purchase', categoryId: 'c1' }).success).toBe(
      false,
    );
    expect(purchaseQuery.safeParse({ status: 'draft', pendingReceipt: 'true' }).success).toBe(
      false,
    );
  });
});
