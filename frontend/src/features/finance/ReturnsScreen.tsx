import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { ReturnView } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { useOrder } from '@/features/orders/api';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { color, space } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  Disclosure,
  EmptyState,
  Panel,
  Skeleton,
  Text,
  type BadgeTone,
} from '@/ui';
import { RefreshCw, Undo2 } from '@/ui/icons';
import { useFinancialState, usePendingExecutions } from './api';
import { Guidance, RowLink } from './FinanceParts';
import { FinanceNav } from './FinanceNav';
import { orderCode } from './presentation';
import { useReturn, useReturnHistory, useReturnPreview, useReturns } from './resolutionApi';
import { ExecutionSummary } from './ExecutionsScreen';
import { ResolutionForm } from './ResolutionForm';
import { ReconciliationPanel } from './ReconciliationPanel';

/**
 * Situação apresentada a partir do estado materializado da devolução. Recebimento físico e
 * acerto financeiro são etapas distintas; nenhuma é presumida pela outra.
 */
export function returnStage(r: Pick<ReturnView, 'status' | 'lines'>): {
  label: string;
  tone: BadgeTone;
} {
  const received = r.lines.reduce((a, l) => a + Number(l.received), 0);
  const financialPending = r.lines.some((l) => Number(l.received) > Number(l.financialResolved));
  if (r.status === 'pending' && received === 0)
    return { label: 'Aguardando recebimento físico', tone: 'warning' };
  if (financialPending) return { label: 'Resolução financeira pendente', tone: 'warning' };
  if (r.status === 'partially_received')
    return { label: 'Recebida em parte · restante a receber', tone: 'neutral' };
  if (r.status === 'closed' || received > 0)
    return { label: 'Resolução concluída', tone: 'success' };
  return { label: 'Recebida fisicamente', tone: 'neutral' };
}

const eventLabels: Record<string, string> = {
  intent: 'Devolução solicitada',
  edited: 'Devolução alterada',
  canceled: 'Devolução cancelada',
  received: 'Mercadoria recebida fisicamente',
  resolved: 'Acerto financeiro registrado',
};

export function ReturnsScreen() {
  const list = useReturns();
  return (
    <Screen
      title="Devoluções de mercadoria"
      description="Acerto financeiro das devoluções já recebidas fisicamente."
    >
      <FinanceNav />
      <Guidance>
        A devolução é registrada e recebida pelo fluxo de pedidos. Aqui você faz o acerto financeiro
        do que já chegou: o valor vira crédito do cliente ou reembolso a fazer, conforme a escolha.
      </Guidance>
      <ListPanel
        query={list.query}
        count={list.items.length}
        empty={
          <EmptyState
            icon={Undo2}
            title="Nenhuma devolução"
            description="Devoluções registradas nos pedidos aparecem aqui."
          />
        }
      >
        <View style={styles.list}>
          {list.items.map((r) => {
            const stage = returnStage(r);
            return (
              <RowLink key={r.id} href={`/financeiro/devolucoes/${r.id}` as Href}>
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Text variant="bodyStrong">{`Devolução do ${orderCode(r.orderId)}`}</Text>
                    <Text variant="small" color={color.textSecondary}>
                      {`Atualizada em ${formatDateTime(r.updatedAt)}`}
                    </Text>
                  </View>
                  <Badge label={stage.label} tone={stage.tone} />
                </View>
              </RowLink>
            );
          })}
        </View>
      </ListPanel>
    </Screen>
  );
}

export function ReturnScreen({ id }: { id: string }) {
  const data = useReturn(id);
  return (
    <Screen
      title="Acerto da devolução"
      description="O que voltou, o que já foi acertado no financeiro e o que falta."
    >
      <FinanceNav />
      {data.isPending ? (
        <Skeleton height={120} />
      ) : data.isError ? (
        <Alert
          tone="danger"
          title="Devolução indisponível"
          action={<Button label="Tentar de novo" size="sm" onPress={() => data.refetch()} />}
        >
          {toApiError(data.error).userMessage}
        </Alert>
      ) : (
        <>
          <Panel>
            <View style={styles.head}>
              <View style={styles.flex}>
                <Text variant="h2">{`Devolução do ${orderCode(data.data.orderId)}`}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`Atualizada em ${formatDateTime(data.data.updatedAt)} · motivo: ${data.data.reason}`}
                </Text>
              </View>
              <Badge {...returnStage(data.data)} />
            </View>
            {data.data.lines.map((l, i) => (
              <View key={l.lineId} style={[styles.line, styles.divider]}>
                <Text variant="bodyStrong">{`Item ${i + 1}`}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`Recebido ${l.received} de ${l.requested} ${l.unit}${Number(l.damagedReceived) ? ` (${l.damagedReceived} com avaria)` : ''} · falta receber ${l.pending}`}
                </Text>
                <Text variant="small" color={color.textSecondary}>
                  {`Acertado no financeiro: ${l.financialResolved} ${l.unit} · ${formatCents(l.valueResolvedCents)}${l.damagedValueReductionCents ? ` · redução por avaria ${formatCents(l.damagedValueReductionCents)}` : ''}`}
                </Text>
              </View>
            ))}
            <View style={styles.links}>
              <Button
                label="Atualizar"
                icon={RefreshCw}
                size="sm"
                variant="ghost"
                onPress={() => data.refetch()}
              />
              <Link href={`/financeiro/pedidos/${data.data.orderId}` as Href} asChild>
                <Button label="Créditos e reembolsos do pedido" size="sm" variant="outline" />
              </Link>
            </View>
          </Panel>
          <ReturnWorkspace key={id} id={id} orderId={data.data.orderId} />
          <Disclosure label="Detalhes técnicos">
            <Text variant="caption" color={color.textSecondary} selectable>
              {`Devolução ${id} · pedido ${data.data.orderId} · expedição ${data.data.dispatchReference} · situação ${data.data.status} · versão ${data.data.version}`}
            </Text>
          </Disclosure>
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
  const reload = () => {
    order.refetch();
    state.refetch();
    preview.refetch();
  };
  return (
    <>
      {executions.items.length ? (
        <Alert tone="warning" title="Operação em andamento neste pedido">
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
      {order.isPending || state.isPending || preview.isPending ? (
        <Skeleton height={120} />
      ) : order.isError || state.isError || preview.isError ? (
        <Alert
          tone="danger"
          title="Não foi possível calcular o acerto"
          action={<Button label="Tentar de novo" size="sm" onPress={reload} />}
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
      <Panel title="Histórico da devolução" flush>
        <ListPanelBody history={history} />
      </Panel>
      <Disclosure label="Verificação técnica" summary="integridade dos registros">
        <ReconciliationPanel orderId={orderId} />
      </Disclosure>
    </>
  );
}

function ListPanelBody({ history }: { history: ReturnType<typeof useReturnHistory> }) {
  if (history.query.isPending)
    return (
      <View style={styles.pad}>
        <Skeleton height={18} />
      </View>
    );
  if (history.query.isError)
    return (
      <View style={styles.pad}>
        <Alert
          tone="danger"
          title="Não foi possível carregar o histórico"
          action={
            <Button label="Tentar de novo" size="sm" onPress={() => history.query.refetch()} />
          }
        >
          {toApiError(history.query.error).userMessage}
        </Alert>
      </View>
    );
  return (
    <>
      {history.items.length === 0 ? (
        <View style={styles.pad}>
          <Text variant="small" color={color.textSecondary}>
            Sem eventos registrados.
          </Text>
        </View>
      ) : (
        history.items.map((e, i) => (
          <View key={e.id} style={[styles.line, i < history.items.length - 1 && styles.divider]}>
            <Text variant="bodyStrong">{eventLabels[e.type] ?? e.type}</Text>
            <Text variant="small" color={color.textSecondary}>
              {`${formatDateTime(e.occurredAt)} · ${e.reason}`}
            </Text>
          </View>
        ))
      )}
      {history.query.hasNextPage ? (
        <View style={styles.pad}>
          <Button
            label="Carregar mais"
            size="sm"
            variant="outline"
            loading={history.query.isFetchingNextPage}
            onPress={() => history.query.fetchNextPage()}
          />
        </View>
      ) : null}
      <View style={styles.pad}>
        <Text variant="caption" color={color.textSecondary}>
          A ordem da lista não indica o evento mais recente; a situação atual está no resumo acima.
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space[5], paddingVertical: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    paddingVertical: space[2],
  },
  line: { paddingVertical: space[3], paddingHorizontal: space[1], gap: 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] },
  pad: { padding: space[5] },
});
