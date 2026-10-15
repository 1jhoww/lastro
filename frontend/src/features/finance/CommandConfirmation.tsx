import { useEffect } from 'react';
import { toApiError } from '@/api/errors';
import { ReauthGate, useReauth } from '@/features/platform/ReauthGate';
import { ConfirmDialog, Text } from '@/ui';
import { formatCents } from '@/lib/money';
import { commandLabels, sensitiveCommand, type FinanceCommand } from './commands';

export function CommandConfirmation(props: {
  command: FinanceCommand;
  busy: boolean;
  error: unknown;
  onSend: () => void;
  onCancel: () => void;
  onReauth?: () => void;
}) {
  return sensitiveCommand(props.command) ? (
    <ReauthGate description="Estornos e reembolsos exigem confirmação recente da senha.">
      <Confirmation {...props} />
    </ReauthGate>
  ) : (
    <Confirmation {...props} />
  );
}
function Confirmation({
  command,
  busy,
  error,
  onSend,
  onCancel,
  onReauth,
}: Parameters<typeof CommandConfirmation>[0]) {
  const { requireReauth } = useReauth();
  useEffect(() => {
    if (error && toApiError(error).code === 'REAUTHENTICATION_REQUIRED') {
      requireReauth();
      onReauth?.();
    }
  }, [error, requireReauth, onReauth]);
  const description =
    command.kind === 'confirm-refund'
      ? 'Registra comprovante de dinheiro já devolvido fora do Lastro. Esta ação não transfere dinheiro ao cliente.'
      : 'Confira valores, origem e justificativa. O registro será auditado e não pode ser apagado. Servidor valida versões e autorização.';
  return (
    <ConfirmDialog
      visible
      title={commandLabels[command.kind]}
      description={description}
      confirmLabel="Confirmar operação"
      tone={sensitiveCommand(command) ? 'danger' : 'strong'}
      loading={busy}
      onConfirm={onSend}
      onCancel={onCancel}
    >
      {'orderId' in command ? (
        <>
          <Text selectable>{`Pedido ${command.orderId} · origem ${command.id}`}</Text>
          <Text>{formatCents(command.body.amountCents)}</Text>
          <Text>{command.body.reason}</Text>
          {command.kind === 'confirm-refund' ? (
            <Text>{`${command.body.refundedOn} · forma ${command.body.methodId} · referência ${command.body.reference}`}</Text>
          ) : (
            <Text selectable>{`Parcela ${command.body.allocations[0]?.receivableId}`}</Text>
          )}
        </>
      ) : (
        <>
          <Text>{'name' in command.body ? command.body.name : commandLabels[command.kind]}</Text>
          {'status' in command.body ? (
            <Text>{`Situação: ${command.body.status === 'inactive' ? 'Inativo' : 'Ativo'}`}</Text>
          ) : null}
          {'kind' in command.body ? <Text>{`Forma: ${command.body.kind}`}</Text> : null}
          {'preset' in command.body && command.body.preset ? (
            <Text>{`Prazos: ${command.body.preset}`}</Text>
          ) : null}
          {'schedule' in command.body && command.body.schedule ? (
            <Text>
              {command.body.schedule
                .map((p, i) => `${i + 1}ª: ${p.offsetDays} dias · peso ${p.weight ?? 1}`)
                .join('; ')}
            </Text>
          ) : null}
        </>
      )}
    </ConfirmDialog>
  );
}
