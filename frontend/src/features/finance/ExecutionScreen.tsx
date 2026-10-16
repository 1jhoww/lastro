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
import { StyleSheet, View } from 'react-native';
import { formatDateTime } from '@/lib/dates';
import { color, space } from '@/theme';
import { Alert, Badge, Button, Disclosure, Panel, Skeleton, Text, TextField } from '@/ui';
import { RefreshCw } from '@/ui/icons';
import { Guidance } from './FinanceParts';
import { executionKindLabel, executionStage, orderCode } from './presentation';
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
      title="Operação em andamento"
      description="Acompanhe e continue uma operação processada em etapas."
    >
      <FinanceNav />
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <Alert
          tone="danger"
          title="Operação indisponível"
          action={<Button label="Tentar de novo" size="sm" onPress={() => query.refetch()} />}
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
  const stage = executionStage(e);
  const explanation = executionPublished(e)
    ? `Pronto! Operação concluída em ${formatDateTime(e.publishedAt!)}, no valor de ${formatCents(e.result!.amountCents)}.`
    : e.status === 'ABORTED'
      ? 'Encerrada sem efeito financeiro. Os saldos continuam como estavam antes.'
      : e.status === 'PAUSED' || e.status === 'NEEDS_REVIEW'
        ? 'A operação foi pausada ou precisa de revisão. Para seguir, retome informando o motivo.'
        : 'Esta operação avança uma etapa por vez, sempre por ação de um administrador. Enquanto não terminar, os saldos anteriores continuam valendo e o pedido fica bloqueado.';
  return (
    <>
      <Panel>
        <View style={styles.head}>
          <View style={styles.flex}>
            <Text variant="h2">{`${executionKindLabel(e.kind)} · ${orderCode(e.orderId)}`}</Text>
            <Text variant="small" color={color.textSecondary}>
              {`Iniciada em ${formatDateTime(e.createdAt)} · atualizada em ${formatDateTime(e.updatedAt)}`}
            </Text>
          </View>
          <Badge label={stage.label} tone={stage.tone} />
        </View>
        <Alert
          tone={executionPublished(e) ? 'success' : e.status === 'ABORTED' ? 'warning' : 'info'}
          title={
            executionPublished(e)
              ? 'Operação concluída'
              : e.status === 'ABORTED'
                ? 'Interrompida sem efeito'
                : 'Operação ainda não concluída'
          }
        >
          <Text variant="small">{explanation}</Text>
          {recovered && terminal ? (
            <Text variant="small">
              Registro local de acompanhamento encerrado após confirmação.
            </Text>
          ) : null}
        </Alert>
        <View style={styles.links}>
          <Button
            label="Atualizar situação"
            icon={RefreshCw}
            size="sm"
            variant="ghost"
            onPress={refresh}
            loading={refreshing}
          />
          <Link href={`/financeiro/pedidos/${e.orderId}` as Href} asChild>
            <Button label="Financeiro do pedido" size="sm" variant="outline" />
          </Link>
          {e.returnId ? (
            <Link href={`/financeiro/devolucoes/${e.returnId}` as Href} asChild>
              <Button label="Ver devolução" size="sm" variant="outline" />
            </Link>
          ) : null}
        </View>
      </Panel>
      {e.review ? (
        <Alert tone="danger" title="Necessita revisão administrativa">
          <Text variant="small">
            Encontramos algo que precisa de análise. Não tente corrigir saldos por aqui; informe a
            referência ao suporte.
          </Text>
          <Text variant="small" selectable>
            {`Referência ${e.review.reference} · ${e.review.code} · ${formatDateTime(e.review.detectedAt)}`}
          </Text>
        </Alert>
      ) : null}
      {localError ? (
        <Alert tone="danger" title="Ação bloqueada">
          {localError}
        </Alert>
      ) : null}
      {mutation.isError ? (
        <Alert tone="danger" title="Não foi possível continuar">
          <Text variant="small">
            {`${toApiError(mutation.error).userMessage} Atualize a situação e tente de novo.`}
          </Text>
        </Alert>
      ) : null}
      {pending && !terminal ? (
        <Alert tone="warning" title="Última etapa sem confirmação">
          <Text variant="small">
            A conexão caiu antes de confirmarmos a última etapa. Revise e repita a mesma etapa; ela
            não é aplicada duas vezes.
          </Text>
          <Button
            label="Revisar passo original"
            size="sm"
            variant="outline"
            disabled={refreshing || mutation.isPending}
            onPress={() => setReview(pending.body as ResolutionCommand)}
          />
        </Alert>
      ) : null}
      {canManageFinance(session, 'payments:manage') && !terminal ? (
        <FormSection title="Continuar">
          <Guidance>
            Cada toque processa uma etapa limitada. Repita até a operação aparecer como concluída.
          </Guidance>
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
          <Disclosure
            label="Retomar ou interromper"
            summary="exige motivo e senha"
            defaultOpen={Boolean(pending) || e.status === 'PAUSED' || e.status === 'NEEDS_REVIEW'}
          >
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
              size="sm"
              onPress={() => control('resume')}
            />
            {pending?.body.kind === 'advance' ? (
              <Guidance>
                Retomar guarda a etapa sem confirmação e libera a continuidade com uma nova
                autorização. Não interrompe a operação.
              </Guidance>
            ) : null}
            {canOfferAbort(e) ? (
              <Button
                label="Revisar abort antes de aplicar"
                disabled={disabled}
                variant="outline"
                size="sm"
                onPress={() => control('abort')}
              />
            ) : (
              <Guidance>
                Interromper não está disponível depois que a operação começou a aplicar valores.
              </Guidance>
            )}
          </Disclosure>
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
      <Disclosure label="Detalhes técnicos" summary="estado interno, etapas e bloqueios">
        <Text variant="small" selectable>
          {`Situação técnica: ${executionStatusLabel[e.status]} (${e.status}) · fase ${e.phase}`}
        </Text>
        <Text variant="small" selectable>
          {`Operação ${e.id} · pedido ${e.orderId}${e.returnId ? ` · devolução ${e.returnId}` : ''}`}
        </Text>
        <Text variant="small">
          {`Revisão ${e.revision} · fence ${e.fencingToken} · lease até ${e.leaseUntil ? formatDateTime(e.leaseUntil) : 'sem lease'} · intervalo indicado ${e.retryAfterSeconds}s`}
        </Text>
        <Text variant="small">
          {`Pedido ${e.blockedResources.order ? 'bloqueado' : 'sem bloqueio desta operação'} · lotes relacionados planejados ${e.blockedResources.sharedLots}`}
        </Text>
        <FormSection title="Progresso técnico">
          <Text variant="caption" color={color.textSecondary}>
            Contadores de etapas internas. Não são valores em dinheiro nem porcentagens.
          </Text>
          {Object.entries(e.progress).map(([key, value]) => (
            <Text key={key} variant="small">{`${key}: ${value ?? 'não certificado'}`}</Text>
          ))}
        </FormSection>
      </Disclosure>
      <Disclosure label="Verificação técnica" summary="integridade dos registros">
        <ReconciliationPanel orderId={e.orderId} />
        {executionPublished(e) ? (
          <ReconciliationPanel orderId={e.orderId} executionId={e.id} />
        ) : null}
      </Disclosure>
    </>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    paddingTop: space[2],
    paddingBottom: space[3],
  },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] },
});
