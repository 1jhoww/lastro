import type { ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import { color, layout, space, useLayoutSize } from '@/theme';
import { ChevronRight } from './icons';
import { Text } from './Text';
import { Touchable } from './Touchable';
import { focusRing, showFocusRing, type InteractionState } from './interaction';

export type Column<T> = {
  key: string;
  label: string;
  /** Proporção da largura (flex). */
  flex?: number;
  width?: DimensionValue;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
};

type Props<T> = {
  /** Nome da tabela para leitores de tela. */
  label: string;
  rows: T[];
  keyOf: (row: T) => string;
  columns: Column<T>[];
  /** Linha no celular: as informações essenciais empilhadas, sem cortar colunas. */
  renderCompact: (row: T) => ReactNode;
  /** Destino de cada linha. Sem ele, as linhas são só leitura (ex.: histórico de estoque). */
  hrefOf?: (row: T) => Href;
  /** Força as linhas empilhadas mesmo no desktop (ex.: dentro de uma coluna estreita). */
  stacked?: boolean;
  /**
   * Ações discretas por linha (ex.: botão de ícone "Editar"), fora do link da linha para não
   * aninhar controles. Ficam na última coluna no desktop e à direita no celular.
   */
  actions?: (row: T) => ReactNode;
  /** Largura da coluna de ações no desktop. */
  actionsWidth?: number;
};

/**
 * Lista de registros. Desktop: tabela com cabeçalho e colunas alinhadas. Celular: linhas
 * empilhadas com o essencial — nunca uma tabela espremida. Com `hrefOf`, cada linha é um link
 * para o detalhe.
 */
export function DataTable<T>({
  label,
  rows,
  keyOf,
  columns,
  renderCompact,
  hrefOf,
  stacked,
  actions,
  actionsWidth = layout.hitTarget,
}: Props<T>) {
  const compact = useLayoutSize() === 'compact' || stacked;

  if (compact && !hrefOf) {
    return (
      <View accessibilityLabel={label}>
        {rows.map((row, i) => (
          <View key={keyOf(row)} style={[styles.compactRow, i < rows.length - 1 && styles.divider]}>
            <View style={styles.flex}>{renderCompact(row)}</View>
            {actions ? actions(row) : null}
          </View>
        ))}
      </View>
    );
  }

  if (compact && hrefOf) {
    return (
      <View accessibilityLabel={label}>
        {rows.map((row, i) => {
          const link = (
            <Link key={keyOf(row)} href={hrefOf(row)} asChild>
              <Touchable
                accessibilityRole="link"
                pressStyle={(s: InteractionState) => [
                  styles.compactRow,
                  actions ? styles.flex : i < rows.length - 1 && styles.divider,
                  (s.hovered || s.pressed) && styles.hover,
                  showFocusRing(s) && focusRing(),
                ]}
              >
                <View style={styles.flex}>{renderCompact(row)}</View>
                {actions ? null : <ChevronRight size={18} color={color.textSecondary} />}
              </Touchable>
            </Link>
          );
          if (!actions) return link;
          return (
            <View
              key={keyOf(row)}
              style={[styles.withActions, i < rows.length - 1 && styles.divider]}
            >
              {link}
              <View style={styles.compactActions}>{actions(row)}</View>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View role="table" aria-label={label}>
      <View role="row" style={[styles.row, styles.head]}>
        {columns.map((c) => (
          <View key={c.key} role="columnheader" style={cellStyle(c)}>
            <Text
              variant="smallStrong"
              color={color.textSecondary}
              align={c.align === 'right' ? 'right' : 'left'}
            >
              {c.label}
            </Text>
          </View>
        ))}
        {actions ? (
          <View role="columnheader" style={{ width: actionsWidth }}>
            <Text variant="smallStrong" color={color.textSecondary} style={styles.srOnly}>
              Ações
            </Text>
          </View>
        ) : null}
      </View>
      {rows.map((row, i) =>
        !hrefOf ? (
          <View
            key={keyOf(row)}
            role="row"
            style={[styles.row, styles.bodyRow, i < rows.length - 1 && styles.divider]}
          >
            {columns.map((c) => (
              <View key={c.key} role="cell" style={cellStyle(c)}>
                {c.render(row)}
              </View>
            ))}
            {actions ? (
              <View role="cell" style={[styles.plainActions, { width: actionsWidth }]}>
                {actions(row)}
              </View>
            ) : null}
          </View>
        ) : actions ? (
          <View
            key={keyOf(row)}
            role="row"
            style={[styles.withActions, i < rows.length - 1 && styles.divider]}
          >
            <Link href={hrefOf(row)} asChild>
              <Touchable
                accessibilityRole="link"
                pressStyle={(s: InteractionState) => [
                  styles.row,
                  styles.bodyRow,
                  styles.flex,
                  styles.linkWithActions,
                  (s.hovered || s.pressed) && styles.hover,
                  showFocusRing(s) && focusRing(),
                ]}
              >
                {columns.map((c) => (
                  <View key={c.key} role="cell" style={cellStyle(c)}>
                    {c.render(row)}
                  </View>
                ))}
              </Touchable>
            </Link>
            <View role="cell" style={[styles.tableActions, { width: actionsWidth }]}>
              {actions(row)}
            </View>
          </View>
        ) : (
          <Link key={keyOf(row)} href={hrefOf(row)} asChild>
            <Touchable
              accessibilityRole="link"
              role="row"
              pressStyle={(s: InteractionState) => [
                styles.row,
                styles.bodyRow,
                i < rows.length - 1 && styles.divider,
                (s.hovered || s.pressed) && styles.hover,
                showFocusRing(s) && focusRing(),
              ]}
            >
              {columns.map((c) => (
                <View key={c.key} role="cell" style={cellStyle(c)}>
                  {c.render(row)}
                </View>
              ))}
            </Touchable>
          </Link>
        ),
      )}
    </View>
  );
}

const cellStyle = <T,>(c: Column<T>) => [
  styles.cell,
  c.width !== undefined ? { width: c.width } : { flex: c.flex ?? 1 },
  c.align === 'right' && styles.right,
];

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4], paddingHorizontal: space[5] },
  head: {
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    backgroundColor: color.canvas,
  },
  bodyRow: { minHeight: layout.hitTarget + 12, paddingVertical: space[3] },
  cell: { minWidth: 0 },
  right: { alignItems: 'flex-end' },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  hover: { backgroundColor: 'rgba(17,17,17,0.03)' },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget + 16,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  flex: { flex: 1, minWidth: 0 },
  withActions: { flexDirection: 'row', alignItems: 'center' },
  linkWithActions: { paddingRight: space[4] },
  tableActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginRight: space[5],
  },
  plainActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  compactActions: { flexDirection: 'row', alignItems: 'center', paddingRight: space[2] },
  srOnly: { opacity: 0 },
});
