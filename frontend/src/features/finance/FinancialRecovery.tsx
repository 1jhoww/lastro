import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import { executionDone } from '@/features/orders/rules';
import { intentLedger } from '@/lib/intent';
import { useSession, useTenantApi, tenantHeader } from '@/session/SessionContext';
import { Alert, Button, Skeleton, Text } from '@/ui';
import { getExecution } from './resolutionCommands';

const RecoveryContext = createContext(false);
/** Inicialização de sessão/tela faz só leitura oficial. Não repete POST ao abrir aplicativo. */
export function FinancialRecovery({
  children,
  background = false,
}: {
  children: ReactNode;
  background?: boolean;
}) {
  const parent = useContext(RecoveryContext);
  const session = useSession();
  if (
    parent ||
    session.role !== 'administrator' ||
    session.isPlatformAdmin ||
    !session.permissions.includes('receivables:read')
  )
    return children;
  return (
    <Recovery key={`${session.user?.uid}:${session.tenantId}`} background={background}>
      {children}
    </Recovery>
  );
}
function Recovery({ children, background }: { children: ReactNode; background: boolean }) {
  const session = useSession();
  const { api, tenantId } = useTenantApi();
  const [state, setState] = useState<{ ready: boolean; error: unknown; backendPending?: boolean }>({
    ready: false,
    error: null,
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(),
      uid = session.user!.uid;
    const header = tenantHeader(tenantId);
    async function recover() {
      await intentLedger.hydrate(uid, tenantId);
      const rows = intentLedger.list(uid, tenantId);
      const seenExecutions = new Set<string>();
      for (const [scope, intent] of rows) {
        if (!active) return;
        if (intent.executionId) {
          if (seenExecutions.has(intent.executionId)) continue;
          seenExecutions.add(intent.executionId);
          const official = await getExecution(api, tenantId, intent.executionId, controller.signal);
          if (active && executionDone(official))
            await intentLedger.finishExecution(uid, tenantId, official.id);
          else if (active)
            await intentLedger.observeExecution(
              uid,
              tenantId,
              official.id,
              official.revision,
              official.fencingToken,
              official.status,
            );
        } else if (
          ['receipt', 'finance-command', 'finance-resolution', 'order-discount'].some((k) =>
            scope.includes(`:${k}:`),
          )
        ) {
          const orderId = scope.split(':').slice(3).join(':');
          if (scope.includes(':order-discount:'))
            await unwrap(
              api.GET('/api/v1/orders/{id}', {
                params: { header, path: { id: orderId } },
                signal: controller.signal,
              }),
            );
          else
            await unwrap(
              api.GET('/api/v1/orders/{id}/financial-state', {
                params: { header, path: { id: orderId } },
                signal: controller.signal,
              }),
            );
          // Start com resposta perdida pode ter criado lock. Lista oficial permite localizar a execução.
          if (scope.includes(':finance-resolution:'))
            await unwrap(
              api.GET('/api/v1/financial-executions', {
                params: { header, query: { orderId, pending: 'true', limit: '25' } },
                signal: controller.signal,
              }),
            );
        }
      }
      if (background) {
        const page = await unwrap(
          api.GET('/api/v1/financial-executions', {
            params: { header, query: { pending: 'true', limit: '25' } },
            signal: controller.signal,
          }),
        );
        return page.items.length > 0 || Boolean(page.nextCursor);
      }
      return false;
    }
    recover()
      .then((backendPending) => {
        if (active) setState({ ready: true, error: null, backendPending });
      })
      .catch((error) => {
        if (active) setState({ ready: false, error });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, session.user, tenantId, retry, background]);
  if (background)
    return (
      <>
        {state.error ? (
          <Alert tone="warning" title="Financeiro precisa de conferência">
            Não conseguimos conferir operações pendentes neste aparelho. Abra o Financeiro para
            verificar antes de registrar novas operações.
          </Alert>
        ) : state.backendPending ? (
          <Alert
            tone="warning"
            title="Há operações financeiras em andamento"
            action={
              <Link href={'/financeiro/execucoes' as Href} asChild>
                <Button label="Ver operações em andamento" size="sm" variant="outline" />
              </Link>
            }
          />
        ) : null}
        {children}
      </>
    );
  if (state.error)
    return (
      <Alert
        tone="danger"
        title="Não conseguimos conferir operações pendentes"
        action={
          <Button
            label="Tentar de novo"
            size="sm"
            onPress={() => {
              setState({ ready: false, error: null });
              setRetry((v) => v + 1);
            }}
          />
        }
      >
        <Text variant="small">{`${toApiError(state.error).userMessage} Por segurança, nenhuma nova operação será enviada até a conferência. Nada foi perdido.`}</Text>
      </Alert>
    );
  if (!state.ready) return <Skeleton />;
  const pending = intentLedger
    .list(session.user!.uid, tenantId)
    .filter(([scope, i]) => i.unknown && !scope.includes(':catalog-setting:'));
  return (
    <RecoveryContext value={true}>
      {pending.length ? (
        <Alert
          tone="warning"
          title="Operações aguardando conferência"
          action={
            <Link href={'/financeiro/execucoes' as Href} asChild>
              <Button label="Conferir operações" size="sm" variant="outline" />
            </Link>
          }
        >
          <Text variant="small">
            Algumas operações ficaram sem confirmação. Confira cada uma antes de repetir; nada será
            duplicado.
          </Text>
        </Alert>
      ) : null}
      {children}
    </RecoveryContext>
  );
}
