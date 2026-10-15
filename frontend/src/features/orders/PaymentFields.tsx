import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ConditionOption, MethodOption } from '@/api/types';
import { FieldRow } from '@/features/catalog/FormParts';
import { color, space } from '@/theme';
import { Segmented, Select, Text, TextField } from '@/ui';
import { formatCalendarDate, manualDueDates, parseCalendarDate, type PaymentChoice } from './rules';

const intervals = [7, 10, 14, 15, 21, 28, 30, 45, 60];

/**
 * Condição de pagamento do rascunho: condição cadastrada pela empresa ou vencimentos manuais
 * (à vista ou parcelado em 2 a 12 vezes), como o contrato aceita. As parcelas e valores oficiais
 * são calculados pelo servidor ao salvar.
 */
export function PaymentFields({
  choice,
  onChange,
  conditions,
  methods,
  methodId,
  onMethod,
  error,
  disabled,
}: {
  choice: PaymentChoice;
  onChange: (choice: PaymentChoice) => void;
  conditions: readonly ConditionOption[];
  methods: readonly MethodOption[];
  methodId: string | null;
  onMethod: (id: string | null) => void;
  error?: string;
  disabled?: boolean;
}) {
  const selectValue = choice.mode === 'condition' ? choice.conditionId : choice.mode;
  const [dateText, setDateText] = useState(
    choice.mode === 'manual' ? formatCalendarDate(choice.first) : '',
  );
  const options = [
    ...conditions.map((c) => ({
      value: c.id,
      label: c.name,
      description: `${c.schedule.length} vencimento(s): ${c.schedule.map((p) => `${p.offsetDays} dias`).join(', ')}`,
    })),
    {
      value: 'manual',
      label: 'Definir vencimentos manualmente',
      description: 'À vista ou parcelado',
    },
    { value: 'later', label: 'Definir depois', description: 'O pedido não confirma sem condição' },
  ];

  return (
    <View style={styles.root}>
      <Select
        label="Condição de pagamento"
        value={selectValue}
        options={options}
        disabled={disabled}
        onChange={(v) => {
          if (v === 'later') onChange({ mode: 'later' });
          else if (v === 'manual') {
            const first = choice.mode === 'manual' ? choice.first : '';
            setDateText(first ? formatCalendarDate(first) : '');
            onChange({ mode: 'manual', type: 'cash', first, count: 2, interval: 30 });
          } else onChange({ mode: 'condition', conditionId: v });
        }}
      />
      {choice.mode === 'manual' ? (
        <>
          <Segmented<'cash' | 'installments'>
            label="Tipo de pagamento"
            value={choice.type}
            onChange={(type) => !disabled && onChange({ ...choice, type })}
            options={[
              { value: 'cash', label: 'À vista' },
              { value: 'installments', label: 'Parcelado' },
            ]}
          />
          <FieldRow>
            <TextField
              label={choice.type === 'cash' ? 'Vencimento' : 'Primeiro vencimento'}
              placeholder="DD/MM/AAAA"
              inputMode="numeric"
              value={dateText}
              editable={!disabled}
              onChangeText={(t) => {
                setDateText(t);
                onChange({ ...choice, first: parseCalendarDate(t) ?? '' });
              }}
            />
            {choice.type === 'installments' ? (
              <Select
                label="Parcelas"
                value={String(choice.count)}
                disabled={disabled}
                options={Array.from({ length: 11 }, (_, i) => ({
                  value: String(i + 2),
                  label: `${i + 2} vezes`,
                }))}
                onChange={(v) => onChange({ ...choice, count: Number(v) })}
              />
            ) : null}
            {choice.type === 'installments' ? (
              <Select
                label="Intervalo"
                value={String(choice.interval)}
                disabled={disabled}
                options={intervals.map((d) => ({ value: String(d), label: `A cada ${d} dias` }))}
                onChange={(v) => onChange({ ...choice, interval: Number(v) })}
              />
            ) : null}
          </FieldRow>
          {choice.first ? (
            <Text variant="small" color={color.textSecondary}>
              {`Vencimentos: ${manualDueDates(choice).map(formatCalendarDate).join(' · ')}`}
            </Text>
          ) : null}
        </>
      ) : null}
      {methods.length ? (
        <Select
          label="Forma de pagamento pretendida"
          optional
          value={methodId ?? 'none'}
          disabled={disabled}
          options={[
            { value: 'none', label: 'Não informar' },
            ...methods.map((m) => ({ value: m.id, label: m.name })),
          ]}
          onChange={(v) => onMethod(v === 'none' ? null : v)}
        />
      ) : null}
      {error ? (
        <Text variant="small" color={color.danger} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: space[3] } });
