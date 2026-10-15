import { useState } from 'react';
import { useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Receivable, ReceivableStatus } from '@/api/types';
import { FieldRow, FormSection } from '@/features/catalog/FormParts';
import { ListPanel } from '@/features/catalog/ListStates';
import { CustomerPicker } from '@/features/orders/CustomerPicker';
import { formatCalendarDate, todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { formatCents } from '@/lib/money';
import { space } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Select,
  Text,
  TextField,
  type Column,
} from '@/ui';
import { CircleDollarSign } from '@/ui/icons';
import { useReceivables, type ReceivableFilters } from './api';
import { filterSchema, isOverdue, titleLabels } from './rules';
import { FinanceNav } from './FinanceNav';

export function ReceivablesScreen() {
  const params = useLocalSearchParams<{ pedido?: string }>();
  const tenant = useTenant();
  const today = tenant.data ? todayIn(tenant.data.timezone) : null;
  const [status, setStatus] = useState<'all' | ReceivableStatus>('all');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [fields, setFields] = useState({ orderId: params.pedido ?? '', from: '', to: '' });
  const [dates, setDates] = useState<Pick<ReceivableFilters, 'orderId' | 'from' | 'to'>>({
    ...(params.pedido ? { orderId: params.pedido } : {}),
  });
  const [error, setError] = useState<string | null>(null);
  const filters = {
    ...dates,
    ...(status === 'all' ? {} : { status }),
    ...(customer ? { customerId: customer.id } : {}),
  };
  const { query, items } = useReceivables(filters);
  const badge = (t: Receivable) => (
    <View style={styles.badges}>
      <Badge label={titleLabels[t.status]} tone={t.status === 'paid' ? 'success' : 'neutral'} />
      {today && isOverdue(t, today) ? <Badge label="Vencido" tone="danger" /> : null}
    </View>
  );
  const columns: Column<Receivable>[] = [
    { key: 'customer', label: 'Cliente', flex: 2, render: (t) => <Text>{t.customerName}</Text> },
    {
      key: 'installment',
      label: 'Parcela',
      width: 85,
      render: (t) => <Text>{`${t.installmentNumber}ª`}</Text>,
    },
    {
      key: 'due',
      label: 'Vencimento',
      width: 120,
      render: (t) => <Text>{formatCalendarDate(t.dueDate)}</Text>,
    },
    { key: 'status', label: 'Situação', flex: 2, render: badge },
    {
      key: 'original',
      label: 'Original',
      width: 130,
      align: 'right',
      render: (t) => <Text>{formatCents(t.originalCents)}</Text>,
    },
    {
      key: 'balance',
      label: 'Saldo',
      width: 130,
      align: 'right',
      render: (t) => <Text variant="figure">{formatCents(t.outstandingCents)}</Text>,
    },
  ];
  return (
    <Screen
      title="Financeiro"
      description="Contas a receber. Saldos oficiais por parcela, sem totalizar páginas incompletas."
    >
      <FinanceNav />
      <FormSection title="Filtros">
        <Select
          label="Situação do título"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Todos' },
            ...Object.entries(titleLabels).map(([value, label]) => ({
              value: value as ReceivableStatus,
              label,
            })),
          ]}
        />
        <FieldRow>
          <TextField
            label="Pedido (ID)"
            value={fields.orderId}
            onChangeText={(orderId) => setFields({ ...fields, orderId })}
          />
          <TextField
            label="Vencimento de"
            placeholder="AAAA-MM-DD"
            value={fields.from}
            onChangeText={(from) => setFields({ ...fields, from })}
          />
          <TextField
            label="Vencimento até"
            placeholder="AAAA-MM-DD"
            value={fields.to}
            onChangeText={(to) => setFields({ ...fields, to })}
          />
        </FieldRow>
        {error ? (
          <Alert tone="warning" title="Confira os filtros">
            {error}
          </Alert>
        ) : null}
        <View style={styles.badges}>
          <Button
            label="Aplicar período e pedido"
            variant="outline"
            onPress={() => {
              const parsed = filterSchema.safeParse(fields);
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message ?? 'Filtro inválido');
                return;
              }
              setError(null);
              setDates(Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v)));
            }}
          />
          <Button
            label={customer ? `Cliente: ${customer.name}` : 'Filtrar por cliente'}
            variant="outline"
            onPress={() => setPicking(true)}
          />
          <Button
            label="Limpar filtros"
            variant="ghost"
            onPress={() => {
              setCustomer(null);
              setStatus('all');
              setFields({ orderId: '', from: '', to: '' });
              setDates({});
              setError(null);
            }}
          />
        </View>
      </FormSection>
      <ListPanel
        query={query}
        count={items.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title="Nenhum título nestes filtros"
            description="Parcelas surgem após confirmação dos pedidos. Página vazia pode ter continuação."
          />
        }
      >
        <DataTable
          label="Contas a receber"
          rows={items}
          keyOf={(t) => t.id}
          hrefOf={(t) => `/financeiro/${t.id}` as Href}
          columns={columns}
          renderCompact={(t) => (
            <View style={styles.compact}>
              <View style={styles.flex}>
                <Text variant="bodyStrong">{t.customerName}</Text>
                <Text>{`${t.installmentNumber}ª parcela · ${formatCalendarDate(t.dueDate)}`}</Text>
                {badge(t)}
              </View>
              <Text variant="figure">{formatCents(t.outstandingCents)}</Text>
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

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  compact: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  flex: { flex: 1, gap: space[2] },
});
