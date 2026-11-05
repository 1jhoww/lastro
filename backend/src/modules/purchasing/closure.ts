import type { Payable, Purchase, PurchaseLine } from '../../shared/schemas/management.js';
import { formatQuantity } from '../inventory/quantities.js';
import { pending } from './calculation.js';

type Treatment = 'abatement' | 'full_charge' | 'supplier_credit';

/** Lines after closing: nothing stays pending, and what will not arrive is on record. */
export const closedLines = (lines: readonly PurchaseLine[]): PurchaseLine[] =>
  lines.map((line) => ({
    ...line,
    pendingQuantity: '0',
    undeliveredQuantity: formatQuantity(pending(line)),
  }));

/**
 * Financial effect of closing the pending balance. The undelivered value is what each line would
 * still bring into stock, so stock and undelivered goods add up to exactly the purchase total.
 *
 * - `abatement` takes that value off the open titles, latest due date first. What the titles cannot
 *   absorb was already paid and is left as an excess for the supplier to settle.
 * - `full_charge` keeps every title: the supplier charges for goods that did not arrive.
 * - `supplier_credit` keeps every title and records the value as a credit with the supplier.
 */
export function closureImpact(
  purchase: Pick<Purchase, 'lines'>,
  titles: readonly Payable[],
  treatment: Treatment,
) {
  const items = purchase.lines
    .filter((line) => pending(line) > 0)
    .map((line) => ({
      lineId: line.id,
      productId: line.productId,
      name: line.name,
      sku: line.sku,
      unit: line.unit,
      orderedQuantity: line.quantity,
      receivedQuantity: line.receivedQuantity,
      undeliveredQuantity: formatQuantity(pending(line)),
      undeliveredValueCents: line.landedCents - line.receivedValueCents,
    }));
  const undeliveredValueCents = items.reduce((a, i) => a + i.undeliveredValueCents, 0);
  const open = titles
    .filter((title) => title.hasBalance)
    .sort(
      (a, b) =>
        b.dueDate.localeCompare(a.dueDate) ||
        (b.installmentNumber ?? 0) - (a.installmentNumber ?? 0),
    );
  const openBalanceCents = open.reduce((a, t) => a + t.outstandingCents, 0);
  const paidCents = titles.reduce((a, t) => a + t.paidCents, 0);
  let remaining = treatment === 'abatement' ? undeliveredValueCents : 0;
  const rows = [];
  for (const title of open) {
    if (remaining === 0) break;
    const abatedCents = Math.min(remaining, title.outstandingCents);
    remaining -= abatedCents;
    rows.push({
      payableId: title.id,
      installmentNumber: title.installmentNumber,
      dueDate: title.dueDate,
      outstandingBeforeCents: title.outstandingCents,
      abatedCents,
      outstandingAfterCents: title.outstandingCents - abatedCents,
    });
  }
  const abatedCents = rows.reduce((a, r) => a + r.abatedCents, 0);
  const excessCents = treatment === 'abatement' ? undeliveredValueCents - abatedCents : 0;
  return {
    treatment,
    undeliveredValueCents,
    openBalanceCents,
    paidCents,
    abatedCents,
    excessCents,
    creditCents: treatment === 'supplier_credit' ? undeliveredValueCents : excessCents,
    items,
    titles: rows,
  };
}
