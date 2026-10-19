import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { color, radius, space } from '@/theme';
import { Text } from './Text';

type Props = {
  title?: string;
  description?: string;
  /** Ação do cabeçalho, alinhada à direita (ex.: "Ver todos"). */
  action?: ReactNode;
  children: ReactNode;
  /** Remove o recuo interno quando o conteúdo é uma lista que vai de borda a borda. */
  flush?: boolean;
  style?: ViewStyle;
};

/** Superfície de conteúdo. Separada do fundo por borda, não por sombra. */
export function Panel({ title, description, action, children, flush, style }: Props) {
  return (
    <View style={[styles.root, style]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headings}>
            <Text variant="h3" accessibilityRole="header">
              {title}
            </Text>
            {description ? (
              <Text variant="small" color={color.textSecondary}>
                {description}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
      ) : null}
      <View style={flush ? null : styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[4],
    paddingHorizontal: space[5],
    paddingTop: space[4],
    paddingBottom: space[3],
  },
  headings: { flex: 1, minWidth: 160, gap: 2 },
  body: { paddingHorizontal: space[5], paddingBottom: space[5] },
});
