import type { ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Order, Receivable, StockAdmin } from '@/api/types';
import { canReadFinance } from '@/features/finance/FinanceAccess';
import { DueBadge, RowLink } from '@/features/finance/FinanceParts';
import { useFinanceOverview } from '@/features/finance/api';
import { summarizeTitles } from '@/features/finance/overview';
import { dueHint, formatDate, installmentLabel, orderCode } from '@/features/finance/presentation';
import { useReplenishment } from '@/features/inventory/api';
import { qty } from '@/features/inventory/StockParts';
import { useOrderList } from '@/features/orders/api';
import { shortOrderId, statusLabel, statusTone, todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
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

/**
 * Início: resumo do negócio, o que precisa de atenção e atividade recente. Sem totais inventados:
 * contagens vêm de uma página de até 50 registros e mostram "50+" quando há mais; valores
 * financeiros só aparecem quando a leitura do Financeiro cobre todo o escopo. Cada área só
 * aparece para quem tem a permissão correspondente; o servidor filtra o que o vendedor vê.
 */
export function Dashboard() {
  const session = useSession();
  const { permissions } = session;
  const tenant = useTenant();
  const size = useLayoutSize();
  const wide = size === 'expanded';
  const today = tenant.data ? todayIn(tenant.data.timezone) : null;

  const seesOrders =
    permissions.includes('orders:own:read') || permissions.includes('orders:all:manage');
  const seesInventory = permissions.includes('inventory:manage');
  const seesFinance = canReadFinance(session);

  const drafts = useOrderList({ direction: 'desc', status: 'draft' }, SCAN, seesOrders);
  const waiting = useOrderList({ direction: 'asc', status: 'confirmed' }, SCAN, seesOrders);
  const recent = useOrderList({ direction: 'desc' }, 6, seesOrders);
  const stock = useReplenishment(
    { q: '', status: 'active', sort: 'shortfall' },
    SCAN,
    seesInventory,
  );
  const finance = useFinanceOverview();

  const titles = finance.data && today ? summarizeTitles(finance.data.titles, today) : null;
  const soonEnd = today ? addDays(today, 7) : null;
  const dueItems =
    finance.data && today && soonEnd
      ? finance.data.titles.items.filter((t) => t.outstandingCents > 0 && t.dueDate <= soonEnd)
      : [];

  const waitingCount = countOf(waiting.items.length, !!waiting.query.hasNextPage);
  const stockCount = countOf(stock.items.length, !!stock.query.hasNextPage);

  /* ---------- Frases de atenção ---------- */
  const headlines: { icon: LucideIcon; text: string; tone: 'danger' | 'warning' | 'neutral' }[] =
    [];
  if (seesOrders && waiting.items.length)
    headlines.push({
      icon: Truck,
      tone: 'neutral',
      text: `Você tem ${waitingCount} ${waiting.items.length === 1 && !waiting.query.hasNextPage ? 'pedido aguardando' : 'pedidos aguardando'} saída.`,
    });
  if (seesInventory && stock.items.length)
    headlines.push({
      icon: PackageOpen,
      tone: 'warning',
      text: `${stockCount} ${stock.items.length === 1 && !stock.query.hasNextPage ? 'produto precisa' : 'produtos precisam'} de atenção no estoque.`,
    });
  if (titles?.overdue?.count)
    headlines.push({
      icon: CircleAlert,
      tone: 'danger',
      text: `${plural(titles.overdue.count, 'recebimento vencido', 'recebimentos vencidos')}: ${formatCents(titles.overdue.cents)}.`,
    });
  if (titles?.dueSoon?.count)
    headlines.push({
      icon: CircleDollarSign,
      tone: 'neutral',
      text: `${titles.dueSoon.count} ${titles.dueSoon.count === 1 ? 'recebimento vence' : 'recebimentos vencem'} nos próximos 7 dias.`,
    });

  /* ---------- Indicadores ---------- */
  const kpis: ReactNode[] = [];
  if (seesOrders) {
    kpis.push(
      <Kpi
        key="drafts"
        icon={ClipboardList}
        label="Pedidos em aberto"
        value={
          drafts.query.isPending ? null : countOf(drafts.items.length, !!drafts.query.hasNextPage)
        }
        caption="Rascunhos a confirmar"
        href={'/pedidos?situacao=draft' as Href}
      />,
      <Kpi
        key="waiting"
        icon={Truck}
        label="Aguardando saída"
        value={waiting.query.isPending ? null : waitingCount}
        caption={
          waiting.items[0]?.confirmedAt
            ? `Mais antigo: ${formatDateTime(waiting.items[0].confirmedAt)}`
            : 'Confirmados, com estoque reservado'
        }
        href={'/pedidos?situacao=confirmed' as Href}
      />,
    );
  }
  if (seesFinance) {
    kpis.push(
      <Kpi
        key="open"
        icon={CircleDollarSign}
        label="A receber"
        value={finance.isPending ? null : titles?.open ? formatCents(titles.open.cents) : '—'}
        caption={
          titles?.open
            ? plural(titles.open.count, 'título em aberto', 'títulos em aberto')
            : 'Muitos títulos para somar aqui'
        }
        href={'/financeiro/receber' as Href}
      />,
      <Kpi
        key="overdue"
        icon={CircleAlert}
        label="Vencidas"
        tone={titles?.overdue?.count ? 'danger' : 'default'}
        value={finance.isPending ? null : titles?.overdue ? formatCents(titles.overdue.cents) : '—'}
        caption={
          titles?.overdue
            ? titles.overdue.count
              ? plural(titles.overdue.count, 'parcela vencida', 'parcelas vencidas')
              : 'Nenhuma parcela vencida'
            : 'Consulte em Contas a receber'
        }
        href={'/financeiro/receber' as Href}
      />,
    );
  } else if (seesInventory) {
    kpis.push(
      <Kpi
        key="stock"
        icon={PackageOpen}
        label="Abaixo do mínimo"
        tone={stock.items.length ? 'warning' : 'default'}
        value={stock.query.isPending ? null : stockCount}
        caption="Produtos para repor"
        href={'/estoque/reposicao' as Href}
      />,
    );
  }

  /* ---------- Atenção ---------- */
  const attention: ReactNode[] = [];
  if (seesInventory)
    attention.push(
      <Block
        key="stock"
        title="Estoque baixo"
        action={
          stock.items.length
            ? { label: 'Ver estoque', href: '/estoque/reposicao' as Href }
            : undefined
        }
        loading={stock.query.isPending}
        error={stock.query.isError}
        empty="Nenhum produto abaixo do mínimo."
        count={stock.items.length}
      >
        {stock.items.slice(0, 6).map((s) => (
          <StockRow key={s.productId} item={s} />
        ))}
      </Block>,
    );
  if (seesOrders)
    attention.push(
      <Block
        key="waiting"
        title="Aguardando saída"
        action={
          waiting.items.length
            ? { label: 'Ver todos', href: '/pedidos?situacao=confirmed' as Href }
            : undefined
        }
        loading={waiting.query.isPending}
        error={waiting.query.isError}
        empty="Nenhum pedido aguardando saída."
        count={waiting.items.length}
      >
        {waiting.items.slice(0, 6).map((o) => (
          <OrderRow key={o.id} order={o} date={o.confirmedAt ?? o.createdAt} />
        ))}
      </Block>,
    );
  if (seesFinance)
    attention.push(
      <Block
        key="due"
        title="Recebimentos: vencidos e próximos 7 dias"
        action={{ label: 'Abrir Financeiro', href: '/financeiro' as Href }}
        loading={finance.isPending}
        error={finance.isError}
        empty="Nada vencido nem vencendo nesta semana."
        count={dueItems.length}
      >
        {dueItems.slice(0, 6).map((t) => (
          <DueRow key={t.id} title={t} today={today} />
        ))}
      </Block>,
    );

  return (
    <Screen
      title="Início"
      description={tenant.data ? tenant.data.name : undefined}
      actions={
        canCreateOrder(permissions) ? (
          <Link href="/pedidos/novo" asChild>
            <Button label="Novo pedido" icon={Plus} variant="strong" />
          </Link>
        ) : null
      }
    >
      {kpis.length ? (
        <View style={styles.kpis}>
          {kpis.map((k, i) => (
            <View
              key={i}
              style={[
                styles.kpiCell,
                { width: size === 'expanded' ? `${100 / kpis.length}%` : '50%' },
              ]}
            >
              {k}
            </View>
          ))}
        </View>
      ) : null}

      {attention.length ? (
        <View style={styles.area}>
          <Text variant="h3" accessibilityRole="header" style={styles.areaTitle}>
            O que precisa de atenção
          </Text>
          {headlines.length ? (
            <View style={styles.headlines}>
              {headlines.map((h) => (
                <View key={h.text} style={styles.headline}>
                  <h.icon
                    size={16}
                    strokeWidth={2}
                    color={
                      h.tone === 'danger'
                        ? color.danger
                        : h.tone === 'warning'
                          ? color.warning
                          : color.textSecondary
                    }
                  />
                  <Text variant="small" style={styles.flex}>
                    {h.text}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={[styles.blocks, wide && styles.blocksWide]}>
            {attention.map((b, i) => (
              <View
                key={i}
                style={
                  wide
                    ? {
                        width: attention.length === 3 && i === 2 ? '100%' : '50%',
                        padding: space[2],
                      }
                    : null
                }
              >
                {b}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {seesOrders ? (
        <View style={styles.area}>
          <Text variant="h3" accessibilityRole="header" style={styles.areaTitle}>
            Atividade recente
          </Text>
          <Block
            title="Pedidos recentes"
            action={
              recent.items.length ? { label: 'Ver pedidos', href: '/pedidos' as Href } : undefined
            }
            loading={recent.query.isPending}
            error={recent.query.isError}
            empty="Nenhum pedido ainda. Crie o primeiro em “Novo pedido”."
            count={recent.items.length}
          >
            {recent.items.map((o) => (
              <OrderRow key={o.id} order={o} date={o.createdAt} withStatus />
            ))}
          </Block>
        </View>
      ) : null}
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
      <View style={styles.kpi}>
        <View style={styles.kpiHead}>
          <Text variant="small" color={color.textSecondary} style={styles.flex} numberOfLines={1}>
            {label}
          </Text>
          <Icon size={16} strokeWidth={1.75} color={color.textSecondary} />
        </View>
        {value === null ? (
          <Skeleton height={28} width="50%" />
        ) : (
          <Text
            variant="figureLarge"
            numberOfLines={1}
            color={
              tone === 'danger' ? color.danger : tone === 'warning' ? color.warning : color.text
            }
          >
            {value}
          </Text>
        )}
        <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
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
}: {
  title: string;
  action?: { label: string; href: Href };
  loading: boolean;
  error: boolean;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <View style={styles.block}>
      <View style={styles.blockHead}>
        <Text variant="smallStrong" style={styles.flex}>
          {title}
        </Text>
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
        <Text variant="small" color={color.textSecondary} style={styles.message}>
          Não foi possível carregar agora. Tente de novo em instantes.
        </Text>
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
  return (
    <RowLink href={`/estoque/${s.productId}` as Href}>
      <View style={styles.row}>
        <View style={[styles.marker, critical && styles.markerCritical]} />
        <View style={styles.flex}>
          <Text variant="smallStrong" numberOfLines={1}>
            {s.name}
          </Text>
          <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
            {`Disponível ${qty(s.available, s.unit)} · mínimo ${qty(s.minimumStock, s.unit)}`}
          </Text>
        </View>
        {critical ? (
          <Badge label="Sem estoque" tone="danger" />
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
  return (
    <RowLink href={`/pedidos/${o.id}` as Href}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text variant="smallStrong" numberOfLines={1}>
            {o.customerName ?? 'Sem cliente'}
          </Text>
          <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
            {`${shortOrderId(o.commercialId)} · ${formatDateTime(date)}`}
          </Text>
        </View>
        <View style={styles.right}>
          <Text variant="figure">{formatCents(o.totalCents)}</Text>
          {withStatus ? <Badge label={statusLabel[o.status]} tone={statusTone[o.status]} /> : null}
        </View>
      </View>
    </RowLink>
  );
}

function DueRow({ title: t, today }: { title: Receivable; today: string | null }) {
  return (
    <RowLink href={`/financeiro/${t.id}` as Href}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text variant="smallStrong" numberOfLines={1}>
            {t.customerName}
          </Text>
          <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
            {`${orderCode(t.orderId)} · ${installmentLabel(t.installmentNumber)} · ${formatDate(t.dueDate)} · ${dueHint(t, today)}`}
          </Text>
        </View>
        <View style={styles.right}>
          <Text variant="figure">{formatCents(t.outstandingCents)}</Text>
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
  kpi: { gap: 2, paddingHorizontal: space[4], paddingVertical: space[3] },
  kpiHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  area: { gap: space[3] },
  areaTitle: { paddingBottom: space[2], borderBottomWidth: 1, borderBottomColor: color.border },
  headlines: { gap: space[1] },
  headline: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  blocks: { gap: space[4] },
  blocksWide: { flexDirection: 'row', flexWrap: 'wrap', gap: 0, margin: -space[2] },
  block: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    paddingHorizontal: space[3],
    paddingBottom: space[2],
  },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 44,
    paddingLeft: space[1],
  },
  loading: { gap: space[2], padding: space[2] },
  message: { paddingHorizontal: space[1], paddingVertical: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  right: { alignItems: 'flex-end', gap: 2 },
  marker: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: color.accent },
  markerCritical: { backgroundColor: color.danger },
});
