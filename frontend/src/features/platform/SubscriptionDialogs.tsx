import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { CompanySubscription, PlanCode, PlanFeature } from '@/api/types';
import { addDays } from '@/lib/calendar';
import { formatCents } from '@/lib/money';
import { todayIn } from '@/features/orders/rules';
import { color, radius, space } from '@/theme';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  CurrencyInput,
  DateField,
  Dialog,
  Skeleton,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { Check } from '@/ui/icons';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { usePlanCatalog, usePlanChangePreview, usePlatformApi } from './api';
import { featureLabel, planLabel } from './copy';
import { ReasonField, validReason } from './PlatformParts';
import { usePlatformMutation } from './platformQuery';

export const BILLING_TIMEZONE = 'America/Sao_Paulo';
const validDay = (value: string) => /^(?:[1-9]|1[0-9]|2[0-8])$/.test(value.trim());

type DialogProps = { subscription: CompanySubscription; visible: boolean; onClose: () => void };

function ErrorLine({ error }: { error: unknown }) {
  return (
    <Alert tone="danger" title="Não foi possível concluir">
      {toApiError(error).userMessage}
    </Alert>
  );
}

/**
 * Troca de plano com prévia do servidor: vagas que precisam ser liberadas e recursos que a
 * empresa perde. Downgrade só é enviado com vagas livres e com cada recurso perdido confirmado.
 * O valor contratado só muda se o Super Admin escolher um novo.
 */
export function ChangePlanDialog({ subscription, visible, onClose }: DialogProps) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const catalog = usePlanCatalog();
  const [target, setTarget] = useState<PlanCode | null>(null);
  const [acknowledged, setAcknowledged] = useState<PlanFeature[]>([]);
  const [newPrice, setNewPrice] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const preview = usePlanChangePreview(subscription.id, visible ? target : null);
  const options = (catalog.data?.items ?? []).filter(
    (p) => p.offered && p.code !== subscription.planCode,
  );
  const lost = preview.data?.lostFeatures ?? [];
  const blocked = (preview.data?.excessSeats ?? 0) > 0;
  const allAcknowledged = lost.every((f) => acknowledged.includes(f));
  const close = () => {
    setTarget(null);
    setAcknowledged([]);
    setNewPrice(null);
    setReason('');
    setTried(false);
    change.reset();
    onClose();
  };
  const change = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/subscriptions/{id}/plan', {
          params: { path: { id: subscription.id } },
          body: {
            expectedVersion: subscription.version,
            planCode: target as PlanCode,
            acknowledgedLostFeatures: lost,
            reason: reason.trim(),
            ...(newPrice !== null ? { monthlyPriceCents: newPrice } : {}),
          },
        }),
      ),
    {
      onSuccess: (result) => {
        toast.show(`Plano alterado para ${planLabel(result.planCode)}`);
        close();
      },
    },
  );
  const submit = () => {
    setTried(true);
    if (!target || !preview.data || blocked || !allAcknowledged || !validReason(reason)) return;
    change.mutate(undefined);
  };

  return (
    <Dialog
      visible={visible}
      title="Trocar plano"
      description={`Plano atual: ${planLabel(subscription.planCode, subscription.planName)}. Limites e recursos mudam na hora; cobranças já emitidas não mudam.`}
      onClose={change.isPending ? () => {} : close}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={close} disabled={change.isPending} />
          <Button
            label="Confirmar troca"
            variant="strong"
            loading={change.isPending}
            disabled={!target || preview.isPending || blocked}
            onPress={submit}
          />
        </>
      }
    >
      <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Novo plano">
        <Text variant="smallStrong">Novo plano</Text>
        {catalog.isPending ? <Skeleton width="70%" height={44} /> : null}
        {options.map((p) => {
          const selected = target === p.code;
          return (
            <Touchable
              key={p.code}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={p.name}
              onPress={() => {
                setTarget(p.code);
                setAcknowledged([]);
                setNewPrice(null);
              }}
              pressStyle={(s: InteractionState) => [
                styles.option,
                selected && styles.optionSelected,
                showFocusRing(s) && focusRing(),
              ]}
            >
              <View style={styles.flex}>
                <Text variant="bodyStrong">{p.name}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${formatCents(p.referencePriceCents)} por mês (referência), ${
                    p.userLimit === 1 ? '1 usuário' : `até ${p.userLimit} usuários`
                  }`}
                </Text>
              </View>
              {selected ? <Check size={18} color={color.text} /> : null}
            </Touchable>
          );
        })}
      </View>
      {target && preview.isPending ? <Skeleton width="100%" height={60} /> : null}
      {preview.isError ? <ErrorLine error={preview.error} /> : null}
      {preview.data ? (
        <>
          {blocked ? (
            <Alert tone="danger" title="A empresa ocupa mais vagas do que o plano permite">
              {`O ${planLabel(preview.data.targetPlanCode)} comporta ${preview.data.targetUserLimit} ${
                preview.data.targetUserLimit === 1 ? 'usuário' : 'usuários'
              }; hoje há ${preview.data.activeUsers} ativo(s) e ${preview.data.reservedInvitations} convite(s) pendente(s). Libere ${preview.data.excessSeats} vaga(s) antes: a empresa desativa usuários ou você revoga convites. Ninguém é desativado automaticamente.`}
            </Alert>
          ) : (
            <Text variant="small" color={color.textSecondary}>
              {`Vagas: ${preview.data.activeUsers} usuário(s) ativo(s) e ${preview.data.reservedInvitations} convite(s) pendente(s) cabem no novo limite de ${preview.data.targetUserLimit}.`}
            </Text>
          )}
          {lost.length ? (
            <View style={styles.group}>
              <Text variant="smallStrong">A empresa deixará de ter</Text>
              {lost.map((f) => (
                <Checkbox
                  key={f}
                  label={featureLabel[f]}
                  description={
                    f === 'catalog.public' && preview.data?.publicCatalogEnabled
                      ? 'A vitrine publicada sai do ar; a configuração fica guardada.'
                      : undefined
                  }
                  checked={acknowledged.includes(f)}
                  onChange={(checked) =>
                    setAcknowledged((prev) =>
                      checked ? [...prev, f] : prev.filter((value) => value !== f),
                    )
                  }
                />
              ))}
              {tried && !allAcknowledged ? (
                <Text variant="small" color={color.danger}>
                  Confirme cada recurso que a empresa perderá.
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.group}>
            <Checkbox
              label={`Alterar o valor mensal (atual ${formatCents(preview.data.monthlyPriceCents)})`}
              description="Sem marcar, o valor contratado continua o mesmo."
              checked={newPrice !== null}
              onChange={(checked) =>
                setNewPrice(checked ? preview.data!.referencePriceCents : null)
              }
            />
            {newPrice !== null ? (
              <CurrencyInput label="Novo valor mensal" value={newPrice} onChange={setNewPrice} />
            ) : null}
          </View>
        </>
      ) : null}
      <ReasonField
        value={reason}
        onChange={setReason}
        error={
          tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
        }
      />
      {change.isError ? <ErrorLine error={change.error} /> : null}
    </Dialog>
  );
}

/** Valor, dia de vencimento, contato e observações internas. Só envia o que mudou. */
export function TermsDialog({ subscription, visible, onClose }: DialogProps) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const initial = {
    price: subscription.monthlyPriceCents,
    day: subscription.billingDay === null ? '' : String(subscription.billingDay),
    name: subscription.billingContact?.name ?? '',
    email: subscription.billingContact?.email ?? '',
    phone: subscription.billingContact?.phone ?? '',
    notes: subscription.commercialNotes ?? '',
  };
  const [form, setForm] = useState(initial);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));
  const billingActive = subscription.billingDay !== null;
  const contactChanged =
    form.name !== initial.name || form.email !== initial.email || form.phone !== initial.phone;
  const body = {
    ...(form.price !== initial.price ? { monthlyPriceCents: form.price } : {}),
    ...(billingActive && form.day !== initial.day ? { billingDay: Number(form.day) } : {}),
    ...(form.notes !== initial.notes ? { commercialNotes: form.notes.trim() || null } : {}),
    ...(contactChanged
      ? {
          billingContact:
            form.name.trim() || form.email.trim() || form.phone.trim()
              ? {
                  name: form.name.trim() || null,
                  email: form.email.trim().toLowerCase() || null,
                  phone: form.phone.trim() || null,
                }
              : null,
        }
      : {}),
  };
  const close = () => {
    setForm(initial);
    setReason('');
    setTried(false);
    save.reset();
    onClose();
  };
  const save = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/subscriptions/{id}/terms', {
          params: { path: { id: subscription.id } },
          body: { expectedVersion: subscription.version, reason: reason.trim(), ...body },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Condições atualizadas');
        close();
      },
    },
  );
  const dayError = billingActive && !validDay(form.day) ? 'Use um dia entre 1 e 28.' : undefined;
  const submit = () => {
    setTried(true);
    if (Object.keys(body).length === 0 || dayError || !validReason(reason)) return;
    save.mutate(undefined);
  };

  return (
    <Dialog
      visible={visible}
      title="Ajustar condições"
      description="Novas condições valem para as próximas cobranças. Cobranças já emitidas não mudam."
      onClose={save.isPending ? () => {} : close}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={close} disabled={save.isPending} />
          <Button
            label="Salvar condições"
            variant="strong"
            loading={save.isPending}
            onPress={submit}
          />
        </>
      }
    >
      <CurrencyInput
        label="Valor mensal contratado"
        value={form.price}
        onChange={(price) => set({ price })}
      />
      {billingActive ? (
        <TextField
          label="Dia de vencimento"
          hint="Entre 1 e 28."
          value={form.day}
          onChangeText={(v) => set({ day: v.replace(/\D/g, '').slice(0, 2) })}
          inputMode="numeric"
          error={tried ? dayError : undefined}
        />
      ) : (
        <Text variant="small" color={color.textSecondary}>
          O dia de vencimento é definido ao ativar a cobrança.
        </Text>
      )}
      <TextField
        label="Responsável"
        optional
        value={form.name}
        onChangeText={(name) => set({ name })}
        maxLength={120}
      />
      <TextField
        label="E-mail de cobrança"
        optional
        value={form.email}
        onChangeText={(email) => set({ email })}
        inputMode="email"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Telefone"
        optional
        value={form.phone}
        onChangeText={(phone) => set({ phone })}
        inputMode="tel"
        maxLength={20}
      />
      <TextField
        label="Observações internas"
        optional
        hint="Visíveis só no painel do Super Admin."
        value={form.notes}
        onChangeText={(notes) => set({ notes })}
        maxLength={500}
        multiline
      />
      <ReasonField
        value={reason}
        onChange={setReason}
        error={
          tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
        }
      />
      {tried && Object.keys(body).length === 0 ? (
        <Text variant="small" color={color.danger}>
          Nenhuma alteração para salvar.
        </Text>
      ) : null}
      {save.isError ? <ErrorLine error={save.error} /> : null}
    </Dialog>
  );
}

/** Ativa a cobrança de uma assinatura aguardando ativação. Nunca cobra datas passadas. */
export function ActivateDialog({ subscription, visible, onClose }: DialogProps) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const today = todayIn(BILLING_TIMEZONE);
  const [price, setPrice] = useState(subscription.monthlyPriceCents);
  const [day, setDay] = useState('10');
  const [start, setStart] = useState(today);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const close = () => {
    setReason('');
    setTried(false);
    activate.reset();
    onClose();
  };
  const activate = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/subscriptions/{id}/activate', {
          params: { path: { id: subscription.id } },
          body: {
            expectedVersion: subscription.version,
            monthlyPriceCents: price,
            billingDay: Number(day),
            billingStartsOn: start,
            reason: reason.trim(),
          },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Cobrança ativada');
        close();
      },
    },
  );
  const submit = () => {
    setTried(true);
    if (!validDay(day) || !start || !validReason(reason)) return;
    activate.mutate(undefined);
  };
  return (
    <Dialog
      visible={visible}
      title="Ativar cobrança"
      description="A primeira cobrança é gerada até 10 dias antes do primeiro vencimento a partir do início."
      onClose={activate.isPending ? () => {} : close}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={close} disabled={activate.isPending} />
          <Button
            label="Ativar cobrança"
            variant="strong"
            loading={activate.isPending}
            onPress={submit}
          />
        </>
      }
    >
      <CurrencyInput label="Valor mensal contratado" value={price} onChange={setPrice} />
      <TextField
        label="Dia de vencimento"
        hint="Entre 1 e 28."
        value={day}
        onChangeText={(v) => setDay(v.replace(/\D/g, '').slice(0, 2))}
        inputMode="numeric"
        error={tried && !validDay(day) ? 'Use um dia entre 1 e 28.' : undefined}
      />
      <DateField
        label="Início da cobrança"
        hint="Nenhuma cobrança antes desta data."
        value={start}
        onChange={setStart}
        min={today}
        max={addDays(today, 366)}
        today={today}
      />
      <ReasonField
        value={reason}
        onChange={setReason}
        error={
          tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
        }
      />
      {activate.isError ? <ErrorLine error={activate.error} /> : null}
    </Dialog>
  );
}

/** Suspensão bloqueia o acesso da empresa (dados preservados); reativação devolve o acesso. */
export function StatusDialog({
  subscription,
  companyName,
  mode,
  visible,
  onClose,
}: DialogProps & { companyName: string; mode: 'suspend' | 'reactivate' }) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const close = () => {
    setReason('');
    setTried(false);
    command.reset();
    onClose();
  };
  const command = usePlatformMutation(
    () =>
      unwrap(
        mode === 'suspend'
          ? api.POST('/api/v1/admin/subscriptions/{id}/suspend', {
              params: { path: { id: subscription.id } },
              body: { expectedVersion: subscription.version, reason: reason.trim() },
            })
          : api.POST('/api/v1/admin/subscriptions/{id}/reactivate', {
              params: { path: { id: subscription.id } },
              body: { expectedVersion: subscription.version, reason: reason.trim() },
            }),
      ),
    {
      onSuccess: () => {
        toast.show(mode === 'suspend' ? 'Assinatura suspensa' : 'Assinatura reativada');
        close();
      },
    },
  );
  return (
    <ConfirmDialog
      visible={visible}
      title={mode === 'suspend' ? `Suspender ${companyName}?` : `Reativar ${companyName}?`}
      description={
        mode === 'suspend'
          ? 'Todos os usuários da empresa perdem o acesso até a reativação. Nenhum dado é apagado e nenhuma cobrança nova é gerada enquanto estiver suspensa.'
          : 'Os usuários voltam a acessar a empresa. Meses em que ficou suspensa não são cobrados.'
      }
      confirmLabel={mode === 'suspend' ? 'Suspender acesso' : 'Reativar acesso'}
      tone={mode === 'suspend' ? 'danger' : 'strong'}
      loading={command.isPending}
      onCancel={close}
      onConfirm={() => {
        setTried(true);
        if (validReason(reason)) command.mutate(undefined);
      }}
    >
      <ReasonField
        value={reason}
        onChange={setReason}
        error={
          tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
        }
      />
      {command.isError ? <ErrorLine error={command.error} /> : null}
    </ConfirmDialog>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[2] },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  optionSelected: { borderColor: color.text, borderWidth: 2, padding: space[3] - 1 },
  flex: { flex: 1 },
});
