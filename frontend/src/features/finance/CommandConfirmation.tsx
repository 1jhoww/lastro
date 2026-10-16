import { useEffect } from 'react';
import { View } from 'react-native';
import { toApiError } from '@/api/errors';
import { ReauthGate, useReauth } from '@/features/platform/ReauthGate';
import { formatCents } from '@/lib/money';
import { ConfirmDialog, Text } from '@/ui';
import { commandLabels, sensitiveCommand, type FinanceCommand } from './commands';
import { Field } from './FinanceParts';

const descriptions: Partial<Record<FinanceCommand['kind'], string>> = {
  'apply-credit': 'O crédito do cliente será usado para abater a parcela escolhida.',
  'reverse-payment':
    'O pagamento não será apagado: fica no histórico como estornado e o valor volta a ficar em aberto.',
  'reverse-credit': 'O uso do crédito será desfeito e o valor volta ao crédito do cliente.',
  'confirm-refund':
    'Registra que o dinheiro já foi devolvido ao cliente fora do Lastro. Esta ação não transfere dinheiro.',
};
const confirmLabels: Partial<Record<FinanceCommand['kind'], string>> = {
  'apply-credit': 'Usar crédito',
  'reverse-payment': 'Confirmar estorno',
  'reverse-credit': 'Confirmar estorno',
  'confirm-refund': 'Registrar reembolso',
};

export function CommandConfirmation(props: {
  command: FinanceCommand;
  /** Resumo legível (valor, origem, consequência). Sem ele, mostra o essencial do comando. */
  details?: { label: string; value: string }[];
  busy: boolean;
  error: unknown;
  onSend: () => void;
  onCancel: () => void;
  onReauth?: () => void;
}) {
  return sensitiveCommand(props.command) ? (
    <ReauthGate description="Estornos e reembolsos pedem que você confirme sua senha.">
      <Confirmation {...props} />
    </ReauthGate>
  ) : (
    <Confirmation {...props} />
  );
}
function Confirmation({
  command,
  details,
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
  return (
    <ConfirmDialog
      visible
      title={`${commandLabels[command.kind]}?`}
      description={descriptions[command.kind] ?? 'Confira os dados antes de confirmar.'}
      confirmLabel={confirmLabels[command.kind] ?? 'Confirmar'}
      tone={sensitiveCommand(command) ? 'danger' : 'strong'}
      loading={busy}
      onConfirm={onSend}
      onCancel={onCancel}
    >
      {details?.length ? (
        <View>
          {details.map((d) => (
            <Field key={d.label} label={d.label} value={d.value} />
          ))}
        </View>
      ) : 'orderId' in command ? (
        <>
          <Text variant="figure">{formatCents(command.body.amountCents)}</Text>
          <Text>{command.body.reason}</Text>
        </>
      ) : (
        <Text>{'name' in command.body ? command.body.name : commandLabels[command.kind]}</Text>
      )}
    </ConfirmDialog>
  );
}
