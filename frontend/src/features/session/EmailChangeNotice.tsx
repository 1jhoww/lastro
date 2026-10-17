import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { authErrorMessage } from '@/auth/authErrors';
import { PasswordField } from '@/features/auth/PasswordField';
import { useSession } from '@/session/SessionContext';
import { space } from '@/theme';
import { Alert, Button, Dialog, Text, useToast } from '@/ui';

const key = (uid: string) => ['email-change', uid];

/**
 * Troca de e-mail solicitada pelo suporte do Lastro. Nada muda sem o titular: ele confirma
 * com a senha atual e o provedor de identidade envia um link ao novo endereço; o e-mail só
 * muda depois que esse link é aberto. No acesso seguinte, já com o novo e-mail verificado, o
 * Lastro registra a conclusão. Identidade, empresas e histórico continuam os mesmos.
 */
export function EmailChangeNotice() {
  const { api, user, gateway, signOut } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState(false);
  const completing = useRef(false);
  const change = useQuery({
    queryKey: key(user?.uid ?? ''),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => unwrap(api.GET('/api/v1/me/email-change')),
  });
  const pending = change.data?.emailChange ?? null;
  const complete = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/me/email-change/complete')),
    onSuccess: () => {
      toast.show('E-mail da conta atualizado');
      queryClient.invalidateQueries({ queryKey: key(user?.uid ?? '') });
    },
  });
  const applied =
    pending !== null &&
    user?.emailVerified === true &&
    user.email?.toLowerCase() === pending.newEmail;
  useEffect(() => {
    if (applied && !completing.current) {
      completing.current = true;
      complete.mutate();
    }
  }, [applied, complete]);

  if (!pending || pending.expired || applied) return null;
  return (
    <View style={styles.wrap}>
      <Alert
        tone="info"
        title="Troca de e-mail solicitada"
        action={
          sent ? (
            <Button label="Sair" size="sm" variant="outline" onPress={() => signOut()} />
          ) : (
            <Button
              label="Confirmar troca"
              size="sm"
              variant="strong"
              onPress={() => setConfirming(true)}
            />
          )
        }
      >
        {sent
          ? `Enviamos um link para ${pending.newEmail}. Abra-o para concluir a troca e depois entre novamente com o novo e-mail.`
          : `O suporte do Lastro solicitou trocar o e-mail da sua conta para ${pending.newEmail}. Se não reconhece este pedido, não confirme e fale com o suporte.`}
      </Alert>
      {confirming ? (
        <ConfirmEmailDialog
          newEmail={pending.newEmail}
          onClose={() => setConfirming(false)}
          onSent={() => {
            setConfirming(false);
            setSent(true);
          }}
          request={async (password) => {
            await gateway.reauthenticate(password);
            await gateway.requestEmailChange(pending.newEmail);
          }}
        />
      ) : null}
    </View>
  );
}

function ConfirmEmailDialog({
  newEmail,
  onClose,
  onSent,
  request,
}: {
  newEmail: string;
  onClose: () => void;
  onSent: () => void;
  request: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async () => {
    if (!password) return setFailure('Informe sua senha.');
    setBusy(true);
    setFailure(null);
    try {
      await request(password);
      onSent();
    } catch (e) {
      setFailure(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      visible
      title="Confirmar troca de e-mail"
      description={`Confirme sua senha atual. Enviaremos um link para ${newEmail}; o e-mail só muda depois que você abrir esse link.`}
      onClose={busy ? () => {} : onClose}
      actions={
        <>
          <Button label="Cancelar" variant="ghost" onPress={onClose} disabled={busy} />
          <Button label="Enviar link" variant="strong" loading={busy} onPress={submit} />
        </>
      }
    >
      {failure ? (
        <Alert tone="danger" title="Troca não confirmada">
          {failure}
        </Alert>
      ) : null}
      <PasswordField
        label="Senha atual"
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Text variant="small">
        Suas empresas, pedidos e histórico continuam os mesmos; só o e-mail de acesso muda.
      </Text>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space[4], paddingTop: space[3] },
});
