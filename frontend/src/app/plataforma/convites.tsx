import { useState } from 'react';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { OwnerInvitationRow } from '@/api/types';
import { invitationLink } from '@/features/invitations/inviteLink';
import { IssuedInviteCard } from '@/features/invitations/IssuedInviteCard';
import { useOwnerInvitations, usePlatformApi } from '@/features/platform/api';
import { planLabel } from '@/features/platform/copy';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { LoadError, LoadingRows } from '@/features/platform/PlatformParts';
import { usePlatformMutation } from '@/features/platform/platformQuery';
import { formatDate } from '@/lib/dates';
import { newIdempotencyKey } from '@/lib/idempotency';
import { color, space } from '@/theme';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Panel, Text, TextField } from '@/ui';
import { Copy, Mail, Plus, RefreshCw } from '@/ui/icons';

/**
 * Convites de novas empresas: cada empresa criada aguarda o primeiro administrador aceitar o
 * convite. O link vigente pode ser copiado de novo; convite vencido ou perdido é renovado.
 */
export default function PlatformInvitations() {
  const invitations = useOwnerInvitations();
  const [renewing, setRenewing] = useState<OwnerInvitationRow | null>(null);
  const [issued, setIssued] = useState<{ email: string; token: string } | null>(null);
  const items = invitations.data?.items ?? [];

  return (
    <>
      <PlatformHeader
        title="Convites"
        description="Empresas aguardando o primeiro administrador. Para criar, reenviar ou corrigir convites de empresas já ativas, abra a empresa em Empresas. O Lastro não envia e-mail: repasse o link por um canal seguro."
        action={
          <Link href="/plataforma/nova-empresa" asChild>
            <Button label="Nova empresa e convite" icon={Plus} variant="strong" />
          </Link>
        }
      />
      {issued ? (
        <IssuedInviteCard
          email={issued.email}
          token={issued.token}
          onDone={() => setIssued(null)}
        />
      ) : null}
      {invitations.isError ? (
        <LoadError
          title="Não foi possível carregar os convites"
          error={invitations.error}
          onRetry={() => invitations.refetch()}
        />
      ) : null}
      <Panel flush>
        {invitations.isPending ? (
          <LoadingRows />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="Nenhuma empresa aguardando administrador"
            description="Todas as empresas criadas já têm o primeiro administrador."
          />
        ) : (
          items.map((row, i) => (
            <InvitationRow
              key={row.tenantId}
              row={row}
              last={i === items.length - 1}
              onRenew={() => setRenewing(row)}
            />
          ))
        )}
      </Panel>
      {renewing ? (
        <RenewDialog
          row={renewing}
          onClose={() => setRenewing(null)}
          onIssued={(email, token) => {
            setRenewing(null);
            setIssued({ email, token });
          }}
        />
      ) : null}
    </>
  );
}

function InvitationRow({
  row,
  last,
  onRenew,
}: {
  row: OwnerInvitationRow;
  last: boolean;
  onRenew: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const inv = row.invitation;
  const badge = !inv
    ? { label: 'Sem convite', tone: 'neutral' as const }
    : inv.status === 'revoked'
      ? { label: 'Revogado', tone: 'neutral' as const }
      : inv.expired
        ? { label: 'Vencido', tone: 'warning' as const }
        : { label: 'Pendente', tone: 'accent' as const };
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={styles.copy}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {row.tenantName}
        </Text>
        <Text variant="small" color={color.textSecondary}>
          {`${planLabel(row.planCode)} · criada ${formatDate(row.createdAt)}${
            inv ? ` · ${inv.email} · vence ${formatDate(inv.expiresAt)}` : ''
          }`}
        </Text>
      </View>
      <Badge {...badge} />
      <View style={styles.actions}>
        {inv?.token ? (
          <Button
            label={copied ? 'Link copiado' : 'Copiar link'}
            size="sm"
            variant="outline"
            icon={Copy}
            onPress={async () => {
              await Clipboard.setStringAsync(invitationLink(inv.token as string));
              setCopied(true);
            }}
          />
        ) : null}
        <Button
          label="Renovar convite"
          size="sm"
          variant="ghost"
          icon={RefreshCw}
          onPress={onRenew}
        />
      </View>
    </View>
  );
}

/** Novo convite substitui os pendentes da empresa; a chave de intenção evita duplicar na rede. */
function RenewDialog({
  row,
  onClose,
  onIssued,
}: {
  row: OwnerInvitationRow;
  onClose: () => void;
  onIssued: (email: string, token: string) => void;
}) {
  const { api } = usePlatformApi();
  const [email, setEmail] = useState(row.invitation?.email ?? '');
  const [key, setKey] = useState(newIdempotencyKey);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const renew = usePlatformMutation(
    () =>
      unwrap(
        api.POST('/api/v1/admin/tenants/{id}/owner-invitations', {
          params: { path: { id: row.tenantId }, header: { 'Idempotency-Key': key } },
          body: { ownerEmail: email.trim().toLowerCase(), expectedVersion: row.tenantVersion },
        }),
      ),
    { onSuccess: (result) => onIssued(result.invitation.email, result.token) },
  );
  return (
    <ConfirmDialog
      visible
      title={`Renovar convite de ${row.tenantName}`}
      description="Os convites pendentes desta empresa deixam de valer e um novo link é gerado, válido por 7 dias."
      confirmLabel="Gerar novo convite"
      tone="strong"
      loading={renew.isPending}
      onCancel={onClose}
      onConfirm={() => {
        if (valid) renew.mutate(undefined);
      }}
    >
      <TextField
        label="E-mail do primeiro administrador"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setKey(newIdempotencyKey());
        }}
        inputMode="email"
        autoCapitalize="none"
        autoCorrect={false}
        error={email && !valid ? 'E-mail inválido.' : undefined}
      />
      {renew.isError ? (
        <Alert tone="danger" title="Convite não renovado">
          {toApiError(renew.error).userMessage}
        </Alert>
      ) : null}
    </ConfirmDialog>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  copy: { flex: 1, minWidth: 220, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
});
