import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Payable, PayablePayment } from '@/api/types';
import { DetailColumns, Fact, Facts } from '@/features/catalog/DetailParts';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { useMethodOptions } from '@/features/orders/api';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { formatIsoDate } from '@/lib/calendar';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Badge,
  Button,
  CurrencyInput,
  DateField,
  Dialog,
  Panel,
  Select,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { Ban, CalendarClock, HandCoins, Undo2 } from '@/ui/icons';
import {
  useCancelPayable,
  usePayPayable,
  usePayable,
  usePayablePayments,
  useReversePayment,
  useUpdatePayable,
} from './api';
import { CommandError, ReasonDialog, SummaryRow } from './Parts';
import { Situation_ } from './PayablesScreen';
import { originCopy } from './presentation';

export function PayableDetail({ id }: { id: string }) {
  const title = usePayable(id);
  if (title.isPending) return <RecordLoading title="Título" />;
  if (title.isError || !title.data)
    return (
      <RecordError
        title="Título"
        error={title.error}
        backHref={'/financeiro/pagar' as Href}
        backLabel="Voltar para contas a pagar"
        onRetry={() => title.refetch()}
      />
    );
  return <PayableView title={title.data} />;
}

function PayableView({ title: t }: { title: Payable }) {
  const { permissions } = useSession();
  const compact = useLayoutSize() === 'compact';
  const toast = useToast();
  const [modal, setModal] = useState<'pay' | 'due' | 'cancel' | null>(null);
  const cancel = useCancelPayable(t.id);
  const payments = usePayablePayments(t.id);
  const open = t.hasBalance;
  const manage = permissions.includes('payables:manage');
  return (
    <Screen
      title={t.description}
      description={t.beneficiaryName ?? originCopy[t.origin]}
      actions={
        open && permissions.includes('payables:pay') ? (
          <Button
            label="Registrar pagamento"
            icon={HandCoins}
            variant="strong"
            fullWidth={compact}
            onPress={() => setModal('pay')}
          />
        ) : null
      }
    >
      <DetailColumns
        main={
          <>
            <Panel title="Dados">
              <Facts>
                <Fact label="Origem" value={originCopy[t.origin]} />
                <Fact label="Categoria" value={t.categoryName ?? ''} />
                <Fact label="Emissão" value={formatIsoDate(t.issueDate)} />
                <Fact label="Vencimento" value={formatIsoDate(t.dueDate)} />
                {t.paidOn ? <Fact label="Pago em" value={formatIsoDate(t.paidOn)} /> : null}
                {t.installmentNumber ? (
                  <Fact label="Parcela" value={`${t.installmentNumber} de ${t.installmentCount}`} />
                ) : null}
                <Fact label="Observações" value={t.notes} />
                {t.cancelReason ? <Fact label="Cancelado por" value={t.cancelReason} /> : null}
              </Facts>
            </Panel>
            <Panel title="Pagamentos" flush>
              {(payments.data?.items ?? []).length === 0 ? (
                <View style={styles.empty}>
                  <Text variant="body" color={color.textSecondary}>
                    Nenhum pagamento registrado.
                  </Text>
                </View>
              ) : (
                payments.data!.items.map((payment) => (
                  <PaymentRow key={payment.id} payment={payment} />
                ))
              )}
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Situação">
              <View style={styles.stack}>
                <Situation_ title={t} />
                <SummaryRow label="Valor original" value={formatCents(t.originalCents)} />
                <SummaryRow label="Pago" value={formatCents(t.paidCents)} />
                {t.canceledCents ? (
                  <SummaryRow
                    label={t.origin === 'purchase' ? 'Abatido' : 'Cancelado'}
                    value={formatCents(t.canceledCents)}
                  />
                ) : null}
                <SummaryRow label="Saldo" value={formatCents(t.outstandingCents)} strong />
              </View>
            </Panel>
            {t.origin === 'purchase' && t.originReference ? (
              <Link href={`/compras/${t.originReference}` as Href} asChild>
                <Button label="Ver a compra" variant="outline" fullWidth />
              </Link>
            ) : null}
            {open && manage ? (
              <Panel title="Mais ações">
                <View style={styles.stack}>
                  <Button
                    label="Corrigir vencimento"
                    icon={CalendarClock}
                    variant="outline"
                    fullWidth
                    onPress={() => setModal('due')}
                  />
                  {t.origin !== 'purchase' ? (
                    <Button
                      label="Cancelar título"
                      icon={Ban}
                      variant="ghost"
                      fullWidth
                      onPress={() => setModal('cancel')}
                    />
                  ) : null}
                </View>
              </Panel>
            ) : null}
          </>
        }
      />
      {modal === 'pay' ? <PayDialog title={t} onClose={() => setModal(null)} /> : null}
      {modal === 'due' ? <DueDialog title={t} onClose={() => setModal(null)} /> : null}
      <ReasonDialog
        visible={modal === 'cancel'}
        title="Cancelar título?"
        description="O título fica no histórico como cancelado e sai das contas em aberto."
        confirmLabel="Cancelar título"
        loading={cancel.isPending}
        error={cancel.error}
        onClose={() => setModal(null)}
        onConfirm={(reason) =>
          cancel.mutate(
            { expectedVersion: t.version, reason },
            {
              onSuccess: () => {
                toast.show('Título cancelado');
                setModal(null);
              },
            },
          )
        }
      />
    </Screen>
  );
}

function PaymentRow({ payment: p }: { payment: PayablePayment }) {
  const { permissions } = useSession();
  const toast = useToast();
  const reverse = useReversePayment();
  const [open, setOpen] = useState(false);
  const extras = p.interestCents + p.penaltyCents;
  return (
    <View style={styles.line}>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{`${formatCents(p.cashCents)} em ${formatIsoDate(p.paidOn)}`}</Text>
        <Text variant="small" color={color.textSecondary}>
          {[
            p.method.name,
            extras ? `juros e multa ${formatCents(extras)}` : '',
            p.discountCents ? `desconto ${formatCents(p.discountCents)}` : '',
          ]
            .filter(Boolean)
            .join(', ')}
        </Text>
        {p.reversalReason ? (
          <Text variant="small" color={color.textSecondary}>
            {`Estornado: ${p.reversalReason}`}
          </Text>
        ) : null}
      </View>
      {p.status === 'reversed' ? (
        <Badge label="Estornado" tone="neutral" />
      ) : permissions.includes('payables:reverse') ? (
        <Button
          label="Estornar"
          icon={Undo2}
          size="sm"
          variant="ghost"
          onPress={() => setOpen(true)}
        />
      ) : null}
      <ReasonDialog
        visible={open}
        title="Estornar pagamento?"
        description="O saldo do título volta a ficar em aberto. O pagamento continua no histórico."
        confirmLabel="Estornar pagamento"
        loading={reverse.isPending}
        error={reverse.error}
        onClose={() => setOpen(false)}
        onConfirm={(reason) =>
          reverse.mutate(
            { id: p.id, reason },
            {
              onSuccess: () => {
                toast.show('Pagamento estornado');
                setOpen(false);
              },
            },
          )
        }
      />
    </View>
  );
}

function PayDialog({ title: t, onClose }: { title: Payable; onClose: () => void }) {
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const toast = useToast();
  const methods = useMethodOptions();
  const pay = usePayPayable(t.id);
  const [principal, setPrincipal] = useState(t.outstandingCents);
  const [interest, setInterest] = useState(0);
  const [penalty, setPenalty] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [paidOn, setPaidOn] = useState(today);
  const [methodId, setMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const method = (methods.data ?? []).find((m) => m.id === methodId);
  const cash = principal + interest + penalty - discount;
  const valid = principal > 0 && principal <= t.outstandingCents && Boolean(method) && cash >= 0;
  return (
    <Dialog
      visible
      title="Registrar pagamento"
      description="Valor menor que o saldo deixa o título parcialmente pago."
      onClose={pay.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={pay.isPending} />
          <Button
            label="Registrar pagamento"
            variant="strong"
            loading={pay.isPending}
            disabled={!valid}
            onPress={() =>
              pay.mutate(
                {
                  expectedVersion: t.version,
                  principalCents: principal,
                  ...(interest ? { interestCents: interest } : {}),
                  ...(penalty ? { penaltyCents: penalty } : {}),
                  ...(discount ? { discountCents: discount } : {}),
                  paidOn,
                  methodId: method!.id,
                  methodVersion: method!.version,
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    toast.show('Pagamento registrado');
                    onClose();
                  },
                },
              )
            }
          />
        </>
      }
    >
      <View style={styles.stack}>
        <CommandError error={pay.error} title="Pagamento não registrado" />
        <CurrencyInput
          label="Valor abatido do título"
          value={principal}
          onChange={setPrincipal}
          hint={`Saldo em aberto: ${formatCents(t.outstandingCents)}`}
          error={principal > t.outstandingCents ? 'Valor acima do saldo em aberto.' : undefined}
        />
        <View style={styles.row}>
          <View style={styles.flex}>
            <DateField
              label="Data do pagamento"
              value={paidOn}
              today={today}
              max={today}
              onChange={setPaidOn}
            />
          </View>
          <View style={styles.flex}>
            <Select
              label="Forma de pagamento"
              value={methodId || null}
              options={(methods.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
              onChange={setMethodId}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}>
            <CurrencyInput label="Juros" value={interest} onChange={setInterest} optional />
          </View>
          <View style={styles.flex}>
            <CurrencyInput label="Multa" value={penalty} onChange={setPenalty} optional />
          </View>
          <View style={styles.flex}>
            <CurrencyInput label="Desconto" value={discount} onChange={setDiscount} optional />
          </View>
        </View>
        <TextField
          label="Observações"
          value={notes}
          onChangeText={setNotes}
          maxLength={1000}
          optional
        />
        <SummaryRow label="Sai do caixa" value={formatCents(Math.max(cash, 0))} strong />
      </View>
    </Dialog>
  );
}

function DueDialog({ title: t, onClose }: { title: Payable; onClose: () => void }) {
  const tenant = useTenant();
  const toast = useToast();
  const update = useUpdatePayable(t.id);
  const [dueDate, setDueDate] = useState(t.dueDate);
  const [reason, setReason] = useState('');
  return (
    <Dialog
      visible
      title="Corrigir vencimento"
      onClose={update.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={update.isPending} />
          <Button
            label="Salvar vencimento"
            variant="strong"
            loading={update.isPending}
            disabled={reason.trim().length < 3 || dueDate === t.dueDate}
            onPress={() =>
              update.mutate(
                { expectedVersion: t.version, dueDate, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.show('Vencimento corrigido');
                    onClose();
                  },
                },
              )
            }
          />
        </>
      }
    >
      <View style={styles.stack}>
        <CommandError error={update.error} title="Vencimento não alterado" />
        <DateField
          label="Novo vencimento"
          value={dueDate}
          today={todayIn(tenant.data?.timezone)}
          onChange={setDueDate}
        />
        <TextField label="Motivo" value={reason} onChangeText={setReason} maxLength={500} />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: space[3] },
  row: { flexDirection: 'row', gap: space[3], flexWrap: 'wrap' },
  empty: { padding: space[4] },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
});
