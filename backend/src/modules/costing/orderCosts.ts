import type { Transaction } from 'firebase-admin/firestore';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import type { OrderLine } from '../../shared/schemas/orders.js';
import { orderCostSnapshotSchema, productCostSchema } from '../../shared/schemas/management.js';
import { parseQuantity } from '../inventory/quantities.js';
import { centsToMilli, costOf } from './calculation.js';

/**
 * Cost of each line at the moment of the sale: the moving average or, before any receipt, the
 * reference cost. Lines without either stay as `missing`, so reports can tell "unknown" from zero.
 * Only reads; the caller writes the snapshot with the confirmation.
 */
export async function orderCostSnapshot(
  repo: CommercialRepository,
  tx: Transaction,
  tenantId: string,
  orderId: string,
  lines: readonly OrderLine[],
  now: string,
) {
  const refs = lines.map((line) => repo.ref(tenantId, 'productCosts', line.productId));
  const costs = await repo.foundation.readMany(refs, productCostSchema, tx);
  const rows = lines.map((line, index) => {
    const cost = costs[index];
    const quantityScaled = parseQuantity(line.quantity, line.unit);
    const unitCostMilli =
      cost?.averageCostMilli ??
      (cost && cost.referenceCostCents !== null ? centsToMilli(cost.referenceCostCents) : null);
    const source =
      cost?.averageCostMilli != null
        ? ('average' as const)
        : unitCostMilli !== null
          ? ('reference' as const)
          : ('missing' as const);
    return {
      lineId: line.id,
      productId: line.productId,
      quantityScaled,
      unitCostMilli,
      source,
      costCents: unitCostMilli === null ? null : costOf(unitCostMilli, quantityScaled),
    };
  });
  return orderCostSnapshotSchema.parse({
    id: orderId,
    tenantId,
    orderId,
    lines: rows,
    costCents: rows.reduce((a, r) => a + (r.costCents ?? 0), 0),
    missingLines: rows.filter((r) => r.source === 'missing').length,
    capturedAt: now,
    schemaVersion: 1,
  });
}
