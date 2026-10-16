import { useEffect, type ReactNode } from 'react';
import { toApiError } from '@/api/errors';
import { ReauthGate, useReauth } from '@/features/platform/ReauthGate';
import { formatCents } from '@/lib/money';
import { color } from '@/theme';
import { ConfirmDialog, Text } from '@/ui';
import {
  resolutionLabels,
  resolutionSensitive,
  type ResolutionCommand,
} from './resolutionCommands';

export function ResolutionConfirmation(props: {
  command: ResolutionCommand;
  busy: boolean;
  error: unknown;
  onSend: () => void;
  onCancel: () => void;
  onReauth: () => void;
  children?: ReactNode;
}) {
  return resolutionSensitive(props.command) ? (
    <ReauthGate description="Cancelamento, resolução, retomada e abort exigem senha recente.">
      <Review {...props} />
    </ReauthGate>
  ) : (
    <Review {...props} />
  );
}
function Review({
  command,
  busy,
  error,
  onSend,
  onCancel,
  onReauth,
  children,
}: Parameters<typeof ResolutionConfirmation>[0]) {
  const { requireReauth } = useReauth();
  useEffect(() => {
    if (error && toApiError(error).code === 'REAUTHENTICATION_REQUIRED') {
      requireReauth();
      onReauth();
    }
  }, [error, requireReauth, onReauth]);
  return (
    <ConfirmDialog
      visible
      title={resolutionLabels[command.kind]}
      description={
        command.kind === 'abort'
          ? 'Interrompe a operação antes de aplicar valores. Não cancela devolução física nem devolve dinheiro.'
          : 'Confira antes de confirmar. Depois que os valores forem aplicados, esta operação não pode ser interrompida. Reembolso fica registrado como a fazer; nada é transferido.'
      }
      confirmLabel="Confirmar"
      tone="danger"
      loading={busy}
      onConfirm={onSend}
      onCancel={onCancel}
    >
      <Text
        variant="small"
        color={color.textSecondary}
        selectable
      >{`Pedido ${command.orderId}`}</Text>
      {'disposition' in command.body ? (
        <Text>
          {command.body.disposition === 'refund'
            ? 'O valor já pago vira reembolso a fazer (nenhuma transferência é feita)'
            : 'O valor já pago vira crédito do cliente'}
        </Text>
      ) : null}
      {'reason' in command.body ? <Text>{command.body.reason}</Text> : null}
      {'damagedDecisions' in command.body
        ? command.body.damagedDecisions?.map((d) => (
            <Text
              key={d.lineId}
            >{`Avaria: ${d.accept ? `abater ${d.acceptedCents === undefined ? 'valor integral' : formatCents(d.acceptedCents)}` : 'recusar abatimento'}`}</Text>
          ))
        : null}
      {children}
    </ConfirmDialog>
  );
}
