import { centsFromDigits, formatCents } from '@/lib/money';
import { TextField, type TextFieldProps } from './TextField';

type Props = Omit<
  TextFieldProps,
  'value' | 'onChangeText' | 'onChange' | 'inputMode' | 'keyboardType'
> & {
  /** Centavos inteiros. */
  value: number;
  onChange: (cents: number) => void;
  maxCents?: number;
};

/** Valor monetário digitado como centavos: os dígitos entram pela direita. */
export function CurrencyInput({ value, onChange, maxCents, ...rest }: Props) {
  return (
    <TextField
      {...rest}
      value={formatCents(value)}
      onChangeText={(text) => onChange(centsFromDigits(text, maxCents))}
      inputMode="numeric"
      style={{ fontVariant: ['tabular-nums'] }}
    />
  );
}
