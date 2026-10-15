import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { FinancialEvent, Payment, Receivable } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { executionStatusLabel, formatCalendarDate, todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { space } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Panel,
  Skeleton,
  Text,
  type Column,
} from '@/ui';
import { CircleDollarSign } from '@/ui/icons';
import {
  useFinancialHistory,
  useFinancialState,
  usePayments,
  usePendingExecutions,
  useReceivable,
} from './api';
import { ReceiptForm } from './ReceiptForm';
import { isOverdue, titleLabels } from './rules';

export function ReceivableScreen({ id }: { id: string }) {
  const title = useReceivable(id);
  return (
    <Screen
      title="Título a receber"
      description="Valores oficiais da parcela e histórico financeiro do pedido."
      actions={
        <Link href="/financeiro" asChild>
          <Button label="Voltar aos títulos" variant="outline" />
        </Link>
      }
    >
      {title.isPending ? (
        <Skeleton />
      ) : title.isError ? (
        <Alert
          tone="danger"
          title="Título indisponível"
          action={<Button label="Recarregar título" onPress={() => title.refetch()} />}
        >
          {toApiError(title.error).userMessage}
        </Alert>
      ) : (
        <TitleDetail title={title.data} onRefreshTitle={() => title.refetch()} />
      )}
    </Screen>
  );
}

function TitleDetail({ title, onRefreshTitle }: { title: Receivable; onRefreshTitle: () => void }) {
  const state = useFinancialState(title.orderId);
  const payments = usePayments(title.orderId);
  const history = useFinancialHistory(title.orderId);
  const executions = usePendingExecutions(title.orderId);
  const tenant = useTenant();
  const today = tenant.data ? todayIn(tenant.data.timezone) : null;
  const blocked =
    executions.query.isPending ||
    executions.query.isError ||
    executions.query.isFetching ||
    executions.items.length > 0 ||
    Boolean(executions.query.hasNextPage) ||
    state.isFetching ||
    (state.data?.activeReturnCount ?? 0) > 0;
  const amounts = [
    ['Original', title.originalCents],
    ['Recebido em dinheiro', title.cashCents],
    ['Liquidado por crédito', title.creditCents],
    ['Cancelado', title.canceledCents],
    ['Saldo', title.outstandingCents],
  ] as const;
  const paymentColumns: Column<Payment>[] = [
    {
      key: 'date',
      label: 'Recebido em',
      width: 120,
      render: (p) => <Text>{formatCalendarDate(p.receivedOn)}</Text>,
    },
    {
      key: 'amount',
      label: 'Recebimento',
      width: 130,
      render: (p) => <Text>{formatCents(p.amountCents)}</Text>,
    },
    { key: 'method', label: 'Forma efetiva', flex: 2, render: (p) => <Text>{p.method.name}</Text> },
    {
      key: 'reversed',
      label: 'Estornado',
      width: 120,
      render: (p) => <Text>{formatCents(p.reversedCents)}</Text>,
    },
    {
      key: 'transferred',
      label: 'Destinado',
      width: 120,
      render: (p) => <Text>{formatCents(p.transferredCents)}</Text>,
    },
    { key: 'ref', label: 'Referência', flex: 2, render: (p) => <Text>{p.reference || '—'}</Text> },
    {
      key: 'allocations',
      label: 'Alocações',
      flex: 3,
      render: (p) => (
        <View>
          {p.allocations.map((a) => (
            <Text
              key={a.receivableId}
              variant="small"
              selectable
            >{`${a.receivableId}: ${formatCents(a.amountCents)} · remanescente ${formatCents(a.remainingCents)}`}</Text>
          ))}
        </View>
      ),
    },
  ];
  const eventColumns: Column<FinancialEvent>[] = [
    {
      key: 'sequence',
      label: 'Sequência',
      width: 90,
      render: (e) => <Text>{String(e.sequence)}</Text>,
    },
    { key: 'type', label: 'Evento', flex: 2, render: (e) => <Text>{eventLabels[e.type]}</Text> },
    {
      key: 'amount',
      label: 'Valor',
      width: 130,
      render: (e) => <Text>{formatCents(e.amountCents)}</Text>,
    },
    { key: 'reason', label: 'Motivo', flex: 2, render: (e) => <Text>{e.reason}</Text> },
    {
      key: 'date',
      label: 'Registrado em',
      width: 160,
      render: (e) => <Text>{formatDateTime(e.occurredAt)}</Text>,
    },
  ];
  return (
    <>
      <Button
        label="Atualizar estado financeiro"
        variant="outline"
        loading={state.isFetching || executions.query.isFetching}
        onPress={() => {
          onRefreshTitle();
          state.refetch();
          payments.query.refetch();
          history.query.refetch();
          executions.query.refetch();
        }}
      />
      <Panel
        title={`${title.customerName} · ${title.installmentNumber}ª parcela`}
        description={`Vencimento ${formatCalendarDate(title.dueDate)}`}
      >
        <View style={styles.row}>
          <Badge
            label={titleLabels[title.status]}
            tone={title.status === 'paid' ? 'success' : 'neutral'}
          />
          {today && isOverdue(title, today) ? <Badge label="Vencido" tone="danger" /> : null}
        </View>
        {amounts.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text>{label}</Text>
            <Text variant="figure">{formatCents(value)}</Text>
          </View>
        ))}
        <Text variant="caption" selectable>{`Título ${title.id} · Pedido ${title.orderId}`}</Text>
        <Link href={`/pedidos/${title.orderId}` as Href} asChild>
          <Button label="Abrir pedido" variant="outline" />
        </Link>
        <Link href={`/financeiro/pedidos/${title.orderId}` as Href} asChild>
          <Button label="Créditos, estornos e reembolsos do pedido" variant="outline" />
        </Link>
      </Panel>
      {executions.query.isError ? (
        <Alert
          tone="warning"
          title="Pendências indisponíveis"
          action={
            <Button label="Recarregar pendências" onPress={() => executions.query.refetch()} />
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
        >{`${e.id} · ${executionStatusLabel[e.status]}. Execução exige acompanhamento administrativo. HTTP 202 não confirma publicação.`}</Alert>
      ))}
      {executions.query.hasNextPage ? (
        <Button
          label="Consultar mais pendências"
          variant="outline"
          onPress={() => executions.query.fetchNextPage()}
          loading={executions.query.isFetchingNextPage}
        />
      ) : null}
      {state.isPending ? (
        <Skeleton />
      ) : state.isError ? (
        <Alert
          tone="danger"
          title="Saldos indisponíveis"
          action={<Button label="Recarregar saldos" onPress={() => state.refetch()} />}
        >
          {toApiError(state.error).userMessage}
        </Alert>
      ) : (
        <>
          <Panel
            title="Parcelas do pedido"
            description="Saldos individuais fornecidos pelo servidor."
          >
            {state.data.titles.map((t) => (
              <View key={t.id} style={styles.row}>
                <Link href={`/financeiro/${t.id}` as Href}>
                  <Text>{`${t.installmentNumber}ª · ${formatCalendarDate(t.dueDate)} · ${titleLabels[t.status]}`}</Text>
                </Link>
                <Text>{formatCents(t.outstandingCents)}</Text>
              </View>
            ))}
          </Panel>
          <ReceiptForm title={title} state={state.data} blocked={blocked} />
        </>
      )}
      <Text variant="h3">Recebimentos do pedido</Text>
      <ListPanel
        query={payments.query}
        count={payments.items.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title="Nenhum recebimento"
            description="Histórico do pedido inteiro. Cada recebimento mostra sua alocação nas parcelas."
          />
        }
      >
        <DataTable
          label="Recebimentos do pedido"
          rows={payments.items}
          keyOf={(p) => p.id}
          columns={paymentColumns}
          renderCompact={(p) => (
            <View style={styles.compact}>
              <Text variant="bodyStrong">{`${formatCents(p.amountCents)} · ${p.method.name}`}</Text>
              <Text>{`Recebido ${formatCalendarDate(p.receivedOn)} · ${p.reference || 'Sem referência'}`}</Text>
              <Text>{`Estornado ${formatCents(p.reversedCents)} · Destinado ${formatCents(p.transferredCents)}`}</Text>
              {p.allocations.map((a) => (
                <Text
                  key={a.receivableId}
                  variant="small"
                  selectable
                >{`Título ${a.receivableId}: ${formatCents(a.amountCents)} · remanescente ${formatCents(a.remainingCents)}`}</Text>
              ))}
            </View>
          )}
        />
      </ListPanel>
      <Text variant="h3">Histórico financeiro do pedido</Text>
      <ListPanel
        query={history.query}
        count={history.items.length}
        empty={
          <EmptyState
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
            <View style={styles.compact}>
              <Text variant="bodyStrong">{`${eventLabels[e.type]} · ${formatCents(e.amountCents)}`}</Text>
              <Text>{e.reason}</Text>
              <Text variant="small">{`${formatDateTime(e.occurredAt)} · sequência ${e.sequence}`}</Text>
              <Text variant="caption" selectable>{`Operação ${e.operationId}`}</Text>
            </View>
          )}
        />
      </ListPanel>
    </>
  );
}
const eventLabels: Record<FinancialEvent['type'], string> = {
  receipt: 'Recebimento',
  payment_reversal: 'Estorno de recebimento',
  credit_application: 'Aplicação de crédito',
  credit_reversal: 'Estorno de crédito',
  financial_cancellation: 'Cancelamento financeiro',
  refund: 'Reembolso manual registrado',
  return_intent: 'Intenção de devolução',
  return_edited: 'Devolução editada',
  return_canceled: 'Devolução cancelada',
  return_received: 'Devolução recebida fisicamente',
  return_resolved: 'Devolução resolvida',
};
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space[2],
    paddingVertical: space[2],
  },
  compact: { gap: space[2], flex: 1 },
});
