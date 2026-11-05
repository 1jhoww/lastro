import { useState } from 'react';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { CustomPlanView, LinkedCompany, PlanCatalog } from '@/api/types';
import {
  useCustomPlan,
  useCustomPlanHistory,
  usePlanCatalog,
  usePlatformApi,
} from '@/features/platform/api';
import { featureLabel, historyLabel, planLabel, priceLabel } from '@/features/platform/copy';
import {
  CustomPlanForm,
  type CustomPlanValues,
} from '@/features/platform/customPlans/CustomPlanForm';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import {
  BackLink,
  Detail,
  LoadError,
  LoadingRows,
  ReasonField,
  validReason,
} from '@/features/platform/PlatformParts';
import { usePlatformMutation } from '@/features/platform/platformQuery';
import { subscriptionCopy } from '@/features/platform/subscriptionCopy';
import { validPlanName } from '@/features/platform/customPlans/rules';
import { useIntentKey } from '@/lib/idempotency';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { color, space } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Panel,
  Skeleton,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { Building } from '@/ui/icons';

const reasonError = 'Informe o motivo (mínimo 3 caracteres).';

/** Oferta, empresas vinculadas e histórico. Editar a oferta nunca altera contratos existentes. */
export default function CustomPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useCustomPlan(id);
  const catalog = usePlanCatalog();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'duplicate' | 'status' | null>(null);
  const data = detail.data;

  if (detail.isPending)
    return (
      <>
        <BackLink href="/plataforma/planos" label="Planos personalizados" />
        <Skeleton width="40%" height={28} />
        <LoadingRows rows={5} />
      </>
    );
  if (!data)
    return (
      <>
        <BackLink href="/plataforma/planos" label="Planos personalizados" />
        {detail.isError ? (
          <LoadError
            title="Não foi possível carregar o plano"
            error={detail.error}
            onRetry={() => detail.refetch()}
          />
        ) : null}
      </>
    );

  const plan = data.plan;
  const open = data.companies.filter((c) => c.subscriptionStatus !== 'canceled').length;
  if (editing && catalog.data)
    return (
      <>
        <BackLink href="/plataforma/planos" label="Planos personalizados" />
        <PlatformHeader title={`Editar ${plan.name}`} />
        <EditPlan
          plan={plan}
          catalog={catalog.data}
          linked={open}
          onDone={() => setEditing(false)}
        />
      </>
    );

  return (
    <>
      <BackLink href="/plataforma/planos" label="Planos personalizados" />
      <PlatformHeader
        title={plan.name}
        description={plan.description || 'Sem descrição interna.'}
        action={
          <View style={styles.actions}>
            <Button
              label="Editar"
              size="sm"
              variant="outline"
              disabled={!catalog.data}
              onPress={() => setEditing(true)}
            />
            <Button
              label="Duplicar"
              size="sm"
              variant="outline"
              onPress={() => setDialog('duplicate')}
            />
            <Button
              label={plan.status === 'active' ? 'Desativar' : 'Reativar'}
              size="sm"
              variant="ghost"
              onPress={() => setDialog('status')}
            />
          </View>
        }
      />
      <View style={styles.actions}>
        <Badge
          label={plan.status === 'active' ? 'Ativo' : 'Desativado'}
          tone={plan.status === 'active' ? 'success' : 'neutral'}
        />
        <Badge label={`Versão ${plan.version}`} tone="neutral" />
      </View>
      {plan.status === 'inactive' ? (
        <Alert title="Plano desativado">
          Não aceita novos contratos. As empresas já vinculadas continuam com os termos delas.
        </Alert>
      ) : null}
      <Panel title="Oferta">
        <Detail label="Mensalidade negociada">{priceLabel(plan.monthlyPriceCents)}</Detail>
        <Detail label="Limite de usuários">
          {plan.userLimit === 1 ? '1 usuário' : `Até ${plan.userLimit} usuários`}
        </Detail>
        <Detail label="Modelo oficial">
          {plan.sourcePlanCode ? planLabel(plan.sourcePlanCode) : 'Nenhum'}
        </Detail>
        <Detail label="Recursos adicionais">
          {plan.features.length ? (
            <View style={styles.features}>
              {plan.features.map((f) => (
                <Text key={f} variant="body">
                  {featureLabel[f]}
                </Text>
              ))}
            </View>
          ) : (
            'Somente os módulos base'
          )}
        </Detail>
      </Panel>
      <Panel
        title="Empresas vinculadas"
        description="Cada empresa mantém os termos da versão que contratou."
        flush
      >
        {data.companies.length === 0 ? (
          <EmptyState
            size="compact"
            icon={Building}
            title="Nenhuma empresa vinculada"
            description="Vincule pela tela da empresa ou ao criar uma nova empresa."
          />
        ) : (
          <DataTable<LinkedCompany>
            label="Empresas vinculadas"
            rows={data.companies}
            keyOf={(c) => c.subscriptionId}
            hrefOf={(c) => `/plataforma/empresas/${c.tenantId}`}
            columns={[
              {
                key: 'name',
                label: 'Empresa',
                flex: 2,
                render: (c) => (
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {c.tenantName}
                  </Text>
                ),
              },
              {
                key: 'price',
                label: 'Valor',
                flex: 1,
                render: (c) => <Text variant="body">{priceLabel(c.monthlyPriceCents)}</Text>,
              },
              {
                key: 'version',
                label: 'Versão',
                flex: 1,
                render: (c) => <ContractBadges company={c} />,
              },
              {
                key: 'status',
                label: 'Situação',
                flex: 1,
                render: (c) => <Badge {...subscriptionCopy[c.subscriptionStatus]} />,
              },
            ]}
            renderCompact={(c) => (
              <View style={styles.compact}>
                <Text variant="bodyStrong">{c.tenantName}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${c.monthlyPriceCents === 0 ? 'Gratuito' : `${formatCents(c.monthlyPriceCents)} por mês`}, ${subscriptionCopy[c.subscriptionStatus].label.toLowerCase()}`}
                </Text>
                <ContractBadges company={c} />
              </View>
            )}
          />
        )}
      </Panel>
      <PlanHistory id={plan.id} />
      {dialog === 'duplicate' ? (
        <DuplicateDialog plan={plan} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'status' ? (
        <StatusDialog plan={plan} linked={open} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

function ContractBadges({ company }: { company: LinkedCompany }) {
  return (
    <View style={styles.badges}>
      <Text variant="body">{`v${company.planVersion}`}</Text>
      {company.outdated ? <Badge label="Oferta mudou" tone="warning" /> : null}
      {company.adjusted ? <Badge label="Ajustado" tone="accent" /> : null}
    </View>
  );
}

function EditPlan({
  plan,
  catalog,
  linked,
  onDone,
}: {
  plan: CustomPlanView;
  catalog: PlanCatalog;
  linked: number;
  onDone: () => void;
}) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const [values, setValues] = useState<CustomPlanValues | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const save = usePlatformMutation(
    () => {
      const { sourcePlanCode: _source, ...terms } = values as CustomPlanValues;
      return unwrap(
        api.PATCH('/api/v1/admin/custom-plans/{id}', {
          params: { path: { id: plan.id } },
          body: { expectedVersion: plan.version, reason: reason.trim(), ...terms },
        }),
      );
    },
    {
      onSuccess: () => {
        toast.show('Plano atualizado');
        onDone();
      },
    },
  );
  return (
    <>
      <CustomPlanForm
        catalog={catalog}
        initial={plan}
        allowModel={false}
        submitLabel="Salvar alterações"
        pending={false}
        error={null}
        onSubmit={setValues}
        onCancel={onDone}
      />
      <ConfirmDialog
        visible={values !== null}
        title="Salvar nova versão da oferta?"
        description={
          linked === 0
            ? 'Nenhuma empresa está vinculada a este plano. Vale para os próximos contratos.'
            : `Vale só para os próximos contratos. ${linked === 1 ? 'A empresa vinculada continua' : `As ${linked} empresas vinculadas continuam`} com os termos contratados.`
        }
        confirmLabel="Salvar versão"
        tone="strong"
        loading={save.isPending}
        onCancel={() => {
          setValues(null);
          save.reset();
        }}
        onConfirm={() => {
          setTried(true);
          if (validReason(reason)) save.mutate(undefined);
        }}
      >
        <ReasonField
          value={reason}
          onChange={setReason}
          error={tried && !validReason(reason) ? reasonError : undefined}
        />
        {save.isError ? (
          <Alert tone="danger" title="Oferta não salva">
            {toApiError(save.error).userMessage}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function DuplicateDialog({ plan, onClose }: { plan: CustomPlanView; onClose: () => void }) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const intent = useIntentKey();
  const [name, setName] = useState(`${plan.name} (cópia)`.slice(0, 120));
  const [tried, setTried] = useState(false);
  const duplicate = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/custom-plans/{id}/duplicate', {
          params: {
            path: { id: plan.id },
            header: { 'Idempotency-Key': intent.current() },
          },
          body: { name: name.trim() },
        }),
      ),
    {
      onSuccess: (copy) => {
        toast.show('Plano duplicado');
        onClose();
        router.replace(`/plataforma/planos/${copy.id}` as Href);
      },
    },
  );
  return (
    <ConfirmDialog
      visible
      title="Duplicar plano"
      description="Cria uma nova oferta com os mesmos termos, sem empresas vinculadas."
      confirmLabel="Duplicar"
      tone="strong"
      loading={duplicate.isPending}
      onCancel={onClose}
      onConfirm={() => {
        setTried(true);
        if (validPlanName(name)) duplicate.mutate(undefined);
      }}
    >
      <TextField
        label="Nome da nova oferta"
        value={name}
        maxLength={120}
        onChangeText={(v) => {
          intent.reset();
          setName(v);
        }}
        error={tried && !validPlanName(name) ? 'Use pelo menos 2 caracteres.' : undefined}
      />
      {duplicate.isError ? (
        <Alert tone="danger" title="Plano não duplicado">
          {toApiError(duplicate.error).userMessage}
        </Alert>
      ) : null}
    </ConfirmDialog>
  );
}

function StatusDialog({
  plan,
  linked,
  onClose,
}: {
  plan: CustomPlanView;
  linked: number;
  onClose: () => void;
}) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const deactivating = plan.status === 'active';
  const body = () => ({
    params: { path: { id: plan.id } },
    body: { expectedVersion: plan.version, reason: reason.trim() },
  });
  const command = usePlatformMutation(
    () =>
      unwrap(
        deactivating
          ? api.POST('/api/v1/admin/custom-plans/{id}/deactivate', body())
          : api.POST('/api/v1/admin/custom-plans/{id}/reactivate', body()),
      ),
    {
      onSuccess: () => {
        toast.show(deactivating ? 'Plano desativado' : 'Plano reativado');
        onClose();
      },
    },
  );
  return (
    <ConfirmDialog
      visible
      title={deactivating ? `Desativar ${plan.name}?` : `Reativar ${plan.name}?`}
      description={
        deactivating
          ? `O plano deixa de aceitar novos contratos. ${
              linked === 0
                ? 'Nenhuma empresa está vinculada.'
                : `${linked === 1 ? 'A empresa vinculada continua' : `As ${linked} empresas vinculadas continuam`} com acesso e termos atuais.`
            }`
          : 'O plano volta a aceitar novos contratos.'
      }
      confirmLabel={deactivating ? 'Desativar plano' : 'Reativar plano'}
      tone={deactivating ? 'danger' : 'strong'}
      loading={command.isPending}
      onCancel={onClose}
      onConfirm={() => {
        setTried(true);
        if (validReason(reason)) command.mutate(undefined);
      }}
    >
      <ReasonField
        value={reason}
        onChange={setReason}
        error={tried && !validReason(reason) ? reasonError : undefined}
      />
      {command.isError ? (
        <Alert tone="danger" title="Não foi possível concluir">
          {toApiError(command.error).userMessage}
        </Alert>
      ) : null}
    </ConfirmDialog>
  );
}

function PlanHistory({ id }: { id: string }) {
  const history = useCustomPlanHistory(id);
  return (
    <Panel title="Histórico" description="Alterações auditadas, mais recentes primeiro." flush>
      {history.isPending ? <LoadingRows /> : null}
      {history.isError ? (
        <View style={styles.pad}>
          <LoadError
            title="Histórico indisponível"
            error={history.error}
            onRetry={() => history.refetch()}
          />
        </View>
      ) : null}
      {history.data?.items.map((entry, i, all) => (
        <View key={entry.id} style={[styles.row, i < all.length - 1 && styles.divider]}>
          <Text variant="body">{historyLabel(entry.action, entry.changes)}</Text>
          <Text variant="caption" color={color.textSecondary}>
            {formatDateTime(entry.occurredAt)}
          </Text>
        </View>
      ))}
    </Panel>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  features: { gap: 2 },
  compact: { gap: space[1], alignItems: 'flex-start' },
  row: { gap: 2, paddingHorizontal: space[5], paddingVertical: space[3] },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  pad: { padding: space[4] },
});
