// Local declarations only. This script never deploys indexes.
import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../firestore.indexes.json', import.meta.url);
const value = JSON.parse(await readFile(path, 'utf8'));
const add = (collectionGroup, fields) => {
  const index = {
    collectionGroup,
    queryScope: 'COLLECTION',
    fields: fields.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' })),
  };
  if (!value.indexes.some((i) => JSON.stringify(i) === JSON.stringify(index)))
    value.indexes.push(index);
};
for (const kind of ['paymentConditions', 'paymentMethods']) add(kind, ['status', 'nameKey']);
add('receivables', ['orderId', 'dueDate']);
add('financialEvents', ['orderId', 'sequence']);
add('creditApplications', ['orderId', 'status']);
for (const collection of ['payments', 'creditApplications', 'refundObligations'])
  add(collection, ['customerId', 'orderId']);
add('creditLots', ['customerId', 'originOrderId']);
const overrides = {
  orders: ['paymentTerms', 'intendedPaymentMethod'],
  paymentConditions: ['schedule', 'description'],
  paymentMethods: ['description'],
  financialOperations: ['result', 'payloadHash'],
  financialEvents: ['before', 'after', 'references', 'reason', 'hash', 'previousHash'],
  payments: ['allocations', 'method', 'reference'],
  creditApplications: ['allocations'],
  refundConfirmations: ['method', 'reference', 'reason'],
  returns: ['lines', 'reason'],
  returnEvents: ['before', 'after', 'guards', 'reason', 'hash', 'previousHash'],
  returnReceipts: ['lines', 'reason'],
};
for (const [collectionGroup, fields] of Object.entries(overrides))
  for (const fieldPath of fields) {
    if (
      !value.fieldOverrides.some(
        (f) => f.collectionGroup === collectionGroup && f.fieldPath === fieldPath,
      )
    )
      value.fieldOverrides.push({ collectionGroup, fieldPath, indexes: [] });
  }
await writeFile(path, JSON.stringify(value, null, 2) + '\n');
console.log(
  JSON.stringify({ indexes: value.indexes.length, fieldOverrides: value.fieldOverrides.length }),
);
