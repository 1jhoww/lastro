import { readFileSync, writeFileSync } from 'node:fs';
const file = 'firestore.indexes.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
config.indexes = config.indexes.filter(
  (i) => !['orders', 'orderEvents'].includes(i.collectionGroup),
);
for (const filters of [
  [],
  ['sellerUid'],
  ['status'],
  ['customerId'],
  ['sellerUid', 'status'],
  ['sellerUid', 'customerId'],
  ['status', 'customerId'],
  ['sellerUid', 'status', 'customerId'],
]) {
  if (!filters.length) continue;
  for (const direction of ['ASCENDING', 'DESCENDING'])
    config.indexes.push({
      collectionGroup: 'orders',
      queryScope: 'COLLECTION',
      fields: [
        ...filters.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' })),
        { fieldPath: 'createdAt', order: direction },
      ],
    });
}
config.indexes.push({
  collectionGroup: 'orderEvents',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'orderId', order: 'ASCENDING' },
    { fieldPath: 'version', order: 'ASCENDING' },
  ],
});
for (const [collectionGroup, fields] of Object.entries({
  orders: ['lines', 'installments', 'notes', 'discount', 'payment', 'customerName'],
  orderOperations: ['result', 'payloadHash'],
  orderEvents: ['reason'],
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
