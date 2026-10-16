import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Order, ReturnView } from '@/api/types';
import { useFinancialState, usePendingExecutions } from '@/features/finance/api';
import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { useReturn, useReturnHistory, useReturns } from '@/features/finance/resolutionApi';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { intentScope, useOtherOrderIntent, usePendingIntent } from '@/lib/intent';
import { formatQuantity, fromApiQuantity, parseQuantityInput, toApiQuantity } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Disclosure,
  Panel,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { useOrder } from './api';
import { shortOrderId } from './rules';
import { useReturnCommand, type ReturnCommand } from './returnCommands';

const statusLabels = {
  pending: 'Aguardando recebimento',
  partially_received: 'Recebimento parcial',
  received: 'Mercadoria recebida',
  closed: 'Encerrada',
} as const;
const events: Record<string, string> = {
  intent: 'Devolução solicitada',
  edited: 'Solicitação alterada',
  canceled: 'Pendência cancelada',
  received: 'Recebimento físico registrado',
  resolved: 'Resolução financeira registrada',
};

export function OrderReturns({ id }: { id: string }) {
  return (
    <FinanceAccess permission="returns:manage">
      <ReturnsWorkspace id={id} />
    </FinanceAccess>
  );
}

function ReturnsWorkspace({ id }: { id: string }) {
  const order = useOrder(id);
  const list = useReturns(id);
  const [selected, select] = useState<string | null>(null);
  return (
    <Screen
      title="Devoluções do pedido"
      description={
        order.data
          ? `${shortOrderId(order.data.commercialId)} · ${order.data.customerName}`
          : undefined
      }
    >
      <Link href={`/pedidos/${id}` as Href} asChild>
        <Button label="Voltar ao pedido" variant="ghost" />
      </Link>
      {order.isError ? (
        <Alert tone="danger" title="Pedido indisponível">
          {toApiError(order.error).userMessage}
        </Alert>
      ) : !order.data ? (
        <Text>Carregando pedido…</Text>
      ) : order.data.status !== 'dispatched' ? (
        <Alert tone="warning" title="Pedido sem saída registrada">
          A devolução física exige saída registrada.
        </Alert>
      ) : (
        <>
          <Panel title="Devoluções registradas">
            {list.query.isError ? (
              <Alert tone="danger" title="Lista indisponível">
                {toApiError(list.query.error).userMessage}
              </Alert>
            ) : list.query.isPending ? (
              <Text>Carregando devoluções…</Text>
            ) : list.items.length === 0 ? (
              <Text>Nenhuma devolução registrada.</Text>
            ) : (
              list.items.map((r) => (
                <View key={r.id} style={{ gap: 8, paddingVertical: 8 }}>
                  <Badge
                    label={statusLabels[r.status]}
                    tone={r.status === 'closed' ? 'neutral' : 'warning'}
                  />
                  <Text>
                    {formatDateTime(r.createdAt)} · {r.reason}
                  </Text>
                  <Button
                    label={`Abrir devolução de ${formatDateTime(r.createdAt)}`}
                    size="sm"
                    variant="outline"
                    onPress={() => select(r.id)}
                  />
                </View>
              ))
            )}
            {list.query.hasNextPage ? (
              <Button
                label="Mais devoluções"
                loading={list.query.isFetchingNextPage}
                onPress={() => list.query.fetchNextPage()}
              />
            ) : null}
            {selected ? (
              <Button label="Nova devolução" variant="outline" onPress={() => select(null)} />
            ) : null}
          </Panel>
          {selected ? (
            <ReturnDetail key={selected} id={selected} order={order.data} />
          ) : (
            <PhysicalForm key="new" order={order.data} onCreated={select} />
          )}
        </>
      )}
    </Screen>
  );
}

function ReturnDetail({ id, order }: { id: string; order: Order }) {
  const record = useReturn(id);
  if (record.isError)
    return (
      <Alert tone="danger" title="Devolução indisponível">
        {toApiError(record.error).userMessage}
      </Alert>
    );
  if (!record.data) return <Text>Carregando devolução…</Text>;
  const r = record.data;
  return (
    <>
      <Panel title="Situação da devolução">
        <Badge label={statusLabels[r.status]} tone="neutral" />
        <Text>{r.reason}</Text>
        {r.lines.map((line) => (
          <View key={line.lineId} style={{ gap: 4, paddingVertical: 8 }}>
            <Text variant="bodyStrong">
              {order.lines.find((l) => l.id === line.lineId)?.name ?? 'Produto do pedido'}
            </Text>
            <Text>{`Solicitado: ${line.requested} ${line.unit} · Recebido: ${line.received} · A receber: ${line.pending}`}</Text>
            <Text>{`Vendável: ${line.sellableReceived} · Danificado: ${line.damagedReceived} · Resolvido financeiramente: ${line.financialResolved}`}</Text>
          </View>
        ))}
        <Link href={`/financeiro/devolucoes/${id}` as Href} asChild>
          <Button label="Consultar resolução financeira" variant="outline" />
        </Link>
        <Text variant="small">
          Recebimento físico não gera crédito nem confirma reembolso. O acerto ocorre no Financeiro.
        </Text>
      </Panel>
      {r.lines.some((l) => fromApiQuantity(l.pending) > 0) ? (
        <PhysicalForm key={r.id} order={order} record={r} />
      ) : null}
      <Disclosure label="Histórico da devolução">
        <ReturnHistory id={id} />
      </Disclosure>
    </>
  );
}

function ReturnHistory({ id }: { id: string }) {
  const history = useReturnHistory(id);
  return (
    <View style={{ gap: 12 }}>
      {history.query.isError ? (
        <Alert tone="danger" title="Histórico indisponível">
          {toApiError(history.query.error).userMessage}
        </Alert>
      ) : history.query.isPending ? (
        <Text>Carregando histórico…</Text>
      ) : (
        history.items.map((event) => (
          <View key={event.id}>
            <Text variant="bodyStrong">{events[event.type] ?? event.type}</Text>
            <Text variant="small">
              {formatDateTime(event.occurredAt)} · {event.reason}
            </Text>
            <Text variant="caption">Responsável: {event.actorUid}</Text>
          </View>
        ))
      )}
      {history.query.hasNextPage ? (
        <Button
          label="Mais eventos"
          onPress={() => history.query.fetchNextPage()}
          loading={history.query.isFetchingNextPage}
        />
      ) : null}
    </View>
  );
}

function PhysicalForm({
  order,
  record,
  onCreated,
}: {
  order: Order;
  record?: ReturnView;
  onCreated?: (id: string) => void;
}) {
  const session = useSession();
  const scope = intentScope(session.user!.uid, session.tenantId!, 'return-command', order.id);
  const pending = usePendingIntent(scope);
  const other = useOtherOrderIntent(
    session.user!.uid,
    session.tenantId!,
    order.id,
    'return-command',
  );
  const finance = useFinancialState(order.id);
  const executions = usePendingExecutions(order.id);
  const command = useReturnCommand(scope);
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [review, setReview] = useState<ReturnCommand | null>(null);
  const locked =
    command.isPending ||
    !!pending ||
    !!other ||
    finance.isFetching ||
    !finance.data ||
    finance.isError ||
    executions.query.isFetching ||
    executions.query.isError ||
    executions.items.length > 0 ||
    !!executions.query.hasNextPage;
  const prepare = (cancel = false) => {
    setError('');
    if (reason.trim().length < 3) {
      setError('Informe um motivo com pelo menos 3 caracteres.');
      return;
    }
    if (!finance.data || locked) return;
    const versions = {
      expectedOrderVersion: order.version,
      expectedGuardVersion: finance.data.guardVersion,
      reason: reason.trim(),
    };
    if (record && cancel) {
      setReview({
        kind: 'cancel',
        id: record.id,
        orderId: order.id,
        body: { ...versions, expectedVersion: record.version },
      });
      return;
    }
    const lines: { lineId: string; quantity: string }[] = [];
    const received: { lineId: string; sellableQuantity?: string; damagedQuantity?: string }[] = [];
    for (const line of order.lines) {
      const sellable = parseQuantityInput(quantities[line.id] || '0', line.unit);
      const damage = record ? parseQuantityInput(damaged[line.id] || '0', line.unit) : 0;
      const max = record
        ? fromApiQuantity(record.lines.find((l) => l.lineId === line.id)?.pending ?? '0')
        : fromApiQuantity(line.quantity);
      if (sellable === null || damage === null || sellable + damage > max) {
        setError(
          `Confira a quantidade de ${line.name}. Limite: ${formatQuantity(max, line.unit)}.`,
        );
        return;
      }
      if (sellable + damage === 0) continue;
      if (record)
        received.push({
          lineId: line.id,
          ...(sellable ? { sellableQuantity: toApiQuantity(sellable) } : {}),
          ...(damage ? { damagedQuantity: toApiQuantity(damage) } : {}),
        });
      else lines.push({ lineId: line.id, quantity: toApiQuantity(sellable) });
    }
    if (!lines.length && !received.length) {
      setError('Informe a quantidade de pelo menos um produto.');
      return;
    }
    setReview(
      record
        ? {
            kind: 'receive',
            id: record.id,
            orderId: order.id,
            body: { ...versions, expectedVersion: record.version, lines: received },
          }
        : { kind: 'create', id: order.id, orderId: order.id, body: { ...versions, lines } },
    );
  };
  const send = (c: ReturnCommand) =>
    command.mutate(c, {
      onSuccess: (result) => {
        setReview(null);
        setReason('');
        setQuantities({});
        setDamaged({});
        toast.show(
          c.kind === 'create'
            ? 'Devolução registrada!'
            : c.kind === 'cancel'
              ? 'Pendência cancelada!'
              : 'Recebimento físico registrado!',
        );
        if (c.kind === 'create') onCreated?.(result.returnId);
      },
      onError: () => setReview(null),
    });
  return (
    <Panel title={record ? 'Receber mercadoria' : 'Registrar devolução'}>
      {pending ? (
        <Alert
          tone="warning"
          title="Resultado ainda desconhecido"
          action={
            <Button
              label="Consultar com a mesma operação"
              onPress={() => send(pending.body as ReturnCommand)}
              loading={command.isPending}
            />
          }
        >
          A conexão não confirmou o resultado. A repetição usa a mesma chave para não duplicar a
          devolução ou a entrada.
        </Alert>
      ) : null}
      {other || executions.items.length || executions.query.hasNextPage ? (
        <Alert tone="warning" title="Operação pendente">
          Conclua a operação financeira deste pedido antes de continuar.
        </Alert>
      ) : null}
      {finance.isError || executions.query.isError ? (
        <Alert
          tone="danger"
          title="Não foi possível verificar o pedido"
          action={
            <Button
              label="Tentar novamente"
              onPress={() => {
                void finance.refetch();
                void executions.query.refetch();
              }}
            />
          }
        >
          As ações ficam bloqueadas até consultar a situação atual.
        </Alert>
      ) : null}
      <Text variant="small">
        {record
          ? 'Informe somente o que chegou agora. Produtos danificados não entram no estoque vendável.'
          : 'Informe o que será devolvido. O estoque muda somente após registrar o recebimento físico. O limite cumulativo é validado ao salvar.'}
      </Text>
      {order.lines
        .filter(
          (l) =>
            !record ||
            record.lines.some((r) => r.lineId === l.id && fromApiQuantity(r.pending) > 0),
        )
        .map((line) => (
          <View key={line.id} style={{ gap: 8, paddingVertical: 12 }}>
            <Text variant="bodyStrong">{line.name}</Text>
            <Text variant="small">
              {record
                ? `A receber: ${record.lines.find((l) => l.lineId === line.id)?.pending}`
                : `Saída registrada: ${line.quantity}`}{' '}
              {line.unit}
            </Text>
            <TextField
              label={`${record ? 'Vendável' : 'Quantidade'} · ${line.name}`}
              value={quantities[line.id] ?? ''}
              inputMode="decimal"
              placeholder="0"
              editable={!locked}
              onChangeText={(v) => setQuantities((q) => ({ ...q, [line.id]: v }))}
            />
            {record ? (
              <TextField
                label={`Danificado · ${line.name}`}
                value={damaged[line.id] ?? ''}
                inputMode="decimal"
                placeholder="0"
                editable={!locked}
                onChangeText={(v) => setDamaged((q) => ({ ...q, [line.id]: v }))}
              />
            ) : null}
          </View>
        ))}
      <TextField
        label="Motivo"
        value={reason}
        onChangeText={setReason}
        maxLength={500}
        multiline
        editable={!locked}
      />
      {error ? (
        <Alert tone="danger" title="Confira os dados">
          {error}
        </Alert>
      ) : null}
      {command.isError ? (
        <Alert tone="danger" title="Operação não confirmada">
          {toApiError(command.error).userMessage}
        </Alert>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 12 }}>
        <Button
          label={record ? 'Revisar recebimento' : 'Revisar devolução'}
          disabled={locked}
          onPress={() => prepare()}
        />
        {record ? (
          <Button
            label="Cancelar quantidades pendentes"
            variant="ghost"
            disabled={locked}
            onPress={() => prepare(true)}
          />
        ) : null}
      </View>
      <ConfirmDialog
        visible={!!review}
        title={
          review?.kind === 'cancel'
            ? 'Cancelar o que falta receber?'
            : record
              ? 'Registrar recebimento físico?'
              : 'Registrar devolução?'
        }
        description={
          review?.kind === 'cancel'
            ? 'Cancela somente quantidades ainda não recebidas. Mercadoria já recebida e valores permanecem registrados.'
            : record
              ? 'Confira vendáveis e danificados. Somente vendáveis voltam ao estoque disponível.'
              : 'A solicitação não altera estoque nem registra crédito financeiro.'
        }
        confirmLabel="Confirmar registro"
        tone="strong"
        loading={command.isPending}
        onCancel={() => setReview(null)}
        onConfirm={() => {
          if (review) send(review);
        }}
      >
        {review ? (
          <>
            <Text>{review.body.reason}</Text>
            {'lines' in review.body
              ? review.body.lines.map((line) => (
                  <Text key={line.lineId}>
                    {order.lines.find((l) => l.id === line.lineId)?.name}:{' '}
                    {'quantity' in line
                      ? line.quantity
                      : `Vendável ${line.sellableQuantity ?? '0'} · Danificado ${line.damagedQuantity ?? '0'}`}
                  </Text>
                ))
              : null}
          </>
        ) : null}
      </ConfirmDialog>
    </Panel>
  );
}
