import { useEffect, useRef, useState } from 'react';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import { tenantHeader, useTenantApi } from '@/session/SessionContext';
import { Alert, Button, Text } from '@/ui';
import { FormSection } from '@/features/catalog/FormParts';
import { appendReconciliation, type ReconciliationPage } from './resolutionRules';

/** Cada painel percorre um escopo separado. Não calcula hashes nem certifica provas por conta própria. */
export function ReconciliationPanel({
  orderId,
  executionId,
}: {
  orderId: string;
  executionId?: string;
}) {
  const { api, tenantId } = useTenantApi();
  const [page, setPage] = useState<ReconciliationPage | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function load(restart = false) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    const prior = restart ? null : page;
    if (restart) setPage(null);
    try {
      const query = { limit: '25', ...(prior?.nextCursor ? { cursor: prior.nextCursor } : {}) };
      const header = tenantHeader(tenantId);
      const result = executionId
        ? await unwrap(
            api.GET('/api/v1/financial-executions/{id}/proof-reconciliation', {
              params: { header, path: { id: executionId }, query },
              signal: controller.signal,
            }),
          )
        : await unwrap(
            api.GET('/api/v1/orders/{id}/financial-reconciliation', {
              params: { header, path: { id: orderId }, query },
              signal: controller.signal,
            }),
          );
      if (!controller.signal.aborted) {
        if (
          executionId
            ? !('executionId' in result) || result.executionId !== executionId
            : !('orderId' in result) || result.orderId !== orderId
        )
          throw new Error('Reconciliação pertence a outro recurso');
        setPage(
          appendReconciliation(prior, { ...result, scope: executionId ? 'proofs' : 'journal' }),
        );
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e);
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        request.current = null;
      }
    }
  }
  return (
    <FormSection
      title={executionId ? 'Reconciliação de provas' : 'Reconciliação do journal'}
      description="Verificação oficial do servidor por páginas. Journal e provas são escopos distintos."
    >
      {page ? (
        <>
          <Text>{`Verificados cumulativamente: ${page.checkedEntries ?? page.checkedEvents}${page.expectedEntries === undefined ? '' : ` de ${page.expectedEntries}`}`}</Text>
          <Alert
            tone={!page.consistent ? 'danger' : page.complete ? 'success' : 'info'}
            title={
              !page.consistent
                ? 'Divergência acumulada'
                : page.complete
                  ? 'Consulta completa e consistente neste escopo'
                  : 'Consulta incompleta'
            }
          >
            {page.complete
              ? 'Resultado oficial do servidor. Não é verificação criptográfica independente pelo aplicativo.'
              : 'Páginas restantes precisam ser consultadas antes de concluir verificação.'}
          </Alert>
        </>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Reconciliação interrompida">
          <Text>{toApiError(error).userMessage} Reinicie consulta após conflito de cursor.</Text>
        </Alert>
      ) : null}
      <Button
        label={page ? 'Reiniciar reconciliação' : 'Consultar reconciliação'}
        loading={busy}
        onPress={() => load(true)}
        variant="outline"
      />
      {page?.nextCursor && !error ? (
        <Button
          label="Consultar próxima página de reconciliação"
          disabled={busy}
          onPress={() => load()}
        />
      ) : null}
    </FormSection>
  );
}
