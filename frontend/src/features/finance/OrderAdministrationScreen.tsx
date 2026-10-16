import { useState } from 'react';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { CreditApplication, CreditLot, Order, Payment, RefundObligation } from '@/api/types';
import { useOrder } from '@/features/orders/api';
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
  Panel,
  Skeleton,
  Text,
  type Column,
} from '@/ui';
import { HandCoins, RefreshCw, Undo2, Wallet } from '@/ui/icons';
import {
  useCreditApplications,
  useCustomerCredits,
  useRefundObligations,
} from './administrationApi';
import { useFinancialState, usePayments, usePendingExecutions } from './api';
import { applicationLabels, creditOriginLabel } from './CreditsScreen';
import { DiscountPanel } from './DiscountPanel';
import { EconomicForm, economicTitles } from './EconomicForm';
import { ExecutionSummary } from './ExecutionsScreen';
import { canManageFinance } from './FinanceAccess';
import { DueBadge, Field, Guidance, RowLink } from './FinanceParts';
import { FinanceNav } from './FinanceNav';
import { formatDate, installmentLabel, orderCode } from './presentation';
import { ReconciliationPanel } from './ReconciliationPanel';
import { refundLabels } from './RefundsScreen';
import { ResolutionForm } from './ResolutionForm';
import type { EconomicCommand } from './commands';
import { useRefetchStaleOnFocus } from './cacheUpdates';

export function OrderAdministrationScreen({ id }: { id: string }) {
  const order = useOrder(id);
  const params = useLocalSearchParams<{ reembolso?: string; acao?: string }>();
  return (
    <Screen
      title="Financeiro do pedido"
      description={
        order.data
          ? `${order.data.customerName ?? 'Sem cliente'} · ${orderCode(id)}`
          : orderCode(id)
      }
      actions={
        <Link href={`/pedidos/${id}` as Href} asChild>
          <Button label="Abrir pedido" size="sm" variant="outline" />
        </Link>
      }
    >
      <FinanceNav />
      {order.isPending ? (
        <Skeleton height={120} />
      ) : order.isError ? (
        <Alert
          tone="danger"
          title="Pedido indisponível"
          action={<Button label="Tentar de novo" size="sm" onPress={() => order.refetch()} />}
        >
          {toApiError(order.error).userMessage}
        </Alert>
      ) : order.data.confirmedAt ? (
        <>
          <OrderWorkspace
            order={order.data}
            defaultRefundId={params.reembolso ?? ''}
            initialAction={
              params.reembolso
                ? 'confirm-refund'
                : params.acao === 'credito'
                  ? 'apply-credit'
                  : params.acao === 'estorno'
                    ? 'reverse-payment'
                    : null
            }
          />
          <Disclosure label="Desconto do pedido" summary="registrado antes da confirmação">
            <DiscountPanel key={id} order={order.data} />
          </Disclosure>
        </>
      ) : (
        <>
          <Guidance>
            Pagamentos, créditos e reembolsos existem a partir da confirmação do pedido. No
            rascunho, só o desconto administrativo pode ser aprovado.
          </Guidance>
          <DiscountPanel key={id} order={order.data} />
        </>
      )}
    </Screen>
  );
}

function OrderWorkspace({
  order,
  defaultRefundId,
  initialAction,
}: {
  order: Order;
  defaultRefundId: string;
  initialAction: EconomicCommand['kind'] | null;
}) {
  const session = useSession();
  const tenant = useTenant();
  const today = tenant.data ? todayIn(tenant.data.timezone) : null;
  const wide = useLayoutSize() === 'expanded';
  const state = useFinancialState(order.id);
  const payments = usePayments(order.id);
  const lots = useCustomerCredits(order.customerId ?? '');
  const applications = useCreditApplications({ orderId: order.id });
  const refunds = useRefundObligations({ orderId: order.id });
  const executions = usePendingExecutions(order.id);
  useRefetchStaleOnFocus(
    state,
    payments.query,
    lots.query,
    applications.query,
    refunds.query,
    executions.query,
  );
  const [action, setAction] = useState<EconomicCommand['kind'] | null>(initialAction);
  const blocked =
    executions.query.isPending ||
    executions.query.isError ||
    executions.query.isFetching ||
    Boolean(executions.query.hasNextPage) ||
    executions.items.length > 0 ||
    state.isFetching;
  const refresh = () => {
    state.refetch();
    payments.query.refetch();
    lots.query.refetch();
    applications.query.refetch();
    refunds.query.refetch();
    executions.query.refetch();
  };
  const outstanding = state.data?.titles.reduce((a, t) => a + t.outstandingCents, 0) ?? 0;
  const actions: {
    kind: EconomicCommand['kind'];
    icon: typeof Wallet;
    available: boolean;
    hint: string;
  }[] = [
    {
      kind: 'apply-credit',
      icon: Wallet,
      available: outstanding > 0 && lots.items.some((l) => l.availableCents > 0),
      hint: 'Cliente sem crédito disponível ou pedido sem saldo em aberto',
    },
    {
      kind: 'reverse-payment',
      icon: Undo2,
      available: payments.items.some((p) => p.allocations.some((a) => a.remainingCents > 0)),
      hint: 'Nenhum pagamento que possa ser estornado',
    },
    {
      kind: 'reverse-credit',
      icon: Undo2,
      available: applications.items.some((a) => a.allocations.some((r) => r.remainingCents > 0)),
      hint: 'Nenhum uso de crédito que possa ser estornado',
    },
    {
      kind: 'confirm-refund',
      icon: HandCoins,
      available: refunds.items.some((r) => r.outstandingCents > 0) || Boolean(defaultRefundId),
      hint: 'Nenhum reembolso pendente',
    },
  ];
  const permitted = (k: EconomicCommand['kind']) =>
    canManageFinance(
      session,
      k === 'apply-credit'
        ? 'payments:manage'
        : k === 'confirm-refund'
          ? 'refunds:manage'
          : 'payments:reverse',
    );
  const paymentColumns: Column<Payment>[] = [
    {
      key: 'date',
      label: 'Data',
      width: 110,
      render: (p) => <Text>{formatDate(p.receivedOn)}</Text>,
    },
    { key: 'method', label: 'Forma', flex: 2, render: (p) => <Text>{p.method.name}</Text> },
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
      key: 'status',
      label: 'Situação',
      flex: 2,
      render: (p) =>
        p.reversedCents ? (
          <Badge label={`Estornado ${formatCents(p.reversedCents)}`} tone="danger" />
        ) : p.transferredCents ? (
          <Badge label="Virou crédito/reembolso" tone="neutral" />
        ) : (
          <Badge label="Registrado" tone="success" />
        ),
    },
    {
      key: 'amount',
      label: 'Valor',
      width: 120,
      align: 'right',
      render: (p) => <Text variant="figure">{formatCents(p.amountCents)}</Text>,
    },
  ];
  return (
    <>
      <View style={styles.toolbar}>
        <Button
          label="Atualizar"
          icon={RefreshCw}
          size="sm"
          variant="ghost"
          loading={state.isFetching}
          onPress={refresh}
        />
      </View>
      {executions.query.isError ? (
        <Alert tone="warning" title="Não foi possível conferir operações em andamento">
          {toApiError(executions.query.error).userMessage}
        </Alert>
      ) : null}
      {executions.items.length ? (
        <Alert tone="warning" title="Operação em andamento neste pedido">
          <Text variant="small">
            Enquanto ela não for concluída, pagamentos, créditos e estornos deste pedido ficam
            bloqueados.
          </Text>
          {executions.items.map((e) => (
            <ExecutionSummary key={e.id} execution={e} />
          ))}
        </Alert>
      ) : null}
      {executions.query.hasNextPage ? (
        <Button
          label="Consultar mais pendências"
          size="sm"
          variant="outline"
          onPress={() => executions.query.fetchNextPage()}
        />
      ) : null}
      <View style={[styles.grid, wide && styles.gridWide]}>
        <View style={[styles.col, wide && styles.main]}>
          {state.isPending ? (
            <Skeleton height={140} />
          ) : state.isError ? (
            <Alert
              tone="danger"
              title="Saldos indisponíveis"
              action={<Button label="Tentar de novo" size="sm" onPress={() => state.refetch()} />}
            >
              {toApiError(state.error).userMessage}
            </Alert>
          ) : (
            <Panel title="Parcelas" flush>
              {state.data.titles.map((t, i) => (
                <RowLink key={t.id} href={`/financeiro/${t.id}` as Href}>
                  <View
                    style={[styles.installment, i < state.data.titles.length - 1 && styles.divider]}
                  >
                    <View style={styles.flex}>
                      <Text variant="bodyStrong">{installmentLabel(t.installmentNumber)}</Text>
                      <Text variant="small" color={color.textSecondary}>
                        {`Vencimento ${formatDate(t.dueDate)} · valor ${formatCents(t.originalCents)}`}
                      </Text>
                    </View>
                    <View style={styles.right}>
                      <Text variant="figure">{formatCents(t.outstandingCents)}</Text>
                      <DueBadge title={t} today={today} />
                    </View>
                  </View>
                </RowLink>
              ))}
              <View style={styles.totals}>
                <Field
                  label="Recebido em dinheiro"
                  value={formatCents(state.data.cashSettledCents)}
                />
                {state.data.creditSettledCents ? (
                  <Field
                    label="Pago com crédito"
                    value={formatCents(state.data.creditSettledCents)}
                  />
                ) : null}
                {state.data.canceledCents ? (
                  <Field label="Cancelado" value={formatCents(state.data.canceledCents)} />
                ) : null}
                {state.data.transferredCashCents ? (
                  <Field
                    label="Dinheiro que virou crédito ou reembolso"
                    value={formatCents(state.data.transferredCashCents)}
                  />
                ) : null}
                <Field label="Em aberto" value={formatCents(outstanding)} strong />
              </View>
            </Panel>
          )}
          {state.data && action ? (
            <EconomicForm
              key={action}
              kind={action}
              state={state.data}
              lots={lots.items}
              payments={payments.items}
              applications={applications.items}
              refunds={refunds.items}
              blocked={blocked}
              settlementAllowed={order.status === 'confirmed' || order.status === 'dispatched'}
              defaultRefundId={action === 'confirm-refund' ? defaultRefundId : ''}
              onDone={() => setAction(null)}
            />
          ) : null}
          <Panel title="Pagamentos" flush>
            {payments.query.isPending ? (
              <View style={styles.pad}>
                <Skeleton height={18} />
              </View>
            ) : payments.items.length === 0 ? (
              <View style={styles.pad}>
                <Text variant="small" color={color.textSecondary}>
                  Nenhum pagamento registrado.
                </Text>
              </View>
            ) : (
              <DataTable
                label="Pagamentos do pedido"
                rows={payments.items}
                keyOf={(p) => p.id}
                columns={paymentColumns}
                renderCompact={(p) => (
                  <View style={styles.compactRow}>
                    <View style={styles.flex}>
                      <Text variant="bodyStrong">{p.method.name}</Text>
                      <Text variant="small" color={color.textSecondary}>
                        {`${formatDate(p.receivedOn)}${p.reference ? ` · ${p.reference}` : ''}`}
                      </Text>
                      {p.reversedCents ? (
                        <Badge label={`Estornado ${formatCents(p.reversedCents)}`} tone="danger" />
                      ) : null}
                    </View>
                    <Text variant="figure">{formatCents(p.amountCents)}</Text>
                  </View>
                )}
              />
            )}
            <MoreButton query={payments.query} />
          </Panel>
          <Lists lots={lots} applications={applications} refunds={refunds} />
        </View>
        <View style={[styles.col, wide && styles.side]}>
          <Panel
            title="Outras ações"
            description="Situações específicas. Cada uma pede confirmação."
          >
            <View style={styles.actions}>
              {actions
                .filter((a) => permitted(a.kind))
                .map((a) => (
                  <View key={a.kind} style={styles.actionItem}>
                    <Button
                      label={economicTitles[a.kind]}
                      icon={a.icon}
                      size="sm"
                      variant={action === a.kind ? 'strong' : 'outline'}
                      disabled={!a.available}
                      onPress={() => setAction(a.kind)}
                    />
                    {!a.available ? (
                      <Text variant="caption" color={color.textSecondary}>
                        {a.hint}
                      </Text>
                    ) : null}
                  </View>
                ))}
            </View>
          </Panel>
          {state.data ? (
            <Disclosure label="Operações excepcionais" summary="cancelamento financeiro do pedido">
              <Guidance>
                Cancela o pedido no financeiro: abate o que está em aberto e transforma o que já foi
                pago em crédito do cliente ou em reembolso a fazer. Use apenas quando o pedido não
                será entregue.
              </Guidance>
              <ResolutionForm order={order} state={state.data} blocked={blocked} />
            </Disclosure>
          ) : null}
          <Disclosure label="Verificação técnica" summary="integridade dos registros financeiros">
            <Guidance>
              Confere se os registros financeiros deste pedido estão íntegros. Não altera nada.
            </Guidance>
            <ReconciliationPanel orderId={order.id} />
          </Disclosure>
          <Link href={'/financeiro/devolucoes' as Href} asChild>
            <Button label="Devoluções de mercadoria" size="sm" variant="ghost" />
          </Link>
        </View>
      </View>
    </>
  );
}

type ListLike<T> = {
  items: T[];
  query: {
    isPending: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
  };
};

function MoreButton({ query }: { query: ListLike<unknown>['query'] }) {
  return query.hasNextPage ? (
    <View style={styles.pad}>
      <Button
        label="Carregar mais"
        size="sm"
        variant="outline"
        loading={query.isFetchingNextPage}
        onPress={() => query.fetchNextPage()}
      />
    </View>
  ) : null;
}

function Lists({
  lots,
  applications,
  refunds,
}: {
  lots: ListLike<CreditLot>;
  applications: ListLike<CreditApplication>;
  refunds: ListLike<RefundObligation>;
}) {
  return (
    <>
      {refunds.items.length ? (
        <Panel title="Reembolsos deste pedido" flush>
          {refunds.items.map((r, i) => (
            <View
              key={r.id}
              style={[styles.installment, i < refunds.items.length - 1 && styles.divider]}
            >
              <View style={styles.flex}>
                <Text variant="bodyStrong">{refundLabels[r.status]}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${creditOriginLabel[r.origin]} · devolvido ${formatCents(r.refundedCents)} de ${formatCents(r.originalCents)}`}
                </Text>
              </View>
              <View style={styles.right}>
                <Text variant="figure">{formatCents(r.outstandingCents)}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  a devolver
                </Text>
              </View>
            </View>
          ))}
          <MoreButton query={refunds.query} />
        </Panel>
      ) : null}
      {applications.items.length ? (
        <Panel title="Créditos usados neste pedido" flush>
          {applications.items.map((a, i) => (
            <View
              key={a.id}
              style={[styles.installment, i < applications.items.length - 1 && styles.divider]}
            >
              <View style={styles.flex}>
                <Text variant="bodyStrong">{applicationLabels[a.status]}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`Usado em ${formatDateTime(a.createdAt)}${a.reversedCents ? ` · estornado ${formatCents(a.reversedCents)}` : ''}`}
                </Text>
              </View>
              <Text variant="figure">{formatCents(a.amountCents)}</Text>
            </View>
          ))}
          <MoreButton query={applications.query} />
        </Panel>
      ) : null}
      {lots.items.length ? (
        <Panel
          title="Créditos do cliente"
          description="Valores disponíveis para usar neste ou em outros pedidos."
          flush
        >
          {lots.items.map((l, i) => (
            <View
              key={l.id}
              style={[styles.installment, i < lots.items.length - 1 && styles.divider]}
            >
              <View style={styles.flex}>
                <Text variant="bodyStrong">{creditOriginLabel[l.origin]}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${orderCode(l.originOrderId)} · gerado em ${formatDateTime(l.createdAt)}`}
                </Text>
              </View>
              <View style={styles.right}>
                <Text variant="figure">{formatCents(l.availableCents)}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  {`de ${formatCents(l.issuedCents)}`}
                </Text>
              </View>
            </View>
          ))}
          <MoreButton query={lots.query} />
        </Panel>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: -space[4] },
  grid: { gap: space[5] },
  gridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { gap: space[5] },
  main: { flex: 3, minWidth: 0 },
  side: { flex: 2, minWidth: 0 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  installment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[5],
  },
  right: { alignItems: 'flex-end', gap: space[1] },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  totals: {
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.canvas,
  },
  pad: { padding: space[5] },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  actions: { gap: space[3] },
  actionItem: { gap: space[1], alignItems: 'flex-start' },
});
