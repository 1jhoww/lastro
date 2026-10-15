import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, elevation, radius, space, useLayoutSize } from '@/theme';
import { Text } from './Text';

type Props = {
  visible: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  /** Botões no rodapé; a ação principal vem por último. */
  actions?: ReactNode;
};

/**
 * Camada modal. Celular: folha presa à base da tela (alcance do polegar). Desktop: caixa
 * centralizada. Esc (web) e o botão voltar (Android) fecham via onRequestClose.
 */
export function Dialog({ visible, title, description, onClose, children, actions }: Props) {
  const compact = useLayoutSize() === 'compact';
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={compact ? 'slide' : 'fade'}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.backdrop, compact ? styles.bottom : styles.center]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          role="dialog"
          aria-label={title}
          style={[
            styles.sheet,
            compact ? styles.sheetCompact : styles.sheetWide,
            compact && { paddingBottom: Math.max(insets.bottom, space[4]) },
          ]}
        >
          <View style={styles.header}>
            <Text variant="h2" accessibilityRole="header">
              {title}
            </Text>
            {description ? (
              <Text variant="body" color={color.textSecondary}>
                {description}
              </Text>
            ) : null}
          </View>
          {children ? (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : null}
          {actions ? (
            <View style={[styles.actions, compact && styles.actionsCompact]}>{actions}</View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: color.overlay },
  bottom: { justifyContent: 'flex-end' },
  center: { justifyContent: 'center', alignItems: 'center', padding: space[6] },
  sheet: { backgroundColor: color.canvas, ...elevation.overlay, maxHeight: '90%' },
  sheetCompact: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space[5],
  },
  sheetWide: { width: '100%', maxWidth: 520, borderRadius: radius.xl, paddingTop: space[6] },
  header: { gap: space[1], paddingHorizontal: space[5], paddingBottom: space[3] },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: space[5], paddingBottom: space[3], gap: space[4] },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space[2],
    paddingHorizontal: space[5],
    paddingTop: space[3],
    paddingBottom: space[5],
  },
  actionsCompact: { flexDirection: 'column-reverse', alignItems: 'stretch', paddingBottom: 0 },
});
