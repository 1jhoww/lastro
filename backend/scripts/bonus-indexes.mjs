import { readFileSync, writeFileSync } from 'node:fs';
const file = 'firestore.indexes.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
config.indexes = config.indexes.filter(
  (i) => i.collectionGroup !== 'bonuses' && i.collectionGroup !== 'bonusEvents',
);
// History list, newest first. `kind` and `customerId` are never combined: the schema refuses it,
// so the seller scope (`responsibleUid`) is the only field that pairs with either of them.
for (const equality of [
  ['kind'],
  ['customerId'],
  ['responsibleUid'],
  ['responsibleUid', 'kind'],
  ['responsibleUid', 'customerId'],
])
  config.indexes.push({
    collectionGroup: 'bonuses',
    queryScope: 'COLLECTION',
    fields: [
      ...equality.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' })),
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
    ],
  });
config.indexes.push({
  collectionGroup: 'bonusEvents',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'bonusId', order: 'ASCENDING' },
    { fieldPath: 'occurredAt', order: 'ASCENDING' },
  ],
});
// Returns report: each return by its own date, whatever the period of the bonus.
config.indexes.push({
  collectionGroup: 'bonusEvents',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'type', order: 'ASCENDING' },
    { fieldPath: 'occurredAt', order: 'ASCENDING' },
  ],
});
for (const [collectionGroup, fields] of Object.entries({
  bonuses: ['lines', 'linePrices', 'notes', 'reasonDetail', 'customerName'],
  bonusEvents: ['lines', 'reason'],
  bonusOperations: ['result', 'payloadHash'],
  bonusCostSnapshots: ['lines'],
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
