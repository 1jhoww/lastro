import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
const read = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const local = read('firestore.indexes.json');
const remote = read('.local/phase9-remote-indexes.json');
const remoteFields = read('.local/phase9-remote-fields.json');
if (
  ![...remote, ...remoteFields].every((value) =>
    value.name.startsWith('projects/lastro-hml/databases/(default)/'),
  )
)
  throw new Error('Expected read-only snapshots of lastro-hml/(default)');
const group = (name) => name.split('/collectionGroups/')[1].split('/')[0];
const fields = (values) => {
  const complete = values.some((f) => f.fieldPath === '__name__')
    ? values
    : [...values, { fieldPath: '__name__', order: values.at(-1)?.order ?? 'ASCENDING' }];
  return complete.map((f) => ({
    fieldPath: f.fieldPath,
    ...(f.order ? { order: f.order } : { arrayConfig: f.arrayConfig }),
  }));
};
const key = (index) =>
  JSON.stringify([
    index.collectionGroup ?? group(index.name),
    index.queryScope,
    fields(index.fields),
  ]);
const inventory = local.indexes.map((index, i) => {
  const match = remote.find((r) => key(r) === key(index));
  return {
    position: i + 1,
    ...index,
    remoteState: match?.state ?? 'MISSING',
    remoteName: match?.name ?? null,
  };
});
const fieldInventory = local.fieldOverrides.map((field) => {
  const match = remoteFields.find(
    (r) => group(r.name) === field.collectionGroup && r.name.endsWith('/fields/' + field.fieldPath),
  );
  const remoteIndexes = match?.indexConfig?.indexes ?? [];
  const fieldKey = (index) => JSON.stringify([index.queryScope, fields(index.fields)]);
  const equal =
    JSON.stringify((field.indexes ?? []).map(fieldKey).sort()) ===
    JSON.stringify(remoteIndexes.map(fieldKey).sort());
  return {
    ...field,
    remoteState: !match
      ? 'MISSING'
      : equal && (!field.ttl || match.ttlConfig?.state === 'ACTIVE')
        ? 'MATCH'
        : 'DIFFERENT',
    remoteTtl: match?.ttlConfig ?? null,
  };
});
const missing = inventory.filter((i) => i.remoteState === 'MISSING');
const result = {
  project: 'lastro-hml',
  database: '(default)',
  checkedAt: new Date().toISOString(),
  remoteSnapshotAt: statSync('.local/phase9-remote-indexes.json').mtime.toISOString(),
  declared: inventory.length,
  remote: remote.length,
  missing: missing.length,
  inventory,
  fieldInventory,
};
mkdirSync('../docs/audits/evidence/fase9', { recursive: true });
writeFileSync(
  '../docs/audits/evidence/fase9/firestore-indexes.json',
  JSON.stringify(result, null, 2),
);
const commands = missing.map(
  (index) =>
    `gcloud firestore indexes composite create --project=lastro-hml --database="(default)" --collection-group=${index.collectionGroup} --query-scope=${index.queryScope.toLowerCase().replaceAll('_', '-')} ${index.fields.map((f) => `--field-config=field-path=${f.fieldPath},${f.order ? `order=${f.order.toLowerCase()}` : 'array-config=contains'}`).join(' ')}`,
);
commands.push(
  ...fieldInventory
    .filter((f) => f.remoteState !== 'MATCH')
    .map(
      (f) =>
        `gcloud firestore indexes fields update ${f.fieldPath} --project=lastro-hml --database="(default)" --collection-group=${f.collectionGroup} --disable-indexes`,
    ),
);
writeFileSync(
  '../docs/audits/evidence/fase9/pending-index-commands.txt',
  '# Prepared for explicit approval. NOT executed.\n' + commands.join('\n') + '\n',
);
console.log(
  JSON.stringify({
    declared: inventory.length,
    remote: remote.length,
    missing: missing.length,
    missingByCollection: missing.reduce(
      (m, i) => ({ ...m, [i.collectionGroup]: (m[i.collectionGroup] ?? 0) + 1 }),
      {},
    ),
    fieldStates: fieldInventory.reduce(
      (m, i) => ({ ...m, [i.remoteState]: (m[i.remoteState] ?? 0) + 1 }),
      {},
    ),
  }),
);
