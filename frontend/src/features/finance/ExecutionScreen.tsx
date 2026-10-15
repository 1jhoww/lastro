import { useEffect, useState } from 'react';
import { Link, type Href } from 'expo-router';
import { toApiError } from '@/api/errors';
import type { FinancialExecution } from '@/api/types';
import { FormSection } from '@/features/catalog/FormParts';
import { executionDone, executionPublished, executionStatusLabel } from '@/features/orders/rules';
import { Screen } from '@/layout/Screen';
import { intentLedger, intentScope, usePendingIntent } from '@/lib/intent';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { Alert, Button, Skeleton, Text, TextField } from '@/ui';
import { canManageFinance } from './FinanceAccess';
import { FinanceNav } from './FinanceNav';
import { useExecution, useResolution } from './resolutionApi';
import { type ResolutionCommand } from './resolutionCommands';
import { canAdvance, canOfferAbort } from './resolutionRules';
import { ResolutionConfirmation } from './ResolutionConfirmation';
import { ReconciliationPanel } from './ReconciliationPanel';

export function ExecutionScreen({ id }: { id: string }) {
  const query = useExecution(id);
  return (
    <Screen
      title="Acompanhamento financeiro"
      description="Estado oficial, bloqueios e continuação manual."
    >
      <FinanceNav />
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <Alert
          tone="danger"
          title="Execução indisponível"
          action={<Button label="Consultar estado oficial" onPress={() => query.refetch()} />}
        >
          {toApiError(query.error).userMessage}
        </Alert>
      ) : (
        <Execution
          key={id}
          execution={query.data}
          refreshing={query.isFetching}
          refresh={() => query.refetch()}
        />
      )}
    </Screen>
  );
}
function Execution({
  execution: e,
  refreshing,
  refresh,
}: {
  execution: FinancialExecution;
  refreshing: boolean;
  refresh: () => void;
}) {
  const session = useSession();
  const scope = intentScope(session.user!.uid, session.tenantId!, 'finance-step', e.orderId);
  const pending = usePendingIntent(scope),
    mutation = useResolution(scope);
  const [review, setReview] = useState<ResolutionCommand | null>(null),
    [reason, setReason] = useState(''),
    [localError, setLocalError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    let active = true;
    if (executionDone(e))
      intentLedger
        .finishExecution(session.user!.uid, session.tenantId!, e.id)
        .then(() => {
          if (active) setRecovered(true);
        })
        .catch((error) => {
          if (active) setLocalError(toApiError(error).userMessage);
        });
    return () => {
      active = false;
    };
  }, [e, session.user, session.tenantId]);
  const terminal = executionDone(e);
  const disabled = mutation.isPending || refreshing || Boolean(pending) || terminal;
  const resumeDisabled =
    mutation.isPending ||
    refreshing ||
    terminal ||
    Boolean(pending && pending.body.kind !== 'advance');
  function control(kind: 'resume' | 'abort') {
    if (reason.trim().length < 3 || reason.trim().length > 500) {
      setLocalError('Informe justificativa de 3 a 500 caracteres.');
      return;
    }
    setLocalError(null);
    setReview({
      kind,
      id: e.id,
      orderId: e.orderId,
      body: { expectedRevision: e.revision, reason: reason.trim() },
    });
  }
  return (
    <>
      <Text variant="h3">{executionStatusLabel[e.status]}</Text>
      <Text
        selectable
      >{`Execução ${e.id} · pedido ${e.orderId}${e.returnId ? ` · devolução ${e.returnId}` : ''}`}</Text>
      <Text>{`Fase ${e.phase} · revisão ${e.revision} · fence ${e.fencingToken}`}</Text>
      <Text>{`Criada ${e.createdAt} · atualizada ${e.updatedAt}`}</Text>
      <Text>{`Lease até ${e.leaseUntil ?? 'sem lease'} · intervalo indicado ${e.retryAfterSeconds}s`}</Text>
      <Text>{`Pedido ${e.blockedResources.order ? 'bloqueado' : 'sem lock desta execução'} · lotes relacionados planejados ${e.blockedResources.sharedLots}`}</Text>
      <Alert
        tone={executionPublished(e) ? 'success' : e.status === 'ABORTED' ? 'warning' : 'info'}
        title={
          executionPublished(e)
            ? 'Publicação financeira confirmada'
            : e.status === 'ABORTED'
              ? 'Abortada; sem sucesso financeiro'
              : 'Resolução em processamento'
        }
      >
        <Text>
          {executionPublished(e)
            ? `Publicado ${e.publishedAt} · resultado ${e.result!.operationId} · valor ${formatCents(e.result!.amountCents)}`
            : 'Contadores não são dinheiro nem porcentagem. Lease expirado mantém bloqueios. Continue explicitamente.'}
        </Text>
        {recovered && terminal ? (
          <Text>Checkpoint local encerrado após confirmação oficial.</Text>
        ) : null}
      </Alert>
      {e.review ? (
        <Alert tone="danger" title="Revisão administrativa necessária">
          <Text
            selectable
          >{`${e.review.code} · referência ${e.review.reference} · detectada ${e.review.detectedAt}`}</Text>
          <Text>Preserve plano. Não repare saldo nem prova pelo aplicativo.</Text>
        </Alert>
      ) : null}
      <FormSection title="Progresso técnico">
        {Object.entries(e.progress).map(([key, value]) => (
          <Text key={key}>{`${key}: ${value ?? 'não certificado'}`}</Text>
        ))}
      </FormSection>
      <Button
        label="Consultar estado oficial"
        onPress={refresh}
        loading={refreshing}
        variant="outline"
      />
      {localError ? (
        <Alert tone="danger" title="Ação bloqueada">
          {localError}
        </Alert>
      ) : null}
      {mutation.isError ? (
        <Alert tone="danger" title="Passo não confirmado">
          <Text>
            {`${toApiError(mutation.error).code}: ${toApiError(mutation.error).userMessage}`}{' '}
            Consulte GET antes de repetir. Conflito de lease exige retomada autorizada.
          </Text>
        </Alert>
      ) : null}
      {pending && !terminal ? (
        <Alert tone="warning" title="Passo com resposta desconhecida preservado">
          <Button
            label="Revisar passo original"
            disabled={refreshing || mutation.isPending}
            onPress={() => setReview(pending.body as ResolutionCommand)}
          />
        </Alert>
      ) : null}
      {canManageFinance(session, 'payments:manage') && !terminal ? (
        <FormSection title="Continuação administrativa">
          <Button
            label="Continuar execução"
            disabled={disabled || !canAdvance(e)}
            onPress={() =>
              setReview({
                kind: 'advance',
                id: e.id,
                orderId: e.orderId,
                body: { expectedRevision: e.revision, fencingToken: e.fencingToken },
              })
            }
          />
          <TextField
            label="Justificativa da retomada ou abort"
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            editable={!resumeDisabled}
            multiline
          />
          <Button
            label="Revisar retomada"
            disabled={resumeDisabled}
            variant="outline"
            onPress={() => control('resume')}
          />
          {pending?.body.kind === 'advance' ? (
            <Text>
              Retomada explícita preserva passo incerto no checkpoint e pede novo fence ao servidor.
              Não aborta resolução.
            </Text>
          ) : null}
          {canOfferAbort(e) ? (
            <Button
              label="Revisar abort antes de aplicar"
              disabled={disabled}
              variant="outline"
              onPress={() => control('abort')}
            />
          ) : (
            <Text>
              Abort não oferecido após início possível de aplicação. Servidor mantém decisão final.
            </Text>
          )}
        </FormSection>
      ) : null}
      {review ? (
        <ResolutionConfirmation
          command={review}
          error={mutation.error}
          busy={mutation.isPending}
          onReauth={mutation.reset}
          onCancel={() => setReview(null)}
          onSend={() =>
            mutation.mutate(review, {
              onSuccess: () => {
                setReview(null);
                refresh();
              },
            })
          }
        />
      ) : null}
      <Link href={`/financeiro/pedidos/${e.orderId}` as Href} asChild>
        <Button label="Conferir pedido e saldos publicados" variant="outline" />
      </Link>
      {e.returnId ? (
        <Link href={`/financeiro/devolucoes/${e.returnId}` as Href} asChild>
          <Button label="Conferir pendências da devolução" variant="outline" />
        </Link>
      ) : null}
      <ReconciliationPanel orderId={e.orderId} />
      {executionPublished(e) ? (
        <ReconciliationPanel orderId={e.orderId} executionId={e.id} />
      ) : null}
    </>
  );
}
