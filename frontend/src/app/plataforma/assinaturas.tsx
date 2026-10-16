import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CompanyRow, SubscriptionStatus } from '@/api/types';
import { FilterTabs } from '@/features/finance/FinanceParts';
import { useCompanies, usePlanCatalog, type CompanyFilters } from '@/features/platform/api';
import { dateOrDash, planLabel } from '@/features/platform/copy';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { LoadError, LoadingRows } from '@/features/platform/PlatformParts';
import { subscriptionCopy } from '@/features/platform/subscriptionCopy';
import { formatCents } from '@/lib/money';
import { color, radius, space } from '@/theme';
import { Badge, DataTable, EmptyState, Panel, Skeleton, Text } from '@/ui';
import { CreditCard } from '@/ui/icons';

type Tab = 'all' | 'active' | 'pending' | 'suspended' | 'to_charge' | 'overdue';

const views: Record<Tab, { label: string; filters: CompanyFilters }> = {
  all: { label: 'Todas', filters: {} },
  active: { label: 'Ativas', filters: { status: 'active' as SubscriptionStatus } },
  pending: { label: 'Aguardando ativação', filters: { status: 'pending' as SubscriptionStatus } },
  suspended: { label: 'Suspensas', filters: { status: 'suspended' as SubscriptionStatus } },
  to_charge: { label: 'A cobrar', filters: { attention: 'open' } },
  overdue: { label: 'Vencidas', filters: { attention: 'overdue' } },
};

/**
 * Contratos de todas as empresas. Situação da assinatura (administrativa) e situação das
 * cobranças (financeira) aparecem separadas: atraso nunca suspende sozinho.
 */
export default function PlatformSubscriptions() {
  const [view, setView] = useState<Tab>('all');
  const companies = useCompanies(views[view].filters);
  const catalog = usePlanCatalog();
  const items = companies.data?.items ?? [];
  const mrr = items
    .filter((c) => c.subscriptionStatus === 'active' || c.subscriptionStatus === 'past_due')
    .reduce((total, c) => total + c.monthlyPriceCents, 0);

  return (
    <>
      <PlatformHeader
        title="Assinaturas"
        description="Plano, valor e vencimento de cada empresa. Alterações são feitas no detalhe da empresa."
      />
      <Panel
        title="Planos oficiais"
        description="Valores de referência; cada contrato tem o próprio valor."
      >
        {catalog.isPending ? <Skeleton width="100%" height={72} /> : null}
        <View style={styles.plans}>
          {catalog.data?.items.map((p) => (
            <View key={p.code} style={styles.plan}>
              <View style={styles.planTop}>
                <Text variant="h3">{p.name}</Text>
                <Text variant="figure">{`${formatCents(p.referencePriceCents)}/mês`}</Text>
              </View>
              <Text variant="small" color={color.textSecondary}>
                {p.userLimit === 1 ? '1 usuário ativo' : `Até ${p.userLimit} usuários ativos`}
              </Text>
              {catalog.data.features.map((f) => {
                const included = p.features.some((pf) => pf.code === f.code);
                return (
                  <Text
                    key={f.code}
                    variant="small"
                    color={included ? color.text : color.textSecondary}
                  >
                    {`${included ? '✓' : '—'} ${f.label}`}
                  </Text>
                );
              })}
            </View>
          ))}
        </View>
      </Panel>
      <FilterTabs<Tab>
        label="Filtrar assinaturas"
        value={view}
        onChange={setView}
        options={(Object.keys(views) as Tab[]).map((value) => ({
          value,
          label: views[value].label,
        }))}
      />
      {companies.isError ? (
        <LoadError
          title="Não foi possível carregar as assinaturas"
          error={companies.error}
          onRetry={() => companies.refetch()}
        />
      ) : null}
      <Panel flush>
        {companies.isPending ? (
          <LoadingRows />
        ) : items.length === 0 ? (
          <EmptyState size="compact" icon={CreditCard} title="Nenhuma assinatura neste filtro" />
        ) : (
          <DataTable<CompanyRow>
            label="Assinaturas"
            rows={items}
            keyOf={(c) => c.id}
            hrefOf={(c) => `/plataforma/empresas/${c.id}`}
            columns={[
              {
                key: 'name',
                label: 'Empresa',
                flex: 2,
                render: (c) => (
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {c.name}
                  </Text>
                ),
              },
              {
                key: 'plan',
                label: 'Plano',
                flex: 1,
                render: (c) => <Text variant="body">{planLabel(c.planCode, c.planName)}</Text>,
              },
              {
                key: 'status',
                label: 'Assinatura',
                flex: 1.3,
                render: (c) => <Badge {...subscriptionCopy[c.subscriptionStatus]} />,
              },
              {
                key: 'price',
                label: 'Mensal',
                flex: 1,
                align: 'right',
                render: (c) => <Text variant="figure">{formatCents(c.monthlyPriceCents)}</Text>,
              },
              {
                key: 'day',
                label: 'Vencimento',
                flex: 0.9,
                render: (c) => (
                  <Text variant="body">{c.billingDay === null ? '—' : `Dia ${c.billingDay}`}</Text>
                ),
              },
              {
                key: 'next',
                label: 'Próximo',
                flex: 1,
                render: (c) => <Text variant="body">{dateOrDash(c.nextDueDate)}</Text>,
              },
              {
                key: 'charges',
                label: 'Cobranças',
                flex: 1.4,
                render: (c) =>
                  c.openCharges.count ? (
                    <View style={styles.badges}>
                      <Badge
                        label={`${formatCents(c.openCharges.amountCents)} em aberto`}
                        tone={c.openCharges.overdueCount ? 'danger' : 'warning'}
                      />
                    </View>
                  ) : (
                    <Text variant="small" color={color.textSecondary}>
                      Em dia
                    </Text>
                  ),
              },
            ]}
            renderCompact={(c) => (
              <View style={styles.compact}>
                <View style={styles.compactTop}>
                  <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Badge {...subscriptionCopy[c.subscriptionStatus]} />
                </View>
                <Text variant="small" color={color.textSecondary}>
                  {`${planLabel(c.planCode, c.planName)}, ${formatCents(c.monthlyPriceCents)}, próximo ${dateOrDash(c.nextDueDate)}`}
                </Text>
                {c.openCharges.count ? (
                  <Text
                    variant="small"
                    color={c.openCharges.overdueCount ? color.danger : color.textSecondary}
                  >
                    {`${formatCents(c.openCharges.amountCents)} em aberto`}
                  </Text>
                ) : null}
              </View>
            )}
          />
        )}
      </Panel>
      {companies.data && view === 'all' ? (
        <Text variant="small" color={color.textSecondary}>
          {`Receita mensal contratada (ativas): ${formatCents(mrr)}`}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  plans: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], paddingTop: space[2] },
  plan: {
    flexGrow: 1,
    flexBasis: 260,
    gap: space[1],
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  planTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  compact: { gap: 2, flex: 1 },
  compactTop: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
});
