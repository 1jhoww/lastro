import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { authErrorCode, authErrorMessage } from '@/auth/authErrors';
import { AccountFrame } from '@/features/session/AccountFrame';
import { EmailChangeNotice } from '@/features/session/EmailChangeNotice';
import { NameEditor } from '@/features/session/NameEditor';
import { Screen } from '@/layout/Screen';
import { roleLabel, tenantHeader, useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, Panel, Skeleton, Text } from '@/ui';
import { ArrowLeft, Lock, LogOut } from '@/ui/icons';

/** Identidade Firebase e dados de /me, disponível mesmo sem empresa ativa. */
export default function MyProfile() {
  const session = useSession();
  const inCompany = session.gate.kind === 'tenant';
  const content = <ProfileContent />;
  if (inCompany) {
    return <Screen title="Meu Perfil" description="Dados da sua identidade e acesso.">{content}</Screen>;
  }
  return <AccountFrame title="Meu Perfil" description="Dados da sua identidade e acesso.">{content}</AccountFrame>;
}

function ProfileContent() {
  const session = useSession();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const gate = session.gate;
  const membership = gate.kind === 'tenant' || gate.kind === 'tenantBlocked' ? gate.membership : null;
  const company = useQuery({
    queryKey: queryKeys.tenantCurrent(membership?.tenantId ?? ''),
    enabled: membership?.access === 'allowed',
    queryFn: () =>
      unwrap(session.apiFor(membership!.tenantId).GET('/api/v1/tenants/current', {
        params: { header: tenantHeader(membership!.tenantId) },
      })),
    staleTime: 5 * 60_000,
  });
  const email = session.user?.email ?? session.me?.email ?? null;
  const changePassword = async () => {
    if (!email || sending) return;
    setFailure(null);
    setSending(true);
    try {
      await session.gateway.sendPasswordReset(email);
      setSent(true);
    } catch (error) {
      if (authErrorCode(error) === 'auth/user-not-found') setSent(true);
      else setFailure(authErrorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <View style={styles.back}>
        <Link href={gate.kind === 'tenant' ? '/' : gate.kind === 'chooseTenant' ? '/empresas' : gate.kind === 'tenantBlocked' ? '/acesso-bloqueado' : gate.kind === 'noTenant' && gate.platformAdmin ? '/plataforma' : '/sem-empresa'} asChild>
          <Button label="Voltar" variant="ghost" size="sm" icon={ArrowLeft} />
        </Link>
      </View>
      <Panel title="Identidade">
        <View style={styles.fields}>
          <ProfileField label="Nome" value={session.me?.name || 'Não informado'} />
          <ProfileField label="E-mail de acesso" value={email || 'Não informado'} />
          <View style={styles.action}><NameEditor variant="outline" /></View>
        </View>
      </Panel>
      <Panel title="Acesso atual">
        <View style={styles.fields}>
          <ProfileField
            label="Empresa"
            value={membership?.access === 'allowed' && company.isPending ? <Skeleton width={180} height={18} /> : membership?.access === 'allowed' ? company.data?.name ?? 'Nome indisponível' : membership ? 'Empresa indisponível' : 'Nenhuma empresa selecionada'}
          />
          <ProfileField
            label="Função"
            value={membership ? roleLabel[membership.role] : session.isPlatformAdmin ? 'Super Admin Lastro' : 'Sem função ativa'}
          />
          {company.isError ? (
            <Alert tone="warning" title="Empresa indisponível" action={<Button label="Tentar novamente" size="sm" variant="outline" onPress={() => company.refetch()} />}>
              Não foi possível atualizar o nome da empresa.
            </Alert>
          ) : null}
        </View>
      </Panel>
      <Panel title="Segurança" description="Sua senha e seu e-mail são gerenciados pelo Firebase.">
        <View style={styles.fields}>
          <Text variant="small" color={color.textSecondary}>
            Enviaremos ao seu e-mail um link seguro para criar outra senha.
          </Text>
          {sent ? <Alert tone="success" title="Confira seu e-mail">O link para alterar sua senha foi enviado. Veja também a caixa de spam.</Alert> : null}
          {failure ? <Alert tone="danger" title="Não foi possível enviar o link">{failure}</Alert> : null}
          <View style={styles.action}>
            <Button label={sent ? 'Enviar link novamente' : 'Alterar senha'} icon={Lock} variant="outline" loading={sending} disabled={!email} onPress={changePassword} />
          </View>
          <Text variant="small" color={color.textSecondary}>
            A alteração de e-mail depende de solicitação do suporte. Quando houver uma solicitação, confirme aqui com sua senha atual.
          </Text>
          <EmailChangeNotice />
        </View>
      </Panel>
      {gate.kind === 'tenant' ? (
        <View style={styles.action}>
          <Button label="Sair" variant="outline" icon={LogOut} onPress={session.signOut} />
        </View>
      ) : null}
    </>
  );
}

function ProfileField({ label, value }: { label: string; value: string | ReactNode }) {
  return (
    <View style={styles.field}>
      <Text variant="small" color={color.textSecondary}>{label}</Text>
      {typeof value === 'string' ? <Text variant="bodyStrong" selectable>{value}</Text> : value}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start', marginLeft: -space[3] },
  fields: { gap: space[4] },
  field: { gap: space[1] },
  action: { alignItems: 'flex-start' },
});
