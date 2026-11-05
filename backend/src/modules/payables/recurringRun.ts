import { randomUUID } from 'node:crypto';
import { FieldPath, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { planCatalog, planCodes } from '../plans/catalog.js';
import { subscriptionSchema, tenantSchema } from '../../shared/schemas/models.js';
import type { Actor } from '../../shared/types/context.js';
import type { RecurringService } from './recurringService.js';

const PAGE_SIZE = 200;

export const recurringJobActor = (): Actor => ({
  uid: 'lastro-recurring-job',
  email: null,
  emailVerified: false,
  authTime: 0,
  requestId: randomUUID(),
});

type Severity = 'INFO' | 'ERROR';
export type RunLog = (severity: Severity, event: string, fields: Record<string, unknown>) => void;

/** One JSON line per event: Cloud Logging reads `severity` and keeps the rest as fields. */
export const jsonRunLog: RunLog = (severity, event, fields) => {
  const line = JSON.stringify({ severity, event, ...fields });
  if (severity === 'ERROR') console.error(line);
  else console.log(line);
};

const failureOf = (error: unknown) => ({
  errorType: error instanceof Error ? error.name : 'unknown',
  message: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
});

export interface RunOptions {
  db: Firestore;
  recurring: RecurringService;
  actor?: Actor;
  log?: RunLog;
  /** Counts what would be issued without writing, to check an environment before enabling it. */
  dryRun?: boolean;
}

export interface RunSummary {
  dryRun: boolean;
  contracts: number;
  companies: number;
  skipped: number;
  examined: number;
  created: number;
  /** Companies or recurrences that failed; the others were processed anyway. */
  failed: number;
  durationMs: number;
}

/**
 * Daily issue of recurring expenses for every company whose plan has the feature. A failure stays
 * inside its company, or its recurrence, and is reported at the end: the caller exits with an error
 * and a retry only issues what is missing, since a title is unique by recurrence and due date.
 */
export async function runRecurringGeneration(options: RunOptions): Promise<RunSummary> {
  const { db, recurring, dryRun = false, log = jsonRunLog } = options;
  const actor = options.actor ?? recurringJobActor();
  const startedAt = Date.now();
  const summary = { contracts: 0, companies: 0, skipped: 0, examined: 0, created: 0, failed: 0 };
  log('INFO', 'recurring.generation.started', { dryRun, requestId: actor.requestId });
  const plans = planCodes.filter((code) => planCatalog[code].features.includes('finance.payables'));
  const contracts = db
    .collection('subscriptions')
    .where('planCode', 'in', plans)
    .orderBy(FieldPath.documentId())
    .limit(PAGE_SIZE);
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (last ? contracts.startAfter(last) : contracts).get();
    for (const doc of page.docs) {
      summary.contracts++;
      try {
        const subscription = subscriptionSchema.parse(doc.data());
        if (subscription.status === 'suspended' || subscription.status === 'canceled') {
          summary.skipped++;
          continue;
        }
        const tenant = tenantSchema.parse(
          (await db.doc(`tenants/${subscription.tenantId}`).get()).data(),
        );
        const result = await recurring.generateFor(actor, tenant.id, tenant.timezone, {
          dryRun,
          onFailure: (recurrenceId, error) =>
            log('ERROR', 'recurring.generation.recurrence_failed', {
              tenantId: tenant.id,
              recurrenceId,
              ...failureOf(error),
            }),
        });
        summary.companies++;
        summary.examined += result.examined;
        summary.created += result.created;
        summary.failed += result.failed;
        if (result.created > 0 || result.failed > 0)
          log('INFO', 'recurring.generation.company_completed', {
            tenantId: tenant.id,
            ...result,
          });
      } catch (error) {
        summary.failed++;
        log('ERROR', 'recurring.generation.company_failed', {
          subscriptionId: doc.id,
          ...failureOf(error),
        });
      }
    }
    if (page.size < PAGE_SIZE) break;
    last = page.docs[page.docs.length - 1];
  }
  const finished = { dryRun, ...summary, durationMs: Date.now() - startedAt };
  log(summary.failed > 0 ? 'ERROR' : 'INFO', 'recurring.generation.completed', finished);
  return finished;
}
