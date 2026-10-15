import { z } from 'zod';
import type { Transaction } from 'firebase-admin/firestore';
import type {
  CommercialRepository,
  CommercialCollection,
} from '../../../infrastructure/repositories/commercialRepository.js';
import {
  executionLockSchema,
  executionStatusSchema,
} from '../../../shared/schemas/financialExecutions.js';
import { opaqueId, instant } from '../../../shared/schemas/models.js';
import { eventSchema } from '../../../shared/schemas/finance.js';
import { requireCondition } from '../../../shared/errors/appError.js';

const lockOwnerSchema = z.object({
  id: opaqueId,
  tenantId: opaqueId,
  orderId: opaqueId,
  status: executionStatusSchema,
  fencingToken: z.number().int().positive().safe(),
  applicationStartedAt: instant.nullable(),
  publication: z.object({ eventId: opaqueId }).nullable(),
  progress: z.object({
    applied: z.number().int().nonnegative().safe(),
    releasedReservations: z.number().int().nonnegative().safe(),
  }),
});
const resourceOwnerSchema = z.object({ id: opaqueId, tenantId: opaqueId, orderId: opaqueId });
export class FinancialLocks {
  constructor(private readonly repo: CommercialRepository) {}

  private async active(
    tx: Transaction,
    tenantId: string,
    collection: 'financialExecutionOrderLocks' | 'financialExecutionLotLocks',
    id: string,
  ) {
    const lock = await this.repo.foundation.read(
      this.repo.ref(tenantId, collection, id),
      executionLockSchema,
      tx,
    );
    if (!lock) return false;
    const owner = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'financialExecutions', lock.executionId),
      lockOwnerSchema,
      tx,
    );
    requireCondition(
      lock.tenantId === tenantId &&
        lock.resourceId === id &&
        owner?.tenantId === tenantId &&
        owner.id === lock.executionId &&
        owner.fencingToken >= lock.fencingToken &&
        (collection !== 'financialExecutionOrderLocks' || owner.orderId === id),
      409,
      'FINANCIAL_INTEGRITY',
      'Proprietário do bloqueio financeiro inconsistente',
    );
    if (owner.status === 'ABORTED') {
      requireCondition(
        owner.applicationStartedAt === null &&
          owner.progress.applied === 0 &&
          owner.progress.releasedReservations === 0 &&
          owner.publication === null,
        409,
        'FINANCIAL_INTEGRITY',
        'Abort financeiro não comprovado',
      );
      return false;
    }
    if (owner.status === 'COMPLETED') {
      requireCondition(
        owner.publication !== null,
        409,
        'FINANCIAL_INTEGRITY',
        'Publicação financeira ausente',
      );
      const event = await this.repo.foundation.read(
        this.repo.ref(tenantId, 'financialEvents', owner.publication.eventId),
        eventSchema,
        tx,
      );
      requireCondition(
        event?.schemaVersion === 2 &&
          event.tenantId === tenantId &&
          event.orderId === owner.orderId &&
          event.proof.executionId === owner.id,
        409,
        'FINANCIAL_INTEGRITY',
        'Publicação financeira inconsistente',
      );
      return false;
    }
    // A lease expires only execution ownership, never an economic lock.
    return true;
  }
  async assertOrderAvailable(tx: Transaction, tenantId: string, orderId: string, generic = false) {
    requireCondition(
      !(await this.active(tx, tenantId, 'financialExecutionOrderLocks', orderId)),
      409,
      generic ? 'ORDER_OPERATION_IN_PROGRESS' : 'FINANCIAL_OPERATION_IN_PROGRESS',
      generic
        ? 'Ação temporariamente indisponível para este pedido'
        : 'Pedido possui execução financeira em andamento',
    );
  }
  async assertLotAvailable(tx: Transaction, tenantId: string, lotId: string) {
    requireCondition(
      !(await this.active(tx, tenantId, 'financialExecutionLotLocks', lotId)),
      409,
      'FINANCIAL_LOT_LOCKED',
      'Crédito participa de execução financeira em andamento',
    );
  }
  async assertCommandAvailable(
    tx: Transaction,
    tenantId: string,
    action: string,
    resourceId: string,
  ) {
    if (
      ['receipt', 'credit_application', 'financial_cancellation', 'return_intent'].includes(action)
    )
      return this.assertOrderAvailable(tx, tenantId, resourceId);
    const collection: CommercialCollection | undefined =
      action === 'payment_reversal'
        ? 'payments'
        : action === 'credit_reversal'
          ? 'creditApplications'
          : action === 'refund'
            ? 'refundObligations'
            : ['return_edited', 'return_canceled', 'return_received', 'return_resolved'].includes(
                  action,
                )
              ? 'returns'
              : undefined;
    if (!collection) return;
    const snapshot = await tx.get(this.repo.ref(tenantId, collection, resourceId));
    if (!snapshot.exists) return;
    const resource = resourceOwnerSchema.safeParse(snapshot.data());
    requireCondition(
      resource.success && resource.data.tenantId === tenantId && resource.data.id === resourceId,
      409,
      'FINANCIAL_INTEGRITY',
      'Origem financeira inconsistente',
    );
    await this.assertOrderAvailable(tx, tenantId, resource.data.orderId);
  }
}
