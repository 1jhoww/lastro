import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { color, space, useLayoutSize } from '@/theme';
import { Text } from '@/ui';

/** Par rótulo/valor de uma ficha de cadastro. Valor vazio aparece como "Não informado". */
export function Fact({ label, value }: { label: string; value?: ReactNode }) {
  const empty = value === undefined || value === null || value === '';
  return (
    <View style={styles.fact}>
      <Text variant="small" color={color.textSecondary}>
        {label}
      </Text>
      {typeof value === 'string' || empty ? (
        <Text variant="body" color={empty ? color.textSecondary : color.text} selectable>
          {empty ? 'Não informado' : (value as string)}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

/** Grade de fatos: duas colunas no desktop, uma no celular. */
export function Facts({ children }: { children: ReactNode }) {
  const compact = useLayoutSize() === 'compact';
  if (compact) return <View style={styles.grid}>{children}</View>;
  return (
    <View style={[styles.grid, styles.gridWide]}>
      {Children.toArray(children).map((child, i) => (
        <View key={i} style={styles.cell}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** Duas colunas no desktop largo: principal (dados) e lateral (situação e ações). */
export function DetailColumns({ main, side }: { main: ReactNode; side: ReactNode }) {
  const wide = useLayoutSize() === 'expanded';
  return (
    <View style={[styles.columns, wide && styles.columnsWide]}>
      <View style={[styles.col, wide && { flex: 3 }]}>{main}</View>
      <View style={[styles.col, wide && { flex: 2 }]}>{side}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fact: { gap: 2, minWidth: 0 },
  grid: { gap: space[4], paddingTop: space[1] },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space[6] },
  cell: { width: '45%', flexGrow: 1 },
  columns: { gap: space[5] },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { gap: space[5] },
});
