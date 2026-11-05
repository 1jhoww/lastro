import { readFileSync, writeFileSync } from 'node:fs';
// Composite indexes of Lastro Gestão: exactly what the list schemas accept, nothing more.
// Each index is paid on every write, so the API refuses filter combinations left out here.
const file = 'firestore.indexes.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
const groups = [
  'purchases',
  'purchaseEvents',
  'purchaseReceipts',
  'payables',
  'payablePayments',
  'supplierCredits',
];
const managed = new Set([...groups, 'productCostEvents', 'expenseCategories', 'recurringExpenses']);
config.indexes = config.indexes.filter(
  (i) => !managed.has(i.collectionGroup) && !i.fields.some((f) => f.fieldPath === 'isSupplier'),
);
const index = (collectionGroup, fields) =>
  config.indexes.push({
    collectionGroup,
    queryScope: 'COLLECTION',
    fields: fields.map(([fieldPath, order = 'ASCENDING']) => ({ fieldPath, order })),
  });
// `purchaseQuery` refuses status together with pendingReceipt.
for (const filters of [
  ['status'],
  ['supplierId'],
  ['pendingReceipt'],
  ['status', 'supplierId'],
  ['supplierId', 'pendingReceipt'],
])
  index('purchases', [...filters.map((f) => [f]), ['number', 'DESCENDING']]);
index('purchaseEvents', [['purchaseId'], ['occurredAt', 'DESCENDING']]);
index('purchaseReceipts', [['purchaseId'], ['number', 'DESCENDING']]);
// `hasBalance` and `status` never travel together: open and overdue use the first one.
// `payableQuery` accepts at most one filter besides the situation.
for (const state of ['hasBalance', 'status', null])
  for (const filter of [null, 'beneficiaryId', 'categoryId', 'origin', 'originReference']) {
    const equality = [state, filter].filter(Boolean);
    if (equality.length) index('payables', [...equality.map((f) => [f]), ['dueDate']]);
  }
index('payablePayments', [['payableId'], ['paidOn', 'DESCENDING']]);
index('productCostEvents', [['productId'], ['occurredAt', 'DESCENDING']]);
index('expenseCategories', [['status'], ['nameKey']]);
index('recurringExpenses', [['status'], ['createdAt', 'DESCENDING']]);
index('supplierCredits', [['hasBalance'], ['createdAt', 'DESCENDING']]);
// Customer list on the suppliers tab. Suppliers have no assignee, so it is not a filter there.
for (const filters of [[], ['status']])
  for (const order of ['nameKey', 'createdAt'])
    for (const direction of ['ASCENDING', 'DESCENDING'])
      index('customers', [['isSupplier'], ...filters.map((f) => [f]), [order, direction]]);
// Free text and snapshots are never queried: no single-field indexes for them.
for (const [collectionGroup, fields] of Object.entries({
  purchases: ['notes', 'lines', 'installments', 'paymentCondition', 'supplierName'],
  purchaseReceipts: ['notes', 'items'],
  payables: ['notes', 'description', 'beneficiaryName', 'categoryName'],
  payablePayments: ['notes', 'description', 'beneficiaryName', 'method'],
  orderCostSnapshots: ['lines'],
  productCostEvents: ['previous', 'next', 'reason'],
  recurringExpenses: ['notes', 'description', 'beneficiaryName', 'categoryName'],
  purchaseClosures: ['items', 'titles', 'notes', 'reason'],
  supplierCredits: ['supplierName', 'purchaseCode'],
  supplierCreditMovements: ['notes', 'payableDescription', 'reversalReason'],
})) {
  for (const fieldPath of fields)
    if (
      !config.fieldOverrides.some(
        (f) => f.collectionGroup === collectionGroup && f.fieldPath === fieldPath,
      )
    )
      config.fieldOverrides.push({ collectionGroup, fieldPath, indexes: [] });
}
writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Índices declarados: ${config.indexes.length}; nenhum deploy.`);
