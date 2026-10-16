import { randomUUID } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import type { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import type { Actor } from '../types/context.js';
import { auditSchema } from '../schemas/models.js';
/**
 * Super Admin action about one company, kept in the platform log (never readable by the
 * company) and tagged with its tenant for history queries.
 */
export function recordPlatformAudit(
  repo: FoundationRepository,
  tx: Transaction,
  actor: Actor,
  tenantId: string,
  action: string,
  resourceId: string,
  now: string,
  changes: Record<string, unknown>,
): void {
  const id = randomUUID();
  tx.create(
    repo.global('auditLogs', id),
    auditSchema.parse({
      id,
      actorUid: actor.uid,
      tenantId,
      action,
      resourceId,
      requestId: actor.requestId,
      occurredAt: now,
      changes,
      schemaVersion: 1,
    }),
  );
}
export function recordAudit(
  repo: FoundationRepository,
  tx: Transaction,
  actor: Actor,
  tenantId: string | null,
  action: string,
  resourceId: string,
  now: string,
  changes: Record<string, unknown>,
): void {
  const id = randomUUID();
  tx.create(
    tenantId ? repo.tenant(tenantId, 'auditLogs', id) : repo.global('auditLogs', id),
    auditSchema.parse({
      id,
      actorUid: actor.uid,
      tenantId,
      action,
      resourceId,
      requestId: actor.requestId,
      occurredAt: now,
      changes,
      schemaVersion: 1,
    }),
  );
}
