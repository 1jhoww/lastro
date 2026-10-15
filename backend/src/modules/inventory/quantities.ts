import { requireCondition } from '../../shared/errors/appError.js';
export type StockUnit = 'UN' | 'CX' | 'PCT' | 'KG' | 'L';
export const SCALE = 1000;
export const MAX_SCALED = 1_000_000_000_000;
export function parseQuantity(value: string, unit: StockUnit, signed = false): number {
  requireCondition(
    typeof value === 'string' &&
      value.length <= 18 &&
      (signed ? /^-?(?:0|[1-9]\d*)(?:\.\d{1,3})?$/ : /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/).test(value),
    422,
    'INVALID_QUANTITY',
    'Quantidade inválida',
  );
  const negative = value.startsWith('-');
  const [whole = '', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  requireCondition(
    unit === 'KG' || unit === 'L' || fraction.length === 0,
    422,
    'INVALID_PRECISION',
    'Precisão incompatível com a unidade',
  );
  const scaled = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  requireCondition(
    scaled <= BigInt(MAX_SCALED),
    422,
    'QUANTITY_LIMIT_EXCEEDED',
    'Quantidade acima do limite',
  );
  return Number(scaled) * (negative ? -1 : 1);
}
export function formatQuantity(scaled: number): string {
  const sign = scaled < 0 ? '-' : '';
  const amount = Math.abs(scaled);
  const fraction = String(amount % SCALE)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${sign}${Math.floor(amount / SCALE)}${fraction ? `.${fraction}` : ''}`;
}
export const movementTypes = [
  'STOCK_ENTRY',
  'STOCK_ADJUSTMENT_IN',
  'STOCK_ADJUSTMENT_OUT',
  'STOCK_RESERVATION',
  'STOCK_RESERVATION_RELEASE',
  'STOCK_DISPATCH',
  'STOCK_RETURN',
] as const;
export type MovementType = (typeof movementTypes)[number];
export function transition(
  physical: number,
  reserved: number,
  type: MovementType,
  quantity: number,
) {
  requireCondition(
    [physical, reserved, quantity].every(Number.isSafeInteger) &&
      physical >= 0 &&
      reserved >= 0 &&
      reserved <= physical &&
      physical <= MAX_SCALED &&
      quantity > 0 &&
      quantity <= MAX_SCALED,
    422,
    'INVALID_QUANTITY',
    'Saldos ou quantidade inválidos',
  );
  let nextPhysical = physical,
    nextReserved = reserved;
  switch (type) {
    case 'STOCK_ENTRY':
    case 'STOCK_ADJUSTMENT_IN':
    case 'STOCK_RETURN':
      nextPhysical += quantity;
      break;
    case 'STOCK_ADJUSTMENT_OUT':
      nextPhysical -= quantity;
      break;
    case 'STOCK_RESERVATION':
      nextReserved += quantity;
      break;
    case 'STOCK_RESERVATION_RELEASE':
      nextReserved -= quantity;
      break;
    case 'STOCK_DISPATCH':
      nextPhysical -= quantity;
      nextReserved -= quantity;
      break;
  }
  requireCondition(
    nextPhysical >= 0 && nextReserved >= 0 && nextPhysical >= nextReserved,
    409,
    'INSUFFICIENT_STOCK',
    'Operação incompatível com o estoque disponível',
  );
  requireCondition(
    nextPhysical <= MAX_SCALED,
    422,
    'QUANTITY_LIMIT_EXCEEDED',
    'Quantidade acima do limite',
  );
  return { physicalScaled: nextPhysical, reservedScaled: nextReserved };
}
