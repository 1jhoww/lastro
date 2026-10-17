import { useEffect, useState } from 'react';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { authErrorCode, authErrorMessage } from '@/auth/authErrors';
import { AuthFrame } from '@/features/auth/AuthFrame';
import { PasswordField } from '@/features/auth/PasswordField';
import {
  invitationToken,
  personName,
  signUpSchema,
  type SignUpValues,
} from '@/features/auth/schemas';
import { useUpdateMyName } from '@/features/session/profile';
import { inviteFailure } from '@/features/invitations/inviteErrors';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, Segmented, Text, TextField } from '@/ui';
import { Mail } from '@/ui/icons';

export default function AcceptInvitation() {
  const params = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const session = useSession();
  const { pendingInvite, setPendingInvite, user } = session;

  const [acceptedTenantId, setAcceptedTenantId] = useState<string | null>(null);

  // O token sai da barra de endereço e do histórico; fica só em memória enquanto o convite
  // estiver aberto.
  useEffect(() => {
    if (typeof params.token !== 'string') return;
    if (invitationToken.safeParse(params.token).success) setPendingInvite(params.token);
    router.replace('/convite');
  }, [params.token, router, setPendingInvite]);

  // Depois do aceite, só navega quando a sessão já estiver dentro da nova empresa: antes disso
  // a área da empresa ainda está protegida e a navegação seria recusada.
  const inNewTenant =
    acceptedTenantId !== null &&
    session.gate.kind === 'tenant' &&
    session.tenantId === acceptedTenantId;
  useEffect(() => {
    if (!inNewTenant) return;
    setPendingInvite(null);
    router.replace('/');
  }, [inNewTenant, router, setPendingInvite]);

  const token = pendingInvite;
  const urlToken = typeof params.token === 'string' ? params.token : null;

  let body;
  if (acceptedTenantId)
    body = (
      <Alert tone="success" title="Convite aceito">
        Abrindo a empresa.
      </Alert>
    );
  else if (!token && !urlToken) body = <MissingToken />;
  else if (!token)
    body = null; // aguardando o efeito acima guardar o token
  else if (!user) body = <SignedOutStep />;
  else body = <SignedInStep token={token} onAccepted={setAcceptedTenantId} />;

  return (
    <AuthFrame>
      <View style={styles.headings}>
        <Text variant="h1" accessibilityRole="header">
          Convite para o Lastro
        </Text>
        <Text variant="body" color={color.textSecondary}>
          Aceite para acessar a empresa que convidou você.
        </Text>
      </View>
      {body}
    </AuthFrame>
  );
}

function MissingToken() {
  return (
    <Alert tone="danger" title="Link de convite incompleto">
      Abra o link exatamente como recebeu. Se ele foi cortado, peça um novo ao administrador.
    </Alert>
  );
}

/** Sem login: criar conta com o e-mail convidado ou entrar numa conta existente. */
function SignedOutStep() {
  const [mode, setMode] = useState<'create' | 'existing'>('create');
  return (
    <View style={styles.stack}>
      <Segmented
        label="Você já tem conta no Lastro?"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'create', label: 'Criar conta' },
          { value: 'existing', label: 'Já tenho conta' },
        ]}
      />
      {mode === 'create' ? (
        <CreateAccountForm onExisting={() => setMode('existing')} />
      ) : (
        <View style={styles.stack}>
          <Text variant="body" color={color.textSecondary}>
            Entre com a conta do e-mail convidado. Depois do login, você volta para este convite.
          </Text>
          <Link href="/entrar" asChild>
            <Button label="Entrar para aceitar" size="lg" fullWidth />
          </Link>
        </View>
      )}
    </View>
  );
}

function CreateAccountForm({ onExisting }: { onExisting: () => void }) {
  const { gateway, api } = useSession();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<{ message: string; existing: boolean } | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '', confirm: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = handleSubmit(async ({ name, email, password }) => {
    setFailure(null);
    try {
      await gateway.createAccount(email, password);
      // O nome fica no cadastro da pessoa (fonte do /me e da lista de usuários). Uma falha aqui
      // não impede o convite: o nome pode ser informado depois em "Conta".
      await unwrap(api.PATCH('/api/v1/me', { body: { name } }))
        .then(() => queryClient.invalidateQueries({ queryKey: ['me'] }))
        .catch(() => {});
      // O backend só aceita convites de e-mail verificado.
      await gateway.sendEmailVerification().catch(() => {});
    } catch (e) {
      setFailure({
        message: authErrorMessage(e),
        existing: authErrorCode(e) === 'auth/email-already-in-use',
      });
    }
  });

  return (
    <View style={styles.stack}>
      {failure ? (
        <Alert
          tone={failure.existing ? 'warning' : 'danger'}
          title={failure.existing ? 'Você já tem uma conta' : 'Não foi possível criar a conta'}
          action={
            failure.existing ? (
              <Button
                label="Entrar com minha conta"
                size="sm"
                variant="outline"
                onPress={onExisting}
              />
            ) : null
          }
        >
          {failure.message}
        </Alert>
      ) : null}
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextField
            label="Seu nome"
            hint="Nome e sobrenome, como você quer ser chamado no Lastro."
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.name?.message}
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
          />
        )}
      />
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextField
            label="E-mail convidado"
            hint="Use exatamente o e-mail que recebeu o convite."
            icon={Mail}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.email?.message}
            autoComplete="email"
            textContentType="username"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <PasswordField
            label="Senha"
            hint="Pelo menos 8 caracteres."
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.password?.message}
            autoComplete="new-password"
            textContentType="newPassword"
          />
        )}
      />
      <Controller
        control={control}
        name="confirm"
        render={({ field }) => (
          <PasswordField
            label="Repita a senha"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.confirm?.message}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />
        )}
      />
      <Button label="Criar conta" size="lg" fullWidth loading={isSubmitting} onPress={onSubmit} />
    </View>
  );
}

/** Logado: confirmar e-mail (se preciso) e aceitar. */
function SignedInStep({
  token,
  onAccepted,
}: {
  token: string;
  onAccepted: (tenantId: string) => void;
}) {
  const router = useRouter();
  const session = useSession();
  const { gateway, user, api } = session;
  const [verified, setVerified] = useState(user?.emailVerified ?? false);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Conta criada antes de o cadastro pedir nome: completa aqui, antes de entrar na empresa.
  const needsName = session.me !== undefined && !session.me.name;
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const saveName = useUpdateMyName();

  const accept = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/users/invitations/accept', { body: { token } })),
    onSuccess: async (result) => {
      session.selectTenant(result.tenantId);
      await session.refetchMe();
      onAccepted(result.tenantId);
    },
  });

  const checkVerified = async () => {
    setChecking(true);
    setVerifyNote(null);
    try {
      const fresh = await gateway.reloadUser();
      if (fresh?.emailVerified) setVerified(true);
      else setVerifyNote('Ainda não confirmado. Abra o link do e-mail e toque aqui de novo.');
    } catch (e) {
      setVerifyNote(authErrorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const resend = async () => {
    setVerifyNote(null);
    try {
      await gateway.sendEmailVerification();
      setVerifyNote('Enviamos um novo link de confirmação.');
    } catch (e) {
      setVerifyNote(authErrorMessage(e));
    }
  };

  const useOtherAccount = async () => {
    await session.signOut();
  };

  if (!verified) {
    return (
      <View style={styles.stack}>
        <Alert tone="info" title="Confirme seu e-mail">
          {`Enviamos um link para ${user?.email ?? 'seu e-mail'}. Confirme e volte aqui para aceitar o convite.`}
        </Alert>
        <Button
          label="Já confirmei"
          size="lg"
          fullWidth
          loading={checking}
          onPress={checkVerified}
        />
        <View style={styles.row}>
          <Button label="Reenviar e-mail" variant="ghost" size="sm" onPress={resend} />
          <Button label="Usar outra conta" variant="ghost" size="sm" onPress={useOtherAccount} />
        </View>
        {/* Abaixo dos botões: a mensagem não empurra o botão sob o dedo/cursor. */}
        {verifyNote ? (
          <Text variant="small" color={color.textSecondary} accessibilityLiveRegion="polite">
            {verifyNote}
          </Text>
        ) : null}
      </View>
    );
  }

  const failure = accept.isError ? inviteFailure(accept.error, user?.email ?? null) : null;

  return (
    <View style={styles.stack}>
      <Text variant="body">
        Você vai entrar como <Text variant="bodyStrong">{user?.email}</Text>.
      </Text>
      {needsName ? (
        <TextField
          label="Seu nome"
          hint="Nome e sobrenome, como você quer ser chamado no Lastro."
          value={name}
          onChangeText={setName}
          error={nameError ?? undefined}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
        />
      ) : null}
      {failure ? (
        <Alert
          tone="danger"
          title={failure.title}
          action={
            failure.alreadyMember ? (
              <Button
                label="Ir para o Lastro"
                size="sm"
                variant="outline"
                onPress={() => {
                  session.setPendingInvite(null);
                  router.replace('/');
                }}
              />
            ) : null
          }
        >
          {failure.body}
        </Alert>
      ) : null}
      {failure && !failure.retry ? null : (
        <Button
          label="Aceitar convite"
          size="lg"
          fullWidth
          loading={accept.isPending || saveName.isPending}
          onPress={async () => {
            if (needsName) {
              const parsed = personName.safeParse(name);
              if (!parsed.success) {
                setNameError(parsed.error.issues[0]?.message ?? 'Informe seu nome.');
                return;
              }
              setNameError(null);
              try {
                await saveName.mutateAsync(parsed.data);
              } catch {
                setNameError('Não foi possível salvar o nome. Tente novamente.');
                return;
              }
            }
            accept.mutate();
          }}
        />
      )}
      <View style={styles.row}>
        <Button label="Usar outra conta" variant="ghost" size="sm" onPress={useOtherAccount} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headings: { gap: space[2] },
  stack: { gap: space[4] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginLeft: -space[3] },
});
