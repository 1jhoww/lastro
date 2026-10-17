import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Order } from '@/api/types';
import { Fact } from '@/features/catalog/DetailParts';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { formatDateTime } from '@/lib/dates';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import {
  Alert,
  Button,
  ConfirmDialog,
  DateField,
  Panel,
  Skeleton,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { PackageCheck } from '@/ui/icons';
import { useConfirmDelivery, useOrderDelivery } from './api';
import { formatDay, personLabel } from './presentation';

function messageFor(code: string): string | undefined {
  switch (code) {
    case 'INVALID_DELIVERY_DATE':
      return 'A data da entrega deve estar entre a expedição e hoje.';
    case 'DELIVERY_ALREADY_CONFIRMED':
      return 'A entrega deste pedido já foi confirmada com outros dados. A confirmação atual foi carregada.';
    case 'INVALID_ORDER_STATE':
      return 'Só pedidos expedidos podem ter a entrega confirmada.';
    default:
      return undefined;
  }
}

/**
 * Entrega efetiva de um pedido expedido. Expedir é só a saída do estoque; a confirmação de
 * entrega é um registro separado, que gera o registro automático no histórico do cliente e não
 * altera o pedido, o estoque nem o financeiro. Expedição é integral: uma entrega por pedido.
 */
export function OrderDelivery({ order }: { order: Order }) {
  const session = useSession();
  const toast = useToast();
  const tenant = useTenant();
  const dispatched = order.status === 'dispatched';
  const delivery = useOrderDelivery(order.id, dispatched);
  const confirm = useConfirmDelivery(order.id);
  const canConfirm = session.permissions.includes('orders:own:deliver');
  const timezone = tenant.data?.timezone;
  const today = todayIn(timezone);
  const dispatchDay = order.dispatchedAt ? todayIn(timezone, new Date(order.dispatchedAt)) : today;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');

  if (!dispatched) return null;
  const deliveredOn = date || today;
  const dateError =
    deliveredOn > today || deliveredOn < dispatchDay
      ? 'Entre a data da expedição e hoje.'
      : undefined;
  const receivedError =
    receivedBy.trim().length === 1 ? 'Informe o nome com pelo menos 2 letras.' : undefined;
  const error = confirm.error ? toApiError(confirm.error) : null;
  const current = delivery.data?.delivery;

  const submit = () => {
    if (dateError || receivedError || confirm.isPending) return;
    confirm.mutate(
      {
        deliveredOn,
        ...(receivedBy.trim() ? { receivedBy: receivedBy.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.show('Entrega confirmada');
          setOpen(false);
        },
      },
    );
  };

  return (
    <Panel title="Entrega">
      {delivery.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando entrega">
          <Skeleton width="60%" />
        </View>
      ) : delivery.isError ? (
        <Alert tone="danger" title="Entrega indisponível">
          {toApiError(delivery.error).userMessage}
        </Alert>
      ) : current ? (
        <View style={styles.facts}>
          <Fact label="Entregue em" value={formatDay(current.deliveredOn)} />
          {current.receivedBy ? <Fact label="Recebido por" value={current.receivedBy} /> : null}
          {current.notes ? <Fact label="Observações" value={current.notes} /> : null}
          <Fact
            label="Confirmada"
            value={`${formatDateTime(current.confirmedAt)} · ${personLabel(current.confirmedBy, null, session.user?.uid)}`}
          />
        </View>
      ) : (
        <View style={styles.facts}>
          <Text variant="small" color={color.textSecondary}>
            Saída registrada, entrega ainda não confirmada. Confirme quando o cliente receber os
            produtos.
          </Text>
          {error && !open ? (
            <Alert tone="danger" title="Entrega não confirmada">
              {messageFor(error.code) ?? error.userMessage}
            </Alert>
          ) : null}
          {canConfirm ? (
            <Button
              label="Confirmar entrega"
              icon={PackageCheck}
              variant="outline"
              onPress={() => {
                confirm.reset();
                setOpen(true);
              }}
            />
          ) : null}
        </View>
      )}

      <ConfirmDialog
        visible={open}
        title="Confirmar entrega?"
        description="Registra que o cliente recebeu os produtos. Não altera o pedido, o estoque nem o financeiro, e aparece no histórico do cliente como entrega."
        confirmLabel="Confirmar entrega"
        tone="strong"
        loading={confirm.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={submit}
      >
        <View style={styles.form}>
          <DateField
            label="Data da entrega"
            value={deliveredOn}
            min={dispatchDay}
            max={today}
            today={today}
            error={dateError}
            onChange={setDate}
          />
          <TextField
            label="Recebido por"
            optional
            value={receivedBy}
            maxLength={120}
            error={receivedError}
            onChangeText={setReceivedBy}
          />
          <TextField
            label="Observações"
            optional
            value={notes}
            maxLength={500}
            multiline
            numberOfLines={2}
            style={styles.multiline}
            onChangeText={setNotes}
          />
          {error ? (
            <Alert tone="danger" title="Entrega não confirmada">
              {messageFor(error.code) ?? error.userMessage}
            </Alert>
          ) : null}
        </View>
      </ConfirmDialog>
    </Panel>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[2], paddingTop: space[2] },
  facts: { gap: space[4], paddingTop: space[1] },
  form: { gap: space[3] },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
});
