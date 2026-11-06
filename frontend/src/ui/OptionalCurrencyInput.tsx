import { centsFromDigits, formatCents } from '@/lib/money';
import { TextField, type TextFieldProps } from './TextField';

type Props = Omit<
  TextFieldProps,
  'value' | 'onChangeText' | 'onChange' | 'inputMode' | 'keyboardType' | 'optional'
> & {
  /** Centavos inteiros, ou `null` quando não informado. */
  value: number | null;
  onChange: (cents: number | null) => void;
  maxCents?: number;
};

/**
 * Valor monetário que pode ficar em branco: "sem valor" não vira um zero enganoso. Os dígitos
 * entram pela direita, como em `CurrencyInput`; apagar tudo devolve `null`.
 */
export function OptionalCurrencyInput({ value, onChange, maxCents, ...rest }: Props) {
  return (
    <TextField
      {...rest}
      optional
      value={value === null ? '' : formatCents(value)}
      placeholder={formatCents(0)}
      onChangeText={(text) => {
        const cents = centsFromDigits(text, maxCents);
        onChange(cents === 0 ? null : cents);
      }}
      inputMode="numeric"
      style={{ fontVariant: ['tabular-nums'] }}
    />
  );
}
