import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { toApiError } from '@/api/errors';
import type { FinancialState, Order, ReturnPreview, ReturnResolutionInput } from '@/api/types';
import { FormSection } from '@/features/catalog/FormParts';
import { executionPublished } from '@/features/orders/rules';
import { intentScope, useOtherOrderIntent, usePendingIntent } from '@/lib/intent';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { Alert, Button, CurrencyInput, Select, Text, TextField } from '@/ui';
import { canManageFinance } from './FinanceAccess';
import { useResolution } from './resolutionApi';
import { type ResolutionCommand } from './resolutionCommands';
import { cancellationBody, dispositionOptions, returnResolutionBody } from './resolutionRules';
import { ResolutionConfirmation } from './ResolutionConfirmation';

type DamageChoice = 'full' | 'partial' | 'zero' | 'reject';
export function ResolutionForm(props: {
  order: Order;
  state: FinancialState;
  blocked: boolean;
  preview?: ReturnPreview;
}) {
  const session = useSession(),
    { order, state, preview, blocked } = props;
  const scope = intentScope(session.user!.uid, session.tenantId!, 'finance-resolution', order.id);
  const pending = usePendingIntent(scope);
  const other = useOtherOrderIntent(
    session.user!.uid,
    session.tenantId!,
    order.id,
    'finance-resolution',
  );
  const mutation = useResolution(scope);
  const [disposition, setDisposition] = useState<'customer_credit' | 'refund'>('customer_credit');
  const [mode, setMode] = useState<'atomic' | 'start'>('atomic');
  const [reason, setReason] = useState(''),
    [error, setError] = useState<string | null>(null);
  const [damage, setDamage] = useState<Record<string, { choice: DamageChoice; cents: number }>>({});
  const [review, setReview] = useState<ResolutionCommand | null>(null);
  const permission = preview ? 'returns:manage' : 'financial-cancellation:manage';
  if (!canManageFinance(session, permission)) return null;
  if (!preview && order.status !== 'confirmed' && !pending)
    return <Text>Cancelamento financeiro exige pedido confirmado e não expedido.</Text>;
  const frozen =
    blocked ||
    Boolean(other) ||
    Boolean(pending) ||
    mutation.isPending ||
    Boolean(preview && !preview.lines.length);
  function build() {
    try {
      setError(null);
      let command: ResolutionCommand;
      if (preview) {
        const decisions: NonNullable<ReturnResolutionInput['damagedDecisions']> = preview.lines
          .filter((l) => Number(l.damagedQuantity) > 0)
          .map((l) => {
            const d = damage[l.lineId];
            if (!d) throw new Error('Decida cada dano recebido antes de revisar.');
            return {
              lineId: l.lineId,
              accept: d.choice !== 'reject',
              ...(d.choice === 'full'
                ? {}
                : { acceptedCents: d.choice === 'partial' ? d.cents : 0 }),
            };
          });
        command = {
          kind: mode === 'atomic' ? 'return-atomic' : 'return-start',
          id: preview.returnId,
          orderId: order.id,
          body: returnResolutionBody(preview, disposition, reason, decisions),
        };
      } else
        command = {
          kind: mode === 'atomic' ? 'cancel-atomic' : 'cancel-start',
          id: order.id,
          orderId: order.id,
          body: cancellationBody(order, state, { disposition, reason }),
        };
      setReview(command);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decisão inválida');
    }
  }
  const data = mutation.data;
  return (
    <FormSection
      title={preview ? 'Resolver recebido físico existente' : 'Cancelamento financeiro'}
      description="Backend abate dívida, restaura fontes e destina caixa elegível. Estoque e saldos são oficiais."
    >
      {preview && !preview.lines.length ? (
        <Text>Nenhum recebido elegível no preview atual. Consulte estado oficial e histórico.</Text>
      ) : null}
      {data ? (
        'financialCompleted' in data ? (
          <Alert
            tone={executionPublished(data) ? 'success' : 'info'}
            title={
              executionPublished(data)
                ? 'Publicação financeira confirmada'
                : 'Execução aceita; ainda pendente'
            }
          >
            <Link href={`/financeiro/execucoes/${data.id}` as Href} asChild>
              <Button label="Acompanhar execução" variant="outline" />
            </Link>
          </Alert>
        ) : (
          <Alert tone="success" title="Resolução atômica confirmada">
            <Text>{`Valor oficial ${formatCents(data.amountCents)}`}</Text>
          </Alert>
        )
      ) : null}
      {pending ? (
        <Alert
          tone="warning"
          title={pending.executionId ? 'Execução registrada' : 'Resultado desconhecido preservado'}
        >
          {pending.executionId ? (
            <Link href={`/financeiro/execucoes/${pending.executionId}` as Href} asChild>
              <Button label="Consultar execução existente" />
            </Link>
          ) : (
            <Button
              label="Revisar intenção original"
              disabled={mutation.isPending}
              onPress={() => setReview(pending.body as ResolutionCommand)}
            />
          )}
        </Alert>
      ) : null}
      {other ? (
        <Alert tone="warning" title="Outra intenção financeira pendente">
          Resolva a intenção original antes de nova operação.
        </Alert>
      ) : null}
      {mutation.isError ? (
        <Alert tone="danger" title="Resolução não confirmada">
          <Text>{`${toApiError(mutation.error).code}: ${toApiError(mutation.error).userMessage}`}</Text>
          {toApiError(mutation.error).code === 'FINANCIAL_RESUMABLE_REQUIRED' ? (
            <Button
              label="Revisar caminho retomável"
              onPress={() => {
                setMode('start');
                mutation.reset();
              }}
            />
          ) : null}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Revise decisão">
          {error}
        </Alert>
      ) : null}
      <Select
        label="Destino do caixa elegível"
        value={disposition}
        options={dispositionOptions}
        onChange={setDisposition}
        disabled={frozen}
      />
      <Select
        label="Modo de resolução"
        value={mode}
        options={[
          { value: 'atomic', label: 'Atômico para histórico pequeno' },
          { value: 'start', label: 'Retomável com acompanhamento manual' },
        ]}
        onChange={setMode}
        disabled={frozen}
      />
      <TextField
        label="Justificativa da resolução"
        value={reason}
        onChangeText={setReason}
        maxLength={500}
        editable={!frozen}
        multiline
      />
      {preview ? (
        preview.lines.map((l) => (
          <FormSection key={l.lineId} title={`Linha ${l.lineId}`}>
            <Text>{`Recebido elegível: vendável ${l.sellableQuantity} · danificado ${l.damagedQuantity}`}</Text>
            <Text>{`Abatimento vendável oficial ${formatCents(l.sellableCents)} · limite do dano ${formatCents(l.damagedLimitCents)}`}</Text>
            {Number(l.damagedQuantity) > 0 ? (
              <>
                <Select
                  label={`Decisão do dano ${l.lineId}`}
                  value={damage[l.lineId]?.choice ?? null}
                  options={[
                    { value: 'full', label: 'Aceitar limite integral' },
                    { value: 'partial', label: 'Aceitar valor parcial' },
                    { value: 'zero', label: 'Aceitar quantidade com valor zero' },
                    { value: 'reject', label: 'Rejeitar abatimento do dano' },
                  ]}
                  onChange={(choice) =>
                    setDamage((d) => ({
                      ...d,
                      [l.lineId]: { choice, cents: d[l.lineId]?.cents ?? 0 },
                    }))
                  }
                  disabled={frozen}
                />
                {damage[l.lineId]?.choice === 'partial' ? (
                  <CurrencyInput
                    label={`Valor aceito ${l.lineId}`}
                    value={damage[l.lineId]!.cents}
                    maxCents={l.damagedLimitCents}
                    onChange={(cents) =>
                      setDamage((d) => ({ ...d, [l.lineId]: { choice: 'partial', cents } }))
                    }
                    editable={!frozen}
                  />
                ) : null}
              </>
            ) : null}
          </FormSection>
        ))
      ) : (
        <>
          <Text>{`Caixa liquidado ${formatCents(state.cashSettledCents)} · crédito liquidado ${formatCents(state.creditSettledCents)}`}</Text>
          {state.titles.map((t) => (
            <Text
              key={t.id}
            >{`Parcela ${t.installmentNumber}: dívida ${formatCents(t.outstandingCents)} · cancelado ${formatCents(t.canceledCents)}`}</Text>
          ))}
        </>
      )}
      <Button label="Revisar resolução financeira" onPress={build} disabled={frozen} />
      {review ? (
        <ResolutionConfirmation
          command={review}
          busy={mutation.isPending}
          error={mutation.error}
          onReauth={mutation.reset}
          onCancel={() => setReview(null)}
          onSend={() => mutation.mutate(review, { onSuccess: () => setReview(null) })}
        >
          <Text>{`Cliente ${order.customerName ?? order.customerId ?? 'identificado no pedido'} · total oficial do pedido ${formatCents(order.totalCents)}`}</Text>
          {!preview ? (
            <Text>
              Cancelamento não expedido libera reservas do pedido. Servidor confirma estoque e
              destinação.
            </Text>
          ) : null}
          {!preview ? (
            <Text>{`Caixa liquidado oficial ${formatCents(state.cashSettledCents)} · crédito aplicado oficial ${formatCents(state.creditSettledCents)}`}</Text>
          ) : null}
        </ResolutionConfirmation>
      ) : null}
    </FormSection>
  );
}
