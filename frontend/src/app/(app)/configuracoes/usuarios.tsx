import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { Member, MembershipPlan, PendingInvitation, Role, UsersPage } from '@/api/types';
import { IssuedInviteCard } from '@/features/invitations/IssuedInviteCard';
import { featureLabel } from '@/features/platform/copy';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { formatDate } from '@/lib/dates';
import { roleLabel, useSession, useTenantApi } from '@/session/SessionContext';
import { color, space } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Panel,
  Segmented,
  Skeleton,
  Text,
  TextField,
} from '@/ui';
import { Mail, UserPlus } from '@/ui/icons';

export default function UsersRoute() {
  return (
    <RequirePermission title="Usuários e convites" anyOf={['users:manage']}>
      <Users />
    </RequirePermission>
  );
}

function Users() {
  const { api, tenantId, header } = useTenantApi();
  const users = useInfiniteQuery({
    queryKey: queryKeys.users(tenantId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/users', {
          params: { header, query: pageParam ? { cursor: pageParam } : {} },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const members = users.data?.pages.flatMap((p) => p.items) ?? [];
  // Convites pendentes e vagas vêm completos na primeira página.
  const pending = users.data?.pages[0]?.pendingInvitations ?? [];
  const capacity = users.data?.pages[0]?.capacity ?? null;
  const { membership } = useSession();
  const plan = membership?.plan ?? null;

  return (
    <Screen
      title="Usuários e convites"
      description="Cada pessoa ativa e cada convite pendente ocupam uma vaga do plano."
    >
      {plan && capacity ? <SeatsPanel plan={plan} capacity={capacity} /> : null}
      {users.isPending || !plan || !capacity ? null : !plan.features.includes('users.invite') ? (
        <Alert title="Convites adicionais não fazem parte do seu plano">
          {`O plano ${plan.name ?? 'contratado'} permite ${plan.userLimit === 1 ? '1 usuário' : `${plan.userLimit} usuários`}. Para convidar mais pessoas, fale com o Lastro sobre o plano Profissional.`}
        </Alert>
      ) : capacity.available === 0 ? (
        <Alert tone="warning" title="Todas as vagas do plano estão ocupadas">
          Revogue um convite pendente para liberar uma vaga.
        </Alert>
      ) : (
        <InvitePanel sellers={plan.features.includes('commercial.sellers')} />
      )}
      {users.isError ? (
        <Alert
          tone="danger"
          title="Não foi possível carregar os usuários"
          action={
            <Button
              label="Tentar de novo"
              size="sm"
              variant="outline"
              onPress={() => users.refetch()}
            />
          }
        >
          {toApiError(users.error).userMessage}
        </Alert>
      ) : null}
      <Panel title="Convites pendentes" flush>
        {users.isPending ? (
          <LoadingRows />
        ) : pending.length ? (
          pending.map((inv, i) => (
            <PendingRow key={inv.id} invitation={inv} last={i === pending.length - 1} />
          ))
        ) : (
          <EmptyState size="compact" icon={Mail} title="Nenhum convite pendente" />
        )}
      </Panel>
      <Panel title="Pessoas com acesso" flush>
        {users.isPending ? (
          <LoadingRows />
        ) : (
          members.map((m, i) => <MemberRow key={m.id} member={m} last={i === members.length - 1} />)
        )}
        {users.hasNextPage ? (
          <View style={styles.more}>
            <Button
              label="Carregar mais"
              variant="outline"
              size="sm"
              loading={users.isFetchingNextPage}
              onPress={() => users.fetchNextPage()}
            />
          </View>
        ) : null}
      </Panel>
    </Screen>
  );
}

const inviteSchema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail.').pipe(z.email('E-mail inválido.')),
  role: z.enum(['seller', 'administrator']),
});
type InviteValues = z.infer<typeof inviteSchema>;

/** Vagas do plano: usuários ativos e convites pendentes. O suporte Lastro não ocupa vaga. */
function SeatsPanel({ plan, capacity }: { plan: MembershipPlan; capacity: UsersPage['capacity'] }) {
  const used = capacity.activeUsers + capacity.reservedInvitations;
  return (
    <Panel
      title={`Plano ${plan.name ?? 'contratado'}`}
      description={`${used} de ${capacity.userLimit} ${capacity.userLimit === 1 ? 'vaga em uso' : 'vagas em uso'}: ${capacity.activeUsers} ${capacity.activeUsers === 1 ? 'usuário ativo' : 'usuários ativos'} e ${capacity.reservedInvitations} ${capacity.reservedInvitations === 1 ? 'convite pendente' : 'convites pendentes'}.`}
      action={
        <Badge
          label={capacity.available ? `${capacity.available} livre(s)` : 'Sem vagas livres'}
          tone={capacity.available ? 'success' : 'warning'}
        />
      }
    >
      <Text variant="small" color={color.textSecondary}>
        {plan.features.length
          ? `Recursos do plano: ${plan.features.map((f) => featureLabel[f]).join(', ')}.`
          : 'Inclui clientes, produtos, pedidos, financeiro, relatórios e documentos. Convites adicionais, vitrine e vendedores fazem parte do Profissional.'}
      </Text>
    </Panel>
  );
}

function InvitePanel({ sellers }: { sellers: boolean }) {
  const { api, tenantId, header } = useTenantApi();
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<{ email: string; token: string } | null>(null);
  const defaultRole: Role = sellers ? 'seller' : 'administrator';
  const { control, handleSubmit, reset, formState } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: defaultRole },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const invite = useMutation({
    mutationFn: (v: InviteValues) =>
      unwrap(
        api.POST('/api/v1/users/invitations', {
          params: { header },
          body: { email: v.email.toLowerCase(), role: v.role },
        }),
      ),
    onSuccess: (result) => {
      setIssued({ email: result.invitation.email, token: result.token });
      reset({ email: '', role: defaultRole });
      queryClient.invalidateQueries({ queryKey: queryKeys.users(tenantId) });
    },
  });
  // Sem Idempotency-Key no contrato: o botão fica travado durante o envio e não há repetição automática.
  const onSubmit = handleSubmit((v) => invite.mutate(v));

  return (
    <Panel
      title="Convidar pessoa"
      description="O link é gerado aqui. O Lastro ainda não envia e-mail."
    >
      <View style={styles.form}>
        {issued ? (
          <IssuedInviteCard
            email={issued.email}
            token={issued.token}
            onDone={() => setIssued(null)}
          />
        ) : null}
        {invite.isError ? (
          <Alert tone="danger" title="Convite não criado">
            {inviteError(invite.error)}
          </Alert>
        ) : null}
        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <TextField
              label="E-mail"
              icon={Mail}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={formState.errors.email?.message}
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="send"
              onSubmitEditing={onSubmit}
            />
          )}
        />
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <View style={styles.roleField}>
              <Text variant="smallStrong">Perfil</Text>
              {/* Vendedores e carteiras dependem do plano; sem o recurso, só administrador. */}
              {sellers ? (
                <Segmented<Role>
                  label="Perfil"
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: 'seller', label: 'Vendedor' },
                    { value: 'administrator', label: 'Administrador' },
                  ]}
                />
              ) : (
                <Text variant="body">Administrador</Text>
              )}
              <Text variant="small" color={color.textSecondary}>
                {field.value === 'seller'
                  ? 'Vê só a própria carteira de clientes e os próprios pedidos.'
                  : 'Gerencia cadastros, estoque, pedidos de todos e a equipe.'}
              </Text>
            </View>
          )}
        />
        <View>
          <Button
            label="Gerar convite"
            icon={UserPlus}
            variant="strong"
            loading={invite.isPending}
            onPress={onSubmit}
          />
        </View>
      </View>
    </Panel>
  );
}

function inviteError(e: unknown): string {
  const err = toApiError(e);
  if (err.code === 'CONFLICT')
    return 'Já existe convite pendente ou acesso ativo para este e-mail.';
  return err.userMessage;
}

function PendingRow({ invitation, last }: { invitation: PendingInvitation; last: boolean }) {
  const { api, tenantId, header } = useTenantApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const revoke = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/users/invitations/{id}/revoke', {
          params: { header, path: { id: invitation.id } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users(tenantId) }),
  });

  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={styles.copy}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {invitation.email}
        </Text>
        <Text variant="small" color={color.textSecondary}>
          {roleLabel[invitation.role]}, vence em {formatDate(invitation.expiresAt)}
        </Text>
        {revoke.isError ? (
          <Text variant="small" color={color.danger}>
            {toApiError(revoke.error).userMessage}
          </Text>
        ) : null}
      </View>
      {invitation.seatExempt ? <Badge label="Suporte Lastro" tone="accent" /> : null}
      {confirming ? (
        <View style={styles.inline}>
          <Button label="Manter" size="sm" variant="ghost" onPress={() => setConfirming(false)} />
          <Button
            label="Revogar convite"
            size="sm"
            variant="danger"
            loading={revoke.isPending}
            onPress={() => revoke.mutate()}
          />
        </View>
      ) : (
        <Button label="Revogar" size="sm" variant="outline" onPress={() => setConfirming(true)} />
      )}
    </View>
  );
}

function MemberRow({ member, last }: { member: Member; last: boolean }) {
  const { user } = useSession();
  const you = member.id === user?.uid;
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={styles.copy}>
        <Text variant="bodyStrong">
          {you ? `Você (${user?.email ?? ''})` : member.seatExempt ? 'Suporte Lastro' : 'Usuário'}
        </Text>
        <Text variant="small" color={color.textSecondary} selectable>
          {you ? roleLabel[member.role] : `${roleLabel[member.role]}, ID ${member.id.slice(0, 8)}`}
        </Text>
      </View>
      {member.seatExempt ? <Badge label="Não ocupa vaga" tone="accent" /> : null}
      <Badge
        label={member.status === 'active' ? 'Ativo' : 'Desativado'}
        tone={member.status === 'active' ? 'success' : 'neutral'}
      />
    </View>
  );
}

function LoadingRows() {
  return (
    <View style={styles.loading}>
      <Skeleton width="50%" height={16} />
      <Skeleton width="30%" />
      <Skeleton width="45%" height={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[4] },
  roleField: { gap: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  copy: { flex: 1, minWidth: 180, gap: 2 },
  inline: { flexDirection: 'row', gap: space[2] },
  more: { padding: space[4], alignItems: 'flex-start' },
  loading: { padding: space[5], gap: space[3] },
});
