import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toApiError } from '@/api/errors';
import { unwrap } from '@/api/client';
import type { Order, OrderUpdate } from '@/api/types';
import { FieldRow, FormSection } from '@/features/catalog/FormParts';
import { useUpdateOrder } from '@/features/orders/api';
import { formatCents } from '@/lib/money';
import { intentLedger, intentScope, outcomeOf, usePendingIntent } from '@/lib/intent';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { Alert, Button, ConfirmDialog, CurrencyInput, Select, Text, TextField } from '@/ui';
import { canManageFinance } from './FinanceAccess';
import { discountBody, discountFormSchema } from './administrationRules';

/** PATCH de pedido não oferece Idempotency-Key. Nunca renovar expectedVersion para repetir resposta perdida. */
export function DiscountPanel({ order }: { order: Order }) {
  const session = useSession();
  const { api, header } = useTenantApi();
  const scope = intentScope(session.user!.uid, session.tenantId!, 'order-discount', order.id);
  const pending = usePendingIntent(scope);
  const update = useUpdateOrder(order.id);
  const [basisVersion, setBasisVersion] = useState(order.version);
  const [review, setReview] = useState<OrderUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { control, handleSubmit, reset } = useForm({
    resolver: zodResolver(discountFormSchema),
    defaultValues: {
      type: order.discount?.type ?? 'fixed',
      value: order.discount?.value ?? 0,
      reason: order.discount?.reason ?? '',
    },
  });
  const discountType = useWatch({ control, name: 'type' });
  if (!canManageFinance(session, 'discounts:apply')) return null;
  if (order.status !== 'draft')
    return (
      <FormSection title="Desconto histórico">
        <Text>{`${formatCents(order.discountCents)}. Pedido ${order.status}: aprovação e valores confirmados não podem ser alterados por esta tela.`}</Text>
      </FormSection>
    );
  const locked = update.isPending || Boolean(pending) || checking;
  const send = async (body: OrderUpdate) => {
    if (!canManageFinance(session, 'discounts:apply')) {
      setNotice('Seu vínculo não autoriza aprovação de desconto.');
      return;
    }
    setChecking(true);
    try {
      await intentLedger.prepare(scope, body);
      const saved = await update.mutateAsync(body);
      await intentLedger.finish(scope);
      setBasisVersion(saved.version);
      setReview(null);
      setNotice(
        'Desconto confirmado pelo servidor. Qualquer edição posterior do rascunho exige nova aprovação.',
      );
    } catch (error) {
      if (outcomeOf(error).status === 'unknown' || pending) intentLedger.markUnknown(scope);
      else await intentLedger.reject(scope);
      setReview(null);
      setNotice(toApiError(error).userMessage);
    } finally {
      setChecking(false);
    }
  };
  return (
    <FormSection
      title="Desconto administrativo"
      description="Somente rascunho. O servidor aprova, distribui desconto, calcula parcelas e registra snapshot."
    >
      {notice ? (
        <Alert tone="info" title="Estado do desconto">
          {notice}
        </Alert>
      ) : null}
      {pending ? (
        <Alert
          tone="warning"
          title="Desconto com resultado desconhecido"
          action={
            <Button
              label="Conferir desconto oficial"
              loading={checking}
              onPress={async () => {
                setChecking(true);
                setNotice(null);
                try {
                  const official = await unwrap(
                    api.GET('/api/v1/orders/{id}', { params: { header, path: { id: order.id } } }),
                  );
                  const body = pending.body as OrderUpdate;
                  const wanted = body.discount;
                  const confirmed =
                    official.version === body.expectedVersion + 1 &&
                    official.updatedBy === session.user!.uid &&
                    (wanted === null
                      ? official.discount === null
                      : wanted &&
                        official.discount?.type === wanted.type &&
                        official.discount.value === wanted.value &&
                        official.discount.reason === wanted.reason &&
                        official.discount.approvedVersion === body.expectedVersion + 1 &&
                        official.discount.approvedBy === session.user!.uid);
                  if (confirmed) {
                    await intentLedger.finish(scope);
                    setBasisVersion(official.version);
                    setNotice('Estado oficial confirma desconto solicitado. Não houve novo PATCH.');
                  } else if (
                    official.status === 'draft' &&
                    official.version === body.expectedVersion
                  ) {
                    setReview(body);
                    setNotice(
                      'Estado oficial ainda tem versão original. A repetição explícita usa essa mesma versão, sem renovar aprovação.',
                    );
                  } else
                    setNotice(
                      'Estado mudou e não comprova esta tentativa. Confira histórico do pedido; nenhuma nova aprovação será enviada.',
                    );
                } catch (error) {
                  setNotice(toApiError(error).userMessage);
                } finally {
                  setChecking(false);
                }
              }}
            />
          }
        >
          Chave local e payload estão preservados para conferência. PATCH não tem replay por chave;
          repetição exige consulta oficial e versão original.
        </Alert>
      ) : null}
      {update.isError ? (
        <Alert
          tone="danger"
          title="Desconto não confirmado"
        >{`${toApiError(update.error).code}: ${toApiError(update.error).userMessage}`}</Alert>
      ) : null}
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <Select
            label="Tipo de desconto"
            value={field.value}
            options={[
              { value: 'fixed', label: 'Valor fixo em centavos' },
              { value: 'percentage', label: 'Percentual em pontos base' },
            ]}
            onChange={field.onChange}
            disabled={locked}
          />
        )}
      />
      <FieldRow>
        <Controller
          control={control}
          name="value"
          render={({ field, fieldState }) => (
            <DiscountValue
              value={field.value}
              error={fieldState.error?.message}
              onChange={field.onChange}
              disabled={locked}
              controlType={discountType}
            />
          )}
        />
        <Controller
          control={control}
          name="reason"
          render={({ field, fieldState }) => (
            <TextField
              label="Justificativa do desconto"
              value={field.value}
              onChangeText={field.onChange}
              editable={!locked}
              maxLength={200}
              error={fieldState.error?.message}
            />
          )}
        />
      </FieldRow>
      <Button
        label="Revisar desconto"
        variant="strong"
        disabled={locked}
        onPress={handleSubmit((v) => {
          update.reset();
          setReview(discountBody(basisVersion, v));
        })}
      />
      <Button
        label="Retirar desconto do rascunho"
        variant="outline"
        disabled={locked || !order.discount}
        onPress={() => {
          update.reset();
          setReview({ expectedVersion: basisVersion, discount: null });
        }}
      />
      <Button
        label="Usar rascunho atual"
        variant="ghost"
        disabled={locked}
        onPress={() => {
          setBasisVersion(order.version);
          reset({
            type: order.discount?.type ?? 'fixed',
            value: order.discount?.value ?? 0,
            reason: order.discount?.reason ?? '',
          });
          setNotice('Campos e versão recarregados do pedido atual. Revise antes de aprovar.');
        }}
      />
      <Text>{`Versão revisada: ${basisVersion} · subtotal oficial ${formatCents(order.subtotalCents)}`}</Text>
      <ConfirmDialog
        visible={review !== null}
        title="Confirmar desconto administrativo?"
        description="Esta aprovação altera apenas rascunho. O servidor decide limite, parcelas e snapshots; novas edições invalidam aprovação."
        confirmLabel="Aprovar desconto"
        tone="strong"
        loading={update.isPending}
        onCancel={() => setReview(null)}
        onConfirm={() => {
          if (review && order.status === 'draft') send(review);
          else {
            setNotice('Pedido deixou de ser rascunho. Confira estado oficial.');
            setReview(null);
          }
        }}
      >
        {review ? (
          <Text>
            {review.discount
              ? `${review.discount.type === 'fixed' ? formatCents(review.discount.value) : `${review.discount.value} pontos base`} · ${review.discount.reason}`
              : 'Remover desconto'}
          </Text>
        ) : null}
      </ConfirmDialog>
    </FormSection>
  );
}
function DiscountValue({
  value,
  error,
  onChange,
  disabled,
  controlType,
}: {
  value: number;
  error?: string;
  onChange: (n: number) => void;
  disabled: boolean;
  controlType: string;
}) {
  return controlType === 'fixed' ? (
    <CurrencyInput
      label="Valor do desconto"
      value={value}
      onChange={onChange}
      editable={!disabled}
      error={error}
    />
  ) : (
    <TextField
      label="Percentual em pontos base"
      value={String(value)}
      onChangeText={(v) => onChange(Number(v))}
      editable={!disabled}
      inputMode="numeric"
      hint="1000 = 10%; máximo 10000 = 100%"
      error={error}
    />
  );
}
