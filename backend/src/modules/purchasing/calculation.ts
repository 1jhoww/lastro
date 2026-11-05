import type { z } from 'zod';
import type { PurchaseLine, purchaseLineInput } from '../../shared/schemas/management.js';
import { MAX_ORDER_CENTS } from '../../shared/schemas/orders.js';
import type { schedule } from '../../shared/schemas/paymentSettings.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { formatQuantity, parseQuantity, type StockUnit } from '../inventory/quantities.js';
import { calendarFor, weightedAmounts } from '../finance/paymentCalculation.js';
import { distribute } from '../costing/calculation.js';

const roundedThousandth = (value: bigint) => Number((value + 500n) / 1000n);

/** Line value: unit cost times the scaled quantity, rounded to the cent like sale lines. */
export function lineAmounts(
  input: Pick<z.infer<typeof purchaseLineInput>, 'quantity' | 'unitCostCents' | 'discountCents'>,
  unit: StockUnit,
) {
  const scaled = parseQuantity(input.quantity, unit);
  requireCondition(scaled > 0, 422, 'INVALID_QUANTITY', 'Quantidade deve ser positiva');
  const subtotalCents = roundedThousandth(BigInt(input.unitCostCents) * BigInt(scaled));
  const discountCents = input.discountCents ?? 0;
  requireCondition(
    subtotalCents <= MAX_ORDER_CENTS,
    422,
    'ORDER_VALUE_LIMIT',
    'Valor acima do limite',
  );
  requireCondition(
    discountCents <= subtotalCents,
    422,
    'INVALID_DISCOUNT',
    'Desconto do item superior ao subtotal',
  );
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}

export interface Extras {
  freightCents: number;
  otherCostsCents: number;
  discountCents: number;
}
/** Purchase total: items net of their discounts, plus acquisition costs, minus the discount. */
export function purchaseTotals(
  lines: readonly { subtotalCents: number; discountCents: number }[],
  extras: Extras,
) {
  const subtotalCents = lines.reduce((a, l) => a + l.subtotalCents, 0);
  const lineDiscountCents = lines.reduce((a, l) => a + l.discountCents, 0);
  const totalCents =
    subtotalCents -
    lineDiscountCents +
    extras.freightCents +
    extras.otherCostsCents -
    extras.discountCents;
  requireCondition(
    totalCents >= 0,
    422,
    'INVALID_DISCOUNT',
    'Desconto superior ao valor da compra',
  );
  requireCondition(
    subtotalCents <= MAX_ORDER_CENTS && totalCents <= MAX_ORDER_CENTS,
    422,
    'ORDER_VALUE_LIMIT',
    'Valor acima do limite',
  );
  return { subtotalCents, lineDiscountCents, totalCents };
}

/**
 * Landed cost: freight and other costs enter the stock value and the order discount leaves it,
 * shared by each line's net value. The landed values add up to exactly the purchase total, which
 * is also what the payable titles add up to, so these costs are never counted again as expenses.
 */
export function allocateLanded(lines: PurchaseLine[], extras: Extras): PurchaseLine[] {
  const net = extras.freightCents + extras.otherCostsCents - extras.discountCents;
  const byValue = lines.some((l) => l.totalCents > 0);
  const weights = lines.map((l) =>
    byValue ? l.totalCents : parseQuantity(l.quantity, l.unit as StockUnit),
  );
  const shares = distribute(Math.abs(net), weights);
  return lines.map((line, i) => {
    const allocatedCents = (net < 0 ? -1 : 1) * shares[i]!;
    return { ...line, allocatedCents, landedCents: line.totalCents + allocatedCents };
  });
}

/**
 * Value of one receipt. The value of everything received so far is rounded once, and this receipt
 * takes the difference from what is already in stock: partial receipts of a line always add up to
 * exactly its landed value, in any order and after reversals.
 */
export function receiptValue(
  line: Pick<PurchaseLine, 'landedCents' | 'receivedValueCents'>,
  orderedScaled: number,
  receivedAfterScaled: number,
) {
  const value =
    (BigInt(line.landedCents) * BigInt(receivedAfterScaled) * 2n + BigInt(orderedScaled)) /
    (BigInt(orderedScaled) * 2n);
  return Number(value) - line.receivedValueCents;
}

export function pending(line: Pick<PurchaseLine, 'quantity' | 'receivedQuantity' | 'unit'>) {
  const unit = line.unit as StockUnit;
  return parseQuantity(line.quantity, unit) - parseQuantity(line.receivedQuantity, unit);
}
export const withReceived = (line: PurchaseLine, receivedScaled: number, value: number) => ({
  ...line,
  receivedQuantity: formatQuantity(receivedScaled),
  pendingQuantity: formatQuantity(parseQuantity(line.quantity, line.unit) - receivedScaled),
  receivedValueCents: value,
});

/** Installments of a payment condition, due from the purchase date. */
export function conditionInstallments(
  totalCents: number,
  baseDate: string,
  terms: z.infer<typeof schedule>,
) {
  const amounts = weightedAmounts(totalCents, terms);
  return calendarFor(baseDate, terms).map((dueDate, i) => ({
    number: i + 1,
    amountCents: amounts[i]!,
    dueDate,
  }));
}

/** Adjusted installments keep the exact total and never fall before the purchase. */
export function requireValidInstallments(
  installments: readonly { amountCents: number; dueDate: string }[],
  totalCents: number,
  purchaseDate: string,
) {
  requireCondition(
    installments.reduce((a, p) => a + p.amountCents, 0) === totalCents,
    422,
    'INSTALLMENTS_TOTAL_MISMATCH',
    'A soma das parcelas deve ser igual ao total da compra',
  );
  requireCondition(
    installments.every(
      (p, i) => p.dueDate >= purchaseDate && (!i || p.dueDate >= installments[i - 1]!.dueDate),
    ),
    422,
    'INVALID_DUE_DATE',
    'Vencimentos devem ser ordenados e não anteriores à compra',
  );
}

/** Status derived only from what is effectively received. */
export function receivingStatus(lines: readonly PurchaseLine[]) {
  const received = lines.some((l) => parseQuantity(l.receivedQuantity, l.unit) > 0);
  const complete = lines.every((l) => pending(l) === 0);
  return complete
    ? ('received' as const)
    : received
      ? ('partially_received' as const)
      : ('confirmed' as const);
}
