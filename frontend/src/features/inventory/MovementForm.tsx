import { useMemo, useState } from 'react';
import { Link, router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ApiError } from '@/api/errors';
import type { StockAdjustmentBody, StockAdmin, StockEntryBody } from '@/api/types';
import { FieldRow, FormActions, FormSection } from '@/features/catalog/FormParts';
import { formatQuantity, fromApiQuantity, unitLabel } from '@/lib/quantity';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, ConfirmDialog, Panel, Segmented, Text, TextField, useToast } from '@/ui';
import { useRecordMovement } from './api';
import {
  intentLedger,
  intentScope,
  outcomeOf,
  usePendingIntent,
  type MovementKind,
} from '@/lib/intent';
import {
  deltaMilli,
  emptyMovementForm,
  movementFormSchema,
  toAdjustmentBody,
  toEntryBody,
  type AdjustDirection,
  type MovementFormValues,
} from './movementRules';
import { figuresOf, isFractionalUnit, previewBalance, type BalancePreview } from './stock';

const copy = {
  entry: {
    review: 'Revisar entrada',
    confirmTitle: 'Confirmar entrada?',
    confirm: 'Registrar entrada',
    done: 'Entrada registrada',
    reasonHint: 'Ex.: Nota fiscal 1234 do fornecedor. Fica no histórico.',
  },
  adjustment: {
    review: 'Revisar ajuste',
    confirmTitle: 'Confirmar ajuste?',
    confirm: 'Registrar ajuste',
    done: 'Ajuste registrado',
    reasonHint: 'Ex.: Contagem do dia 10, avaria, vencimento. Fica no histórico.',
  },
} as const;

type Review = {
  body: StockEntryBody | StockAdjustmentBody;
  delta: number;
  preview: Extract<BalancePreview, { ok: true }>;
};

/**
 * Formulário de entrada ou ajuste de UM produto (o saldo já carregado). Fluxo: preencher →
 * revisar o impacto → confirmar → aguardar a API. Sucesso só aparece com a confirmação do
 * servidor; resultado incerto trava o formulário até repetir com a mesma chave ou descartar.
 */
export function MovementForm({ kind, stock }: { kind: MovementKind; stock: StockAdmin }) {
  const { user } = useSession();
  const { tenantId } = useTenantApi();
  const toast = useToast();
  const record = useRecordMovement();
  const scope = intentScope(user?.uid ?? '', tenantId, kind, stock.productId);
  const pending = usePendingIntent(scope);
  const [review, setReview] = useState<Review | null>(null);
  const [discard, setDiscard] = useState(false);
  const unit = stock.unit;
  const current = figuresOf(stock);
  const text = copy[kind];

  const schema = useMemo(() => movementFormSchema(unit), [unit]);
  const { control, handleSubmit } = useForm<MovementFormValues>({
    defaultValues: emptyMovementForm,
    resolver: zodResolver(schema),
  });
  const values = useWatch({ control }) as MovementFormValues;
  const delta = deltaMilli({ ...emptyMovementForm, ...values }, unit, kind);
  const live = delta !== 0 ? previewBalance(current, delta) : null;

  const busy = record.isPending;
  const locked = busy || Boolean(pending);
  const lastError = record.isError ? outcomeOf(record.error) : null;

  const onReview = handleSubmit((v) => {
    const d = deltaMilli(v, unit, kind);
    const preview = previewBalance(current, d);
    if (!preview.ok) return;
    const body =
      kind === 'entry'
        ? toEntryBody(stock.productId, v, unit)
        : toAdjustmentBody(stock.productId, v, unit, stock.version);
    record.reset();
    setReview({ body, delta: d, preview });
  });

  const send = (body: StockEntryBody | StockAdjustmentBody) =>
    record.mutate(
      kind === 'entry'
        ? { kind, scope, body: body as StockEntryBody }
        : { kind, scope, body: body as StockAdjustmentBody },
      {
        onSuccess: (result) => {
          const moved = fromApiQuantity(result.movement.quantity);
          const sign = result.movement.type === 'STOCK_ADJUSTMENT_OUT' ? '−' : '+';
          toast.show(`${text.done}: ${sign}${formatQuantity(moved, unit)}`);
          router.replace(`/estoque/${stock.productId}` as Href);
        },
        onSettled: () => setReview(null),
      },
    );

  const insufficient =
    live && !live.ok && live.reason === 'insufficient'
      ? current.reserved > 0
        ? `Só é possível retirar até ${formatQuantity(current.available, unit)}: o restante (${formatQuantity(current.reserved, unit)}) está reservado para pedidos.`
        : `Só é possível retirar até ${formatQuantity(current.available, unit)}, o saldo físico atual.`
      : live && !live.ok && live.reason === 'limit'
        ? 'O saldo ultrapassaria o limite técnico de 1.000.000.000.'
        : null;

  return (
    <>
      {pending ? (
        <PendingNotice
          kind={kind}
          unit={unit}
          body={pending.body}
          productId={stock.productId}
          retrying={busy}
          onRetry={() => send(pending.body as StockEntryBody | StockAdjustmentBody)}
          onDiscard={() => setDiscard(true)}
        />
      ) : lastError?.status === 'rejected' ? (
        <RejectedNotice kind={kind} error={lastError.error} />
      ) : null}

      <FormSection
        title={kind === 'entry' ? 'Entrada de mercadoria' : 'Ajuste de saldo'}
        description={
          kind === 'entry'
            ? 'Soma ao saldo físico. O reservado não muda.'
            : 'Corrige o saldo físico para cima ou para baixo. O reservado para pedidos não muda.'
        }
      >
        {kind === 'adjustment' ? (
          <Controller
            control={control}
            name="direction"
            render={({ field }) => (
              <View style={styles.direction}>
                <Text variant="smallStrong">Tipo de ajuste</Text>
                <Segmented<AdjustDirection>
                  label="Tipo de ajuste"
                  value={field.value}
                  onChange={(v) => !locked && field.onChange(v)}
                  options={[
                    { value: 'in', label: 'Acrescentar ao físico' },
                    { value: 'out', label: 'Retirar do físico' },
                  ]}
                />
              </View>
            )}
          />
        ) : null}
        <FieldRow weights={[1, 2]}>
          <Controller
            control={control}
            name="quantity"
            render={({ field, fieldState }) => (
              <TextField
                label="Quantidade"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                editable={!locked}
                inputMode={isFractionalUnit(unit) ? 'decimal' : 'numeric'}
                keyboardType={isFractionalUnit(unit) ? 'decimal-pad' : 'number-pad'}
                hint={
                  isFractionalUnit(unit)
                    ? `Em ${unitLabel[unit]}, até 3 casas decimais.`
                    : `Em ${unitLabel[unit]}, somente inteiros.`
                }
                error={fieldState.error?.message ?? insufficient ?? undefined}
                trailing={
                  <Text variant="small" color={color.textSecondary}>
                    {unitLabel[unit]}
                  </Text>
                }
              />
            )}
          />
          <Controller
            control={control}
            name="reason"
            render={({ field, fieldState }) => (
              <TextField
                label="Motivo"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                editable={!locked}
                maxLength={200}
                hint={text.reasonHint}
                error={fieldState.error?.message}
              />
            )}
          />
        </FieldRow>
        <Controller
          control={control}
          name="notes"
          render={({ field, fieldState }) => (
            <TextField
              label="Observação"
              optional
              multiline
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              editable={!locked}
              maxLength={1000}
              error={fieldState.error?.message}
              style={styles.multiline}
            />
          )}
        />
      </FormSection>

      <Panel title="Impacto no saldo" description="Prévia. O servidor confirma o saldo final.">
        <ImpactTable
          unit={unit}
          before={current}
          after={live?.ok ? live : null}
          showReserved={kind === 'adjustment' || current.reserved > 0}
        />
      </Panel>

      <FormActions>
        <Link href={`/estoque/${stock.productId}` as Href} asChild>
          <Button label="Cancelar" variant="ghost" disabled={busy} />
        </Link>
        <Button
          label={text.review}
          variant="strong"
          disabled={locked || Boolean(insufficient)}
          onPress={onReview}
        />
      </FormActions>

      <ConfirmDialog
        visible={review !== null}
        title={text.confirmTitle}
        description={`${stock.name} (${stock.sku}). Confira antes de registrar: a movimentação entra no histórico e não pode ser apagada.`}
        confirmLabel={text.confirm}
        tone="strong"
        loading={busy}
        onCancel={() => setReview(null)}
        onConfirm={() => review && send(review.body)}
      >
        {review ? (
          <View style={styles.review}>
            <ReviewLine
              label={kind === 'entry' ? 'Entrada' : review.delta > 0 ? 'Acrescentar' : 'Retirar'}
              value={formatQuantity(Math.abs(review.delta), unit)}
            />
            <ReviewLine label="Motivo" value={review.body.reason} />
            {review.body.notes ? <ReviewLine label="Observação" value={review.body.notes} /> : null}
            <ImpactTable
              unit={unit}
              before={current}
              after={review.preview}
              showReserved={current.reserved > 0 || kind === 'adjustment'}
            />
          </View>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        visible={discard}
        title="Descartar a tentativa pendente?"
        description="Descarte só depois de conferir no histórico que a movimentação NÃO aparece. Se ela foi gravada, registrar de novo vai duplicar o saldo."
        confirmLabel="Descartar tentativa"
        onCancel={() => setDiscard(false)}
        onConfirm={() => {
          intentLedger.clear(scope);
          record.reset();
          setDiscard(false);
        }}
      />
    </>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewLine}>
      <Text variant="small" color={color.textSecondary}>
        {label}
      </Text>
      <Text variant="bodyStrong" selectable>
        {value}
      </Text>
    </View>
  );
}

/** Antes → depois para físico, reservado e disponível. */
function ImpactTable({
  unit,
  before,
  after,
  showReserved,
}: {
  unit: StockAdmin['unit'];
  before: { physical: number; reserved: number; available: number };
  after: { physical: number; reserved: number; available: number } | null;
  showReserved: boolean;
}) {
  const rows = [
    { label: 'Físico', from: before.physical, to: after?.physical },
    ...(showReserved ? [{ label: 'Reservado', from: before.reserved, to: after?.reserved }] : []),
    { label: 'Disponível', from: before.available, to: after?.available },
  ];
  return (
    <View style={styles.impact}>
      {rows.map((r) => (
        <View
          key={r.label}
          style={styles.impactRow}
          accessible
          accessibilityLabel={
            r.to === undefined
              ? `${r.label}: ${formatQuantity(r.from, unit)}`
              : `${r.label}: de ${formatQuantity(r.from, unit)} para ${formatQuantity(r.to, unit)}`
          }
        >
          <Text variant="small" color={color.textSecondary} style={styles.impactLabel}>
            {r.label}
          </Text>
          <Text variant="figure">{formatQuantity(r.from, unit)}</Text>
          {r.to !== undefined ? (
            <>
              <Text variant="small" color={color.textSecondary}>
                →
              </Text>
              <Text variant="figure" color={r.to === r.from ? color.textSecondary : color.text}>
                {formatQuantity(r.to, unit)}
              </Text>
            </>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function rejectedMessage(kind: MovementKind, error: ApiError): { title: string; body: string } {
  switch (error.code) {
    case 'CONFLICT':
      return kind === 'adjustment'
        ? {
            title: 'O saldo mudou antes da confirmação',
            body: 'Outra movimentação alterou este estoque. Os saldos foram atualizados: revise o impacto e confirme de novo.',
          }
        : {
            title: 'Entrada não registrada',
            body: 'O servidor recusou a repetição desta operação. Revise os dados e confirme de novo.',
          };
    case 'INSUFFICIENT_STOCK':
      return {
        title: 'Saldo insuficiente',
        body: 'O disponível mudou e não comporta esta retirada. Os saldos foram atualizados: revise a quantidade.',
      };
    case 'RESOURCE_NOT_FOUND':
      return {
        title: 'Produto não encontrado',
        body: 'O produto não está mais disponível para esta empresa.',
      };
    default:
      return {
        title: kind === 'entry' ? 'Entrada não registrada' : 'Ajuste não registrado',
        body: error.userMessage,
      };
  }
}

function RejectedNotice({ kind, error }: { kind: MovementKind; error: ApiError }) {
  const m = rejectedMessage(kind, error);
  return (
    <Alert tone={error.kind === 'conflict' ? 'warning' : 'danger'} title={m.title}>
      {`${m.body} Nada foi gravado.`}
    </Alert>
  );
}

/**
 * Resultado desconhecido (sem resposta, timeout ou erro do servidor). Repetir usa a mesma chave:
 * se a primeira tentativa foi gravada, o servidor devolve o mesmo resultado sem duplicar.
 */
function PendingNotice({
  kind,
  unit,
  body,
  productId,
  retrying,
  onRetry,
  onDiscard,
}: {
  kind: MovementKind;
  unit: StockAdmin['unit'];
  body: Record<string, unknown>;
  productId: string;
  retrying: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const amount = String(body.quantity ?? body.delta ?? '0');
  const milli = fromApiQuantity(amount);
  return (
    <Alert
      tone="warning"
      title={
        kind === 'entry'
          ? 'Não sabemos se a entrada foi registrada'
          : 'Não sabemos se o ajuste foi registrado'
      }
      action={
        <View style={styles.pendingActions}>
          <Button
            label="Tentar de novo"
            size="sm"
            variant="strong"
            loading={retrying}
            onPress={onRetry}
          />
          <Link href={`/estoque/movimentacoes?produto=${productId}` as Href} asChild>
            <Button label="Ver histórico" size="sm" variant="outline" disabled={retrying} />
          </Link>
          <Button
            label="Descartar"
            size="sm"
            variant="ghost"
            disabled={retrying}
            onPress={onDiscard}
          />
        </View>
      }
    >
      {`A conexão falhou antes da resposta (${milli < 0 ? '−' : '+'}${formatQuantity(Math.abs(milli), unit)}, motivo "${String(body.reason)}"). Tentar de novo é seguro: se já foi gravada, não duplica.`}
    </Alert>
  );
}

const styles = StyleSheet.create({
  direction: { gap: space[2] },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  review: { gap: space[3] },
  reviewLine: { gap: 2 },
  impact: { gap: space[2], paddingTop: space[1] },
  impactRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], flexWrap: 'wrap' },
  impactLabel: { width: 88 },
  pendingActions: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
});
