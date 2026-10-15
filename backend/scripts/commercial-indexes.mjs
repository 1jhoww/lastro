import { readFileSync, writeFileSync } from 'node:fs';
const file = 'firestore.indexes.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
const collections = {
  customers: ['status', 'assignedTo'],
  products: ['status', 'categoryId', 'sku', 'catalogVisible'],
  categories: ['status'],
};
config.indexes = config.indexes.filter(
  (index) => !Object.hasOwn(collections, index.collectionGroup),
);
for (const [collectionGroup, filters] of Object.entries(collections)) {
  for (let mask = 1; mask < 2 ** filters.length; mask++) {
    const selected = filters.filter((_field, i) => mask & (1 << i));
    for (const order of ['nameKey', 'createdAt'])
      for (const direction of ['ASCENDING', 'DESCENDING']) {
        config.indexes.push({
          collectionGroup,
          queryScope: 'COLLECTION',
          fields: [
            ...selected.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' })),
            { fieldPath: order, order: direction },
          ],
        });
      }
  }
}
for (const [collectionGroup, fields] of Object.entries({
  customers: ['notes', 'address', 'document', 'email', 'phone', 'tradeName'],
  products: ['description', 'image'],
  categories: ['description'],
})) {
  for (const fieldPath of fields) {
    if (
      !config.fieldOverrides.some(
        (field) => field.collectionGroup === collectionGroup && field.fieldPath === fieldPath,
      )
    )
      config.fieldOverrides.push({ collectionGroup, fieldPath, indexes: [] });
  }
}
writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Índices locais declarados: ${config.indexes.length}; nenhuma implantação executada.`);
