import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toApiError } from '@/api/errors';
import type {
  CreditApplication,
  CreditLot,
  FinancialState,
  Payment,
  RefundObligation,
} from '@/api/types';
import { FieldRow, FormSection } from '@/features/catalog/FormParts';
import { useMethodOptions } from '@/features/orders/api';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { intentScope, usePendingIntent, useOtherOrderIntent } from '@/lib/intent';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { Alert, Button, Checkbox, CurrencyInput, Select, TextField } from '@/ui';
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
import {
  commandLabels,
  commandPermission,
  type EconomicCommand,
  type FinanceCommand,
} from './commands';
import { CommandConfirmation } from './CommandConfirmation';

export function EconomicForm({
  state,
  lots,
  payments,
  applications,
  refunds,
  blocked,
  settlementAllowed,
  defaultRefundId = '',
}: {
  state: FinancialState;
  lots: CreditLot[];
  payments: Payment[];
  applications: CreditApplication[];
  refunds: RefundObligation[];
  blocked: boolean;
  settlementAllowed: boolean;
  defaultRefundId?: string;
}) {
  const session = useSession();
  const tenant = useTenant();
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
  const [kind, setKind] = useState<EconomicCommand['kind']>(
    defaultRefundId ? 'confirm-refund' : 'apply-credit',
  );
  const [review, setReview] = useState<EconomicCommand | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const { control, handleSubmit, reset, setValue } = useForm<EconomicValues>({
    resolver: zodResolver(economicFormSchema),
    defaultValues: { ...emptyEconomicValues, sourceId: defaultRefundId },
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
  const sourceOptions =
    kind === 'apply-credit'
      ? lots
          .filter((l) => l.availableCents > 0)
          .map((l) => ({
            value: l.id,
            label: `${l.id} · disponível ${formatCents(l.availableCents)}`,
          }))
      : kind === 'reverse-payment'
        ? payments
            .filter((p) => p.allocations.some((a) => a.remainingCents > 0))
            .map((p) => ({
              value: p.id,
              label: `${p.id} · ${p.method.name} · original ${formatCents(p.amountCents)}`,
            }))
        : kind === 'reverse-credit'
          ? applications
              .filter((a) => a.allocations.some((r) => r.remainingCents > 0))
              .map((a) => ({
                value: a.id,
                label: `${a.id} · original ${formatCents(a.amountCents)}`,
              }))
          : refunds
              .filter((r) => r.outstandingCents > 0)
              .map((r) => ({
                value: r.id,
                label: `${r.id} · pendente ${formatCents(r.outstandingCents)}`,
              }));
  if (refund.data && !sourceOptions.some((o) => o.value === refund.data.id))
    sourceOptions.push({
      value: refund.data.id,
      label: `${refund.data.id} · pendente ${formatCents(refund.data.outstandingCents)}`,
    });
  const reversible =
    kind === 'reverse-payment' ? payment.data : kind === 'reverse-credit' ? application.data : null;
  const titleOptions = state.titles
    .filter((t) =>
      kind === 'apply-credit'
        ? t.outstandingCents > 0
        : reversible?.allocations.some((a) => a.receivableId === t.id && a.remainingCents > 0),
    )
    .map((t) => ({
      value: t.id,
      label: `${t.installmentNumber}ª parcela · ${formatCents(kind === 'apply-credit' ? t.outstandingCents : reversible!.allocations.find((a) => a.receivableId === t.id)!.remainingCents)}`,
    }));
  const send = (command: EconomicCommand) =>
    mutation.mutate(command, {
      onSuccess: () => {
        setReview(null);
        reset(emptyEconomicValues);
        setLocalError(null);
      },
      onError: (error) => {
        if (toApiError(error).code !== 'REAUTHENTICATION_REQUIRED') setReview(null);
      },
    });
  return (
    <FormSection
      title="Operações financeiras"
      description="Uma parcela por operação. Crédito exige fonte legítima; estorno nunca apaga histórico."
    >
      {pending ? (
        <Alert
          tone="warning"
          title="Operação com resultado desconhecido"
          action={
            <Button
              label="Recuperar mesma operação"
              loading={mutation.isPending}
              onPress={() => {
                mutation.reset();
                setReview(pending.body as EconomicCommand);
              }}
            />
          }
        >
          {`${commandLabels[(pending.body as FinanceCommand).kind]}: chave, rota e payload preservados. Repita a mesma intenção para recuperar resposta original. Nenhuma nova movimentação será criada automaticamente.`}
        </Alert>
      ) : null}
      {pendingReceipt ? (
        <Alert tone="warning" title="Recebimento anterior ainda desconhecido">
          Recupere a baixa pela tela do título antes de enviar outra operação.
        </Alert>
      ) : null}
      {mutation.isError ? (
        <Alert
          tone="danger"
          title="Operação não confirmada"
        >{`${toApiError(mutation.error).code}: ${toApiError(mutation.error).userMessage}`}</Alert>
      ) : null}
      {mutation.isSuccess && mutation.data && 'operationId' in mutation.data ? (
        <Alert
          tone="success"
          title="Operação confirmada"
        >{`Operação ${mutation.data.operationId} · ${formatCents(mutation.data.amountCents)}. Saldos atuais foram solicitados ao servidor.`}</Alert>
      ) : null}
      {confirmation.data ? (
        <Alert
          tone="info"
          title="Comprovante administrativo"
        >{`${formatCents(confirmation.data.amountCents)} · ${confirmation.data.method.name} · ${confirmation.data.refundedOn} · ${confirmation.data.reference}. Registro não executou transferência bancária.`}</Alert>
      ) : null}
      {confirmation.isError ? (
        <Alert
          tone="warning"
          title="Comprovante indisponível"
          action={<Button label="Recarregar comprovante" onPress={() => confirmation.refetch()} />}
        >
          {toApiError(confirmation.error).userMessage}
        </Alert>
      ) : null}
      <Select
        label="Tipo de operação"
        value={kind}
        options={(['apply-credit', 'reverse-payment', 'reverse-credit', 'confirm-refund'] as const)
          .filter((k) =>
            session.permissions.includes(commandPermission({ kind: k } as EconomicCommand)),
          )
          .map((value) => ({ value, label: commandLabels[value] }))}
        disabled={mutation.isPending || Boolean(pending) || Boolean(pendingReceipt)}
        onChange={(next) => {
          setKind(next);
          reset(emptyEconomicValues);
          mutation.reset();
          setLocalError(null);
        }}
      />
      {!allowed ? (
        <Alert tone="warning" title="Operação não autorizada">
          Seu vínculo não autoriza este tipo de operação.
        </Alert>
      ) : null}
      {actionBlocked ? (
        <Alert tone="warning" title="Operação bloqueada">
          Confira estado oficial do pedido, devoluções e execuções pendentes antes de prosseguir.
        </Alert>
      ) : null}
      {sourceQuery?.isError ? (
        <Alert
          tone="danger"
          title="Origem indisponível"
          action={<Button label="Recarregar origem" onPress={() => sourceQuery.refetch()} />}
        >
          {toApiError(sourceQuery.error).userMessage}
        </Alert>
      ) : null}
      <Controller
        control={control}
        name="sourceId"
        render={({ field, fieldState }) => (
          <Select
            label="Origem da operação"
            value={field.value || null}
            options={sourceOptions}
            disabled={!allowed || Boolean(pending) || mutation.isPending}
            onChange={(id) => {
              field.onChange(id);
              setValue('titleId', '');
            }}
            error={fieldState.error?.message}
            hint="Carregue mais páginas abaixo se a origem não aparece."
          />
        )}
      />
      {kind !== 'confirm-refund' ? (
        <Controller
          control={control}
          name="titleId"
          render={({ field }) => (
            <Select
              label="Parcela da operação"
              value={field.value || null}
              options={titleOptions}
              onChange={field.onChange}
              disabled={locked}
            />
          )}
        />
      ) : (
        <Alert tone="warning" title="Reembolso manual">
          Primeiro devolva dinheiro fora do Lastro. Depois registre somente valor comprovado, forma,
          data e referência.
        </Alert>
      )}
      <FieldRow>
        <Controller
          control={control}
          name="amountCents"
          render={({ field, fieldState }) => (
            <CurrencyInput
              label="Valor da operação"
              value={field.value}
              onChange={field.onChange}
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
              label="Justificativa financeira"
              value={field.value}
              onChangeText={field.onChange}
              maxLength={500}
              editable={!locked}
              error={fieldState.error?.message}
            />
          )}
        />
      </FieldRow>
      {kind === 'confirm-refund' ? (
        <>
          {methods.isError ? (
            <Alert
              tone="danger"
              title="Formas indisponíveis"
              action={<Button label="Recarregar formas" onPress={() => methods.refetch()} />}
            >
              {toApiError(methods.error).userMessage}
            </Alert>
          ) : null}
          <Controller
            control={control}
            name="methodId"
            render={({ field }) => (
              <Select
                label="Forma do reembolso realizado"
                value={field.value || null}
                options={(methods.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
                onChange={field.onChange}
                disabled={locked || methods.isPending || methods.isError}
              />
            )}
          />
          <FieldRow>
            <Controller
              control={control}
              name="date"
              render={({ field }) => (
                <TextField
                  label="Dinheiro devolvido em"
                  placeholder="AAAA-MM-DD"
                  value={field.value}
                  onChangeText={field.onChange}
                  editable={!locked}
                />
              )}
            />
            <Controller
              control={control}
              name="reference"
              render={({ field }) => (
                <TextField
                  label="Referência do comprovante"
                  value={field.value}
                  onChangeText={field.onChange}
                  maxLength={200}
                  editable={!locked}
                />
              )}
            />
          </FieldRow>
          <Button
            label="Usar data de hoje"
            variant="ghost"
            disabled={locked || !tenant.data}
            onPress={() => tenant.data && setValue('date', todayIn(tenant.data.timezone))}
          />
          <Controller
            control={control}
            name="transferConfirmed"
            render={({ field }) => (
              <Checkbox
                label="Confirmo que o dinheiro já foi devolvido fora do Lastro"
                checked={field.value}
                onChange={field.onChange}
                disabled={locked}
              />
            )}
          />
        </>
      ) : null}
      {localError ? (
        <Alert tone="warning" title="Revise a operação">
          {localError}
        </Alert>
      ) : null}
      <Button
        label="Revisar operação financeira"
        variant="strong"
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
            setLocalError(error instanceof Error ? error.message : 'Revise valores e origens');
          }
        })}
      />
      {review ? (
        <CommandConfirmation
          command={review}
          busy={mutation.isPending}
          error={mutation.error}
          onSend={() => send(review)}
          onCancel={() => setReview(null)}
          onReauth={() => mutation.reset()}
        />
      ) : null}
    </FormSection>
  );
}
