import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, layout, space } from '@/theme';
import { ChevronDown, ChevronUp } from './icons';
import { Text } from './Text';
import { focusRing, showFocusRing, type InteractionState } from './interaction';

type Props = {
  label: string;
  /** Texto curto ao lado do rótulo enquanto fechado (ex.: "referência e observação"). */
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

/**
 * Seção recolhível para o que é complementar (referência, detalhes técnicos). Mantém o fluxo
 * principal curto sem esconder nada de forma irrecuperável.
 */
export function Disclosure({ label, summary, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = open ? ChevronUp : ChevronDown;
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen((v) => !v)}
        style={(s: InteractionState) => [
          styles.toggle,
          (s.hovered || s.pressed) && styles.hover,
          showFocusRing(s) && focusRing(),
        ]}
      >
        <Text variant="smallStrong">{label}</Text>
        {summary && !open ? (
          <Text variant="small" color={color.textSecondary} style={styles.flex} numberOfLines={1}>
            {summary}
          </Text>
        ) : (
          <View style={styles.flex} />
        )}
        <Icon size={18} color={color.textSecondary} />
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2] },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: layout.hitTarget,
    paddingHorizontal: space[1],
    borderRadius: 8,
  },
  hover: { backgroundColor: 'rgba(17,17,17,0.04)' },
  flex: { flex: 1, minWidth: 0 },
  body: { gap: space[4] },
});
