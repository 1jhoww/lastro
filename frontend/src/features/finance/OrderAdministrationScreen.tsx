import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { CreditApplication, Order, Payment, RefundObligation } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { useOrder } from '@/features/orders/api';
import { Screen } from '@/layout/Screen';
import { formatCents } from '@/lib/money';
import { Alert, Button, DataTable, EmptyState, Skeleton, Text, type Column } from '@/ui';
import { CircleDollarSign } from '@/ui/icons';
import {
  useCreditApplications,
  useCustomerCredits,
  useRefundObligations,
} from './administrationApi';
import { useFinancialState, usePayments, usePendingExecutions } from './api';
import { FinanceNav } from './FinanceNav';
import { EconomicForm } from './EconomicForm';
import { DiscountPanel } from './DiscountPanel';
import { applicationLabels } from './CreditsScreen';
import { refundLabels } from './RefundsScreen';
import { ResolutionForm } from './ResolutionForm';
import { ReconciliationPanel } from './ReconciliationPanel';
import { ExecutionSummary } from './ExecutionsScreen';

export function OrderAdministrationScreen({ id }: { id: string }) {
  const order = useOrder(id);
  const params = useLocalSearchParams<{ reembolso?: string }>();
  return (
    <Screen
      title="Administração financeira do pedido"
      description="Créditos, estornos e registro manual de reembolso. Valores e estados vêm do backend."
    >
      <FinanceNav />
      <Link href={`/pedidos/${id}` as Href} asChild>
        <Button label="Abrir pedido comercial" variant="outline" />
      </Link>
      {order.isPending ? (
        <Skeleton />
      ) : order.isError ? (
        <Alert
          tone="danger"
          title="Pedido indisponível"
          action={<Button label="Recarregar pedido" onPress={() => order.refetch()} />}
        >
          {toApiError(order.error).userMessage}
        </Alert>
      ) : (
        <>
          <Text variant="bodyStrong">{order.data.customerName ?? 'Sem cliente'}</Text>
          <DiscountPanel key={id} order={order.data} />
          {order.data.confirmedAt ? (
            <OrderWorkspace order={order.data} defaultRefundId={params.reembolso ?? ''} />
          ) : (
            <Text>
              Créditos, recebimentos e reembolsos exigem pedido confirmado. Desconto administrativo
              é exclusivo do rascunho.
            </Text>
          )}
        </>
      )}
    </Screen>
  );
}
function OrderWorkspace({ order, defaultRefundId }: { order: Order; defaultRefundId: string }) {
  const state = useFinancialState(order.id);
  const payments = usePayments(order.id);
  const lots = useCustomerCredits(order.customerId ?? '');
  const applications = useCreditApplications({ orderId: order.id });
  const refunds = useRefundObligations({ orderId: order.id });
  const executions = usePendingExecutions(order.id);
  const blocked =
    executions.query.isPending ||
    executions.query.isError ||
    executions.query.isFetching ||
    Boolean(executions.query.hasNextPage) ||
    executions.items.length > 0 ||
    state.isFetching;
  const paymentColumns: Column<Payment>[] = [
    { key: 'id', label: 'Recebimento', flex: 2, render: (p) => <Text selectable>{p.id}</Text> },
    {
      key: 'amount',
      label: 'Original',
      width: 120,
      render: (p) => <Text>{formatCents(p.amountCents)}</Text>,
    },
    {
      key: 'method',
      label: 'Forma histórica',
      flex: 2,
      render: (p) => <Text>{p.method.name}</Text>,
    },
    {
      key: 'allocated',
      label: 'Alocações reversíveis',
      flex: 3,
      render: (p) => (
        <View>
          {p.allocations.map((a) => (
            <Text
              key={a.receivableId}
              selectable
            >{`${a.receivableId} · ${formatCents(a.remainingCents)}`}</Text>
          ))}
        </View>
      ),
    },
  ];
  const applicationColumns: Column<CreditApplication>[] = [
    { key: 'id', label: 'Aplicação', flex: 2, render: (a) => <Text selectable>{a.id}</Text> },
    {
      key: 'status',
      label: 'Situação',
      width: 100,
      render: (a) => <Text>{applicationLabels[a.status]}</Text>,
    },
    {
      key: 'lot',
      label: 'Fonte original',
      flex: 2,
      render: (a) => <Text selectable>{a.creditLotId}</Text>,
    },
    {
      key: 'amount',
      label: 'Aplicado / estornado / restaurado',
      flex: 2,
      render: (a) => (
        <Text>{`${formatCents(a.amountCents)} / ${formatCents(a.reversedCents)} / ${formatCents(a.restoredByCancellationCents)}`}</Text>
      ),
    },
  ];
  const refundColumns: Column<RefundObligation>[] = [
    { key: 'id', label: 'Obrigação', flex: 2, render: (r) => <Text selectable>{r.id}</Text> },
    {
      key: 'status',
      label: 'Situação',
      flex: 2,
      render: (r) => <Text>{refundLabels[r.status]}</Text>,
    },
    {
      key: 'remaining',
      label: 'Pendente',
      width: 120,
      render: (r) => <Text>{formatCents(r.outstandingCents)}</Text>,
    },
    {
      key: 'refunded',
      label: 'Confirmado manualmente',
      width: 175,
      render: (r) => <Text>{formatCents(r.refundedCents)}</Text>,
    },
  ];
  const empty = (title: string) => (
    <EmptyState
      icon={CircleDollarSign}
      title={title}
      description="Nenhum registro nesta página. Continuação usa cursor do servidor."
    />
  );
  return (
    <>
      <Button
        label="Atualizar operações e saldos"
        variant="outline"
        loading={state.isFetching}
        onPress={() => {
          state.refetch();
          payments.query.refetch();
          lots.query.refetch();
          applications.query.refetch();
          refunds.query.refetch();
          executions.query.refetch();
        }}
      />
      {executions.query.isError ? (
        <Alert tone="warning" title="Pendências indisponíveis">
          {toApiError(executions.query.error).userMessage}
        </Alert>
      ) : null}
      {executions.items.map((e) => (
        <ExecutionSummary key={e.id} execution={e} />
      ))}
      {executions.query.hasNextPage ? (
        <Button
          label="Consultar mais pendências"
          onPress={() => executions.query.fetchNextPage()}
        />
      ) : null}
      {state.isPending ? (
        <Skeleton />
      ) : state.isError ? (
        <Alert tone="danger" title="Saldos indisponíveis">
          {toApiError(state.error).userMessage}
        </Alert>
      ) : (
        <>
          <ResolutionForm order={order} state={state.data} blocked={blocked} />
          <EconomicForm
            state={state.data}
            lots={lots.items}
            payments={payments.items}
            applications={applications.items}
            refunds={refunds.items}
            blocked={blocked}
            settlementAllowed={order.status === 'confirmed' || order.status === 'dispatched'}
            defaultRefundId={defaultRefundId}
          />
        </>
      )}
      <Text variant="h3">Fontes do cliente</Text>
      <ListPanel
        query={lots.query}
        count={lots.items.length}
        empty={empty('Nenhuma fonte de crédito')}
      >
        {lots.items.map((l) => (
          <Text
            key={l.id}
            selectable
          >{`Fonte ${l.id} · disponível ${formatCents(l.availableCents)} · aplicado ${formatCents(l.appliedCents)} · origem ${l.originOrderId}`}</Text>
        ))}
      </ListPanel>
      <Text variant="h3">Recebimentos e parcelas reversíveis</Text>
      <ListPanel
        query={payments.query}
        count={payments.items.length}
        empty={empty('Nenhum recebimento do pedido')}
      >
        <DataTable
          label="Recebimentos elegíveis"
          rows={payments.items}
          keyOf={(p) => p.id}
          columns={paymentColumns}
          renderCompact={(p) => (
            <View>
              <Text variant="bodyStrong">{`${p.method.name} · ${formatCents(p.amountCents)}`}</Text>
              <Text>{`Estornado ${formatCents(p.reversedCents)} · destinado ${formatCents(p.transferredCents)}`}</Text>
              {p.allocations.map((a) => (
                <Text
                  key={a.receivableId}
                  selectable
                >{`Parcela ${a.receivableId}: reversível ${formatCents(a.remainingCents)}`}</Text>
              ))}
              <Text variant="caption" selectable>
                {p.id}
              </Text>
            </View>
          )}
        />
      </ListPanel>
      <Text variant="h3">Aplicações de crédito do pedido</Text>
      <ListPanel
        query={applications.query}
        count={applications.items.length}
        empty={empty('Nenhuma aplicação do pedido')}
      >
        <DataTable
          label="Aplicações do pedido"
          rows={applications.items}
          keyOf={(a) => a.id}
          columns={applicationColumns}
          renderCompact={(a) => (
            <View>
              <Text variant="bodyStrong">{`${applicationLabels[a.status]} · ${formatCents(a.amountCents)}`}</Text>
              <Text>{`Estornado ${formatCents(a.reversedCents)} · restaurado ${formatCents(a.restoredByCancellationCents)}`}</Text>
              <Text
                variant="caption"
                selectable
              >{`Aplicação ${a.id} · fonte ${a.creditLotId}`}</Text>
            </View>
          )}
        />
      </ListPanel>
      <Text variant="h3">Obrigações do pedido</Text>
      <ListPanel
        query={refunds.query}
        count={refunds.items.length}
        empty={empty('Nenhuma obrigação do pedido')}
      >
        <DataTable
          label="Obrigações do pedido"
          rows={refunds.items}
          keyOf={(r) => r.id}
          columns={refundColumns}
          renderCompact={(r) => (
            <View>
              <Text variant="bodyStrong">{`${refundLabels[r.status]} · pendente ${formatCents(r.outstandingCents)}`}</Text>
              <Text>{`Confirmado manualmente ${formatCents(r.refundedCents)}`}</Text>
              <Text variant="caption" selectable>
                {r.id}
              </Text>
            </View>
          )}
        />
      </ListPanel>
      <Link href={`/financeiro?pedido=${order.id}` as Href} asChild>
        <Button label="Abrir títulos e histórico financeiro" variant="outline" />
      </Link>
      <Link href={'/financeiro/devolucoes' as Href} asChild>
        <Button label="Consultar resoluções de devoluções" variant="outline" />
      </Link>
      <ReconciliationPanel orderId={order.id} />
    </>
  );
}
