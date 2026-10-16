import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Minus, Plus } from '@/ui/icons';
import { color, layout, radius, space, type as typeScale } from '@/theme';
import {
  QUANTITY_SCALE,
  decimalsFor,
  formatQuantity,
  parseQuantityInput,
  unitLabel,
  type Unit,
} from '@/lib/quantity';
import { Text } from './Text';
import { focusRing, showFocusRing, type InteractionState } from './interaction';

type Props = {
  /** Quantidade em milésimos (escala 1000). */
  value: number;
  onChange: (milli: number) => void;
  unit: Unit;
  label: string;
  /** Mínimo técnico. Pedido não tem quantidade mínima comercial. */
  min?: number;
  max?: number;
  /** Compacto (36 px) para listas densas no desktop; no celular use o padrão de 44 px. */
  size?: 'md' | 'sm';
};

/** Texto editável sem separador de milhar, para não confundir com decimal. */
const editable = (milli: number) => formatQuantity(milli).replace(/\./g, '');

/**
 * Stepper com digitação livre. Botões somam uma unidade inteira; KG/L aceitam até três casas
 * digitadas. Texto inválido não altera o valor confirmado.
 */
export function QuantityInput({ value, onChange, unit, label, min = 0, max, size = 'md' }: Props) {
  const small = size === 'sm';
  // Texto em edição; null mostra o valor confirmado (que pode mudar pelos botões).
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const parsed = draft === null ? null : parseQuantityInput(draft, unit);
    setDraft(null);
    if (parsed !== null) onChange(clamp(parsed, min, max));
  };
  const step = (dir: 1 | -1) => onChange(clamp(value + dir * QUANTITY_SCALE, min, max));

  return (
    <View style={styles.root}>
      <StepButton
        icon="minus"
        label={`Diminuir ${label}`}
        small={small}
        disabled={value <= min}
        onPress={() => step(-1)}
      />
      <View style={styles.field}>
        <TextInput
          value={draft ?? editable(value)}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          inputMode={decimalsFor(unit) ? 'decimal' : 'numeric'}
          accessibilityLabel={label}
          selectTextOnFocus
          style={[
            styles.input,
            small && styles.inputSmall,
            Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
          ]}
        />
        <Text variant="small" color={color.textSecondary}>
          {unitLabel[unit]}
        </Text>
      </View>
      <StepButton
        icon="plus"
        label={`Aumentar ${label}`}
        small={small}
        disabled={max !== undefined && value >= max}
        onPress={() => step(1)}
      />
    </View>
  );
}

function clamp(v: number, min: number, max?: number) {
  return Math.max(min, max === undefined ? v : Math.min(max, v));
}

function StepButton(props: {
  icon: 'minus' | 'plus';
  label: string;
  disabled: boolean;
  small?: boolean;
  onPress: () => void;
}) {
  const Icon = props.icon === 'minus' ? Minus : Plus;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={(s: InteractionState) => [
        styles.step,
        props.small && styles.stepSmall,
        (s.hovered || s.pressed) && { backgroundColor: color.surfaceSunken },
        props.disabled && { opacity: 0.35 },
        showFocusRing(s) && focusRing(),
      ]}
    >
      <Icon size={props.small ? 16 : 18} color={color.text} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    alignSelf: 'flex-start',
  },
  step: {
    width: layout.hitTarget,
    height: layout.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  stepSmall: { width: 36, height: 36 },
  field: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space[1],
    paddingHorizontal: space[1],
  },
  input: {
    ...typeScale.figure,
    color: color.text,
    minWidth: 48,
    maxWidth: 96,
    textAlign: 'right',
    paddingVertical: space[2],
  },
  inputSmall: { minWidth: 36, maxWidth: 72, paddingVertical: space[1] },
});
