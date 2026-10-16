import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { CompanyDetail } from '@/api/types';
import {
  useCharges,
  useCompany,
  usePlatformApi,
  useSubscriptionHistory,
} from '@/features/platform/api';
import { ChargeList } from '@/features/platform/ChargeList';
import { ManualChargeDialog } from '@/features/platform/ChargeDialogs';
import {
  dateOrDash,
  featureLabel,
  historyLabel,
  planLabel,
  seatsLabel,
} from '@/features/platform/copy';
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
import {
  ActivateDialog,
  ChangePlanDialog,
  StatusDialog,
  TermsDialog,
} from '@/features/platform/SubscriptionDialogs';
import { subscriptionCopy } from '@/features/platform/subscriptionCopy';
import { formatDate, formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { roleLabel } from '@/session/SessionContext';
import { color, space } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Panel,
  Skeleton,
  Text,
  useToast,
} from '@/ui';
import { Banknote, Mail } from '@/ui/icons';

type DialogKind = 'plan' | 'terms' | 'activate' | 'suspend' | 'reactivate' | 'charge';
type Invitation = CompanyDetail['invitations'][number];

/**
 * Detalhe administrativo de uma empresa: contrato, vagas, usuários, convites, cobranças e
 * histórico. Não mostra clientes, produtos ou pedidos dela.
 */
export default function PlatformCompany() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const company = useCompany(id);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const data = company.data;

  if (company.isPending)
    return (
      <>
        <BackLink href="/plataforma/empresas" label="Empresas" />
        <Skeleton width="40%" height={28} />
        <LoadingRows rows={5} />
      </>
    );
  if (!data)
    return (
      <>
        <BackLink href="/plataforma/empresas" label="Empresas" />
        {company.isError ? (
          <LoadError
            title="Não foi possível carregar a empresa"
            error={company.error}
            onRetry={() => company.refetch()}
          />
        ) : null}
      </>
    );

  const s = data.subscription;
  const status = subscriptionCopy[s.status];
  const close = () => setDialog(null);
  const canceled = s.status === 'canceled';

  return (
    <>
      <BackLink href="/plataforma/empresas" label="Empresas" />
      <PlatformHeader
        title={data.tenant.name}
        description={`Identificador ${data.tenant.id} · no Lastro desde ${formatDate(data.tenant.createdAt)}`}
      />
      <View style={styles.badges}>
        <Badge {...status} />
        <Badge label={planLabel(s.planCode, s.planName)} tone="accent" />
        {data.tenant.status === 'provisioning' ? (
          <Badge label="Aguardando primeiro administrador" tone="neutral" />
        ) : null}
      </View>
      {s.status === 'pending' ? (
        <Alert
          title="Cobrança ainda não ativada"
          action={
            <Button
              label="Ativar cobrança"
              size="sm"
              variant="strong"
              onPress={() => setDialog('activate')}
            />
          }
        >
          O acesso está liberado. Nenhuma cobrança é gerada antes da ativação.
        </Alert>
      ) : null}
      {s.status === 'suspended' ? (
        <Alert tone="danger" title="Acesso suspenso">
          {status.access}
        </Alert>
      ) : null}

      <Panel
        title="Assinatura"
        action={
          canceled ? undefined : (
            <View style={styles.actions}>
              <Button
                label="Trocar plano"
                size="sm"
                variant="outline"
                onPress={() => setDialog('plan')}
              />
              <Button
                label="Ajustar condições"
                size="sm"
                variant="outline"
                onPress={() => setDialog('terms')}
              />
              {s.status === 'suspended' ? (
                <Button
                  label="Reativar"
                  size="sm"
                  variant="strong"
                  onPress={() => setDialog('reactivate')}
                />
              ) : (
                <Button
                  label="Suspender"
                  size="sm"
                  variant="ghost"
                  onPress={() => setDialog('suspend')}
                />
              )}
            </View>
          )
        }
      >
        <Detail label="Plano">{planLabel(s.planCode, s.planName)}</Detail>
        <Detail label="Valor mensal contratado">{formatCents(s.monthlyPriceCents)}</Detail>
        <Detail label="Dia de vencimento">
          {s.billingDay === null ? 'Definido na ativação' : `Dia ${s.billingDay}`}
        </Detail>
        <Detail label="Início da cobrança">{dateOrDash(s.billingStartsOn)}</Detail>
        <Detail label="Próximo vencimento">{dateOrDash(s.nextDueDate)}</Detail>
        <Detail label="Data de início">{formatDate(s.startsAt)}</Detail>
        <Detail label="Responsável / contato">
          {[s.billingContact?.name, s.billingContact?.email, s.billingContact?.phone]
            .filter(Boolean)
            .join(' · ') || 'Não informado'}
        </Detail>
        <Detail label="Observações internas">{s.commercialNotes || '—'}</Detail>
      </Panel>

      <Panel
        title="Vagas e recursos"
        description="O Super Admin não ocupa vaga. Convites pendentes reservam vaga até vencer."
      >
        <Detail label="Usuários">
          {`${seatsLabel(data.capacity.activeUsers, data.capacity.userLimit)} ativos, ${data.capacity.reservedInvitations} convite(s) pendente(s), ${data.capacity.available} vaga(s) livre(s)`}
        </Detail>
        {(Object.keys(featureLabel) as (keyof typeof featureLabel)[]).map((f) => (
          <Detail key={f} label={featureLabel[f]}>
            <Badge
              label={s.features.includes(f) ? 'Incluído' : 'Não incluído'}
              tone={s.features.includes(f) ? 'success' : 'neutral'}
            />
          </Detail>
        ))}
        <Detail label="Vitrine publicada">
          {data.publicCatalogEnabled
            ? s.features.includes('catalog.public')
              ? 'Sim'
              : 'Configurada, mas fora do ar no plano atual'
            : 'Não'}
        </Detail>
      </Panel>

      <Panel title="Usuários" flush>
        {data.users.length === 0 ? (
          <EmptyState size="compact" icon={Mail} title="Nenhum usuário ainda" />
        ) : (
          data.users.map((u, i) => (
            <View key={u.uid} style={[styles.row, i < data.users.length - 1 && styles.divider]}>
              <View style={styles.copy}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {u.name ?? u.email ?? `Usuário ${u.uid.slice(0, 8)}`}
                </Text>
                <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                  {[u.name ? u.email : null, roleLabel[u.role], `desde ${formatDate(u.createdAt)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {u.seatExempt ? <Badge label="Suporte Lastro" tone="accent" /> : null}
              <Badge
                label={u.status === 'active' ? 'Ativo' : 'Desativado'}
                tone={u.status === 'active' ? 'success' : 'neutral'}
              />
            </View>
          ))
        )}
      </Panel>

      <InvitationsPanel tenantId={data.tenant.id} invitations={data.invitations} />

      <CompanyCharges
        tenantId={data.tenant.id}
        name={data.tenant.name}
        onCreate={canceled ? undefined : () => setDialog('charge')}
      />

      <HistoryPanel subscriptionId={s.id} />

      {dialog === 'plan' ? <ChangePlanDialog subscription={s} visible onClose={close} /> : null}
      {dialog === 'terms' ? <TermsDialog subscription={s} visible onClose={close} /> : null}
      {dialog === 'activate' ? <ActivateDialog subscription={s} visible onClose={close} /> : null}
      {dialog === 'suspend' || dialog === 'reactivate' ? (
        <StatusDialog
          subscription={s}
          companyName={data.tenant.name}
          mode={dialog}
          visible
          onClose={close}
        />
      ) : null}
      {dialog === 'charge' ? (
        <ManualChargeDialog
          tenantId={data.tenant.id}
          companies={[
            {
              id: data.tenant.id,
              name: data.tenant.name,
              monthlyPriceCents: s.monthlyPriceCents,
              subscriptionStatus: s.status,
            },
          ]}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function InvitationsPanel({
  tenantId,
  invitations,
}: {
  tenantId: string;
  invitations: Invitation[];
}) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const close = () => {
    setRevoking(null);
    setReason('');
    setTried(false);
    revoke.reset();
  };
  const revoke = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/companies/{id}/invitations/{invitationId}/revoke', {
          params: { path: { id: tenantId, invitationId: (revoking as Invitation).id } },
          body: { reason: reason.trim() },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Convite revogado');
        close();
      },
    },
  );
  const label = (i: Invitation) =>
    i.status === 'accepted'
      ? { label: 'Aceito', tone: 'success' as const }
      : i.status === 'revoked'
        ? { label: 'Revogado', tone: 'neutral' as const }
        : i.expired
          ? { label: 'Vencido', tone: 'warning' as const }
          : { label: 'Pendente', tone: 'accent' as const };
  return (
    <Panel title="Convites" description="Os 50 convites mais recentes da empresa." flush>
      {invitations.length === 0 ? (
        <EmptyState size="compact" icon={Mail} title="Nenhum convite" />
      ) : (
        invitations.map((inv, i) => (
          <View key={inv.id} style={[styles.row, i < invitations.length - 1 && styles.divider]}>
            <View style={styles.copy}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {inv.email}
              </Text>
              <Text variant="small" color={color.textSecondary}>
                {`${roleLabel[inv.role]} · criado ${formatDate(inv.createdAt)} · vence ${formatDate(inv.expiresAt)}`}
              </Text>
            </View>
            {inv.seatExempt ? <Badge label="Suporte Lastro" tone="accent" /> : null}
            <Badge {...label(inv)} />
            {inv.status === 'pending' && !inv.expired ? (
              <Button
                label="Revogar"
                size="sm"
                variant="outline"
                onPress={() => setRevoking(inv)}
              />
            ) : null}
          </View>
        ))
      )}
      <ConfirmDialog
        visible={revoking !== null}
        title="Revogar convite?"
        description={`O convite para ${revoking?.email ?? ''} deixa de funcionar e a vaga reservada é liberada.`}
        confirmLabel="Revogar convite"
        loading={revoke.isPending}
        onCancel={close}
        onConfirm={() => {
          setTried(true);
          if (validReason(reason)) revoke.mutate(undefined);
        }}
      >
        <ReasonField
          value={reason}
          onChange={setReason}
          error={
            tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
          }
        />
        {revoke.isError ? (
          <Alert tone="danger" title="Convite não revogado">
            {toApiError(revoke.error).userMessage}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </Panel>
  );
}

function CompanyCharges({
  tenantId,
  name,
  onCreate,
}: {
  tenantId: string;
  name: string;
  onCreate: (() => void) | undefined;
}) {
  const charges = useCharges('all', tenantId);
  const items = charges.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Panel
      title="Cobranças"
      action={
        onCreate ? (
          <Button label="Nova cobrança" size="sm" variant="outline" onPress={onCreate} />
        ) : undefined
      }
      flush
    >
      {charges.isError ? (
        <View style={styles.pad}>
          <LoadError
            title="Não foi possível carregar as cobranças"
            error={charges.error}
            onRetry={() => charges.refetch()}
          />
        </View>
      ) : null}
      {charges.isPending ? (
        <LoadingRows />
      ) : items.length === 0 ? (
        <EmptyState
          size="compact"
          icon={Banknote}
          title="Nenhuma cobrança"
          description="Geradas automaticamente depois da ativação, até 10 dias antes de cada vencimento."
        />
      ) : (
        <ChargeList charges={items} companyName={() => name} />
      )}
      {charges.hasNextPage ? (
        <View style={styles.pad}>
          <Button
            label="Carregar mais"
            size="sm"
            variant="outline"
            loading={charges.isFetchingNextPage}
            onPress={() => charges.fetchNextPage()}
          />
        </View>
      ) : null}
    </Panel>
  );
}

function HistoryPanel({ subscriptionId }: { subscriptionId: string }) {
  const history = useSubscriptionHistory(subscriptionId);
  return (
    <Panel
      title="Histórico da assinatura"
      description="Alterações auditadas, mais recentes primeiro."
      flush
    >
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
          <View style={styles.copy}>
            <Text variant="body">{historyLabel(entry.action, entry.changes)}</Text>
            <Text variant="caption" color={color.textSecondary}>
              {formatDateTime(entry.occurredAt)}
            </Text>
          </View>
        </View>
      ))}
    </Panel>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  copy: { flex: 1, minWidth: 200, gap: 2 },
  pad: { padding: space[4] },
});
