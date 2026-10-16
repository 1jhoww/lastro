import { deleteApp } from 'firebase-admin/app';
import { loadConfig } from '../config/env.js';
import { createFirebase } from '../infrastructure/firebase/client.js';
import { FoundationRepository } from '../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../modules/auth/accessService.js';
import { PlanMigration } from '../modules/platformAdmin/planMigration.js';
import { assertRuntime } from '../config/runtime.js';

/**
 * Moves companies created before the official plans to Profissional (see planMigration.ts).
 *
 * Default is a dry-run that only reports. `--apply` writes. Outside the local demo emulators,
 * the command also requires `--confirm-project=<project id>` naming the configured project, so
 * it cannot run against a real project by accident. `--tenant=<id>` limits it to one company.
 */
assertRuntime();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const confirmed = args.find((arg) => arg.startsWith('--confirm-project='))?.slice(18);
const tenantId = args.find((arg) => arg.startsWith('--tenant='))?.slice(9);
if (
  args.some(
    (arg) =>
      arg !== '--apply' &&
      !/^--confirm-project=[a-z0-9-]{4,40}$/.test(arg) &&
      !/^--tenant=[A-Za-z0-9_-]{1,128}$/.test(arg),
  )
)
  throw new Error('Use --apply, --confirm-project=<id> e/ou --tenant=<id>; padrão dry-run');
const config = loadConfig();
const local = config.mode === 'emulator' && config.projectId.startsWith('demo-');
if (!local && confirmed !== config.projectId)
  throw new Error(
    `Projeto ${config.projectId} não é emulador local: confirme com --confirm-project=${config.projectId}`,
  );
const firebase = createFirebase(config);
try {
  const repo = new FoundationRepository(firebase.db);
  const result = await new PlanMigration(repo, new AccessService(repo)).run(
    tenantId ? { apply, tenantId } : { apply },
  );
  console.log(JSON.stringify({ project: config.projectId, ...result }, null, 2));
} finally {
  await firebase.db.terminate();
  await deleteApp(firebase.app);
}
