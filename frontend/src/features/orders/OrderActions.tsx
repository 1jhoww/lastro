import { useEffect, useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { ApiError } from '@/api/errors';
import type { Order } from '@/api/types';
import { useAvailability } from '@/features/inventory/api';
import {
  intentLedger,
  intentScope,
  outcomeOf,
  usePendingIntent,
  useOtherOrderIntent,
  type OrderCommandKind,
} from '@/lib/intent';
import { formatCents } from '@/lib/money';
import { formatQuantity, fromApiQuantity } from '@/lib/quantity';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import { Alert, Button, ConfirmDialog, Text, TextField, useToast } from '@/ui';
import { Ban, CircleCheck, Pencil, Truck } from '@/ui/icons';
import { useOrderCommand } from './api';
import { actionsFor, paymentSummary, statusLabel } from './rules';
import { usePendingExecutions } from '@/features/finance/api';

const target: Record<OrderCommandKind, Order['status']> = {
  confirm: 'confirmed',
  dispatch: 'dispatched',
  cancel: 'canceled',
};

const verb: Record<OrderCommandKind, { done: string; unknown: string; rejected: string }> = {
  confirm: {
    done: 'Pedido confirmado e estoque reservado',
    unknown: 'Não sabemos se o pedido foi confirmado',
    rejected: 'Pedido não confirmado',
  },
  dispatch: {
    done: 'Pedido expedido',
    unknown: 'Não sabemos se o pedido foi expedido',
    rejected: 'Pedido não expedido',
  },
  cancel: {
    done: 'Pedido cancelado',
    unknown: 'Não sabemos se o pedido foi cancelado',
    rejected: 'Pedido não cancelado',
  },
};

/** Orientação para cada recusa do servidor, pelo código estável. */
export function commandMessage(kind: OrderCommandKind, e: ApiError): string {
  switch (e.code) {
    case 'INSUFFICIENT_STOCK':
      return kind === 'confirm'
        ? 'Não há disponível suficiente para reservar todos os itens. Nada foi reservado. Ajuste as quantidades no rascunho.'
        : 'O estoque reservado não comporta a operação. Nada foi alterado.';
    case 'PRODUCT_UNAVAILABLE':
      return 'Um produto foi desativado ou mudou de unidade. Edite o rascunho e remova-o.';
    case 'INVALID_RESERVATION':
      return 'A reserva de estoque deste pedido está inconsistente. Nada foi alterado; fale com o administrador.';
    case 'INVALID_ORDER_STATE':
      return 'O pedido mudou de situação (outra pessoa pode ter agido nele). A situação atual foi carregada.';
    case 'CONFLICT':
      return 'O pedido foi alterado desde que você abriu. A versão atual foi carregada: revise e tente de novo.';
    case 'INCOMPLETE_ORDER':
      return 'Para confirmar, o pedido precisa de cliente, itens e condição de pagamento. Edite o rascunho.';
    case 'INVALID_DUE_DATE':
      return 'Há vencimento no passado. Edite o rascunho e ajuste o pagamento.';
    case 'ORDER_OPERATION_IN_PROGRESS':
    case 'FINANCIAL_OPERATION_IN_PROGRESS':
      return 'Há uma operação financeira em andamento neste pedido. Aguarde a conclusão e tente de novo.';
    case 'FINANCIAL_CANCELLATION_REQUIRED':
      return 'O pedido tem recebimentos registrados. O cancelamento precisa do fluxo financeiro administrativo. Abra esse fluxo para escolher crédito ou obrigação de reembolso. Nada foi cancelado.';
    case 'FINANCIAL_RESUMABLE_REQUIRED':
      return 'O histórico financeiro deste pedido exige a execução financeira retomável, conduzida no módulo Financeiro. Nada foi cancelado.';
    default:
      return e.userMessage;
  }
}

/**
 * Ações do pedido. Cada comando usa uma Idempotency-Key por intenção (usuário, empresa, tipo e
 * pedido). Sucesso só com resposta do servidor; sem resposta, a intenção fica pendente e trava
 * as demais ações até ser repetida (mesma chave), verificada ou descartada.
 */
export function OrderActions({ order, onRefresh }: { order: Order; onRefresh: () => void }) {
  const { user, permissions } = useSession();
  const { tenantId } = useTenantApi();
  const toast = useToast();
  const compact = useLayoutSize() === 'compact';
  const command = useOrderCommand();
  const [open, setOpen] = useState<OrderCommandKind | null>(null);
  const [reason, setReason] = useState('');
  const [discard, setDiscard] = useState<OrderCommandKind | null>(null);
  const [lastKind, setLastKind] = useState<OrderCommandKind | null>(null);

  const scopeOf = (kind: OrderCommandKind) =>
    intentScope(user?.uid ?? '', tenantId, kind, order.id);
  const pending = {
    confirm: usePendingIntent(scopeOf('confirm')),
    dispatch: usePendingIntent(scopeOf('dispatch')),
    cancel: usePendingIntent(scopeOf('cancel')),
  };
  const pendingKind = (Object.keys(pending) as OrderCommandKind[]).find((k) => pending[k]);
  const financialIntent = useOtherOrderIntent(user?.uid ?? '', tenantId, order.id, 'cancel');
  const executions = usePendingExecutions(order.id);

  // Consulta do estado atual resolve a dúvida: se o pedido já está na situação pretendida, o
  // efeito existe (por esta ou outra tentativa) e não há o que repetir.
  useEffect(() => {
    if (pendingKind && order.status === target[pendingKind]) {
      intentLedger.clear(scopeOf(pendingKind));
      toast.show(`${verb[pendingKind].done} (verificado)`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKind, order.status]);

  const actions = actionsFor(order.status, permissions);
  const busy = command.isPending;
  const locked =
    busy ||
    Boolean(pendingKind) ||
    Boolean(financialIntent) ||
    executions.items.length > 0 ||
    Boolean(executions.query.hasNextPage);
  const error = command.isError ? outcomeOf(command.error) : null;
  const shortage =
    lastKind === 'confirm' &&
    error?.status === 'rejected' &&
    error.error.code === 'INSUFFICIENT_STOCK';

  const run = (kind: OrderCommandKind, body: Record<string, unknown>) => {
    setLastKind(kind);
    command.mutate(
      kind === 'cancel'
        ? {
            kind,
            orderId: order.id,
            scope: scopeOf(kind),
            body: body as { expectedVersion: number; reason: string },
          }
        : {
            kind,
            orderId: order.id,
            scope: scopeOf(kind),
            body: body as { expectedVersion: number },
          },
      {
        onSuccess: () => toast.show(verb[kind].done),
        onSettled: () => {
          setOpen(null);
          setReason('');
        },
      },
    );
  };

  const reasonOk = reason.trim().length >= 3 && reason.trim().length <= 200;

  return (
    <View style={styles.root}>
      {pendingKind ? (
        <Alert
          tone="warning"
          title={verb[pendingKind].unknown}
          action={
            <View style={styles.inline}>
              <Button
                label="Tentar de novo"
                size="sm"
                variant="strong"
                loading={busy}
                onPress={() => run(pendingKind, pending[pendingKind]!.body)}
              />
              <Button
                label="Atualizar pedido"
                size="sm"
                variant="outline"
                disabled={busy}
                onPress={onRefresh}
              />
              <Button
                label="Descartar"
                size="sm"
                variant="ghost"
                disabled={busy}
                onPress={() => setDiscard(pendingKind)}
              />
            </View>
          }
        >
          A conexão falhou antes da resposta. Tentar de novo é seguro: usa a mesma chave e, se a
          operação já foi gravada, o servidor devolve o mesmo resultado sem repetir o efeito.
        </Alert>
      ) : error && lastKind ? (
        <Alert
          tone={
            error.status === 'rejected' && error.error.kind === 'conflict' ? 'warning' : 'danger'
          }
          title={verb[lastKind].rejected}
        >
          {commandMessage(lastKind, error.error)}
        </Alert>
      ) : null}

      {shortage ? <StockShortage order={order} /> : null}

      {actions.length ? (
        <View style={[styles.buttons, compact && styles.buttonsCompact]}>
          {actions.includes('edit') ? (
            <Link href={`/pedidos/${order.id}/editar` as Href} asChild>
              <Button
                label="Editar rascunho"
                icon={Pencil}
                variant="outline"
                disabled={locked}
                fullWidth={compact}
              />
            </Link>
          ) : null}
          {actions.includes('cancel') ? (
            <Button
              label={order.status === 'draft' ? 'Cancelar rascunho' : 'Cancelar pedido'}
              icon={Ban}
              variant="ghost"
              disabled={locked}
              fullWidth={compact}
              onPress={() => setOpen('cancel')}
            />
          ) : null}
          {actions.includes('dispatch') ? (
            <Button
              label="Expedir pedido"
              icon={Truck}
              variant="strong"
              disabled={locked}
              fullWidth={compact}
              onPress={() => setOpen('dispatch')}
            />
          ) : null}
          {actions.includes('confirm') ? (
            <Button
              label="Confirmar pedido"
              icon={CircleCheck}
              variant="strong"
              disabled={locked}
              fullWidth={compact}
              onPress={() => setOpen('confirm')}
            />
          ) : null}
        </View>
      ) : null}

      <ConfirmDialog
        visible={open === 'confirm'}
        title="Confirmar pedido?"
        description="O estoque de todos os itens será reservado agora e os títulos a receber serão gerados. Depois de confirmado, o pedido não pode ser editado."
        confirmLabel="Confirmar e reservar"
        tone="strong"
        loading={busy}
        onCancel={() => setOpen(null)}
        onConfirm={() => run('confirm', { expectedVersion: order.version })}
      >
        <Summary order={order} />
      </ConfirmDialog>

      <ConfirmDialog
        visible={open === 'dispatch'}
        title="Expedir pedido?"
        description="O estoque reservado deste pedido vira saída física. O Lastro não emite nota fiscal nem integra transportadora."
        confirmLabel="Expedir pedido"
        tone="strong"
        loading={busy}
        onCancel={() => setOpen(null)}
        onConfirm={() => run('dispatch', { expectedVersion: order.version })}
      >
        <Summary order={order} />
      </ConfirmDialog>

      <ConfirmDialog
        visible={open === 'cancel'}
        title={order.status === 'draft' ? 'Cancelar rascunho?' : 'Cancelar pedido confirmado?'}
        description={
          order.status === 'draft'
            ? 'O rascunho deixa de poder ser editado ou confirmado. Não há estoque reservado.'
            : 'A reserva de estoque é liberada e os títulos a receber são cancelados. Não há estorno bancário automático.'
        }
        confirmLabel={order.status === 'draft' ? 'Cancelar rascunho' : 'Cancelar pedido'}
        tone="danger"
        loading={busy}
        onCancel={() => {
          setOpen(null);
          setReason('');
        }}
        onConfirm={() =>
          reasonOk && run('cancel', { expectedVersion: order.version, reason: reason.trim() })
        }
      >
        <TextField
          label="Motivo do cancelamento"
          value={reason}
          onChangeText={setReason}
          maxLength={200}
          hint="De 3 a 200 caracteres. Fica no histórico do pedido."
          error={reason && !reasonOk ? 'Descreva o motivo com pelo menos 3 caracteres.' : undefined}
        />
      </ConfirmDialog>

      <ConfirmDialog
        visible={discard !== null}
        title="Descartar a tentativa pendente?"
        description="Descarte só depois de atualizar o pedido e ver que a operação NÃO aconteceu. Uma nova tentativa usará outra chave."
        confirmLabel="Descartar tentativa"
        onCancel={() => setDiscard(null)}
        onConfirm={() => {
          if (discard) intentLedger.clear(scopeOf(discard));
          command.reset();
          setDiscard(null);
        }}
      />
    </View>
  );
}

function Summary({ order }: { order: Order }) {
  return (
    <View style={styles.summary}>
      <Line
        label="Pedido"
        value={`${order.commercialId.slice(0, 12)} · ${statusLabel[order.status]}`}
      />
      <Line label="Cliente" value={order.customerName ?? 'Sem cliente'} />
      <Line label="Itens" value={`${order.lines.length}`} />
      <Line label="Total" value={formatCents(order.totalCents)} />
      <Line label="Pagamento" value={paymentSummary(order)} />
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text variant="small" color={color.textSecondary}>
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

/**
 * Divergência de estoque depois de INSUFFICIENT_STOCK: compara a quantidade de cada linha com o
 * disponível atual (consulta só até 50 produtos; acima disso, orienta a revisar no rascunho).
 */
function StockShortage({ order }: { order: Order }) {
  const ids = order.lines.map((l) => l.productId);
  const available = useAvailability(ids);
  const short = order.lines.filter((l) => {
    const a = available.get(l.productId);
    return a !== undefined && fromApiQuantity(l.quantity) > a;
  });
  if (ids.length > 50)
    return (
      <Text variant="small" color={color.textSecondary}>
        Pedido com muitos itens: confira o disponível de cada produto no rascunho ou no estoque.
      </Text>
    );
  if (!short.length) return null;
  return (
    <View style={styles.shortage} accessibilityLabel="Itens sem disponível suficiente">
      <Text variant="smallStrong">Itens sem disponível suficiente agora</Text>
      {short.map((l) => (
        <Text key={l.id} variant="small">
          {`${l.name}: pedido ${formatQuantity(fromApiQuantity(l.quantity), l.unit)}, disponível ${formatQuantity(available.get(l.productId)!, l.unit)}`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[3] },
  inline: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2], flexWrap: 'wrap' },
  buttonsCompact: { flexDirection: 'column-reverse', alignItems: 'stretch' },
  summary: { gap: space[2] },
  line: { gap: 1 },
  shortage: {
    gap: space[1],
    padding: space[3],
    borderRadius: 10,
    backgroundColor: color.dangerSoft,
  },
});
