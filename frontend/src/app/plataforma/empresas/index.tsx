import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { CompanyRow, PlanCode, SubscriptionStatus } from '@/api/types';
import { useCompanies, type CompanyFilters } from '@/features/platform/api';
import { dateOrDash, planLabel, seatsLabel } from '@/features/platform/copy';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { LoadError, LoadingRows } from '@/features/platform/PlatformParts';
import { subscriptionCopy } from '@/features/platform/subscriptionCopy';
import { formatDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { color, space } from '@/theme';
import {
  Badge,
  Button,
  ChoiceChips,
  DataTable,
  EmptyState,
  Panel,
  SearchField,
  Select,
  Text,
} from '@/ui';
import { Building, Plus, SearchX } from '@/ui/icons';

type PlanFilter = 'all' | PlanCode | 'legacy';
type StatusFilter = 'all' | SubscriptionStatus;
type AttentionFilter = 'all' | 'overdue' | 'open';

/** Pesquisa só depois de uma pausa na digitação, sem uma consulta por tecla. */
function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Empresas contratantes com plano, assinatura, vencimento, vagas e cobranças em aberto. */
export default function PlatformCompanies() {
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState<PlanFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [attention, setAttention] = useState<AttentionFilter>('all');
  const search = useDebounced(q.trim());
  const filters: CompanyFilters = {
    ...(search ? { q: search } : {}),
    ...(plan !== 'all' ? { planCode: plan } : {}),
    ...(status !== 'all' ? { status } : {}),
    ...(attention !== 'all' ? { attention } : {}),
  };
  const companies = useCompanies(filters);
  const items = companies.data?.items ?? [];
  const filtered = Object.keys(filters).length > 0;

  return (
    <>
      <PlatformHeader
        title="Empresas"
        description="Quem usa o Lastro, em qual plano e em que situação."
        action={
          <Link href="/plataforma/nova-empresa" asChild>
            <Button label="Nova empresa" icon={Plus} variant="strong" />
          </Link>
        }
      />
      <View style={styles.filters}>
        <View style={styles.search}>
          <SearchField
            label="Pesquisar"
            hideLabel
            placeholder="Nome ou identificador"
            value={q}
            onChangeText={setQ}
          />
        </View>
        <View style={styles.select}>
          <Select<PlanFilter>
            label="Plano"
            hideLabel
            value={plan}
            onChange={setPlan}
            options={[
              { value: 'all', label: 'Todos os planos' },
              { value: 'essencial', label: 'Essencial' },
              { value: 'profissional', label: 'Profissional' },
              { value: 'legacy', label: 'Legado' },
            ]}
          />
        </View>
        <View style={styles.select}>
          <Select<StatusFilter>
            label="Situação"
            hideLabel
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'Todas as situações' },
              { value: 'active', label: 'Ativa' },
              { value: 'pending', label: 'Aguardando ativação' },
              { value: 'suspended', label: 'Suspensa' },
              { value: 'past_due', label: 'Em atraso (legado)' },
              { value: 'canceled', label: 'Cancelada' },
            ]}
          />
        </View>
      </View>
      <ChoiceChips<AttentionFilter>
        label="Cobranças"
        hideLabel
        value={attention}
        onChange={setAttention}
        options={[
          { value: 'all', label: 'Todas' },
          { value: 'overdue', label: 'Com cobrança vencida' },
          { value: 'open', label: 'Com cobrança em aberto' },
        ]}
      />
      {companies.isError ? (
        <LoadError
          title="Não foi possível carregar as empresas"
          error={companies.error}
          onRetry={() => companies.refetch()}
        />
      ) : null}
      <Panel flush>
        {companies.isPending ? (
          <LoadingRows />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="Nenhuma empresa encontrada"
              description="Revise a pesquisa ou os filtros."
            />
          ) : (
            <EmptyState
              icon={Building}
              title="Nenhuma empresa ainda"
              description="Crie a primeira empresa e envie o convite ao administrador dela."
            />
          )
        ) : (
          <DataTable<CompanyRow>
            label="Empresas"
            rows={items}
            keyOf={(c) => c.id}
            hrefOf={(c) => `/plataforma/empresas/${c.id}`}
            columns={[
              {
                key: 'name',
                label: 'Empresa',
                flex: 2.4,
                render: (c) => (
                  <View style={styles.cell}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
                      {`${c.id.slice(0, 8)} · desde ${formatDate(c.createdAt)}`}
                    </Text>
                  </View>
                ),
              },
              {
                key: 'contact',
                label: 'Responsável',
                flex: 1.8,
                render: (c) => (
                  <Text variant="small" color={color.textSecondary} numberOfLines={2}>
                    {[c.contact?.name, c.contact?.email, c.contact?.phone]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </Text>
                ),
              },
              {
                key: 'plan',
                label: 'Plano',
                flex: 1.1,
                render: (c) => <Text variant="body">{planLabel(c.planCode, c.planName)}</Text>,
              },
              {
                key: 'status',
                label: 'Assinatura',
                flex: 1.4,
                render: (c) => (
                  <View style={styles.badges}>
                    <Badge {...subscriptionCopy[c.subscriptionStatus]} />
                    {c.openCharges.overdueCount ? <Badge label="Vencida" tone="danger" /> : null}
                    {c.tenantStatus === 'provisioning' ? (
                      <Badge label="Sem administrador" tone="neutral" />
                    ) : null}
                  </View>
                ),
              },
              {
                key: 'price',
                label: 'Mensal',
                flex: 1,
                align: 'right',
                render: (c) => <Text variant="figure">{formatCents(c.monthlyPriceCents)}</Text>,
              },
              {
                key: 'due',
                label: 'Próximo venc.',
                flex: 1.1,
                render: (c) => <Text variant="body">{dateOrDash(c.nextDueDate)}</Text>,
              },
              {
                key: 'seats',
                label: 'Usuários',
                flex: 0.8,
                align: 'right',
                render: (c) => <Text variant="figure">{`${c.activeUsers}/${c.userLimit}`}</Text>,
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
                  {`${planLabel(c.planCode, c.planName)}, ${formatCents(c.monthlyPriceCents)} por mês, ${seatsLabel(c.activeUsers, c.userLimit)}`}
                </Text>
                <Text variant="small" color={color.textSecondary}>
                  {c.openCharges.overdueCount
                    ? `${c.openCharges.overdueCount} vencida(s), ${formatCents(c.openCharges.amountCents)} em aberto`
                    : `Próximo vencimento: ${dateOrDash(c.nextDueDate)}`}
                </Text>
              </View>
            )}
          />
        )}
      </Panel>
      {companies.data ? (
        <Text variant="small" color={color.textSecondary}>
          {`${items.length} de ${companies.data.total} ${companies.data.total === 1 ? 'empresa' : 'empresas'}`}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  search: { flexGrow: 2, flexBasis: 260 },
  select: { flexGrow: 1, flexBasis: 200 },
  cell: { gap: 2, minWidth: 0 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  compact: { gap: 2, flex: 1 },
  compactTop: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
});
