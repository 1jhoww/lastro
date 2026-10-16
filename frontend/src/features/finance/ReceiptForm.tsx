import { useEffect, useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { FinancialState, Receivable, ReceiptInput } from '@/api/types';
import { toApiError } from '@/api/errors';
import { useMethodOptions, useOrder } from '@/features/orders/api';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { intentScope, outcomeOf, usePendingIntent, useOtherOrderIntent } from '@/lib/intent';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Button,
  ChoiceChips,
  CurrencyInput,
  DateField,
  Dialog,
  Disclosure,
  Skeleton,
  Text,
  TextField,
} from '@/ui';
import { HandCoins } from '@/ui/icons';
import { useReceipt } from './api';
import { Field } from './FinanceParts';
import { formatDate, installmentLabel, methodIcon } from './presentation';
import { defaultReceiptNote } from './receiptNote';
import { receiptFormSchema, toReceiptBody, type ReceiptFormValues } from './rules';

/**
 * Ação principal do título: "Registrar pagamento". Fluxo curto (valor, forma, data, confirmar)
 * com a mesma garantia de antes: corpo e chave idempotente preservados em resultado incerto,
 * repetição explícita sem duplicar e sucesso só com resposta confirmada do servidor.
 */
export function ReceiptAction({
  title,
  state,
  blocked,
}: {
  title: Receivable;
  state: FinancialState;
  blocked: boolean;
}) {
  const { user, tenantId, permissions } = useSession();
  const size = useLayoutSize();
  const medium = size === 'medium';
  const tenant = useTenant();
  const today = tenant.data ? todayIn(tenant.data.timezone) : null;
  const scope = intentScope(user!.uid, tenantId!, 'receipt', title.orderId);
  const pending = usePendingIntent(scope);
  const otherIntent = useOtherOrderIntent(user!.uid, tenantId!, title.orderId, 'receipt');
  const pendingAdministration = usePendingIntent(
    intentScope(user!.uid, tenantId!, 'finance-command', title.orderId),
  );
  const receipt = useReceipt(title.orderId, scope);
  const [open, setOpen] = useState(false);
  const methods = useMethodOptions(permissions.includes('payments:manage') && open);
  const [review, setReview] = useState<ReceiptInput | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<number | null>(null);
  const { control, handleSubmit, setValue, reset, getValues } = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: { amountCents: 0, methodId: '', receivedOn: '', reference: '', reason: '' },
  });
  const amount = useWatch({ control, name: 'amountCents' });
  const current = state.titles.find((t) => t.id === title.id);
  const outstanding = current?.outstandingCents ?? 0;
  // Forma prevista no pedido é só sugestão: a forma efetiva é a que a pessoa confirma aqui.
  const order = useOrder(open ? title.orderId : undefined);
  const intended = order.data?.intendedPaymentMethod ?? null;
  const suggested =
    (methods.data?.length === 1 ? methods.data[0] : undefined) ??
    methods.data?.find((m) => m.id === intended?.id);
  useEffect(() => {
    if (open && suggested && !getValues('methodId')) setValue('methodId', suggested.id);
  }, [open, suggested, getValues, setValue]);
  if (!permissions.includes('payments:manage')) return null;
  const locked =
    blocked ||
    !current ||
    outstanding === 0 ||
    receipt.isPending ||
    Boolean(pending) ||
    Boolean(pendingAdministration) ||
    Boolean(otherIntent);
  const send = (body: ReceiptInput) =>
    receipt.mutate(body, {
      onSuccess: (result) => {
        setConfirmed(result.amountCents);
        setOpen(false);
        setReview(null);
        setLocalError(null);
      },
      onError: (error) => {
        // Resultado incerto: fecha o diálogo; o aviso da página oferece repetição segura.
        if (outcomeOf(error).status === 'unknown') setOpen(false);
      },
    });
  const start = () => {
    receipt.reset();
    setConfirmed(null);
    setReview(null);
    setLocalError(null);
    reset({
      amountCents: outstanding,
      methodId: suggested?.id ?? '',
      receivedOn: today ?? '',
      reference: '',
      reason: defaultReceiptNote(title.installmentNumber),
    });
    setOpen(true);
  };
  const methodName = (id: string) => methods.data?.find((m) => m.id === id)?.name ?? '';
  const remaining = review ? outstanding - review.amountCents : outstanding - (amount || 0);
  const error = receipt.isError && !pending ? toApiError(receipt.error) : null;
  return (
    <View style={styles.root}>
      <View style={medium ? styles.buttonMedium : undefined}>
        <Button label="Registrar pagamento" icon={HandCoins} disabled={locked} onPress={start} />
      </View>
      {confirmed !== null && receipt.isSuccess ? (
        <Alert tone="success" title="Pagamento registrado!">
          {`${formatCents(confirmed)} recebidos. Tudo certo, o saldo da parcela já foi atualizado.`}
        </Alert>
      ) : null}
      {pending ? (
        <Alert
          tone="warning"
          title="Ainda não sabemos se o pagamento foi registrado"
          action={
            <Button
              label="Conferir pagamento"
              size="sm"
              variant="outline"
              loading={receipt.isPending}
              onPress={() => send(pending.body as ReceiptInput)}
            />
          }
        >
          {`A conexão caiu antes de confirmarmos o pagamento de ${formatCents(Number(pending.body.amountCents))} de ${formatDate(String(pending.body.receivedOn))}. Ele ainda não aparece como registrado. Não lance de novo: toque abaixo para conferir. Se já tiver sido registrado, nada será duplicado.`}
        </Alert>
      ) : null}
      {error && !open ? (
        <Alert tone="danger" title="Não foi possível registrar o pagamento">
          {error.userMessage}
        </Alert>
      ) : null}
      {otherIntent && !pendingAdministration ? (
        <Alert tone="warning" title="Outra operação deste pedido aguarda confirmação">
          Conclua o acompanhamento da operação pendente antes de registrar novo pagamento.
        </Alert>
      ) : null}
      {pendingAdministration ? (
        <Alert tone="warning" title="Operação anterior sem confirmação">
          Um crédito, estorno ou reembolso deste pedido ainda está sem confirmação. Confira em
          Financeiro do pedido antes de registrar outro pagamento.
        </Alert>
      ) : null}
      {blocked && !pending ? (
        <Alert tone="warning" title="Pagamento indisponível no momento">
          Há uma devolução ou outra operação em andamento neste pedido, ou os valores ainda estão
          carregando. Tente de novo em instantes.
        </Alert>
      ) : null}
      <Dialog
        visible={open}
        title={review ? 'Confirmar pagamento' : 'Registrar pagamento'}
        description={
          review
            ? 'Confira antes de confirmar. Depois de registrado, o pagamento só pode ser desfeito por estorno.'
            : `${title.customerName} · ${installmentLabel(title.installmentNumber)} · vencimento ${formatDate(title.dueDate)}`
        }
        onClose={() => !receipt.isPending && setOpen(false)}
        actions={
          review ? (
            <>
              <Button
                label="Voltar"
                variant="ghost"
                disabled={receipt.isPending}
                onPress={() => {
                  setReview(null);
                  receipt.reset();
                }}
              />
              <Button
                label="Confirmar pagamento"
                loading={receipt.isPending}
                onPress={() => send(review)}
              />
            </>
          ) : (
            <>
              <Button label="Cancelar" variant="ghost" onPress={() => setOpen(false)} />
              <Button
                label="Continuar"
                disabled={
                  locked ||
                  methods.isPending ||
                  methods.isError ||
                  !methods.data?.length ||
                  !amount ||
                  amount > outstanding
                }
                onPress={handleSubmit((values) => {
                  const method = methods.data?.find((m) => m.id === values.methodId);
                  if (!method) return setLocalError('Escolha uma forma de pagamento ativa.');
                  if (today && values.receivedOn > today)
                    return setLocalError('A data do pagamento não pode ser futura.');
                  try {
                    setReview(toReceiptBody(values, state, title.id, method));
                    setLocalError(null);
                    receipt.reset();
                  } catch {
                    setLocalError(
                      `O valor não pode passar do saldo atual da parcela (${formatCents(outstanding)}).`,
                    );
                  }
                })}
              />
            </>
          )
        }
      >
        {review ? (
          <View style={styles.review}>
            <Text variant="figureLarge">{formatCents(review.amountCents)}</Text>
            <View>
              <Field label="Cliente" value={title.customerName} />
              <Field label="Parcela" value={installmentLabel(title.installmentNumber)} />
              <Field label="Forma" value={methodName(review.methodId)} />
              <Field label="Data do pagamento" value={formatDate(review.receivedOn)} />
              <Field
                label="Depois do pagamento"
                value={
                  remaining === 0 ? 'Parcela quitada' : `Restam ${formatCents(remaining)} em aberto`
                }
              />
              {review.reference ? <Field label="Referência" value={review.reference} /> : null}
              <Field label="Observação" value={review.reason} />
            </View>
            {error ? (
              <Alert tone="danger" title="Não foi possível registrar o pagamento">
                {error.code === 'CONFLICT' || error.code === 'INVALID_ALLOCATION'
                  ? 'A parcela mudou desde que a tela foi aberta. Volte, confira o saldo atualizado e confirme de novo.'
                  : error.userMessage}
              </Alert>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.balance}>
              <Text variant="small" color={color.textSecondary}>
                Saldo desta parcela
              </Text>
              <Text variant="figure">{formatCents(outstanding)}</Text>
            </View>
            <Controller
              control={control}
              name="amountCents"
              render={({ field, fieldState }) => (
                <CurrencyInput
                  label="Valor recebido"
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    setLocalError(null);
                  }}
                  maxCents={Number.MAX_SAFE_INTEGER}
                  editable={!locked}
                  error={
                    fieldState.error?.message ??
                    (field.value > outstanding
                      ? `Máximo ${formatCents(outstanding)} (saldo da parcela)`
                      : undefined)
                  }
                  hint={
                    field.value > 0 && field.value < outstanding
                      ? `Pagamento parcial: restarão ${formatCents(outstanding - field.value)} em aberto.`
                      : field.value === outstanding
                        ? 'Quita a parcela.'
                        : undefined
                  }
                />
              )}
            />
            {methods.isPending ? (
              <Skeleton height={40} />
            ) : methods.isError ? (
              <Alert
                tone="danger"
                title="Não foi possível carregar as formas de pagamento"
                action={
                  <Button
                    label="Tentar de novo"
                    size="sm"
                    variant="outline"
                    onPress={() => methods.refetch()}
                  />
                }
              >
                {toApiError(methods.error).userMessage}
              </Alert>
            ) : !methods.data?.length ? (
              <Alert tone="warning" title="Nenhuma forma de pagamento ativa">
                <Text variant="small">
                  {permissions.includes('payment-settings:manage')
                    ? 'Cadastre pelo menos uma forma (Pix, Dinheiro, Transferência…) para registrar pagamentos.'
                    : 'Peça a um administrador para cadastrar as formas de pagamento da empresa.'}
                </Text>
                {permissions.includes('payment-settings:manage') ? (
                  <Link href={'/financeiro/configuracoes?aba=formas' as Href} asChild>
                    <Button
                      label="Cadastrar forma de pagamento"
                      size="sm"
                      variant="outline"
                      onPress={() => setOpen(false)}
                    />
                  </Link>
                ) : null}
              </Alert>
            ) : (
              <Controller
                control={control}
                name="methodId"
                render={({ field, fieldState }) => (
                  <ChoiceChips
                    label="Forma de pagamento"
                    value={field.value || null}
                    onChange={field.onChange}
                    disabled={locked}
                    error={fieldState.error?.message}
                    hint={
                      intended
                        ? `Previsto no pedido: ${intended.name}. Confira como o cliente pagou de fato.`
                        : undefined
                    }
                    options={(methods.data ?? []).map((m) => ({
                      value: m.id,
                      label: m.name,
                      icon: methodIcon(m.kind),
                    }))}
                  />
                )}
              />
            )}
            <Controller
              control={control}
              name="receivedOn"
              render={({ field, fieldState }) => (
                <DateField
                  label="Data do pagamento"
                  value={field.value}
                  onChange={field.onChange}
                  max={today ?? undefined}
                  today={today ?? undefined}
                  disabled={locked}
                  hint="Dia em que o dinheiro entrou."
                  error={fieldState.error ? 'Informe a data no formato DD/MM/AAAA' : undefined}
                />
              )}
            />
            <Disclosure label="Mais detalhes" summary="referência e observação">
              <Controller
                control={control}
                name="reference"
                render={({ field, fieldState }) => (
                  <TextField
                    label="Referência"
                    optional
                    placeholder="Ex.: código do Pix ou nº do comprovante"
                    value={field.value}
                    onChangeText={field.onChange}
                    maxLength={200}
                    editable={!locked}
                    error={fieldState.error?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="reason"
                render={({ field, fieldState }) => (
                  <TextField
                    label="Observação"
                    hint="Fica registrada no histórico do pagamento."
                    value={field.value}
                    onChangeText={field.onChange}
                    maxLength={500}
                    editable={!locked}
                    error={fieldState.error ? 'Escreva pelo menos 3 caracteres' : undefined}
                  />
                )}
              />
            </Disclosure>
            {localError ? (
              <Alert tone="warning" title="Revise o pagamento">
                {localError}
              </Alert>
            ) : null}
          </>
        )}
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[3] },
  buttonMedium: { alignSelf: 'flex-start' },
  review: { gap: space[3] },
  balance: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: 10,
    backgroundColor: color.surfaceSunken,
  },
});
