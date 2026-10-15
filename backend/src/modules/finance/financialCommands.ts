import { z } from 'zod';
import type { Transaction } from 'firebase-admin/firestore';
import type { Actor, TenantContext } from '../../shared/types/context.js';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import type { AccessService } from '../auth/accessService.js';
import type { Permission } from '../users/permissions.js';
import { opaqueId, instant } from '../../shared/schemas/models.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { assertDocumentFits } from '../orders/technicalSize.js';
import { FinancialLocks } from './resolution/locks.js';
export const financialOperationSchema = z.strictObject({
  actorUid: opaqueId,
  action: z.string(),
  resourceId: z.string(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: z.record(z.string(), z.unknown()),
  createdAt: instant,
  schemaVersion: z.literal(1),
});
export class FinancialCommands {
  readonly locks: FinancialLocks;
  constructor(
    readonly repo: CommercialRepository,
    readonly access: AccessService,
    readonly clock: () => Date,
  ) {
    this.locks = new FinancialLocks(repo);
  }
  async execute<T extends Record<string, unknown>>(
    actor: Actor,
    tenantId: string,
    key: string,
    action: string,
    resourceId: string,
    input: unknown,
    permission: Permission,
    resultSchema: z.ZodType<T>,
    sensitive: boolean,
    prepare: (tx: Transaction, ctx: TenantContext, operationId: string, now: string) => Promise<T>,
  ): Promise<T> {
    z.string().uuid().parse(key);
    const operationId = digest(`finance:${key}`),
      payloadHash = digest(stableJson({ action, resourceId, input }));
    const now = this.clock().toISOString();
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, permission, tx);
      if (sensitive) {
        const seconds = new Date(now).getTime() / 1000;
        requireCondition(
          seconds - actor.authTime <= 300 && actor.authTime <= seconds + 30,
          403,
          'REAUTHENTICATION_REQUIRED',
          'Reautenticação recente necessária',
        );
      }
      const ref = this.repo.ref(tenantId, 'financialOperations', operationId);
      const previous = await this.repo.foundation.read(ref, financialOperationSchema, tx);
      if (previous) {
        requireCondition(
          previous.actorUid === actor.uid &&
            previous.action === action &&
            previous.resourceId === resourceId &&
            previous.payloadHash === payloadHash,
          409,
          'CONFLICT',
          'Chave já utilizada com outra intenção',
        );
        const parsed = resultSchema.safeParse(previous.result);
        requireCondition(parsed.success, 500, 'INTERNAL_ERROR', 'Erro interno do servidor');
        return parsed.data;
      }
      await this.locks.assertCommandAvailable(tx, tenantId, action, resourceId);
      const result = resultSchema.parse(await prepare(tx, ctx, operationId, now));
      const record = financialOperationSchema.parse({
        actorUid: actor.uid,
        action,
        resourceId,
        payloadHash,
        result,
        createdAt: now,
        schemaVersion: 1,
      });
      assertDocumentFits(ref.path, record);
      tx.create(ref, record);
      return result;
    });
  }
}
