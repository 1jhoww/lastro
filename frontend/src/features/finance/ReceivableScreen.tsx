import type { ComponentProps, ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { FinancialEvent, Payment, Receivable } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Disclosure,
  EmptyState,
  Panel,
  Skeleton,
  Text,
  type Column,
} from '@/ui';
import { CircleDollarSign, RefreshCw } from '@/ui/icons';
import {
  useFinancialHistory,
  useFinancialState,
  usePayments,
  usePendingExecutions,
  useReceivable,
} from './api';
import { canManageFinance } from './FinanceAccess';
import { DueBadge, Field, Guidance, MethodIcon } from './FinanceParts';
import { FinanceNav } from './FinanceNav';
import {
  dueHint,
  executionKindLabel,
  executionStage,
  formatDate,
  installmentLabel,
  orderCode,
} from './presentation';
import { ReceiptAction } from './ReceiptForm';
import { useRefetchStaleOnFocus } from './cacheUpdates';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';

export function ReceivableScreen({ id }: { id: string }) {
  const title = useReceivable(id);
  return title.isPending ? (
    <Screen title="Parcela a receber">
      <Skeleton height={160} />
    </Screen>
  ) : title.isError ? (
    <Screen title="Parcela a receber">
      <Alert
        tone="danger"
        title="Parcela indisponível"
        action={<Button label="Tentar de novo" size="sm" onPress={() => title.refetch()} />}
      >
        {toApiError(title.error).userMessage}
      </Alert>
    </Screen>
  ) : (
    <TitleDetail title={title.data} onRefreshTitle={() => title.refetch()} />
  );
}

function TitleDetail({ title, onRefreshTitle }: { title: Receivable; onRefreshTitle: () => void }) {
  const session = useSession();
  const state = useFinancialState(title.orderId);
  const payments = usePayments(title.orderId);
  const history = useFinancialHistory(title.orderId);
  const executions = usePendingExecutions(title.orderId);
  useRefetchStaleOnFocus(state, payments.query, executions.query);
  const tenant = useTenant();
  const size = useLayoutSize();
  const wide = size === 'expanded';
  const compact = size === 'compact';
  const today = tenant.data ? todayIn(tenant.data.timezone) : null;
  const blocked =
    executions.query.isPending ||
    executions.query.isError ||
    executions.query.isFetching ||
    executions.items.length > 0 ||
    Boolean(executions.query.hasNextPage) ||
    state.isFetching ||
    (state.data?.activeReturnCount ?? 0) > 0;
  const total = state.data?.titles.length;
  const hint = dueHint(title, today);
  const refresh = () => {
    onRefreshTitle();
    state.refetch();
    payments.query.refetch();
    history.query.refetch();
    executions.query.refetch();
  };
  const headerActions = (
    <>
      <Button
        label="Atualizar"
        icon={RefreshCw}
        size="sm"
        variant="ghost"
        loading={state.isFetching || executions.query.isFetching}
        onPress={refresh}
      />
      <Link href={`/pedidos/${title.orderId}` as Href} asChild>
        <Button label="Abrir pedido" size="sm" variant="outline" />
      </Link>
    </>
  );
  const ownPayments = payments.items;
  const paymentColumns: Column<Payment>[] = [
    {
      key: 'date',
      label: 'Data',
      width: 110,
      render: (p) => <Text>{formatDate(p.receivedOn)}</Text>,
    },
    {
      key: 'method',
      label: 'Forma',
      flex: 2,
      render: (p) => <MethodName payment={p} />,
    },
    {
      key: 'installments',
      label: 'Parcela',
      flex: 2,
      render: (p) => <Text variant="small">{allocationText(p, state.data?.titles)}</Text>,
    },
    {
      key: 'reference',
      label: 'Referência',
      flex: 2,
      render: (p) => (
        <Text variant="small" color={color.textSecondary} numberOfLines={1}>
          {p.reference || '—'}
        </Text>
      ),
    },
    {
      key: 'amount',
      label: 'Valor',
      width: 140,
      align: 'right',
      render: (p) => <PaymentAmount payment={p} />,
    },
  ];
  const eventColumns: Column<FinancialEvent>[] = [
    {
      key: 'date',
      label: 'Quando',
      width: 150,
      render: (e) => <Text variant="small">{formatDateTime(e.occurredAt)}</Text>,
    },
    {
      key: 'type',
      label: 'O que aconteceu',
      flex: 2,
      render: (e) => <Text>{eventLabels[e.type]}</Text>,
    },
    {
      key: 'reason',
      label: 'Observação',
      flex: 3,
      render: (e) => (
        <Text variant="small" color={color.textSecondary}>
          {e.reason}
        </Text>
      ),
    },
    {
      key: 'amount',
      label: 'Valor',
      width: 120,
      align: 'right',
      render: (e) => <Text>{formatCents(e.amountCents)}</Text>,
    },
  ];
  return (
    <Screen
      title={title.customerName}
      description={`${orderCode(title.orderId)} · ${installmentLabel(title.installmentNumber)}${total ? ` de ${total}` : ''}`}
      actions={compact ? undefined : headerActions}
    >
      <FinanceNav />
      <View style={[styles.grid, wide && styles.gridWide]}>
        <View style={[styles.col, wide && styles.main]}>
          <Panel>
            <View style={[styles.summary, !wide && styles.summaryStack]}>
              <View style={styles.flex}>
                <Text variant="small" color={color.textSecondary}>
                  Saldo a receber
                </Text>
                <Text variant="display" style={styles.balance}>
                  {formatCents(title.outstandingCents)}
                </Text>
                <View style={styles.dueRow}>
                  <DueBadge title={title} today={today} />
                  <Text variant="small" color={color.textSecondary}>
                    {`Vencimento ${formatDate(title.dueDate)}${hint ? ` · ${hint}` : ''}`}
                  </Text>
                </View>
              </View>
              {state.data ? (
                <View style={wide ? styles.action : compact ? null : styles.actionMedium}>
                  <ReceiptAction title={title} state={state.data} blocked={blocked} />
                </View>
              ) : null}
            </View>
            <View style={styles.amounts}>
              <Field label="Valor da parcela" value={formatCents(title.originalCents)} />
              <Field label="Recebido em dinheiro" value={formatCents(title.cashCents)} />
              {title.creditCents ? (
                <Field label="Pago com crédito do cliente" value={formatCents(title.creditCents)} />
              ) : null}
              {title.canceledCents ? (
                <Field label="Cancelado" value={formatCents(title.canceledCents)} />
              ) : null}
              <Field label="Saldo restante" value={formatCents(title.outstandingCents)} strong />
            </View>
          </Panel>
          {compact ? <View style={styles.compactActions}>{headerActions}</View> : null}
          {executions.query.isError ? (
            <Alert
              tone="warning"
              title="Não foi possível conferir operações em andamento"
              action={
                <Button
                  label="Tentar de novo"
                  size="sm"
                  variant="outline"
                  onPress={() => executions.query.refetch()}
                />
              }
            >
              {toApiError(executions.query.error).userMessage}
            </Alert>
          ) : null}
          {executions.items.map((e) => (
            <Alert
              key={e.id}
              tone="warning"
              title="Operação financeira pendente"
              action={
                <Link href={`/financeiro/execucoes/${e.id}` as Href} asChild>
                  <Button label="Acompanhar operação" size="sm" variant="outline" />
                </Link>
              }
            >
              {`${executionKindLabel(e.kind)} · ${executionStage(e).label}. Enquanto não for concluída, novos pagamentos deste pedido ficam bloqueados.`}
            </Alert>
          ))}
          {executions.query.hasNextPage ? (
            <Button
              label="Consultar mais pendências"
              variant="outline"
              size="sm"
              onPress={() => executions.query.fetchNextPage()}
              loading={executions.query.isFetchingNextPage}
            />
          ) : null}
          <Panel title="Pagamentos deste pedido" flush>
            <ListPanelInner
              query={payments.query}
              count={ownPayments.length}
              empty="Nenhum pagamento registrado neste pedido."
            >
              <DataTable
                label="Pagamentos do pedido"
                rows={ownPayments}
                keyOf={(p) => p.id}
                columns={paymentColumns}
                renderCompact={(p) => (
                  <View style={styles.compactRow}>
                    <View style={styles.flex}>
                      <MethodName payment={p} />
                      <Text variant="small" color={color.textSecondary}>
                        {`${formatDate(p.receivedOn)} · ${allocationText(p, state.data?.titles)}`}
                      </Text>
                      {p.reference ? (
                        <Text variant="small" color={color.textSecondary}>
                          {p.reference}
                        </Text>
                      ) : null}
                    </View>
                    <PaymentAmount payment={p} />
                  </View>
                )}
              />
            </ListPanelInner>
          </Panel>
          <Disclosure label="Histórico completo do pedido" summary="todos os eventos financeiros">
            <ListPanel
              query={history.query}
              count={history.items.length}
              empty={
                <EmptyState
                  size="compact"
                  icon={CircleDollarSign}
                  title="Nenhum evento financeiro"
                  description="Eventos aparecem após operações financeiras confirmadas."
                />
              }
            >
              <DataTable
                label="Histórico financeiro"
                rows={history.items}
                keyOf={(e) => e.id}
                columns={eventColumns}
                renderCompact={(e) => (
                  <View style={styles.flex}>
                    <Text variant="bodyStrong">{`${eventLabels[e.type]} · ${formatCents(e.amountCents)}`}</Text>
                    <Text variant="small" color={color.textSecondary}>
                      {`${formatDateTime(e.occurredAt)} · ${e.reason}`}
                    </Text>
                  </View>
                )}
              />
            </ListPanel>
          </Disclosure>
        </View>
        <View style={[styles.col, wide && styles.side]}>
          {state.isPending ? (
            <Skeleton height={120} />
          ) : state.isError ? (
            <Alert
              tone="danger"
              title="Saldos do pedido indisponíveis"
              action={<Button label="Tentar de novo" size="sm" onPress={() => state.refetch()} />}
            >
              {toApiError(state.error).userMessage}
            </Alert>
          ) : (
            <Panel title="Parcelas do pedido" flush>
              {state.data.titles.map((t, i) => {
                const row = (
                  <View
                    style={[
                      styles.installment,
                      i < state.data.titles.length - 1 && styles.divider,
                      t.id === title.id && styles.current,
                    ]}
                  >
                    <View style={styles.flex}>
                      <Text variant="bodyStrong">{installmentLabel(t.installmentNumber)}</Text>
                      <Text variant="small" color={color.textSecondary}>
                        {formatDate(t.dueDate)}
                      </Text>
                    </View>
                    <View style={styles.installmentRight}>
                      <Text variant="figure">{formatCents(t.outstandingCents)}</Text>
                      <DueBadge title={t} today={today} />
                    </View>
                  </View>
                );
                return t.id === title.id ? (
                  <View
                    key={t.id}
                    accessibilityLabel={`${installmentLabel(t.installmentNumber)} (esta)`}
                  >
                    {row}
                  </View>
                ) : (
                  <Link key={t.id} href={`/financeiro/${t.id}` as Href} asChild>
                    <PressableRow>{row}</PressableRow>
                  </Link>
                );
              })}
            </Panel>
          )}
          <Panel title="Outras ações" description="Use só em situações específicas.">
            <View style={styles.links}>
              {canManageFinance(session, 'payments:manage') ? (
                <Link href={`/financeiro/pedidos/${title.orderId}?acao=credito` as Href} asChild>
                  <Button label="Usar crédito do cliente" size="sm" variant="outline" />
                </Link>
              ) : null}
              {canManageFinance(session, 'payments:reverse') ? (
                <Link href={`/financeiro/pedidos/${title.orderId}?acao=estorno` as Href} asChild>
                  <Button label="Estornar um pagamento" size="sm" variant="outline" />
                </Link>
              ) : null}
              <Link href={`/financeiro/pedidos/${title.orderId}` as Href} asChild>
                <Button label="Financeiro completo do pedido" size="sm" variant="ghost" />
              </Link>
            </View>
            <View style={styles.guide}>
              <Guidance>
                Estorno desfaz um pagamento registrado por engano. Crédito do cliente só existe
                quando há cancelamento ou devolução anterior.
              </Guidance>
            </View>
          </Panel>
          <Disclosure label="Detalhes técnicos">
            <Text variant="caption" color={color.textSecondary} selectable>
              {`Título ${title.id}\nPedido ${title.orderId}\nVersão ${title.version}`}
            </Text>
          </Disclosure>
        </View>
      </View>
    </Screen>
  );
}

function MethodName({ payment: p }: { payment: Payment }) {
  return (
    <View style={styles.method}>
      <MethodIcon kind={p.method.kind} size={16} />
      <Text variant="bodyStrong">{p.method.name}</Text>
    </View>
  );
}

function PaymentAmount({ payment: p }: { payment: Payment }) {
  return (
    <View style={styles.amount}>
      <Text variant="figure">{formatCents(p.amountCents)}</Text>
      {p.reversedCents > 0 ? (
        <Badge
          label={
            p.reversedCents === p.amountCents
              ? 'Estornado'
              : `Estornado ${formatCents(p.reversedCents)}`
          }
          tone="danger"
        />
      ) : null}
      {p.transferredCents > 0 ? (
        <Text variant="caption" color={color.textSecondary}>
          {`${formatCents(p.transferredCents)} virou crédito/reembolso`}
        </Text>
      ) : null}
    </View>
  );
}

function allocationText(p: Payment, titles?: { id: string; installmentNumber: number }[]) {
  return p.allocations
    .map((a) => {
      const n = titles?.find((t) => t.id === a.receivableId)?.installmentNumber;
      return n ? `${n}ª parcela` : 'Parcela';
    })
    .join(', ');
}

/** Lista dentro de painel já existente (sem painel duplicado). */
function ListPanelInner({
  query,
  count,
  empty,
  children,
}: {
  query: Parameters<typeof ListPanel>[0]['query'];
  count: number;
  empty: string;
  children: ReactNode;
}) {
  if (query.isPending)
    return (
      <View style={styles.pad}>
        <Skeleton height={18} />
      </View>
    );
  if (query.isError)
    return (
      <View style={styles.pad}>
        <Alert
          tone="danger"
          title="Não foi possível carregar"
          action={<Button label="Tentar de novo" size="sm" onPress={() => query.refetch()} />}
        >
          {toApiError(query.error).userMessage}
        </Alert>
      </View>
    );
  return (
    <>
      {count === 0 ? (
        <View style={styles.pad}>
          <Text variant="small" color={color.textSecondary}>
            {empty}
          </Text>
        </View>
      ) : (
        children
      )}
      {query.hasNextPage ? (
        <View style={styles.pad}>
          <Button
            label="Carregar mais"
            size="sm"
            variant="outline"
            loading={query.isFetchingNextPage}
            onPress={() => query.fetchNextPage()}
          />
        </View>
      ) : null}
    </>
  );
}

export const eventLabels: Record<FinancialEvent['type'], string> = {
  receipt: 'Pagamento registrado',
  payment_reversal: 'Pagamento estornado',
  credit_application: 'Crédito do cliente usado',
  credit_reversal: 'Uso de crédito estornado',
  financial_cancellation: 'Pedido cancelado no financeiro',
  refund: 'Reembolso registrado',
  return_intent: 'Devolução solicitada',
  return_edited: 'Devolução alterada',
  return_canceled: 'Devolução cancelada',
  return_received: 'Devolução recebida fisicamente',
  return_resolved: 'Devolução acertada no financeiro',
};

const styles = StyleSheet.create({
  grid: { gap: space[5] },
  gridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { gap: space[5] },
  main: { flex: 3, minWidth: 0 },
  side: { flex: 2, minWidth: 0 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  summary: { flexDirection: 'row', gap: space[5], alignItems: 'flex-start', paddingTop: space[2] },
  summaryStack: { flexDirection: 'column', alignItems: 'stretch' },
  balance: { marginVertical: space[1] },
  dueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  action: { width: 260 },
  actionMedium: { alignItems: 'flex-start' },
  amounts: {
    marginTop: space[4],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  compactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  method: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  amount: { alignItems: 'flex-end', gap: space[1] },
  installment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[5],
  },
  installmentRight: { alignItems: 'flex-end', gap: space[1] },
  current: { backgroundColor: color.accentSoft },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  links: { gap: space[2], alignItems: 'flex-start' },
  compactActions: { flexDirection: 'row', gap: space[2], marginTop: -space[2] },
  guide: { marginTop: space[3] },
  pad: { padding: space[5] },
});

function PressableRow({ children, ...rest }: Omit<ComponentProps<typeof Touchable>, 'pressStyle'>) {
  return (
    <Touchable
      accessibilityRole="link"
      {...rest}
      pressStyle={(s: InteractionState) => [
        (s.hovered || s.pressed) && { backgroundColor: 'rgba(17,17,17,0.03)' },
        showFocusRing(s) && focusRing(),
      ]}
    >
      {children}
    </Touchable>
  );
}
