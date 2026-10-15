import { useId, useState, type ReactNode, type Ref } from 'react';
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { CircleAlert, type LucideIcon } from '@/ui/icons';
import { color, fontFamily, radius, space, type as typeScale } from '@/theme';
import { Text } from './Text';

export type TextFieldProps = TextInputProps & {
  label: string;
  /** Orientação curta abaixo do campo. Some quando há erro. */
  hint?: string;
  error?: string;
  /** Marca o campo como opcional, em vez de asteriscos nos obrigatórios. */
  optional?: boolean;
  icon?: LucideIcon;
  trailing?: ReactNode;
  /** Oculta o rótulo visual mantendo-o para leitores de tela. */
  hideLabel?: boolean;
  ref?: Ref<TextInput>;
};

export function TextField({
  label,
  hint,
  error,
  optional,
  icon: Icon,
  trailing,
  hideLabel,
  editable = true,
  onFocus,
  onBlur,
  style,
  ref,
  ...rest
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const borderColor = error ? color.danger : focused ? color.text : color.borderStrong;

  return (
    <View style={styles.root}>
      {hideLabel ? null : (
        <View style={styles.labelRow}>
          <Text nativeID={`${id}-label`} variant="smallStrong">
            {label}
          </Text>
          {optional ? (
            <Text variant="small" color={color.textSecondary}>
              opcional
            </Text>
          ) : null}
        </View>
      )}
      <View
        style={[
          styles.box,
          { borderColor },
          focused && !error && styles.focusRing,
          error && focused && styles.errorRing,
          !editable && styles.disabled,
        ]}
      >
        {Icon ? <Icon size={18} color={color.textSecondary} strokeWidth={1.75} /> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          aria-labelledby={hideLabel ? undefined : `${id}-label`}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          editable={editable}
          placeholderTextColor={color.textPlaceholder}
          selectionColor={color.text}
          cursorColor={color.text}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, !editable && { color: color.textSecondary }, style]}
        />
        {trailing}
      </View>
      {error ? (
        <View style={styles.message} accessibilityLiveRegion="polite">
          <CircleAlert size={14} color={color.danger} strokeWidth={2} />
          <Text nativeID={`${id}-error`} variant="small" color={color.danger} style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text nativeID={`${id}-hint`} variant="small" color={color.textSecondary}>
          {hint}
        </Text>
      ) : null}
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
  focusRing: { boxShadow: '0 0 0 3px rgba(243,184,0,0.45)' },
  errorRing: { boxShadow: '0 0 0 3px rgba(180,35,24,0.18)' },
  disabled: { backgroundColor: color.surfaceSunken },
  input: {
    flex: 1,
    minHeight: 46,
    ...typeScale.body,
    fontFamily: fontFamily.regular,
    color: color.text,
    paddingVertical: space[2],
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: space[1] + 2, paddingTop: 1 },
  flex: { flex: 1 },
});
