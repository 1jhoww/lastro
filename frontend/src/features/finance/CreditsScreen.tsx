import { useState } from 'react';
import { useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { CreditApplication, CreditLot } from '@/api/types';
import { useCustomer } from '@/features/customers/api';
import { ListPanel } from '@/features/catalog/ListStates';
import { CustomerPicker } from '@/features/orders/CustomerPicker';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Badge, Button, DataTable, EmptyState, Panel, Text, type Column } from '@/ui';
import { UserRound, Wallet } from '@/ui/icons';
import { useCreditApplications, useCustomerCredits } from './administrationApi';
import { useReceivables } from './api';
import { canManageFinance } from './FinanceAccess';
import { Guidance, RowLink } from './FinanceParts';
import { FinanceNav } from './FinanceNav';
import { formatDate, installmentLabel, orderCode } from './presentation';
import { useRefetchStaleOnFocus } from './cacheUpdates';

export const creditOriginLabel = {
  order_cancellation: 'Cancelamento de pedido',
  order_return: 'Devolução de pedido',
} as const;
export const applicationLabels = {
  active: 'Usado',
  reversed: 'Estornado',
  restored: 'Devolvido ao crédito',
} as const;

export function CreditsScreen() {
  const params = useLocalSearchParams<{ cliente?: string }>();
  const [customer, setCustomer] = useState<{ id: string; name: string | null } | null>(
    params.cliente ? { id: params.cliente, name: null } : null,
  );
  const [picking, setPicking] = useState(false);
  return (
    <Screen
      title="Créditos de clientes"
      description="Valores que o cliente pode usar para pagar parcelas, gerados por cancelamento ou devolução."
    >
      <FinanceNav />
      <View style={styles.bar}>
        <Button
          label={customer ? 'Trocar cliente' : 'Escolher cliente'}
          icon={UserRound}
          size="sm"
          variant={customer ? 'outline' : 'primary'}
          onPress={() => setPicking(true)}
        />
        {customer ? <CustomerName id={customer.id} fallback={customer.name} /> : null}
      </View>
      {customer ? (
        <CustomerCredits key={customer.id} id={customer.id} />
      ) : (
        <Panel>
          <EmptyState
            size="compact"
            icon={Wallet}
            title="Escolha um cliente"
            description="Os créditos são sempre de um cliente específico e só podem ser usados por ele."
          />
        </Panel>
      )}
      <Guidance>
        Crédito só existe com origem comprovada (cancelamento ou devolução) e só é usado quando você
        escolhe, nunca automaticamente.
      </Guidance>
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

function CustomerName({ id, fallback }: { id: string; fallback: string | null }) {
  const customer = useCustomer(id);
  return <Text variant="h3">{customer.data?.name ?? fallback ?? 'Cliente'}</Text>;
}

function CustomerCredits({ id }: { id: string }) {
  const session = useSession();
  const lots = useCustomerCredits(id);
  const applications = useCreditApplications({ customerId: id });
  useRefetchStaleOnFocus(lots.query, applications.query);
  const open = useReceivables({ customerId: id }, 100);
  const complete = !lots.query.isPending && !lots.query.hasNextPage && !lots.query.isError;
  const available = lots.items.reduce((a, l) => a + l.availableCents, 0);
  const canApply = canManageFinance(session, 'payments:manage') && available > 0;
  const openTitles = open.items.filter((t) => t.outstandingCents > 0).slice(0, 6);
  const columns: Column<CreditLot>[] = [
    {
      key: 'origin',
      label: 'Origem',
      flex: 3,
      render: (l) => (
        <View>
          <Text variant="bodyStrong">{creditOriginLabel[l.origin]}</Text>
          <Text variant="small" color={color.textSecondary}>
            {`${orderCode(l.originOrderId)} · ${formatDateTime(l.createdAt)}`}
          </Text>
        </View>
      ),
    },
    {
      key: 'issued',
      label: 'Valor original',
      width: 130,
      align: 'right',
      render: (l) => <Text>{formatCents(l.issuedCents)}</Text>,
    },
    {
      key: 'applied',
      label: 'Usado',
      width: 120,
      align: 'right',
      render: (l) => <Text>{formatCents(l.appliedCents)}</Text>,
    },
    {
      key: 'available',
      label: 'Disponível',
      width: 130,
      align: 'right',
      render: (l) => <Text variant="figure">{formatCents(l.availableCents)}</Text>,
    },
    {
      key: 'status',
      label: 'Situação',
      width: 140,
      render: (l) =>
        l.availableCents > 0 ? (
          <Badge label="Disponível" tone="success" />
        ) : (
          <Badge label="Totalmente usado" />
        ),
    },
  ];
  const applicationColumns: Column<CreditApplication>[] = [
    {
      key: 'order',
      label: 'Pedido',
      flex: 2,
      render: (a) => (
        <View>
          <Text variant="bodyStrong">{orderCode(a.orderId)}</Text>
          <Text variant="small" color={color.textSecondary}>
            {formatDateTime(a.createdAt)}
          </Text>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Situação',
      width: 170,
      render: (a) => (
        <Badge
          label={applicationLabels[a.status]}
          tone={a.status === 'active' ? 'success' : 'neutral'}
        />
      ),
    },
    {
      key: 'reversed',
      label: 'Estornado',
      width: 120,
      align: 'right',
      render: (a) => <Text>{formatCents(a.reversedCents + a.restoredByCancellationCents)}</Text>,
    },
    {
      key: 'amount',
      label: 'Valor usado',
      width: 130,
      align: 'right',
      render: (a) => <Text variant="figure">{formatCents(a.amountCents)}</Text>,
    },
  ];
  return (
    <>
      <View style={styles.summary}>
        <Text variant="small" color={color.textSecondary}>
          Crédito disponível
        </Text>
        <Text variant="display">{complete ? formatCents(available) : '—'}</Text>
        {!complete && lots.query.hasNextPage ? (
          <Text variant="caption" color={color.textSecondary}>
            Carregue todas as origens abaixo para ver o total.
          </Text>
        ) : null}
      </View>
      <Text variant="h3">Origens do crédito</Text>
      <ListPanel
        query={lots.query}
        count={lots.items.length}
        empty={
          <EmptyState
            size="compact"
            icon={Wallet}
            title="Este cliente não tem crédito"
            description="Crédito surge quando um pedido pago é cancelado ou uma devolução é acertada como crédito."
          />
        }
      >
        <DataTable
          label="Origens do crédito"
          rows={lots.items}
          keyOf={(l) => l.id}
          columns={columns}
          hrefOf={(l) => `/financeiro/pedidos/${l.originOrderId}` as Href}
          renderCompact={(l) => (
            <View style={styles.compact}>
              <View style={styles.flex}>
                <Text variant="bodyStrong">{creditOriginLabel[l.origin]}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${orderCode(l.originOrderId)} · usado ${formatCents(l.appliedCents)} de ${formatCents(l.issuedCents)}`}
                </Text>
              </View>
              <Text variant="figure">{formatCents(l.availableCents)}</Text>
            </View>
          )}
        />
      </ListPanel>
      {canApply ? (
        <Panel
          title="Usar crédito em uma parcela"
          description="Parcelas em aberto deste cliente. Abra uma para escolher o valor."
          flush
        >
          {open.query.isPending ? (
            <View style={styles.pad}>
              <Text variant="small" color={color.textSecondary}>
                Carregando parcelas…
              </Text>
            </View>
          ) : openTitles.length === 0 ? (
            <View style={styles.pad}>
              <Text variant="small" color={color.textSecondary}>
                Nenhuma parcela em aberto encontrada para este cliente.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {openTitles.map((t) => (
                <RowLink key={t.id} href={`/financeiro/pedidos/${t.orderId}?acao=credito` as Href}>
                  <View style={styles.compact}>
                    <View style={styles.flex}>
                      <Text variant="bodyStrong">{`${orderCode(t.orderId)} · ${installmentLabel(t.installmentNumber)}`}</Text>
                      <Text variant="small" color={color.textSecondary}>
                        {`Vencimento ${formatDate(t.dueDate)}`}
                      </Text>
                    </View>
                    <Text variant="figure">{formatCents(t.outstandingCents)}</Text>
                  </View>
                </RowLink>
              ))}
            </View>
          )}
        </Panel>
      ) : null}
      <Text variant="h3">Histórico de uso</Text>
      <ListPanel
        query={applications.query}
        count={applications.items.length}
        empty={
          <EmptyState
            size="compact"
            icon={Wallet}
            title="Nenhum uso de crédito"
            description="Quando o crédito for usado em uma parcela, o registro aparece aqui."
          />
        }
      >
        <DataTable
          label="Histórico de uso de crédito"
          rows={applications.items}
          keyOf={(a) => a.id}
          columns={applicationColumns}
          hrefOf={(a) => `/financeiro/pedidos/${a.orderId}` as Href}
          renderCompact={(a) => (
            <View style={styles.compact}>
              <View style={styles.flex}>
                <Text variant="bodyStrong">{orderCode(a.orderId)}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${applicationLabels[a.status]} · ${formatDateTime(a.createdAt)}`}
                </Text>
              </View>
              <Text variant="figure">{formatCents(a.amountCents)}</Text>
            </View>
          )}
        />
      </ListPanel>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  summary: { gap: 2 },
  compact: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  pad: { padding: space[5] },
  list: { paddingHorizontal: space[5], paddingVertical: space[2] },
});
