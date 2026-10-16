import { StyleSheet, View } from 'react-native';
import type { ConditionOption, MethodOption } from '@/api/types';
import { FieldRow } from '@/features/catalog/FormParts';
import { formatCents } from '@/lib/money';
import { color, radius, space } from '@/theme';
import { Segmented, Select, Text, DateField } from '@/ui';
import { formatCalendarDate, type PaymentChoice } from './rules';

const intervals = [7, 10, 14, 15, 21, 28, 30, 45, 60];

/**
 * Condição de pagamento do rascunho: condição cadastrada pela empresa ou vencimentos manuais
 * (à vista ou parcelado em 2 a 12 vezes), como o contrato aceita. Condição e forma pretendida
 * ficam lado a lado; as parcelas aparecem logo abaixo como prévia. As parcelas e valores
 * oficiais são calculados pelo servidor ao salvar.
 */
export function PaymentFields({
  choice,
  onChange,
  conditions,
  methods,
  methodId,
  onMethod,
  preview,
  today,
  error,
  disabled,
}: {
  choice: PaymentChoice;
  onChange: (choice: PaymentChoice) => void;
  conditions: readonly ConditionOption[];
  methods: readonly MethodOption[];
  methodId: string | null;
  onMethod: (id: string | null) => void;
  /** Prévia das parcelas (vencimento AAAA-MM-DD e valor em centavos). */
  preview: readonly { date: string; amountCents: number }[];
  today?: string;
  error?: string;
  disabled?: boolean;
}) {
  const selectValue = choice.mode === 'condition' ? choice.conditionId : choice.mode;
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

  const condition = (
    <Select
      label="Condição de pagamento"
      value={selectValue}
      options={options}
      disabled={disabled}
      onChange={(v) => {
        if (v === 'later') onChange({ mode: 'later' });
        else if (v === 'manual') {
          const first = choice.mode === 'manual' ? choice.first : '';
          onChange({ mode: 'manual', type: 'cash', first, count: 2, interval: 30 });
        } else onChange({ mode: 'condition', conditionId: v });
      }}
    />
  );
  const method = (
    <Select
      label="Forma pretendida"
      optional
      value={methodId ?? 'none'}
      disabled={disabled || !methods.length}
      hint="Como pretende pagar. Não registra recebimento."
      options={[
        { value: 'none', label: 'Não informar' },
        ...methods.map((m) => ({ value: m.id, label: m.name })),
      ]}
      onChange={(v) => onMethod(v === 'none' ? null : v)}
    />
  );

  return (
    <View style={styles.root}>
      <FieldRow>{[condition, method]}</FieldRow>
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
            {[
              <DateField
                key="first"
                label={choice.type === 'cash' ? 'Vencimento' : 'Primeiro vencimento'}
                value={choice.first}
                min={today}
                today={today}
                disabled={disabled}
                onChange={(first) => onChange({ ...choice, first })}
              />,
              ...(choice.type === 'installments'
                ? [
                    <Select
                      key="count"
                      label="Parcelas"
                      value={String(choice.count)}
                      disabled={disabled}
                      options={Array.from({ length: 11 }, (_, i) => ({
                        value: String(i + 2),
                        label: `${i + 2} vezes`,
                      }))}
                      onChange={(v) => onChange({ ...choice, count: Number(v) })}
                    />,
                    <Select
                      key="interval"
                      label="Intervalo"
                      value={String(choice.interval)}
                      disabled={disabled}
                      options={intervals.map((d) => ({
                        value: String(d),
                        label: `A cada ${d} dias`,
                      }))}
                      onChange={(v) => onChange({ ...choice, interval: Number(v) })}
                    />,
                  ]
                : []),
            ]}
          </FieldRow>
        </>
      ) : null}
      {preview.length ? (
        <View style={styles.table} accessibilityLabel="Prévia das parcelas">
          <View style={[styles.tr, styles.thead]}>
            <Text variant="caption" color={color.textSecondary} style={styles.number}>
              Parcela
            </Text>
            <Text variant="caption" color={color.textSecondary} style={styles.flex}>
              Vencimento
            </Text>
            <Text variant="caption" color={color.textSecondary} style={styles.amount}>
              Valor
            </Text>
          </View>
          {preview.map((p, i) => (
            <View key={i} style={[styles.tr, i < preview.length - 1 && styles.divider]}>
              <Text variant="small" style={styles.number}>
                {`${i + 1}/${preview.length}`}
              </Text>
              <Text variant="small" style={styles.flex}>
                {formatCalendarDate(p.date)}
              </Text>
              <Text variant="figure" style={styles.amount}>
                {formatCents(p.amountCents)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {preview.length ? (
        <Text variant="caption" color={color.textSecondary}>
          Prévia. As parcelas oficiais são registradas ao salvar.
        </Text>
      ) : null}
      {error ? (
        <Text variant="small" color={color.danger} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[3] },
  table: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    paddingHorizontal: space[3],
  },
  tr: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 36 },
  thead: { minHeight: 30, borderBottomWidth: 1, borderBottomColor: color.border },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  number: { width: 56 },
  flex: { flex: 1, minWidth: 0 },
  amount: { minWidth: 96, textAlign: 'right' },
});
