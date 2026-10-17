import { useMemo, useState } from 'react';
import type { Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { RepurchaseRow, RepurchaseStatus } from '@/api/types';
import { ListPanel, countLabel } from '@/features/catalog/ListStates';
import { RequirePermission } from '@/features/session/RequirePermission';
import { memberLabel, useMembers } from '@/features/users/api';
import { useRepurchaseList, type RepurchaseFilters } from '@/features/visits/api';
import { VisitsNav } from '@/features/visits/VisitsNav';
import {
  estimateDistance,
  formatDay,
  frequencyLabel,
  personLabel,
  repurchaseCopy,
} from '@/features/visits/presentation';
import { Screen } from '@/layout/Screen';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Badge,
  ChoiceChips,
  DataTable,
  EmptyState,
  SearchField,
  Select,
  Text,
  type Column,
} from '@/ui';
import { CalendarClock, SearchX } from '@/ui/icons';

type StatusFilter = 'all' | RepurchaseStatus;

export default function RepurchaseScreen() {
  return (
    <RequirePermission anyOf={['visits:own:manage']} title="Recompra">
      <Repurchase />
    </RequirePermission>
  );
}

function Repurchase() {
  const session = useSession();
  const me = session.user?.uid;
  const admin = session.role === 'administrator';
  const compact = useLayoutSize() === 'compact';
  const members = useMembers(admin && session.permissions.includes('users:manage'));
  const [status, setStatus] = useState<StatusFilter>('all');
  const [seller, setSeller] = useState('any');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search).trim();
  const filters = useMemo<RepurchaseFilters>(
    () => ({
      ...(status !== 'all' ? { status } : {}),
      ...(seller !== 'any' ? { sellerUid: seller } : {}),
      ...(q ? { q } : {}),
    }),
    [status, seller, q],
  );
  const { query, items, totals, meta } = useRepurchaseList(filters);
  const count = (s: RepurchaseStatus) => (totals ? ` (${totals[s]})` : '');
  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'overdue', label: `${repurchaseCopy.overdue.label}${count('overdue')}` },
    { value: 'on_track', label: `${repurchaseCopy.on_track.label}${count('on_track')}` },
    {
      value: 'insufficient_history',
      label: `${repurchaseCopy.insufficient_history.label}${count('insufficient_history')}`,
    },
  ];
  const sellerOptions = [
    { value: 'any', label: 'Todos os vendedores' },
    { value: 'unassigned', label: 'Sem responsável' },
    ...(members.data ?? [])
      .filter((m) => m.role === 'seller')
      .map((m) => ({ value: m.id, label: memberLabel(m) })),
  ];

  const columns: Column<RepurchaseRow>[] = [
    {
      key: 'customer',
      label: 'Cliente',
      flex: 3,
      render: (r) => (
        <Text variant="bodyStrong" numberOfLines={1}>
          {r.customerName}
        </Text>
      ),
    },
    ...(admin
      ? [
          {
            key: 'seller',
            label: 'Vendedor',
            flex: 2,
            render: (r: RepurchaseRow) => (
              <Text variant="small" numberOfLines={1}>
                {personLabel(r.sellerUid, r.sellerName, me)}
              </Text>
            ),
          },
        ]
      : []),
    {
      key: 'last',
      label: 'Última compra',
      width: 116,
      render: (r) => <Text variant="small">{formatDay(r.lastPurchaseOn)}</Text>,
    },
    {
      key: 'frequency',
      label: 'Frequência estimada',
      width: 150,
      render: (r) => <Text variant="small">{frequencyLabel(r.frequencyDays)}</Text>,
    },
    {
      key: 'next',
      label: 'Estimativa de recompra',
      flex: 2,
      render: (r) => <NextCell row={r} />,
    },
    {
      key: 'status',
      label: 'Situação',
      width: 196,
      render: (r) => (
        <Badge label={repurchaseCopy[r.status].label} tone={repurchaseCopy[r.status].tone} />
      ),
    },
  ];
  const filtered = status !== 'all' || seller !== 'any' || Boolean(q);

  return (
    <Screen
      title="Recompra"
      description={
        query.isPending
          ? 'Estimativas a partir dos pedidos confirmados.'
          : countLabel(items.length, Boolean(query.hasNextPage), 'cliente', 'clientes')
      }
    >
      <VisitsNav current="repurchase" />
      <Text variant="small" color={color.textSecondary}>
        {`Estimativa de recompra: mediana dos intervalos entre compras confirmadas nos últimos ${Math.round((meta?.lookbackDays ?? 365) / 30.4)} meses, com pelo menos ${meta?.minimumPurchases ?? 3} compras. É uma referência, não uma data garantida.`}
      </Text>
      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        <View style={styles.search}>
          <SearchField
            label="Buscar cliente"
            hideLabel
            placeholder="Nome do cliente"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        {admin && members.data ? (
          <View style={[styles.field, compact && styles.fieldCompact]}>
            <Select
              label="Vendedor"
              hideLabel
              value={seller}
              options={sellerOptions}
              onChange={setSeller}
            />
          </View>
        ) : null}
      </View>
      <ChoiceChips
        label="Situação"
        hideLabel
        options={statusOptions}
        value={status}
        onChange={setStatus}
      />

      <ListPanel
        query={query}
        count={items.length}
        empty={
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="Nenhum cliente nesta situação"
              description="Mude a busca ou os filtros para ver outros clientes."
            />
          ) : (
            <EmptyState
              icon={CalendarClock}
              title={admin ? 'Nenhum cliente ativo' : 'Sua carteira está vazia'}
              description="A estimativa aparece para clientes ativos com pedidos confirmados."
            />
          )
        }
      >
        <DataTable
          label="Recompra"
          rows={items}
          keyOf={(r) => r.customerId}
          hrefOf={(r) => `/clientes/${r.customerId}` as Href}
          columns={columns}
          renderCompact={(r) => (
            <View style={styles.compact}>
              <View style={styles.compactHead}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {r.customerName}
                </Text>
                <Badge
                  label={repurchaseCopy[r.status].label}
                  tone={repurchaseCopy[r.status].tone}
                />
              </View>
              <Text variant="small" color={color.textSecondary}>
                {`Última compra ${formatDay(r.lastPurchaseOn)} · ${frequencyLabel(r.frequencyDays)}`}
              </Text>
              {r.nextEstimatedOn ? <NextCell row={r} /> : null}
              {admin ? (
                <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
                  {personLabel(r.sellerUid, r.sellerName, me)}
                </Text>
              ) : null}
            </View>
          )}
        />
      </ListPanel>
    </Screen>
  );
}

function NextCell({ row: r }: { row: RepurchaseRow }) {
  if (!r.nextEstimatedOn)
    return (
      <Text variant="small" color={color.textSecondary}>
        {r.lastPurchaseOn ? 'Histórico insuficiente' : 'Sem compras no último ano'}
      </Text>
    );
  return (
    <Text variant="small" color={r.status === 'overdue' ? color.text : undefined}>
      {`${formatDay(r.nextEstimatedOn)} · ${estimateDistance(r.daysFromEstimate)}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  toolbarCompact: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  search: { flex: 1, minWidth: 240 },
  field: { minWidth: 220 },
  fieldCompact: { minWidth: 0 },
  compact: { gap: 4 },
  compactHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1, minWidth: 0 },
});
