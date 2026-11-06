import type { Transaction } from 'firebase-admin/firestore';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import {
  bonusCostSnapshotSchema,
  bonusSchema,
  type Bonus,
  type BonusCostSnapshot,
  type BonusLine,
} from '../../shared/schemas/bonuses.js';
import type { ReportQuery, ReportValueKind, ReportView } from '../../shared/schemas/reports.js';
import { checkReadBudget } from '../../shared/operations/readBudget.js';
import { netCost, netScaled } from '../bonuses/calculation.js';
import { orderNumber } from '../documents/pdfLayout.js';
import { scanAll, type Range } from '../finance/managementData.js';
import { formatQuantity, parseQuantity } from '../inventory/quantities.js';
import { addDays } from './dates.js';

export const BONUS_REPORT_CAP = 2500;
export const bonusReasonLabel: Record<NonNullable<Bonus['reason']>, string> = {
  sample: 'Amostra',
  campaign: 'Campanha comercial',
  relationship: 'Relacionamento',
  damage_replacement: 'Reposição de avaria',
  other: 'Outro',
};
export const bonusKindLabel = { order: 'Vinculada', standalone: 'Avulsa' } as const;
const statusLabel = {
  draft: 'Rascunho',
  confirmed: 'Reservada',
  dispatched: 'Saiu do estoque',
  canceled: 'Cancelada',
} as const;

export type BonusReportId =
  | 'bonuses-period'
  | 'bonuses-customers'
  | 'bonuses-sellers'
  | 'bonuses-products'
  | 'bonuses-orders'
  | 'bonuses-reasons';
export const isBonusReport = (id: string): id is BonusReportId => id.startsWith('bonuses-');

export interface BonusReportEnv {
  repo: CommercialRepository;
  tx: Transaction;
  tenantId: string;
  timezone: string;
  /** Seller scope, decided by the server; null for administrators. */
  scope: { uid: string; portfolio: Set<string> } | null;
  /** Cost figures exist only for callers holding `costs:read` on a contract with costs. */
  showCosts: boolean;
  period: Range;
  zonedStart: (date: string, timezone: string) => string;
  people: (uids: string[]) => Promise<Map<string, string>>;
}
type Body = Pick<ReportView, 'period' | 'summary' | 'columns' | 'rows' | 'chart' | 'notes'> & {
  filters?: ReportView['filters'];
};
type Row = ReportView['rows'][number];
type Fact = { bonus: Bonus; line: BonusLine; units: number; returned: number; cost: number | null };

const column = (key: string, label: string, kind: ReportValueKind) => ({
  key,
  label,
  kind,
  align:
    kind === 'text' || kind === 'date' || kind === 'datetime'
      ? ('left' as const)
      : ('right' as const),
});
const metric = (key: string, label: string, kind: ReportValueKind, value: number) => ({
  key,
  label,
  kind,
  value,
  tone: 'default' as const,
  caption: null,
});
const row = (cells: Row['cells'], link: Row['link'] = null): Row => ({ cells, link });
const percent = (part: number, total: number) =>
  total > 0 ? Math.round((part * 1000) / total) / 10 : 0;
const day = (instant: string | null, timezone: string) =>
  instant
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(instant))
    : null;
const sum = <T>(items: readonly T[], value: (item: T) => number) =>
  items.reduce((a, item) => a + value(item), 0);

/** Bonuses granted in the period, inside the caller's scope. Canceled ones never count. */
export async function grantedBonuses(env: BonusReportEnv, query: ReportQuery) {
  const bonuses = await scanAll(
    env.repo,
    env.tx,
    env.repo
      .ref(env.tenantId, 'bonuses', 'placeholder')
      .parent.where('occurredAt', '>=', env.zonedStart(env.period.from, env.timezone))
      .where('occurredAt', '<', env.zonedStart(addDays(env.period.to, 1), env.timezone))
      .orderBy('occurredAt'),
    bonusSchema,
    BONUS_REPORT_CAP,
    'bonificações',
  );
  return bonuses.filter(
    (b) =>
      b.tenantId === env.tenantId &&
      (b.status === 'confirmed' || b.status === 'dispatched') &&
      (!env.scope ||
        (b.responsibleUid === env.scope.uid &&
          b.customerId !== null &&
          env.scope.portfolio.has(b.customerId))) &&
      (!query.customerId || b.customerId === query.customerId) &&
      (!query.sellerUid || b.responsibleUid === query.sellerUid) &&
      (!query.bonusKind || b.kind === query.bonusKind) &&
      (!query.productId || b.lines.some((l) => l.productId === query.productId)),
  );
}

async function costSnapshots(env: BonusReportEnv, bonuses: readonly Bonus[]) {
  const found = new Map<string, BonusCostSnapshot>();
  if (!env.showCosts) return found;
  for (let i = 0; i < bonuses.length; i += 100) {
    checkReadBudget();
    const page = await env.repo.foundation.readMany(
      bonuses
        .slice(i, i + 100)
        .map((b) => env.repo.ref(env.tenantId, 'bonusCostSnapshots', b.id)),
      bonusCostSnapshotSchema,
      env.tx,
    );
    for (const snapshot of page) if (snapshot) found.set(snapshot.bonusId, snapshot);
  }
  return found;
}

/** One row per line; a product filter narrows units and cost to that product. */
function facts(
  bonuses: readonly Bonus[],
  snapshots: Map<string, BonusCostSnapshot>,
  productId?: string,
): Fact[] {
  return bonuses.flatMap((bonus) => {
    const snapshot = snapshots.get(bonus.id);
    const costs = new Map(snapshot ? netCost(bonus, snapshot).lines.map((l) => [l.lineId, l]) : []);
    return bonus.lines
      .filter((line) => !productId || line.productId === productId)
      .map((line) => ({
        bonus,
        line,
        units: netScaled(line),
        returned:
          parseQuantity(line.returnedSellable, line.unit) +
          parseQuantity(line.returnedDamaged, line.unit),
        cost: costs.get(line.id)?.costCents ?? null,
      }));
  });
}

function summary(env: BonusReportEnv, bonuses: readonly Bonus[], rows: readonly Fact[]) {
  return [
    metric('bonuses', 'Bonificações', 'count', bonuses.length),
    metric('standalone', 'Avulsas', 'count', bonuses.filter((b) => b.kind === 'standalone').length),
    metric('linked', 'Vinculadas', 'count', bonuses.filter((b) => b.kind === 'order').length),
    metric('units', 'Unidades', 'quantity', 0),
    ...(env.showCosts
      ? [metric('cost', 'Custo total', 'money', sum(rows, (r) => r.cost ?? 0))]
      : []),
  ].map((m) => (m.key === 'units' ? { ...m, value: sum(rows, (r) => r.units) / 1000 } : m));
}

function notes(env: BonusReportEnv, rows: readonly Fact[], extra: string[] = []) {
  const missing = new Set(rows.filter((r) => r.cost === null).map((r) => r.bonus.id)).size;
  return [
    'Bonificações não geram faturamento nem contas a receber. Vinculadas contam pela confirmação do pedido; avulsas, pelo registro. Canceladas não entram.',
    'Unidades somam as quantidades de todas as medidas e descontam só os retornos vendáveis.',
    ...(env.showCosts && missing
      ? [`${missing} bonificação(ões) sem custo registrado ficam fora do custo total.`]
      : []),
    ...extra,
  ];
}

const costColumn = (env: BonusReportEnv) =>
  env.showCosts ? [column('cost', 'Custo', 'money')] : [];

interface Group {
  name: string;
  extra?: string;
  bonuses: Set<string>;
  standalone: Set<string>;
  linked: Set<string>;
  units: number;
  cost: number;
}
function grouped(rows: readonly Fact[], keyOf: (fact: Fact) => string, nameOf: (fact: Fact) => string) {
  const groups = new Map<string, Group>();
  for (const fact of rows) {
    const key = keyOf(fact);
    const group = groups.get(key) ?? {
      name: nameOf(fact),
      bonuses: new Set<string>(),
      standalone: new Set<string>(),
      linked: new Set<string>(),
      units: 0,
      cost: 0,
    };
    group.bonuses.add(fact.bonus.id);
    (fact.bonus.kind === 'order' ? group.linked : group.standalone).add(fact.bonus.id);
    group.units += fact.units;
    group.cost += fact.cost ?? 0;
    groups.set(key, group);
  }
  return [...groups].sort((a, b) => b[1].units - a[1].units);
}
const groupCells = (env: BonusReportEnv, g: Group) => ({
  bonuses: g.bonuses.size,
  standalone: g.standalone.size,
  linked: g.linked.size,
  units: formatQuantity(g.units),
  ...(env.showCosts ? { cost: g.cost } : {}),
});
const groupColumns = (env: BonusReportEnv) => [
  column('bonuses', 'Bonificações', 'count'),
  column('standalone', 'Avulsas', 'count'),
  column('linked', 'Vinculadas', 'count'),
  column('units', 'Unidades', 'quantity'),
  ...costColumn(env),
];

export async function bonusReport(
  env: BonusReportEnv,
  id: BonusReportId,
  query: ReportQuery,
): Promise<Body> {
  const scoped = await grantedBonuses(env, query);
  const bonuses =
    id === 'bonuses-orders'
      ? scoped.filter((b) => b.kind === 'order')
      : id === 'bonuses-reasons'
        ? scoped.filter((b) => b.kind === 'standalone')
        : scoped;
  const snapshots = await costSnapshots(env, bonuses);
  const rows = facts(bonuses, snapshots, query.productId);
  const base = {
    period: { ...env.period, basis: 'Data da confirmação ou do registro' },
    summary: summary(env, bonuses, rows),
    chart: null,
  };
  const names = await env.people([...new Set(bonuses.map((b) => b.responsibleUid))]);
  const person = (uid: string) => names.get(uid) ?? 'Usuário sem nome';
  const byBonus = (bonus: Bonus) => rows.filter((r) => r.bonus.id === bonus.id);
  switch (id) {
    case 'bonuses-period':
      return {
        ...base,
        columns: [
          column('date', 'Data', 'date'),
          column('number', 'Número', 'text'),
          column('kind', 'Tipo', 'text'),
          column('customer', 'Cliente', 'text'),
          column('responsible', 'Responsável', 'text'),
          column('reason', 'Motivo', 'text'),
          column('units', 'Unidades', 'quantity'),
          column('returned', 'Retornadas', 'quantity'),
          ...costColumn(env),
        ],
        rows: [...bonuses].reverse().map((bonus) => {
          const lines = byBonus(bonus);
          return row(
            {
              date: day(bonus.occurredAt, env.timezone),
              number: orderNumber(bonus.commercialId),
              kind: bonusKindLabel[bonus.kind],
              customer: bonus.customerName ?? 'Cliente',
              responsible: person(bonus.responsibleUid),
              reason: bonus.reason ? bonusReasonLabel[bonus.reason] : '',
              units: formatQuantity(sum(lines, (l) => l.units)),
              returned: formatQuantity(sum(lines, (l) => l.returned)),
              ...(env.showCosts ? { cost: sum(lines, (l) => l.cost ?? 0) } : {}),
            },
            { kind: 'bonus', id: bonus.id },
          );
        }),
        notes: notes(env, rows),
      };
    case 'bonuses-customers':
      return {
        ...base,
        columns: [column('customer', 'Cliente', 'text'), ...groupColumns(env)],
        rows: grouped(
          rows,
          (r) => r.bonus.customerId!,
          (r) => r.bonus.customerName ?? 'Cliente',
        ).map(([key, g]) =>
          row({ customer: g.name, ...groupCells(env, g) }, { kind: 'customer', id: key }),
        ),
        notes: notes(env, rows),
      };
    case 'bonuses-sellers':
      return {
        ...base,
        columns: [column('responsible', 'Responsável', 'text'), ...groupColumns(env)],
        rows: grouped(
          rows,
          (r) => r.bonus.responsibleUid,
          (r) => person(r.bonus.responsibleUid),
        ).map(([, g]) => row({ responsible: g.name, ...groupCells(env, g) })),
        notes: notes(env, rows),
      };
    case 'bonuses-products':
      return {
        ...base,
        columns: [
          column('product', 'Produto', 'text'),
          column('sku', 'SKU', 'text'),
          column('unit', 'Medida', 'text'),
          ...groupColumns(env),
        ],
        rows: grouped(
          rows,
          (r) => r.line.productId,
          (r) => r.line.name,
        ).map(([key, g]) => {
          const line = rows.find((r) => r.line.productId === key)!.line;
          return row(
            { product: g.name, sku: line.sku, unit: line.unit, ...groupCells(env, g) },
            { kind: 'product', id: key },
          );
        }),
        notes: notes(env, rows),
      };
    case 'bonuses-orders':
      return {
        ...base,
        columns: [
          column('order', 'Pedido', 'text'),
          column('number', 'Bonificação', 'text'),
          column('date', 'Confirmação', 'date'),
          column('customer', 'Cliente', 'text'),
          column('responsible', 'Responsável', 'text'),
          column('status', 'Situação', 'text'),
          column('units', 'Unidades', 'quantity'),
          ...costColumn(env),
        ],
        rows: [...bonuses].reverse().map((bonus) => {
          const lines = byBonus(bonus);
          return row(
            {
              order: orderNumber(bonus.orderCommercialId!),
              number: orderNumber(bonus.commercialId),
              date: day(bonus.occurredAt, env.timezone),
              customer: bonus.customerName ?? 'Cliente',
              responsible: person(bonus.responsibleUid),
              status: statusLabel[bonus.status],
              units: formatQuantity(sum(lines, (l) => l.units)),
              ...(env.showCosts ? { cost: sum(lines, (l) => l.cost ?? 0) } : {}),
            },
            { kind: 'order', id: bonus.orderId! },
          );
        }),
        notes: notes(env, rows),
      };
    case 'bonuses-reasons': {
      const total = sum(rows, (r) => r.units);
      return {
        ...base,
        columns: [
          column('reason', 'Motivo', 'text'),
          column('bonuses', 'Bonificações', 'count'),
          column('units', 'Unidades', 'quantity'),
          ...costColumn(env),
          column('share', '% das unidades', 'percent'),
        ],
        rows: grouped(
          rows,
          (r) => r.bonus.reason!,
          (r) => bonusReasonLabel[r.bonus.reason!],
        ).map(([, g]) =>
          row({
            reason: g.name,
            bonuses: g.bonuses.size,
            units: formatQuantity(g.units),
            ...(env.showCosts ? { cost: g.cost } : {}),
            share: percent(g.units, total),
          }),
        ),
        notes: notes(env, rows, ['Somente bonificações avulsas: na vinculada, o motivo é opcional.']),
      };
    }
  }
}
