import { useState } from 'react';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { IssuedInviteCard } from '@/features/invitations/IssuedInviteCard';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { usePlatformQuery } from '@/features/platform/platformQuery';
import { useIntentKey } from '@/lib/idempotency';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, radius, space } from '@/theme';
import { Alert, Button, Panel, Skeleton, Text, TextField } from '@/ui';
import { ArrowLeft, Building, Check, Mail } from '@/ui/icons';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';

const schema = z.object({
  name: z.string().trim().min(2, 'Use pelo menos 2 caracteres.').max(120, 'Nome longo demais.'),
  planId: z.string().min(1, 'Escolha um plano.'),
  ownerEmail: z
    .string()
    .trim()
    .min(1, 'Informe o e-mail do administrador.')
    .pipe(z.email('E-mail inválido.')),
});
type Values = z.infer<typeof schema>;

/**
 * Cria empresa + assinatura + convite do primeiro administrador numa só operação do backend.
 * A Idempotency-Key é mantida enquanto o formulário não muda: repetir após falha de rede não
 * cria uma segunda empresa.
 */
export default function NewTenant() {
  const { api, user } = useSession();
  const uid = user?.uid ?? '';
  const queryClient = useQueryClient();
  const intent = useIntentKey();
  const [created, setCreated] = useState<{ email: string; token: string; name: string } | null>(
    null,
  );
  const plans = usePlatformQuery(queryKeys.platform(uid, 'plans'), () =>
    unwrap(api.GET('/api/v1/admin/plans', { params: { query: { limit: '100' } } })),
  );
  const active = plans.data?.items.filter((p) => p.status === 'active') ?? [];

  const { control, handleSubmit, formState, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', planId: '', ownerEmail: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const create = useMutation({
    mutationFn: (v: Values) =>
      unwrap(
        api.POST('/api/v1/admin/tenants', {
          params: { header: { 'Idempotency-Key': intent.current() } },
          body: { name: v.name, planId: v.planId, ownerEmail: v.ownerEmail.toLowerCase() },
        }),
      ),
    onSuccess: (result) => {
      intent.reset();
      setCreated({
        name: result.tenant.name,
        email: result.ownerInvitation.invitation.email,
        token: result.ownerInvitation.token,
      });
      reset();
      queryClient.invalidateQueries({ queryKey: queryKeys.platformRoot });
    },
  });
  const onSubmit = handleSubmit((v) => create.mutate(v));
  // Conteúdo mudou = nova intenção = nova chave.
  const changed = () => intent.reset();

  return (
    <>
      <View style={styles.back}>
        <Link href="/plataforma" asChild>
          <Button label="Empresas" variant="ghost" size="sm" icon={ArrowLeft} />
        </Link>
      </View>
      <PlatformHeader
        title="Nova empresa"
        description="A empresa fica aguardando até o primeiro administrador aceitar o convite."
      />
      {created ? (
        <IssuedInviteCard
          email={created.email}
          token={created.token}
          onDone={() => setCreated(null)}
        />
      ) : null}
      <Panel>
        <View style={styles.form}>
          {create.isError ? (
            <Alert tone="danger" title="Empresa não criada">
              {toApiError(create.error).userMessage}
            </Alert>
          ) : null}
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <TextField
                label="Nome da empresa"
                icon={Building}
                value={field.value}
                onChangeText={(v) => {
                  changed();
                  field.onChange(v);
                }}
                onBlur={field.onBlur}
                error={formState.errors.name?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="ownerEmail"
            render={({ field }) => (
              <TextField
                label="E-mail do primeiro administrador"
                hint="Recebe o convite. Precisa confirmar este e-mail para aceitar."
                icon={Mail}
                value={field.value}
                onChangeText={(v) => {
                  changed();
                  field.onChange(v);
                }}
                onBlur={field.onBlur}
                error={formState.errors.ownerEmail?.message}
                inputMode="email"
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
          />
          <Controller
            control={control}
            name="planId"
            render={({ field }) => (
              <View style={styles.plans} accessibilityRole="radiogroup" accessibilityLabel="Plano">
                <Text variant="smallStrong">Plano</Text>
                {plans.isPending ? <Skeleton width="60%" height={44} /> : null}
                {active.map((p) => {
                  const selected = field.value === p.id;
                  return (
                    <Touchable
                      key={p.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        changed();
                        field.onChange(p.id);
                      }}
                      pressStyle={(s: InteractionState) => [
                        styles.plan,
                        selected && styles.planSelected,
                        showFocusRing(s) && focusRing(),
                      ]}
                    >
                      <View style={styles.planCopy}>
                        <Text variant="bodyStrong">{p.name}</Text>
                        <Text variant="small" color={color.textSecondary}>
                          {`${formatCents(p.monthlyPriceCents)} por mês, até ${p.userLimit} usuários`}
                        </Text>
                      </View>
                      {selected ? <Check size={18} color={color.text} /> : null}
                    </Touchable>
                  );
                })}
                {formState.errors.planId ? (
                  <Text variant="small" color={color.danger}>
                    {formState.errors.planId.message}
                  </Text>
                ) : null}
              </View>
            )}
          />
          <View>
            <Button
              label="Criar empresa e convite"
              variant="strong"
              loading={create.isPending}
              onPress={onSubmit}
            />
          </View>
        </View>
      </Panel>
    </>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start', marginLeft: -space[3] },
  form: { gap: space[5], paddingTop: space[4] },
  plans: { gap: space[2] },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  planSelected: { borderColor: color.text, borderWidth: 2, padding: space[4] - 1 },
  planCopy: { flex: 1, gap: 2 },
});
