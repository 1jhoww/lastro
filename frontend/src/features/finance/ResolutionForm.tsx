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
      setError(friendlyResolutionError(e));
    }
  }
  const data = mutation.data;
  return (
    <FormSection
      title={preview ? 'Acertar o que foi devolvido' : 'Cancelar pedido no financeiro'}
      description="O Lastro calcula os valores: abate o que está em aberto e destina o que já foi pago."
    >
      {preview && !preview.lines.length ? (
        <Text variant="small">
          Nada recebido fisicamente aguarda acerto agora. Confira o histórico abaixo.
        </Text>
      ) : null}
      {data ? (
        'financialCompleted' in data ? (
          <Alert
            tone={executionPublished(data) ? 'success' : 'info'}
            title={
              executionPublished(data)
                ? 'Operação concluída'
                : 'Operação iniciada, ainda não concluída'
            }
          >
            <Link href={`/financeiro/execucoes/${data.id}` as Href} asChild>
              <Button label="Acompanhar operação" size="sm" variant="outline" />
            </Link>
          </Alert>
        ) : (
          <Alert tone="success" title="Acerto confirmado">
            <Text variant="small">{`Pronto! ${formatCents(data.amountCents)} acertados. Saldos, créditos e reembolsos já foram atualizados.`}</Text>
          </Alert>
        )
      ) : null}
      {pending ? (
        <Alert
          tone="warning"
          title={
            pending.executionId
              ? 'Operação iniciada'
              : 'Ainda não sabemos se a operação foi registrada'
          }
        >
          {pending.executionId ? (
            <Link href={`/financeiro/execucoes/${pending.executionId}` as Href} asChild>
              <Button label="Acompanhar operação" size="sm" />
            </Link>
          ) : (
            <Button
              label="Revisar e repetir com segurança"
              size="sm"
              disabled={mutation.isPending}
              onPress={() => setReview(pending.body as ResolutionCommand)}
            />
          )}
        </Alert>
      ) : null}
      {other ? (
        <Alert tone="warning" title="Outra operação deste pedido aguarda confirmação">
          Confira a operação pendente antes de iniciar outra.
        </Alert>
      ) : null}
      {mutation.isError ? (
        <Alert tone="danger" title="Não foi possível concluir a operação">
          <Text variant="small">{toApiError(mutation.error).userMessage}</Text>
          {toApiError(mutation.error).code === 'FINANCIAL_RESUMABLE_REQUIRED' ? (
            <Button
              label="Usar processamento em etapas"
              size="sm"
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
        label="O que fazer com o valor já pago"
        value={disposition}
        options={dispositionOptions}
        onChange={setDisposition}
        disabled={frozen}
      />
      <Select
        label="Como processar"
        value={mode}
        options={[
          { value: 'atomic', label: 'De uma vez (pedidos com poucos pagamentos)' },
          { value: 'start', label: 'Em etapas, com acompanhamento' },
        ]}
        onChange={setMode}
        disabled={frozen}
      />
      <TextField
        label="Motivo"
        hint="Obrigatório. Fica registrado no histórico."
        value={reason}
        onChangeText={setReason}
        maxLength={500}
        editable={!frozen}
        multiline
      />
      {preview ? (
        preview.lines.map((l, index) => (
          <FormSection key={l.lineId} title={`Item ${index + 1}`}>
            <Text variant="small">{`Recebido: ${l.sellableQuantity} em bom estado · ${l.damagedQuantity} com avaria`}</Text>
            <Text variant="small">{`Valor a abater (bom estado) ${formatCents(l.sellableCents)} · limite para avaria ${formatCents(l.damagedLimitCents)}`}</Text>
            {Number(l.damagedQuantity) > 0 ? (
              <>
                <Select
                  label={`Avaria do item ${index + 1}`}
                  value={damage[l.lineId]?.choice ?? null}
                  options={[
                    { value: 'full', label: 'Abater o valor integral da avaria' },
                    { value: 'partial', label: 'Abater parte do valor' },
                    { value: 'zero', label: 'Aceitar a devolução sem abater valor' },
                    { value: 'reject', label: 'Recusar abatimento da avaria' },
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
                    label={`Valor a abater do item ${index + 1}`}
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
          <Text variant="small">{`Já pago em dinheiro ${formatCents(state.cashSettledCents)} · pago com crédito ${formatCents(state.creditSettledCents)}`}</Text>
          {state.titles.map((t) => (
            <Text
              key={t.id}
              variant="small"
            >{`${t.installmentNumber}ª parcela: em aberto ${formatCents(t.outstandingCents)} · cancelado ${formatCents(t.canceledCents)}`}</Text>
          ))}
        </>
      )}
      <Button label="Revisar" variant="outline" onPress={build} disabled={frozen} />
      {review ? (
        <ResolutionConfirmation
          command={review}
          busy={mutation.isPending}
          error={mutation.error}
          onReauth={mutation.reset}
          onCancel={() => setReview(null)}
          onSend={() => mutation.mutate(review, { onSuccess: () => setReview(null) })}
        >
          <Text>{`Cliente ${order.customerName ?? 'do pedido'} · total do pedido ${formatCents(order.totalCents)}`}</Text>
          {!preview ? (
            <Text>
              Como o pedido ainda não foi expedido, o estoque reservado volta a ficar disponível.
            </Text>
          ) : null}
          {!preview ? (
            <Text>{`Já pago em dinheiro ${formatCents(state.cashSettledCents)} · pago com crédito ${formatCents(state.creditSettledCents)}`}</Text>
          ) : null}
        </ResolutionConfirmation>
      ) : null}
    </FormSection>
  );
}

const resolutionErrors: Record<string, string> = {
  'Nenhum recebido físico elegível ou preview oficial inválido.':
    'Não há itens recebidos aguardando acerto. Atualize a tela.',
  'Decida explicitamente cada linha danificada elegível.':
    'Decida o que fazer com cada item recebido com avaria.',
  'Aceite de dano fora do limite oficial.': 'O valor da avaria passa do limite permitido.',
};
/** Mensagens de validação em linguagem do dia a dia (o texto interno continua nas regras). */
function friendlyResolutionError(e: unknown) {
  if (!(e instanceof Error)) return 'Revise as informações e tente de novo.';
  if (e.message.trim().startsWith('[')) return 'Escreva o motivo com pelo menos 3 caracteres.';
  return resolutionErrors[e.message] ?? e.message;
}
