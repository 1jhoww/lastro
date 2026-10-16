import { deleteApp } from 'firebase-admin/app';
import { loadConfig } from '../config/env.js';
import { assertRuntime } from '../config/runtime.js';
import { createFirebase } from '../infrastructure/firebase/client.js';
import { FoundationRepository } from '../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../modules/auth/accessService.js';
import { BillingService, billingJobActor } from '../modules/billing/billingService.js';

/**
 * Daily billing run, meant for a Cloud Run Job started by Cloud Scheduler with the API image:
 * `node dist/src/jobs/billingCycle.js`. It exposes no HTTP endpoint and is idempotent, so
 * retries and manual runs never duplicate charges. Exit code 1 when any contract failed.
 */
assertRuntime();
const config = loadConfig();
const firebase = createFirebase(config);
try {
  const repo = new FoundationRepository(firebase.db);
  const billing = new BillingService(repo, new AccessService(repo), config);
  const summary = await billing.generateDue(billingJobActor());
  console.log(JSON.stringify({ event: 'billing.generation.completed', ...summary }));
  if (summary.failed > 0) process.exitCode = 1;
} finally {
  await firebase.db.terminate();
  await deleteApp(firebase.app);
}
