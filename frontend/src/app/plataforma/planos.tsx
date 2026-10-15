import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { usePlatformQuery } from '@/features/platform/platformQuery';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Badge, EmptyState, Panel, Skeleton, Text } from '@/ui';
import { Layers } from '@/ui/icons';

/** Planos versionados. Somente leitura nesta etapa. */
export default function PlatformPlans() {
  const { api, user } = useSession();
  const plans = usePlatformQuery(queryKeys.platform(user?.uid ?? '', 'plans'), () =>
    unwrap(api.GET('/api/v1/admin/plans', { params: { query: { limit: '100' } } })),
  );
  const items = plans.data?.items ?? [];

  return (
    <>
      <PlatformHeader
        title="Planos"
        description="Ofertas comerciais. Alterar um plano cria nova versão; contratos antigos mantêm as condições."
      />
      {plans.isError && toApiError(plans.error).code !== 'FORBIDDEN' ? (
        <Alert tone="danger" title="Não foi possível carregar os planos">
          {toApiError(plans.error).userMessage}
        </Alert>
      ) : null}
      <Panel flush>
        {plans.isPending ? (
          <View style={styles.loading}>
            <Skeleton width="50%" height={16} />
          </View>
        ) : items.length === 0 ? (
          <EmptyState icon={Layers} title="Nenhum plano cadastrado" />
        ) : (
          items.map((p, i) => (
            <View key={p.id} style={[styles.row, i < items.length - 1 && styles.divider]}>
              <View style={styles.copy}>
                <Text variant="bodyStrong">{`${p.name}, versão ${p.version}`}</Text>
                <Text variant="small" color={color.textSecondary}>
                  {`Adesão ${formatCents(p.signupFeeCents)}, mensalidade ${formatCents(p.monthlyPriceCents)}, até ${p.userLimit} usuários`}
                </Text>
              </View>
              <Badge
                label={p.status === 'active' ? 'Disponível' : 'Arquivado'}
                tone={p.status === 'active' ? 'success' : 'neutral'}
              />
            </View>
          ))
        )}
      </Panel>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[4],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  copy: { flex: 1, minWidth: 220, gap: 2 },
  loading: { padding: space[5], gap: space[3] },
});
