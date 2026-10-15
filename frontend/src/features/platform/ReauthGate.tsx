import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { authErrorMessage } from '@/auth/authErrors';
import { PasswordField } from '@/features/auth/PasswordField';
import { reauthSchema, type ReauthValues } from '@/features/auth/schemas';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, Panel, Skeleton, Text } from '@/ui';

/**
 * O backend só aceita rotas da plataforma até 5 minutos depois de um login com senha
 * (claim `auth_time`). Antes de montar a área, e quando a janela fecha, pedimos a senha de novo.
 *
 * A janela local usa 4min30s para não disparar chamadas que o servidor recusaria por segundos.
 */
export const RECENT_AUTH_SECONDS = 270;

type ReauthApi = { requireReauth: () => void };
const ReauthContext = createContext<ReauthApi>({ requireReauth: () => {} });
export const useReauth = () => useContext(ReauthContext);

export function ReauthGate({
  children,
  description = 'A área da plataforma exige login recente.',
}: {
  children: ReactNode;
  description?: string;
}) {
  const { gateway } = useSession();
  const [state, setState] = useState<'checking' | 'fresh' | 'stale'>('checking');
  const [freshUntil, setFreshUntil] = useState(0);

  // Lê auth_time do token atual e decide se a janela de login recente ainda vale.
  useEffect(() => {
    if (state !== 'checking') return;
    let active = true;
    gateway
      .authTime()
      .catch(() => null)
      .then((t) => {
        if (!active) return;
        const until = t === null ? 0 : (t + RECENT_AUTH_SECONDS) * 1000;
        if (until <= Date.now()) setState('stale');
        else {
          setFreshUntil(until);
          setState('fresh');
        }
      });
    return () => {
      active = false;
    };
  }, [state, gateway]);

  // Quando a janela fecha, pede a senha de novo antes da próxima chamada.
  useEffect(() => {
    if (state !== 'fresh') return;
    const timer = setTimeout(() => setState('stale'), Math.max(0, freshUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [state, freshUntil]);

  const requireReauth = useCallback(() => setState('stale'), []);

  if (state === 'checking')
    return (
      <View style={styles.pad}>
        <Skeleton width="40%" height={20} />
      </View>
    );
  if (state === 'stale')
    return <ReauthForm description={description} onDone={() => setState('checking')} />;
  return <ReauthContext.Provider value={{ requireReauth }}>{children}</ReauthContext.Provider>;
}

function ReauthForm({ onDone, description }: { onDone: () => void; description: string }) {
  const { gateway, user } = useSession();
  const [failure, setFailure] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<ReauthValues>({
    resolver: zodResolver(reauthSchema),
    defaultValues: { password: '' },
    mode: 'onSubmit',
  });
  const onSubmit = handleSubmit(async ({ password }) => {
    setFailure(null);
    try {
      await gateway.reauthenticate(password);
      onDone();
    } catch (e) {
      setFailure(authErrorMessage(e));
    }
  });

  return (
    <View style={styles.pad}>
      <Panel title="Confirme sua senha" description={description}>
        <View style={styles.form}>
          <Text variant="small" color={color.textSecondary}>
            {`Por segurança, o acesso vale por alguns minutos. Conta: ${user?.email ?? ''}`}
          </Text>
          {failure ? (
            <Alert tone="danger" title="Senha não confirmada">
              {failure}
            </Alert>
          ) : null}
          <Controller
            control={control}
            name="password"
            render={({ field }) => (
              <PasswordField
                label="Senha"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={formState.errors.password?.message}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={onSubmit}
              />
            )}
          />
          <View>
            <Button
              label="Confirmar"
              variant="strong"
              loading={formState.isSubmitting}
              onPress={onSubmit}
            />
          </View>
        </View>
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: space[6], width: '100%', maxWidth: 520, alignSelf: 'center' },
  form: { gap: space[4], paddingTop: space[2] },
});
