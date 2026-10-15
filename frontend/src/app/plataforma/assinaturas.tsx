import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { usePlatformQuery } from '@/features/platform/platformQuery';
import { subscriptionCopy } from '@/features/platform/subscriptionCopy';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Badge, EmptyState, Panel, Skeleton, Text } from '@/ui';
import { CreditCard } from '@/ui/icons';

/**
 * Assinaturas com a situação real do backend. Somente leitura nesta etapa: suspender,
 * reativar ou alterar condições é uma decisão comercial manual, ainda sem tela.
 */
export default function PlatformSubscriptions() {
  const { api, user } = useSession();
  const uid = user?.uid ?? '';
  const subs = usePlatformQuery(queryKeys.platform(uid, 'subscriptions'), () =>
    unwrap(api.GET('/api/v1/admin/subscriptions', { params: { query: { limit: '100' } } })),
  );
  // Nome da empresa: mesma lista da tela de empresas (cache compartilhado).
  const tenants = usePlatformQuery(queryKeys.platform(uid, 'tenants'), () =>
    unwrap(api.GET('/api/v1/admin/tenants', { params: { query: { limit: '100' } } })),
  );
  const nameOf = (id: string) =>
    tenants.data?.items.find((t) => t.id === id)?.name ?? `Empresa ${id.slice(0, 8)}`;
  const items = subs.data?.items ?? [];

  return (
    <>
      <PlatformHeader
        title="Assinaturas"
        description="Em atraso mantém o acesso. Suspensa e cancelada bloqueiam a empresa."
      />
      {subs.isError && toApiError(subs.error).code !== 'FORBIDDEN' ? (
        <Alert tone="danger" title="Não foi possível carregar as assinaturas">
          {toApiError(subs.error).userMessage}
        </Alert>
      ) : null}
      <Panel flush>
        {subs.isPending ? (
          <View style={styles.loading}>
            <Skeleton width="50%" height={16} />
            <Skeleton width="40%" height={16} />
          </View>
        ) : items.length === 0 ? (
          <EmptyState icon={CreditCard} title="Nenhuma assinatura" />
        ) : (
          items.map((s, i) => {
            const copy = subscriptionCopy[s.status];
            return (
              <View key={s.id} style={[styles.row, i < items.length - 1 && styles.divider]}>
                <View style={styles.copy}>
                  <Text variant="bodyStrong">{nameOf(s.tenantId)}</Text>
                  <Text variant="small" color={color.textSecondary}>
                    {`${formatCents(s.monthlyPriceCents)} por mês, até ${s.userLimit} usuários, plano versão ${s.planVersion}`}
                  </Text>
                  <Text variant="small" color={color.textSecondary}>
                    {copy.access}
                  </Text>
                </View>
                <Badge label={copy.label} tone={copy.tone} />
              </View>
            );
          })
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
