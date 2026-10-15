import { useState } from 'react';
import type { Href } from 'expo-router';
import { View } from 'react-native';
import type { RefundObligation } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { CustomerPicker } from '@/features/orders/CustomerPicker';
import { Screen } from '@/layout/Screen';
import { formatCents } from '@/lib/money';
import { Badge, Button, DataTable, EmptyState, Text, TextField, type Column } from '@/ui';
import { CircleDollarSign } from '@/ui/icons';
import { useRefundObligations } from './administrationApi';
import { creditOriginLabel } from './CreditsScreen';
import { FinanceNav } from './FinanceNav';

export const refundLabels = {
  pending: 'Pendente',
  partially_refunded: 'Parcialmente confirmado',
  confirmed: 'Confirmado manualmente',
} as const;
export function RefundsScreen() {
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [order, setOrder] = useState('');
  const [orderId, setOrderId] = useState('');
  const list = useRefundObligations({
    ...(customer ? { customerId: customer.id } : {}),
    ...(orderId ? { orderId } : {}),
  });
  const columns: Column<RefundObligation>[] = [
    {
      key: 'origin',
      label: 'Origem',
      flex: 2,
      render: (r) => <Text>{creditOriginLabel[r.origin]}</Text>,
    },
    {
      key: 'status',
      label: 'Situação',
      flex: 2,
      render: (r) => <Badge label={refundLabels[r.status]} />,
    },
    {
      key: 'original',
      label: 'Original',
      width: 130,
      render: (r) => <Text>{formatCents(r.originalCents)}</Text>,
    },
    {
      key: 'pending',
      label: 'Obrigação pendente',
      width: 170,
      render: (r) => <Text variant="figure">{formatCents(r.outstandingCents)}</Text>,
    },
    {
      key: 'refunded',
      label: 'Confirmado externamente',
      width: 180,
      render: (r) => <Text>{formatCents(r.refundedCents)}</Text>,
    },
  ];
  return (
    <Screen
      title="Obrigações de reembolso"
      description="Obrigação registrada não significa dinheiro transferido. Lastro registra comprovantes de devoluções feitas fora do sistema."
    >
      <FinanceNav />
      <TextField
        label="Filtrar pedido (ID)"
        value={order}
        onChangeText={setOrder}
        maxLength={128}
      />
      <Button label="Aplicar pedido" variant="outline" onPress={() => setOrderId(order.trim())} />
      <Button
        label={customer ? `Cliente: ${customer.name}` : 'Filtrar cliente'}
        variant="outline"
        onPress={() => setPicking(true)}
      />
      <Button
        label="Limpar filtros"
        variant="ghost"
        onPress={() => {
          setOrder('');
          setOrderId('');
          setCustomer(null);
        }}
      />
      <ListPanel
        query={list.query}
        count={list.items.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title="Nenhuma obrigação nestes filtros"
            description="Cancelamento ou devolução com destino reembolso gera obrigação manual."
          />
        }
      >
        <DataTable
          label="Obrigações de reembolso"
          rows={list.items}
          keyOf={(r) => r.id}
          columns={columns}
          hrefOf={(r) => `/financeiro/pedidos/${r.orderId}?reembolso=${r.id}` as Href}
          renderCompact={(r) => (
            <View>
              <Text variant="bodyStrong">{`${refundLabels[r.status]} · ${formatCents(r.outstandingCents)}`}</Text>
              <Text>{`${creditOriginLabel[r.origin]} · confirmado ${formatCents(r.refundedCents)}`}</Text>
              <Text
                variant="caption"
                selectable
              >{`Obrigação ${r.id} · pedido ${r.orderId} · origem ${r.originReference}`}</Text>
            </View>
          )}
        />
      </ListPanel>
      <CustomerPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setCustomer({ id: c.id, name: c.name });
          setPicking(false);
        }}
      />
    </Screen>
  );
}
