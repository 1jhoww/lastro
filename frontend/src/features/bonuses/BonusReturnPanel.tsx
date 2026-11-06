import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { BonusDetail } from '@/api/types';
import { formatQuantity, toApiQuantity, type Unit } from '@/lib/quantity';
import { color, space } from '@/theme';
import {
  Alert,
  Button,
  ConfirmDialog,
  Panel,
  QuantityInput,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { useReturnBonus } from './api';
import { bonusErrorMessage, returnable } from './presentation';

type Amounts = Record<string, { sellable: number; damaged: number }>;

/**
 * Retorno parcial ou total, só para quem administra devoluções (o servidor confere). Vendável volta
 * ao saldo físico; danificado fica registrado e não entra no estoque. Não mexe em financeiro.
 */
export function BonusReturnPanel({ bonus, onDone }: { bonus: BonusDetail; onDone: () => void }) {
  const toast = useToast();
  const send = useReturnBonus(bonus.id);
  const [amounts, setAmounts] = useState<Amounts>({});
  const [reason, setReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const open = bonus.lines.filter((l) => returnable(l) > 0);
  if (!open.length) return null;

  const amount = (id: string) => amounts[id] ?? { sellable: 0, damaged: 0 };
  const set = (id: string, patch: Partial<Amounts[string]>) => {
    send.resetKey();
    send.reset();
    setAmounts((current) => ({ ...current, [id]: { ...amount(id), ...patch } }));
  };
  const chosen = open.filter((l) => amount(l.id).sellable + amount(l.id).damaged > 0);
  const excess = open.some((l) => amount(l.id).sellable + amount(l.id).damaged > returnable(l));
  const valid = chosen.length > 0 && !excess && reason.trim().length >= 3;
  const submit = () =>
    send.mutate(
      {
        expectedVersion: bonus.version,
        reason: reason.trim(),
        lines: chosen.map((l) => ({
          lineId: l.id,
          sellable: toApiQuantity(amount(l.id).sellable),
          damaged: toApiQuantity(amount(l.id).damaged),
        })),
      },
      {
        onSuccess: () => {
          setReviewing(false);
          setAmounts({});
          setReason('');
          toast.show('Retorno registrado');
          onDone();
        },
        onError: () => setReviewing(false),
      },
    );
  const error = send.error ? toApiError(send.error) : null;

  return (
    <Panel
      title="Registrar retorno"
      description={
        bonus.kind === 'standalone'
          ? 'Avulsa não tem cancelamento. Para corrigir um lançamento, registre o retorno total. Vendável retorna ao estoque; danificado fica registrado e não entra no estoque.'
          : 'Informe só o que voltou. Vendável retorna ao estoque; danificado fica registrado e não entra no estoque.'
      }
    >
      <View style={styles.body}>
        {open.map((line) => (
          <View key={line.id} style={styles.line}>
            <Text variant="smallStrong">{line.name}</Text>
            <Text variant="caption" color={color.textSecondary}>
              {`Pode retornar: ${formatQuantity(returnable(line), line.unit as Unit)}`}
            </Text>
            <View style={styles.inputs}>
              <View style={styles.input}>
                <Text variant="small" color={color.textSecondary}>
                  Vendável
                </Text>
                <QuantityInput
                  label={`Vendável de ${line.name}`}
                  value={amount(line.id).sellable}
                  unit={line.unit as Unit}
                  onChange={(sellable) => set(line.id, { sellable })}
                />
              </View>
              <View style={styles.input}>
                <Text variant="small" color={color.textSecondary}>
                  Danificado
                </Text>
                <QuantityInput
                  label={`Danificado de ${line.name}`}
                  value={amount(line.id).damaged}
                  unit={line.unit as Unit}
                  onChange={(damaged) => set(line.id, { damaged })}
                />
              </View>
            </View>
          </View>
        ))}
        <TextField
          label="Motivo do retorno"
          value={reason}
          maxLength={200}
          onChangeText={(v) => {
            send.resetKey();
            setReason(v);
          }}
        />
        {excess ? (
          <Alert tone="danger" title="Quantidade acima do permitido">
            O retorno de uma linha passa do que ainda pode voltar.
          </Alert>
        ) : null}
        {error ? (
          <Alert tone="danger" title="Retorno não registrado">
            {bonusErrorMessage(error.code ?? '') ?? error.userMessage}
          </Alert>
        ) : null}
        <Button
          label="Revisar retorno"
          variant="outline"
          disabled={!valid}
          onPress={() => setReviewing(true)}
        />
      </View>
      <ConfirmDialog
        visible={reviewing}
        title="Registrar retorno?"
        description="Quantidades vendáveis voltam ao estoque físico. A operação fica no histórico e não pode ser desfeita."
        confirmLabel="Registrar retorno"
        tone="strong"
        loading={send.isPending}
        onConfirm={submit}
        onCancel={() => setReviewing(false)}
      />
    </Panel>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[4] },
  line: { gap: space[2] },
  inputs: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  input: { gap: space[1] },
});
