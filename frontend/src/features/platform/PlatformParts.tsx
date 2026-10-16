import type { ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { color, space, useLayoutSize } from '@/theme';
import { Alert, Button, Skeleton, Text, TextField } from '@/ui';
import { ArrowLeft } from '@/ui/icons';

/** Indicador numérico do painel (contagem ou valor já formatado). */
export function Stat({
  label,
  value,
  caption,
  tone = 'default',
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: 'default' | 'danger' | 'success' | 'warning';
}) {
  const compact = useLayoutSize() === 'compact';
  const fg =
    tone === 'danger'
      ? color.danger
      : tone === 'success'
        ? color.success
        : tone === 'warning'
          ? color.warning
          : color.text;
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="small" color={color.textSecondary}>
        {label}
      </Text>
      <Text
        variant="figureLarge"
        color={fg}
        numberOfLines={1}
        style={compact ? styles.figureCompact : null}
      >
        {value}
      </Text>
      {caption ? (
        <Text variant="caption" color={color.textSecondary}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/** Linha "rótulo: valor" dos painéis de detalhe. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.detail}>
      <Text variant="small" color={color.textSecondary} style={styles.detailLabel}>
        {label}
      </Text>
      <View style={styles.detailValue}>
        {typeof children === 'string' ? <Text variant="body">{children}</Text> : children}
      </View>
    </View>
  );
}

export function BackLink({ href, label }: { href: Href; label: string }) {
  return (
    <View style={styles.back}>
      <Link href={href} asChild>
        <Button label={label} variant="ghost" size="sm" icon={ArrowLeft} />
      </Link>
    </View>
  );
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <View style={styles.loading}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={i % 2 ? '35%' : '55%'} height={16} />
      ))}
    </View>
  );
}

/** Falha de carregamento; login antigo (FORBIDDEN) já abre o pedido de senha e não aparece aqui. */
export function LoadError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  if (toApiError(error).code === 'FORBIDDEN') return null;
  return (
    <Alert
      tone="danger"
      title={title}
      action={<Button label="Tentar de novo" size="sm" variant="outline" onPress={onRetry} />}
    >
      {toApiError(error).userMessage}
    </Alert>
  );
}

/** Motivo obrigatório: vai para a auditoria junto com os valores anteriores e novos. */
export function ReasonField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
}) {
  return (
    <TextField
      label="Motivo"
      hint="Fica registrado no histórico da auditoria."
      value={value}
      onChangeText={onChange}
      maxLength={200}
      error={error}
    />
  );
}

export const validReason = (value: string) => value.trim().length >= 3;

const styles = StyleSheet.create({
  stat: { gap: 2, minWidth: 0 },
  figureCompact: { fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  detail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
    paddingVertical: space[2],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  detailLabel: { width: 180, paddingTop: 2 },
  detailValue: { flex: 1, minWidth: 180 },
  back: { alignItems: 'flex-start', marginLeft: -space[3] },
  loading: { padding: space[5], gap: space[3] },
});
