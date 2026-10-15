import { useMemo, useState } from 'react';
import type { Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { StatusFilter, StockAdmin } from '@/api/types';
import { useCategoryLookup } from '@/features/categories/api';
import { ListPanel } from '@/features/catalog/ListStates';
import { useReplenishment, type ReplenishmentFilters } from '@/features/inventory/api';
import { InventoryNav, qty } from '@/features/inventory/StockParts';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { color, space, useLayoutSize } from '@/theme';
import { DataTable, EmptyState, SearchField, Segmented, Select, Text, type Column } from '@/ui';
import { CircleCheck, SearchX } from '@/ui/icons';

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
];

export default function ReplenishmentRoute() {
  return (
    <RequirePermission title="Reposição" anyOf={['inventory:manage']}>
      <Replenishment />
    </RequirePermission>
  );
}

function Replenishment() {
  const compact = useLayoutSize() === 'compact';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [categoryId, setCategoryId] = useState('any');
  const [sort, setSort] = useState<ReplenishmentFilters['sort']>('shortfall');
  const q = useDebouncedValue(search).trim();
  const categories = useCategoryLookup();
  const filters = useMemo<ReplenishmentFilters>(
    () => ({ q, status, sort, ...(categoryId !== 'any' ? { categoryId } : {}) }),
    [q, status, sort, categoryId],
  );
  const { query, items } = useReplenishment(filters);
  const filtered = q.length > 0 || status !== 'active' || categoryId !== 'any';

  const columns: Column<StockAdmin>[] = [
    {
      key: 'name',
      label: 'Produto',
      flex: 3,
      render: (s) => (
        <View>
          <Text variant="bodyStrong" numberOfLines={1}>
            {s.name}
          </Text>
          <Text variant="small" color={color.textSecondary} numberOfLines={1}>
            {s.status === 'inactive' ? `${s.sku} · inativo` : s.sku}
          </Text>
        </View>
      ),
    },
    {
      key: 'available',
      label: 'Disponível',
      width: 130,
      align: 'right',
      render: (s) => <Text variant="small">{qty(s.available, s.unit)}</Text>,
    },
    {
      key: 'minimum',
      label: 'Mínimo',
      width: 130,
      align: 'right',
      render: (s) => (
        <Text variant="small" color={color.textSecondary}>
          {qty(s.minimumStock, s.unit)}
        </Text>
      ),
    },
    {
      key: 'shortfall',
      label: 'Falta para o mínimo',
      width: 160,
      align: 'right',
      render: (s) => <Text variant="figure">{qty(s.suggestedQuantity, s.unit)}</Text>,
    },
  ];

  const categoryOptions = [
    { value: 'any', label: 'Todas as categorias' },
    ...(categories.data ?? []).map((c) => ({
      value: c.id,
      label: c.status === 'active' ? c.name : `${c.name} (inativa)`,
    })),
  ];

  return (
    <Screen
      title="Reposição"
      description="Produtos com disponível abaixo do estoque mínimo. Toque em um produto para registrar a entrada."
    >
      <InventoryNav current="reposicao" />

      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        <View style={styles.search}>
          <SearchField
            label="Buscar produtos"
            hideLabel
            placeholder="Buscar pelo início do nome"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <View style={styles.select}>
          <Select
            label="Categoria"
            hideLabel
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
          />
        </View>
        <Segmented label="Situação" options={statusOptions} value={status} onChange={setStatus} />
        <View style={styles.select}>
          <Select<ReplenishmentFilters['sort']>
            label="Ordenar"
            hideLabel
            value={sort}
            onChange={setSort}
            disabled={q.length > 0}
            options={[
              { value: 'shortfall', label: 'Ordem: maior falta primeiro' },
              { value: 'name', label: 'Ordem: nome (A–Z)' },
            ]}
          />
        </View>
      </View>

      <ListPanel
        query={query}
        count={items.length}
        empty={
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="Nenhum produto abaixo do mínimo nesses filtros"
              description="A busca considera o início do nome. Mude os filtros para ver outros."
            />
          ) : (
            <EmptyState
              icon={CircleCheck}
              title="Nenhum produto abaixo do mínimo"
              description="Quando o disponível ficar menor que o estoque mínimo cadastrado, o produto aparece aqui."
            />
          )
        }
      >
        <DataTable
          label="Produtos para repor"
          rows={items}
          keyOf={(s) => s.productId}
          hrefOf={(s) => `/estoque/entrada?produto=${s.productId}` as Href}
          columns={columns}
          renderCompact={(s) => (
            <View style={styles.compactRow}>
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {s.name}
                </Text>
                <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                  {`Disponível ${qty(s.available, s.unit)} · mínimo ${qty(s.minimumStock, s.unit)}`}
                </Text>
              </View>
              <View style={styles.figure}>
                <Text variant="figure">{qty(s.suggestedQuantity, s.unit)}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  falta
                </Text>
              </View>
            </View>
          )}
        />
      </ListPanel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  toolbarCompact: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  search: { flex: 1, minWidth: 240 },
  select: { minWidth: 220 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
  figure: { alignItems: 'flex-end' },
});
