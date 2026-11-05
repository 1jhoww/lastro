import { useState } from 'react';
import { Link } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import type { CustomPlanRow } from '@/api/types';
import { FilterTabs } from '@/features/finance/FinanceParts';
import { useCustomPlans } from '@/features/platform/api';
import { priceLabel } from '@/features/platform/copy';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { LoadError, LoadingRows } from '@/features/platform/PlatformParts';
import { formatCents } from '@/lib/money';
import { color, space } from '@/theme';
import { Badge, Button, DataTable, EmptyState, Panel, Text } from '@/ui';
import { Layers, Plus } from '@/ui/icons';

type Tab = 'active' | 'inactive' | 'all';

const tabs: { value: Tab; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Desativados' },
  { value: 'all', label: 'Todos' },
];

const companiesLabel = (count: number) =>
  count === 0 ? 'Nenhuma empresa' : count === 1 ? '1 empresa' : `${count} empresas`;
const usersLabel = (limit: number) => (limit === 1 ? '1 usuário' : `Até ${limit} usuários`);

/**
 * Ofertas negociadas com empresas específicas. Ficam fora do catálogo de planos oficiais, que não
 * muda, e cada contrato guarda a própria cópia dos termos.
 */
export default function CustomPlans() {
  const [tab, setTab] = useState<Tab>('active');
  const plans = useCustomPlans(tab === 'all' ? undefined : tab);
  const items = plans.data?.items ?? [];

  return (
    <>
      <PlatformHeader
        title="Planos personalizados"
        description="Ofertas exclusivas para empresas específicas. Não aparecem nos preços públicos e não alteram os planos oficiais."
        action={
          <Link href="/plataforma/planos/novo" asChild>
            <Button label="Novo plano" icon={Plus} variant="strong" />
          </Link>
        }
      />
      <FilterTabs<Tab> label="Filtrar planos" value={tab} onChange={setTab} options={tabs} />
      {plans.isError ? (
        <LoadError
          title="Não foi possível carregar os planos"
          error={plans.error}
          onRetry={() => plans.refetch()}
        />
      ) : null}
      <Panel flush>
        {plans.isPending ? (
          <LoadingRows />
        ) : items.length === 0 ? (
          <EmptyState
            size="compact"
            icon={Layers}
            title={tab === 'inactive' ? 'Nenhum plano desativado' : 'Nenhum plano personalizado'}
            description="Crie uma oferta do zero ou a partir de um plano oficial."
          />
        ) : (
          <DataTable<CustomPlanRow>
            label="Planos personalizados"
            rows={items}
            keyOf={(p) => p.id}
            hrefOf={(p) => `/plataforma/planos/${p.id}`}
            columns={[
              {
                key: 'name',
                label: 'Plano',
                flex: 2,
                render: (p) => (
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {p.name}
                  </Text>
                ),
              },
              {
                key: 'price',
                label: 'Mensalidade',
                flex: 1,
                render: (p) => <Text variant="body">{priceLabel(p.monthlyPriceCents)}</Text>,
              },
              {
                key: 'limit',
                label: 'Usuários',
                flex: 1,
                render: (p) => <Text variant="body">{usersLabel(p.userLimit)}</Text>,
              },
              {
                key: 'companies',
                label: 'Empresas vinculadas',
                flex: 1,
                render: (p) => <Text variant="body">{companiesLabel(p.linkedCompanies)}</Text>,
              },
              {
                key: 'status',
                label: 'Situação',
                flex: 1,
                render: (p) => (
                  <Badge
                    label={p.status === 'active' ? 'Ativo' : 'Desativado'}
                    tone={p.status === 'active' ? 'success' : 'neutral'}
                  />
                ),
              },
            ]}
            renderCompact={(p) => (
              <View style={styles.compact}>
                <Text variant="bodyStrong">{p.name}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${p.monthlyPriceCents === 0 ? 'Gratuito' : `${formatCents(p.monthlyPriceCents)} por mês`}, ${usersLabel(p.userLimit).toLowerCase()}, ${companiesLabel(p.linkedCompanies).toLowerCase()}`}
                </Text>
                <Badge
                  label={p.status === 'active' ? 'Ativo' : 'Desativado'}
                  tone={p.status === 'active' ? 'success' : 'neutral'}
                />
              </View>
            )}
          />
        )}
      </Panel>
    </>
  );
}

const styles = StyleSheet.create({
  compact: { gap: space[1], alignItems: 'flex-start' },
});
