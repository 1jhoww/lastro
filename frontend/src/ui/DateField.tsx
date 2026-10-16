import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  formatIsoDate,
  maskBrDate,
  monthGrid,
  monthLabel,
  parseBrDate,
  shiftMonth,
} from '@/lib/calendar';
import { color, fontFamily, radius } from '@/theme';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { IconButton } from './IconButton';
import { Calendar, ChevronLeft, ChevronRight } from './icons';
import { Text } from './Text';
import { TextField } from './TextField';
import { focusRing, showFocusRing, type InteractionState } from './interaction';

type Props = {
  label: string;
  /** Data AAAA-MM-DD ou vazio. */
  value: string;
  onChange: (value: string) => void;
  /** Limites inclusivos (AAAA-MM-DD). */
  min?: string;
  max?: string;
  /** Mês exibido ao abrir o calendário sem data escolhida. */
  today?: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  disabled?: boolean;
};

const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/**
 * Data de calendário: digitação com máscara DD/MM/AAAA ou escolha no calendário (mesmo
 * comportamento no celular e no desktop). O valor entregue é AAAA-MM-DD, como a API espera.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  today,
  hint,
  error,
  optional,
  disabled,
}: Props) {
  const [text, setText] = useState(formatIsoDate(value));
  const [seen, setSeen] = useState(value);
  const [open, setOpen] = useState(false);
  // Valor alterado de fora (padrão "hoje", limpar filtros): reflete no texto digitado.
  if (value !== seen) {
    setSeen(value);
    if (parseBrDate(text) !== value) setText(formatIsoDate(value));
  }
  const outOfRange = (d: string) => Boolean((min && d < min) || (max && d > max));
  const typedError =
    text.length === 10 && !parseBrDate(text)
      ? 'Data inexistente'
      : value && outOfRange(value)
        ? max && value > max
          ? `Use data até ${formatIsoDate(max)}`
          : `Use data a partir de ${formatIsoDate(min ?? '')}`
        : undefined;
  return (
    <View>
      <TextField
        label={label}
        value={text}
        placeholder="DD/MM/AAAA"
        inputMode="numeric"
        maxLength={10}
        optional={optional}
        editable={!disabled}
        hint={hint}
        error={error ?? typedError}
        onChangeText={(t) => {
          const masked = maskBrDate(t);
          setText(masked);
          const parsed = parseBrDate(masked) ?? '';
          setSeen(parsed);
          onChange(parsed);
        }}
        trailing={
          <IconButton
            icon={Calendar}
            label={`Abrir calendário: ${label}`}
            onPress={() => setOpen(true)}
            disabled={disabled}
          />
        }
      />
      {open ? (
        <CalendarDialog
          title={label}
          value={value}
          start={value || today || max || new Date().toISOString().slice(0, 10)}
          today={today}
          isDisabled={outOfRange}
          onClose={() => setOpen(false)}
          onPick={(d) => {
            setText(formatIsoDate(d));
            setSeen(d);
            onChange(d);
            setOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

function CalendarDialog({
  title,
  value,
  start,
  today,
  isDisabled,
  onClose,
  onPick,
}: {
  title: string;
  value: string;
  start: string;
  today?: string;
  isDisabled: (d: string) => boolean;
  onClose: () => void;
  onPick: (d: string) => void;
}) {
  const [month, setMonth] = useState(`${start.slice(0, 7)}-01`);
  return (
    <Dialog
      visible
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button label="Cancelar" variant="ghost" onPress={onClose} />
          {today && !isDisabled(today) ? (
            <Button label="Hoje" variant="outline" onPress={() => onPick(today)} />
          ) : null}
        </>
      }
    >
      <View style={styles.monthBar}>
        <IconButton
          icon={ChevronLeft}
          label="Mês anterior"
          onPress={() => setMonth(shiftMonth(month, -1))}
        />
        <Text variant="h3" style={styles.monthTitle} accessibilityLiveRegion="polite">
          {monthLabel(month).replace(/^./, (c) => c.toUpperCase())}
        </Text>
        <IconButton
          icon={ChevronRight}
          label="Próximo mês"
          onPress={() => setMonth(shiftMonth(month, 1))}
        />
      </View>
      <View style={styles.week}>
        {weekdays.map((w, i) => (
          <Text key={i} variant="caption" color={color.textSecondary} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>
      {monthGrid(month).map((week, i) => (
        <View key={i} style={styles.week}>
          {week.map((d, j) =>
            d ? (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityLabel={formatIsoDate(d)}
                accessibilityState={{ selected: d === value, disabled: isDisabled(d) }}
                disabled={isDisabled(d)}
                onPress={() => onPick(d)}
                style={(s: InteractionState) => [
                  styles.day,
                  d === today && styles.today,
                  d === value && styles.selected,
                  (s.hovered || s.pressed) && d !== value && styles.dayHover,
                  showFocusRing(s) && focusRing(),
                ]}
              >
                <Text
                  variant="body"
                  color={
                    d === value
                      ? color.onStructure
                      : isDisabled(d)
                        ? color.textDisabled
                        : color.text
                  }
                  style={d === value || d === today ? { fontFamily: fontFamily.semibold } : null}
                >
                  {String(Number(d.slice(8)))}
                </Text>
              </Pressable>
            ) : (
              <View key={`empty-${j}`} style={styles.day} />
            ),
          )}
        </View>
      ))}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { flex: 1, textAlign: 'center' },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  weekday: { flex: 1, textAlign: 'center' },
  day: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 48,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  dayHover: { backgroundColor: 'rgba(17,17,17,0.05)' },
  today: { borderWidth: 1, borderColor: color.borderStrong },
  selected: { backgroundColor: color.structure },
});
