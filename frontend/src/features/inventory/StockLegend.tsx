import { StyleSheet, View } from 'react-native';
import { color, radius, space } from '@/theme';
import { Text } from '@/ui';

/**
 * Como o Lastro diferencia os três saldos: físico é a barra inteira (o que está na prateleira),
 * reservado é a parte comprometida com pedidos confirmados, disponível é o que sobra para vender.
 * As mesmas cores valem para a barra de saldo de cada produto.
 */
export const stockColor = {
  reserved: color.structure,
  available: color.accent,
  physicalTrack: color.surfaceSunken,
} as const;

const entries = [
  { swatch: stockColor.available, label: 'Disponível', body: 'Pode ser vendido agora.' },
  {
    swatch: stockColor.reserved,
    label: 'Reservado',
    body: 'Comprometido com pedidos confirmados.',
  },
  { swatch: null, label: 'Físico', body: 'Disponível + reservado: o que está no estoque.' },
];

export function StockLegend() {
  return (
    <View style={styles.root}>
      <View
        style={styles.bar}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.segment, { flex: 5, backgroundColor: stockColor.available }]} />
        <View style={[styles.segment, { flex: 2, backgroundColor: stockColor.reserved }]} />
      </View>
      <View style={styles.list}>
        {entries.map((e) => (
          <View key={e.label} style={styles.entry}>
            <View
              style={[
                styles.swatch,
                e.swatch ? { backgroundColor: e.swatch } : styles.swatchOutline,
              ]}
            />
            <View style={styles.copy}>
              <Text variant="smallStrong">{e.label}</Text>
              <Text variant="small" color={color.textSecondary}>
                {e.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[4] },
  bar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.xs,
    overflow: 'hidden',
    gap: 2,
    backgroundColor: stockColor.physicalTrack,
  },
  segment: { height: '100%' },
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: space[5] },
  entry: { flexDirection: 'row', gap: space[2], minWidth: 180, flex: 1 },
  swatch: { width: 12, height: 12, borderRadius: 3, marginTop: 3 },
  swatchOutline: { borderWidth: 1.5, borderColor: color.text },
  copy: { flex: 1, gap: 1 },
});
