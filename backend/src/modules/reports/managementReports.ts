import type { ReportQuery, ReportValueKind, ReportView } from '../../shared/schemas/reports.js';
import * as s from '../../shared/schemas/management.js';
import { productSchema } from '../../shared/schemas/commercial.js';
import { checkReadBudget } from '../../shared/operations/readBudget.js';
import {
  MANAGEMENT_CAPS,
  costSnapshots,
  expenseValue,
  flowByPeriod,
  operatingExpenses,
  realizedMoney,
  scanAll,
  soldLines,
  soldOrders,
  type ManagementEnv,
  type Range,
} from '../finance/managementData.js';
import { formatQuantity, parseQuantity } from '../inventory/quantities.js';
import { marginBp, milliToCents } from '../costing/calculation.js';
import { situationOf } from '../payables/titles.js';
import { addDays, daysBetween } from './dates.js';

type Body = Pick<ReportView, 'period' | 'summary' | 'columns' | 'rows' | 'chart' | 'notes'>;
type Row = ReportView['rows'][number];
type Summary = ReportView['summary'][number];
export const managementReportIds = [
  'payables-period',
  'payables-supplier',
  'payables-overdue',
  'payable-payments',
  'purchases-supplier',
  'purchases-product',
  'cost-evolution',
  'product-profitability',
  'cash-flow',
  'expenses-category',
] as const;
export type ManagementReportId = (typeof managementReportIds)[number];

const column = (key: string, label: string, kind: ReportValueKind): ReportView['columns'][number] => ({
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
const percentOf = (bp: number) => Math.round(bp / 10) / 10;
const sum = <T>(rows: readonly T[], pick: (t: T) => number) => rows.reduce((a, t) => a + pick(t), 0);
const situationLabel = {
  open: 'Em aberto',
  partially_paid: 'Parcialmente pago',
  paid: 'Pago',
  overdue: 'Vencido',
  canceled: 'Cancelado',
} as const;
const originLabel = {
  purchase: 'Compra',
  expense: 'Despesa avulsa',
  recurring: 'Despesa recorrente',
  manual: 'Lançamento manual',
} as const;
const costEventLabel = {
  reference_updated: 'Custo de referência alterado',
  purchase_received: 'Recebimento de compra',
  receipt_reversed: 'Estorno de recebimento',
} as const;

export interface ManagementReportEnv extends ManagementEnv {
  period(query: ReportQuery, defaults: Range, limits?: { min?: string; max?: string }): Range;
  zonedStart(date: string, timezone: string): string;
}
const monthToDate = (env: ManagementReportEnv): Range => ({
  from: `${env.today.slice(0, 8)}01`,
  to: env.today,
});
const wholeMonth = (env: ManagementReportEnv): Range => ({
  from: `${env.today.slice(0, 8)}01`,
  to: addDays(`${addDays(`${env.today.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1),
});

async function payablesDue(env: ManagementReportEnv, range: Range, query: ReportQuery) {
  const titles = await scanAll(
    env.repo,
    env.tx,
    env.repo
      .ref(env.tenantId, 'payables', 'placeholder')
      .parent.where('dueDate', '>=', range.from)
      .where('dueDate', '<=', range.to)
      .orderBy('dueDate'),
    s.payableSchema,
    MANAGEMENT_CAPS.payables,
    'títulos',
  );
  return titles.filter(
    (t) =>
      (!query.supplierId || t.beneficiaryId === query.supplierId) &&
      (!query.categoryId || t.categoryId === query.categoryId) &&
      (!query.status || t.status === query.status),
  );
}

async function payablesPeriod(env: ManagementReportEnv, query: ReportQuery): Promise<Body> {
  const range = env.period(query, wholeMonth(env));
  const titles = await payablesDue(env, range, query);
  const open = titles.filter((t) => t.hasBalance);
  const overdue = open.filter((t) => t.dueDate < env.today);
  return {
    period: { ...range, basis: 'Data de vencimento' },
    summary: [
      metric('original', 'Valor dos títulos', 'money', sum(titles, (t) => t.originalCents - t.canceledCents)),
      metric('paid', 'Pago', 'money', sum(titles, (t) => t.paidCents), { tone: 'success' }),
      metric('outstanding', 'Em aberto', 'money', sum(open, (t) => t.outstandingCents)),
      metric('overdue', 'Vencido', 'money', sum(overdue, (t) => t.outstandingCents), {
        tone: overdue.length ? 'danger' : 'default',
      }),
    ],
    columns: [
      column('due', 'Vencimento', 'date'),
      column('description', 'Descrição', 'text'),
      column('beneficiary', 'Fornecedor ou beneficiário', 'text'),
      column('category', 'Categoria', 'text'),
      column('origin', 'Origem', 'text'),
      column('original', 'Valor', 'money'),
      column('paid', 'Pago', 'money'),
      column('outstanding', 'Em aberto', 'money'),
      column('status', 'Situação', 'text'),
    ],
    rows: titles.map((t) =>
      row(
        {
          due: t.dueDate,
          description: t.description,
          beneficiary: t.beneficiaryName ?? '—',
          category: t.categoryName ?? 'Sem categoria',
          origin: originLabel[t.origin],
          original: t.originalCents,
          paid: t.paidCents,
          outstanding: t.outstandingCents,
          status: situationLabel[situationOf(t, env.today)],
        },
        { kind: 'payable', id: t.id },
      ),
    ),
    chart: null,
    notes: ['Títulos pela data de vencimento. Vencido é derivado da data e do saldo em aberto.'],
  };
}

async function payablesBySupplier(env: ManagementReportEnv, query: ReportQuery): Promise<Body> {
  const range = env.period(query, wholeMonth(env));
  const titles = (await payablesDue(env, range, query)).filter((t) => t.status !== 'canceled');
  const groups = new Map<
    string,
    { name: string; id: string | null; count: number; original: number; paid: number; open: number; overdue: number }
  >();
  for (const t of titles) {
    const key = t.beneficiaryId ?? `name:${t.beneficiaryName ?? ''}`;
    const group = groups.get(key) ?? {
      name: t.beneficiaryName ?? 'Sem beneficiário',
      id: t.beneficiaryId,
      count: 0,
      original: 0,
      paid: 0,
      open: 0,
      overdue: 0,
    };
    group.count++;
    group.original += t.originalCents;
    group.paid += t.paidCents;
    group.open += t.outstandingCents;
    if (t.dueDate < env.today) group.overdue += t.outstandingCents;
    groups.set(key, group);
  }
  return {
    period: { ...range, basis: 'Data de vencimento' },
    summary: [
      metric('suppliers', 'Fornecedores e beneficiários', 'count', groups.size),
      metric('open', 'Em aberto', 'money', sum([...groups.values()], (g) => g.open)),
      metric('overdue', 'Vencido', 'money', sum([...groups.values()], (g) => g.overdue), {
        tone: [...groups.values()].some((g) => g.overdue) ? 'danger' : 'default',
      }),
    ],
    columns: [
      column('name', 'Fornecedor ou beneficiário', 'text'),
      column('count', 'Títulos', 'count'),
      column('original', 'Valor', 'money'),
      column('paid', 'Pago', 'money'),
      column('open', 'Em aberto', 'money'),
      column('overdue', 'Vencido', 'money'),
    ],
    rows: [...groups.values()]
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, 'pt-BR'))
      .map((g) =>
        row(
          {
            name: g.name,
            count: g.count,
            original: g.original,
            paid: g.paid,
            open: g.open,
            overdue: g.overdue,
          },
          g.id ? { kind: 'customer', id: g.id } : null,
        ),
      ),
    chart: null,
    notes: ['Títulos cancelados ficam de fora.'],
  };
}

async function payablesOverdue(env: ManagementReportEnv, query: ReportQuery): Promise<Body> {
  const yesterday = addDays(env.today, -1);
  const range = env.period(query, { from: addDays(env.today, -365), to: yesterday }, { max: yesterday });
  const titles = (await payablesDue(env, range, query)).filter((t) => t.hasBalance);
  const late = (t: { dueDate: string }) => daysBetween(t.dueDate, env.today);
  return {
    period: { ...range, basis: 'Data de vencimento' },
    summary: [
      metric('value', 'Valor vencido', 'money', sum(titles, (t) => t.outstandingCents), {
        tone: titles.length ? 'danger' : 'default',
      }),
      metric('titles', 'Títulos vencidos', 'count', titles.length),
      metric('late', 'Maior atraso (dias)', 'count', Math.max(0, ...titles.map(late))),
    ],
    columns: [
      column('due', 'Vencimento', 'date'),
      column('description', 'Descrição', 'text'),
      column('beneficiary', 'Fornecedor ou beneficiário', 'text'),
      column('outstanding', 'Em aberto', 'money'),
      column('late', 'Dias em atraso', 'count'),
    ],
    rows: titles.map((t) =>
      row(
        {
          due: t.dueDate,
          description: t.description,
          beneficiary: t.beneficiaryName ?? '—',
          outstanding: t.outstandingCents,
          late: late(t),
        },
        { kind: 'payable', id: t.id },
      ),
    ),
    chart: null,
    notes: ['Títulos com vencimento até ontem e saldo em aberto.'],
  };
}

async function payablePayments(env: ManagementReportEnv, query: ReportQuery): Promise<Body> {
  const range = env.period(query, monthToDate(env));
  const payments = await scanAll(
    env.repo,
    env.tx,
    env.repo
      .ref(env.tenantId, 'payablePayments', 'placeholder')
      .parent.where('paidOn', '>=', range.from)
      .where('paidOn', '<=', range.to)
      .orderBy('paidOn'),
    s.payablePaymentSchema,
    MANAGEMENT_CAPS.payments,
    'pagamentos',
  );
  const active = payments.filter((p) => p.status === 'active');
  return {
    period: { ...range, basis: 'Data do pagamento' },
    summary: [
      metric('cash', 'Pago', 'money', sum(active, (p) => p.cashCents), { tone: 'success' }),
      metric('interest', 'Juros e multas', 'money', sum(active, (p) => p.interestCents + p.penaltyCents)),
      metric('discount', 'Descontos obtidos', 'money', sum(active, (p) => p.discountCents)),
      metric('reversed', 'Estornado', 'money', sum(payments, (p) => (p.status === 'reversed' ? p.cashCents : 0))),
    ],
    columns: [
      column('date', 'Data', 'date'),
      column('description', 'Descrição', 'text'),
      column('beneficiary', 'Fornecedor ou beneficiário', 'text'),
      column('method', 'Forma', 'text'),
      column('principal', 'Abatido do título', 'money'),
      column('extras', 'Juros e multas', 'money'),
      column('discount', 'Desconto', 'money'),
      column('cash', 'Pago', 'money'),
      column('status', 'Situação', 'text'),
    ],
    rows: payments
      .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.recordedAt.localeCompare(a.recordedAt))
      .map((p) =>
        row(
          {
            date: p.paidOn,
            description: p.description,
            beneficiary: p.beneficiaryName ?? '—',
            method: p.method.name,
            principal: p.principalCents,
            extras: p.interestCents + p.penaltyCents,
            discount: p.discountCents,
            cash: p.cashCents,
            status: p.status === 'active' ? 'Pago' : 'Estornado',
          },
          { kind: 'payable', id: p.payableId },
        ),
      ),
    chart: null,
    notes: ['Somente dinheiro registrado como pago. Estornos ficam listados e não somam no total.'],
  };
}

async function purchasesIn(env: ManagementReportEnv, range: Range, query: ReportQuery) {
  const purchases = await scanAll(
    env.repo,
    env.tx,
    env.repo
      .ref(env.tenantId, 'purchases', 'placeholder')
      .parent.where('purchaseDate', '>=', range.from)
      .where('purchaseDate', '<=', range.to)
      .orderBy('purchaseDate'),
    s.purchaseSchema,
    MANAGEMENT_CAPS.purchases,
    'compras',
  );
  return purchases.filter(
    (p) =>
      p.status !== 'draft' &&
      p.status !== 'canceled' &&
      (!query.supplierId || p.supplierId === query.supplierId) &&
      (!query.productId || p.lines.some((l) => l.productId === query.productId)),
  );
}

async function purchasesBySupplier(env: ManagementReportEnv, query: ReportQuery): Promise<Body> {
  const range = env.period(query, monthToDate(env));
  const purchases = await purchasesIn(env, range, query);
  const groups = new Map<
    string,
    { name: string; count: number; total: number; received: number; undelivered: number }
  >();
  for (const p of purchases) {
    const key = p.supplierId ?? 'none';
    const group = groups.get(key) ?? {
      name: p.supplierName ?? 'Sem fornecedor',
      count: 0,
      total: 0,
      received: 0,
      undelivered: 0,
    };
    group.count++;
    group.total += p.totalCents;
    group.received += sum(p.lines, (l) => l.receivedValueCents);
    group.undelivered += p.closure?.undeliveredValueCents ?? 0;
    groups.set(key, group);
  }
  const total = sum([...groups.values()], (g) => g.total);
  return {
    period: { ...range, basis: 'Data da compra' },
    summary: [
      metric('total', 'Total comprado', 'money', total),
      metric('purchases', 'Compras', 'count', purchases.length),
      metric('suppliers', 'Fornecedores', 'count', groups.size),
      metric('received', 'Valor já recebido', 'money', sum([...groups.values()], (g) => g.received)),
      metric(
        'undelivered',
        'Não entregue',
        'money',
        sum([...groups.values()], (g) => g.undelivered),
      ),
    ],
    columns: [
      column('supplier', 'Fornecedor', 'text'),
      column('count', 'Compras', 'count'),
      column('total', 'Total comprado', 'money'),
      column('received', 'Valor recebido', 'money'),
      column('undelivered', 'Não entregue', 'money'),
      column('share', '% das compras', 'percent'),
    ],
    rows: [...groups]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([id, g]) =>
        row(
          {
            supplier: g.name,
            count: g.count,
            total: g.total,
            received: g.received,
            undelivered: g.undelivered,
            share: total > 0 ? Math.round((g.total * 1000) / total) / 10 : 0,
          },
          id === 'none' ? null : { kind: 'customer', id },
        ),
      ),
    chart: null,
    notes: [
      'Compras confirmadas pela data da compra, com frete, despesas e descontos.',
      'O total mostra o valor comprado. Compras encerradas têm a parte não entregue em coluna própria.',
    ],
  };
}

async function purchasesByProduct(env: ManagementReportEnv, query: ReportQuery): Promise<Body> {
  const range = env.period(query, monthToDate(env));
  const purchases = await purchasesIn(env, range, query);
  const groups = new Map<
    string,
    {
      name: string;
      sku: string;
      unit: string;
      quantity: number;
      received: number;
      undelivered: number;
      landed: number;
    }
  >();
  for (const p of purchases)
    for (const l of p.lines) {
      if (query.productId && l.productId !== query.productId) continue;
      const group = groups.get(l.productId) ?? {
        name: l.name,
        sku: l.sku,
        unit: l.unit,
        quantity: 0,
        received: 0,
        undelivered: 0,
        landed: 0,
      };
      group.quantity += parseQuantity(l.quantity, l.unit);
      group.received += parseQuantity(l.receivedQuantity, l.unit);
      group.undelivered += parseQuantity(l.undeliveredQuantity, l.unit);
      group.landed += l.landedCents;
      groups.set(l.productId, group);
    }
  return {
    period: { ...range, basis: 'Data da compra' },
    summary: [
      metric('total', 'Valor apropriado', 'money', sum([...groups.values()], (g) => g.landed)),
      metric('products', 'Produtos', 'count', groups.size),
      metric('purchases', 'Compras', 'count', purchases.length),
    ],
    columns: [
      column('product', 'Produto', 'text'),
      column('sku', 'SKU', 'text'),
      column('quantity', 'Comprado', 'quantity'),
      column('received', 'Recebido', 'quantity'),
      column('undelivered', 'Não entregue', 'quantity'),
      column('unit', 'Custo médio da compra', 'money'),
      column('landed', 'Valor apropriado', 'money'),
    ],
    rows: [...groups]
      .sort((a, b) => b[1].landed - a[1].landed)
      .map(([id, g]) =>
        row(
          {
            product: g.name,
            sku: g.sku,
            quantity: formatQuantity(g.quantity),
            received: formatQuantity(g.received),
            undelivered: formatQuantity(g.undelivered),
            unit: g.quantity > 0 ? Math.round((g.landed * 1000) / g.quantity) : 0,
            landed: g.landed,
          },
          { kind: 'product', id },
        ),
      ),
    chart: null,
    notes: ['Valor apropriado inclui a parte de frete, despesas e descontos da compra em cada item.'],
  };
}

async function costEvolution(env: ManagementReportEnv, query: ReportQuery): Promise<Body> {
  const range = env.period(query, monthToDate(env));
  const events = (
    await scanAll(
      env.repo,
      env.tx,
      env.repo
        .ref(env.tenantId, 'productCostEvents', 'placeholder')
        .parent.where('occurredAt', '>=', env.zonedStart(range.from, env.timezone))
        .where('occurredAt', '<', env.zonedStart(addDays(range.to, 1), env.timezone))
        .orderBy('occurredAt'),
      s.productCostEventSchema,
      MANAGEMENT_CAPS.payables,
      'alterações de custo',
    )
  ).filter((e) => !query.productId || e.productId === query.productId);
  const ids = [...new Set(events.map((e) => e.productId))];
  const refs = ids.map((id) => env.repo.ref(env.tenantId, 'products', id));
  checkReadBudget();
  const products = await env.repo.foundation.readMany(refs, productSchema, env.tx);
  const names = new Map(ids.map((id, index) => [id, products[index]?.name]));
  const name = (id: string) => names.get(id) ?? 'Produto';
  const cents = (milli: number | null) => (milli === null ? null : milliToCents(milli));
  return {
    period: { ...range, basis: 'Data da alteração' },
    summary: [
      metric('events', 'Alterações', 'count', events.length),
      metric('products', 'Produtos', 'count', ids.length),
    ],
    columns: [
      column('date', 'Data', 'datetime'),
      column('product', 'Produto', 'text'),
      column('type', 'Evento', 'text'),
      column('unit', 'Custo da entrada', 'money'),
      column('previous', 'Custo médio anterior', 'money'),
      column('average', 'Custo médio', 'money'),
      column('reference', 'Custo de referência', 'money'),
    ],
    rows: events
      .slice()
      .reverse()
      .map((e) =>
        row(
          {
            date: e.occurredAt,
            product: name(e.productId),
            type: costEventLabel[e.type],
            unit: cents(e.unitCostMilli),
            previous: cents(e.previous.averageCostMilli),
            average: cents(e.next.averageCostMilli),
            reference: e.next.referenceCostCents,
          },
          { kind: 'product', id: e.productId },
        ),
      ),
    chart: query.productId
      ? {
          label: 'Custo médio',
          kind: 'money',
          points: events.map((e) => ({
            label: e.occurredAt.slice(0, 10).split('-').reverse().join('/'),
            value: cents(e.next.averageCostMilli) ?? 0,
          })),
        }
      : null,
    notes: ['Custo médio ponderado móvel. Vendas passadas mantêm o custo registrado na confirmação.'],
  };
}

async function productProfitability(env: ManagementReportEnv, query: ReportQuery): Promise<Body> {
  const range = env.period(query, monthToDate(env));
  const orders = await soldOrders(env, range, env.zonedStart);
  const snapshots = await costSnapshots(env, orders);
  const groups = new Map<
    string,
    { name: string; sku: string; quantity: number; revenue: number; cost: number; costedRevenue: number; missing: number }
  >();
  for (const { line, costCents } of soldLines(orders, snapshots)) {
    if (query.productId && line.productId !== query.productId) continue;
    const group = groups.get(line.productId) ?? {
      name: line.name,
      sku: line.sku,
      quantity: 0,
      revenue: 0,
      cost: 0,
      costedRevenue: 0,
      missing: 0,
    };
    group.quantity += parseQuantity(line.quantity, line.unit);
    group.revenue += line.totalCents;
    if (costCents === null) group.missing += line.totalCents;
    else {
      group.cost += costCents;
      group.costedRevenue += line.totalCents;
    }
    groups.set(line.productId, group);
  }
  const all = [...groups.values()];
  const costedRevenue = sum(all, (g) => g.costedRevenue);
  const cost = sum(all, (g) => g.cost);
  const missing = sum(all, (g) => g.missing);
  return {
    period: { ...range, basis: 'Data de confirmação do pedido' },
    summary: [
      metric('revenue', 'Faturamento', 'money', sum(all, (g) => g.revenue)),
      metric('cogs', 'Custo das mercadorias vendidas', 'money', cost),
      metric('gross', 'Lucro bruto', 'money', costedRevenue - cost, { tone: 'success' }),
      metric('margin', 'Margem bruta', 'percent', percentOf(marginBp(costedRevenue - cost, costedRevenue))),
    ],
    columns: [
      column('product', 'Produto', 'text'),
      column('sku', 'SKU', 'text'),
      column('quantity', 'Vendido', 'quantity'),
      column('revenue', 'Faturamento', 'money'),
      column('cost', 'Custo', 'money'),
      column('gross', 'Lucro bruto', 'money'),
      column('margin', 'Margem bruta', 'percent'),
    ],
    rows: [...groups]
      .sort((a, b) => b[1].costedRevenue - b[1].cost - (a[1].costedRevenue - a[1].cost))
      .map(([id, g]) =>
        row(
          {
            product: g.name,
            sku: g.sku,
            quantity: formatQuantity(g.quantity),
            revenue: g.revenue,
            cost: g.cost,
            gross: g.costedRevenue - g.cost,
            margin: percentOf(marginBp(g.costedRevenue - g.cost, g.costedRevenue)),
          },
          { kind: 'product', id },
        ),
      ),
    chart: null,
    notes: [
      'Custo registrado na confirmação de cada pedido: vendas passadas não mudam com o custo atual.',
      'Margem bruta não é lucro líquido. Devoluções não são descontadas neste relatório.',
      ...(missing > 0
        ? [`Faturamento sem custo registrado, fora da margem: R$ ${(missing / 100).toFixed(2).replace('.', ',')}.`]
        : []),
    ],
  };
}

async function cashFlow(env: ManagementReportEnv, query: ReportQuery): Promise<Body> {
  const range = env.period(query, monthToDate(env));
  const money = await realizedMoney(env, range);
  const points = flowByPeriod(range, money);
  const inflow = sum(points, (p) => p.inflowCents);
  const outflow = sum(points, (p) => p.outflowCents);
  return {
    period: { ...range, basis: 'Data do recebimento ou do pagamento' },
    summary: [
      metric('in', 'Entradas realizadas', 'money', inflow, { tone: 'success' }),
      metric('out', 'Saídas realizadas', 'money', outflow),
      metric('balance', 'Saldo do período', 'money', inflow - outflow, {
        tone: inflow - outflow < 0 ? 'danger' : 'default',
      }),
    ],
    columns: [
      column('period', 'Período', 'text'),
      column('in', 'Entradas', 'money'),
      column('out', 'Saídas', 'money'),
      column('net', 'Saldo', 'money'),
      column('balance', 'Acumulado', 'money'),
    ],
    rows: points.map((p) =>
      row({
        period: p.label,
        in: p.inflowCents,
        out: p.outflowCents,
        net: p.inflowCents - p.outflowCents,
        balance: p.balanceCents,
      }),
    ),
    chart: {
      label: 'Saldo acumulado',
      kind: 'money',
      points: points.map((p) => ({ label: p.label, value: p.balanceCents })),
    },
    notes: [
      'Regime de caixa: somente recebimentos, reembolsos e pagamentos efetivamente registrados.',
      'Títulos ainda não pagos não entram aqui. Para previsão, veja o painel financeiro.',
    ],
  };
}

async function expensesByCategory(env: ManagementReportEnv, query: ReportQuery): Promise<Body> {
  const range = env.period(query, monthToDate(env));
  const titles = (await operatingExpenses(env, range)).filter(
    (t) => !query.categoryId || t.categoryId === query.categoryId,
  );
  const groups = new Map<string, { count: number; total: number; paid: number }>();
  for (const t of titles) {
    const key = t.categoryName ?? 'Sem categoria';
    const group = groups.get(key) ?? { count: 0, total: 0, paid: 0 };
    group.count++;
    group.total += expenseValue(t);
    group.paid += t.paidCents;
    groups.set(key, group);
  }
  const total = sum([...groups.values()], (g) => g.total);
  return {
    period: { ...range, basis: 'Competência da despesa' },
    summary: [
      metric('total', 'Despesas', 'money', total),
      metric('paid', 'Já pago', 'money', sum([...groups.values()], (g) => g.paid), { tone: 'success' }),
      metric('categories', 'Categorias', 'count', groups.size),
    ],
    columns: [
      column('category', 'Categoria', 'text'),
      column('count', 'Lançamentos', 'count'),
      column('total', 'Despesas', 'money'),
      column('paid', 'Pago', 'money'),
      column('share', '% das despesas', 'percent'),
    ],
    rows: [...groups]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([category, g]) =>
        row({
          category,
          count: g.count,
          total: g.total,
          paid: g.paid,
          share: total > 0 ? Math.round((g.total * 1000) / total) / 10 : 0,
        }),
      ),
    chart: null,
    notes: [
      'Despesas avulsas e recorrentes por competência. Compras de mercadorias ficam de fora: seu custo aparece nas mercadorias vendidas.',
      'Lançamentos manuais aparecem nas contas a pagar e no fluxo de caixa, não como despesa operacional.',
    ],
  };
}

export function managementReport(
  env: ManagementReportEnv,
  id: ManagementReportId,
  query: ReportQuery,
): Promise<Body> {
  switch (id) {
    case 'payables-period':
      return payablesPeriod(env, query);
    case 'payables-supplier':
      return payablesBySupplier(env, query);
    case 'payables-overdue':
      return payablesOverdue(env, query);
    case 'payable-payments':
      return payablePayments(env, query);
    case 'purchases-supplier':
      return purchasesBySupplier(env, query);
    case 'purchases-product':
      return purchasesByProduct(env, query);
    case 'cost-evolution':
      return costEvolution(env, query);
    case 'product-profitability':
      return productProfitability(env, query);
    case 'cash-flow':
      return cashFlow(env, query);
    case 'expenses-category':
      return expensesByCategory(env, query);
  }
}
