import { useRef, useState } from 'react';
import { Link } from 'expo-router';
import { StyleSheet, View, type TextInput } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { authErrorMessage } from '@/auth/authErrors';
import { AuthFrame } from '@/features/auth/AuthFrame';
import { PasswordField } from '@/features/auth/PasswordField';
import { signInSchema, type SignInValues } from '@/features/auth/schemas';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, Text, TextField } from '@/ui';
import { Mail } from '@/ui/icons';

export default function SignIn() {
  const { gateway, notice, clearNotice, pendingInvite } = useSession();
  const [failure, setFailure] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
    // Valida no envio: erro surgindo no blur deslocaria o botão sob o cursor e perderia o clique.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  // Sucesso não navega daqui: a sessão muda e o roteamento leva à empresa, à escolha de
  // empresa, à plataforma ou de volta ao convite pendente.
  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFailure(null);
    clearNotice();
    try {
      await gateway.signIn(email, password);
    } catch (e) {
      setFailure(authErrorMessage(e));
    }
  });

  return (
    <AuthFrame>
      <View style={styles.headings}>
        <Text variant="h1" accessibilityRole="header">
          Entrar
        </Text>
        <Text variant="body" color={color.textSecondary}>
          {pendingInvite
            ? 'Entre com a conta do e-mail convidado para aceitar o convite.'
            : 'Use o e-mail do convite que você recebeu.'}
        </Text>
      </View>

      {notice === 'expired' ? (
        <Alert tone="warning" title="Sua sessão terminou">
          Por segurança, entre novamente para continuar.
        </Alert>
      ) : null}
      {failure ? (
        <Alert tone="danger" title="Não foi possível entrar">
          {failure}
        </Alert>
      ) : null}

      <View style={styles.fields}>
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
              error={errors.email?.message}
              autoComplete="email"
              textContentType="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              submitBehavior="submit"
              editable={!isSubmitting}
            />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <PasswordField
              ref={passwordRef}
              label="Senha"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={errors.password?.message}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={onSubmit}
              editable={!isSubmitting}
            />
          )}
        />
        <Link href="/recuperar-senha" style={styles.link}>
          <Text variant="smallStrong" style={styles.underline}>
            Esqueci minha senha
          </Text>
        </Link>
      </View>

      <Button label="Entrar" size="lg" fullWidth loading={isSubmitting} onPress={onSubmit} />
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  headings: { gap: space[2] },
  fields: { gap: space[4] },
  link: { alignSelf: 'flex-start', paddingVertical: space[1] },
  underline: { textDecorationLine: 'underline' },
});
