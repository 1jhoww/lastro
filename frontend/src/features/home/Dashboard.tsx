import type { ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Order, Receivable, StockAdmin } from '@/api/types';
import { canReadFinance } from '@/features/finance/FinanceAccess';
import { DueBadge, RowLink } from '@/features/finance/FinanceParts';
import { useFinanceOverview } from '@/features/finance/api';
import { summarizeTitles } from '@/features/finance/overview';
import { formatDate, installmentLabel, orderCode } from '@/features/finance/presentation';
import { useReplenishment } from '@/features/inventory/api';
import { qty } from '@/features/inventory/StockParts';
import { useOrderList } from '@/features/orders/api';
import { shortOrderId, statusLabel, todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { firstNameOf } from '@/features/session/profile';
import { useDailyPhrase } from './dailyPhrase';
import { Screen } from '@/layout/Screen';
import { addDays } from '@/lib/calendar';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { fromApiQuantity } from '@/lib/quantity';
import { canCreateOrder } from '@/navigation/destinations';
import { useSession } from '@/session/SessionContext';
import { color, radius, space, useLayoutSize } from '@/theme';
import { Badge, Button, Skeleton, Text } from '@/ui';
import {
  CircleAlert,
  CircleDollarSign,
  ClipboardList,
  PackageOpen,
  Plus,
  Truck,
  type LucideIcon,
} from '@/ui/icons';

/** Página lida por completo? Senão, o número é "pelo menos N" e assim é mostrado. */
const countOf = (n: number, more: boolean) => (more ? `${n}+` : String(n));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const SCAN = 50;

/** Resumo operacional com os mesmos dados e limites de leitura dos módulos de origem. */
export function Dashboard() {
  const session = useSession();
  const { permissions } = session;
  const firstName = firstNameOf(session.me?.name);
  const phrase = useDailyPhrase();
  const tenant = useTenant();
  const size = useLayoutSize();
  const wide = size === 'expanded';
  const today = tenant.data ? todayIn(tenant.data.timezone) : null;
  const seesOrders = permissions.includes('orders:own:read') || permissions.includes('orders:all:manage');
  const seesInventory = permissions.includes('inventory:manage');
  const seesFinance = canReadFinance(session);
  const drafts = useOrderList({ direction: 'desc', status: 'draft' }, SCAN, seesOrders);
  const waiting = useOrderList({ direction: 'asc', status: 'confirmed' }, SCAN, seesOrders);
  const recent = useOrderList({ direction: 'desc' }, 6, seesOrders);
  const stock = useReplenishment({ q: '', status: 'active', sort: 'shortfall' }, SCAN, seesInventory);
  const finance = useFinanceOverview();
  const titles = finance.data && today ? summarizeTitles(finance.data.titles, today) : null;
  const soonEnd = today ? addDays(today, 7) : null;
  const dueItems = finance.data && today && soonEnd
    ? finance.data.titles.items.filter((t) => t.outstandingCents > 0 && t.dueDate <= soonEnd)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    : [];
  const overdue = dueItems.filter((t) => today && t.dueDate < today);
  const upcoming = dueItems.filter((t) => today && t.dueDate >= today);
  const waitingCount = countOf(waiting.items.length, !!waiting.query.hasNextPage);
  const stockCount = countOf(stock.items.length, !!stock.query.hasNextPage);
  const kpis: ReactNode[] = [];
  if (seesOrders) kpis.push(
    <Kpi key="drafts" icon={ClipboardList} label="Pedidos em aberto"
      value={drafts.query.isError ? '—' : drafts.query.isPending ? null : countOf(drafts.items.length, !!drafts.query.hasNextPage)}
      caption={drafts.query.isError ? 'Consulte a lista de pedidos' : 'Rascunhos a confirmar'}
      href={'/pedidos?situacao=draft' as Href} />,
    <Kpi key="waiting" icon={Truck} label="Aguardando saída"
      tone={!waiting.query.isError && waiting.items.length ? 'warning' : 'default'}
      value={waiting.query.isError ? '—' : waiting.query.isPending ? null : waitingCount}
      caption={waiting.query.isError ? 'Consulte os pedidos confirmados' : 'Confirmados, com estoque reservado'}
      href={'/pedidos?situacao=confirmed' as Href} />,
  );
  if (seesFinance) kpis.push(
    <Kpi key="open" icon={CircleDollarSign} label="A receber"
      value={finance.isError ? '—' : finance.isPending || tenant.isPending ? null : titles?.open ? formatCents(titles.open.cents) : '—'}
      caption={finance.isError || tenant.isError ? 'Não foi possível atualizar' : titles?.open ? plural(titles.open.count, 'parcela em aberto', 'parcelas em aberto') : 'Consulte o total no Financeiro'}
      href={'/financeiro/receber' as Href} />,
    <Kpi key="overdue" icon={CircleAlert} label="Vencidas"
      tone={!finance.isError && titles?.overdue?.count ? 'danger' : 'default'}
      value={finance.isError ? '—' : finance.isPending || tenant.isPending ? null : titles?.overdue ? formatCents(titles.overdue.cents) : '—'}
      caption={finance.isError || tenant.isError ? 'Não foi possível atualizar' : titles?.overdue ? plural(titles.overdue.count, 'parcela vencida', 'parcelas vencidas') : 'Consulte as parcelas vencidas'}
      href={'/financeiro/receber?situacao=overdue' as Href} />,
  );

  const priorities: ReactNode[] = [];
  if (seesFinance && (finance.isPending || tenant.isPending || finance.isError || tenant.isError || overdue.length || !titles?.overdue)) {
    priorities.push(
      <Block key="overdue" title="Recebimentos vencidos" tone={overdue.length && !finance.isError ? 'danger' : 'default'}
        description={titles?.overdue?.count ? plural(titles.overdue.count, 'parcela para cobrar', 'parcelas para cobrar') : 'Confira os valores que precisam de cobrança.'}
        action={{ label: 'Ver vencidas', href: '/financeiro/receber?situacao=overdue' as Href }}
        loading={finance.isPending || tenant.isPending} error={finance.isError || tenant.isError}
        onRetry={() => { void finance.refetch(); void tenant.refetch(); }}
        count={overdue.length} empty="A leitura não cobre todos os vencimentos. Consulte o Financeiro.">
        {overdue.slice(0, 4).map((t) => <DueRow key={t.id} title={t} today={today} />)}
        {!titles?.overdue && overdue.length > 0 ? <Text variant="caption" color={color.textSecondary}>Lista parcial. Abra o Financeiro para consultar todas as parcelas.</Text> : null}
      </Block>,
    );
  }
  if (seesOrders && (waiting.query.isPending || waiting.query.isError || waiting.items.length)) {
    priorities.push(
      <Block key="waiting" title="Pedidos aguardando saída" tone={waiting.items.length && !waiting.query.isError ? 'warning' : 'default'}
        description={waiting.items.length ? waitingCount + ' para preparar · mais antigos primeiro' : undefined}
        action={{ label: 'Ver pedidos', href: '/pedidos?situacao=confirmed' as Href }}
        loading={waiting.query.isPending} error={waiting.query.isError} onRetry={() => void waiting.query.refetch()}
        count={waiting.items.length} empty="Nenhum pedido aguardando saída.">
        {waiting.items.slice(0, 4).map((o) => <OrderRow key={o.id} order={o} date={o.confirmedAt ?? o.createdAt} />)}
      </Block>,
    );
  }
  const stockNeedsAttention = seesInventory && (stock.query.isPending || stock.query.isError || stock.items.length > 0);
  const hasAttention = priorities.length > 0 || stockNeedsAttention;

  return (
    <Screen title={firstName ? 'Olá, ' + firstName + '!' : 'Olá!'}
      description={phrase} alignActionsEnd
      actions={canCreateOrder(permissions) ? (
        <Link href="/pedidos/novo" asChild>
          <Button label="Novo pedido" icon={Plus} variant="strong" fullWidth={size === 'compact'} />
        </Link>
      ) : null}>
      {kpis.length ? <View style={styles.kpis}>
        {kpis.map((k, i) => <View key={i} style={[styles.kpiCell,
          { width: wide ? (100 / kpis.length + '%') as `${number}%` : size === 'compact' ? '100%' : '50%' }]}>{k}</View>)}
      </View> : null}

      {hasAttention ? <View style={styles.area}>
        <Text variant="h3" accessibilityRole="header">O que precisa de atenção</Text>
        {priorities.length ? <View style={[styles.blocks, wide && styles.blocksWide]}>
          {priorities.map((block, i) => <View key={i} style={wide ? styles.priorityColumn : undefined}>{block}</View>)}
        </View> : null}
        {stockNeedsAttention ? <View style={styles.stockNotice}>
          <View style={styles.noticeHead}>
            <PackageOpen size={18} color={color.warning} />
            <View style={styles.flex}>
              <Text variant="smallStrong">Estoque baixo</Text>
              <Text variant="caption" color={color.textSecondary}>
                {stock.query.isError ? 'Não foi possível consultar o estoque.' : stock.query.isPending ? 'Consultando produtos…' : stockCount + (stock.items.length === 1 && !stock.query.hasNextPage ? ' produto abaixo do mínimo' : ' produtos abaixo do mínimo')}
              </Text>
            </View>
            {stock.query.isError ? <Button label="Tentar novamente" size="sm" variant="ghost" onPress={() => stock.query.refetch()} /> :
              <Link href={'/estoque/reposicao' as Href} asChild><Button label="Ver estoque" size="sm" variant="ghost" /></Link>}
          </View>
          {!stock.query.isPending && !stock.query.isError ? stock.items.slice(0, 2).map((s) => <StockRow key={s.productId} item={s} />) : null}
        </View> : null}
      </View> : seesOrders || seesFinance || seesInventory ?
        <Text variant="small" color={color.textSecondary}>Nenhuma pendência operacional encontrada nas consultas disponíveis.</Text> : null}

      <View style={[styles.blocks, wide && styles.blocksWide]}>
      {seesFinance ? <View style={wide ? styles.priorityColumn : undefined}><Block title="Próximos 7 dias" quiet
        description="Recebimentos de hoje e dos próximos sete dias."
        action={{ label: 'Contas a receber', href: '/financeiro/receber' as Href }}
        loading={finance.isPending || tenant.isPending} error={finance.isError || tenant.isError}
        onRetry={() => { void finance.refetch(); void tenant.refetch(); }}
        count={upcoming.length} empty={titles?.dueSoon ? 'Nenhum recebimento previsto neste período.' : 'Consulte o Financeiro para conferir os próximos vencimentos.'}>
        {upcoming.slice(0, 4).map((t) => <DueRow key={t.id} title={t} today={today} />)}
        {!titles?.dueSoon && upcoming.length > 0 ? <Text variant="caption" color={color.textSecondary}>Lista parcial. Consulte os demais vencimentos no Financeiro.</Text> : null}
      </Block></View> : null}

      {seesOrders ? <View style={[styles.recent, wide && styles.priorityColumn]}>
        <Block title="Atividade recente" quiet description="Últimos pedidos criados"
          action={{ label: 'Ver pedidos', href: '/pedidos' as Href }}
          loading={recent.query.isPending} error={recent.query.isError} onRetry={() => void recent.query.refetch()}
          count={recent.items.length} empty={canCreateOrder(permissions) ? 'Nenhum pedido ainda. Comece em “Novo pedido”.' : 'Nenhum pedido disponível para consultar.'}>
          {recent.items.map((o) => <OrderRow key={o.id} order={o} date={o.createdAt} withStatus />)}
        </Block>
      </View> : null}
      </View>
    </Screen>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  caption,
  href,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  /** null = carregando. */
  value: string | null;
  caption: string;
  href: Href;
  tone?: 'default' | 'danger' | 'warning';
}) {
  return (
    <RowLink href={href} label={`${label}: ${value ?? 'carregando'}`}>
      <View style={[styles.kpi, tone === 'danger' && styles.kpiDanger, tone === 'warning' && styles.kpiWarning]}>
        <View style={styles.kpiHead}>
          <Text variant="smallStrong" color={color.textSecondary} style={styles.flex}>
            {label}
          </Text>
          <Icon size={16} strokeWidth={1.75} color={tone === 'danger' ? color.danger : tone === 'warning' ? color.warning : color.textSecondary} />
        </View>
        {value === null ? (
          <Skeleton height={28} width="50%" />
        ) : (
          <Text
            variant="figureLarge"
            style={styles.kpiValue}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
            numberOfLines={1}
            color={
              tone === 'danger' ? color.danger : tone === 'warning' ? color.warning : color.text
            }
          >
            {value}
          </Text>
        )}
        <Text variant="caption" color={color.textSecondary}>
          {caption}
        </Text>
      </View>
    </RowLink>
  );
}

function Block({
  title,
  action,
  loading,
  error,
  empty,
  count,
  children,
  description,
  tone = 'default',
  quiet = false,
  onRetry,
}: {
  title: string;
  action?: { label: string; href: Href };
  loading: boolean;
  error: boolean;
  empty: string;
  count: number;
  children: ReactNode;
  description?: string;
  tone?: 'default' | 'danger' | 'warning';
  quiet?: boolean;
  onRetry?: () => void;
}) {
  return (
    <View style={[styles.block, quiet && styles.quietBlock, tone === 'danger' && styles.blockDanger, tone === 'warning' && styles.blockWarning]}>
      <View style={styles.blockHead}>
        <View style={styles.flex}>
        <Text variant={quiet ? 'smallStrong' : 'h3'} accessibilityRole="header"
          color={tone === 'danger' ? color.danger : color.text}>
          {title}
        </Text>
        {description ? <Text variant="caption" color={color.textSecondary}>{description}</Text> : null}
        </View>
        {action ? (
          <Link href={action.href} asChild>
            <Button label={action.label} size="sm" variant="ghost" />
          </Link>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.loading}>
          <Skeleton height={16} />
          <Skeleton height={16} width="70%" />
        </View>
      ) : error ? (
        <View style={styles.errorRow}>
        <Text variant="small" color={color.textSecondary} style={styles.message}>
          Não foi possível atualizar esta seção.
        </Text>
        {onRetry ? <Button label="Tentar novamente" size="sm" variant="ghost" onPress={onRetry} /> : null}
        </View>
      ) : count === 0 ? (
        <Text variant="small" color={color.textSecondary} style={styles.message}>
          {empty}
        </Text>
      ) : (
        <View>{children}</View>
      )}
    </View>
  );
}

function StockRow({ item: s }: { item: StockAdmin }) {
  const critical = fromApiQuantity(s.available) <= 0;
  const compact = useLayoutSize() === 'compact';
  return (
    <RowLink href={`/estoque/${s.productId}` as Href}>
      <View style={[styles.row, compact && styles.rowCompact]}>
        {!compact ? <View style={[styles.marker, critical && styles.markerCritical]} /> : null}
        <View style={compact ? styles.compactText : styles.flex}>
          <Text variant="smallStrong" numberOfLines={1}>
            {s.name}
          </Text>
          <Text variant="caption" color={color.textSecondary}>
            {`Disponível ${qty(s.available, s.unit)} · mínimo ${qty(s.minimumStock, s.unit)}`}
          </Text>
        </View>
        {critical ? (
          <Badge label="Sem disponível" tone="danger" />
        ) : (
          <Text variant="smallStrong" color={color.warning}>
            {`Faltam ${qty(s.suggestedQuantity, s.unit)}`}
          </Text>
        )}
      </View>
    </RowLink>
  );
}

function OrderRow({
  order: o,
  date,
  withStatus,
}: {
  order: Order;
  date: string;
  withStatus?: boolean;
}) {
  const compact = useLayoutSize() === 'compact';
  return (
    <RowLink href={`/pedidos/${o.id}` as Href}>
      <View style={[styles.row, compact && styles.rowCompact]}>
        <View style={compact ? styles.compactText : styles.flex}>
          <Text variant="smallStrong" numberOfLines={1}>
            {o.customerName ?? 'Sem cliente'}
          </Text>
          <Text variant="caption" color={color.textSecondary}>
            {`${shortOrderId(o.commercialId)} · ${formatDateTime(date)}`}
          </Text>
        </View>
        <View style={[styles.right, compact && styles.rowFooter]}>
          <Text variant="figure">{formatCents(o.totalCents)}</Text>
          {withStatus ? <Text variant="caption" color={color.textSecondary}>{statusLabel[o.status]}</Text> : <Text variant="caption" color={color.warning}>Abrir pedido →</Text>}
        </View>
      </View>
    </RowLink>
  );
}

function DueRow({ title: t, today }: { title: Receivable; today: string | null }) {
  const compact = useLayoutSize() === 'compact';
  const overdue = Boolean(today && t.dueDate < today);
  return (
    <RowLink href={`/financeiro/${t.id}` as Href}>
      <View style={[styles.row, compact && styles.rowCompact]}>
        <View style={compact ? styles.compactText : styles.flex}>
          <Text variant="smallStrong" numberOfLines={1}>
            {t.customerName}
          </Text>
          <Text variant="caption" color={color.textSecondary}>
            {`${orderCode(t.orderId)} · ${installmentLabel(t.installmentNumber)} · ${formatDate(t.dueDate)}`}
          </Text>
        </View>
        <View style={[styles.right, compact && styles.rowFooter]}>
          <Text variant="figure" color={overdue ? color.danger : color.text}>{formatCents(t.outstandingCents)}</Text>
          <DueBadge title={t} today={today} />
        </View>
      </View>
    </RowLink>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  kpis: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  kpiCell: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.border,
    marginRight: -1,
    marginBottom: -1,
  },
  kpi: { gap: space[2], paddingHorizontal: space[4], paddingVertical: space[4], borderTopWidth: 3, borderTopColor: 'transparent' },
  kpiValue: { fontSize: 26, lineHeight: 32 },
  kpiDanger: { borderTopColor: color.danger },
  kpiWarning: { borderTopColor: color.accent },
  kpiHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 36 },
  area: { gap: space[3] },
  blocks: { gap: space[4] },
  blocksWide: { flexDirection: 'row', alignItems: 'flex-start' },
  priorityColumn: { flex: 1, minWidth: 0 },
  stockNotice: { backgroundColor: color.warningSoft, borderRadius: radius.md, paddingHorizontal: space[4], paddingVertical: space[2] },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  recent: { borderTopWidth: 1, borderTopColor: color.border, paddingTop: space[3] },
  block: {
    borderTopWidth: 3,
    borderTopColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    paddingHorizontal: space[3],
    paddingBottom: space[2],
  },
  quietBlock: { backgroundColor: 'transparent', borderTopWidth: 0, paddingHorizontal: 0 },
  blockDanger: { borderTopColor: color.danger },
  blockWarning: { borderTopColor: color.accent },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 52,
    paddingVertical: space[2],
    flexWrap: 'wrap',
    paddingLeft: space[1],
  },
  loading: { gap: space[2], padding: space[2] },
  message: { paddingHorizontal: space[1], paddingVertical: space[3] },
  errorRow: { alignItems: 'flex-start', gap: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  rowCompact: { flexDirection: 'column', alignItems: 'stretch', gap: space[1] },
  compactText: { minWidth: 0 },
  rowFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space[2] },
  right: { alignItems: 'flex-end', gap: 2 },
  marker: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: color.accent },
  markerCritical: { backgroundColor: color.danger },
});
