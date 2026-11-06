import type { Bonus, BonusCostSnapshot, BonusLine } from '../../shared/schemas/bonuses.js';
import { formatQuantity, parseQuantity } from '../inventory/quantities.js';
import { requireCondition } from '../../shared/errors/appError.js';

/** Quantity that stayed with the customer or was lost: sellable returns are the only way back. */
export const netScaled = (line: BonusLine) =>
  parseQuantity(line.quantity, line.unit) - parseQuantity(line.returnedSellable, line.unit);

export const netUnits = (bonus: Pick<Bonus, 'lines'>) =>
  bonus.lines.reduce((a, line) => a + netScaled(line), 0);

export const returnedUnits = (bonus: Pick<Bonus, 'lines'>) =>
  bonus.lines.reduce(
    (a, l) =>
      a + parseQuantity(l.returnedSellable, l.unit) + parseQuantity(l.returnedDamaged, l.unit),
    0,
  );

/** Applies one return to a line, refusing anything beyond what left the stock. */
export function returnedLine(line: BonusLine, sellable: number, damaged: number): BonusLine {
  const quantity = parseQuantity(line.quantity, line.unit),
    nextSellable = parseQuantity(line.returnedSellable, line.unit) + sellable,
    nextDamaged = parseQuantity(line.returnedDamaged, line.unit) + damaged;
  requireCondition(
    nextSellable + nextDamaged <= quantity,
    409,
    'RETURN_LIMIT',
    'Retorno excede a quantidade bonificada',
  );
  return {
    ...line,
    returnedSellable: formatQuantity(nextSellable),
    returnedDamaged: formatQuantity(nextDamaged),
  };
}

/**
 * Cost of what the company really gave away. A sellable return takes the units back at the frozen
 * cost of the bonus; a damaged one keeps its cost, because the goods are gone either way.
 */
export function netCost(bonus: Pick<Bonus, 'lines'>, snapshot: BonusCostSnapshot) {
  const lines = new Map(bonus.lines.map((l) => [l.id, l]));
  const rows = snapshot.lines.map((row) => {
    const line = lines.get(row.lineId);
    if (row.costCents === null || !line) return { lineId: row.lineId, costCents: null };
    const kept = netScaled(line);
    const cents =
      (BigInt(row.costCents) * BigInt(kept) * 2n + BigInt(row.quantityScaled)) /
      (BigInt(row.quantityScaled) * 2n);
    return { lineId: row.lineId, costCents: Number(cents) };
  });
  return {
    grossCents: snapshot.costCents,
    netCents: rows.reduce((a, r) => a + (r.costCents ?? 0), 0),
    missingLines: snapshot.missingLines,
    lines: rows,
  };
}
