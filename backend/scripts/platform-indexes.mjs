// Local declarations only. Deploying indexes is a separate, authorized operation.
import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../firestore.indexes.json', import.meta.url);
const config = JSON.parse(await readFile(path, 'utf8'));
const indexes = [
  // Subscription history: platform audit entries of one resource, newest first.
  {
    collectionGroup: 'auditLogs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'resourceId', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
    ],
  },
];
const charge = (fields) => ({
  collectionGroup: 'billingCharges',
  queryScope: 'COLLECTION',
  fields: fields.map(([fieldPath, order]) => ({ fieldPath, order })),
});
// Dashboard: payments recorded in the current month.
indexes.push(
  charge([
    ['status', 'ASCENDING'],
    ['paidAt', 'ASCENDING'],
  ]),
);
// Charge lists: by situation and/or company, ordered by due date (both directions).
for (const order of ['ASCENDING', 'DESCENDING']) {
  indexes.push(
    charge([
      ['status', 'ASCENDING'],
      ['dueDate', order],
      ['__name__', order],
    ]),
  );
  indexes.push(
    charge([
      ['tenantId', 'ASCENDING'],
      ['dueDate', order],
      ['__name__', order],
    ]),
  );
  indexes.push(
    charge([
      ['tenantId', 'ASCENDING'],
      ['status', 'ASCENDING'],
      ['dueDate', order],
      ['__name__', order],
    ]),
  );
}
for (const index of indexes)
  if (!config.indexes.some((value) => JSON.stringify(value) === JSON.stringify(index)))
    config.indexes.push(index);
await writeFile(path, JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({ indexes: config.indexes.length }));
