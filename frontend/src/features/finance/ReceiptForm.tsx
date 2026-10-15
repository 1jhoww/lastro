import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { FinancialState, Receivable, ReceiptInput } from '@/api/types';
import { toApiError } from '@/api/errors';
import { FieldRow, FormSection } from '@/features/catalog/FormParts';
import { useMethodOptions } from '@/features/orders/api';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { intentScope, usePendingIntent, useOtherOrderIntent } from '@/lib/intent';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { space } from '@/theme';
import { Alert, Button, ConfirmDialog, CurrencyInput, Select, Text, TextField } from '@/ui';
import { useReceipt } from './api';
import { receiptFormSchema, toReceiptBody, type ReceiptFormValues } from './rules';

export function ReceiptForm({
  title,
  state,
  blocked,
}: {
  title: Receivable;
  state: FinancialState;
  blocked: boolean;
}) {
  const { user, tenantId, permissions } = useSession();
  const tenant = useTenant();
  const scope = intentScope(user!.uid, tenantId!, 'receipt', title.orderId);
  const pending = usePendingIntent(scope);
  const otherIntent = useOtherOrderIntent(user!.uid, tenantId!, title.orderId, 'receipt');
  const pendingAdministration = usePendingIntent(
    intentScope(user!.uid, tenantId!, 'finance-command', title.orderId),
  );
  const receipt = useReceipt(title.orderId, scope);
  const methods = useMethodOptions(permissions.includes('payments:manage'));
  const [review, setReview] = useState<ReceiptInput | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const { control, handleSubmit, setValue, reset } = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: { amountCents: 0, methodId: '', receivedOn: '', reference: '', reason: '' },
  });
  if (!permissions.includes('payments:manage')) return null;
  const current = state.titles.find((t) => t.id === title.id);
  const locked =
    blocked ||
    !current ||
    current.outstandingCents === 0 ||
    receipt.isPending ||
    Boolean(pending) ||
    Boolean(pendingAdministration) ||
    Boolean(otherIntent);
  const send = (body: ReceiptInput) =>
    receipt.mutate(body, {
      onSuccess: () => {
        reset();
        setLocalError(null);
      },
      onSettled: () => setReview(null),
    });
  return (
    <FormSection
      title="Registrar recebimento"
      description="Registra dinheiro recebido nesta parcela. Não realiza cobrança bancária."
    >
      {otherIntent && !pendingAdministration ? (
        <Alert tone="warning" title="Resolução financeira pendente">
          Consulte acompanhamento financeiro. Nenhuma nova baixa será enviada enquanto esta intenção
          estiver pendente.
        </Alert>
      ) : null}
      {pendingAdministration ? (
        <Alert tone="warning" title="Outra operação financeira ainda desconhecida">
          Recupere crédito, estorno ou reembolso na administração financeira do pedido antes de
          registrar outra baixa.
        </Alert>
      ) : null}
      {pending ? (
        <Alert
          tone="warning"
          title="Resultado desconhecido"
          action={
            <Button
              label="Repetir mesma baixa"
              variant="outline"
              loading={receipt.isPending}
              onPress={() => send(pending.body as ReceiptInput)}
            />
          }
        >
          {`Pode ter sido registrado ${formatCents(Number(pending.body.amountCents))} em ${String(pending.body.receivedOn)}, motivo: ${String(pending.body.reason)}. Corpo e chave estão preservados para este pedido. Repetir recupera a resposta original sem duplicar. Confira o histórico.`}
        </Alert>
      ) : null}
      {receipt.isError && !pending ? (
        <Alert
          tone="danger"
          title="Recebimento não confirmado"
        >{`${toApiError(receipt.error).code}: ${toApiError(receipt.error).userMessage}`}</Alert>
      ) : null}
      {receipt.isSuccess ? (
        <Alert
          tone="success"
          title="Recebimento confirmado"
        >{`${formatCents(receipt.data.amountCents)} · operação ${receipt.data.operationId}. Saldos atuais são recarregados do servidor.`}</Alert>
      ) : null}
      {blocked ? (
        <Alert tone="warning" title="Recebimento bloqueado">
          Há pendência financeira, devolução ativa ou consulta ainda não confirmada. Confira estado
          oficial antes de registrar.
        </Alert>
      ) : null}
      {methods.isError ? (
        <Alert
          tone="danger"
          title="Formas indisponíveis"
          action={<Button label="Recarregar formas" onPress={() => methods.refetch()} />}
        >
          {toApiError(methods.error).userMessage}
        </Alert>
      ) : null}
      <FieldRow>
        <Controller
          control={control}
          name="amountCents"
          render={({ field, fieldState }) => (
            <CurrencyInput
              label="Valor recebido"
              value={field.value}
              onChange={field.onChange}
              maxCents={Number.MAX_SAFE_INTEGER}
              editable={!locked}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="methodId"
          render={({ field, fieldState }) => (
            <Select
              label="Forma efetiva"
              value={field.value || null}
              options={(methods.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
              onChange={field.onChange}
              disabled={locked || methods.isPending || methods.isError}
              error={fieldState.error?.message}
            />
          )}
        />
      </FieldRow>
      <View style={styles.actions}>
        <Button
          label="Receber saldo total"
          variant="outline"
          disabled={locked}
          onPress={() => current && setValue('amountCents', current.outstandingCents)}
        />
        <Button
          label="Usar data de hoje"
          variant="ghost"
          disabled={locked || !tenant.data}
          onPress={() => tenant.data && setValue('receivedOn', todayIn(tenant.data.timezone))}
        />
      </View>
      <FieldRow>
        <Controller
          control={control}
          name="receivedOn"
          render={({ field, fieldState }) => (
            <TextField
              label="Recebido em"
              placeholder="AAAA-MM-DD"
              value={field.value}
              onChangeText={field.onChange}
              editable={!locked}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="reference"
          render={({ field, fieldState }) => (
            <TextField
              label="Referência"
              optional
              value={field.value}
              onChangeText={field.onChange}
              maxLength={200}
              editable={!locked}
              error={fieldState.error?.message}
            />
          )}
        />
      </FieldRow>
      <Controller
        control={control}
        name="reason"
        render={({ field, fieldState }) => (
          <TextField
            label="Motivo do recebimento"
            value={field.value}
            onChangeText={field.onChange}
            maxLength={500}
            editable={!locked}
            error={fieldState.error?.message}
          />
        )}
      />
      {localError ? (
        <Alert tone="warning" title="Revise a baixa">
          {localError}
        </Alert>
      ) : null}
      <Button
        label="Revisar recebimento"
        variant="strong"
        disabled={locked || methods.isPending || methods.isError}
        onPress={handleSubmit((values) => {
          const method = methods.data?.find((m) => m.id === values.methodId);
          if (!method) {
            setLocalError('Selecione forma ativa disponível');
            return;
          }
          try {
            setReview(toReceiptBody(values, state, title.id, method));
            setLocalError(null);
            receipt.reset();
          } catch (error) {
            setLocalError(error instanceof Error ? error.message : 'Revise os dados');
          }
        })}
      />
      <ConfirmDialog
        visible={review !== null}
        title="Confirmar recebimento?"
        description="Confira valor, parcela e forma efetiva. Servidor valida saldos e versões antes de registrar."
        confirmLabel="Registrar baixa"
        tone="strong"
        loading={receipt.isPending}
        onCancel={() => setReview(null)}
        onConfirm={() => review && send(review)}
      >
        {review ? (
          <View style={styles.actions}>
            <Text>{`${title.customerName} · ${title.installmentNumber}ª parcela · ${formatCents(review.amountCents)}`}</Text>
            <Text>{`Forma: ${methods.data?.find((m) => m.id === review.methodId)?.name ?? review.methodId}`}</Text>
            <Text>{`Data: ${review.receivedOn} · Motivo: ${review.reason}`}</Text>
            {review.reference ? <Text>{`Referência: ${review.reference}`}</Text> : null}
          </View>
        ) : null}
      </ConfirmDialog>
    </FormSection>
  );
}
const styles = StyleSheet.create({ actions: { gap: space[2], paddingVertical: space[2] } });
