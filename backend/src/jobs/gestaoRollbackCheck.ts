import { deleteApp } from 'firebase-admin/app';
import { loadConfig } from '../config/env.js';
import { assertRuntime } from '../config/runtime.js';
import { createFirebase } from '../infrastructure/firebase/client.js';
import { rollbackBlockers } from '../modules/platformAdmin/rollbackCheck.js';

/**
 * Read-only check before reverting the API to the version prior to Lastro Gestão:
 * `node dist/src/jobs/gestaoRollbackCheck.js`. Exit code 2 means reverting would break reads.
 */
assertRuntime();
const config = loadConfig();
const firebase = createFirebase(config);
try {
  const result = await rollbackBlockers(firebase.db);
  console.log(JSON.stringify({ event: 'gestao.rollback.checked', ...result }));
  if (!result.rollbackSafe) process.exitCode = 2;
} finally {
  await firebase.db.terminate();
  await deleteApp(firebase.app);
}
