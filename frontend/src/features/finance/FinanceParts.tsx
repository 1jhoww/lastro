import type { ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import type { PaymentMethod, Receivable } from '@/api/types';
import { formatCents } from '@/lib/money';
import { color, space, useLayoutSize } from '@/theme';
import { Badge, ChoiceChips, Segmented, Text } from '@/ui';
import {
  Banknote,
  CircleDollarSign,
  CreditCard,
  FileText,
  Info,
  Landmark,
  QrCode,
} from '@/ui/icons';
import { dueKey, dueLabels, isPartial } from './presentation';

/** Situação de cobrança do título; "Parcial" acompanha quando já houve recebimento. */
export function DueBadge({
  title,
  today,
}: {
  title: Pick<Receivable, 'status' | 'outstandingCents' | 'dueDate' | 'cashCents' | 'creditCents'>;
  today: string | null;
}) {
  const d = dueLabels[dueKey(title, today)];
  return (
    <View style={styles.badges}>
      <Badge label={d.label} tone={d.tone} />
      {isPartial(title) ? <Badge label="Parcial" tone="accent" /> : null}
    </View>
  );
}

/** Indicador do painel: rótulo discreto, valor em destaque e escopo logo abaixo. */
export function Metric({
  label,
  cents,
  caption,
  tone = 'default',
  unavailable,
}: {
  label: string;
  cents: number | null;
  caption?: string;
  tone?: 'default' | 'danger' | 'success';
  /** Motivo quando o valor não pode ser afirmado com os dados disponíveis. */
  unavailable?: string;
}) {
  const compact = useLayoutSize() === 'compact';
  const fg =
    tone === 'danger' && cents ? color.danger : tone === 'success' ? color.success : color.text;
  return (
    <View
      style={styles.metric}
      accessible
      accessibilityLabel={`${label}: ${cents === null ? 'indisponível' : formatCents(cents)}`}
    >
      <Text variant="small" color={color.textSecondary}>
        {label}
      </Text>
      <Text
        variant="figureLarge"
        color={cents === null ? color.textSecondary : fg}
        numberOfLines={1}
        style={compact ? styles.figureCompact : null}
      >
        {cents === null ? '—' : formatCents(cents)}
      </Text>
      <Text variant="caption" color={color.textSecondary}>
        {cents === null ? (unavailable ?? 'Indisponível') : (caption ?? '')}
      </Text>
    </View>
  );
}

/** Faixa de indicadores: uma superfície com divisórias, não cartões soltos. */
export function MetricStrip({ children }: { children: ReactNode[] }) {
  const compact = useLayoutSize() === 'compact';
  return (
    <View style={[styles.strip, compact && styles.stripCompact]}>
      {children.map((child, i) => (
        <View
          key={i}
          style={[
            compact ? styles.cellCompact : styles.cell,
            !compact && i > 0 && styles.cellDivider,
            compact && i % 2 === 1 && styles.cellDivider,
            compact && i > 1 && styles.cellTop,
          ]}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

/** Linha inteira clicável que leva a um registro (atividade, pendência). */
export function RowLink({
  href,
  children,
  label,
}: {
  href: Href;
  children: ReactNode;
  label?: string;
}) {
  return (
    <Link href={href} asChild>
      <Touchable
        accessibilityRole="link"
        accessibilityLabel={label}
        pressStyle={(s: InteractionState) => [
          styles.rowLink,
          (s.hovered || s.pressed) && styles.rowHover,
          showFocusRing(s) && focusRing(),
        ]}
      >
        {children}
      </Touchable>
    </Link>
  );
}

/** Orientação contextual curta (uma ou duas frases), sem virar manual. */
export function Guidance({ children }: { children: string }) {
  return (
    <View style={styles.guidance}>
      <Info size={16} color={color.textSecondary} strokeWidth={1.75} style={styles.guidanceIcon} />
      <Text variant="small" color={color.textSecondary} style={styles.flex}>
        {children}
      </Text>
    </View>
  );
}

/** Par rótulo/valor alinhado (resumos de título, revisão de operação). */
export function Field({
  label,
  value,
  strong,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text variant="small" color={color.textSecondary}>
        {label}
      </Text>
      {typeof value === 'string' ? (
        <Text variant={strong ? 'figure' : 'body'} align="right" style={styles.fieldValue}>
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] + 2 },
  metric: { gap: 2, minWidth: 0 },
  figureCompact: { fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  strip: {
    flexDirection: 'row',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 14,
  },
  stripCompact: { flexWrap: 'wrap' },
  cell: { flex: 1, paddingVertical: space[4], paddingHorizontal: space[5], minWidth: 0 },
  cellCompact: { width: '50%', paddingVertical: space[3], paddingHorizontal: space[4] },
  cellDivider: { borderLeftWidth: 1, borderLeftColor: color.border },
  cellTop: { borderTopWidth: 1, borderTopColor: color.border },
  rowLink: { borderRadius: 8, marginHorizontal: -space[2], paddingHorizontal: space[2] },
  rowHover: { backgroundColor: 'rgba(17,17,17,0.04)' },
  guidance: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start' },
  guidanceIcon: { marginTop: 1 },
  flex: { flex: 1 },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space[3],
    paddingVertical: space[1] + 2,
  },
  fieldValue: { flexShrink: 1 },
});

/** Ícone da forma de pagamento (componentes estáticos, sem criar componente durante o render). */
export function MethodIcon({
  kind,
  size = 18,
  tint = color.textSecondary,
}: {
  kind: PaymentMethod['kind'];
  size?: number;
  tint?: string;
}) {
  const props = { size, color: tint, strokeWidth: 1.75 };
  switch (kind) {
    case 'pix':
      return <QrCode {...props} />;
    case 'cash':
      return <Banknote {...props} />;
    case 'transfer':
      return <Landmark {...props} />;
    case 'card':
      return <CreditCard {...props} />;
    case 'boleto':
      return <FileText {...props} />;
    default:
      return <CircleDollarSign {...props} />;
  }
}

/** Filtro de opções exclusivas: segmentado no desktop; no celular quebra linha, sem cortar opções. */
export function FilterTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const compact = useLayoutSize() === 'compact';
  return compact ? (
    <ChoiceChips label={label} hideLabel options={options} value={value} onChange={onChange} />
  ) : (
    <Segmented label={label} options={options} value={value} onChange={onChange} />
  );
}
