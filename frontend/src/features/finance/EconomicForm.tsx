import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type {
  CreditApplication,
  CreditLot,
  FinancialState,
  Payment,
  RefundObligation,
} from '@/api/types';
import { FormSection } from '@/features/catalog/FormParts';
import { useMethodOptions } from '@/features/orders/api';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { formatDateTime } from '@/lib/dates';
import { intentScope, usePendingIntent, useOtherOrderIntent } from '@/lib/intent';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { space } from '@/theme';
import {
  Alert,
  Button,
  Checkbox,
  ChoiceChips,
  CurrencyInput,
  DateField,
  Disclosure,
  Select,
  TextField,
} from '@/ui';
import {
  useCreditApplicationRecord,
  useFinanceCommand,
  usePaymentRecord,
  useRefundConfirmation,
  useRefundRecord,
} from './administrationApi';
import {
  buildEconomicCommand,
  economicFormSchema,
  emptyEconomicValues,
  type EconomicValues,
} from './administrationRules';
import { commandLabels, commandPermission, type EconomicCommand } from './commands';
import { CommandConfirmation } from './CommandConfirmation';
import { creditOriginLabel } from './CreditsScreen';
import { Guidance } from './FinanceParts';
import { formatDate, installmentLabel, methodIcon, orderCode } from './presentation';

export const economicTitles: Record<EconomicCommand['kind'], string> = {
  'apply-credit': 'Usar crédito do cliente',
  'reverse-payment': 'Estornar pagamento',
  'reverse-credit': 'Estornar uso de crédito',
  'confirm-refund': 'Registrar reembolso já feito',
};
const guidance: Record<EconomicCommand['kind'], string> = {
  'apply-credit':
    'Abate a parcela com crédito que o cliente já tem por cancelamento ou devolução. Nunca acontece sozinho.',
  'reverse-payment':
    'Use quando um pagamento foi registrado por engano. O registro continua no histórico como estornado e o valor volta a ficar em aberto.',
  'reverse-credit':
    'Desfaz o uso de crédito nesta parcela. O valor volta ao crédito do cliente e a parcela fica em aberto de novo.',
  'confirm-refund':
    'Primeiro devolva o dinheiro ao cliente por fora (Pix, transferência…). Depois registre aqui. O Lastro não transfere dinheiro.',
};

/**
 * Operações secundárias do pedido, uma de cada vez. Mesmas garantias de antes: valores e
 * versões vêm das consultas oficiais, uma parcela por operação, intenção preservada em
 * resultado incerto e senha recente para estorno e reembolso.
 */
export function EconomicForm({
  kind,
  state,
  lots,
  payments,
  applications,
  refunds,
  blocked,
  settlementAllowed,
  defaultRefundId = '',
  onDone,
}: {
  kind: EconomicCommand['kind'];
  state: FinancialState;
  lots: CreditLot[];
  payments: Payment[];
  applications: CreditApplication[];
  refunds: RefundObligation[];
  blocked: boolean;
  settlementAllowed: boolean;
  defaultRefundId?: string;
  onDone?: () => void;
}) {
  const session = useSession();
  const tenant = useTenant();
  const today = tenant.data ? todayIn(tenant.data.timezone) : undefined;
  const scope = intentScope(session.user!.uid, session.tenantId!, 'finance-command', state.orderId);
  const pending = usePendingIntent(scope);
  const otherIntent = useOtherOrderIntent(
    session.user!.uid,
    session.tenantId!,
    state.orderId,
    'finance-command',
  );
  const pendingReceipt = usePendingIntent(
    intentScope(session.user!.uid, session.tenantId!, 'receipt', state.orderId),
  );
  const mutation = useFinanceCommand(scope);
  const [review, setReview] = useState<EconomicCommand | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const { control, handleSubmit, reset, setValue, getValues } = useForm<EconomicValues>({
    resolver: zodResolver(economicFormSchema),
    defaultValues: {
      ...emptyEconomicValues,
      sourceId: kind === 'confirm-refund' ? defaultRefundId : '',
      date: kind === 'confirm-refund' ? (today ?? '') : '',
    },
  });
  const values = useWatch({ control });
  const payment = usePaymentRecord(kind === 'reverse-payment' ? (values.sourceId ?? '') : '');
  const application = useCreditApplicationRecord(
    kind === 'reverse-credit' ? (values.sourceId ?? '') : '',
  );
  const refund = useRefundRecord(kind === 'confirm-refund' ? (values.sourceId ?? '') : '');
  const methods = useMethodOptions(
    kind === 'confirm-refund' && session.permissions.includes('refunds:manage'),
  );
  const confirmationId =
    mutation.data && 'operationId' in mutation.data && review === null && kind === 'confirm-refund'
      ? mutation.data.operationId
      : '';
  const confirmation = useRefundConfirmation(confirmationId);
  const allowed = session.permissions.includes(commandPermission({ kind } as EconomicCommand));
  const sourceQuery =
    kind === 'reverse-payment'
      ? payment
      : kind === 'reverse-credit'
        ? application
        : kind === 'confirm-refund'
          ? refund
          : null;
  const waiting = Boolean(
    values.sourceId &&
    sourceQuery &&
    (sourceQuery.isPending || sourceQuery.isFetching || sourceQuery.isError),
  );
  const actionBlocked =
    blocked || (kind !== 'confirm-refund' && (!settlementAllowed || state.activeReturnCount > 0));
  const locked =
    !allowed ||
    actionBlocked ||
    mutation.isPending ||
    Boolean(pending) ||
    Boolean(pendingReceipt) ||
    Boolean(otherIntent) ||
    waiting;
  const titleOf = (id: string) => state.titles.find((t) => t.id === id);
  const sourceOptions =
    kind === 'apply-credit'
      ? lots
          .filter((l) => l.availableCents > 0)
          .map((l) => ({
            value: l.id,
            label: `${formatCents(l.availableCents)} disponível`,
            description: `${creditOriginLabel[l.origin]} · ${orderCode(l.originOrderId)}`,
          }))
      : kind === 'reverse-payment'
        ? payments
            .filter((p) => p.allocations.some((a) => a.remainingCents > 0))
            .map((p) => ({
              value: p.id,
              label: `${p.method.name} · ${formatCents(p.amountCents)} em ${formatDate(p.receivedOn)}`,
              description: p.reversedCents
                ? `Já estornado ${formatCents(p.reversedCents)}`
                : p.reference || undefined,
            }))
        : kind === 'reverse-credit'
          ? applications
              .filter((a) => a.allocations.some((r) => r.remainingCents > 0))
              .map((a) => ({
                value: a.id,
                label: `Crédito de ${formatCents(a.amountCents)}`,
                description: `Usado em ${formatDateTime(a.createdAt)}`,
              }))
          : refunds
              .filter((r) => r.outstandingCents > 0)
              .map((r) => ({
                value: r.id,
                label: `${formatCents(r.outstandingCents)} a devolver`,
                description: `${creditOriginLabel[r.origin]} · ${orderCode(r.orderId)}`,
              }));
  if (refund.data && !sourceOptions.some((o) => o.value === refund.data.id))
    sourceOptions.push({
      value: refund.data.id,
      label: `${formatCents(refund.data.outstandingCents)} a devolver`,
      description: creditOriginLabel[refund.data.origin],
    });
  const reversible =
    kind === 'reverse-payment' ? payment.data : kind === 'reverse-credit' ? application.data : null;
  const limitFor = (titleId: string) =>
    kind === 'apply-credit'
      ? (titleOf(titleId)?.outstandingCents ?? 0)
      : (reversible?.allocations.find((a) => a.receivableId === titleId)?.remainingCents ?? 0);
  const titleOptions = state.titles
    .filter((t) =>
      kind === 'apply-credit'
        ? t.outstandingCents > 0
        : reversible?.allocations.some((a) => a.receivableId === t.id && a.remainingCents > 0),
    )
    .map((t) => ({
      value: t.id,
      label: `${installmentLabel(t.installmentNumber)} · ${kind === 'apply-credit' ? 'em aberto' : 'pode estornar'} ${formatCents(limitFor(t.id))}`,
      description: `Vencimento ${formatDate(t.dueDate)}`,
    }));
  // Sugere o maior valor permitido; a pessoa pode diminuir.
  const suggest = (sourceId: string, titleId: string) => {
    if (getValues('amountCents')) return;
    if (kind === 'confirm-refund') {
      const r = refunds.find((x) => x.id === sourceId) ?? refund.data;
      if (r) setValue('amountCents', r.outstandingCents);
      return;
    }
    if (!titleId) return;
    const lot = lots.find((l) => l.id === sourceId);
    const limit = limitFor(titleId);
    setValue(
      'amountCents',
      kind === 'apply-credit' && lot ? Math.min(lot.availableCents, limit) : limit,
    );
  };
  // Uma única opção possível já vem escolhida; a pessoa ainda revisa antes de confirmar.
  const onlySource = sourceOptions.length === 1 ? sourceOptions[0]!.value : '';
  const onlyTitle = titleOptions.length === 1 ? titleOptions[0]!.value : '';
  useEffect(() => {
    if (onlySource && !getValues('sourceId')) {
      setValue('sourceId', onlySource);
      suggest(onlySource, '');
    }
  }, [onlySource]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (onlyTitle && getValues('sourceId') && !getValues('titleId')) {
      setValue('titleId', onlyTitle);
      suggest(getValues('sourceId'), onlyTitle);
    }
  }, [onlyTitle, values.sourceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const refundOutstanding = refund.data?.outstandingCents;
  useEffect(() => {
    if (kind === 'confirm-refund' && refundOutstanding && !getValues('amountCents'))
      setValue('amountCents', refundOutstanding);
  }, [kind, refundOutstanding, getValues, setValue]);
  const send = (command: EconomicCommand) =>
    mutation.mutate(command, {
      onSuccess: () => {
        setReview(null);
        reset({ ...emptyEconomicValues, date: today ?? '' });
        setLocalError(null);
      },
      onError: (error) => {
        if (toApiError(error).code !== 'REAUTHENTICATION_REQUIRED') setReview(null);
      },
    });
  const methodName = (id: string) => methods.data?.find((m) => m.id === id)?.name ?? '';
  const details = review
    ? reviewDetails(review, { state, lots, refunds, payment: payment.data, methodName })
    : [];
  return (
    <FormSection title={economicTitles[kind]}>
      <Guidance>{guidance[kind]}</Guidance>
      {pending ? (
        <Alert
          tone="warning"
          title="Ainda não sabemos se a operação foi registrada"
          action={
            <Button
              label="Conferir operação"
              size="sm"
              variant="outline"
              loading={mutation.isPending}
              onPress={() => {
                mutation.reset();
                setReview(pending.body as EconomicCommand);
              }}
            />
          }
        >
          {`${commandLabels[(pending.body as EconomicCommand).kind]}: a conexão caiu antes da confirmação. Confira antes de tentar outra operação; se já tiver sido registrada, nada será duplicado.`}
        </Alert>
      ) : null}
      {pendingReceipt ? (
        <Alert tone="warning" title="Pagamento anterior sem confirmação">
          Confira o pagamento pendente na tela da parcela antes de fazer outra operação.
        </Alert>
      ) : null}
      {mutation.isError ? (
        <Alert tone="danger" title="Não foi possível concluir a operação">
          {toApiError(mutation.error).userMessage}
        </Alert>
      ) : null}
      {mutation.isSuccess && mutation.data && 'operationId' in mutation.data ? (
        <Alert
          tone="success"
          title="Operação concluída"
          action={
            onDone ? <Button label="Concluir" size="sm" variant="outline" onPress={onDone} /> : null
          }
        >
          {`Pronto! ${formatCents(mutation.data.amountCents)} registrados. Os saldos já foram atualizados.`}
        </Alert>
      ) : null}
      {confirmation.data ? (
        <Alert tone="info" title="Reembolso registrado">
          {`${formatCents(confirmation.data.amountCents)} · ${confirmation.data.method.name} · ${formatDate(confirmation.data.refundedOn)} · ${confirmation.data.reference}. Registramos a devolução que você fez por fora; o Lastro não transfere dinheiro.`}
        </Alert>
      ) : null}
      {confirmation.isError ? (
        <Alert
          tone="warning"
          title="Comprovante indisponível"
          action={
            <Button label="Tentar de novo" size="sm" onPress={() => confirmation.refetch()} />
          }
        >
          {toApiError(confirmation.error).userMessage}
        </Alert>
      ) : null}
      {!allowed ? (
        <Alert tone="warning" title="Operação não autorizada">
          Seu acesso não permite esta operação.
        </Alert>
      ) : null}
      {actionBlocked && allowed ? (
        <Alert tone="warning" title="Operação indisponível agora">
          Há devolução ou operação em andamento neste pedido, ou o pedido não está em situação que
          permita esta operação.
        </Alert>
      ) : null}
      {sourceQuery?.isError ? (
        <Alert
          tone="danger"
          title="Não foi possível carregar a origem"
          action={<Button label="Tentar de novo" size="sm" onPress={() => sourceQuery.refetch()} />}
        >
          {toApiError(sourceQuery.error).userMessage}
        </Alert>
      ) : null}
      <Controller
        control={control}
        name="sourceId"
        render={({ field, fieldState }) => (
          <Select
            label={
              kind === 'apply-credit'
                ? 'Crédito a usar'
                : kind === 'reverse-payment'
                  ? 'Pagamento a estornar'
                  : kind === 'reverse-credit'
                    ? 'Uso de crédito a estornar'
                    : 'Reembolso pendente'
            }
            value={field.value || null}
            options={sourceOptions}
            placeholder={sourceOptions.length ? 'Escolha' : 'Nada disponível neste pedido'}
            disabled={!allowed || Boolean(pending) || mutation.isPending || !sourceOptions.length}
            onChange={(id) => {
              field.onChange(id);
              setValue('titleId', '');
              setValue('amountCents', 0);
              suggest(id, '');
            }}
            error={fieldState.error?.message}
          />
        )}
      />
      {kind !== 'confirm-refund' ? (
        <Controller
          control={control}
          name="titleId"
          render={({ field }) => (
            <Select
              label="Parcela"
              value={field.value || null}
              options={titleOptions}
              onChange={(id) => {
                field.onChange(id);
                setValue('amountCents', 0);
                suggest(getValues('sourceId'), id);
              }}
              disabled={locked || !titleOptions.length}
            />
          )}
        />
      ) : null}
      <Controller
        control={control}
        name="amountCents"
        render={({ field, fieldState }) => (
          <CurrencyInput
            label="Valor"
            value={field.value}
            onChange={field.onChange}
            editable={!locked}
            error={fieldState.error?.message}
          />
        )}
      />
      {kind === 'confirm-refund' ? (
        <>
          {methods.isError ? (
            <Alert
              tone="danger"
              title="Não foi possível carregar as formas"
              action={<Button label="Tentar de novo" size="sm" onPress={() => methods.refetch()} />}
            >
              {toApiError(methods.error).userMessage}
            </Alert>
          ) : null}
          <Controller
            control={control}
            name="methodId"
            render={({ field }) => (
              <ChoiceChips
                label="Como o dinheiro foi devolvido"
                value={field.value || null}
                onChange={field.onChange}
                disabled={locked || methods.isPending || methods.isError}
                hint={
                  methods.data && !methods.data.length
                    ? 'Nenhuma forma ativa. Cadastre em Condições e formas.'
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
          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <DateField
                label="Data da devolução"
                value={field.value}
                onChange={field.onChange}
                max={today}
                today={today}
                disabled={locked}
              />
            )}
          />
          <Controller
            control={control}
            name="reference"
            render={({ field }) => (
              <TextField
                label="Comprovante"
                placeholder="Ex.: código do Pix ou nº da transferência"
                value={field.value}
                onChangeText={field.onChange}
                maxLength={200}
                editable={!locked}
              />
            )}
          />
          <Controller
            control={control}
            name="transferConfirmed"
            render={({ field }) => (
              <Checkbox
                label="Confirmo que o dinheiro já foi devolvido ao cliente fora do Lastro"
                checked={field.value}
                onChange={field.onChange}
                disabled={locked}
              />
            )}
          />
        </>
      ) : null}
      <Controller
        control={control}
        name="reason"
        render={({ field, fieldState }) => (
          <TextField
            label="Motivo"
            placeholder={
              kind === 'reverse-payment'
                ? 'Ex.: pagamento lançado em duplicidade'
                : 'Explique em poucas palavras'
            }
            hint="Obrigatório. Fica registrado no histórico."
            value={field.value}
            onChangeText={field.onChange}
            maxLength={500}
            editable={!locked}
            error={fieldState.error ? 'Escreva pelo menos 3 caracteres' : undefined}
          />
        )}
      />
      {localError ? (
        <Alert tone="warning" title="Revise a operação">
          {localError}
        </Alert>
      ) : null}
      <View style={styles.actions}>
        <Button
          label="Revisar"
          variant={kind === 'reverse-payment' || kind === 'reverse-credit' ? 'outline' : 'primary'}
          disabled={locked || (kind === 'confirm-refund' && (methods.isPending || methods.isError))}
          onPress={handleSubmit((v) => {
            try {
              const command = buildEconomicCommand(kind, v, state, {
                lots,
                payments: payment.data ? [payment.data] : payments,
                applications: application.data ? [application.data] : applications,
                refunds: refund.data ? [refund.data] : refunds,
                methods: methods.data ?? [],
              });
              mutation.reset();
              setReview(command);
              setLocalError(null);
            } catch (error) {
              setLocalError(
                error instanceof Error ? friendly(error.message) : 'Revise valores e origem',
              );
            }
          })}
        />
        {onDone ? <Button label="Cancelar" variant="ghost" onPress={onDone} /> : null}
      </View>
      {review ? (
        <CommandConfirmation
          command={review}
          details={details}
          busy={mutation.isPending}
          error={mutation.error}
          onSend={() => send(review)}
          onCancel={() => setReview(null)}
          onReauth={() => mutation.reset()}
        />
      ) : null}
      <Disclosure label="Detalhes técnicos">
        <Guidance>
          {`Pedido ${state.orderId} · versão ${state.orderVersion} · guarda ${state.guardVersion}.`}
        </Guidance>
      </Disclosure>
    </FormSection>
  );
}

function friendly(message: string) {
  const map: Record<string, string> = {
    'Valor excede obrigação pendente': 'O valor é maior que o reembolso pendente.',
    'Confirme transferência externa já realizada, forma, data e referência':
      'Informe como e quando o dinheiro foi devolvido, o comprovante, e marque a confirmação.',
    'Escolha parcela oficial do pedido': 'Escolha a parcela.',
    'Saldo de crédito insuficiente': 'O valor é maior que o crédito disponível.',
    'Valor excede saldo da parcela': 'O valor é maior que o saldo em aberto da parcela.',
    'Valor excede alocação reversível':
      'O valor é maior do que ainda pode ser estornado nesta parcela.',
    'Carregue a fonte original do crédito antes de estornar':
      'O crédito de origem ainda não foi carregado. Atualize a tela e tente de novo.',
  };
  return map[message] ?? message;
}

function reviewDetails(
  command: EconomicCommand,
  ctx: {
    state: FinancialState;
    lots: CreditLot[];
    refunds: RefundObligation[];
    payment?: Payment;
    methodName: (id: string) => string;
  },
): { label: string; value: string }[] {
  const amount = command.body.amountCents;
  if (command.kind === 'confirm-refund') {
    const r = ctx.refunds.find((x) => x.id === command.id);
    return [
      { label: 'Valor devolvido', value: formatCents(amount) },
      { label: 'Forma', value: ctx.methodName(command.body.methodId) },
      { label: 'Data da devolução', value: formatDate(command.body.refundedOn) },
      { label: 'Comprovante', value: command.body.reference },
      ...(r
        ? [
            {
              label: 'Depois do registro',
              value:
                r.outstandingCents - amount
                  ? `Restam ${formatCents(r.outstandingCents - amount)} a devolver`
                  : 'Reembolso concluído',
            },
          ]
        : []),
      { label: 'Motivo', value: command.body.reason },
    ];
  }
  const allocation = command.body.allocations[0]!;
  const title = ctx.state.titles.find((t) => t.id === allocation.receivableId);
  const parcel = title ? installmentLabel(title.installmentNumber) : 'Parcela';
  const outstanding = title?.outstandingCents ?? 0;
  if (command.kind === 'apply-credit') {
    const lot = ctx.lots.find((l) => l.id === command.body.creditLotId);
    return [
      { label: 'Valor', value: formatCents(amount) },
      { label: 'Parcela', value: parcel },
      { label: 'Saldo da parcela depois', value: formatCents(outstanding - amount) },
      ...(lot
        ? [
            {
              label: 'Crédito restante do cliente',
              value: formatCents(lot.availableCents - amount),
            },
          ]
        : []),
      { label: 'Motivo', value: command.body.reason },
    ];
  }
  return [
    { label: 'Valor estornado', value: formatCents(amount) },
    ...(command.kind === 'reverse-payment' && ctx.payment
      ? [
          {
            label: 'Pagamento',
            value: `${ctx.payment.method.name} de ${formatDate(ctx.payment.receivedOn)}`,
          },
        ]
      : []),
    { label: 'Parcela', value: parcel },
    { label: 'Saldo da parcela depois', value: formatCents(outstanding + amount) },
    {
      label: 'O que acontece',
      value:
        command.kind === 'reverse-payment'
          ? 'O pagamento fica marcado como estornado no histórico'
          : 'O valor volta ao crédito do cliente',
    },
    { label: 'Motivo', value: command.body.reason },
  ];
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
});
