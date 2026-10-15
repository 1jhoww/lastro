import { useState } from 'react';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { authErrorCode, authErrorMessage } from '@/auth/authErrors';
import { AuthFrame } from '@/features/auth/AuthFrame';
import { resetSchema, type ResetValues } from '@/features/auth/schemas';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, Text, TextField } from '@/ui';
import { ArrowLeft, Mail } from '@/ui/icons';

export default function ResetPassword() {
  const { gateway } = useSession();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { email: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFailure(null);
    try {
      await gateway.sendPasswordReset(email);
      setSentTo(email);
    } catch (e) {
      // Não revelar se o e-mail tem conta: "usuário inexistente" recebe a mesma confirmação.
      if (authErrorCode(e) === 'auth/user-not-found') setSentTo(email);
      else setFailure(authErrorMessage(e));
    }
  });

  return (
    <AuthFrame>
      <View style={styles.back}>
        <Link href="/entrar" asChild>
          <Button label="Voltar para entrar" variant="ghost" size="sm" icon={ArrowLeft} />
        </Link>
      </View>
      <View style={styles.headings}>
        <Text variant="h1" accessibilityRole="header">
          Recuperar senha
        </Text>
        <Text variant="body" color={color.textSecondary}>
          Enviaremos um link para criar uma nova senha.
        </Text>
      </View>
      {sentTo ? (
        <Alert tone="success" title="Confira seu e-mail">
          {`Se houver uma conta para ${sentTo}, o link chega em alguns minutos. Veja também a caixa de spam.`}
        </Alert>
      ) : null}
      {failure ? (
        <Alert tone="danger" title="Não foi possível enviar">
          {failure}
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
            error={errors.email?.message}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={onSubmit}
          />
        )}
      />
      <Button
        label={sentTo ? 'Enviar de novo' : 'Enviar link'}
        size="lg"
        fullWidth
        loading={isSubmitting}
        onPress={onSubmit}
      />
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  headings: { gap: space[2] },
  back: { alignItems: 'flex-start', marginLeft: -space[3] },
});
