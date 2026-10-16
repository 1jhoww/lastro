import { useState, useSyncExternalStore } from 'react';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { FinancialExecution } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { intentLedger } from '@/lib/intent';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Badge, Button, EmptyState, Text } from '@/ui';
import { RefreshCw } from '@/ui/icons';
import { Guidance, RowLink, FilterTabs } from './FinanceParts';
import { FinanceNav } from './FinanceNav';
import { executionKindLabel, executionStage, orderCode } from './presentation';
import { useExecutions } from './resolutionApi';
import { executionResponseSchema } from './resolutionRules';

export function ExecutionsScreen() {
  const params = useLocalSearchParams<{ pedido?: string }>();
  const [pending, setPending] = useState<'all' | 'true' | 'false'>('true');
  const orderId = params.pedido ?? '';
  const executions = useExecutions({
    ...(pending === 'all' ? {} : { pending }),
    ...(orderId ? { orderId } : {}),
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
      title="Operações em andamento"
      description="Cancelamentos e devoluções processados em etapas. Elas só avançam quando um administrador continua."
    >
      <FinanceNav />
      {local.length ? (
        <Alert tone="warning" title="Operações aguardando conferência">
          <Text variant="small">
            A conexão caiu antes da confirmação destas operações neste aparelho. Abra cada uma para
            conferir e, se preciso, repetir com segurança.
          </Text>
          {local.map(([scope, intent]) => {
            const c = intent.body;
            const order =
              'orderId' in c && typeof c.orderId === 'string'
                ? c.orderId
                : scope.split(':').slice(3).join(':');
            const href = intent.executionId
              ? `/financeiro/execucoes/${intent.executionId}`
              : scope.includes(':finance-setting:')
                ? '/financeiro/configuracoes'
                : `/financeiro/pedidos/${order}`;
            return (
              <Link key={scope} href={href as Href} asChild>
                <Button
                  label={
                    intent.executionId
                      ? `Conferir operação em etapas · ${orderCode(order)}`
                      : scope.includes(':finance-setting:')
                        ? 'Conferir cadastro de condição ou forma'
                        : `Conferir operação · ${orderCode(order)}`
                  }
                  size="sm"
                  variant="outline"
                />
              </Link>
            );
          })}
        </Alert>
      ) : null}
      <View style={styles.filters}>
        <FilterTabs
          label="Situação das operações"
          value={pending}
          options={[
            { value: 'true', label: 'Em andamento' },
            { value: 'false', label: 'Encerradas' },
            { value: 'all', label: 'Todas' },
          ]}
          onChange={setPending}
        />
        {orderId ? <Text variant="smallStrong">{`Somente ${orderCode(orderId)}`}</Text> : null}
      </View>
      <ListPanel
        query={executions.query}
        count={executions.items.length}
        empty={
          <EmptyState
            icon={RefreshCw}
            title={pending === 'true' ? 'Nenhuma operação em andamento' : 'Nenhuma operação'}
            description="Operações em etapas aparecem aqui quando um cancelamento ou devolução grande é iniciado."
          />
        }
      >
        <View style={styles.list}>
          {executions.items.map((e) => (
            <ExecutionSummary key={e.id} execution={e} />
          ))}
        </View>
      </ListPanel>
      <Guidance>
        “Concluída” só aparece quando a operação termina de verdade. Até lá, saldos anteriores
        continuam valendo e o pedido fica bloqueado para novas operações.
      </Guidance>
    </Screen>
  );
}

/** Resumo de uma operação em etapas, em linguagem administrativa; detalhes técnicos no detalhe. */
export function ExecutionSummary({ execution: e }: { execution: FinancialExecution }) {
  if (!executionResponseSchema.safeParse(e).success)
    return (
      <Alert tone="warning" title="Operação financeira pendente">
        <Text variant="small">
          Os dados desta operação estão incompletos. Abra o acompanhamento antes de qualquer ação.
        </Text>
        <Link href={`/financeiro/execucoes/${e.id}` as Href} asChild>
          <Button label="Abrir acompanhamento" size="sm" variant="outline" />
        </Link>
      </Alert>
    );
  const stage = executionStage(e);
  return (
    <RowLink
      href={`/financeiro/execucoes/${e.id}` as Href}
      label={`Abrir operação ${orderCode(e.orderId)}`}
    >
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text variant="bodyStrong">{`${executionKindLabel(e.kind)} · ${orderCode(e.orderId)}`}</Text>
          <Text variant="small" color={color.textSecondary}>
            {`Iniciada em ${formatDateTime(e.createdAt)} · atualizada em ${formatDateTime(e.updatedAt)}`}
          </Text>
        </View>
        <Badge label={stage.label} tone={stage.tone} />
      </View>
    </RowLink>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[3] },
  list: { paddingHorizontal: space[5], paddingVertical: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  flex: { flex: 1, minWidth: 0, gap: 2 },
});
