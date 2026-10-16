import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Receivable } from '@/api/types';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { monthNames } from '@/lib/calendar';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { color, space, useLayoutSize } from '@/theme';
import { Alert, Button, DataTable, EmptyState, Panel, Skeleton, Text, type Column } from '@/ui';
import { CircleCheck, CircleDollarSign, RefreshCw } from '@/ui/icons';
import { useRefundObligations } from './administrationApi';
import { useFinanceOverview } from './api';
import { DueBadge, Guidance, MethodIcon, Metric, MetricStrip, RowLink } from './FinanceParts';
import { FinanceNav } from './FinanceNav';
import {
  OVERVIEW_MAX_PAGES,
  OVERVIEW_PAGE_SIZE,
  receivedInMonth,
  recentPayments,
  summarizeTitles,
  upcomingTitles,
} from './overview';
import {
  dueHint,
  executionKindLabel,
  executionStage,
  formatDate,
  installmentLabel,
  orderCode,
} from './presentation';
import { useExecutions } from './resolutionApi';
import { useRefetchStaleOnFocus } from './cacheUpdates';

const LIMIT = OVERVIEW_PAGE_SIZE * OVERVIEW_MAX_PAGES;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function FinanceOverviewScreen() {
  const tenant = useTenant();
  const today = tenant.data ? todayIn(tenant.data.timezone) : null;
  const overview = useFinanceOverview();
  useRefetchStaleOnFocus(overview);
  const wide = useLayoutSize() === 'expanded';
  return (
    <Screen
      title="Financeiro"
      description="Quanto seus clientes devem, o que vence nos próximos dias e o que já entrou."
    >
      <FinanceNav />
      {overview.isError ? (
        <Alert
          tone="danger"
          title="Não conseguimos carregar o resumo agora"
          action={
            <Button
              label="Tentar de novo"
              size="sm"
              variant="outline"
              onPress={() => overview.refetch()}
            />
          }
        >
          {toApiError(overview.error).userMessage}
        </Alert>
      ) : null}
      {overview.isPending || !today ? (
        <Skeleton height={96} />
      ) : overview.data ? (
        <Indicators data={overview.data} today={today} />
      ) : null}
      {overview.data ? (
        <View style={styles.scope}>
          <Text variant="caption" color={color.textSecondary} style={styles.flex}>
            {`Somado agora a partir de ${plural(overview.data.titles.items.length, 'título', 'títulos')} e ${plural(overview.data.payments.items.length, 'recebimento', 'recebimentos')} registrados · ${formatDateTime(overview.data.fetchedAt)}`}
          </Text>
          <Button
            label="Atualizar"
            icon={RefreshCw}
            size="sm"
            variant="ghost"
            loading={overview.isFetching}
            onPress={() => overview.refetch()}
          />
        </View>
      ) : null}
      <View style={[styles.grid, wide && styles.gridWide]}>
        <View style={[styles.col, wide && styles.main]}>
          <Upcoming
            titles={overview.data ? upcomingTitles(overview.data.titles) : null}
            pending={overview.isPending}
            today={today}
          />
        </View>
        <View style={[styles.col, wide && styles.side]}>
          <RecentReceipts data={overview.data ?? null} />
          <Attention />
        </View>
      </View>
    </Screen>
  );
}

function Indicators({
  data,
  today,
}: {
  data: NonNullable<ReturnType<typeof useFinanceOverview>['data']>;
  today: string;
}) {
  const s = summarizeTitles(data.titles, today);
  const received = receivedInMonth(data.payments, today);
  const tooMany = `São muitos registros para somar aqui. Veja em Contas a receber.`;
  return (
    <MetricStrip>
      <Metric
        label="Total a receber"
        cents={s.open?.cents ?? null}
        caption={s.open ? plural(s.open.count, 'título em aberto', 'títulos em aberto') : undefined}
        unavailable={tooMany}
      />
      <Metric
        label="Vencido"
        tone="danger"
        cents={s.overdue?.cents ?? null}
        caption={
          s.overdue
            ? s.overdue.count
              ? plural(s.overdue.count, 'título vencido', 'títulos vencidos')
              : 'Nenhum título vencido'
            : undefined
        }
        unavailable={tooMany}
      />
      <Metric
        label="Vence em 7 dias"
        cents={s.dueSoon?.cents ?? null}
        caption={
          s.dueSoon
            ? `${plural(s.dueSoon.count, 'título', 'títulos')}${s.dueToday?.count ? ` · ${s.dueToday.count} hoje` : ''}`
            : undefined
        }
        unavailable={tooMany}
      />
      <Metric
        label={`Recebido em ${monthNames[Number(today.slice(5, 7)) - 1]}`}
        tone="success"
        cents={received?.cents ?? null}
        caption={
          received
            ? `${plural(received.count, 'pagamento', 'pagamentos')}, já descontados estornos`
            : undefined
        }
        unavailable={tooMany}
      />
    </MetricStrip>
  );
}

function Upcoming({
  titles,
  pending,
  today,
}: {
  titles: Receivable[] | null;
  pending: boolean;
  today: string | null;
}) {
  const columns: Column<Receivable>[] = [
    {
      key: 'customer',
      label: 'Cliente',
      flex: 3,
      render: (t) => (
        <View>
          <Text variant="bodyStrong" numberOfLines={1}>
            {t.customerName}
          </Text>
          <Text variant="small" color={color.textSecondary}>
            {`${orderCode(t.orderId)} · ${installmentLabel(t.installmentNumber)}`}
          </Text>
        </View>
      ),
    },
    {
      key: 'due',
      label: 'Vencimento',
      flex: 2,
      render: (t) => (
        <View>
          <Text>{formatDate(t.dueDate)}</Text>
          <Text variant="small" color={color.textSecondary}>
            {dueHint(t, today)}
          </Text>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Situação',
      flex: 2,
      render: (t) => <DueBadge title={t} today={today} />,
    },
    {
      key: 'balance',
      label: 'Valor pendente',
      flex: 2,
      align: 'right',
      render: (t) => <Text variant="figure">{formatCents(t.outstandingCents)}</Text>,
    },
  ];
  return (
    <Panel
      title="Próximos vencimentos"
      description="Vencidos primeiro, depois o que vence a seguir."
      flush
      action={
        <Link href={'/financeiro/receber' as Href} asChild>
          <Button label="Ver todos" size="sm" variant="ghost" />
        </Link>
      }
    >
      {pending || titles === null ? (
        <View style={styles.loading}>
          <Skeleton height={18} />
          <Skeleton height={18} width="70%" />
          <Skeleton height={18} width="80%" />
        </View>
      ) : titles.length === 0 ? (
        <EmptyState
          size="compact"
          icon={CircleCheck}
          title="Nada a receber"
          description="Quando um pedido é confirmado, suas parcelas aparecem aqui."
        />
      ) : (
        <DataTable
          label="Próximos vencimentos"
          rows={titles}
          keyOf={(t) => t.id}
          hrefOf={(t) => `/financeiro/${t.id}` as Href}
          columns={columns}
          renderCompact={(t) => (
            <View style={styles.compactRow}>
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {t.customerName}
                </Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${formatDate(t.dueDate)} · ${dueHint(t, today)}`}
                </Text>
                <DueBadge title={t} today={today} />
              </View>
              <Text variant="figure">{formatCents(t.outstandingCents)}</Text>
            </View>
          )}
        />
      )}
    </Panel>
  );
}

function RecentReceipts({
  data,
}: {
  data: NonNullable<ReturnType<typeof useFinanceOverview>['data']> | null;
}) {
  const names = new Map(data?.titles.items.map((t) => [t.customerId, t.customerName]) ?? []);
  const titleOf = new Map(data?.titles.items.map((t) => [t.id, t]) ?? []);
  const items = data ? recentPayments(data.payments) : [];
  return (
    <Panel title="Recebimentos recentes" description="Pagamentos registrados, pela data informada.">
      {!data ? (
        <Skeleton height={18} />
      ) : !data.payments.complete ? (
        <Text variant="small" color={color.textSecondary}>
          {`Há mais de ${LIMIT} recebimentos. Consulte cada título em Contas a receber.`}
        </Text>
      ) : items.length === 0 ? (
        <Text variant="small" color={color.textSecondary}>
          Nenhum pagamento registrado ainda.
        </Text>
      ) : (
        <View>
          {items.map((p, i) => {
            const target = p.allocations[0]?.receivableId;
            const row = (
              <View style={[styles.activity, i < items.length - 1 && styles.divider]}>
                <MethodIcon kind={p.method.kind} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {names.get(p.customerId) ?? 'Cliente'}
                  </Text>
                  <Text variant="small" color={color.textSecondary}>
                    {`${p.method.name} · ${formatDate(p.receivedOn)}${target && titleOf.get(target) ? ` · ${installmentLabel(titleOf.get(target)!.installmentNumber)}` : ''}`}
                  </Text>
                  {p.reversedCents > 0 ? (
                    <Text variant="small" color={color.danger}>
                      {`Estornado ${formatCents(p.reversedCents)}`}
                    </Text>
                  ) : null}
                  {p.transferredCents > 0 ? (
                    <Text variant="small" color={color.textSecondary}>
                      {`${formatCents(p.transferredCents)} virou crédito ou reembolso`}
                    </Text>
                  ) : null}
                </View>
                <Text variant="figure">{formatCents(p.amountCents)}</Text>
              </View>
            );
            return target ? (
              <RowLink key={p.id} href={`/financeiro/${target}` as Href}>
                {row}
              </RowLink>
            ) : (
              <View key={p.id}>{row}</View>
            );
          })}
        </View>
      )}
    </Panel>
  );
}

/** Pendências que pedem ação administrativa; primeira página oficial, sem totais inferidos. */
function Attention() {
  const executions = useExecutions({ pending: 'true' });
  const refunds = useRefundObligations({});
  useRefetchStaleOnFocus(executions.query, refunds.query);
  const pendingRefunds = refunds.items.filter((r) => r.outstandingCents > 0);
  const loading = executions.query.isPending || refunds.query.isPending;
  const nothing =
    !loading &&
    executions.items.length === 0 &&
    pendingRefunds.length === 0 &&
    !executions.query.hasNextPage &&
    !refunds.query.hasNextPage;
  return (
    <Panel title="Precisa de atenção">
      {loading ? (
        <Skeleton height={18} />
      ) : nothing ? (
        <Text variant="small" color={color.textSecondary}>
          Nenhum reembolso a registrar e nenhuma operação em andamento.
        </Text>
      ) : (
        <View style={styles.attention}>
          {pendingRefunds.slice(0, 3).map((r) => (
            <RowLink key={r.id} href={`/financeiro/pedidos/${r.orderId}?reembolso=${r.id}` as Href}>
              <View style={styles.activity}>
                <CircleDollarSign size={18} color={color.warning} strokeWidth={1.75} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong">Reembolso a registrar</Text>
                  <Text variant="small" color={color.textSecondary}>
                    {`${orderCode(r.orderId)} · devolver ${formatCents(r.outstandingCents)} ao cliente`}
                  </Text>
                </View>
              </View>
            </RowLink>
          ))}
          {executions.items.slice(0, 3).map((e) => (
            <RowLink key={e.id} href={`/financeiro/execucoes/${e.id}` as Href}>
              <View style={styles.activity}>
                <RefreshCw size={18} color={color.warning} strokeWidth={1.75} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong">{`${executionKindLabel(e.kind)} em andamento`}</Text>
                  <Text variant="small" color={color.textSecondary}>
                    {`${orderCode(e.orderId)} · ${executionStage(e).label}`}
                  </Text>
                </View>
              </View>
            </RowLink>
          ))}
          {executions.query.hasNextPage ||
          refunds.query.hasNextPage ||
          pendingRefunds.length > 3 ||
          executions.items.length > 3 ? (
            <Link href={'/financeiro/operacoes' as Href} asChild>
              <Button label="Ver todas as pendências" size="sm" variant="ghost" />
            </Link>
          ) : null}
        </View>
      )}
      <View style={styles.guidance}>
        <Guidance>
          Reembolso registrado aqui não transfere dinheiro: ele documenta uma devolução feita fora
          do sistema.
        </Guidance>
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  scope: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: -space[3] },
  grid: { gap: space[5] },
  gridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { gap: space[5] },
  main: { flex: 3, minWidth: 0 },
  side: { flex: 2, minWidth: 0 },
  flex: { flex: 1, minWidth: 0 },
  loading: { padding: space[5], gap: space[3] },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  activity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[2],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  attention: { gap: space[1] },
  guidance: { marginTop: space[3] },
});
