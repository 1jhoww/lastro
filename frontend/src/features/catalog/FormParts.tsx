import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { color, space, useLayoutSize } from '@/theme';
import { Alert, Button, Panel, Text } from '@/ui';

/** Seção de formulário: título curto e campos. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Panel title={title} description={description}>
      <View style={styles.section}>{children}</View>
    </Panel>
  );
}

/** Campos lado a lado no desktop, empilhados no celular. `weights` define a proporção. */
export function FieldRow({ children, weights }: { children: ReactNode[]; weights?: number[] }) {
  const compact = useLayoutSize() === 'compact';
  if (compact) return <View style={styles.section}>{children}</View>;
  return (
    <View style={styles.row}>
      {children.map((child, i) => (
        <View key={i} style={{ flex: weights?.[i] ?? 1, minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}

/**
 * Erro do servidor no envio. Conflito de versão pede recarga explícita: nada é sobrescrito sem
 * a pessoa ver a versão atual.
 */
export function SubmitError({
  error,
  onReload,
  messageFor,
}: {
  error: unknown;
  onReload?: () => void;
  messageFor?: (code: string) => string | undefined;
}) {
  if (!error) return null;
  const err = toApiError(error);
  if (err.code === 'CONFLICT' && onReload)
    return (
      <Alert
        tone="warning"
        title="Alguém alterou este cadastro"
        action={
          <Button label="Carregar versão atual" size="sm" variant="outline" onPress={onReload} />
        }
      >
        Suas mudanças não foram salvas. Carregue a versão atual e refaça a alteração.
      </Alert>
    );
  return (
    <Alert tone="danger" title="Não foi possível salvar">
      {messageFor?.(err.code) ?? err.userMessage}
    </Alert>
  );
}

/** Barra de ações do formulário: principal à direita no desktop, largura total no celular. */
export function FormActions({ children }: { children: ReactNode }) {
  const compact = useLayoutSize() === 'compact';
  return <View style={[styles.actions, compact && styles.actionsCompact]}>{children}</View>;
}

export function Hint({ children }: { children: string }) {
  return (
    <Text variant="small" color={color.textSecondary}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[4], paddingTop: space[1] },
  row: { flexDirection: 'row', gap: space[4], alignItems: 'flex-start' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2] },
  actionsCompact: { flexDirection: 'column-reverse', alignItems: 'stretch' },
});
