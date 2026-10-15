import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { StockAdmin } from '@/api/types';
import { formatQuantity, fromApiQuantity, type Unit } from '@/lib/quantity';
import { color, radius, space, useLayoutSize } from '@/theme';
import { Badge, Segmented, Text } from '@/ui';
import { stockColor } from './StockLegend';
import { figuresOf, needsReplenishment, type StockFigures } from './stock';

/** Quantidade da API ("12.5") em pt-BR com unidade ("12,5 kg"). */
export const qty = (text: string, unit: Unit) => formatQuantity(fromApiQuantity(text), unit);

/**
 * Barra de saldo: o comprimento total é o físico; amarelo é o disponível, carvão o reservado.
 * Decorativa: os números ao lado carregam a informação.
 */
export function StockBar({ figures }: { figures: Pick<StockFigures, 'available' | 'reserved'> }) {
  const total = figures.available + figures.reserved;
  return (
    <View
      style={styles.bar}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {total > 0 ? (
        <>
          {figures.available > 0 ? (
            <View
              style={[
                styles.segment,
                { flex: figures.available, backgroundColor: stockColor.available },
              ]}
            />
          ) : null}
          {figures.reserved > 0 ? (
            <View
              style={[
                styles.segment,
                { flex: figures.reserved, backgroundColor: stockColor.reserved },
              ]}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** Os três saldos do administrador, com o mínimo cadastrado separado deles. */
export function BalanceFigures({ stock }: { stock: StockAdmin }) {
  const f = figuresOf(stock);
  const compact = useLayoutSize() === 'compact';
  const items = [
    { label: 'Disponível', value: f.available, hint: 'Físico menos reservado' },
    { label: 'Reservado', value: f.reserved, hint: 'Comprometido com pedidos' },
    { label: 'Físico', value: f.physical, hint: 'Existente no estoque' },
  ];
  return (
    <View style={styles.figures}>
      <View style={[styles.row, compact && styles.rowCompact]}>
        {items.map((i) => (
          <View
            key={i.label}
            style={styles.figure}
            accessible
            accessibilityLabel={`${i.label}: ${formatQuantity(i.value, stock.unit)}`}
          >
            <Text variant="small" color={color.textSecondary}>
              {i.label}
            </Text>
            <Text variant={i.label === 'Disponível' ? 'figureLarge' : 'figure'}>
              {formatQuantity(i.value, stock.unit)}
            </Text>
            <Text variant="caption" color={color.textSecondary}>
              {i.hint}
            </Text>
          </View>
        ))}
      </View>
      <StockBar figures={f} />
      <View style={styles.minimum}>
        <Text variant="small" color={color.textSecondary}>
          {`Estoque mínimo cadastrado: ${formatQuantity(f.minimum, stock.unit)}`}
        </Text>
        {needsReplenishment(stock) ? (
          <Badge label={`Repor ${formatQuantity(f.shortfall, stock.unit)}`} tone="warning" />
        ) : null}
      </View>
    </View>
  );
}

/** Situação do saldo em relação ao mínimo, em texto (não só cor). */
export function StockStatus({ stock }: { stock: StockAdmin }) {
  if (stock.status === 'inactive') return <Badge label="Produto inativo" tone="neutral" />;
  if (needsReplenishment(stock)) return <Badge label="Abaixo do mínimo" tone="warning" />;
  return <Badge label="Normal" tone="success" />;
}

type Section = 'saldos' | 'reposicao' | 'movimentacoes';
const sections: { value: Section; label: string; href: Href }[] = [
  { value: 'saldos', label: 'Saldos', href: '/estoque' as Href },
  { value: 'reposicao', label: 'Reposição', href: '/estoque/reposicao' as Href },
  { value: 'movimentacoes', label: 'Movimentações', href: '/estoque/movimentacoes' as Href },
];

/** Alternância entre as visões do estoque (só administrador as tem todas). */
export function InventoryNav({ current }: { current: Section }) {
  return (
    <Segmented
      label="Visão do estoque"
      options={sections}
      value={current}
      onChange={(v) => {
        const target = sections.find((s) => s.value === v);
        if (target && v !== current) router.replace(target.href);
      }}
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: radius.xs,
    overflow: 'hidden',
    gap: 2,
    backgroundColor: stockColor.physicalTrack,
  },
  segment: { height: '100%' },
  figures: { gap: space[4], paddingTop: space[1] },
  row: { flexDirection: 'row', gap: space[5] },
  rowCompact: { flexDirection: 'column', gap: space[3] },
  figure: { flex: 1, gap: 2, minWidth: 0 },
  minimum: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    flexWrap: 'wrap',
  },
});
