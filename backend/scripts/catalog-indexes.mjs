// Local declarations only. Public routes do not deploy indexes or change Rules.
import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../firestore.indexes.json', import.meta.url);
const config = JSON.parse(await readFile(path, 'utf8'));
const fields = ['status', 'categoryId', 'catalogVisible'].map((fieldPath) => ({
  fieldPath,
  order: 'ASCENDING',
}));
const index = { collectionGroup: 'products', queryScope: 'COLLECTION', fields };
if (!config.indexes.some((value) => JSON.stringify(value) === JSON.stringify(index)))
  config.indexes.push(index);
for (const [collectionGroup, paths] of Object.entries({
  catalogSettings: ['description', 'whatsappNumber'],
  catalogOperations: ['result', 'payloadHash'],
}))
  for (const fieldPath of paths)
    if (
      !config.fieldOverrides.some(
        (v) => v.collectionGroup === collectionGroup && v.fieldPath === fieldPath,
      )
    )
      config.fieldOverrides.push({ collectionGroup, fieldPath, indexes: [] });
await writeFile(path, JSON.stringify(config, null, 2) + '\n');
console.log(
  JSON.stringify({ indexes: config.indexes.length, fieldOverrides: config.fieldOverrides.length }),
);
