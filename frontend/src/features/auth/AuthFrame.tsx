import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wordmark } from '@/brand';
import { color, space, useLayoutSize } from '@/theme';
import { Text } from '@/ui';

/**
 * Moldura das telas de acesso. Desktop: painel de marca em carvão à esquerda (como a capa do
 * brand kit) e formulário no bege. Celular: faixa escura curta com o wordmark e o formulário logo
 * abaixo, sem rolar até os campos.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  const size = useLayoutSize();
  const insets = useSafeAreaInsets();
  const compact = size === 'compact';

  const form = (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.formScroll, compact && styles.formScrollCompact]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  if (compact) {
    return (
      <View style={styles.flex}>
        <View style={[styles.bandCompact, { paddingTop: insets.top + space[6] }]}>
          <Wordmark size={36} tone="onDark" signature />
        </View>
        {form}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={[styles.brandPanel, size === 'medium' && styles.brandPanelMedium]}>
        <Wordmark size={size === 'expanded' ? 88 : 64} tone="onDark" />
        <View style={styles.tagline}>
          <Text variant="bodyLarge" color={color.onStructureSecondary}>
            Uma base sólida para o seu negócio.
          </Text>
          <View style={styles.rule} />
        </View>
        <Text variant="small" color={color.onStructureMuted} style={styles.signature}>
          by hepta
        </Text>
      </View>
      <View style={[styles.flex, styles.formSide]}>{form}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: color.canvas },
  row: { flex: 1, flexDirection: 'row' },
  brandPanel: {
    flex: 5,
    backgroundColor: color.structure,
    paddingHorizontal: space[16],
    justifyContent: 'center',
    gap: space[6],
  },
  brandPanelMedium: { paddingHorizontal: space[10] },
  tagline: { gap: space[5], maxWidth: 360 },
  rule: { width: 32, height: 2, backgroundColor: color.accent },
  signature: { position: 'absolute', bottom: space[10], left: space[16] },
  formSide: { flex: 4 },
  formScroll: { flexGrow: 1, justifyContent: 'center', padding: space[10] },
  formScrollCompact: { justifyContent: 'flex-start', padding: space[5], paddingTop: space[8] },
  form: { width: '100%', maxWidth: 380, alignSelf: 'center', gap: space[6] },
  bandCompact: {
    backgroundColor: color.structure,
    paddingHorizontal: space[5],
    paddingBottom: space[6],
  },
});
