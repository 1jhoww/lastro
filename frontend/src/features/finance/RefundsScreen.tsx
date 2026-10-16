import { useState } from 'react';
import { useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { RefundObligation } from '@/api/types';
import { useCustomer } from '@/features/customers/api';
import { ListPanel } from '@/features/catalog/ListStates';
import { CustomerPicker } from '@/features/orders/CustomerPicker';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { color, space, useLayoutSize } from '@/theme';
import { Badge, Button, DataTable, EmptyState, Text, type BadgeTone, type Column } from '@/ui';
import { HandCoins, UserRound, X } from '@/ui/icons';
import { useRefundObligations } from './administrationApi';
import { creditOriginLabel } from './CreditsScreen';
import { Guidance, FilterTabs } from './FinanceParts';
import { FinanceNav } from './FinanceNav';
import { orderCode } from './presentation';
import { useRefetchStaleOnFocus } from './cacheUpdates';

export const refundLabels = {
  pending: 'A devolver',
  partially_refunded: 'Devolvido em parte',
  confirmed: 'Devolução registrada',
} as const;
const refundTones: Record<RefundObligation['status'], BadgeTone> = {
  pending: 'warning',
  partially_refunded: 'warning',
  confirmed: 'success',
};
type Filter = 'pending' | 'done' | 'all';

export function RefundsScreen() {
  const params = useLocalSearchParams<{ pedido?: string }>();
  const compact = useLayoutSize() === 'compact';
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<Filter>('pending');
  const orderId = params.pedido ?? '';
  const list = useRefundObligations({
    ...(customer ? { customerId: customer.id } : {}),
    ...(orderId ? { orderId } : {}),
  });
  useRefetchStaleOnFocus(list.query);
  const rows = list.items.filter((r) =>
    filter === 'pending'
      ? r.outstandingCents > 0
      : filter === 'done'
        ? r.status === 'confirmed'
        : true,
  );
  const columns: Column<RefundObligation>[] = [
    {
      key: 'customer',
      label: 'Cliente',
      flex: 3,
      render: (r) => (
        <View>
          <CustomerName id={r.customerId} />
          <Text variant="small" color={color.textSecondary}>
            {`${creditOriginLabel[r.origin]} · ${orderCode(r.orderId)}`}
          </Text>
        </View>
      ),
    },
    {
      key: 'date',
      label: 'Criado em',
      width: 150,
      render: (r) => <Text variant="small">{formatDateTime(r.createdAt)}</Text>,
    },
    {
      key: 'status',
      label: 'Situação',
      width: 180,
      render: (r) => <Badge label={refundLabels[r.status]} tone={refundTones[r.status]} />,
    },
    {
      key: 'refunded',
      label: 'Já devolvido',
      width: 130,
      align: 'right',
      render: (r) => <Text>{formatCents(r.refundedCents)}</Text>,
    },
    {
      key: 'pending',
      label: 'A devolver',
      width: 130,
      align: 'right',
      render: (r) => <Text variant="figure">{formatCents(r.outstandingCents)}</Text>,
    },
  ];
  return (
    <Screen
      title="Reembolsos"
      description="Valores que a empresa precisa devolver aos clientes e o registro de quando foram devolvidos."
    >
      <FinanceNav />
      <Guidance>
        Um reembolso “a devolver” ainda não é dinheiro devolvido. Faça a devolução por fora (Pix,
        transferência…) e depois registre aqui com o comprovante.
      </Guidance>
      <View style={[styles.filters, compact && styles.filtersCompact]}>
        <FilterTabs
          label="Situação dos reembolsos"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'pending', label: 'A devolver' },
            { value: 'done', label: 'Registrados' },
            { value: 'all', label: 'Todos' },
          ]}
        />
        <View style={styles.actions}>
          <Button
            label={customer ? customer.name : 'Cliente'}
            icon={UserRound}
            size="sm"
            variant={customer ? 'strong' : 'outline'}
            onPress={() => setPicking(true)}
          />
          {customer ? (
            <Button
              label="Todos os clientes"
              icon={X}
              size="sm"
              variant="ghost"
              onPress={() => setCustomer(null)}
            />
          ) : null}
        </View>
      </View>
      {orderId ? <Text variant="smallStrong">{`Somente ${orderCode(orderId)}`}</Text> : null}
      <ListPanel
        query={list.query}
        count={rows.length}
        empty={
          <EmptyState
            icon={HandCoins}
            title={filter === 'pending' ? 'Nenhum reembolso a devolver' : 'Nenhum reembolso'}
            description="Reembolsos surgem quando um pedido pago é cancelado ou uma devolução é acertada como reembolso."
          />
        }
      >
        <DataTable
          label="Reembolsos"
          rows={rows}
          keyOf={(r) => r.id}
          columns={columns}
          hrefOf={(r) => `/financeiro/pedidos/${r.orderId}?reembolso=${r.id}` as Href}
          renderCompact={(r) => (
            <View style={styles.compact}>
              <View style={styles.flex}>
                <CustomerName id={r.customerId} />
                <Text variant="small" color={color.textSecondary}>
                  {`${creditOriginLabel[r.origin]} · ${orderCode(r.orderId)}`}
                </Text>
                <Badge label={refundLabels[r.status]} tone={refundTones[r.status]} />
              </View>
              <View style={styles.amount}>
                <Text variant="figure">{formatCents(r.outstandingCents)}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  a devolver
                </Text>
              </View>
            </View>
          )}
        />
      </ListPanel>
      <CustomerPicker
        visible={picking}
        includeInactive
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setCustomer({ id: c.id, name: c.name });
          setPicking(false);
        }}
      />
    </Screen>
  );
}

function CustomerName({ id }: { id: string }) {
  const customer = useCustomer(id);
  return (
    <Text variant="bodyStrong" numberOfLines={1}>
      {customer.data?.name ?? 'Cliente'}
    </Text>
  );
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space[3],
  },
  filtersCompact: { alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
  compact: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  amount: { alignItems: 'flex-end' },
});
