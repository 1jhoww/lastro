import { StyleSheet, View } from 'react-native';
import { Link, type Href } from 'expo-router';
import { toApiError } from '@/api/errors';
import type { Order } from '@/api/types';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Badge, Button, Panel, Skeleton, Text } from '@/ui';
import { useFinancialState, usePendingExecutions } from '@/features/finance/api';
import { canReadFinance } from '@/features/finance/FinanceAccess';
import { executionDone, executionStatusLabel, formatCalendarDate } from './rules';

const titleLabel = {
  open: 'Em aberto',
  partially_paid: 'Parcialmente pago',
  paid: 'Pago',
  canceled: 'Cancelado',
  zero: 'Sem valor',
} as const;

/**
 * Resumo financeiro do pedido, só para quem tem `receivables:read` (administrador) e só depois
 * da confirmação. Somente leitura: recebimentos, créditos e cancelamento financeiro pertencem
 * ao módulo Financeiro. Execuções retomáveis aparecem com o estado real do servidor; "aceita"
 * ou "em processamento" nunca são mostradas como concluídas.
 */
export function OrderFinancePanel({ order }: { order: Order }) {
  const session = useSession();
  const allowed = canReadFinance(session) && order.confirmedAt !== null;
  if (!allowed) return null;
  return <FinanceSummary order={order} />;
}
function FinanceSummary({ order }: { order: Order }) {
  const finance = useFinancialState(order.id);
  const executions = usePendingExecutions(order.id);

  return (
    <Panel
      title="Financeiro do pedido"
      description="Somente leitura. Visível para administradores."
    >
      {finance.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando financeiro">
          <Skeleton width="60%" />
          <Skeleton width="40%" />
        </View>
      ) : finance.isError ? (
        <Alert tone="warning" title="Resumo financeiro indisponível">
          {toApiError(finance.error).userMessage}
        </Alert>
      ) : (
        <View style={styles.body}>
          <Link href={`/financeiro/pedidos/${order.id}` as Href} asChild>
            <Button label="Abrir parcelas e recebimentos" variant="outline" />
          </Link>
          {executions.items
            .filter((e) => !executionDone(e))
            .map((e) => (
              <Alert key={e.id} tone="warning" title="Operação financeira em andamento">
                <Text>{`${e.kind === 'cancellation' ? 'Cancelamento financeiro' : 'Resolução de devolução'}: ${executionStatusLabel[e.status]}. Ações do pedido ficam bloqueadas até a conclusão.`}</Text>
                <Link href={`/financeiro/execucoes/${e.id}` as Href} asChild>
                  <Button label="Acompanhar resolução" variant="outline" />
                </Link>
              </Alert>
            ))}
          <View style={styles.row}>
            <Text variant="small" color={color.textSecondary}>
              Recebimentos registrados
            </Text>
            <Text variant="small">{formatCents(finance.data.cashReceivedCents)}</Text>
          </View>
          <View style={styles.row}>
            <Text variant="small" color={color.textSecondary}>
              Créditos aplicados
            </Text>
            <Text variant="small">{formatCents(finance.data.creditSettledCents)}</Text>
          </View>
          {finance.data.titles.map((t) => (
            <View key={t.id} style={styles.title}>
              <View style={styles.flex}>
                <Text variant="smallStrong">{`${t.installmentNumber}ª parcela · ${formatCalendarDate(t.dueDate)}`}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  {`Em aberto ${formatCents(t.outstandingCents)} de ${formatCents(t.originalCents)}`}
                </Text>
              </View>
              <Badge
                label={titleLabel[t.status]}
                tone={
                  t.status === 'paid' ? 'success' : t.status === 'canceled' ? 'danger' : 'neutral'
                }
              />
            </View>
          ))}
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[2], paddingTop: space[2] },
  body: { gap: space[3], paddingTop: space[1] },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
});
