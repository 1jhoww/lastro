import { Pressable, StyleSheet, View } from 'react-native';
import { Check } from '@/ui/icons';
import { color, layout, radius, space } from '@/theme';
import { Text } from './Text';
import { focusRing, showFocusRing, type InteractionState } from './interaction';

type Props = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
};

export function Checkbox({ label, checked, onChange, description, disabled }: Props) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={(s: InteractionState) => [
        styles.row,
        disabled && styles.disabled,
        showFocusRing(s) && focusRing(),
      ]}
    >
      {(s: InteractionState) => (
        <>
          <View
            style={[
              styles.box,
              checked && styles.checked,
              !checked && s.hovered && { borderColor: color.text },
            ]}
          >
            {checked ? <Check size={14} color={color.onStructure} strokeWidth={3} /> : null}
          </View>
          <View style={styles.copy}>
            <Text variant="body">{label}</Text>
            {description ? (
              <Text variant="small" color={color.textSecondary}>
                {description}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    minHeight: layout.hitTarget,
    paddingVertical: space[2] + 2,
    borderRadius: radius.sm,
  },
  box: {
    width: 20,
    height: 20,
    marginTop: 1,
    borderRadius: radius.xs + 1,
    borderWidth: 1.5,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: { backgroundColor: color.structure, borderColor: color.structure },
  copy: { flex: 1, gap: 2 },
  disabled: { opacity: 0.45 },
});
