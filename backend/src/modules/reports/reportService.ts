import { FieldPath, type Query, type Transaction } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import type { z } from 'zod';
import type { Actor, TenantContext } from '../../shared/types/context.js';
import type { OrderService } from '../orders/orderService.js';
import type { FinancialReads } from '../finance/financialReads.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import { orderSchema, type Order } from '../../shared/schemas/orders.js';
import { paymentSchema } from '../../shared/schemas/finance.js';
import { customerSchema, productSchema } from '../../shared/schemas/commercial.js';
import { movementSchema, stockSchema, type Movement } from '../../shared/schemas/inventory.js';
import {
  reportQuery,
  reportView,
  type ReportId,
  type ReportQuery,
  type ReportValueKind,
  type ReportView,
} from '../../shared/schemas/reports.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { checkReadBudget, exportPolicy, ReadGate } from '../../shared/operations/readBudget.js';
import type { Download } from '../documents/download.js';
import { reportCsv, reportFilename, reportPdf } from './reportFiles.js';
import { hasFeature } from '../plans/catalog.js';
import { featureNotInPlan, requirePermission } from '../users/permissions.js';
import { formatQuantity, parseQuantity } from '../inventory/quantities.js';
import { brl, orderNumber } from '../documents/pdfLayout.js';

export const REPORT_CAPS = {
  orders: 2500,
  titles: 1500,
  payments: 2500,
  movements: 3000,
  products: 3000,
} as const;
const MAX_SPAN_DAYS = 366;
const DAY = 86_400_000;

type Category = ReportView['category'];
type Filter = keyof ReportQuery;
interface Definition {
  category: Category;
  title: string;
  description: string;
  filters: Filter[];
  statuses?: NonNullable<ReportQuery['status']>[];
}
export const reportDefinitions: Record<ReportId, Definition> = {
  'sales-period': {
    category: 'commercial',
    title: 'Vendas por período',
    description: 'Pedidos confirmados ou expedidos, pela data de confirmação.',
    filters: ['from', 'to', 'customerId', 'productId', 'sellerUid'],
  },
  'orders-status': {
    category: 'commercial',
    title: 'Pedidos por status',
    description: 'Pedidos criados no período, pela situação atual.',
    filters: ['from', 'to', 'status', 'customerId', 'sellerUid'],
    statuses: ['draft', 'confirmed', 'dispatched', 'canceled'],
  },
  'sales-customers': {
    category: 'commercial',
    title: 'Vendas por cliente',
    description: 'Clientes que mais compraram no período.',
    filters: ['from', 'to', 'sellerUid'],
  },
  'sales-products': {
    category: 'commercial',
    title: 'Vendas por produto',
    description: 'Quantidades e valores vendidos de cada produto.',
    filters: ['from', 'to', 'customerId', 'productId', 'sellerUid'],
  },
  'sales-sellers': {
    category: 'commercial',
    title: 'Desempenho por vendedor',
    description: 'Vendas de cada responsável pelos pedidos.',
    filters: ['from', 'to'],
  },
  receivables: {
    category: 'financial',
    title: 'Contas a receber',
    description: 'Parcelas por vencimento, com valores recebidos e em aberto.',
    filters: ['from', 'to', 'status', 'customerId'],
    statuses: ['open', 'partially_paid', 'paid', 'canceled'],
  },
  overdue: {
    category: 'financial',
    title: 'Títulos vencidos',
    description: 'Parcelas vencidas com saldo em aberto.',
    filters: ['from', 'to', 'customerId'],
  },
  upcoming: {
    category: 'financial',
    title: 'Títulos a vencer',
    description: 'Parcelas com saldo em aberto que ainda vão vencer.',
    filters: ['from', 'to', 'customerId'],
  },
  receipts: {
    category: 'financial',
    title: 'Recebimentos por período',
    description: 'Dinheiro efetivamente recebido, pela data do recebimento.',
    filters: ['from', 'to', 'customerId'],
  },
  delinquency: {
    category: 'financial',
    title: 'Inadimplência por cliente',
    description: 'Clientes com parcelas vencidas e não pagas.',
    filters: ['from', 'to'],
  },
  'stock-position': {
    category: 'inventory',
    title: 'Posição de estoque',
    description: 'Saldo físico, reservado e disponível de cada produto.',
    filters: ['status', 'productId'],
    statuses: ['active', 'inactive', 'all'],
  },
  'stock-low': {
    category: 'inventory',
    title: 'Estoque baixo',
    description: 'Produtos com disponível abaixo do mínimo.',
    filters: ['status'],
    statuses: ['active', 'inactive', 'all'],
  },
  'stock-empty': {
    category: 'inventory',
    title: 'Sem estoque',
    description: 'Produtos sem quantidade disponível.',
    filters: ['status'],
    statuses: ['active', 'inactive', 'all'],
  },
  'stock-movements': {
    category: 'inventory',
    title: 'Movimentações de estoque',
    description: 'Entradas, saídas, ajustes e reservas registrados.',
    filters: ['from', 'to', 'productId', 'movement'],
  },
};

const orderStatusLabel: Record<Order['status'], string> = {
  draft: 'Rascunho',
  confirmed: 'Confirmado',
  dispatched: 'Expedido',
  canceled: 'Cancelado',
};
const titleStatusLabel = {
  open: 'Em aberto',
  partially_paid: 'Parcialmente pago',
  paid: 'Pago',
  canceled: 'Cancelado',
  zero: 'Sem valor',
} as const;
const movementLabel: Record<Movement['type'], string> = {
  STOCK_ENTRY: 'Entrada',
  STOCK_ADJUSTMENT_IN: 'Ajuste positivo',
  STOCK_ADJUSTMENT_OUT: 'Ajuste negativo',
  STOCK_RESERVATION: 'Reserva de pedido',
  STOCK_RESERVATION_RELEASE: 'Reserva liberada',
  STOCK_DISPATCH: 'Expedição',
  STOCK_RETURN: 'Devolução recebida',
};
const movementGroup: Record<NonNullable<ReportQuery['movement']>, Movement['type'][]> = {
  entries: ['STOCK_ENTRY', 'STOCK_RETURN'],
  exits: ['STOCK_DISPATCH'],
  adjustments: ['STOCK_ADJUSTMENT_IN', 'STOCK_ADJUSTMENT_OUT'],
  reservations: ['STOCK_RESERVATION', 'STOCK_RESERVATION_RELEASE'],
};
const movementGroupLabel = {
  entries: 'Entradas',
  exits: 'Saídas',
  adjustments: 'Ajustes',
  reservations: 'Reservas',
} as const;
const statusFilterLabel: Record<NonNullable<ReportQuery['status']>, string> = {
  ...orderStatusLabel,
  open: 'Em aberto',
  partially_paid: 'Parcialmente pago',
  paid: 'Pago',
  active: 'Ativos',
  inactive: 'Inativos',
  all: 'Todos',
};

// Calendar helpers in the company timezone. Instants are compared as UTC ISO strings.
const dateParts = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
export const localDay = (instant: string, timezone: string) =>
  dateParts(new Date(instant), timezone);
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
function offsetMs(at: number, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return local - Math.floor(at / 1000) * 1000;
}
/** First instant of a local calendar date, as a UTC ISO string. */
export function zonedStart(date: string, timezone: string) {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const first = guess - offsetMs(guess, timezone);
  return new Date(guess - offsetMs(first, timezone)).toISOString();
}
const brDate = (date: string) => date.split('-').reverse().join('/');
const percent = (part: number, total: number) =>
  total > 0 ? Math.round((part * 1000) / total) / 10 : 0;

interface Env {
  tx: Transaction;
  ctx: TenantContext;
  /**
   * Sellers only: customers of the seller's current portfolio. Null for administrators, who
   * see the whole company. Every commercial figure (rows, totals, charts and files) comes
   * from orders inside this scope.
   */
  portfolio: Set<string> | null;
  tenantId: string;
  timezone: string;
  now: Date;
  today: string;
}
type Body = Pick<ReportView, 'period' | 'summary' | 'columns' | 'rows' | 'chart' | 'notes'> & {
  filters?: ReportView['filters'];
};
type Row = ReportView['rows'][number];
type Summary = ReportView['summary'][number];
const column = (
  key: string,
  label: string,
  kind: ReportValueKind,
): ReportView['columns'][number] => ({
  key,
  label,
  kind,
  align: kind === 'text' || kind === 'date' || kind === 'datetime' ? 'left' : 'right',
});
const metric = (
  key: string,
  label: string,
  kind: ReportValueKind,
  value: number,
  options: { tone?: Summary['tone']; caption?: string | null } = {},
): Summary => ({
  key,
  label,
  kind,
  value,
  tone: options.tone ?? 'default',
  caption: options.caption ?? null,
});
const row = (cells: Row['cells'], link: Row['link'] = null): Row => ({ cells, link });
const sold = (order: Order) => order.status === 'confirmed' || order.status === 'dispatched';

/**
 * Read-only reports over the authenticated company's own records. Every number comes from the
 * same validated projections the operational screens use: sales are confirmed or dispatched
 * orders, money received comes only from receipts, and stock figures from the stock ledger.
 */
export class ReportService {
  private readonly gate = new ReadGate(2);
  constructor(
    readonly orders: OrderService,
    readonly financial: FinancialReads,
    readonly inventory: InventoryService,
    readonly auth: Auth,
  ) {}
  private get repo() {
    return this.orders.repo;
  }

  async report(actor: Actor, tenantId: string, id: ReportId, input: unknown) {
    const query = reportQuery.parse(input);
    return this.gate.run(() => this.build(actor, tenantId, id, query));
  }
  /** Full result as a file: every row, not only the page shown on screen. */
  async download(
    actor: Actor,
    tenantId: string,
    id: ReportId,
    input: unknown,
    format: 'csv' | 'pdf',
  ): Promise<Download> {
    const query = reportQuery.parse(input);
    return this.gate.run(
      async () => {
        const view = await this.build(actor, tenantId, id, query);
        checkReadBudget();
        const bytes =
          format === 'csv' ? reportCsv(view) : await reportPdf(view, this.orders.clock());
        return { bytes, filename: reportFilename(view, format), rowCount: view.rows.length };
      },
      undefined,
      exportPolicy,
    );
  }
  /** Validates filters, authorizes and builds the report in one read-only transaction. */
  async build(actor: Actor, tenantId: string, id: ReportId, query: ReportQuery) {
    const definition = reportDefinitions[id];
    for (const key of Object.keys(query) as Filter[])
      requireCondition(
        query[key] === undefined || definition.filters.includes(key),
        422,
        'VALIDATION_ERROR',
        'Filtro não disponível para este relatório',
      );
    requireCondition(
      !query.status || definition.statuses?.includes(query.status),
      422,
      'VALIDATION_ERROR',
      'Situação não disponível para este relatório',
    );
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.orders.access.tenant(actor, tenantId, 'reports:read', tx);
        if (definition.category === 'financial')
          requirePermission(ctx.membership, ctx.entitlements, 'receivables:read');
        if (definition.category === 'inventory')
          requirePermission(ctx.membership, ctx.entitlements, 'inventory:manage');
        if (id === 'sales-sellers' && !hasFeature(ctx.entitlements, 'commercial.sellers'))
          throw featureNotInPlan();
        const portfolio = await this.scopeFor(ctx, tx, query);
        const now = this.orders.clock();
        const env: Env = {
          tx,
          ctx,
          portfolio,
          tenantId,
          timezone: ctx.tenant.timezone,
          now,
          today: dateParts(now, ctx.tenant.timezone),
        };
        const body = await this.body(env, id, query);
        return reportView.parse({
          report: id,
          category: definition.category,
          title: definition.title,
          description: definition.description,
          company: ctx.tenant.name,
          timezone: ctx.tenant.timezone,
          generatedAt: now.toISOString(),
          ...body,
          filters: [
            ...(portfolio ? [{ label: 'Escopo', value: 'Sua carteira de clientes' }] : []),
            ...(await this.filterLabels(env, query)),
            ...(body.filters ?? []),
          ],
        });
      },
      { readOnly: true },
    );
  }

  /**
   * Report scope of the caller, decided by the server alone. Administrators keep the company
   * view. Sellers see only orders they can open in Pedidos: their own orders for customers
   * currently in their portfolio. A customer that moves to another seller leaves this scope,
   * and an order is never counted just because the seller created it. Filters pointing outside
   * the scope are refused instead of silently widening or emptying it.
   */
  private async scopeFor(ctx: TenantContext, tx: Transaction, query: ReportQuery) {
    if (ctx.membership.role === 'administrator') return null;
    requireCondition(
      !query.sellerUid || query.sellerUid === ctx.actor.uid,
      403,
      'FORBIDDEN',
      'Relatórios do vendedor ficam restritos à própria carteira',
    );
    const portfolio = await this.repo.portfolio(ctx.tenant.id, ctx.actor.uid, tx);
    requireCondition(
      !query.customerId || portfolio.has(query.customerId),
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return portfolio;
  }

  private body(env: Env, id: ReportId, query: ReportQuery): Promise<Body> {
    switch (id) {
      case 'sales-period':
        return this.salesPeriod(env, query);
      case 'orders-status':
        return this.ordersByStatus(env, query);
      case 'sales-customers':
        return this.salesByCustomer(env, query);
      case 'sales-products':
        return this.salesByProduct(env, query);
      case 'sales-sellers':
        return this.salesBySeller(env, query);
      case 'receivables':
      case 'overdue':
      case 'upcoming':
        return this.titles(env, id, query);
      case 'receipts':
        return this.receipts(env, query);
      case 'delinquency':
        return this.delinquency(env, query);
      case 'stock-position':
      case 'stock-low':
      case 'stock-empty':
        return this.stock(env, id, query);
      case 'stock-movements':
        return this.movements(env, query);
    }
  }

  /** Requested period, or the current month to date; at most one year. */
  private period(
    query: ReportQuery,
    defaults: { from: string; to: string },
    limits: { min?: string; max?: string } = {},
  ) {
    let from = query.from ?? defaults.from;
    let to = query.to ?? defaults.to;
    if (limits.min && from < limits.min) from = limits.min;
    if (limits.max && to > limits.max) to = limits.max;
    requireCondition(from <= to, 422, 'VALIDATION_ERROR', 'Período inválido');
    requireCondition(
      daysBetween(from, to) < MAX_SPAN_DAYS,
      422,
      'REPORT_RANGE_TOO_LARGE',
      'Período máximo de um ano por consulta',
    );
    return { from, to };
  }
  private monthToDate(env: Env) {
    return { from: `${env.today.slice(0, 8)}01`, to: env.today };
  }

  private async scan<T>(
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
            const value = await this.repo.foundation.readSnapshot(doc, schema, tx);
            requireCondition(value, 500, 'INTERNAL_ERROR', 'Erro interno do servidor');
            return value;
          }),
        )),
      );
    }
    return values;
  }

  /** Orders whose `field` falls in the local period, narrowed by the optional filters. */
  private async ordersIn(
    env: Env,
    field: 'confirmedAt' | 'createdAt',
    range: { from: string; to: string },
    query: ReportQuery,
  ) {
    const collection = this.repo.ref(env.tenantId, 'orders', 'placeholder').parent;
    const orders = await this.scan(
      env.tx,
      collection
        .where(field, '>=', zonedStart(range.from, env.timezone))
        .where(field, '<', zonedStart(addDays(range.to, 1), env.timezone))
        .orderBy(field),
      orderSchema,
      REPORT_CAPS.orders,
      'pedidos',
    );
    const portfolio = env.portfolio;
    return orders.filter(
      (o) =>
        o.tenantId === env.tenantId &&
        (!portfolio ||
          (o.customerId !== null &&
            portfolio.has(o.customerId) &&
            o.sellerUid === env.ctx.actor.uid)) &&
        (!query.customerId || o.customerId === query.customerId) &&
        (!query.sellerUid || o.sellerUid === query.sellerUid) &&
        (!query.productId || o.lines.some((l) => l.productId === query.productId)),
    );
  }

  private async salesPeriod(env: Env, query: ReportQuery): Promise<Body> {
    const range = this.period(query, this.monthToDate(env));
    const orders = await this.ordersIn(env, 'confirmedAt', range, query);
    const sales = orders.filter(sold);
    const canceled = orders.filter((o) => o.status === 'canceled');
    const monthly = daysBetween(range.from, range.to) > 62;
    const buckets = new Map<string, { orders: number; gross: number; discount: number; net: number }>();
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      const key = monthly ? d.slice(0, 7) : d;
      if (!buckets.has(key)) buckets.set(key, { orders: 0, gross: 0, discount: 0, net: 0 });
    }
    for (const order of sales) {
      const day = localDay(order.confirmedAt!, env.timezone);
      const bucket = buckets.get(monthly ? day.slice(0, 7) : day);
      if (!bucket) continue;
      bucket.orders++;
      bucket.gross += order.subtotalCents;
      bucket.discount += order.discountCents;
      bucket.net += order.totalCents;
    }
    const net = sales.reduce((a, o) => a + o.totalCents, 0);
    const discount = sales.reduce((a, o) => a + o.discountCents, 0);
    const label = (key: string) => (monthly ? `${key.slice(5, 7)}/${key.slice(0, 4)}` : brDate(key));
    return {
      period: { ...range, basis: 'Data de confirmação do pedido' },
      summary: [
        metric('net', 'Vendas', 'money', net),
        metric('orders', 'Pedidos vendidos', 'count', sales.length),
        metric('average', 'Ticket médio', 'money', sales.length ? Math.round(net / sales.length) : 0),
        metric('discount', 'Descontos concedidos', 'money', discount),
        metric('canceled', 'Cancelados após confirmação', 'count', canceled.length, {
          tone: canceled.length ? 'warning' : 'default',
          caption: canceled.length
            ? `${brl(canceled.reduce((a, o) => a + o.totalCents, 0))} fora das vendas`
            : null,
        }),
      ],
      columns: [
        column('period', monthly ? 'Mês' : 'Dia', 'text'),
        column('orders', 'Pedidos', 'count'),
        column('gross', 'Valor bruto', 'money'),
        column('discount', 'Descontos', 'money'),
        column('net', 'Vendas', 'money'),
        column('average', 'Ticket médio', 'money'),
      ],
      // The table lists only periods with sales; the chart keeps the full timeline.
      rows: [...buckets]
        .filter(([, b]) => b.orders > 0)
        .map(([key, b]) =>
          row({
            period: label(key),
            orders: b.orders,
            gross: b.gross,
            discount: b.discount,
            net: b.net,
            average: Math.round(b.net / b.orders),
          }),
        ),
      chart: {
        label: monthly ? 'Vendas por mês' : 'Vendas por dia',
        kind: 'money',
        points: [...buckets].map(([key, b]) => ({ label: label(key), value: b.net })),
      },
      notes: [
        'Vendas consideram pedidos confirmados ou expedidos, pela data de confirmação. Pedidos cancelados não entram.',
        'Valor vendido não é dinheiro recebido: consulte Recebimentos por período.',
      ],
    };
  }

  private async ordersByStatus(env: Env, query: ReportQuery): Promise<Body> {
    const range = this.period(query, this.monthToDate(env));
    const orders = await this.ordersIn(env, 'createdAt', range, query);
    const names = await this.people(orders.map((o) => o.sellerUid));
    const statuses = ['draft', 'confirmed', 'dispatched', 'canceled'] as const;
    const listed = orders
      .filter((o) => !query.status || o.status === query.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      period: { ...range, basis: 'Data de criação do pedido' },
      summary: statuses.map((status) => {
        const group = orders.filter((o) => o.status === status);
        return metric(status, orderStatusLabel[status], 'count', group.length, {
          caption: brl(group.reduce((a, o) => a + o.totalCents, 0)),
          tone: status === 'canceled' && group.length ? 'warning' : 'default',
        });
      }),
      columns: [
        column('order', 'Pedido', 'text'),
        column('date', 'Data do pedido', 'date'),
        column('customer', 'Cliente', 'text'),
        column('seller', 'Responsável', 'text'),
        column('status', 'Situação', 'text'),
        column('total', 'Total', 'money'),
      ],
      rows: listed.map((o) =>
        row(
          {
            order: orderNumber(o.commercialId),
            date: localDay(o.createdAt, env.timezone),
            customer: o.customerName ?? 'Sem cliente',
            seller: names.get(o.sellerUid) ?? 'Usuário sem nome',
            status: orderStatusLabel[o.status],
            total: o.totalCents,
          },
          { kind: 'order', id: o.id },
        ),
      ),
      chart: null,
      notes: [
        'Situação atual de cada pedido criado no período. Valores de rascunhos e cancelados não são vendas.',
      ],
    };
  }

  private async salesByCustomer(env: Env, query: ReportQuery): Promise<Body> {
    const range = this.period(query, this.monthToDate(env));
    const sales = (await this.ordersIn(env, 'confirmedAt', range, query)).filter(sold);
    const total = sales.reduce((a, o) => a + o.totalCents, 0);
    const groups = new Map<string, { name: string; orders: number; net: number; last: string }>();
    for (const order of sales) {
      const key = order.customerId!;
      const group = groups.get(key) ?? { name: '', orders: 0, net: 0, last: '' };
      group.orders++;
      group.net += order.totalCents;
      if (order.confirmedAt! >= group.last) {
        group.last = order.confirmedAt!;
        group.name = order.customerName ?? 'Cliente';
      }
      groups.set(key, group);
    }
    const ranked = [...groups].sort((a, b) => b[1].net - a[1].net);
    return {
      period: { ...range, basis: 'Data de confirmação do pedido' },
      summary: [
        metric('customers', 'Clientes com compras', 'count', groups.size),
        metric('net', 'Vendas', 'money', total),
        metric('average', 'Média por cliente', 'money', groups.size ? Math.round(total / groups.size) : 0),
        metric('top', 'Maior cliente', 'percent', ranked[0] ? percent(ranked[0][1].net, total) : 0, {
          caption: ranked[0]?.[1].name ?? null,
        }),
      ],
      columns: [
        column('customer', 'Cliente', 'text'),
        column('orders', 'Pedidos', 'count'),
        column('net', 'Vendas', 'money'),
        column('average', 'Ticket médio', 'money'),
        column('last', 'Última compra', 'date'),
        column('share', '% das vendas', 'percent'),
      ],
      rows: ranked.map(([id, g]) =>
        row(
          {
            customer: g.name,
            orders: g.orders,
            net: g.net,
            average: Math.round(g.net / g.orders),
            last: localDay(g.last, env.timezone),
            share: percent(g.net, total),
          },
          { kind: 'customer', id },
        ),
      ),
      chart: null,
      notes: ['Pedidos confirmados ou expedidos no período, pela data de confirmação.'],
    };
  }

  private async salesByProduct(env: Env, query: ReportQuery): Promise<Body> {
    const range = this.period(query, this.monthToDate(env));
    const sales = (await this.ordersIn(env, 'confirmedAt', range, query)).filter(sold);
    const groups = new Map<
      string,
      { id: string; name: string; sku: string; unit: string; scaled: number; orders: number; net: number }
    >();
    for (const order of sales)
      for (const line of order.lines) {
        if (query.productId && line.productId !== query.productId) continue;
        const key = `${line.productId}:${line.unit}`;
        const group = groups.get(key) ?? {
          id: line.productId,
          name: line.name,
          sku: line.sku,
          unit: line.unit,
          scaled: 0,
          orders: 0,
          net: 0,
        };
        group.scaled += parseQuantity(line.quantity, line.unit);
        group.orders++;
        group.net += line.totalCents;
        groups.set(key, group);
      }
    const total = [...groups.values()].reduce((a, g) => a + g.net, 0);
    const ranked = [...groups.values()].sort((a, b) => b.net - a.net);
    return {
      period: { ...range, basis: 'Data de confirmação do pedido' },
      summary: [
        metric('products', 'Produtos vendidos', 'count', groups.size),
        metric('net', 'Valor vendido', 'money', total),
        metric('lines', 'Itens em pedidos', 'count', ranked.reduce((a, g) => a + g.orders, 0)),
      ],
      columns: [
        column('product', 'Produto', 'text'),
        column('sku', 'SKU', 'text'),
        column('quantity', 'Quantidade', 'quantity'),
        column('unit', 'Unidade', 'text'),
        column('orders', 'Pedidos', 'count'),
        column('net', 'Valor vendido', 'money'),
        column('share', '% do valor', 'percent'),
      ],
      rows: ranked.map((g) =>
        row(
          {
            product: g.name,
            sku: g.sku,
            quantity: formatQuantity(g.scaled),
            unit: g.unit,
            orders: g.orders,
            net: g.net,
            share: percent(g.net, total),
          },
          { kind: 'product', id: g.id },
        ),
      ),
      chart: null,
      notes: [
        'Valor de cada produto já considera descontos rateados nas linhas do pedido.',
        'Nome e SKU como registrados no pedido.',
      ],
    };
  }

  private async salesBySeller(env: Env, query: ReportQuery): Promise<Body> {
    const range = this.period(query, this.monthToDate(env));
    const sales = (await this.ordersIn(env, 'confirmedAt', range, query)).filter(sold);
    const total = sales.reduce((a, o) => a + o.totalCents, 0);
    const groups = new Map<string, { orders: number; net: number; customers: Set<string> }>();
    for (const order of sales) {
      const group = groups.get(order.sellerUid) ?? { orders: 0, net: 0, customers: new Set() };
      group.orders++;
      group.net += order.totalCents;
      if (order.customerId) group.customers.add(order.customerId);
      groups.set(order.sellerUid, group);
    }
    const names = await this.people([...groups.keys()]);
    const ranked = [...groups].sort((a, b) => b[1].net - a[1].net);
    return {
      period: { ...range, basis: 'Data de confirmação do pedido' },
      summary: [
        metric('sellers', 'Responsáveis com vendas', 'count', groups.size),
        metric('net', 'Vendas', 'money', total),
        metric('orders', 'Pedidos vendidos', 'count', sales.length),
      ],
      columns: [
        column('seller', 'Responsável', 'text'),
        column('orders', 'Pedidos', 'count'),
        column('customers', 'Clientes atendidos', 'count'),
        column('net', 'Vendas', 'money'),
        column('average', 'Ticket médio', 'money'),
        column('share', '% das vendas', 'percent'),
      ],
      rows: ranked.map(([uid, g]) =>
        row({
          seller: names.get(uid) ?? 'Usuário sem nome',
          orders: g.orders,
          customers: g.customers.size,
          net: g.net,
          average: Math.round(g.net / g.orders),
          share: percent(g.net, total),
        }),
      ),
      chart: ranked.length > 1
        ? {
            label: 'Vendas por responsável',
            kind: 'money',
            points: ranked.map(([uid, g]) => ({ label: names.get(uid) ?? 'Usuário sem nome', value: g.net })),
          }
        : null,
      notes: ['Responsável é o usuário do pedido (vendedor ou administrador que o registrou).'],
    };
  }

  private async titles(
    env: Env,
    id: 'receivables' | 'overdue' | 'upcoming',
    query: ReportQuery,
  ): Promise<Body> {
    const yesterday = addDays(env.today, -1);
    const range =
      id === 'overdue'
        ? this.period(query, { from: addDays(env.today, -365), to: yesterday }, { max: yesterday })
        : id === 'upcoming'
          ? this.period(query, { from: env.today, to: addDays(env.today, 30) }, { min: env.today })
          : this.period(query, {
              from: `${env.today.slice(0, 8)}01`,
              to: addDays(`${addDays(`${env.today.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1),
            });
    const all = await this.financial.reportTitles(env.tx, env.tenantId, range, REPORT_CAPS.titles);
    const titles = all
      .filter((t) => t.status !== 'zero' && (!query.customerId || t.customerId === query.customerId))
      .filter((t) =>
        id === 'overdue'
          ? t.outstandingCents > 0 && t.dueDate < env.today
          : id === 'upcoming'
            ? t.outstandingCents > 0 && t.dueDate >= env.today
            : query.status === 'open'
              ? t.outstandingCents > 0
              : !query.status || t.status === query.status,
      );
    const sum = (pick: (t: (typeof titles)[number]) => number) =>
      titles.reduce((a, t) => a + pick(t), 0);
    const overdue = (t: (typeof titles)[number]) => t.outstandingCents > 0 && t.dueDate < env.today;
    const lateDays = (t: (typeof titles)[number]) =>
      overdue(t) ? daysBetween(t.dueDate, env.today) : 0;
    const customers = new Set(titles.map((t) => t.customerId)).size;
    const summary =
      id === 'receivables'
        ? [
            metric('original', 'Valor das parcelas', 'money', sum((t) => t.originalCents)),
            metric('cash', 'Recebido em dinheiro', 'money', sum((t) => t.cashCents), {
              tone: 'success',
            }),
            metric('credit', 'Quitado com crédito', 'money', sum((t) => t.creditCents)),
            metric('outstanding', 'Em aberto', 'money', sum((t) => t.outstandingCents)),
            metric('overdue', 'Vencido', 'money', sum((t) => (overdue(t) ? t.outstandingCents : 0)), {
              tone: titles.some(overdue) ? 'danger' : 'default',
            }),
            ...(sum((t) => t.canceledCents)
              ? [metric('canceled', 'Cancelado', 'money', sum((t) => t.canceledCents))]
              : []),
          ]
        : id === 'overdue'
          ? [
              metric('outstanding', 'Valor vencido', 'money', sum((t) => t.outstandingCents), {
                tone: titles.length ? 'danger' : 'default',
              }),
              metric('titles', 'Parcelas vencidas', 'count', titles.length),
              metric('customers', 'Clientes', 'count', customers),
              metric('late', 'Maior atraso (dias)', 'count', Math.max(0, ...titles.map(lateDays))),
            ]
          : [
              metric('outstanding', 'A receber', 'money', sum((t) => t.outstandingCents)),
              metric('titles', 'Parcelas', 'count', titles.length),
              metric(
                'week',
                'Próximos 7 dias',
                'money',
                titles
                  .filter((t) => t.dueDate <= addDays(env.today, 6))
                  .reduce((a, t) => a + t.outstandingCents, 0),
              ),
              metric('customers', 'Clientes', 'count', customers),
            ];
    return {
      period: { ...range, basis: 'Data de vencimento' },
      summary,
      columns: [
        column('due', 'Vencimento', 'date'),
        column('customer', 'Cliente', 'text'),
        column('order', 'Pedido', 'text'),
        column('installment', 'Parcela', 'count'),
        column('original', 'Valor', 'money'),
        ...(id === 'receivables' ? [column('received', 'Recebido', 'money')] : []),
        column('outstanding', 'Em aberto', 'money'),
        id === 'overdue' ? column('late', 'Dias em atraso', 'count') : column('status', 'Situação', 'text'),
      ],
      rows: titles.map((t) =>
        row(
          {
            due: t.dueDate,
            customer: t.customerName,
            order: orderNumber(t.commercialId),
            installment: t.installmentNumber,
            original: t.originalCents,
            received: t.cashCents + t.creditCents,
            outstanding: t.outstandingCents,
            status: overdue(t) ? 'Vencido' : titleStatusLabel[t.status],
            late: lateDays(t),
          },
          { kind: 'title', id: t.id },
        ),
      ),
      chart: null,
      notes: [
        id === 'receivables'
          ? 'Recebido inclui dinheiro e créditos do cliente aplicados à parcela. Valor de pedido não é dinheiro recebido.'
          : id === 'overdue'
            ? 'Parcelas com vencimento até ontem e saldo em aberto.'
            : 'Parcelas com vencimento a partir de hoje e saldo em aberto.',
      ],
    };
  }

  private async receipts(env: Env, query: ReportQuery): Promise<Body> {
    const range = this.period(query, this.monthToDate(env));
    let base: Query = this.repo.ref(env.tenantId, 'payments', 'placeholder').parent;
    base = base.where('receivedOn', '>=', range.from).where('receivedOn', '<=', range.to);
    const payments = (
      await this.scan(env.tx, base.orderBy('receivedOn'), paymentSchema, REPORT_CAPS.payments, 'recebimentos')
    ).filter(
      (p) => p.tenantId === env.tenantId && (!query.customerId || p.customerId === query.customerId),
    );
    const orders = await this.ordersById(env, payments.map((p) => p.orderId));
    const received = payments.reduce((a, p) => a + p.amountCents, 0);
    const reversed = payments.reduce((a, p) => a + p.reversedCents, 0);
    const methods = new Map<string, number>();
    for (const p of payments)
      methods.set(p.method.name, (methods.get(p.method.name) ?? 0) + p.amountCents - p.reversedCents);
    return {
      period: { ...range, basis: 'Data do recebimento' },
      summary: [
        metric('net', 'Recebido líquido', 'money', received - reversed, { tone: 'success' }),
        metric('received', 'Recebimentos registrados', 'money', received, {
          caption: `${payments.length} ${payments.length === 1 ? 'lançamento' : 'lançamentos'}`,
        }),
        metric('reversed', 'Estornos', 'money', reversed, { tone: reversed ? 'warning' : 'default' }),
        ...[...methods]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([name, value], i) => metric(`method${i}`, name, 'money', value, { caption: 'por forma de pagamento' })),
      ],
      columns: [
        column('date', 'Data', 'date'),
        column('customer', 'Cliente', 'text'),
        column('order', 'Pedido', 'text'),
        column('method', 'Forma', 'text'),
        column('amount', 'Recebido', 'money'),
        column('reversed', 'Estornado', 'money'),
        column('net', 'Líquido', 'money'),
      ],
      rows: payments
        .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.recordedAt.localeCompare(a.recordedAt))
        .map((p) =>
          row(
            {
              date: p.receivedOn,
              customer: orders.get(p.orderId)?.customerName ?? 'Cliente',
              order: orderNumber(orders.get(p.orderId)?.commercialId ?? ''),
              method: p.method.name,
              amount: p.amountCents,
              reversed: p.reversedCents,
              net: p.amountCents - p.reversedCents,
            },
            { kind: 'order', id: p.orderId },
          ),
        ),
      chart: null,
      notes: [
        'Somente dinheiro registrado como recebido. Créditos do cliente aplicados a parcelas não entram aqui.',
      ],
    };
  }

  private async delinquency(env: Env, query: ReportQuery): Promise<Body> {
    const yesterday = addDays(env.today, -1);
    const range = this.period(
      query,
      { from: addDays(env.today, -365), to: yesterday },
      { max: yesterday },
    );
    const titles = (
      await this.financial.reportTitles(env.tx, env.tenantId, range, REPORT_CAPS.titles)
    ).filter((t) => t.outstandingCents > 0 && t.dueDate < env.today);
    const groups = new Map<string, { name: string; count: number; value: number; oldest: string }>();
    for (const t of titles) {
      const group = groups.get(t.customerId) ?? { name: t.customerName, count: 0, value: 0, oldest: t.dueDate };
      group.count++;
      group.value += t.outstandingCents;
      if (t.dueDate < group.oldest) group.oldest = t.dueDate;
      groups.set(t.customerId, group);
    }
    const total = titles.reduce((a, t) => a + t.outstandingCents, 0);
    return {
      period: { ...range, basis: 'Data de vencimento' },
      summary: [
        metric('customers', 'Clientes inadimplentes', 'count', groups.size, {
          tone: groups.size ? 'danger' : 'default',
        }),
        metric('value', 'Valor vencido', 'money', total, { tone: total ? 'danger' : 'default' }),
        metric('titles', 'Parcelas vencidas', 'count', titles.length),
      ],
      columns: [
        column('customer', 'Cliente', 'text'),
        column('titles', 'Parcelas vencidas', 'count'),
        column('value', 'Valor vencido', 'money'),
        column('oldest', 'Vencimento mais antigo', 'date'),
        column('late', 'Maior atraso (dias)', 'count'),
        column('share', '% do vencido', 'percent'),
      ],
      rows: [...groups]
        .sort((a, b) => b[1].value - a[1].value)
        .map(([id, g]) =>
          row(
            {
              customer: g.name,
              titles: g.count,
              value: g.value,
              oldest: g.oldest,
              late: daysBetween(g.oldest, env.today),
              share: percent(g.value, total),
            },
            { kind: 'customer', id },
          ),
        ),
      chart: null,
      notes: ['Parcelas vencidas até ontem com saldo em aberto, dentro do período de vencimento.'],
    };
  }

  private async stock(
    env: Env,
    id: 'stock-position' | 'stock-low' | 'stock-empty',
    query: ReportQuery,
  ): Promise<Body> {
    const status = query.status ?? 'active';
    let base: Query = this.repo.ref(env.tenantId, 'products', 'placeholder').parent;
    if (status !== 'all') base = base.where('status', '==', status);
    const products = query.productId
      ? [
          await this.repo.foundation.read(
            this.repo.ref(env.tenantId, 'products', query.productId),
            productSchema,
            env.tx,
          ),
        ].filter((p) => p !== null && (status === 'all' || p.status === status))
      : await this.scan(
          env.tx,
          base.orderBy('nameKey').orderBy(FieldPath.documentId()),
          productSchema,
          REPORT_CAPS.products,
          'produtos',
        );
    const stocks: Awaited<ReturnType<InventoryService['stockFor']>>[] = [];
    for (let i = 0; i < products.length; i += 50) {
      checkReadBudget();
      stocks.push(
        ...(await Promise.all(products.slice(i, i + 50).map((p) => this.inventory.stockFor(p!, env.tx)))),
      );
    }
    const available = (s: (typeof stocks)[number]) => s.physicalScaled - s.reservedScaled;
    const state = (s: (typeof stocks)[number]) =>
      available(s) === 0 ? 'Sem estoque disponível' : s.belowMinimum ? 'Abaixo do mínimo' : 'Normal';
    const listed = stocks.filter((s) =>
      id === 'stock-empty'
        ? available(s) === 0
        : id === 'stock-low'
          ? available(s) > 0 && s.belowMinimum
          : true,
    );
    const empty = stocks.filter((s) => available(s) === 0).length;
    const low = stocks.filter((s) => available(s) > 0 && s.belowMinimum).length;
    return {
      period: null,
      summary:
        id === 'stock-position'
          ? [
              metric('products', 'Produtos', 'count', stocks.length),
              metric('empty', 'Sem estoque', 'count', empty, { tone: empty ? 'danger' : 'default' }),
              metric('low', 'Abaixo do mínimo', 'count', low, { tone: low ? 'warning' : 'default' }),
              metric('reserved', 'Com reserva', 'count', stocks.filter((s) => s.reservedScaled > 0).length),
            ]
          : [
              metric('listed', id === 'stock-low' ? 'Abaixo do mínimo' : 'Sem estoque', 'count', listed.length, {
                tone: listed.length ? (id === 'stock-low' ? 'warning' : 'danger') : 'default',
              }),
              metric('products', 'Produtos analisados', 'count', stocks.length),
            ],
      columns: [
        column('product', 'Produto', 'text'),
        column('sku', 'SKU', 'text'),
        column('unit', 'Unidade', 'text'),
        column('physical', 'Físico', 'quantity'),
        column('reserved', 'Reservado', 'quantity'),
        column('available', 'Disponível', 'quantity'),
        column('minimum', 'Mínimo', 'quantity'),
        ...(id === 'stock-position' ? [column('state', 'Situação', 'text')] : []),
        ...(id === 'stock-low' ? [column('suggested', 'Sugestão de reposição', 'quantity')] : []),
      ],
      rows: listed.map((s) =>
        row(
          {
            product: s.name,
            sku: s.sku,
            unit: s.unit,
            physical: formatQuantity(s.physicalScaled),
            reserved: formatQuantity(s.reservedScaled),
            available: formatQuantity(available(s)),
            minimum: formatQuantity(s.minimumScaled),
            state: state(s),
            suggested: formatQuantity(s.shortfallScaled),
          },
          { kind: 'product', id: s.id },
        ),
      ),
      chart: null,
      notes: [
        'Disponível é o físico menos o reservado para pedidos confirmados.',
        ...(id === 'stock-low' ? ['Sugestão de reposição: mínimo menos disponível.'] : []),
      ],
    };
  }

  private async movements(env: Env, query: ReportQuery): Promise<Body> {
    const range = this.period(query, this.monthToDate(env));
    let base: Query = this.repo.ref(env.tenantId, 'inventoryMovements', 'placeholder').parent;
    if (query.productId) base = base.where('productId', '==', query.productId);
    if (query.movement) base = base.where('type', 'in', movementGroup[query.movement]);
    base = base
      .where('occurredAt', '>=', zonedStart(range.from, env.timezone))
      .where('occurredAt', '<', zonedStart(addDays(range.to, 1), env.timezone))
      .orderBy('occurredAt', 'desc');
    const movements = (
      await this.scan(env.tx, base, movementSchema, REPORT_CAPS.movements, 'movimentações')
    ).filter((m) => m.tenantId === env.tenantId);
    const products = new Map<string, { name: string; sku: string }>();
    const ids = [...new Set(movements.map((m) => m.productId))];
    for (let i = 0; i < ids.length; i += 100) {
      checkReadBudget();
      const refs = ids.slice(i, i + 100).map((id) => this.repo.ref(env.tenantId, 'inventory', id));
      const snapshots = refs.length ? await env.tx.getAll(...refs) : [];
      for (const snapshot of snapshots) {
        const stock = await this.repo.foundation.readSnapshot(snapshot, stockSchema, env.tx);
        if (stock) products.set(stock.id, { name: stock.name, sku: stock.sku });
      }
    }
    const count = (types: Movement['type'][]) => movements.filter((m) => types.includes(m.type)).length;
    return {
      period: { ...range, basis: 'Data da movimentação' },
      summary: [
        metric('movements', 'Movimentações', 'count', movements.length),
        metric('entries', 'Entradas', 'count', count(movementGroup.entries)),
        metric('exits', 'Saídas', 'count', count(movementGroup.exits)),
        metric('adjustments', 'Ajustes', 'count', count(movementGroup.adjustments)),
        metric('reservations', 'Reservas', 'count', count(movementGroup.reservations)),
      ],
      columns: [
        column('date', 'Data e hora', 'datetime'),
        column('product', 'Produto', 'text'),
        column('type', 'Tipo', 'text'),
        column('quantity', 'Quantidade', 'quantity'),
        column('unit', 'Unidade', 'text'),
        column('physical', 'Físico após', 'quantity'),
        column('origin', 'Origem', 'text'),
        column('reason', 'Motivo', 'text'),
      ],
      rows: movements.map((m) =>
        row(
          {
            date: m.occurredAt,
            product: products.get(m.productId)?.name ?? 'Produto',
            type: movementLabel[m.type],
            quantity: formatQuantity(m.quantityScaled),
            unit: m.unit,
            physical: formatQuantity(m.physicalScaled),
            origin:
              m.origin === 'administrative'
                ? m.type === 'STOCK_ENTRY'
                  ? 'Entrada manual'
                  : 'Ajuste manual'
                : 'Automática (pedido)',
            reason: m.reason === m.type ? '' : m.reason,
          },
          { kind: 'product', id: m.productId },
        ),
      ),
      chart: null,
      notes: [
        'Somente movimentações registradas no histórico de estoque. Reservas não alteram o saldo físico.',
      ],
      filters: query.movement
        ? [{ label: 'Tipo', value: movementGroupLabel[query.movement] }]
        : [],
    };
  }

  private async ordersById(env: Env, ids: string[]) {
    const orders = new Map<string, Order>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 25) {
      checkReadBudget();
      await Promise.all(
        unique.slice(i, i + 25).map(async (id) => {
          const order = await this.repo.foundation.read(
            this.repo.ref(env.tenantId, 'orders', id),
            orderSchema,
            env.tx,
          );
          if (order) orders.set(id, order);
        }),
      );
    }
    return orders;
  }

  /** Display names from the identity provider; best effort, like the team list. */
  private async people(uids: string[]) {
    const names = new Map<string, string>();
    const unique = [...new Set(uids)];
    try {
      for (let i = 0; i < unique.length; i += 100) {
        const result = await this.auth.getUsers(unique.slice(i, i + 100).map((uid) => ({ uid })));
        for (const user of result.users)
          names.set(user.uid, user.displayName?.trim() || user.email?.trim() || 'Usuário sem nome');
      }
    } catch {
      // Reports stay correct without names.
    }
    return names;
  }

  /** Human-readable filters for screens and exported files. */
  private async filterLabels(env: Env, query: ReportQuery) {
    const labels: ReportView['filters'] = [];
    if (query.status) labels.push({ label: 'Situação', value: statusFilterLabel[query.status] });
    if (query.customerId) {
      const customer = await this.repo.foundation.read(
        this.repo.ref(env.tenantId, 'customers', query.customerId),
        customerSchema,
        env.tx,
      );
      labels.push({ label: 'Cliente', value: customer?.name ?? 'Cliente não encontrado' });
    }
    if (query.productId) {
      const product = await this.repo.foundation.read(
        this.repo.ref(env.tenantId, 'products', query.productId),
        productSchema,
        env.tx,
      );
      labels.push({ label: 'Produto', value: product?.name ?? 'Produto não encontrado' });
    }
    if (query.sellerUid)
      labels.push({
        label: 'Responsável',
        value: (await this.people([query.sellerUid])).get(query.sellerUid) ?? 'Usuário sem nome',
      });
    return labels;
  }
}
