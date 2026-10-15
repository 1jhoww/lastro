import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { View } from 'react-native';
import { ReportAccess } from '@/features/reports/ReportAccess';
import { useOrderList } from '@/features/orders/api';
import { statusLabel } from '@/features/orders/rules';
import type { OrderStatus } from '@/api/types';
import { Screen } from '@/layout/Screen';
import { Alert, Button, EmptyState, Panel, Select, Text, TextField } from '@/ui';
import { ListPanel } from '@/features/catalog/ListStates';
import { formatCents } from '@/lib/money';
import { space } from '@/theme';
import { ClipboardList } from '@/ui/icons';
export default function OrderReport() {
  return (
    <ReportAccess>
      <Report />
    </ReportAccess>
  );
}
function Report() {
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [customer, setCustomer] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const { items, query } = useOrderList(
    { ...(status === 'all' ? {} : { status }), ...(customerId ? { customerId } : {}), direction },
    10,
  );
  return (
    <Screen
      title="Relatório de pedidos"
      description="Valores comerciais por pedido. Abra o pedido para documentos e histórico."
    >
      <Panel title="Filtros disponíveis">
        <View style={{ gap: space[3] }}>
          <Select
            label="Situação"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'Todas' },
              ...(['draft', 'confirmed', 'dispatched', 'canceled'] as const).map((value) => ({
                value,
                label: statusLabel[value],
              })),
            ]}
          />
          <TextField label="ID do cliente (opcional)" value={customer} onChangeText={setCustomer} />
          <Button
            label="Aplicar cliente"
            variant="outline"
            onPress={() => setCustomerId(customer.trim())}
          />
          <Select
            label="Ordem de criação"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'desc', label: 'Mais recentes' },
              { value: 'asc', label: 'Mais antigos' },
            ]}
          />
        </View>
      </Panel>
      <Alert title="Sem total global">{`${items.length} registros carregados. Esta lista não representa faturamento ou dinheiro recebido. Período e vendedor não são filtros disponíveis na API.`}</Alert>
      <ListPanel
        query={query}
        count={items.length}
        empty={
          <EmptyState
            icon={ClipboardList}
            title="Nenhum pedido nesta consulta"
            description="Revise filtros ou continue nas próximas páginas, quando disponíveis."
          />
        }
      >
        {items.map((order) => (
          <View key={order.id} style={{ padding: space[4], gap: space[2] }}>
            <Text variant="bodyStrong">{order.commercialId}</Text>
            <Text>
              {order.customerName ?? 'Sem cliente'} · {statusLabel[order.status]} ·{' '}
              {formatCents(order.totalCents)}
            </Text>
            <Link href={`/pedidos/${order.id}` as Href} asChild>
              <Button label="Abrir pedido e documentos" variant="outline" size="sm" />
            </Link>
          </View>
        ))}
      </ListPanel>
    </Screen>
  );
}
