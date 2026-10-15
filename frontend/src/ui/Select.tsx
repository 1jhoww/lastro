import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, layout, radius, space } from '@/theme';
import { Check, ChevronDown, CircleAlert } from './icons';
import { Dialog } from './Dialog';
import { Text } from './Text';
import { Touchable } from './Touchable';
import { focusRing, showFocusRing, type InteractionState } from './interaction';

export type SelectOption<T extends string> = { value: T; label: string; description?: string };

type Props<T extends string> = {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  disabled?: boolean;
  hideLabel?: boolean;
};

/**
 * Escolha única em lista. Abre uma folha (celular) ou caixa (desktop) com as opções, em vez do
 * <select> nativo, para ter a mesma aparência e acessibilidade nas três plataformas.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Escolha',
  hint,
  error,
  optional,
  disabled,
  hideLabel,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={styles.root}>
      {hideLabel ? null : (
        <View style={styles.labelRow}>
          <Text variant="smallStrong">{label}</Text>
          {optional ? (
            <Text variant="small" color={color.textSecondary}>
              opcional
            </Text>
          ) : null}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={(s: InteractionState) => [
          styles.box,
          { borderColor: error ? color.danger : color.borderStrong },
          disabled && styles.disabled,
          showFocusRing(s) && focusRing(),
        ]}
      >
        <Text
          variant="body"
          color={current ? color.text : color.textPlaceholder}
          style={styles.flex}
          numberOfLines={1}
        >
          {current?.label ?? placeholder}
        </Text>
        <ChevronDown size={18} color={color.textSecondary} />
      </Pressable>
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
      <Dialog visible={open} title={label} onClose={() => setOpen(false)}>
        <View accessibilityRole="radiogroup" accessibilityLabel={label}>
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <Touchable
                key={o.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={o.label}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                pressStyle={(s: InteractionState) => [
                  styles.option,
                  i < options.length - 1 && styles.divider,
                  (s.hovered || s.pressed) && { backgroundColor: 'rgba(17,17,17,0.04)' },
                  showFocusRing(s) && focusRing(),
                ]}
              >
                <View style={styles.flex}>
                  <Text variant={selected ? 'bodyStrong' : 'body'}>{o.label}</Text>
                  {o.description ? (
                    <Text variant="small" color={color.textSecondary}>
                      {o.description}
                    </Text>
                  ) : null}
                </View>
                {selected ? <Check size={18} color={color.text} strokeWidth={2.25} /> : null}
              </Touchable>
            );
          })}
        </View>
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2], alignSelf: 'stretch' },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  box: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: color.surface,
  },
  disabled: { backgroundColor: color.surfaceSunken },
  flex: { flex: 1 },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: space[1] + 2, paddingTop: 1 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget + 8,
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
});
