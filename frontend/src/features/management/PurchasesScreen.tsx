import { useState } from 'react';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Purchase } from '@/api/types';
import { ListPanel, countLabel } from '@/features/catalog/ListStates';
import { FilterTabs } from '@/features/finance/FinanceParts';
import { Screen } from '@/layout/Screen';
import { formatIsoDate } from '@/lib/calendar';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import { Badge, Button, DataTable, EmptyState, Text, type Column } from '@/ui';
import { PackageCheck, Plus, ShoppingCart } from '@/ui/icons';
import { usePurchases, type PurchaseFilters } from './api';
import { purchaseCode, purchaseStatusCopy } from './presentation';

type View_ = 'all' | 'pending' | 'draft' | 'received' | 'closed' | 'canceled';
const views: { value: View_; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'A receber' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'received', label: 'Recebidas' },
  { value: 'closed', label: 'Encerradas' },
  { value: 'canceled', label: 'Canceladas' },
];
const filtersOf = (view: View_): PurchaseFilters =>
  view === 'pending' ? { pendingReceipt: true } : view === 'all' ? {} : { status: view };

/** Pedidos de compra. "A receber" é a visão do que ainda falta chegar. */
export function PurchasesScreen() {
  const params = useLocalSearchParams<{ situacao?: string }>();
  const { permissions } = useSession();
  const compact = useLayoutSize() === 'compact';
  const [view, setView] = useState<View_>(
    views.some((v) => v.value === params.situacao) ? (params.situacao as View_) : 'all',
  );
  const { query, items } = usePurchases(filtersOf(view));
  const canCreate = permissions.includes('purchases:create');
  const columns: Column<Purchase>[] = [
    {
      key: 'number',
      label: 'Compra',
      width: 96,
      render: (p) => <Text variant="bodyStrong">{purchaseCode(p)}</Text>,
    },
    {
      key: 'supplier',
      label: 'Fornecedor',
      flex: 3,
      render: (p) => <Text numberOfLines={1}>{p.supplierName ?? 'Sem fornecedor'}</Text>,
    },
    {
      key: 'date',
      label: 'Data',
      width: 104,
      render: (p) => <Text variant="small">{formatIsoDate(p.purchaseDate)}</Text>,
    },
    {
      key: 'delivery',
      label: 'Entrega prevista',
      width: 128,
      render: (p) => (
        <Text variant="small" color={color.textSecondary}>
          {p.expectedDeliveryDate ? formatIsoDate(p.expectedDeliveryDate) : '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      label: 'Situação',
      flex: 2,
      render: (p) => <Status purchase={p} />,
    },
    {
      key: 'total',
      label: 'Total',
      width: 128,
      align: 'right',
      render: (p) => <Text variant="figure">{formatCents(p.totalCents)}</Text>,
    },
  ];
  return (
    <Screen
      title="Compras"
      description={
        query.isPending
          ? 'Pedidos de compra da empresa.'
          : countLabel(items.length, Boolean(query.hasNextPage), 'compra', 'compras')
      }
      actions={
        canCreate ? (
          <Link href={'/compras/nova' as Href} asChild>
            <Button label="Nova compra" icon={Plus} variant="strong" fullWidth={compact} />
          </Link>
        ) : null
      }
    >
      <FilterTabs label="Situação" options={views} value={view} onChange={setView} />
      <ListPanel
        query={query}
        count={items.length}
        empty={
          view === 'pending' ? (
            <EmptyState
              icon={PackageCheck}
              title="Nada aguardando recebimento"
              description="Compras confirmadas aparecem aqui até toda a mercadoria chegar."
            />
          ) : (
            <EmptyState
              icon={ShoppingCart}
              title="Nenhuma compra aqui"
              description="Registre o que comprou do fornecedor. O estoque só muda quando a mercadoria chegar."
              action={
                canCreate ? (
                  <Link href={'/compras/nova' as Href} asChild>
                    <Button label="Nova compra" icon={Plus} variant="strong" />
                  </Link>
                ) : undefined
              }
            />
          )
        }
      >
        <DataTable
          label="Compras"
          rows={items}
          keyOf={(p) => p.id}
          hrefOf={(p) => `/compras/${p.id}` as Href}
          columns={columns}
          renderCompact={(p) => (
            <View style={styles.compact}>
              <View style={styles.head}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {`${purchaseCode(p)} ${p.supplierName ?? ''}`.trim()}
                </Text>
                <Text variant="figure">{formatCents(p.totalCents)}</Text>
              </View>
              <Status purchase={p} />
            </View>
          )}
        />
      </ListPanel>
    </Screen>
  );
}

function Status({ purchase }: { purchase: Purchase }) {
  const copy = purchaseStatusCopy[purchase.status];
  return <Badge label={copy.label} tone={copy.tone} />;
}

const styles = StyleSheet.create({
  compact: { gap: space[1], alignItems: 'flex-start' },
  head: { flexDirection: 'row', gap: space[3], alignSelf: 'stretch' },
  flex: { flex: 1 },
});
