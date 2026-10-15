import { readFileSync, writeFileSync } from 'node:fs';
const file = 'firestore.indexes.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
config.indexes = config.indexes.filter(
  (index) => !['inventory', 'inventoryMovements'].includes(index.collectionGroup),
);
for (const filters of [
  ['belowMinimum'],
  ['belowMinimum', 'status'],
  ['belowMinimum', 'categoryId'],
  ['belowMinimum', 'status', 'categoryId'],
]) {
  for (const fieldPath of ['nameKey', 'shortfallScaled'])
    for (const direction of ['ASCENDING', 'DESCENDING'])
      config.indexes.push({
        collectionGroup: 'inventory',
        queryScope: 'COLLECTION',
        fields: [
          ...filters.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' })),
          { fieldPath, order: direction },
        ],
      });
}
for (const filters of [['productId'], ['type'], ['productId', 'type']]) {
  for (const direction of ['ASCENDING', 'DESCENDING'])
    config.indexes.push({
      collectionGroup: 'inventoryMovements',
      queryScope: 'COLLECTION',
      fields: [
        ...filters.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' })),
        { fieldPath: 'occurredAt', order: direction },
      ],
    });
}
config.indexes.push({
  collectionGroup: 'inventoryMovements',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'productId', order: 'ASCENDING' },
    { fieldPath: 'sequence', order: 'ASCENDING' },
  ],
});
for (const [collectionGroup, fields] of Object.entries({
  inventoryMovements: ['reason', 'notes', 'hash', 'previousHash'],
  stockOperations: ['stockAfter', 'payloadHash'],
}))
  for (const fieldPath of fields) {
    if (
      !config.fieldOverrides.some(
        (field) => field.collectionGroup === collectionGroup && field.fieldPath === fieldPath,
      )
    )
      config.fieldOverrides.push({ collectionGroup, fieldPath, indexes: [] });
  }
writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Índices declarados: ${config.indexes.length}; nenhum deploy.`);
