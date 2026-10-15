import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { Membership } from '@/api/types';
import { accessCopy } from '@/features/session/accessCopy';
import { AccountFrame } from '@/features/session/AccountFrame';
import { roleLabel, tenantHeader, useSession } from '@/session/SessionContext';
import { color, radius, space } from '@/theme';
import { Badge, ListRow, Panel, Skeleton, Text } from '@/ui';
import { Building, ChevronRight, ShieldCheck } from '@/ui/icons';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';

/** Escolha de empresa para quem tem mais de um vínculo. */
export default function ChooseTenant() {
  const session = useSession();
  const router = useRouter();
  const memberships = session.me?.memberships ?? [];

  const choose = (tenantId: string) => {
    session.selectTenant(tenantId);
    router.replace('/');
  };

  return (
    <AccountFrame
      title="Escolha a empresa"
      description="Você tem acesso a mais de uma empresa. Dá para trocar depois pelo menu da conta."
    >
      <Panel flush>
        {memberships.map((m, i) => (
          <TenantRow
            key={m.tenantId}
            membership={m}
            current={m.tenantId === session.tenantId}
            last={i === memberships.length - 1}
            onPress={() => choose(m.tenantId)}
          />
        ))}
      </Panel>
      {session.isPlatformAdmin ? (
        <Panel flush>
          <ListRow
            icon={ShieldCheck}
            title="Plataforma Hepta"
            description="Empresas, planos e assinaturas"
            href="/plataforma"
            last
          />
        </Panel>
      ) : null}
    </AccountFrame>
  );
}

function TenantRow({
  membership,
  current,
  last,
  onPress,
}: {
  membership: Membership;
  current: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const { apiFor } = useSession();
  const allowed = membership.access === 'allowed';
  // O nome só pode ser lido em empresas liberadas; as bloqueadas não expõem dados.
  const summary = useQuery({
    queryKey: queryKeys.tenantSummary(membership.tenantId),
    queryFn: () =>
      unwrap(
        apiFor(membership.tenantId).GET('/api/v1/tenants/current', {
          params: { header: tenantHeader(membership.tenantId) },
        }),
      ),
    enabled: allowed,
    staleTime: 5 * 60_000,
  });
  const blocked = membership.access === 'allowed' ? null : accessCopy[membership.access];
  const name = allowed ? summary.data?.name : 'Empresa indisponível';

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={`${name ?? 'Empresa'}, ${roleLabel[membership.role]}`}
      onPress={onPress}
      pressStyle={(s: InteractionState) => [
        styles.row,
        !last && styles.divider,
        (s.hovered || s.pressed) && { backgroundColor: 'rgba(17,17,17,0.03)' },
        showFocusRing(s) && focusRing(),
      ]}
    >
      <View style={styles.icon}>
        <Building size={20} color={color.text} strokeWidth={1.75} />
      </View>
      <View style={styles.copy}>
        {allowed && summary.isPending ? (
          <Skeleton width="60%" height={16} />
        ) : (
          <Text variant="bodyStrong" numberOfLines={1}>
            {name ?? 'Nome indisponível agora'}
          </Text>
        )}
        <Text variant="small" color={color.textSecondary}>
          {current ? `${roleLabel[membership.role]}, empresa atual` : roleLabel[membership.role]}
        </Text>
      </View>
      {blocked ? <Badge label={blocked.label} tone={blocked.tone} /> : null}
      <ChevronRight size={18} color={color.textSecondary} />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 68,
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 2 },
});
