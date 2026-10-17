import { readFileSync, writeFileSync } from 'node:fs';
const file = 'firestore.indexes.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
config.indexes = config.indexes.filter((i) => i.collectionGroup !== 'visits');
// Visit list: every combination of the equality filters, newest visit date first.
const equality = ['customerId', 'responsibleUid', 'source'];
for (let mask = 1; mask < 1 << equality.length; mask++)
  config.indexes.push({
    collectionGroup: 'visits',
    queryScope: 'COLLECTION',
    fields: [
      ...equality
        .filter((_, i) => mask & (1 << i))
        .map((fieldPath) => ({ fieldPath, order: 'ASCENDING' })),
      { fieldPath: 'visitDate', order: 'DESCENDING' },
    ],
  });
// Purchases of one customer, newest confirmation first (history and repurchase estimate).
const purchases = {
  collectionGroup: 'orders',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'customerId', order: 'ASCENDING' },
    { fieldPath: 'confirmedAt', order: 'DESCENDING' },
  ],
};
if (!config.indexes.some((i) => JSON.stringify(i) === JSON.stringify(purchases)))
  config.indexes.push(purchases);
for (const [collectionGroup, fields] of Object.entries({
  visits: ['notes', 'customerName', 'payloadHash'],
  deliveries: ['notes', 'receivedBy'],
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
