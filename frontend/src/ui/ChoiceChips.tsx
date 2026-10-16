import { Pressable, StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { color, fontFamily, layout, radius, space } from '@/theme';
import { CircleAlert } from './icons';
import { Text } from './Text';
import { focusRing, showFocusRing, type InteractionState } from './interaction';

export type Choice<T extends string> = { value: T; label: string; icon?: LucideIcon };

type Props<T extends string> = {
  label: string;
  options: Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  hideLabel?: boolean;
};

/**
 * Escolha única com poucas opções visíveis de uma vez (ex.: forma de pagamento). Um toque,
 * sem abrir lista. Quebra linha em telas estreitas.
 */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  disabled,
  hideLabel,
}: Props<T>) {
  return (
    <View style={styles.root}>
      {hideLabel ? null : <Text variant="smallStrong">{label}</Text>}
      <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const selected = o.value === value;
          const Icon = o.icon;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(o.value)}
              style={(s: InteractionState) => [
                styles.chip,
                selected ? styles.selected : (s.hovered || s.pressed) && styles.hover,
                disabled && styles.disabled,
                showFocusRing(s) && focusRing(),
              ]}
            >
              {Icon ? (
                <Icon
                  size={16}
                  color={selected ? color.onStructure : color.textSecondary}
                  strokeWidth={2}
                />
              ) : null}
              <Text
                variant="small"
                color={selected ? color.onStructure : color.text}
                style={{ fontFamily: selected ? fontFamily.semibold : fontFamily.medium }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <View style={styles.message} accessibilityLiveRegion="polite">
          <CircleAlert size={14} color={color.danger} strokeWidth={2} />
          <Text variant="small" color={color.danger} style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text variant="small" color={color.textSecondary}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: layout.hitTarget - 4,
    paddingHorizontal: space[3] + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  hover: { backgroundColor: 'rgba(17,17,17,0.04)' },
  selected: { backgroundColor: color.structure, borderColor: color.structure },
  disabled: { opacity: 0.5 },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: space[1] + 2 },
  flex: { flex: 1 },
});
