import type { Product } from '../../shared/schemas/commercial.js';
import type { OrderLine, Discount } from '../../shared/schemas/orders.js';
import { MAX_ORDER_CENTS } from '../../shared/schemas/orders.js';
import { parseQuantity, formatQuantity } from '../inventory/quantities.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
export function snapshotLine(id: string, product: Product, quantity: string): OrderLine {
  const scaled = parseQuantity(quantity, product.unit);
  requireCondition(scaled > 0, 422, 'INVALID_QUANTITY', 'Quantidade deve ser positiva');
  const subtotal = (BigInt(product.priceCents) * BigInt(scaled) + 500n) / 1000n;
  requireCondition(
    subtotal <= BigInt(MAX_ORDER_CENTS),
    422,
    'ORDER_VALUE_LIMIT',
    'Valor acima do limite',
  );
  return {
    id,
    productId: product.id,
    name: product.name,
    sku: product.sku,
    description: product.description,
    unit: product.unit,
    quantity: formatQuantity(scaled),
    unitPriceCents: product.priceCents,
    subtotalCents: Number(subtotal),
    discountCents: 0,
    totalCents: Number(subtotal),
  };
}
export function priceOrder(lines: OrderLine[], discount: Discount | null) {
  const subtotalCents = lines.reduce((a, l) => a + l.subtotalCents, 0);
  requireCondition(
    subtotalCents <= MAX_ORDER_CENTS,
    422,
    'ORDER_VALUE_LIMIT',
    'Valor acima do limite',
  );
  const discountCents = !discount
    ? 0
    : discount.type === 'fixed'
      ? discount.value
      : Number((BigInt(subtotalCents) * BigInt(discount.value) + 5000n) / 10000n);
  requireCondition(
    discountCents <= subtotalCents,
    422,
    'INVALID_DISCOUNT',
    'Desconto superior ao subtotal',
  );
  const allocated = lines.map((l, index) => {
    const numerator = BigInt(discountCents) * BigInt(l.subtotalCents);
    return {
      index,
      amount: subtotalCents ? Number(numerator / BigInt(subtotalCents)) : 0,
      remainder: subtotalCents ? numerator % BigInt(subtotalCents) : 0n,
    };
  });
  let left = discountCents - allocated.reduce((a, l) => a + l.amount, 0);
  const ranking = [...allocated].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const a of ranking) {
    if (left-- <= 0) break;
    a.amount++;
  }
  return {
    lines: lines.map((l, i) => ({
      ...l,
      discountCents: allocated[i]!.amount,
      totalCents: l.subtotalCents - allocated[i]!.amount,
    })),
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}
export function installmentsFor(orderId: string, total: number, dates: string[]) {
  const base = Math.floor(total / dates.length),
    remainder = total % dates.length;
  return dates.map((dueDate, i) => ({
    id: digest(`receivable:${orderId}:${i + 1}`),
    orderId,
    number: i + 1,
    amountCents: base + (i < remainder ? 1 : 0),
    dueDate,
  }));
}
export function companyDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const field = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}
export function validateDates(dates: string[], now: Date, timezone: string) {
  const today = companyDate(now, timezone);
  requireCondition(
    dates.every((d, i) => d >= today && (!i || d >= dates[i - 1]!)),
    422,
    'INVALID_DUE_DATE',
    'Vencimentos devem ser atuais/futuros e ordenados',
  );
}
export function approvalFingerprint(
  customerId: string,
  sellerUid: string,
  lines: OrderLine[],
  payment: unknown,
) {
  return digest(
    stableJson({
      customerId,
      sellerUid,
      lines: lines.map((l) => ({ ...l, discountCents: 0, totalCents: l.subtotalCents })),
      payment,
    }),
  );
}
