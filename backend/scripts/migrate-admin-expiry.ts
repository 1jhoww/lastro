import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { deleteApp } from 'firebase-admin/app';
import { loadConfig } from '../src/config/env.js';
import { createFirebase } from '../src/infrastructure/firebase/client.js';
import { idempotencySchema } from '../src/shared/schemas/models.js';
import { assertRuntime } from '../src/config/runtime.js';

assertRuntime();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const cursor = args.find((arg) => arg.startsWith('--cursor='))?.slice(9);
if (args.some((arg) => arg !== '--apply' && !/^--cursor=[a-f0-9]{64}$/.test(arg)))
  throw new Error('Use --apply e/ou --cursor=<id SHA-256>; padrão dry-run');
const config = loadConfig();
if (config.mode !== 'emulator' || !config.projectId.startsWith('demo-'))
  throw new Error('Migração local aceita somente emuladores demo');
const firebase = createFirebase(config);
try {
  let query = firebase.db
    .collection('idempotencyRecords')
    .orderBy(FieldPath.documentId())
    .limit(100);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  const batch = firebase.db.batch();
  let converted = 0;
  for (const doc of page.docs) {
    const raw = doc.data();
    idempotencySchema.parse(raw);
    if (typeof raw.expiresAt === 'string') {
      batch.update(
        doc.ref,
        { expiresAt: Timestamp.fromDate(new Date(raw.expiresAt)) },
        { lastUpdateTime: doc.updateTime! },
      );
      converted++;
    }
  }
  if (apply && converted) await batch.commit();
  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      examined: page.size,
      converted,
      nextCursor: page.size === 100 ? page.docs.at(-1)!.id : null,
    }),
  );
} finally {
  await firebase.db.terminate();
  await deleteApp(firebase.app);
}
