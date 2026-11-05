import type { Query, Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import { orderSchema, type Order } from '../../shared/schemas/orders.js';
import { paymentSchema, refundConfirmationSchema } from '../../shared/schemas/finance.js';
import {
  orderCostSnapshotSchema,
  payablePaymentSchema,
  payableSchema,
  purchaseClosureSchema,
  recurringExpenseSchema,
  supplierCreditMovementSchema,
  supplierCreditSchema,
  type OrderCostSnapshot,
  type Payable,
} from '../../shared/schemas/management.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { checkReadBudget } from '../../shared/operations/readBudget.js';
import { addDays, daysBetween } from '../reports/dates.js';
import { dueDatesThrough } from '../payables/recurrence.js';
import { marginBp } from '../costing/calculation.js';

export const MANAGEMENT_CAPS = { orders: 2500, payables: 3000, payments: 3000, purchases: 2000 };

/** Reads every document of a bounded query, refusing rather than truncating a total. */
export async function scanAll<T>(
  repo: CommercialRepository,
  tx: Transaction,
  query: Query,
  schema: z.ZodType<T>,
  cap: number,
  what: string,
): Promise<T[]> {
  const page = await tx.get(query.limit(cap + 1));
  requireCondition(
    page.size <= cap,
    422,
    'REPORT_TOO_LARGE',
    `A consulta passa de ${cap} ${what}. Reduza o período ou aplique filtros.`,
  );
  const values: T[] = [];
  for (let i = 0; i < page.docs.length; i += 25) {
    checkReadBudget();
    values.push(
      ...(await Promise.all(
        page.docs.slice(i, i + 25).map(async (doc) => {
          const value = await repo.foundation.readSnapshot(doc, schema, tx);
          requireCondition(value, 500, 'INTERNAL_ERROR', 'Erro interno do servidor');
          return value;
        }),
      )),
    );
  }
  return values;
}

export type Range = { from: string; to: string };

export interface ManagementEnv {
  repo: CommercialRepository;
  tx: Transaction;
  tenantId: string;
  timezone: string;
  today: string;
}

/** Orders recognized as sales in the period: confirmed or dispatched, by confirmation date. */
export async function soldOrders(
  env: ManagementEnv,
  range: Range,
  zonedStart: (date: string, timezone: string) => string,
) {
  const orders = await scanAll(
    env.repo,
    env.tx,
    env.repo
      .ref(env.tenantId, 'orders', 'placeholder')
      .parent.where('confirmedAt', '>=', zonedStart(range.from, env.timezone))
      .where('confirmedAt', '<', zonedStart(addDays(range.to, 1), env.timezone))
      .orderBy('confirmedAt'),
    orderSchema,
    MANAGEMENT_CAPS.orders,
    'pedidos',
  );
  return orders.filter(
    (o) => o.tenantId === env.tenantId && (o.status === 'confirmed' || o.status === 'dispatched'),
  );
}

export async function costSnapshots(env: ManagementEnv, orders: readonly Order[]) {
  const refs = orders.map((o) => env.repo.ref(env.tenantId, 'orderCostSnapshots', o.id));
  const found = new Map<string, OrderCostSnapshot>();
  for (let i = 0; i < refs.length; i += 100) {
    checkReadBudget();
    const page = await env.repo.foundation.readMany(
      refs.slice(i, i + 100),
      orderCostSnapshotSchema,
      env.tx,
    );
    for (const snapshot of page) if (snapshot) found.set(snapshot.orderId, snapshot);
  }
  return found;
}

/** One sold line with the cost frozen at the sale; `costCents` is null when it is unknown. */
export function soldLines(orders: readonly Order[], snapshots: Map<string, OrderCostSnapshot>) {
  return orders.flatMap((order) => {
    const snapshot = snapshots.get(order.id);
    const costs = new Map(snapshot?.lines.map((l) => [l.lineId, l]));
    return order.lines.map((line) => ({
      orderId: order.id,
      line,
      costCents: costs.get(line.id)?.costCents ?? null,
    }));
  });
}

/** Accrual view of operating expenses. Purchases are excluded: they reach results as COGS. */
export async function operatingExpenses(env: ManagementEnv, range: Range) {
  const titles = await scanAll(
    env.repo,
    env.tx,
    env.repo
      .ref(env.tenantId, 'payables', 'placeholder')
      .parent.where('competenceDate', '>=', range.from)
      .where('competenceDate', '<=', range.to)
      .orderBy('competenceDate'),
    payableSchema,
    MANAGEMENT_CAPS.payables,
    'títulos',
  );
  return titles.filter(
    (t) => t.status !== 'canceled' && (t.origin === 'expense' || t.origin === 'recurring'),
  );
}

export const expenseValue = (t: Pick<Payable, 'originalCents' | 'canceledCents'>) =>
  t.originalCents - t.canceledCents;

export async function profitability(
  env: ManagementEnv,
  range: Range,
  zonedStart: (date: string, timezone: string) => string,
) {
  const orders = await soldOrders(env, range, zonedStart);
  const snapshots = await costSnapshots(env, orders);
  const lines = soldLines(orders, snapshots);
  const revenueCents = orders.reduce((a, o) => a + o.totalCents, 0);
  const costed = lines.filter((l) => l.costCents !== null);
  const costedRevenueCents = costed.reduce((a, l) => a + l.line.totalCents, 0);
  const cogsCents = costed.reduce((a, l) => a + l.costCents!, 0);
  const grossProfitCents = costedRevenueCents - cogsCents;
  const operatingExpensesCents = (await operatingExpenses(env, range)).reduce(
    (a, t) => a + expenseValue(t),
    0,
  );
  const missing = new Set(lines.filter((l) => l.costCents === null).map((l) => l.orderId));
  return {
    revenueCents,
    costedRevenueCents,
    cogsCents,
    grossProfitCents,
    grossMarginBp: costedRevenueCents > 0 ? marginBp(grossProfitCents, costedRevenueCents) : null,
    operatingExpensesCents,
    estimatedResultCents: grossProfitCents - operatingExpensesCents,
    ordersWithoutCost: missing.size,
  };
}

/** Money that effectively moved, by date: receipts, refunds, payments and supplier devolutions. */
export async function realizedMoney(env: ManagementEnv, range: Range) {
  const [payments, refunds, paid, recovered] = await Promise.all([
    scanAll(
      env.repo,
      env.tx,
      env.repo
        .ref(env.tenantId, 'payments', 'placeholder')
        .parent.where('receivedOn', '>=', range.from)
        .where('receivedOn', '<=', range.to)
        .orderBy('receivedOn'),
      paymentSchema,
      MANAGEMENT_CAPS.payments,
      'recebimentos',
    ),
    scanAll(
      env.repo,
      env.tx,
      env.repo
        .ref(env.tenantId, 'refundConfirmations', 'placeholder')
        .parent.where('refundedOn', '>=', range.from)
        .where('refundedOn', '<=', range.to)
        .orderBy('refundedOn'),
      refundConfirmationSchema,
      MANAGEMENT_CAPS.payments,
      'reembolsos',
    ),
    scanAll(
      env.repo,
      env.tx,
      env.repo
        .ref(env.tenantId, 'payablePayments', 'placeholder')
        .parent.where('paidOn', '>=', range.from)
        .where('paidOn', '<=', range.to)
        .orderBy('paidOn'),
      payablePaymentSchema,
      MANAGEMENT_CAPS.payments,
      'pagamentos',
    ),
    scanAll(
      env.repo,
      env.tx,
      env.repo
        .ref(env.tenantId, 'supplierCreditMovements', 'placeholder')
        .parent.where('date', '>=', range.from)
        .where('date', '<=', range.to)
        .orderBy('date'),
      supplierCreditMovementSchema,
      MANAGEMENT_CAPS.payments,
      'movimentações de crédito',
    ),
  ]);
  const inflows = [
    ...payments.map((p) => ({ date: p.receivedOn, cents: p.amountCents - p.reversedCents })),
    ...recovered
      .filter((m) => m.type === 'recovered' && m.status === 'active')
      .map((m) => ({ date: m.date, cents: m.amountCents })),
  ];
  const outflows = [
    ...refunds.map((r) => ({ date: r.refundedOn, cents: r.amountCents })),
    ...paid
      .filter((p) => p.status === 'active')
      .map((p) => ({ date: p.paidOn, cents: p.cashCents })),
  ];
  return { inflows, outflows };
}

const sum = (rows: readonly { cents: number }[]) => rows.reduce((a, r) => a + r.cents, 0);
const brDay = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const brMonth = (date: string) => `${date.slice(5, 7)}/${date.slice(0, 4)}`;

export type FlowPoint = {
  key: string;
  label: string;
  inflowCents: number;
  outflowCents: number;
  balanceCents: number;
};
/** Realized flow by day, or by month in periods longer than 31 days. */
export function flowByPeriod(
  range: Range,
  money: {
    inflows: { date: string; cents: number }[];
    outflows: { date: string; cents: number }[];
  },
): FlowPoint[] {
  const monthly = daysBetween(range.from, range.to) > 31;
  const keyOf = (date: string) => (monthly ? date.slice(0, 7) : date);
  const points = new Map<string, FlowPoint>();
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    const key = keyOf(date);
    if (!points.has(key))
      points.set(key, {
        key,
        label: monthly ? brMonth(date) : brDay(date),
        inflowCents: 0,
        outflowCents: 0,
        balanceCents: 0,
      });
  }
  for (const row of money.inflows) {
    const point = points.get(keyOf(row.date));
    if (point) point.inflowCents += row.cents;
  }
  for (const row of money.outflows) {
    const point = points.get(keyOf(row.date));
    if (point) point.outflowCents += row.cents;
  }
  let balance = 0;
  return [...points.values()].map((point) => {
    balance += point.inflowCents - point.outflowCents;
    return { ...point, balanceCents: balance };
  });
}

/** Weekly projection from open titles and recurring expenses not issued yet. */
export function projectedFlow(
  today: string,
  horizonDays: number,
  openingCents: number,
  inflows: readonly { date: string; cents: number }[],
  outflows: readonly { date: string; cents: number }[],
): FlowPoint[] {
  const points: FlowPoint[] = [];
  let balance = openingCents;
  for (let start = 0; start < horizonDays; start += 7) {
    const from = addDays(today, start);
    const to = addDays(today, Math.min(start + 6, horizonDays - 1));
    const within = (r: { date: string }) => r.date >= from && r.date <= to;
    const inflowCents = sum(inflows.filter(within));
    const outflowCents = sum(outflows.filter(within));
    balance += inflowCents - outflowCents;
    points.push({
      key: from,
      label: `${brDay(from)} a ${brDay(to)}`,
      inflowCents,
      outflowCents,
      balanceCents: balance,
    });
  }
  return points;
}

/** Occurrences inside the horizon that are not titles yet. */
export async function recurringForecast(env: ManagementEnv, through: string) {
  const recurrences = await scanAll(
    env.repo,
    env.tx,
    env.repo
      .ref(env.tenantId, 'recurringExpenses', 'placeholder')
      .parent.where('status', '==', 'active'),
    recurringExpenseSchema,
    500,
    'recorrências',
  );
  return recurrences.flatMap((recurrence) =>
    dueDatesThrough(recurrence, through)
      .filter((date) => date >= env.today)
      .map((date) => ({ date, cents: recurrence.amountCents })),
  );
}
export async function openSupplierCredits(env: ManagementEnv) {
  return scanAll(
    env.repo,
    env.tx,
    env.repo
      .ref(env.tenantId, 'supplierCredits', 'placeholder')
      .parent.where('hasBalance', '==', true),
    supplierCreditSchema,
    MANAGEMENT_CAPS.payables,
    'créditos de fornecedor',
  );
}
/** Purchases closed in the period with the supplier charging for goods that never arrived. */
export async function chargedUndelivered(env: ManagementEnv, range: Range) {
  const closures = await scanAll(
    env.repo,
    env.tx,
    env.repo
      .ref(env.tenantId, 'purchaseClosures', 'placeholder')
      .parent.where('closedOn', '>=', range.from)
      .where('closedOn', '<=', range.to)
      .orderBy('closedOn'),
    purchaseClosureSchema,
    MANAGEMENT_CAPS.purchases,
    'encerramentos',
  );
  return closures
    .filter((c) => c.treatment === 'full_charge')
    .reduce((a, c) => a + c.undeliveredValueCents, 0);
}
export async function openPayables(env: ManagementEnv) {
  return scanAll(
    env.repo,
    env.tx,
    env.repo
      .ref(env.tenantId, 'payables', 'placeholder')
      .parent.where('hasBalance', '==', true)
      .orderBy('dueDate'),
    payableSchema,
    MANAGEMENT_CAPS.payables,
    'títulos em aberto',
  );
}
