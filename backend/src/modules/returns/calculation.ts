import type { Return } from '../../shared/schemas/returns.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { MAX_ORDER_CENTS } from '../../shared/schemas/orders.js';
import { MAX_SCALED } from '../inventory/quantities.js';
export function cumulativeReturnedCents(total: number, accepted: number, expedited: number) {
  requireCondition(
    [total, accepted, expedited].every(Number.isSafeInteger) &&
      total >= 0 &&
      total <= MAX_ORDER_CENTS &&
      expedited > 0 &&
      expedited <= MAX_SCALED &&
      accepted >= 0 &&
      accepted <= expedited,
    409,
    'RETURN_LIMIT',
    'Quantidade ou valor de devolução incompatível',
  );
  return Number(
    (BigInt(total) * BigInt(accepted) + BigInt(Math.floor(expedited / 2))) / BigInt(expedited),
  );
}
export function returnState(lines: Return['lines']): Return['status'] {
  const pending = lines.some((l) => l.requestedScaled > l.receivedScaled),
    received = lines.some((l) => l.receivedScaled > 0),
    unresolved = lines.some(
      (l) =>
        l.sellableScaled > l.resolvedSellableScaled ||
        l.damagedScaled > l.acceptedDamagedScaled + l.rejectedDamagedScaled,
    );
  return pending
    ? received
      ? 'partially_received'
      : 'pending'
    : unresolved
      ? 'received'
      : 'closed';
}

export function returnedValueLimits(
  total: number,
  expedited: number,
  previouslyAccepted: number,
  sellable: number,
  damaged: number,
) {
  const before = cumulativeReturnedCents(total, previouslyAccepted, expedited),
    afterSellable = cumulativeReturnedCents(total, previouslyAccepted + sellable, expedited),
    afterDamaged = cumulativeReturnedCents(
      total,
      previouslyAccepted + sellable + damaged,
      expedited,
    );
  return { sellableCents: afterSellable - before, damagedLimitCents: afterDamaged - afterSellable };
}
