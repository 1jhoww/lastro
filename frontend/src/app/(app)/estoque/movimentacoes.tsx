import { useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { MovementType } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { useInventoryItem, useMovements, type MovementFilters } from '@/features/inventory/api';
import { MovementTable } from '@/features/inventory/MovementTable';
import { ProductPicker } from '@/features/inventory/ProductPicker';
import { InventoryNav } from '@/features/inventory/StockParts';
import { movementTypeLabel, movementTypes, periodStart } from '@/features/inventory/stock';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { color, space, useLayoutSize } from '@/theme';
import { Button, EmptyState, Segmented, Select, Text } from '@/ui';
import { ListClock, SearchX, X } from '@/ui/icons';

type Period = 'all' | '7' | '30' | '90';
const periods: { value: Period; label: string }[] = [
  { value: 'all', label: 'Todo o período' },
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
];

export default function MovementsRoute() {
  return (
    <RequirePermission title="Movimentações" anyOf={['inventory:manage']}>
      <Movements />
    </RequirePermission>
  );
}

function Movements() {
  const params = useLocalSearchParams<{ produto?: string }>();
  const productId =
    typeof params.produto === 'string' && params.produto ? params.produto : undefined;
  const compact = useLayoutSize() === 'compact';
  const [type, setType] = useState<MovementType | 'any'>('any');
  const [period, setPeriod] = useState<Period>('all');
  const [direction, setDirection] = useState<'desc' | 'asc'>('desc');
  const [picking, setPicking] = useState(false);
  const product = useInventoryItem(productId);

  const filters = useMemo<MovementFilters>(
    () => ({
      direction,
      ...(productId ? { productId } : {}),
      ...(type !== 'any' ? { type } : {}),
      ...(period !== 'all' ? { from: periodStart(Number(period)) } : {}),
    }),
    [direction, productId, type, period],
  );
  const { query, items } = useMovements(filters);
  const filtered = Boolean(productId) || type !== 'any' || period !== 'all';

  return (
    <Screen
      title="Movimentações"
      description="Histórico imutável: entradas, ajustes e movimentos automáticos dos pedidos."
    >
      <InventoryNav current="movimentacoes" />

      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        {productId ? (
          <View style={styles.chip}>
            <Text variant="smallStrong" numberOfLines={1} style={styles.flex}>
              {`Produto: ${product.data?.name ?? 'carregando…'}`}
            </Text>
            <Button
              label="Remover"
              icon={X}
              size="sm"
              variant="ghost"
              onPress={() => router.setParams({ produto: '' })}
            />
          </View>
        ) : (
          <Button label="Filtrar por produto" variant="outline" onPress={() => setPicking(true)} />
        )}
        <View style={styles.select}>
          <Select<MovementType | 'any'>
            label="Tipo"
            hideLabel
            value={type}
            onChange={setType}
            options={[
              { value: 'any', label: 'Todos os tipos' },
              ...movementTypes.map((t) => ({ value: t, label: movementTypeLabel[t] })),
            ]}
          />
        </View>
        <View style={styles.select}>
          <Select<Period>
            label="Período"
            hideLabel
            value={period}
            onChange={setPeriod}
            options={periods}
          />
        </View>
        <Segmented<'desc' | 'asc'>
          label="Ordem"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'desc', label: 'Mais recentes' },
            { value: 'asc', label: 'Mais antigas' },
          ]}
        />
      </View>

      <ListPanel
        query={query}
        count={items.length}
        empty={
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="Nenhuma movimentação nesses filtros"
              description="Mude o tipo, o período ou o produto."
            />
          ) : (
            <EmptyState
              icon={ListClock}
              title="Nenhuma movimentação registrada"
              description="Entradas, ajustes e movimentos de pedidos aparecem aqui."
            />
          )
        }
      >
        <MovementTable rows={items} showProduct={!productId} />
      </ListPanel>

      <Text variant="caption" color={color.textSecondary}>
        Responsáveis aparecem como “Você” ou por um código: o histórico não informa nomes.
      </Text>

      <ProductPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPicking(false);
          router.setParams({ produto: p.productId });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  toolbarCompact: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  select: { minWidth: 200 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingLeft: space[3],
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: 10,
    backgroundColor: color.surface,
    minWidth: 240,
    flexShrink: 1,
  },
  flex: { flexShrink: 1 },
});
