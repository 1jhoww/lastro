import { useState } from 'react';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Payable } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { FilterTabs } from '@/features/finance/FinanceParts';
import { FinanceNav } from '@/features/finance/FinanceNav';
import { Screen } from '@/layout/Screen';
import { formatIsoDate } from '@/lib/calendar';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import { Badge, Button, DataTable, EmptyState, Text, type Column } from '@/ui';
import { CircleCheck, Plus, Wallet } from '@/ui/icons';
import { usePayables, type PayableFilters } from './api';
import { originCopy, situationCopy } from './presentation';

type Situation = PayableFilters['situation'];
const views: { value: Situation; label: string }[] = [
  { value: 'open', label: 'A pagar' },
  { value: 'overdue', label: 'Vencidos' },
  { value: 'paid', label: 'Pagos' },
  { value: 'canceled', label: 'Cancelados' },
  { value: 'all', label: 'Todos' },
];

/** Títulos a pagar de compras, despesas e recorrências, por vencimento. */
export function PayablesScreen() {
  const params = useLocalSearchParams<{ situacao?: string }>();
  const { permissions } = useSession();
  const compact = useLayoutSize() === 'compact';
  const [view, setView] = useState<Situation>(
    views.some((v) => v.value === params.situacao) ? (params.situacao as Situation) : 'open',
  );
  const { query, items } = usePayables({ situation: view });
  const manage = permissions.includes('payables:manage');
  const columns: Column<Payable>[] = [
    {
      key: 'description',
      label: 'Título',
      flex: 3,
      render: (t) => (
        <View>
          <Text variant="bodyStrong" numberOfLines={1}>
            {t.description}
          </Text>
          <Text variant="small" color={color.textSecondary} numberOfLines={1}>
            {t.beneficiaryName ?? originCopy[t.origin]}
          </Text>
        </View>
      ),
    },
    {
      key: 'category',
      label: 'Categoria',
      flex: 2,
      render: (t) => (
        <Text variant="small" numberOfLines={1}>
          {t.categoryName ?? 'Sem categoria'}
        </Text>
      ),
    },
    {
      key: 'due',
      label: 'Vencimento',
      width: 110,
      render: (t) => <Text variant="small">{formatIsoDate(t.dueDate)}</Text>,
    },
    {
      key: 'situation',
      label: 'Situação',
      width: 168,
      render: (t) => <Situation_ title={t} />,
    },
    {
      key: 'balance',
      label: 'Saldo',
      width: 128,
      align: 'right',
      render: (t) => <Text variant="figure">{formatCents(t.outstandingCents)}</Text>,
    },
  ];
  return (
    <Screen
      title="Contas a pagar"
      description="Compras, despesas e recorrências. Abra um título para registrar o pagamento."
      actions={
        manage ? (
          <Link href={'/financeiro/pagar/nova' as Href} asChild>
            <Button label="Nova despesa" icon={Plus} variant="strong" fullWidth={compact} />
          </Link>
        ) : null
      }
    >
      <FinanceNav />
      <FilterTabs label="Situação" options={views} value={view} onChange={setView} />
      <ListPanel
        query={query}
        count={items.length}
        empty={
          view === 'overdue' ? (
            <EmptyState
              icon={CircleCheck}
              title="Nenhum título vencido"
              description="Quando um título passar do vencimento com saldo em aberto, ele aparece aqui."
            />
          ) : (
            <EmptyState
              icon={Wallet}
              title="Nenhum título nesta visão"
              description="Compras confirmadas geram títulos sozinhas. Despesas você lança aqui."
              action={
                manage ? (
                  <Link href={'/financeiro/pagar/nova' as Href} asChild>
                    <Button label="Nova despesa" icon={Plus} variant="strong" />
                  </Link>
                ) : undefined
              }
            />
          )
        }
      >
        <DataTable
          label="Títulos a pagar"
          rows={items}
          keyOf={(t) => t.id}
          hrefOf={(t) => `/financeiro/pagar/${t.id}` as Href}
          columns={columns}
          renderCompact={(t) => (
            <View style={styles.compact}>
              <View style={styles.head}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {t.description}
                </Text>
                <Text variant="figure">{formatCents(t.outstandingCents)}</Text>
              </View>
              <Text variant="small" color={color.textSecondary}>
                {`Vence em ${formatIsoDate(t.dueDate)}`}
              </Text>
              <Situation_ title={t} />
            </View>
          )}
        />
      </ListPanel>
    </Screen>
  );
}

export function Situation_({ title }: { title: Pick<Payable, 'situation'> }) {
  const copy = situationCopy[title.situation];
  return <Badge label={copy.label} tone={copy.tone} />;
}

const styles = StyleSheet.create({
  compact: { gap: space[1], alignItems: 'flex-start' },
  head: { flexDirection: 'row', gap: space[3], alignSelf: 'stretch' },
  flex: { flex: 1 },
});
