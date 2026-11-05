import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { CompanySubscription, PlanFeature } from '@/api/types';
import { formatCents } from '@/lib/money';
import { color, space } from '@/theme';
import {
  Alert,
  Button,
  Checkbox,
  CurrencyInput,
  Dialog,
  Select,
  Skeleton,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { useCustomPlanPreview, useCustomPlans, usePlanCatalog, usePlatformApi } from '../api';
import { featureLabel, priceLabel } from '../copy';
import { ReasonField, validReason } from '../PlatformParts';
import { usePlatformMutation } from '../platformQuery';
import { ResourcePicker } from './ResourcePicker';
import { parseUserLimit } from './rules';

type DialogProps = { subscription: CompanySubscription; visible: boolean; onClose: () => void };

function ErrorLine({ error }: { error: unknown }) {
  return (
    <Alert tone="danger" title="Não foi possível concluir">
      {toApiError(error).userMessage}
    </Alert>
  );
}

/** Zerar o valor para as cobranças futuras; as já emitidas são decisão de quem opera. */
function FreeContractNotice() {
  return (
    <Alert title="Contrato gratuito">
      Nenhuma cobrança será gerada. Cobranças já emitidas continuam abertas: cancele em Cobranças as
      que não forem devidas.
    </Alert>
  );
}

/** Cada recurso perdido é confirmado um a um; os dados dele ficam guardados. */
function LostFeatures({
  lost,
  acknowledged,
  onChange,
  showError,
  catalogWarning,
}: {
  lost: PlanFeature[];
  acknowledged: PlanFeature[];
  onChange: (features: PlanFeature[]) => void;
  showError: boolean;
  catalogWarning?: boolean | undefined;
}) {
  if (!lost.length) return null;
  return (
    <View style={styles.group}>
      <Text variant="smallStrong">A empresa deixará de ter</Text>
      <Text variant="small" color={color.textSecondary}>
        Os dados continuam guardados; só o acesso a eles para.
      </Text>
      {lost.map((f) => (
        <Checkbox
          key={f}
          label={featureLabel[f]}
          description={
            f === 'catalog.public' && catalogWarning
              ? 'A vitrine publicada sai do ar; a configuração fica guardada.'
              : undefined
          }
          checked={acknowledged.includes(f)}
          onChange={(checked) =>
            onChange(checked ? [...acknowledged, f] : acknowledged.filter((value) => value !== f))
          }
        />
      ))}
      {showError && !lost.every((f) => acknowledged.includes(f)) ? (
        <Text variant="small" color={color.danger}>
          Confirme cada recurso que a empresa perderá.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Vincula a empresa a um plano personalizado: primeiro contrato, migração de plano oficial,
 * substituição de outro personalizado ou atualização para a versão mais nova da mesma oferta.
 * A prévia vem do servidor, e o contrato recebe uma cópia dos termos.
 */
export function AssignCustomPlanDialog({ subscription, visible, onClose }: DialogProps) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const plans = useCustomPlans('active');
  const [planId, setPlanId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<PlanFeature[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const preview = useCustomPlanPreview(subscription.id, visible ? planId : null);
  const data = preview.data;
  const lost = data?.lostFeatures ?? [];
  const blocked = (data?.excessSeats ?? 0) > 0;
  const finalPrice = price ?? data?.offerPriceCents ?? 0;
  const close = () => {
    setPlanId(null);
    setAcknowledged([]);
    setPrice(null);
    setReason('');
    setTried(false);
    assign.reset();
    onClose();
  };
  const assign = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/subscriptions/{id}/custom-plan', {
          params: { path: { id: subscription.id } },
          body: {
            expectedVersion: subscription.version,
            planId: data!.planId,
            planVersion: data!.planVersion,
            acknowledgedLostFeatures: lost,
            reason: reason.trim(),
            ...(price !== null ? { monthlyPriceCents: price } : {}),
          },
        }),
      ),
    {
      onSuccess: () => {
        toast.show(`Empresa vinculada a ${data?.planName ?? 'plano personalizado'}`);
        close();
      },
    },
  );
  const submit = () => {
    setTried(true);
    const confirmed = lost.every((f) => acknowledged.includes(f));
    if (!data || blocked || !confirmed || !validReason(reason)) return;
    assign.mutate(undefined);
  };

  return (
    <Dialog
      visible={visible}
      title="Vincular plano personalizado"
      description="O contrato recebe uma cópia da oferta. Mudanças futuras na oferta não alteram esta empresa. Cobranças já emitidas não mudam."
      onClose={assign.isPending ? () => {} : close}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={close} disabled={assign.isPending} />
          <Button
            label="Confirmar vínculo"
            variant="strong"
            loading={assign.isPending}
            disabled={!data || blocked}
            onPress={submit}
          />
        </>
      }
    >
      {plans.isError ? <ErrorLine error={plans.error} /> : null}
      {plans.data && plans.data.items.length === 0 ? (
        <Alert title="Nenhum plano personalizado ativo">
          Crie uma oferta em Planos personalizados para vincular esta empresa.
        </Alert>
      ) : null}
      <Select<string>
        label="Plano personalizado"
        value={planId}
        onChange={(id) => {
          setPlanId(id);
          setAcknowledged([]);
          setPrice(null);
        }}
        placeholder={plans.isPending ? 'Carregando' : 'Escolha'}
        disabled={plans.isPending}
        options={(plans.data?.items ?? []).map((p) => ({
          value: p.id,
          label: p.name,
          description: `${p.monthlyPriceCents === 0 ? 'Gratuito' : `${formatCents(p.monthlyPriceCents)} por mês`}, até ${p.userLimit} ${
            p.userLimit === 1 ? 'usuário' : 'usuários'
          }`,
        }))}
      />
      {planId && preview.isPending ? <Skeleton width="100%" height={60} /> : null}
      {preview.isError ? <ErrorLine error={preview.error} /> : null}
      {data ? (
        <>
          {blocked ? (
            <Alert tone="danger" title="A empresa ocupa mais vagas do que o plano permite">
              {`A oferta comporta ${data.targetUserLimit}; hoje há ${data.activeUsers} usuário(s) ativo(s) e ${data.reservedInvitations} convite(s) pendente(s). Libere ${data.excessSeats} vaga(s) antes. Ninguém é desativado automaticamente.`}
            </Alert>
          ) : (
            <Text variant="small" color={color.textSecondary}>
              {`Vagas: ${data.activeUsers} usuário(s) ativo(s) e ${data.reservedInvitations} convite(s) pendente(s) cabem no novo limite de ${data.targetUserLimit}.`}
            </Text>
          )}
          {data.gainedFeatures.length ? (
            <Text variant="small" color={color.textSecondary}>
              {`A empresa passa a ter: ${data.gainedFeatures.map((f) => featureLabel[f]).join(', ')}.`}
            </Text>
          ) : null}
          <LostFeatures
            lost={lost}
            acknowledged={acknowledged}
            onChange={setAcknowledged}
            showError={tried}
            catalogWarning={data.publicCatalogEnabled}
          />
          <View style={styles.group}>
            <Checkbox
              label={`Negociar outro valor (oferta ${priceLabel(data.offerPriceCents)})`}
              description={`Valor atual da empresa: ${priceLabel(data.monthlyPriceCents)}. Sem marcar, vale o valor da oferta.`}
              checked={price !== null}
              onChange={(checked) => setPrice(checked ? data.offerPriceCents : null)}
            />
            {price !== null ? (
              <CurrencyInput label="Valor mensal contratado" value={price} onChange={setPrice} />
            ) : null}
            {finalPrice === 0 ? <FreeContractNotice /> : null}
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
      {assign.isError ? <ErrorLine error={assign.error} /> : null}
    </Dialog>
  );
}

/**
 * Ajuste individual do contrato personalizado: valor, limite e recursos desta empresa. A oferta e
 * as demais empresas não mudam. Exige confirmação explícita e fica no histórico.
 */
export function ContractDialog({
  subscription,
  visible,
  onClose,
  occupiedSeats,
}: DialogProps & { occupiedSeats: number }) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const catalog = usePlanCatalog();
  const [price, setPrice] = useState(subscription.monthlyPriceCents);
  const [limit, setLimit] = useState(String(subscription.userLimit));
  const [features, setFeatures] = useState<PlanFeature[]>(subscription.features);
  const [acknowledged, setAcknowledged] = useState<PlanFeature[]>([]);
  const [understood, setUnderstood] = useState(false);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const userLimit = parseUserLimit(limit);
  const lost = subscription.features.filter((f) => !features.includes(f));
  const gained = features.filter((f) => !subscription.features.includes(f));
  const limitError =
    userLimit === null
      ? 'Use um número entre 1 e 100.'
      : userLimit < occupiedSeats
        ? `A empresa ocupa ${occupiedSeats} vagas; libere vagas antes de reduzir.`
        : features.includes('users.invite') && userLimit < 2
          ? 'Convites de usuários adicionais exigem pelo menos 2 usuários.'
          : undefined;
  const changed =
    price !== subscription.monthlyPriceCents ||
    userLimit !== subscription.userLimit ||
    lost.length > 0 ||
    gained.length > 0;
  const save = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/subscriptions/{id}/contract', {
          params: { path: { id: subscription.id } },
          body: {
            expectedVersion: subscription.version,
            monthlyPriceCents: price,
            userLimit: userLimit as number,
            features,
            acknowledgedLostFeatures: lost,
            confirmed: true,
            reason: reason.trim(),
          },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Contrato atualizado');
        onClose();
      },
    },
  );
  const submit = () => {
    setTried(true);
    const confirmed = lost.every((f) => acknowledged.includes(f));
    if (!changed || limitError || !confirmed || !understood) return;
    if (!validReason(reason)) return;
    save.mutate(undefined);
  };

  return (
    <Dialog
      visible={visible}
      title="Alterar contrato"
      description="Vale só para esta empresa e entra em vigor na hora. A oferta de origem e as outras empresas não mudam. Cobranças já emitidas não mudam."
      onClose={save.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={save.isPending} />
          <Button
            label="Salvar contrato"
            variant="strong"
            loading={save.isPending}
            onPress={submit}
          />
        </>
      }
    >
      <CurrencyInput label="Valor mensal contratado" value={price} onChange={setPrice} />
      {price === 0 ? <FreeContractNotice /> : null}
      <TextField
        label="Limite de usuários"
        value={limit}
        inputMode="numeric"
        onChangeText={(v) => setLimit(v.replace(/\D/g, '').slice(0, 3))}
        error={tried ? limitError : undefined}
      />
      {catalog.isPending ? <Skeleton width="100%" height={120} /> : null}
      {catalog.isError ? <ErrorLine error={catalog.error} /> : null}
      {catalog.data ? (
        <ResourcePicker catalog={catalog.data} value={features} onChange={setFeatures} hideBase />
      ) : null}
      <LostFeatures
        lost={lost}
        acknowledged={acknowledged}
        onChange={setAcknowledged}
        showError={tried}
      />
      <ReasonField
        value={reason}
        onChange={setReason}
        error={
          tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
        }
      />
      <Checkbox
        label="Confirmo a alteração individual deste contrato"
        checked={understood}
        onChange={setUnderstood}
      />
      {tried && !understood ? (
        <Text variant="small" color={color.danger}>
          Confirme a alteração para continuar.
        </Text>
      ) : null}
      {tried && !changed ? (
        <Text variant="small" color={color.danger}>
          Nenhuma alteração para salvar.
        </Text>
      ) : null}
      {save.isError ? <ErrorLine error={save.error} /> : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[2] },
});
