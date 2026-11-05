import type { ReactNode } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, toApiError } from '@/api/errors';
import { AccessDenied } from '@/features/session/RequirePermission';
import type { Permission } from '@/navigation/destinations';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, Dialog, Text, TextField } from '@/ui';
import { managementMessages } from './presentation';

/** Módulos do Gestão valem por permissão: um vendedor autorizado também entra. */
export function ManagementAccess({
  permission,
  title,
  children,
}: {
  permission: Permission;
  title: string;
  children: ReactNode;
}) {
  const { permissions } = useSession();
  if (!permissions.includes(permission)) return <AccessDenied title={title} />;
  return <>{children}</>;
}

export function messageOf(error: unknown): string {
  const code = error instanceof ApiError ? error.code : '';
  return managementMessages[code] ?? toApiError(error).userMessage;
}
export function CommandError({ error, title }: { error: unknown; title: string }) {
  if (!error) return null;
  return (
    <Alert tone="danger" title={title}>
      {messageOf(error)}
    </Alert>
  );
}

/** Ação que fica no histórico: o motivo é obrigatório e explica o que vai acontecer. */
export function ReasonDialog({
  visible,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  loading,
  error,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'strong';
  loading: boolean;
  error: unknown;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;
  return (
    <Dialog
      visible={visible}
      title={title}
      description={description}
      onClose={loading ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={loading} />
          <Button
            label={confirmLabel}
            variant={tone}
            loading={loading}
            disabled={!valid}
            onPress={() => onConfirm(reason.trim())}
          />
        </>
      }
    >
      <CommandError error={error} title="Operação não realizada" />
      <TextField label="Motivo" value={reason} onChangeText={setReason} maxLength={500} multiline />
    </Dialog>
  );
}

/** Rótulo e valor alinhados à direita, para totais. */
export function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text
        variant={strong ? 'bodyStrong' : 'body'}
        color={strong ? color.text : color.textSecondary}
      >
        {label}
      </Text>
      <Text variant={strong ? 'figure' : 'body'}>{value}</Text>
    </View>
  );
}
export function Stack({ children }: { children: ReactNode }) {
  return <View style={styles.stack}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
  stack: { gap: space[3] },
});
