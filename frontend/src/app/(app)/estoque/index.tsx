import { useMemo, useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { InventoryItem, StatusFilter } from '@/api/types';
import { useCategoryLookup } from '@/features/categories/api';
import { ListPanel } from '@/features/catalog/ListStates';
import { useInventoryList, type InventoryFilters } from '@/features/inventory/api';
import { StockLegend } from '@/features/inventory/StockLegend';
import { InventoryOverview } from '@/features/inventory/InventoryOverview';
import { InventoryNav, qty, StockStatus } from '@/features/inventory/StockParts';
import { isAdminStock } from '@/features/inventory/stock';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { formatQuantity, fromApiQuantity, unitLabel } from '@/lib/quantity';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Button,
  Badge,
  DataTable,
  EmptyState,
  Panel,
  SearchField,
  Segmented,
  Select,
  Text,
  type Column,
} from '@/ui';
import { Boxes, Plus, SearchX, SlidersHorizontal } from '@/ui/icons';

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
];

type SearchMode = 'name' | 'sku';
/** Mesma regra de SKU do backend; SKU inválido não é enviado. */
const skuPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export default function InventoryRoute() {
  return (
    <RequirePermission title="Estoque" anyOf={['inventory:manage', 'inventory:available:read']}>
      <Inventory />
    </RequirePermission>
  );
}

function Inventory() {
  const { permissions } = useSession();
  const manage = permissions.includes('inventory:manage');
  const layoutSize = useLayoutSize();
  const compact = layoutSize === 'compact';
  const [mode, setMode] = useState<SearchMode>('name');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [categoryId, setCategoryId] = useState('any');
  const [order, setOrder] = useState<InventoryFilters['order']>('name');
  const [stockState, setStockState] = useState<NonNullable<InventoryFilters['stockState']>>('all');
  const [showLegend, setShowLegend] = useState(false);
  const term = useDebouncedValue(search).trim();
  const categories = useCategoryLookup();
  // Celular: categoria, situação e ordem ficam recolhidas para a lista aparecer logo.
  const [showFilters, setShowFilters] = useState(false);
  const extraFilters =
    (categoryId !== 'any' ? 1 : 0) + (status !== 'active' ? 1 : 0) + (order !== 'name' ? 1 : 0);

  const skuInvalid = mode === 'sku' && term.length > 0 && !skuPattern.test(term);
  const filters = useMemo<InventoryFilters>(
    () => ({
      q: mode === 'name' ? term : '',
      ...(mode === 'sku' && term && !skuInvalid ? { sku: term } : {}),
      // Vendedor só recebe ativos: o servidor recusa outro status para ele.
      status: manage ? status : 'active',
      ...(categoryId !== 'any' ? { categoryId } : {}),
      order,
      stockState,
    }),
    [mode, term, skuInvalid, manage, status, categoryId, order, stockState],
  );
  const { query, items } = useInventoryList(filters, !skuInvalid);

  const columns: Column<InventoryItem>[] = [
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
            {s.sku}
          </Text>
          {isAdminStock(s) ? <StockStatus stock={s} /> : Number(s.available) === 0 ? <Badge label="Sem disponível" tone="danger" /> : null}
        </View>
      ),
    },
    ...(manage
      ? [
          figureColumn('available', 'Disponível', true),
          figureColumn('reserved', 'Reservado'),
          figureColumn('physical', 'Físico'),
          figureColumn('minimumStock', 'Mínimo'),
        ]
      : [
          {
            key: 'unit',
            label: 'Unidade',
            width: 90,
            render: (s: InventoryItem) => <Text variant="small">{s.unit}</Text>,
          },
          figureColumn('available', 'Disponível', true),
        ]),
  ];

  const filtered = term.length > 0 || status !== 'active' || categoryId !== 'any' || stockState !== 'all';
  const resetFilters = () => {
    setSearch(''); setStatus('active'); setCategoryId('any'); setOrder('name'); setStockState('all');
  };
  const categoryOptions = [
    { value: 'any', label: 'Todas as categorias' },
    ...(categories.data ?? []).map((c) => ({
      value: c.id,
      label: c.status === 'active' ? c.name : `${c.name} (inativa)`,
    })),
  ];

  return (
    <Screen
      title="Estoque"
      description={
        manage
          ? 'Saldos por produto: físico, reservado para pedidos e disponível para vender.'
          : 'Quanto há disponível para vender agora.'
      }
      actions={
        manage ? (
          <>
            <Link href={'/estoque/ajuste' as Href} asChild>
              <Button
                label="Ajustar saldo"
                icon={SlidersHorizontal}
                variant="outline"
                fullWidth={compact}
              />
            </Link>
            <Link href={'/estoque/entrada' as Href} asChild>
              <Button label="Registrar entrada" icon={Plus} variant="strong" fullWidth={compact} />
            </Link>
          </>
        ) : null
      }
    >
      {manage ? <InventoryNav current="saldos" /> : null}
      {manage ? <InventoryOverview /> : null}

      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        <View style={styles.search}>
          <SearchField
            label={mode === 'name' ? 'Buscar produtos' : 'Buscar por SKU'}
            hideLabel
            placeholder={
              mode === 'name' ? 'Buscar pelo início do nome' : 'SKU exato, ex.: AGUA-500'
            }
            value={search}
            onChangeText={setSearch}
            autoCapitalize={mode === 'sku' ? 'characters' : 'none'}
            error={skuInvalid ? 'Use letras, números, ponto, hífen ou sublinhado.' : undefined}
          />
        </View>
        <Segmented<SearchMode>
          label="Buscar por"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'name', label: 'Nome' },
            { value: 'sku', label: 'SKU' },
          ]}
        />
        {compact ? (
          <Button
            label={
              showFilters
                ? 'Ocultar filtros'
                : extraFilters > 0
                  ? `Filtros (${extraFilters})`
                  : 'Filtros'
            }
            icon={SlidersHorizontal}
            variant="ghost"
            onPress={() => setShowFilters((v) => !v)}
          />
        ) : null}
        {!compact || showFilters ? (
          <>
            <View style={styles.select}>
              <Select
                label="Categoria"
                hideLabel
                value={categoryId}
                options={categoryOptions}
                onChange={setCategoryId}
              />
            </View>
            {manage ? (
              <Segmented
                label="Situação"
                options={statusOptions}
                value={status}
                onChange={setStatus}
              />
            ) : null}
            <View style={styles.select}>
              <Select<InventoryFilters['order']>
                label="Ordenar"
                hideLabel
                value={order}
                onChange={setOrder}
                disabled={mode === 'name' && term.length > 0}
                options={[
                  { value: 'name', label: 'Ordem: nome (A–Z)' },
                  { value: 'recent', label: 'Ordem: cadastro mais recente' },
                ]}
              />
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.toolbar}>
        <View style={styles.select}>
          <Select<NonNullable<InventoryFilters['stockState']>>
            label="Saldo" value={stockState} onChange={setStockState}
            options={[
              { value: 'all', label: 'Todos os saldos' },
              { value: 'empty', label: 'Sem disponível' },
              { value: 'available', label: 'Com disponível' },
              ...(manage ? [
                { value: 'low' as const, label: 'Estoque baixo' },
                { value: 'reserved' as const, label: 'Com reservas' },
              ] : []),
            ]}
          />
        </View>
        <Text variant="caption" color={color.textSecondary}>
          {`${items.length} produto${items.length === 1 ? '' : 's'} carregado${items.length === 1 ? '' : 's'}${query.hasNextPage ? ' · há mais produtos' : ''}`}
        </Text>
        {filtered ? <Button label="Limpar filtros" size="sm" variant="ghost" onPress={resetFilters} /> : null}
        <Button label="Atualizar lista" size="sm" variant="ghost" loading={query.isFetching} onPress={() => query.refetch()} />
      </View>

      {!skuInvalid ? (
      <ListPanel
        query={query}
        count={items.length}
        empty={
          filtered ? (
            <EmptyState
              icon={SearchX}
              title={query.hasNextPage ? 'Ainda há produtos para consultar' : 'Nenhum produto encontrado'}
              description={
                query.hasNextPage ? 'Carregue mais para continuar buscando produtos com este saldo.' : mode === 'sku'
                  ? 'O SKU precisa ser exato. Confira a digitação ou mude os filtros.'
                  : 'A busca considera o início do nome. Confira a grafia ou mude os filtros.'
              }
            />
          ) : (
            <EmptyState
              icon={Boxes}
              title="Nenhum produto com saldo para mostrar"
              description={
                manage
                  ? 'Cada produto cadastrado aparece aqui com saldo zero até a primeira entrada.'
                  : 'Quando houver produtos ativos, a disponibilidade aparece aqui.'
              }
            />
          )
        }
      >
        <DataTable
          label="Saldos de estoque"
          rows={items}
          keyOf={(s) => s.productId}
          hrefOf={(s) => `/estoque/${s.productId}` as Href}
          columns={columns}
          stacked={layoutSize !== 'expanded'}
          actionsWidth={90}
          actions={manage && layoutSize === 'expanded' ? (s) => (
            <Link href={`/estoque/movimentacoes?produto=${s.productId}` as Href} asChild>
              <Button label="Histórico" size="sm" variant="ghost" />
            </Link>
          ) : undefined}
          renderCompact={(s) => (
            <View style={styles.compactRow}>
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {s.name}
                </Text>
                <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                  {s.sku}
                </Text>
                <Text variant="small" color={color.textSecondary}>
                  {isAdminStock(s)
                    ? `Físico ${qty(s.physical, s.unit)} · Reservado ${qty(s.reserved, s.unit)}`
                    : Number(s.available) === 0 ? 'Sem disponível' : 'Pronto para vender'}
                </Text>
                {isAdminStock(s) ? (
                  <View style={styles.badge}>
                    <StockStatus stock={s} />
                  </View>
                ) : null}
              </View>
              <View style={styles.figure}>
                <Text variant="figure">{qty(s.available, s.unit)}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  disponível
                </Text>
              </View>
            </View>
          )}
        />
      </ListPanel>
      ) : null}

      {manage ? (
        <View>
          <Button label={showLegend ? 'Ocultar ajuda' : 'Entender os saldos'} size="sm" variant="ghost" onPress={() => setShowLegend((value) => !value)} />
          {showLegend ? <Panel title="Como ler os saldos"><StockLegend /></Panel> : null}
        </View>
      ) : null}
    </Screen>
  );
}

type FigureKey = 'available' | 'reserved' | 'physical' | 'minimumStock';

function figureColumn(key: FigureKey, label: string, strong = false): Column<InventoryItem> {
  return {
    key,
    label,
    width: 100,
    align: 'right',
    render: (s) => {
      const text = key === 'available' ? s.available : isAdminStock(s) ? s[key] : null;
      if (text === null) return null;
      return (
        <Text
          variant={strong ? 'figure' : 'small'}
          color={strong ? color.text : color.textSecondary}
          accessibilityLabel={`${label}: ${qty(text, s.unit)}`}
        >
          {formatQuantity(fromApiQuantity(text))}
          <Text variant="caption" color={color.textSecondary}>{` ${unitLabel[s.unit]}`}</Text>
        </Text>
      );
    },
  };
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  toolbarCompact: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  search: { flex: 1, minWidth: 240 },
  select: { minWidth: 200 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  badge: { flexDirection: 'row', paddingTop: space[1] },
  figure: { alignItems: 'flex-end' },
});
