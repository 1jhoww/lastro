import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { usePlatformQuery } from '@/features/platform/platformQuery';
import { formatDate } from '@/lib/dates';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Badge, Button, EmptyState, Panel, Skeleton, Text } from '@/ui';
import { Building, Plus } from '@/ui/icons';

/** Empresas da plataforma: só nome, situação e data. Nenhum dado comercial. */
export default function PlatformTenants() {
  const { api, user } = useSession();
  const tenants = usePlatformQuery(queryKeys.platform(user?.uid ?? '', 'tenants'), () =>
    unwrap(api.GET('/api/v1/admin/tenants', { params: { query: { limit: '100' } } })),
  );
  const items = tenants.data?.items ?? [];

  return (
    <>
      <PlatformHeader
        title="Empresas"
        description="Contratantes do Lastro. Daqui não se acessa nenhum dado comercial delas."
        action={
          <Link href="/plataforma/nova-empresa" asChild>
            <Button label="Nova empresa" icon={Plus} variant="strong" />
          </Link>
        }
      />
      {tenants.isError && toApiError(tenants.error).code !== 'FORBIDDEN' ? (
        <Alert tone="danger" title="Não foi possível carregar as empresas">
          {toApiError(tenants.error).userMessage}
        </Alert>
      ) : null}
      <Panel flush>
        {tenants.isPending ? (
          <View style={styles.loading}>
            <Skeleton width="50%" height={16} />
            <Skeleton width="40%" height={16} />
          </View>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Building}
            title="Nenhuma empresa ainda"
            description="Crie a primeira empresa e envie o convite ao administrador dela."
          />
        ) : (
          items.map((t, i) => (
            <View key={t.id} style={[styles.row, i < items.length - 1 && styles.divider]}>
              <View style={styles.copy}>
                <Text variant="bodyStrong">{t.name}</Text>
                <Text variant="small" color={color.textSecondary}>
                  Desde {formatDate(t.createdAt)}, fuso {t.timezone}
                </Text>
              </View>
              <Badge
                label={t.status === 'active' ? 'Ativa' : 'Aguardando administrador'}
                tone={t.status === 'active' ? 'success' : 'neutral'}
              />
            </View>
          ))
        )}
      </Panel>
      {tenants.data?.nextCursor ? (
        <Text variant="small" color={color.textSecondary}>
          Mostrando as primeiras 100 empresas.
        </Text>
      ) : null}
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
  copy: { flex: 1, minWidth: 200, gap: 2 },
  loading: { padding: space[5], gap: space[3] },
});
