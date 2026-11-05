import { deleteApp } from 'firebase-admin/app';
import { loadConfig } from '../config/env.js';
import { assertRuntime } from '../config/runtime.js';
import { createFirebase } from '../infrastructure/firebase/client.js';
import { FoundationRepository } from '../infrastructure/repositories/foundationRepository.js';
import { CommercialRepository } from '../infrastructure/repositories/commercialRepository.js';
import { AccessService } from '../modules/auth/accessService.js';
import { FinancialCommands } from '../modules/finance/financialCommands.js';
import { PaymentSettingsService } from '../modules/finance/paymentSettingsService.js';
import { PayableService } from '../modules/payables/payableService.js';
import { RecurringService } from '../modules/payables/recurringService.js';
import { runRecurringGeneration } from '../modules/payables/recurringRun.js';

/**
 * Daily issue of recurring expenses, meant for a Cloud Run Job started by Cloud Scheduler with the
 * API image: `node dist/src/jobs/recurringExpenses.js`, optionally with `--dry-run`. It exposes no
 * HTTP endpoint and a retry never duplicates a title. Exit code 1 when anything failed.
 */
assertRuntime();
const config = loadConfig();
const firebase = createFirebase(config);
try {
  const repo = new FoundationRepository(firebase.db);
  const commands = new FinancialCommands(
    new CommercialRepository(repo, config.invitationSecret),
    new AccessService(repo),
    () => new Date(),
  );
  const recurring = new RecurringService(
    commands,
    new PayableService(commands, new PaymentSettingsService(commands)),
  );
  const summary = await runRecurringGeneration({
    db: firebase.db,
    recurring,
    dryRun: process.argv.includes('--dry-run'),
  });
  if (summary.failed > 0) process.exitCode = 1;
} finally {
  await firebase.db.terminate();
  await deleteApp(firebase.app);
}
