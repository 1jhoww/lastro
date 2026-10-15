import { randomUUID } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import type { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import type { Actor } from '../types/context.js';
import { auditSchema } from '../schemas/models.js';
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
