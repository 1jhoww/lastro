import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Order, OrderLine } from '@/api/types';
import { DetailColumns, Fact } from '@/features/catalog/DetailParts';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { useOrder } from '@/features/orders/api';
import { OrderActions } from '@/features/orders/OrderActions';
import { OrderFinancePanel } from '@/features/orders/OrderFinancePanel';
import { OrderHistoryPanel } from '@/features/orders/OrderHistoryPanel';
import {
  formatCalendarDate,
  paymentSummary,
  shortOrderId,
  statusLabel,
  statusTone,
} from '@/features/orders/rules';
import { shortId } from '@/features/users/api';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { formatQuantity, fromApiQuantity } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Badge, Button, DataTable, Disclosure, Panel, Text, type Column } from '@/ui';
import { canReadFinance } from '@/features/finance/FinanceAccess';
import { OrderDocuments } from '@/features/files/OrderDocuments';

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  if (order.isPending) return <RecordLoading title="Pedido" />;
  if (order.isError || !order.data)
    return (
      <RecordError
        title="Pedido"
        error={order.error}
        backHref={'/pedidos' as Href}
        backLabel="Voltar para pedidos"
        onRetry={() => order.refetch()}
      />
    );
  return <OrderView order={order.data} onRefresh={() => order.refetch()} />;
}

const lineColumns: Column<OrderLine>[] = [
  {
    key: 'product',
    label: 'Produto',
    flex: 3,
    render: (l) => (
      <View>
        <Text variant="bodyStrong" numberOfLines={2}>
          {l.name}
        </Text>
        <Text variant="small" color={color.textSecondary}>
          {l.sku}
        </Text>
      </View>
    ),
  },
  {
    key: 'qty',
    label: 'Quantidade',
    width: 120,
    align: 'right',
    render: (l) => (
      <Text variant="small">{formatQuantity(fromApiQuantity(l.quantity), l.unit)}</Text>
    ),
  },
  {
    key: 'price',
    label: 'Preço registrado',
    width: 130,
    align: 'right',
    render: (l) => <Text variant="small">{formatCents(l.unitPriceCents)}</Text>,
  },
  {
    key: 'total',
    label: 'Total',
    width: 120,
    align: 'right',
    render: (l) => <Text variant="figure">{formatCents(l.totalCents)}</Text>,
  },
];

function OrderView({ order: o, onRefresh }: { order: Order; onRefresh: () => void }) {
  const session = useSession();
  const { user } = session;
  const who = (uid: string | null) =>
    uid === null ? '' : uid === user?.uid ? 'Você' : `Usuário ${shortId(uid)}`;

  return (
    <Screen title={shortOrderId(o.commercialId)} description={o.customerName ?? 'Sem cliente'}>
      <View style={styles.status}>
        <Badge label={statusLabel[o.status]} tone={statusTone[o.status]} />
        <Text variant="small" color={color.textSecondary} selectable>
          {formatCents(o.totalCents)}
        </Text>
      </View>
      {o.status === 'confirmed' ? (
        <Alert tone="info" title="Estoque reservado">
          Os itens estão reservados para este pedido. Ao registrar saída, os produtos saem do
          estoque físico.
        </Alert>
      ) : null}

      <OrderActions order={o} onRefresh={onRefresh} />
      {o.status === 'dispatched' && session.permissions.includes('returns:manage') ? (
        <Link href={`/pedidos/${o.id}/devolucoes` as Href} asChild>
          <Button label="Registrar devolução" variant="outline" />
        </Link>
      ) : null}
      {canReadFinance(session) ? (
        <Link href={`/financeiro/pedidos/${o.id}` as Href} asChild>
          <Button label="Abrir financeiro do pedido" variant="outline" />
        </Link>
      ) : null}

      <DetailColumns
        main={
          <>
            <Panel
              title={`Itens (${o.lines.length})`}
              description="Quantidades e valores do pedido."
              flush
            >
              <DataTable
                label="Itens do pedido"
                rows={o.lines}
                keyOf={(l) => l.id}
                columns={lineColumns}
                renderCompact={(l) => (
                  <View style={styles.compactLine}>
                    <View style={styles.flex}>
                      <Text variant="bodyStrong" numberOfLines={2}>
                        {l.name}
                      </Text>
                      <Text variant="small" color={color.textSecondary}>
                        {`${formatQuantity(fromApiQuantity(l.quantity), l.unit)} × ${formatCents(l.unitPriceCents)}`}
                      </Text>
                    </View>
                    <Text variant="figure">{formatCents(l.totalCents)}</Text>
                  </View>
                )}
              />
              <View style={styles.totals}>
                <Total label="Subtotal" cents={o.subtotalCents} />
                {o.discountCents ? <Total label="Desconto" cents={-o.discountCents} /> : null}
                <Total label="Total" cents={o.totalCents} strong />
              </View>
            </Panel>
            <Panel title="Pagamento">
              <View style={styles.facts}>
                <Fact label="Condição" value={paymentSummary(o)} />
                {o.intendedPaymentMethod ? (
                  <Fact label="Forma pretendida" value={o.intendedPaymentMethod.name} />
                ) : null}
                {o.installments.length ? (
                  <View style={styles.installments} accessibilityLabel="Parcelas">
                    {o.installments.map((p) => (
                      <View key={p.id} style={styles.installment}>
                        <Text variant="small">{`${p.number}ª · ${formatCalendarDate(p.dueDate)}`}</Text>
                        <Text variant="small">{formatCents(p.amountCents)}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text variant="small" color={color.textSecondary}>
                    Parcelas aparecem quando a condição de pagamento é definida.
                  </Text>
                )}
              </View>
            </Panel>
            {o.notes ? (
              <Panel title="Observações">
                <Text variant="body" selectable>
                  {o.notes}
                </Text>
              </Panel>
            ) : null}
          </>
        }
        side={
          <>
            <Panel title="Registro">
              <View style={styles.facts}>
                <Fact label="Cliente" value={o.customerName ?? 'Sem cliente'} />
                <Fact label="Responsável" value={who(o.sellerUid)} />
                <Fact label="Criado em" value={formatDateTime(o.createdAt)} />
                {o.confirmedAt ? (
                  <Fact
                    label="Confirmado (reserva)"
                    value={`${formatDateTime(o.confirmedAt)} · ${who(o.confirmedBy)}`}
                  />
                ) : null}
                {o.dispatchedAt ? (
                  <Fact
                    label="Expedido (saída do estoque)"
                    value={`${formatDateTime(o.dispatchedAt)} · ${who(o.dispatchedBy)}`}
                  />
                ) : null}
                {o.canceledAt ? (
                  <Fact
                    label="Cancelado"
                    value={`${formatDateTime(o.canceledAt)} · ${who(o.canceledBy)}`}
                  />
                ) : null}
                <Disclosure label="Identificação do pedido">
                  <Fact label="Número completo" value={o.commercialId} />
                  <Fact label="Versão" value={String(o.version)} />
                </Disclosure>
              </View>
            </Panel>
            <OrderFinancePanel order={o} />
            <Disclosure label="Histórico do pedido">
              <OrderHistoryPanel orderId={o.id} />
            </Disclosure>
            <OrderDocuments id={o.id} number={shortOrderId(o.commercialId)} version={o.version} />
          </>
        }
      />
    </Screen>
  );
}

function Total({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text
        variant={strong ? 'bodyStrong' : 'body'}
        color={strong ? color.text : color.textSecondary}
      >
        {label}
      </Text>
      <Text variant={strong ? 'figureLarge' : 'figure'}>{formatCents(cents)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  compactLine: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
  totals: {
    gap: space[2],
    padding: space[5],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  facts: { gap: space[4], paddingTop: space[1] },
  installments: { gap: space[1] },
  installment: { flexDirection: 'row', justifyContent: 'space-between' },
});
