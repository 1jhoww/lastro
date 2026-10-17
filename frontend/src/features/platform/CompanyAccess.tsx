import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { CompanyDetail, Role } from '@/api/types';
import { IssuedInviteCard } from '@/features/invitations/IssuedInviteCard';
import { formatDate } from '@/lib/dates';
import { roleLabel } from '@/session/SessionContext';
import { color, space } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Panel,
  Segmented,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { Mail, UserPlus } from '@/ui/icons';
import { usePlatformApi } from './api';
import { ReasonField, validReason } from './PlatformParts';
import { usePlatformMutation } from './platformQuery';

type User = CompanyDetail['users'][number];
type Invitation = CompanyDetail['invitations'][number];
type Issued = { email: string; token: string };

const emailSchema = z.email();
const normalized = (value: string) => value.trim().toLowerCase();

/** Mensagens das recusas de acesso; o servidor é sempre a autoridade. */
function accessError(error: unknown): string {
  const err = toApiError(error);
  switch (err.code) {
    case 'USER_LIMIT_REACHED':
      return `${err.userMessage} Revogue um convite ou desative um acesso antes; não há exceção de limite.`;
    case 'LAST_ADMIN_REQUIRED':
      return 'A empresa precisa de pelo menos um administrador ativo. Convide ou reative outro administrador antes.';
    case 'INVITATION_REVOKED':
      return 'Convite revogado não pode ser reutilizado. Crie um novo convite.';
    case 'FEATURE_NOT_IN_PLAN':
      return 'O perfil Vendedor não faz parte do plano desta empresa.';
    case 'EMAIL_IN_USE':
      return 'Este e-mail já pertence a outra conta. Não é possível criar uma segunda identidade.';
    case 'PLATFORM_ACCOUNT_PROTECTED':
      return 'Contas do Super Admin não são alteradas por este fluxo.';
    case 'IDENTITY_DISABLED':
      return 'A conta desta pessoa está bloqueada no Lastro. Use "Desbloquear conta" e depois reative o acesso.';
    case 'IDENTITY_NOT_FOUND':
      return 'A conta de acesso desta pessoa não existe mais. Envie um novo convite.';
    case 'SUPPORT_ACCESS_ENDED':
      return 'Este acesso de suporte terminou: a pessoa não é mais Super Admin.';
    case 'FORBIDDEN':
      return 'Sua conta não tem autorização de Super Admin para esta operação.';
    case 'REAUTHENTICATION_REQUIRED':
      return 'Confirme sua senha para continuar e tente de novo.';
    case 'CONFLICT':
      return `${err.userMessage}. Recarregue a página e tente de novo.`;
    default:
      return err.userMessage;
  }
}

/** Ocupação de acessos: ativos mais convites pendentes válidos, contra o limite do plano. */
export function CapacitySummary({ capacity }: { capacity: CompanyDetail['capacity'] }) {
  const used = capacity.activeUsers + capacity.reservedInvitations;
  return (
    <View style={styles.capacity}>
      <Text variant="bodyStrong">{`Ocupação: ${used} de ${capacity.userLimit}`}</Text>
      <Text variant="small" color={color.textSecondary}>
        {`${capacity.activeUsers} ativo(s) · ${capacity.reservedInvitations} convite(s) pendente(s) · ${capacity.available} vaga(s) disponível(is)`}
      </Text>
    </View>
  );
}

/* ---------- Usuários ---------- */

export function CompanyUsersPanel({ tenantId, users }: { tenantId: string; users: User[] }) {
  const [status, setStatus] = useState<User | null>(null);
  const [email, setEmail] = useState<User | null>(null);
  const [cancel, setCancel] = useState<User | null>(null);
  const [unblock, setUnblock] = useState<User | null>(null);
  return (
    <Panel
      title="Usuários"
      description="Desativar preserva clientes, pedidos e histórico. Reativar exige vaga livre."
      flush
    >
      {users.length === 0 ? (
        <EmptyState size="compact" icon={Mail} title="Nenhum usuário ainda" />
      ) : (
        users.map((u, i) => (
          <View key={u.uid} style={[styles.row, i < users.length - 1 && styles.divider]}>
            <View style={styles.copy}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {u.name ?? u.email ?? `Usuário ${u.uid.slice(0, 8)}`}
              </Text>
              <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                {[u.name ? u.email : null, roleLabel[u.role], `desde ${formatDate(u.createdAt)}`]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {u.emailChange ? (
                <Text variant="small" color={color.textSecondary}>
                  {u.emailChange.appliedByProvider
                    ? `Novo e-mail ${u.emailChange.newEmail} já confirmado; conclui no próximo acesso.`
                    : u.emailChange.expired
                      ? `Troca para ${u.emailChange.newEmail} vencida sem confirmação.`
                      : `Troca para ${u.emailChange.newEmail} aguardando confirmação do titular até ${formatDate(u.emailChange.expiresAt)}.`}
                </Text>
              ) : null}
            </View>
            {u.seatExempt ? <Badge label="Suporte Lastro" tone="accent" /> : null}
            {u.emailChange ? <Badge label="Troca de e-mail pendente" tone="warning" /> : null}
            {u.accountBlocked ? <Badge label="Conta bloqueada" tone="danger" /> : null}
            <Badge
              label={u.status === 'active' ? 'Ativo' : 'Desativado'}
              tone={u.status === 'active' ? 'success' : 'neutral'}
            />
            {u.seatExempt ? null : (
              <View style={styles.actions}>
                {u.accountBlocked ? (
                  <Button
                    label="Desbloquear conta"
                    size="sm"
                    variant="outline"
                    onPress={() => setUnblock(u)}
                  />
                ) : null}
                <Button
                  label={u.status === 'active' ? 'Desativar' : 'Reativar'}
                  size="sm"
                  variant="outline"
                  onPress={() => setStatus(u)}
                />
                {u.emailChange && !u.emailChange.expired ? (
                  <Button
                    label="Cancelar troca"
                    size="sm"
                    variant="ghost"
                    onPress={() => setCancel(u)}
                  />
                ) : (
                  <Button
                    label="Alterar e-mail"
                    size="sm"
                    variant="ghost"
                    onPress={() => setEmail(u)}
                  />
                )}
              </View>
            )}
          </View>
        ))
      )}
      {status ? (
        <MemberStatusDialog tenantId={tenantId} user={status} onClose={() => setStatus(null)} />
      ) : null}
      {email ? (
        <EmailChangeDialog tenantId={tenantId} user={email} onClose={() => setEmail(null)} />
      ) : null}
      {unblock ? (
        <UnblockDialog tenantId={tenantId} user={unblock} onClose={() => setUnblock(null)} />
      ) : null}
      {cancel ? (
        <CancelEmailChangeDialog
          tenantId={tenantId}
          user={cancel}
          onClose={() => setCancel(null)}
        />
      ) : null}
    </Panel>
  );
}

function MemberStatusDialog({
  tenantId,
  user,
  onClose,
}: {
  tenantId: string;
  user: User;
  onClose: () => void;
}) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const next = user.status === 'active' ? 'disabled' : 'active';
  const label = user.name ?? user.email ?? 'este usuário';
  const mutation = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/companies/{id}/users/{uid}/status', {
          params: { path: { id: tenantId, uid: user.uid } },
          body: { status: next, expectedVersion: user.version, reason: reason.trim() },
        }),
      ),
    {
      onSuccess: () => {
        toast.show(next === 'disabled' ? 'Acesso desativado' : 'Acesso reativado');
        onClose();
      },
    },
  );
  return (
    <ConfirmDialog
      visible
      title={next === 'disabled' ? 'Desativar acesso?' : 'Reativar acesso?'}
      description={
        next === 'disabled'
          ? `${label} deixa de entrar na empresa imediatamente e a vaga é liberada. Clientes, pedidos e histórico ficam preservados.`
          : `${label} volta a entrar na empresa e ocupa uma vaga do plano.`
      }
      confirmLabel={next === 'disabled' ? 'Desativar acesso' : 'Reativar acesso'}
      loading={mutation.isPending}
      onCancel={onClose}
      onConfirm={() => {
        setTried(true);
        if (validReason(reason)) mutation.mutate(undefined);
      }}
    >
      <ReasonField
        value={reason}
        onChange={setReason}
        error={
          tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
        }
      />
      {mutation.isError ? (
        <Alert tone="danger" title="Acesso não alterado">
          {accessError(mutation.error)}
        </Alert>
      ) : null}
    </ConfirmDialog>
  );
}

/**
 * Desbloqueio de conta bloqueada na plataforma (identidade Lastro e login). O bloqueio vale
 * para todas as empresas e o desbloqueio também; nenhum acesso é reativado aqui: cada empresa
 * mantém a situação própria do vínculo.
 */
function UnblockDialog({
  tenantId,
  user,
  onClose,
}: {
  tenantId: string;
  user: User;
  onClose: () => void;
}) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const mutation = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/companies/{id}/users/{uid}/unblock', {
          params: { path: { id: tenantId, uid: user.uid } },
          body: { reason: reason.trim() },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Conta desbloqueada');
        onClose();
      },
    },
  );
  return (
    <ConfirmDialog
      visible
      title="Desbloquear conta?"
      description={`${user.name ?? user.email ?? 'A pessoa'} volta a poder entrar no Lastro. O desbloqueio vale para todas as empresas da conta, mas não reativa nenhum acesso: reative aqui depois, se houver vaga.`}
      confirmLabel="Desbloquear conta"
      loading={mutation.isPending}
      onCancel={onClose}
      onConfirm={() => {
        setTried(true);
        if (validReason(reason)) mutation.mutate(undefined);
      }}
    >
      <ReasonField
        value={reason}
        onChange={setReason}
        error={
          tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
        }
      />
      {mutation.isError ? (
        <Alert tone="danger" title="Conta não desbloqueada">
          {accessError(mutation.error)}
        </Alert>
      ) : null}
    </ConfirmDialog>
  );
}

/**
 * Troca de e-mail de conta ativa. O Super Admin só abre a solicitação: o titular confirma
 * entrando na própria conta, com nova senha, e verificando o novo endereço pelo link que o
 * provedor de identidade envia. Identidade, vínculos e histórico não mudam.
 */
function EmailChangeDialog({
  tenantId,
  user,
  onClose,
}: {
  tenantId: string;
  user: User;
  onClose: () => void;
}) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const [newEmail, setNewEmail] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const emailValid = emailSchema.safeParse(normalized(newEmail)).success;
  const mutation = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/companies/{id}/users/{uid}/email-change', {
          params: { path: { id: tenantId, uid: user.uid } },
          body: { newEmail: normalized(newEmail), reason: reason.trim() },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Troca de e-mail solicitada');
        onClose();
      },
    },
  );
  return (
    <Dialog
      visible
      title="Alterar e-mail da conta"
      description={`Conta atual: ${user.email ?? 'sem e-mail'}. O titular precisa confirmar a troca entrando no Lastro e verificando o novo endereço.`}
      onClose={mutation.isPending ? () => {} : onClose}
      actions={
        <>
          <Button
            label="Cancelar"
            variant="ghost"
            onPress={onClose}
            disabled={mutation.isPending}
          />
          <Button
            label="Solicitar troca"
            variant="strong"
            loading={mutation.isPending}
            onPress={() => {
              setTried(true);
              if (emailValid && validReason(reason)) mutation.mutate(undefined);
            }}
          />
        </>
      }
    >
      {mutation.isError ? (
        <Alert tone="danger" title="Troca não solicitada">
          {accessError(mutation.error)}
        </Alert>
      ) : null}
      <TextField
        label="Novo e-mail"
        icon={Mail}
        value={newEmail}
        onChangeText={setNewEmail}
        error={tried && !emailValid ? 'E-mail inválido.' : undefined}
        inputMode="email"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
      />
      <ReasonField
        value={reason}
        onChange={setReason}
        error={
          tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
        }
      />
      <Text variant="small" color={color.textSecondary}>
        Avise o titular: ao entrar no Lastro com o e-mail atual, ele verá a solicitação e confirmará
        com a senha. O e-mail só muda depois que ele abrir o link enviado ao novo endereço.
      </Text>
    </Dialog>
  );
}

function CancelEmailChangeDialog({
  tenantId,
  user,
  onClose,
}: {
  tenantId: string;
  user: User;
  onClose: () => void;
}) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const mutation = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/companies/{id}/users/{uid}/email-change/cancel', {
          params: { path: { id: tenantId, uid: user.uid } },
          body: { reason: reason.trim() },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Troca de e-mail cancelada');
        onClose();
      },
    },
  );
  return (
    <ConfirmDialog
      visible
      title="Cancelar troca de e-mail?"
      description={`A solicitação para ${user.emailChange?.newEmail ?? ''} deixa de valer. A conta continua com o e-mail atual.`}
      confirmLabel="Cancelar troca"
      loading={mutation.isPending}
      onCancel={onClose}
      onConfirm={() => {
        setTried(true);
        if (validReason(reason)) mutation.mutate(undefined);
      }}
    >
      <ReasonField
        value={reason}
        onChange={setReason}
        error={
          tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
        }
      />
      {mutation.isError ? (
        <Alert tone="danger" title="Troca não cancelada">
          {accessError(mutation.error)}
        </Alert>
      ) : null}
    </ConfirmDialog>
  );
}

/* ---------- Convites ---------- */

export function CompanyInvitationsPanel({
  tenantId,
  invitations,
  capacity,
  provisioning,
  sellers,
}: {
  tenantId: string;
  invitations: Invitation[];
  capacity: CompanyDetail['capacity'];
  /** Empresa aguardando o primeiro administrador: só convites de administrador. */
  provisioning: boolean;
  /** Plano inclui o perfil Vendedor. */
  sellers: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [reissuing, setReissuing] = useState<{
    invitation: Invitation;
    mode: 'resend' | 'email';
  } | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const noSeat = capacity.available <= 0;
  const label = (i: Invitation) =>
    i.status === 'accepted'
      ? { label: 'Aceito', tone: 'success' as const }
      : i.status === 'revoked'
        ? { label: i.replacedBy ? 'Substituído' : 'Revogado', tone: 'neutral' as const }
        : i.expired
          ? { label: 'Vencido', tone: 'warning' as const }
          : { label: 'Pendente', tone: 'accent' as const };
  return (
    <Panel
      title="Convites"
      description="Os 50 convites mais recentes. Convites pendentes reservam vaga até vencer."
      action={
        <Button
          label="Novo convite"
          size="sm"
          variant="strong"
          icon={UserPlus}
          disabled={noSeat}
          onPress={() => setCreating(true)}
        />
      }
      flush
    >
      {noSeat ? (
        <View style={styles.pad}>
          <Alert tone="warning" title="Sem vagas disponíveis">
            {`O plano permite até ${capacity.userLimit} acesso(s) e todos estão ocupados. Para substituir alguém, revogue um convite pendente ou desative um usuário antes.`}
          </Alert>
        </View>
      ) : null}
      {invitations.length === 0 ? (
        <EmptyState size="compact" icon={Mail} title="Nenhum convite" />
      ) : (
        invitations.map((inv, i) => {
          const usable = inv.status === 'pending';
          return (
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
              {usable ? (
                <View style={styles.actions}>
                  <Button
                    label={inv.expired ? 'Renovar' : 'Reenviar'}
                    size="sm"
                    variant="outline"
                    onPress={() => setReissuing({ invitation: inv, mode: 'resend' })}
                  />
                  <Button
                    label="Alterar e-mail"
                    size="sm"
                    variant="ghost"
                    onPress={() => setReissuing({ invitation: inv, mode: 'email' })}
                  />
                  {inv.expired ? null : (
                    <Button
                      label="Revogar"
                      size="sm"
                      variant="ghost"
                      onPress={() => setRevoking(inv)}
                    />
                  )}
                </View>
              ) : null}
            </View>
          );
        })
      )}
      {creating ? (
        <InviteDialog
          tenantId={tenantId}
          provisioning={provisioning}
          sellers={sellers}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {reissuing ? (
        <ReissueDialog
          tenantId={tenantId}
          invitation={reissuing.invitation}
          mode={reissuing.mode}
          onClose={() => setReissuing(null)}
        />
      ) : null}
      {revoking ? (
        <RevokeDialog tenantId={tenantId} invitation={revoking} onClose={() => setRevoking(null)} />
      ) : null}
    </Panel>
  );
}

function InviteDialog({
  tenantId,
  provisioning,
  sellers,
  onClose,
}: {
  tenantId: string;
  provisioning: boolean;
  sellers: boolean;
  onClose: () => void;
}) {
  const { api } = usePlatformApi();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('administrator');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const emailValid = emailSchema.safeParse(normalized(email)).success;
  const mutation = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/companies/{id}/invitations', {
          params: { path: { id: tenantId } },
          body: { email: normalized(email), role, reason: reason.trim() },
        }),
      ),
    { onSuccess: (r) => setIssued({ email: r.invitation.email, token: r.token }) },
  );
  const roles =
    provisioning || !sellers
      ? (['administrator'] as Role[])
      : (['administrator', 'seller'] as Role[]);
  return (
    <Dialog
      visible
      title={issued ? 'Convite criado' : 'Novo convite de acesso'}
      description={
        issued
          ? 'Copie o link e envie por um canal seguro. Ele não aparece de novo.'
          : 'O convite ocupa uma vaga do plano até ser aceito, revogado ou vencer.'
      }
      onClose={mutation.isPending ? () => {} : onClose}
      actions={
        issued ? (
          <Button label="Concluir" variant="strong" onPress={onClose} />
        ) : (
          <>
            <Button
              label="Cancelar"
              variant="ghost"
              onPress={onClose}
              disabled={mutation.isPending}
            />
            <Button
              label="Gerar convite"
              variant="strong"
              icon={UserPlus}
              loading={mutation.isPending}
              onPress={() => {
                setTried(true);
                if (emailValid && validReason(reason)) mutation.mutate(undefined);
              }}
            />
          </>
        )
      }
    >
      {issued ? (
        <IssuedInviteCard email={issued.email} token={issued.token} onDone={onClose} />
      ) : (
        <>
          {mutation.isError ? (
            <Alert tone="danger" title="Convite não criado">
              {accessError(mutation.error)}
            </Alert>
          ) : null}
          <TextField
            label="E-mail"
            icon={Mail}
            value={email}
            onChangeText={setEmail}
            error={tried && !emailValid ? 'E-mail inválido.' : undefined}
            inputMode="email"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
          />
          <View style={styles.field}>
            <Text variant="smallStrong">Perfil</Text>
            {roles.length > 1 ? (
              <Segmented<Role>
                label="Perfil"
                value={role}
                onChange={setRole}
                options={roles.map((value) => ({ value, label: roleLabel[value] }))}
              />
            ) : (
              <Text variant="body">{roleLabel.administrator}</Text>
            )}
            {provisioning ? (
              <Text variant="small" color={color.textSecondary}>
                A empresa ainda não tem administrador: o primeiro acesso é de administrador.
              </Text>
            ) : null}
          </View>
          <ReasonField
            value={reason}
            onChange={setReason}
            error={
              tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
            }
          />
        </>
      )}
    </Dialog>
  );
}

/**
 * Reenvio (novo link) ou correção de e-mail de um convite pendente: o convite anterior é
 * invalidado na mesma operação e a vaga passa ao novo, sem ocupar outra.
 */
function ReissueDialog({
  tenantId,
  invitation,
  mode,
  onClose,
}: {
  tenantId: string;
  invitation: Invitation;
  mode: 'resend' | 'email';
  onClose: () => void;
}) {
  const { api } = usePlatformApi();
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const target = normalized(email);
  const emailValid =
    mode === 'resend' || (emailSchema.safeParse(target).success && target !== invitation.email);
  const mutation = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/companies/{id}/invitations/{invitationId}/reissue', {
          params: { path: { id: tenantId, invitationId: invitation.id } },
          body: { ...(mode === 'email' ? { email: target } : {}), reason: reason.trim() },
        }),
      ),
    { onSuccess: (r) => setIssued({ email: r.invitation.email, token: r.token }) },
  );
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
            ? `O convite para ${invitation.email} deixa de funcionar e a mesma vaga passa ao e-mail correto.`
            : `Gera um novo link para ${invitation.email}, válido por 7 dias. O link anterior deixa de funcionar.`
      }
      onClose={mutation.isPending ? () => {} : onClose}
      actions={
        issued ? (
          <Button label="Concluir" variant="strong" onPress={onClose} />
        ) : (
          <>
            <Button
              label="Cancelar"
              variant="ghost"
              onPress={onClose}
              disabled={mutation.isPending}
            />
            <Button
              label={mode === 'email' ? 'Alterar e-mail' : 'Gerar novo link'}
              variant="strong"
              loading={mutation.isPending}
              onPress={() => {
                setTried(true);
                if (emailValid && validReason(reason)) mutation.mutate(undefined);
              }}
            />
          </>
        )
      }
    >
      {issued ? (
        <IssuedInviteCard email={issued.email} token={issued.token} onDone={onClose} />
      ) : (
        <>
          {mutation.isError ? (
            <Alert tone="danger" title="Convite não alterado">
              {accessError(mutation.error)}
            </Alert>
          ) : null}
          {mode === 'email' ? (
            <TextField
              label="E-mail correto"
              icon={Mail}
              value={email}
              onChangeText={setEmail}
              error={
                tried && !emailValid ? 'Informe um e-mail válido e diferente do atual.' : undefined
              }
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
            />
          ) : null}
          <ReasonField
            value={reason}
            onChange={setReason}
            error={
              tried && !validReason(reason) ? 'Informe o motivo (mínimo 3 caracteres).' : undefined
            }
          />
        </>
      )}
    </Dialog>
  );
}

function RevokeDialog({
  tenantId,
  invitation,
  onClose,
}: {
  tenantId: string;
  invitation: Invitation;
  onClose: () => void;
}) {
  const { api } = usePlatformApi();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const revoke = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/companies/{id}/invitations/{invitationId}/revoke', {
          params: { path: { id: tenantId, invitationId: invitation.id } },
          body: { reason: reason.trim() },
        }),
      ),
    {
      onSuccess: () => {
        toast.show('Convite revogado');
        onClose();
      },
    },
  );
  return (
    <ConfirmDialog
      visible
      title="Revogar convite?"
      description={`O convite para ${invitation.email} deixa de funcionar e a vaga reservada é liberada.`}
      confirmLabel="Revogar convite"
      loading={revoke.isPending}
      onCancel={onClose}
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
          {accessError(revoke.error)}
        </Alert>
      ) : null}
    </ConfirmDialog>
  );
}

const styles = StyleSheet.create({
  capacity: { gap: 2 },
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  field: { gap: space[2] },
  pad: { paddingHorizontal: space[4], paddingBottom: space[3] },
});
