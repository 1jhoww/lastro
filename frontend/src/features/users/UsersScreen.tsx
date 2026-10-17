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
import { Screen } from '@/layout/Screen';
import { formatDate } from '@/lib/dates';
import { roleLabel, useSession, useTenantApi } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  IconButton,
  Panel,
  Segmented,
  Skeleton,
  Switch,
  Text,
  TextField,
  useToast,
  type Column,
} from '@/ui';
import { Mail, Pencil, RefreshCw, ShieldCheck, UserPlus, X } from '@/ui/icons';
import { memberLabel, useReissueInvitation, useUpdateMember } from './api';
import { PermissionsDialog } from './PermissionsDialog';

type StatusFilter = 'all' | 'active' | 'disabled';
const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'disabled', label: 'Inativos' },
];

/** Resumo das permissões: administradores têm tudo; vendedores, padrão ou personalizadas. */
function permissionSummary(m: Member): string {
  if (m.role === 'administrator') return 'Acesso completo';
  return m.customOperations ? 'Personalizadas' : 'Padrão do vendedor';
}

/** O que cada perfil pode fazer, em linguagem de uso (sem nomes internos de permissão). */
export const roleDescription: Record<Role, string> = {
  seller: 'Atende a própria carteira: seus clientes, pedidos e documentos.',
  administrator: 'Gerencia cadastros, estoque, financeiro, pedidos de todos e a equipe.',
};

const roleOptions: { value: Role; label: string }[] = [
  { value: 'seller', label: 'Vendedor' },
  { value: 'administrator', label: 'Administrador' },
];

/** Perfis oferecidos: sem o recurso de vendedores no plano, só administrador. */
const rolesFor = (sellers: boolean) =>
  sellers ? roleOptions : roleOptions.filter((o) => o.value === 'administrator');

/**
 * Equipe da empresa: pessoas com acesso e convites pendentes. Novas pessoas entram só por
 * convite; aqui se muda perfil e situação. O servidor é a autoridade: recusa tirar o último
 * administrador ativo, passar do limite do plano ou mexer em outra empresa. Vagas e recursos
 * do plano vêm do backend (`capacity` da listagem e `plan.features` do /me); a tela só esconde
 * o que o plano não oferece e o que não se aplica (a própria conta, por exemplo).
 */
export function UsersScreen() {
  const { api, tenantId, header } = useTenantApi();
  const { user, membership } = useSession();
  const plan = membership?.plan ?? null;
  const compact = useLayoutSize() === 'compact';
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [granting, setGranting] = useState<Member | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const users = useInfiniteQuery({
    queryKey: queryKeys.users(tenantId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/users', {
          params: { header, query: { limit: '100', ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const allMembers = users.data?.pages.flatMap((p) => p.items) ?? [];
  const members = filter === 'all' ? allMembers : allMembers.filter((m) => m.status === filter);
  const matrix = users.data?.pages[0]?.permissionMatrix ?? [];
  // Convites pendentes vêm completos na primeira página.
  const pending = users.data?.pages[0]?.pendingInvitations ?? [];
  // Vagas calculadas pelo servidor; o suporte Lastro (seatExempt) não ocupa vaga.
  const capacity = users.data?.pages[0]?.capacity ?? null;
  const canInvite = plan?.features.includes('users.invite') ?? false;
  const sellers = plan?.features.includes('commercial.sellers') ?? false;
  const hasSeat = (capacity?.available ?? 0) > 0;
  // Último administrador da própria empresa: o acesso de suporte não conta (como no servidor).
  const activeAdmins = allMembers.filter(
    (m) => m.role === 'administrator' && m.status === 'active' && !m.seatExempt,
  ).length;

  const columns: Column<Member>[] = [
    {
      key: 'name',
      label: 'Nome',
      flex: 3,
      render: (m) => <MemberName member={m} you={m.id === user?.uid} nameOnly />,
    },
    {
      key: 'email',
      label: 'E-mail',
      flex: 3,
      render: (m) => (
        <Text variant="small" numberOfLines={1} selectable>
          {m.email ?? (m.id === user?.uid ? (user?.email ?? '—') : '—')}
        </Text>
      ),
    },
    {
      key: 'role',
      label: 'Perfil',
      flex: 2,
      render: (m) => <Text variant="small">{roleLabel[m.role]}</Text>,
    },
    {
      key: 'permissions',
      label: 'Permissões',
      flex: 2,
      render: (m) => (
        <Text variant="small" numberOfLines={1}>
          {permissionSummary(m)}
        </Text>
      ),
    },
    {
      key: 'since',
      label: 'Ativação',
      width: 104,
      render: (m) => <Text variant="small">{formatDate(m.createdAt)}</Text>,
    },
    {
      key: 'status',
      label: 'Situação',
      width: 96,
      render: (m) => <StatusBadge member={m} />,
    },
  ];

  return (
    <Screen
      title="Usuários"
      description={
        capacity
          ? `${capacity.activeUsers} ${capacity.activeUsers === 1 ? 'ativo' : 'ativos'} · ${capacity.reservedInvitations} ${capacity.reservedInvitations === 1 ? 'convite pendente' : 'convites pendentes'}. Cada um ocupa uma vaga do plano.`
          : 'Pessoas com acesso à empresa.'
      }
      actions={
        canInvite ? (
          <Button
            label="Convidar usuário"
            icon={UserPlus}
            variant="strong"
            fullWidth={compact}
            // Sem vaga o botão fica indisponível; o aviso abaixo explica. O servidor também recusa.
            disabled={!hasSeat}
            onPress={() => setInviting(true)}
          />
        ) : undefined
      }
    >
      {plan && capacity ? <SeatsPanel plan={plan} capacity={capacity} /> : null}
      {!plan || !capacity ? null : !canInvite ? (
        <Alert title="Convites adicionais não fazem parte do seu plano">
          {`O plano ${plan.name ?? 'contratado'} permite ${plan.userLimit === 1 ? '1 usuário' : `${plan.userLimit} usuários`}. Para convidar mais pessoas, fale com o Lastro sobre o plano Profissional.`}
        </Alert>
      ) : !hasSeat ? (
        <Alert tone="warning" title="Todos os acessos estão ocupados">
          {`Seu plano permite até ${plan.userLimit === 1 ? '1 usuário' : `${plan.userLimit} usuários`}. Revogue um convite pendente ou desative um usuário para liberar uma vaga.`}
        </Alert>
      ) : null}
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

      <Panel
        title="Pessoas com acesso"
        action={
          <Segmented<StatusFilter>
            label="Situação"
            value={filter}
            onChange={setFilter}
            options={statusFilters}
          />
        }
        flush
      >
        {users.isPending ? (
          <LoadingRows />
        ) : (
          <DataTable
            label="Usuários"
            rows={members}
            keyOf={(m) => m.id}
            columns={columns}
            actions={(m) =>
              m.id === user?.uid ? (
                <View style={styles.actionSpacer} />
              ) : (
                <View style={styles.rowActions}>
                  {m.role === 'seller' && !m.seatExempt ? (
                    <IconButton
                      icon={ShieldCheck}
                      label={`Permissões de ${memberLabel(m)}`}
                      onPress={() => setGranting(m)}
                    />
                  ) : null}
                  <IconButton
                    icon={Pencil}
                    label={`Editar ${memberLabel(m)}`}
                    onPress={() => setEditing(m)}
                  />
                </View>
              )
            }
            renderCompact={(m) => (
              <View style={styles.compact}>
                <MemberName member={m} you={m.id === user?.uid} />
                <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                  {[
                    roleLabel[m.role],
                    permissionSummary(m),
                    m.status === 'active' ? null : 'Desativado',
                    m.email && m.name ? m.email : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            )}
          />
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

      <InviteDialog visible={inviting} sellers={sellers} onClose={() => setInviting(false)} />
      {granting ? (
        <PermissionsDialog
          key={`${granting.id}:${granting.version}`}
          member={granting}
          matrix={matrix}
          onClose={() => setGranting(null)}
        />
      ) : null}
      {editing ? (
        <EditMemberDialog
          // Remonta a cada pessoa, com os valores atuais dela.
          key={`${editing.id}:${editing.version}`}
          member={editing}
          onlyAdmin={
            editing.role === 'administrator' &&
            editing.status === 'active' &&
            !editing.seatExempt &&
            activeAdmins <= 1
          }
          sellers={sellers}
          // Reativar ocupa uma vaga, exceto o acesso de suporte; o servidor confirma.
          canReactivate={editing.seatExempt || hasSeat}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}

/** Plano contratado e vagas: usuários ativos e convites pendentes. */
function SeatsPanel({ plan, capacity }: { plan: MembershipPlan; capacity: UsersPage['capacity'] }) {
  const used = capacity.activeUsers + capacity.reservedInvitations;
  return (
    <Panel
      title={`Plano ${plan.name ?? 'contratado'}`}
      description={`Acessos utilizados: ${used} de ${capacity.userLimit}`}
      action={
        <Badge
          label={
            capacity.available
              ? `${capacity.available} ${capacity.available === 1 ? 'vaga livre' : 'vagas livres'}`
              : 'Sem vagas livres'
          }
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

/**
 * Nome da pessoa. Na tabela (`nameOnly`), sem nome cadastrado a coluna não repete o e-mail,
 * que já tem coluna própria; nas linhas empilhadas, o e-mail identifica a pessoa.
 */
function MemberName({
  member: m,
  you,
  nameOnly,
}: {
  member: Member;
  you: boolean;
  nameOnly?: boolean;
}) {
  const missing = nameOnly && !m.name;
  return (
    <View style={styles.nameRow}>
      <Text
        variant={missing ? 'body' : 'bodyStrong'}
        numberOfLines={1}
        style={styles.flexShrink}
        color={m.status === 'active' && !missing ? color.text : color.textSecondary}
      >
        {missing ? 'Nome não informado' : memberLabel(m)}
      </Text>
      {you ? <Badge label="Você" /> : null}
      {m.seatExempt ? <Badge label="Suporte Lastro" tone="accent" /> : null}
    </View>
  );
}

function StatusBadge({ member }: { member: Member }) {
  return member.status === 'active' ? (
    <Badge label="Ativo" tone="success" />
  ) : (
    <Badge label="Desativado" />
  );
}

/* ---------- Edição de perfil e situação ---------- */

function EditMemberDialog({
  member,
  onlyAdmin,
  sellers,
  canReactivate,
  onClose,
}: {
  member: Member;
  onlyAdmin: boolean;
  /** Plano inclui vendedores; quem já é vendedor mantém o perfil. */
  sellers: boolean;
  /** Há vaga para voltar a ativar (ou é acesso de suporte, que não ocupa vaga). */
  canReactivate: boolean;
  onClose: () => void;
}) {
  const options = sellers || member.role === 'seller' ? roleOptions : rolesFor(false);
  const blockReactivation = member.status === 'disabled' && !canReactivate;
  const toast = useToast();
  const update = useUpdateMember();
  const [role, setRole] = useState<Role>(member.role);
  const [status, setStatus] = useState<Member['status']>(member.status);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const changed = role !== member.role || status !== member.status;
  const err = update.error ? toApiError(update.error) : null;

  const save = () =>
    update.mutate(
      { member, role, status },
      {
        onSuccess: () => {
          toast.show('Usuário salvo');
          onClose();
        },
        onSettled: () => setConfirmDisable(false),
      },
    );

  return (
    <>
      <Dialog
        visible
        title="Editar usuário"
        description={[member.name, member.email].filter(Boolean).join(' · ') || memberLabel(member)}
        onClose={update.isPending ? () => {} : onClose}
        actions={
          <>
            <Button
              label="Cancelar"
              variant="ghost"
              onPress={onClose}
              disabled={update.isPending}
            />
            <Button
              label="Salvar usuário"
              variant="strong"
              loading={update.isPending}
              disabled={!changed}
              onPress={() =>
                status === 'disabled' && member.status === 'active'
                  ? setConfirmDisable(true)
                  : save()
              }
            />
          </>
        }
      >
        {err ? (
          <Alert tone="danger" title="Usuário não alterado">
            {memberError(err.code) ?? err.userMessage}
          </Alert>
        ) : null}
        {onlyAdmin ? (
          <Alert tone="info" title="Único administrador ativo">
            A empresa precisa de pelo menos um administrador ativo. Promova outra pessoa antes de
            mudar o perfil ou desativar este acesso.
          </Alert>
        ) : null}
        {blockReactivation ? (
          <Alert tone="warning" title="Sem vaga para reativar">
            Todas as vagas do plano estão ocupadas. Revogue um convite ou desative outra pessoa
            antes de reativar este acesso.
          </Alert>
        ) : null}
        <View style={styles.field}>
          <Text variant="smallStrong">Perfil</Text>
          {onlyAdmin || options.length === 1 ? (
            <Text variant="body">{roleLabel[role]}</Text>
          ) : (
            <Segmented<Role> label="Perfil" value={role} onChange={setRole} options={options} />
          )}
          <Text variant="small" color={color.textSecondary}>
            {roleDescription[role]}
          </Text>
          {!sellers && member.role !== 'seller' ? (
            <Text variant="small" color={color.textSecondary}>
              O perfil Vendedor faz parte do plano Profissional.
            </Text>
          ) : null}
        </View>
        <Switch
          label="Acesso ativo"
          description={
            status === 'active'
              ? member.seatExempt
                ? 'Acesso de suporte do Lastro: não ocupa vaga do plano.'
                : 'Entra no app e ocupa uma vaga do plano.'
              : 'Não entra mais no app. Clientes e pedidos dele continuam salvos.'
          }
          value={status === 'active'}
          disabled={onlyAdmin || blockReactivation}
          onChange={(on) => setStatus(on ? 'active' : 'disabled')}
        />
      </Dialog>
      <ConfirmDialog
        visible={confirmDisable}
        title="Desativar acesso?"
        description={`${memberLabel(member)} deixa de entrar no app imediatamente. Clientes, pedidos e histórico ficam preservados; você pode reativar depois, se houver vaga no plano.`}
        confirmLabel="Desativar acesso"
        loading={update.isPending}
        onCancel={() => setConfirmDisable(false)}
        onConfirm={save}
      />
    </>
  );
}

function memberError(code: string): string | undefined {
  if (code === 'LAST_ADMIN_REQUIRED')
    return 'A empresa precisa de pelo menos um administrador ativo.';
  if (code === 'USER_LIMIT_REACHED')
    return 'O plano não tem vaga para reativar este acesso. Revogue um convite ou desative outra pessoa.';
  if (code === 'CONFLICT')
    return 'Este usuário foi alterado por outra pessoa. A lista foi recarregada; abra de novo para editar.';
  if (code === 'IDENTITY_DISABLED')
    return 'Não é possível reativar: a conta desta pessoa está bloqueada no Lastro. Fale com o suporte do Lastro.';
  if (code === 'IDENTITY_NOT_FOUND')
    return 'Não é possível reativar: a conta de acesso desta pessoa não existe mais. Envie um novo convite.';
  if (code === 'SUPPORT_ACCESS_ENDED')
    return 'Este acesso de suporte terminou e não pode ser reativado.';
  if (code === 'FORBIDDEN') return 'Você não tem permissão para alterar este usuário.';
  if (code === 'FEATURE_NOT_IN_PLAN') return 'O perfil Vendedor não faz parte do plano contratado.';
  return undefined;
}

/* ---------- Convite ---------- */

const inviteSchema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail.').pipe(z.email('E-mail inválido.')),
  role: z.enum(['seller', 'administrator']),
});
type InviteValues = z.infer<typeof inviteSchema>;

function InviteDialog({
  visible,
  sellers,
  onClose,
}: {
  visible: boolean;
  /** Plano inclui vendedores; sem o recurso, só se convida administrador. */
  sellers: boolean;
  onClose: () => void;
}) {
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
  const onSubmit = handleSubmit((v) => {
    if (!invite.isPending) invite.mutate(v);
  });
  const close = () => {
    if (invite.isPending) return;
    setIssued(null);
    invite.reset();
    reset({ email: '', role: defaultRole });
    onClose();
  };

  return (
    <Dialog
      visible={visible}
      title={issued ? 'Convite criado' : 'Convidar usuário'}
      description={
        issued
          ? 'Copie o link e envie por um canal seguro. Ele não aparece de novo.'
          : 'O Lastro gera o link aqui; ainda não envia e-mail.'
      }
      onClose={close}
      actions={
        issued ? (
          <Button label="Concluir" variant="strong" onPress={close} />
        ) : (
          <>
            <Button label="Cancelar" variant="ghost" onPress={close} disabled={invite.isPending} />
            <Button
              label="Gerar convite"
              icon={UserPlus}
              variant="strong"
              loading={invite.isPending}
              onPress={onSubmit}
            />
          </>
        )
      }
    >
      {issued ? (
        <IssuedInviteCard email={issued.email} token={issued.token} onDone={close} />
      ) : (
        <>
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
              <View style={styles.field}>
                <Text variant="smallStrong">Perfil</Text>
                {sellers ? (
                  <Segmented<Role>
                    label="Perfil"
                    value={field.value}
                    onChange={field.onChange}
                    options={rolesFor(sellers)}
                  />
                ) : (
                  <Text variant="body">{roleLabel[field.value]}</Text>
                )}
                <Text variant="small" color={color.textSecondary}>
                  {roleDescription[field.value]}
                </Text>
                {sellers ? null : (
                  <Text variant="small" color={color.textSecondary}>
                    O perfil Vendedor faz parte do plano Profissional.
                  </Text>
                )}
              </View>
            )}
          />
        </>
      )}
    </Dialog>
  );
}

function inviteError(e: unknown): string {
  const err = toApiError(e);
  if (err.code === 'CONFLICT')
    return 'Já existe convite pendente ou acesso ativo para este e-mail.';
  if (err.code === 'USER_LIMIT_REACHED')
    return 'O plano não tem vaga para mais um usuário. Revogue um convite ou desative alguém.';
  if (err.code === 'FEATURE_NOT_IN_PLAN')
    return 'Este convite não faz parte do plano contratado (convites adicionais ou perfil Vendedor).';
  if (err.code === 'INVITATION_REVOKED')
    return 'Este convite foi revogado e não pode ser reutilizado. Crie um novo convite.';
  return err.userMessage;
}

function PendingRow({ invitation, last }: { invitation: PendingInvitation; last: boolean }) {
  const { api, tenantId, header } = useTenantApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [reissuing, setReissuing] = useState<'resend' | 'email' | null>(null);
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
          {[
            roleLabel[invitation.role],
            invitation.createdAt ? `convidado em ${formatDate(invitation.createdAt)}` : null,
            `vence em ${formatDate(invitation.expiresAt)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {revoke.isError ? (
          <Text variant="small" color={color.danger}>
            {toApiError(revoke.error).userMessage}
          </Text>
        ) : null}
      </View>
      {invitation.seatExempt ? <Badge label="Suporte Lastro" tone="accent" /> : null}
      <IconButton
        icon={RefreshCw}
        label={`Reenviar convite de ${invitation.email}`}
        onPress={() => setReissuing('resend')}
      />
      <IconButton
        icon={Pencil}
        label={`Alterar e-mail do convite de ${invitation.email}`}
        onPress={() => setReissuing('email')}
      />
      {reissuing ? (
        <ReissueDialog
          invitation={invitation}
          mode={reissuing}
          onClose={() => setReissuing(null)}
        />
      ) : null}
      <IconButton
        icon={X}
        label={`Revogar convite de ${invitation.email}`}
        onPress={() => setConfirming(true)}
      />
      <ConfirmDialog
        visible={confirming}
        title="Revogar convite?"
        description={`O link enviado para ${invitation.email} deixa de funcionar e a vaga do plano é liberada.`}
        confirmLabel="Revogar convite"
        loading={revoke.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          revoke.mutate(undefined, {
            onSuccess: () => toast.show('Convite revogado'),
            onSettled: () => setConfirming(false),
          })
        }
      />
    </View>
  );
}

/**
 * Reenvio (novo link para o mesmo e-mail) ou correção do e-mail de um convite pendente. O
 * link anterior deixa de funcionar e a vaga continua a mesma; o novo link aparece uma vez.
 */
function ReissueDialog({
  invitation,
  mode,
  onClose,
}: {
  invitation: PendingInvitation;
  mode: 'resend' | 'email';
  onClose: () => void;
}) {
  const reissue = useReissueInvitation();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; token: string } | null>(null);
  const submit = () => {
    let target: string | undefined;
    if (mode === 'email') {
      const parsed = z.email().safeParse(email.trim().toLowerCase());
      if (!parsed.success) return setEmailError('E-mail inválido.');
      if (parsed.data === invitation.email) return setEmailError('Informe um e-mail diferente.');
      target = parsed.data;
    }
    setEmailError(null);
    reissue.mutate(
      { id: invitation.id, ...(target ? { email: target } : {}) },
      { onSuccess: (r) => setIssued({ email: r.invitation.email, token: r.token }) },
    );
  };
  const close = () => {
    if (!reissue.isPending) onClose();
  };
  return (
    <Dialog
      visible
      title={
        issued
          ? 'Novo convite criado'
          : mode === 'email'
            ? 'Alterar e-mail do convite'
            : 'Reenviar convite'
      }
      description={
        issued
          ? 'Copie o link e envie por um canal seguro. Ele não aparece de novo.'
          : mode === 'email'
            ? `O convite para ${invitation.email} deixa de funcionar. A mesma vaga passa para o novo e-mail.`
            : `Gera um novo link para ${invitation.email}, válido por 7 dias. O link anterior deixa de funcionar.`
      }
      onClose={close}
      actions={
        issued ? (
          <Button label="Concluir" variant="strong" onPress={onClose} />
        ) : (
          <>
            <Button label="Cancelar" variant="ghost" onPress={close} disabled={reissue.isPending} />
            <Button
              label={mode === 'email' ? 'Alterar e-mail' : 'Gerar novo link'}
              variant="strong"
              loading={reissue.isPending}
              onPress={submit}
            />
          </>
        )
      }
    >
      {issued ? (
        <IssuedInviteCard email={issued.email} token={issued.token} onDone={onClose} />
      ) : (
        <>
          {reissue.isError ? (
            <Alert tone="danger" title="Convite não alterado">
              {inviteError(reissue.error)}
            </Alert>
          ) : null}
          {mode === 'email' ? (
            <TextField
              label="E-mail correto"
              icon={Mail}
              value={email}
              onChangeText={setEmail}
              error={emailError ?? undefined}
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="send"
              onSubmitEditing={submit}
            />
          ) : null}
        </>
      )}
    </Dialog>
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
  field: { gap: space[2] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  compact: { gap: 2 },
  actionSpacer: { width: 1 },
  rowActions: { flexDirection: 'row', alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  more: { padding: space[4], alignItems: 'flex-start' },
  loading: { padding: space[5], gap: space[3] },
});
