import { useState } from 'react';
import { useLocalSearchParams, type Href } from 'expo-router';
import { View } from 'react-native';
import type { CreditApplication, CreditLot } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { CustomerPicker } from '@/features/orders/CustomerPicker';
import { Screen } from '@/layout/Screen';
import { formatCents } from '@/lib/money';
import { formatDateTime } from '@/lib/dates';
import { space } from '@/theme';
import { Badge, Button, DataTable, EmptyState, Text, type Column } from '@/ui';
import { CircleDollarSign } from '@/ui/icons';
import { useCreditApplications, useCustomerCredits } from './administrationApi';
import { FinanceNav } from './FinanceNav';

export const creditOriginLabel = {
  order_cancellation: 'Cancelamento de pedido',
  order_return: 'Devolução de pedido',
} as const;
export function CreditsScreen() {
  const params = useLocalSearchParams<{ cliente?: string }>();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    params.cliente ? { id: params.cliente, name: params.cliente } : null,
  );
  const [picking, setPicking] = useState(false);
  return (
    <Screen
      title="Créditos de clientes"
      description="Fontes legítimas do cliente. Cada saldo vem do servidor; páginas não formam saldo global."
    >
      <FinanceNav />
      <Button
        label={customer ? `Cliente: ${customer.name}` : 'Escolher cliente'}
        variant="outline"
        onPress={() => setPicking(true)}
      />
      {customer ? (
        <CustomerCredits key={customer.id} id={customer.id} />
      ) : (
        <Text>Escolha cliente para consultar suas fontes e aplicações.</Text>
      )}
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
function CustomerCredits({ id }: { id: string }) {
  const lots = useCustomerCredits(id);
  const applications = useCreditApplications({ customerId: id });
  const columns: Column<CreditLot>[] = [
    {
      key: 'origin',
      label: 'Origem',
      flex: 2,
      render: (l) => <Text>{creditOriginLabel[l.origin]}</Text>,
    },
    {
      key: 'issued',
      label: 'Emitido',
      width: 125,
      render: (l) => <Text>{formatCents(l.issuedCents)}</Text>,
    },
    {
      key: 'available',
      label: 'Disponível',
      width: 125,
      render: (l) => <Text variant="figure">{formatCents(l.availableCents)}</Text>,
    },
    {
      key: 'applied',
      label: 'Aplicado',
      width: 125,
      render: (l) => <Text>{formatCents(l.appliedCents)}</Text>,
    },
    {
      key: 'date',
      label: 'Emitido em',
      width: 150,
      render: (l) => <Text>{formatDateTime(l.createdAt)}</Text>,
    },
  ];
  const applicationColumns: Column<CreditApplication>[] = [
    { key: 'lot', label: 'Fonte', flex: 2, render: (a) => <Text selectable>{a.creditLotId}</Text> },
    {
      key: 'amount',
      label: 'Aplicado',
      width: 120,
      render: (a) => <Text>{formatCents(a.amountCents)}</Text>,
    },
    {
      key: 'status',
      label: 'Situação',
      width: 120,
      render: (a) => <Badge label={applicationLabels[a.status]} />,
    },
    {
      key: 'reversed',
      label: 'Estornado',
      width: 120,
      render: (a) => <Text>{formatCents(a.reversedCents)}</Text>,
    },
    {
      key: 'restored',
      label: 'Restaurado à fonte',
      width: 160,
      render: (a) => <Text>{formatCents(a.restoredByCancellationCents)}</Text>,
    },
  ];
  return (
    <>
      <Text variant="h3">Fontes de crédito</Text>
      <ListPanel
        query={lots.query}
        count={lots.items.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title="Nenhuma fonte de crédito"
            description="Crédito exige cancelamento ou devolução legítima. Não há crédito livre ou promocional."
          />
        }
      >
        <DataTable
          label="Fontes de crédito"
          rows={lots.items}
          keyOf={(l) => l.id}
          columns={columns}
          hrefOf={(l) => `/financeiro/pedidos/${l.originOrderId}` as Href}
          renderCompact={(l) => (
            <View style={{ gap: space[2] }}>
              <Text variant="bodyStrong">{creditOriginLabel[l.origin]}</Text>
              <Text>{`Disponível ${formatCents(l.availableCents)} · emitido ${formatCents(l.issuedCents)}`}</Text>
              <Text>{`Aplicado ${formatCents(l.appliedCents)} · ${l.availableCents > 0 ? 'Saldo disponível' : 'Sem saldo disponível'}`}</Text>
              <Text
                variant="caption"
                selectable
              >{`Fonte ${l.id} · origem ${l.originReference}`}</Text>
            </View>
          )}
        />
      </ListPanel>
      <Text variant="h3">Histórico de aplicações</Text>
      <ListPanel
        query={applications.query}
        count={applications.items.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title="Nenhuma aplicação de crédito"
            description="Aplique crédito apenas em pedido elegível do mesmo cliente, pela administração financeira do pedido."
          />
        }
      >
        <DataTable
          label="Aplicações de crédito"
          rows={applications.items}
          keyOf={(a) => a.id}
          columns={applicationColumns}
          hrefOf={(a) => `/financeiro/pedidos/${a.orderId}` as Href}
          renderCompact={(a) => (
            <View style={{ gap: space[2] }}>
              <Text variant="bodyStrong">{`${formatCents(a.amountCents)} · ${applicationLabels[a.status]}`}</Text>
              <Text>{`Estornado ${formatCents(a.reversedCents)} · restaurado ${formatCents(a.restoredByCancellationCents)}`}</Text>
              <Text
                variant="caption"
                selectable
              >{`Aplicação ${a.id} · fonte ${a.creditLotId} · pedido ${a.orderId}`}</Text>
            </View>
          )}
        />
      </ListPanel>
    </>
  );
}
export const applicationLabels = {
  active: 'Ativa',
  reversed: 'Estornada',
  restored: 'Restaurada',
} as const;
