import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wordmark } from '@/brand';
import { color, layout, space, useLayoutSize } from '@/theme';
import { Text } from '@/ui';

type Props = {
  title: string;
  description?: string;
  /** Ações do cabeçalho; a principal vem por último (à direita no desktop). */
  actions?: ReactNode;
  /** Mantém a ação na borda do conteúdo mesmo quando o título atinge a largura máxima. */
  alignActionsEnd?: boolean;
  children: ReactNode;
  /** Barra presa à base, fora da rolagem (ex.: resumo do carrinho no celular). */
  footer?: ReactNode;
};

/**
 * Tela padrão: cabeçalho com título da seção e conteúdo com largura máxima. No celular, o
 * wordmark fica no topo e as ações descem para baixo do título, em largura total.
 */
export function Screen({ title, description, actions, children, footer, alignActionsEnd }: Props) {
  const size = useLayoutSize();
  const insets = useSafeAreaInsets();
  const compact = size === 'compact';
  const gutter = compact ? space[4] : size === 'medium' ? space[6] : space[10];

  return (
    // iOS não redimensiona a janela com o teclado: o recuo mantém o campo focado visível.
    <KeyboardAvoidingView
      style={styles.scroll}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingTop: compact ? insets.top + space[3] : space[8],
          paddingBottom: space[12],
          paddingHorizontal: gutter,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.inner}>
          {compact ? (
            <View style={styles.topbar}>
              <Wordmark size={22} />
            </View>
          ) : null}
          <View style={[styles.header, alignActionsEnd && styles.headerEnd, compact && styles.headerCompact]}>
            <View style={styles.headings}>
              <Text variant="h1" accessibilityRole="header">
                {title}
              </Text>
              {description ? (
                <Text variant="body" color={color.textSecondary}>
                  {description}
                </Text>
              ) : null}
            </View>
            {actions ? (
              <View style={[styles.actions, compact && styles.actionsCompact]}>{actions}</View>
            ) : null}
          </View>
          {children}
        </View>
      </ScrollView>
      {footer}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.canvas },
  inner: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', gap: space[6] },
  topbar: { paddingBottom: space[2] },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space[6], flexWrap: 'wrap' },
  headerEnd: { justifyContent: 'space-between' },
  headerCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    flexWrap: 'nowrap',
    gap: space[4],
  },
  headings: { flex: 1, minWidth: 240, gap: space[1], maxWidth: 680 },
  actions: { flexDirection: 'row', gap: space[2], alignItems: 'center' },
  actionsCompact: { flexDirection: 'column', alignItems: 'stretch' },
});
