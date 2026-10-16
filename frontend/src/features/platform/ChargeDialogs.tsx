import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { Charge, CompanyRow } from '@/api/types';
import { todayIn } from '@/features/orders/rules';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { color, space } from '@/theme';
import {
  Alert,
  Button,
  ConfirmDialog,
  CurrencyInput,
  DateField,
  Dialog,
  Segmented,
  Select,
  Skeleton,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { useChargeHistory, usePlatformApi } from './api';
import { competenceLabel, dateOrDash, historyLabel } from './copy';
import { ReasonField, validReason } from './PlatformParts';
import { usePlatformMutation } from './platformQuery';
import { BILLING_TIMEZONE } from './SubscriptionDialogs';

type Props = { charge: Charge; companyName: string; onClose: () => void };
const reasonError = 'Informe o motivo (mínimo 3 caracteres).';

function ErrorLine({ error }: { error: unknown }) {
  return (
    <Alert tone="danger" title="Não foi possível concluir">
      {toApiError(error).userMessage}
    </Alert>
  );
}

function Summary({ charge, companyName }: { charge: Charge; companyName: string }) {
  return (
    <Text variant="small" color={color.textSecondary}>
      {`${companyName} · ${competenceLabel(charge.competence)} · ${formatCents(charge.amountCents)} · vence ${dateOrDash(charge.dueDate)}`}
    </Text>
  );
}

/** Registro manual de pagamento recebido fora do Lastro (PIX, transferência...). */
export function PayChargeDialog({ charge, companyName, onClose }: Props) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const today = todayIn(BILLING_TIMEZONE);
  const [paidAt, setPaidAt] = useState(today);
  const [amount, setAmount] = useState(charge.amountCents);
  const [notes, setNotes] = useState(charge.notes ?? '');
  const pay = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/charges/{id}/pay', {
          params: { path: { id: charge.id } },
          body: {
            expectedVersion: charge.version,
            paidAt,
            paidAmountCents: amount,
            ...(notes.trim() !== (charge.notes ?? '') ? { notes: notes.trim() || null } : {}),
          },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Pagamento registrado');
        onClose();
      },
    },
  );
  return (
    <ConfirmDialog
      visible
      title="Registrar pagamento"
      description="Confirme somente pagamentos já recebidos. O registro pode ser corrigido depois, com auditoria."
      confirmLabel="Registrar pagamento"
      tone="strong"
      loading={pay.isPending}
      onCancel={onClose}
      onConfirm={() => {
        if (paidAt) pay.mutate(undefined);
      }}
    >
      <Summary charge={charge} companyName={companyName} />
      <DateField
        label="Data do pagamento"
        value={paidAt}
        onChange={setPaidAt}
        max={today}
        today={today}
      />
      <CurrencyInput label="Valor recebido" value={amount} onChange={setAmount} />
      <TextField
        label="Observações"
        optional
        hint="Ex.: PIX, transferência, comprovante."
        value={notes}
        onChangeText={setNotes}
        maxLength={500}
      />
      {pay.isError ? <ErrorLine error={pay.error} /> : null}
    </ConfirmDialog>
  );
}

/**
 * Correção auditada: valor, vencimento, situação e dados do pagamento. Reabrir uma cobrança paga
 * apaga o registro do pagamento (o histórico guarda os valores anteriores).
 */
export function CorrectChargeDialog({ charge, companyName, onClose }: Props) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const today = todayIn(BILLING_TIMEZONE);
  const [status, setStatus] = useState<'pending' | 'paid'>(
    charge.status === 'paid' ? 'paid' : 'pending',
  );
  const [amount, setAmount] = useState(charge.amountCents);
  const [dueDate, setDueDate] = useState(charge.dueDate);
  const [paidAt, setPaidAt] = useState(charge.paidAt ?? today);
  const [paidAmount, setPaidAmount] = useState(charge.paidAmountCents ?? charge.amountCents);
  const [notes, setNotes] = useState(charge.notes ?? '');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const body = {
    ...(status !== charge.status ? { status } : {}),
    ...(amount !== charge.amountCents ? { amountCents: amount } : {}),
    ...(dueDate !== charge.dueDate ? { dueDate } : {}),
    ...(status === 'paid' && paidAt !== charge.paidAt ? { paidAt } : {}),
    ...(status === 'paid' && paidAmount !== charge.paidAmountCents
      ? { paidAmountCents: paidAmount }
      : {}),
    ...(notes.trim() !== (charge.notes ?? '') ? { notes: notes.trim() || null } : {}),
  };
  const correct = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/charges/{id}/correct', {
          params: { path: { id: charge.id } },
          body: { expectedVersion: charge.version, reason: reason.trim(), ...body },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Cobrança corrigida');
        onClose();
      },
    },
  );
  const reopening = charge.status === 'paid' && status === 'pending';
  return (
    <ConfirmDialog
      visible
      title="Corrigir cobrança"
      description="Toda correção exige motivo e fica no histórico com os valores anteriores."
      confirmLabel="Salvar correção"
      tone={reopening ? 'danger' : 'strong'}
      loading={correct.isPending}
      onCancel={onClose}
      onConfirm={() => {
        setTried(true);
        if (Object.keys(body).length && validReason(reason)) correct.mutate(undefined);
      }}
    >
      <Summary charge={charge} companyName={companyName} />
      <View style={styles.field}>
        <Text variant="smallStrong">Situação</Text>
        <Segmented<'pending' | 'paid'>
          label="Situação"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'pending', label: charge.status === 'canceled' ? 'Reabrir' : 'Em aberto' },
            { value: 'paid', label: 'Paga' },
          ]}
        />
      </View>
      {reopening ? (
        <Alert tone="warning" title="O pagamento registrado será desfeito">
          Use quando o pagamento foi lançado por engano.
        </Alert>
      ) : null}
      <CurrencyInput label="Valor cobrado" value={amount} onChange={setAmount} />
      <DateField label="Vencimento" value={dueDate} onChange={setDueDate} today={today} />
      {status === 'paid' ? (
        <>
          <DateField
            label="Data do pagamento"
            value={paidAt}
            onChange={setPaidAt}
            max={today}
            today={today}
          />
          <CurrencyInput label="Valor recebido" value={paidAmount} onChange={setPaidAmount} />
        </>
      ) : null}
      <TextField
        label="Observações"
        optional
        value={notes}
        onChangeText={setNotes}
        maxLength={500}
      />
      <ReasonField
        value={reason}
        onChange={setReason}
        error={tried && !validReason(reason) ? reasonError : undefined}
      />
      {tried && Object.keys(body).length === 0 ? (
        <Text variant="small" color={color.danger}>
          Nenhuma alteração para salvar.
        </Text>
      ) : null}
      {correct.isError ? <ErrorLine error={correct.error} /> : null}
    </ConfirmDialog>
  );
}

export function CancelChargeDialog({ charge, companyName, onClose }: Props) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const cancel = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/charges/{id}/cancel', {
          params: { path: { id: charge.id } },
          body: { expectedVersion: charge.version, reason: reason.trim() },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Cobrança cancelada');
        onClose();
      },
    },
  );
  return (
    <ConfirmDialog
      visible
      title="Cancelar cobrança?"
      description="A cobrança deixa de contar como em aberto. Ela pode ser reaberta por correção."
      confirmLabel="Cancelar cobrança"
      loading={cancel.isPending}
      onCancel={onClose}
      onConfirm={() => {
        setTried(true);
        if (validReason(reason)) cancel.mutate(undefined);
      }}
    >
      <Summary charge={charge} companyName={companyName} />
      <ReasonField
        value={reason}
        onChange={setReason}
        error={tried && !validReason(reason) ? reasonError : undefined}
      />
      {cancel.isError ? <ErrorLine error={cancel.error} /> : null}
    </ConfirmDialog>
  );
}

export function ChargeHistoryDialog({ charge, companyName, onClose }: Props) {
  const history = useChargeHistory(charge.id, true);
  return (
    <Dialog
      visible
      title="Histórico da cobrança"
      onClose={onClose}
      actions={<Button label="Fechar" variant="ghost" onPress={onClose} />}
    >
      <Summary charge={charge} companyName={companyName} />
      {history.isPending ? <Skeleton width="80%" height={40} /> : null}
      {history.isError ? <ErrorLine error={history.error} /> : null}
      {history.data?.items.map((entry) => (
        <View key={entry.id} style={styles.entry}>
          <Text variant="small">{historyLabel(entry.action, entry.changes)}</Text>
          <Text variant="caption" color={color.textSecondary}>
            {formatDateTime(entry.occurredAt)}
          </Text>
        </View>
      ))}
    </Dialog>
  );
}

/** Cobrança de uma competência combinada fora da geração automática. Nunca duplica um mês. */
export function ManualChargeDialog({
  companies,
  tenantId,
  onClose,
}: {
  companies: Pick<CompanyRow, 'id' | 'name' | 'monthlyPriceCents' | 'subscriptionStatus'>[];
  tenantId?: string;
  onClose: () => void;
}) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const today = todayIn(BILLING_TIMEZONE);
  const [company, setCompany] = useState<string | null>(tenantId ?? null);
  const selected = companies.find((c) => c.id === company);
  const [competence, setCompetence] = useState(today.slice(0, 7));
  const [amount, setAmount] = useState(selected?.monthlyPriceCents ?? 0);
  const [dueDate, setDueDate] = useState(today);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const validCompetence = /^\d{4}-(0[1-9]|1[0-2])$/.test(competence);
  const create = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/charges', {
          body: {
            tenantId: company as string,
            competence,
            amountCents: amount,
            dueDate,
            reason: reason.trim(),
          },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Cobrança criada');
        onClose();
      },
    },
  );
  return (
    <ConfirmDialog
      visible
      title="Nova cobrança manual"
      description="Use para uma competência combinada fora da geração automática. Cada empresa tem no máximo uma cobrança por mês."
      confirmLabel="Criar cobrança"
      tone="strong"
      loading={create.isPending}
      onCancel={onClose}
      onConfirm={() => {
        setTried(true);
        if (company && validCompetence && dueDate && validReason(reason)) create.mutate(undefined);
      }}
    >
      {tenantId ? null : (
        <Select<string>
          label="Empresa"
          value={company}
          placeholder="Escolha a empresa"
          options={companies
            .filter((c) => c.subscriptionStatus !== 'canceled')
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(id) => {
            setCompany(id);
            setAmount(companies.find((c) => c.id === id)?.monthlyPriceCents ?? 0);
          }}
          error={tried && !company ? 'Escolha a empresa.' : undefined}
        />
      )}
      <TextField
        label="Competência (AAAA-MM)"
        value={competence}
        onChangeText={(v) => setCompetence(v.replace(/[^\d-]/g, '').slice(0, 7))}
        error={tried && !validCompetence ? 'Use o formato AAAA-MM.' : undefined}
      />
      <CurrencyInput label="Valor" value={amount} onChange={setAmount} />
      <DateField label="Vencimento" value={dueDate} onChange={setDueDate} today={today} />
      <ReasonField
        value={reason}
        onChange={setReason}
        error={tried && !validReason(reason) ? reasonError : undefined}
      />
      {create.isError ? <ErrorLine error={create.error} /> : null}
    </ConfirmDialog>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[2] },
  entry: {
    gap: 2,
    paddingVertical: space[2],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
});
