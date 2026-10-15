import { Link, type Href } from 'expo-router';
import { toApiError } from '@/api/errors';
import { ListPanel } from '@/features/catalog/ListStates';
import { useOrder } from '@/features/orders/api';
import { Screen } from '@/layout/Screen';
import { formatCents } from '@/lib/money';
import { Alert, Button, EmptyState, Skeleton, Text } from '@/ui';
import { CircleDollarSign } from '@/ui/icons';
import { useFinancialState, usePendingExecutions } from './api';
import { FinanceNav } from './FinanceNav';
import { useReturn, useReturnHistory, useReturnPreview, useReturns } from './resolutionApi';
import { ExecutionSummary } from './ExecutionsScreen';
import { ResolutionForm } from './ResolutionForm';
import { ReconciliationPanel } from './ReconciliationPanel';

export function ReturnsScreen() {
  const list = useReturns();
  return (
    <Screen
      title="Resoluções de devoluções"
      description="Somente recebido físico oficial. Recebimento e resolução financeira são operações distintas."
    >
      <FinanceNav />
      <Alert tone="info" title="Dependência do fluxo físico">
        Esta tela consulta devoluções existentes. Intenção e recebimento físico precisam ser
        registrados pelo fluxo autorizado existente da API.
      </Alert>
      <ListPanel
        query={list.query}
        count={list.items.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title="Nenhuma devolução"
            description="Não há recebimento físico simulado."
          />
        }
      >
        {list.items.map((r) => (
          <Link key={r.id} href={`/financeiro/devolucoes/${r.id}` as Href} asChild>
            <Button label={`${r.id} · pedido ${r.orderId} · ${r.status}`} variant="outline" />
          </Link>
        ))}
      </ListPanel>
    </Screen>
  );
}
export function ReturnScreen({ id }: { id: string }) {
  const data = useReturn(id);
  return (
    <Screen
      title="Resolução financeira da devolução"
      description="Preview oficial do recebido elegível; decisões explícitas para danos."
    >
      <FinanceNav />
      {data.isPending ? (
        <Skeleton />
      ) : data.isError ? (
        <Alert
          tone="danger"
          title="Devolução indisponível"
          action={<Button label="Consultar devolução oficial" onPress={() => data.refetch()} />}
        >
          {toApiError(data.error).userMessage}
        </Alert>
      ) : (
        <>
          <Text
            selectable
          >{`Devolução ${id} · pedido ${data.data.orderId} · expedição ${data.data.dispatchReference}`}</Text>
          <Text>{`Situação ${data.data.status} · versão ${data.data.version} · atualizada ${data.data.updatedAt}`}</Text>
          {data.data.lines.map((l) => (
            <Text
              key={l.lineId}
            >{`Linha ${l.lineId}: recebido ${l.received}, pendente físico ${l.pending}, resolvido ${l.financialResolved}; valor ${formatCents(l.valueResolvedCents)}; redução de dano ${formatCents(l.damagedValueReductionCents)}`}</Text>
          ))}
          <Button
            label="Consultar devolução oficial"
            onPress={() => data.refetch()}
            variant="outline"
          />
          <ReturnWorkspace key={id} id={id} orderId={data.data.orderId} />
        </>
      )}
    </Screen>
  );
}
function ReturnWorkspace({ id, orderId }: { id: string; orderId: string }) {
  const order = useOrder(orderId),
    state = useFinancialState(orderId),
    preview = useReturnPreview(id),
    executions = usePendingExecutions(orderId),
    history = useReturnHistory(id);
  const blocked =
    executions.query.isPending ||
    executions.query.isError ||
    executions.query.isFetching ||
    !!executions.query.hasNextPage ||
    executions.items.length > 0 ||
    state.isFetching ||
    preview.isFetching ||
    order.isFetching;
  return (
    <>
      {executions.items.map((e) => (
        <ExecutionSummary key={e.id} execution={e} />
      ))}
      {executions.query.hasNextPage ? (
        <Button
          label="Consultar mais pendências"
          onPress={() => executions.query.fetchNextPage()}
        />
      ) : null}
      {order.isPending || state.isPending || preview.isPending ? (
        <Skeleton />
      ) : order.isError || state.isError || preview.isError ? (
        <Alert
          tone="danger"
          title="Preview indisponível"
          action={
            <Button
              label="Atualizar preview oficial"
              onPress={() => {
                order.refetch();
                state.refetch();
                preview.refetch();
              }}
            />
          }
        >
          {toApiError(order.error ?? state.error ?? preview.error).userMessage}
        </Alert>
      ) : (
        <ResolutionForm
          key={`${preview.data.expectedVersion}:${preview.data.expectedGuardVersion}`}
          order={order.data}
          state={state.data}
          preview={preview.data}
          blocked={blocked}
        />
      )}
      <Button
        label="Atualizar preview oficial"
        onPress={() => {
          order.refetch();
          state.refetch();
          preview.refetch();
        }}
        variant="outline"
      />
      <Text variant="h3">Histórico da devolução</Text>
      <ListPanel
        query={history.query}
        count={history.items.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title="Sem eventos"
            description="Estado materializado vem do GET da devolução."
          />
        }
      >
        {history.items.map((e) => (
          <Text
            key={e.id}
            selectable
          >{`${e.id} · sequência ${e.sequence} · ${e.type} · ${e.occurredAt} · ${e.reason}`}</Text>
        ))}
      </ListPanel>
      <Text>
        Histórico é paginado por ID. Posição na lista não indica evento mais recente. Consulte
        estado materializado.
      </Text>
      <Link href={`/financeiro/pedidos/${orderId}` as Href} asChild>
        <Button label="Abrir saldos e obrigações do pedido" variant="outline" />
      </Link>
      <ReconciliationPanel orderId={orderId} />
    </>
  );
}
