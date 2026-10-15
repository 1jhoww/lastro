import { useState, useSyncExternalStore } from 'react';
import { Link, type Href } from 'expo-router';
import type { FinancialExecution } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { executionPublished, executionStatusLabel } from '@/features/orders/rules';
import { Screen } from '@/layout/Screen';
import { intentLedger } from '@/lib/intent';
import { useSession } from '@/session/SessionContext';
import { Alert, Button, EmptyState, Select, Text, TextField } from '@/ui';
import { CircleDollarSign } from '@/ui/icons';
import { FinanceNav } from './FinanceNav';
import { useExecutions } from './resolutionApi';
import { executionResponseSchema } from './resolutionRules';

export function ExecutionsScreen() {
  const [pending, setPending] = useState<'all' | 'true' | 'false'>('true');
  const [order, setOrder] = useState(''),
    [filterOrder, setFilterOrder] = useState('');
  const executions = useExecutions({
    ...(pending === 'all' ? {} : { pending }),
    ...(filterOrder ? { orderId: filterOrder } : {}),
  });
  const session = useSession();
  // Snapshot primitivo; mudanças da ledger não criam snapshots instáveis em useSyncExternalStore.
  useSyncExternalStore(intentLedger.subscribe, () =>
    intentLedger
      .list(session.user!.uid, session.tenantId!)
      .map(([s, i]) => `${s}:${i.key}:${i.executionId ?? ''}`)
      .join('|'),
  );
  const local = intentLedger
    .list(session.user!.uid, session.tenantId!)
    .filter(([, i]) => i.unknown);
  return (
    <Screen
      title="Execuções financeiras"
      description="Acompanhamento e retomada explícitos. Fechar aplicativo não conclui operação."
    >
      <FinanceNav />
      {local.length ? (
        <Alert tone="warning" title="Intenções locais preservadas">
          {local.map(([scope, intent]) => {
            const c = intent.body;
            const orderId =
              'orderId' in c && typeof c.orderId === 'string'
                ? c.orderId
                : scope.split(':').slice(3).join(':');
            const href = intent.executionId
              ? `/financeiro/execucoes/${intent.executionId}`
              : scope.includes(':finance-setting:')
                ? '/financeiro/configuracoes'
                : `/financeiro/pedidos/${orderId}`;
            return (
              <Link key={scope} href={href as Href} asChild>
                <Button
                  label={
                    intent.executionId
                      ? `Consultar execução ${intent.executionId}`
                      : `Conferir intenção ${scope.split(':')[2]} · ${orderId}`
                  }
                  variant="outline"
                />
              </Link>
            );
          })}
        </Alert>
      ) : null}
      <Select
        label="Situação das execuções"
        value={pending}
        options={[
          { value: 'true', label: 'Pendentes' },
          { value: 'false', label: 'Terminais' },
          { value: 'all', label: 'Todas' },
        ]}
        onChange={setPending}
      />
      <TextField label="ID do pedido" value={order} onChangeText={setOrder} />
      <Button
        label="Filtrar pedido"
        onPress={() => setFilterOrder(order.trim())}
        variant="outline"
      />
      <ListPanel
        query={executions.query}
        count={executions.items.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title="Nenhuma execução neste filtro"
            description="Não há total financeiro inferido."
          />
        }
      >
        {executions.items.map((e) => (
          <ExecutionSummary key={e.id} execution={e} />
        ))}
      </ListPanel>
    </Screen>
  );
}
export function ExecutionSummary({ execution: e }: { execution: FinancialExecution }) {
  if (!executionResponseSchema.safeParse(e).success)
    return (
      <Alert tone="warning" title="Execução financeira pendente">
        <Text>Estado incompleto; consulte detalhe oficial antes de qualquer ação.</Text>
        <Link href={`/financeiro/execucoes/${e.id}` as Href} asChild>
          <Button label={`Abrir execução ${e.id}`} variant="outline" />
        </Link>
      </Alert>
    );
  return (
    <>
      <Text variant="bodyStrong">{`${executionStatusLabel[e.status]} · ${e.kind === 'cancellation' ? 'cancelamento' : 'devolução'} · fase ${e.phase}`}</Text>
      <Text selectable>{`Pedido ${e.orderId} · execução ${e.id}`}</Text>
      <Text>{`Criada ${e.createdAt} · atualizada ${e.updatedAt}`}</Text>
      <Text>{`Entradas técnicas: planejadas ${e.progress.planned} · aplicadas ${e.progress.applied} · total ${e.progress.total ?? 'não certificado'}`}</Text>
      <Text>
        {executionPublished(e)
          ? 'Publicação financeira comprovada pelo servidor'
          : e.status === 'ABORTED'
            ? 'Abortada sem conclusão financeira'
            : 'Aguardando continuação administrativa; saldos publicados anteriores'}
      </Text>
      <Link href={`/financeiro/execucoes/${e.id}` as Href} asChild>
        <Button label={`Abrir execução ${e.id}`} variant="outline" />
      </Link>
    </>
  );
}
