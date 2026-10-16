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
import { addDays } from '@/lib/calendar';
import { IssuedInviteCard } from '@/features/invitations/IssuedInviteCard';
import { todayIn } from '@/features/orders/rules';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { usePlatformQuery } from '@/features/platform/platformQuery';
import { useIntentKey } from '@/lib/idempotency';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, radius, space } from '@/theme';
import { Alert, Button, CurrencyInput, DateField, Panel, Skeleton, Text, TextField } from '@/ui';
import { ArrowLeft, Building, Check, Mail } from '@/ui/icons';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';

/** Datas de cobrança seguem o fuso de operação do Lastro, como no backend. */
const BILLING_TIMEZONE = 'America/Sao_Paulo';

const schema = z.object({
  name: z.string().trim().min(2, 'Use pelo menos 2 caracteres.').max(120, 'Nome longo demais.'),
  planCode: z.enum(['essencial', 'profissional'], { error: 'Escolha um plano.' }),
  ownerEmail: z
    .string()
    .trim()
    .min(1, 'Informe o e-mail do administrador.')
    .pipe(z.email('E-mail inválido.')),
  monthlyPriceCents: z.number().int().min(0),
  billingDay: z
    .string()
    .trim()
    .regex(/^(?:[1-9]|1[0-9]|2[0-8])$/, 'Use um dia entre 1 e 28.'),
  billingStartsOn: z.string().min(1, 'Informe o início da cobrança.'),
});
type Values = z.input<typeof schema>;

/**
 * Cria empresa + assinatura + convite do primeiro administrador numa só operação do backend.
 * O plano vem do catálogo oficial; o valor começa no preço de referência e pode ser negociado.
 * A Idempotency-Key é mantida enquanto o formulário não muda: repetir após falha de rede não
 * cria uma segunda empresa.
 */
export default function NewTenant() {
  const { api, user } = useSession();
  const uid = user?.uid ?? '';
  const queryClient = useQueryClient();
  const intent = useIntentKey();
  const today = todayIn(BILLING_TIMEZONE);
  const [created, setCreated] = useState<{ email: string; token: string; name: string } | null>(
    null,
  );
  const catalog = usePlatformQuery(queryKeys.platform(uid, 'plan-catalog'), () =>
    unwrap(api.GET('/api/v1/admin/plan-catalog')),
  );
  const offered = catalog.data?.items.filter((p) => p.offered) ?? [];

  const { control, handleSubmit, formState, reset, setValue } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      ownerEmail: '',
      monthlyPriceCents: 0,
      billingDay: '10',
      billingStartsOn: today,
    },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const create = useMutation({
    mutationFn: (v: z.output<typeof schema>) =>
      unwrap(
        api.POST('/api/v1/admin/tenants', {
          params: { header: { 'Idempotency-Key': intent.current() } },
          body: {
            name: v.name,
            ownerEmail: v.ownerEmail.toLowerCase(),
            planCode: v.planCode,
            monthlyPriceCents: v.monthlyPriceCents,
            billingDay: Number(v.billingDay),
            billingStartsOn: v.billingStartsOn,
          },
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
  const onSubmit = handleSubmit((v) => create.mutate(schema.parse(v)));
  // Conteúdo mudou = nova intenção = nova chave.
  const changed = () => intent.reset();

  return (
    <>
      <View style={styles.back}>
        <Link href="/plataforma/convites" asChild>
          <Button label="Convites" variant="ghost" size="sm" icon={ArrowLeft} />
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
            name="planCode"
            render={({ field }) => (
              <View style={styles.plans} accessibilityRole="radiogroup" accessibilityLabel="Plano">
                <Text variant="smallStrong">Plano</Text>
                {catalog.isPending ? <Skeleton width="60%" height={44} /> : null}
                {catalog.isError && toApiError(catalog.error).code !== 'FORBIDDEN' ? (
                  <Alert tone="danger" title="Planos indisponíveis">
                    {toApiError(catalog.error).userMessage}
                  </Alert>
                ) : null}
                {offered.map((p) => {
                  const selected = field.value === p.code;
                  return (
                    <Touchable
                      key={p.code}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={p.name}
                      onPress={() => {
                        changed();
                        field.onChange(p.code);
                        setValue('monthlyPriceCents', p.referencePriceCents);
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
                          {`${formatCents(p.referencePriceCents)} por mês (referência), ${
                            p.userLimit === 1 ? '1 usuário' : `até ${p.userLimit} usuários`
                          }`}
                        </Text>
                        <Text variant="small" color={color.textSecondary}>
                          {p.features.length
                            ? p.features.map((f) => f.label).join(', ')
                            : 'Módulos essenciais, sem convites adicionais nem vitrine'}
                        </Text>
                      </View>
                      {selected ? <Check size={18} color={color.text} /> : null}
                    </Touchable>
                  );
                })}
                {formState.errors.planCode ? (
                  <Text variant="small" color={color.danger}>
                    {formState.errors.planCode.message}
                  </Text>
                ) : null}
              </View>
            )}
          />
          <View style={styles.row}>
            <View style={styles.cell}>
              <Controller
                control={control}
                name="monthlyPriceCents"
                render={({ field }) => (
                  <CurrencyInput
                    label="Valor mensal contratado"
                    hint="Começa no preço de referência do plano."
                    value={field.value}
                    onChange={(v) => {
                      changed();
                      field.onChange(v);
                    }}
                  />
                )}
              />
            </View>
            <View style={styles.cell}>
              <Controller
                control={control}
                name="billingDay"
                render={({ field }) => (
                  <TextField
                    label="Dia de vencimento"
                    hint="Entre 1 e 28."
                    value={field.value}
                    onChangeText={(v) => {
                      changed();
                      field.onChange(v.replace(/\D/g, '').slice(0, 2));
                    }}
                    onBlur={field.onBlur}
                    error={formState.errors.billingDay?.message}
                    inputMode="numeric"
                  />
                )}
              />
            </View>
            <View style={styles.cell}>
              <Controller
                control={control}
                name="billingStartsOn"
                render={({ field }) => (
                  <DateField
                    label="Início da cobrança"
                    hint="Nenhuma cobrança antes desta data."
                    value={field.value}
                    onChange={(v) => {
                      changed();
                      field.onChange(v);
                    }}
                    min={today}
                    max={addDays(today, 366)}
                    today={today}
                    error={formState.errors.billingStartsOn?.message}
                  />
                )}
              />
            </View>
          </View>
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  cell: { flexGrow: 1, flexBasis: 200 },
});
