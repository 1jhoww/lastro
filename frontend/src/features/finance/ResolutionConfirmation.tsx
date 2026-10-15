import { useEffect, type ReactNode } from 'react';
import { toApiError } from '@/api/errors';
import { ReauthGate, useReauth } from '@/features/platform/ReauthGate';
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
          ? 'Abort encerra somente execução admissível antes da aplicação. Não cancela devolução física nem devolve dinheiro.'
          : 'Confira decisão e estado oficial. Depois de aplicar fontes ou liberar reservas, esta resolução não pode ser abortada. Reembolso cria obrigação manual.'
      }
      confirmLabel="Confirmar decisão"
      tone="danger"
      loading={busy}
      onConfirm={onSend}
      onCancel={onCancel}
    >
      <Text selectable>{`Pedido ${command.orderId} · recurso ${command.id}`}</Text>
      {'disposition' in command.body ? (
        <Text>
          {command.body.disposition === 'refund'
            ? 'Destino: obrigação de reembolso; nenhuma transferência'
            : 'Destino: crédito do cliente para caixa elegível'}
        </Text>
      ) : null}
      {'reason' in command.body ? <Text>{command.body.reason}</Text> : null}
      {'expectedOrderVersion' in command.body ? (
        <Text>{`Versão do pedido ${command.body.expectedOrderVersion} · guarda ${command.body.expectedGuardVersion}`}</Text>
      ) : null}
      {'damagedDecisions' in command.body
        ? command.body.damagedDecisions?.map((d) => (
            <Text
              key={d.lineId}
            >{`Dano ${d.lineId}: ${d.accept ? `aceitar ${d.acceptedCents === undefined ? 'limite oficial integral' : `${d.acceptedCents} centavos`}` : 'rejeitar abatimento'}`}</Text>
          ))
        : null}
      {'expectedRevision' in command.body ? (
        <Text>{`Revisão ${command.body.expectedRevision}${'fencingToken' in command.body ? ` · fence ${command.body.fencingToken}` : ''}`}</Text>
      ) : null}
      {children}
    </ConfirmDialog>
  );
}
