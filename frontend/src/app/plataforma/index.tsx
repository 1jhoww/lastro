import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { PlatformOverview } from '@/api/types';
import { MetricStrip } from '@/features/finance/FinanceParts';
import { useOverview } from '@/features/platform/api';
import { chargeCopy, competenceLabel, dateOrDash } from '@/features/platform/copy';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { LoadError, LoadingRows, Stat } from '@/features/platform/PlatformParts';
import { formatCents } from '@/lib/money';
import { color, space } from '@/theme';
import { Alert, Badge, Button, DataTable, EmptyState, Panel, Skeleton, Text } from '@/ui';
import { CalendarClock, Plus } from '@/ui/icons';

type Upcoming = PlatformOverview['upcoming'][number];

/**
 * Visão geral do Super Admin. Todos os números vêm de dados gravados: MRR é a receita contratada
 * dos contratos ativos; "recebido no mês" soma os pagamentos registrados. Os dois nunca se somam.
 */
export default function PlatformOverviewScreen() {
  const overview = useOverview();
  const data = overview.data;

  return (
    <>
      <PlatformHeader
        title="Visão geral"
        description="Empresas, assinaturas e cobranças do Lastro."
        action={
          <Link href="/plataforma/nova-empresa" asChild>
            <Button label="Nova empresa" icon={Plus} variant="strong" />
          </Link>
        }
      />
      {overview.isError ? (
        <LoadError
          title="Não foi possível carregar os indicadores"
          error={overview.error}
          onRetry={() => overview.refetch()}
        />
      ) : null}
      {overview.isPending ? (
        <Skeleton width="100%" height={88} />
      ) : data ? (
        <>
          <MetricStrip>
            {[
              <Stat key="companies" label="Empresas" value={String(data.totalCompanies)} />,
              <Stat
                key="active"
                label="Assinaturas ativas"
                value={String(data.subscriptions.active)}
                caption={
                  data.subscriptions.pending
                    ? `${data.subscriptions.pending} aguardando ativação`
                    : undefined
                }
              />,
              <Stat key="essencial" label="No Essencial" value={String(data.plans.essencial)} />,
              <Stat
                key="profissional"
                label="No Profissional"
                value={String(data.plans.profissional)}
                caption={data.plans.legacy ? `${data.plans.legacy} em contrato legado` : undefined}
              />,
            ]}
          </MetricStrip>
          <MetricStrip>
            {[
              <Stat
                key="mrr"
                label="Receita mensal contratada"
                value={formatCents(data.mrrCents)}
                caption="Contratos ativos (MRR)"
              />,
              <Stat
                key="received"
                label="Recebido no mês"
                value={formatCents(data.receivedThisMonthCents)}
                caption="Pagamentos registrados"
                tone="success"
              />,
              <Stat
                key="open"
                label="Cobranças em aberto"
                value={formatCents(data.openCharges.amountCents)}
                caption={`${data.openCharges.count} ${data.openCharges.count === 1 ? 'cobrança' : 'cobranças'}`}
              />,
              <Stat
                key="overdue"
                label="Vencidas"
                value={formatCents(data.overdueCharges.amountCents)}
                caption={`${data.overdueCharges.count} ${data.overdueCharges.count === 1 ? 'cobrança' : 'cobranças'}`}
                tone={data.overdueCharges.count ? 'danger' : 'default'}
              />,
            ]}
          </MetricStrip>
          {data.overdueCharges.count ? (
            <Alert
              tone="warning"
              title={`${data.overdueCharges.count} ${data.overdueCharges.count === 1 ? 'cobrança vencida' : 'cobranças vencidas'}`}
              action={
                <Link href="/plataforma/cobrancas" asChild>
                  <Button label="Ver cobranças" size="sm" variant="outline" />
                </Link>
              }
            >
              O acesso dessas empresas continua liberado. Suspender é sempre uma decisão sua.
            </Alert>
          ) : null}
          {data.subscriptions.pending ? (
            <Alert
              title={`${data.subscriptions.pending} ${data.subscriptions.pending === 1 ? 'assinatura aguarda' : 'assinaturas aguardam'} ativação da cobrança`}
              action={
                <Link href="/plataforma/assinaturas" asChild>
                  <Button label="Ver assinaturas" size="sm" variant="outline" />
                </Link>
              }
            >
              Nenhuma cobrança é gerada antes de você definir valor, vencimento e início.
            </Alert>
          ) : null}
        </>
      ) : null}
      <Panel
        title="Próximos vencimentos"
        description="Cobranças em aberto, das mais antigas para as mais novas."
        flush
      >
        {overview.isPending ? (
          <LoadingRows />
        ) : !data?.upcoming.length ? (
          <EmptyState
            size="compact"
            icon={CalendarClock}
            title="Nenhuma cobrança em aberto"
            description="As cobranças são geradas até 10 dias antes de cada vencimento."
          />
        ) : (
          <DataTable<Upcoming>
            label="Próximos vencimentos"
            rows={data.upcoming}
            keyOf={(c) => c.id}
            hrefOf={(c) => `/plataforma/empresas/${c.tenantId}`}
            columns={[
              {
                key: 'company',
                label: 'Empresa',
                flex: 2,
                render: (c) => <Text variant="bodyStrong">{c.tenantName}</Text>,
              },
              {
                key: 'competence',
                label: 'Competência',
                flex: 1,
                render: (c) => <Text variant="body">{competenceLabel(c.competence)}</Text>,
              },
              {
                key: 'due',
                label: 'Vencimento',
                flex: 1,
                render: (c) => <Text variant="body">{dateOrDash(c.dueDate)}</Text>,
              },
              {
                key: 'amount',
                label: 'Valor',
                flex: 1,
                align: 'right',
                render: (c) => <Text variant="figure">{formatCents(c.amountCents)}</Text>,
              },
              {
                key: 'situation',
                label: 'Situação',
                flex: 1,
                render: (c) => <Badge {...chargeCopy[c.situation]} />,
              },
            ]}
            renderCompact={(c) => (
              <View style={styles.compact}>
                <View style={styles.compactTop}>
                  <Text variant="bodyStrong" style={styles.flex}>
                    {c.tenantName}
                  </Text>
                  <Badge {...chargeCopy[c.situation]} />
                </View>
                <Text variant="small" color={color.textSecondary}>
                  {`${formatCents(c.amountCents)}, vence ${dateOrDash(c.dueDate)}`}
                </Text>
              </View>
            )}
          />
        )}
      </Panel>
    </>
  );
}

const styles = StyleSheet.create({
  compact: { gap: 2, flex: 1 },
  compactTop: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
});
