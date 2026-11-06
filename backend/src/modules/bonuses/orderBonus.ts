import { randomUUID } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import type { Actor } from '../../shared/types/context.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { requireCondition } from '../../shared/errors/appError.js';
import {
  bonusEventSchema,
  bonusSchema,
  type Bonus,
  type BonusLine,
} from '../../shared/schemas/bonuses.js';
import { orderBonusView, type Order, type OrderLine } from '../../shared/schemas/orders.js';

export const bonusNumber = (id: string) => `BON-${id.toUpperCase()}`;

/**
 * An order has at most one bonus, stored under the id of the order. Orders without a bonus simply
 * have no document, so older orders need no migration and the order document never changes.
 */
export async function readOrderBonus(
  repo: CommercialRepository,
  tx: Transaction,
  tenantId: string,
  orderId: string,
): Promise<Bonus | null> {
  const bonus = await repo.foundation.read(repo.ref(tenantId, 'bonuses', orderId), bonusSchema, tx);
  requireCondition(
    !bonus || (bonus.tenantId === tenantId && bonus.kind === 'order' && bonus.orderId === orderId),
    500,
    'INTERNAL_ERROR',
    'Erro interno do servidor',
  );
  return bonus;
}

export const orderBonusFor = (bonus: Bonus | null) => (bonus ? orderBonusView.parse(bonus) : null);

/** Snapshot of a product line. Returns start at zero and only the return command moves them. */
export const bonusLine = (line: OrderLine): BonusLine => ({
  id: line.id,
  productId: line.productId,
  name: line.name,
  sku: line.sku,
  unit: line.unit,
  quantity: line.quantity,
  returnedSellable: '0',
  returnedDamaged: '0',
});

export const linePrices = (lines: readonly OrderLine[]) =>
  Object.fromEntries(lines.map((l) => [l.id, l.unitPriceCents]));

export function recordBonusEvent(
  repo: CommercialRepository,
  tx: Transaction,
  actor: Actor,
  bonus: Bonus,
  type: 'created' | 'edited' | 'confirmed' | 'dispatched' | 'canceled' | 'returned',
  reason: string | null,
  operationId: string | null,
  lines: { lineId: string; sellable: string; damaged: string }[] = [],
) {
  const event = bonusEventSchema.parse({
    id: randomUUID(),
    tenantId: bonus.tenantId,
    bonusId: bonus.id,
    version: bonus.version,
    type,
    status: bonus.status,
    occurredAt: bonus.updatedAt,
    actorUid: actor.uid,
    reason,
    lines,
    requestId: actor.requestId,
    operationId,
    schemaVersion: 1,
  });
  tx.create(repo.ref(bonus.tenantId, 'bonusEvents', event.id), event);
  recordAudit(
    repo.foundation,
    tx,
    actor,
    bonus.tenantId,
    `bonuses.${type}`,
    bonus.id,
    bonus.updatedAt,
    {
      kind: bonus.kind,
      orderId: bonus.orderId,
      status: bonus.status,
      version: bonus.version,
      lines: lines.length || bonus.lines.length,
      operationId,
      reason,
    },
  );
}

/**
 * Moves the bonus of an order with it, in the transaction that moves the order. Stock is the
 * adapter's job; this only records the new state, after the caller has done all its reads.
 */
export function followOrder(
  repo: CommercialRepository,
  tx: Transaction,
  actor: Actor,
  bonus: Bonus,
  order: { status: Order['status']; updatedAt: string },
  reason: string | null,
  operationId: string | null,
) {
  const status = order.status;
  const next = bonusSchema.parse({
    ...bonus,
    status,
    occurredAt: status === 'confirmed' ? order.updatedAt : bonus.occurredAt,
    dispatchedAt: status === 'dispatched' ? order.updatedAt : bonus.dispatchedAt,
    canceledAt: status === 'canceled' ? order.updatedAt : bonus.canceledAt,
    canceledBy: status === 'canceled' ? actor.uid : bonus.canceledBy,
    version: bonus.version + 1,
    updatedAt: order.updatedAt,
    updatedBy: actor.uid,
  });
  tx.set(repo.ref(bonus.tenantId, 'bonuses', bonus.id), next);
  recordBonusEvent(
    repo,
    tx,
    actor,
    next,
    status === 'confirmed' ? 'confirmed' : status === 'dispatched' ? 'dispatched' : 'canceled',
    reason,
    operationId,
  );
  return next;
}
