import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTenant } from '@/features/session/useTenant';
import { roleLabel, useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Button, IconButton, Skeleton, Text } from '@/ui';
import { ArrowLeftRight, LogOut, ShieldCheck, UserRound } from '@/ui/icons';

/**
 * Conta na barra lateral: empresa, perfil e e-mail, com trocar empresa, plataforma e sair.
 * No trilho (janela média) vira só o botão de sair.
 */
export function AccountMenu({ rail = false }: { rail?: boolean }) {
  const session = useSession();
  const tenant = useTenant();
  const many = (session.me?.memberships.length ?? 0) > 1;

  if (rail) {
    return (
      <View style={styles.rail}>
        <Link href="/meu-perfil" asChild>
          <IconButton icon={UserRound} label="Meu Perfil" tone="onStructure" />
        </Link>
        <IconButton icon={LogOut} label="Sair" tone="onStructure" onPress={session.signOut} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.identity}>
        {tenant.isPending ? (
          <Skeleton width="70%" height={16} />
        ) : (
          <Text variant="bodyStrong" color={color.onStructure} numberOfLines={1}>
            {tenant.data?.name ?? 'Empresa'}
          </Text>
        )}
        <Text variant="caption" color={color.onStructureSecondary} numberOfLines={1}>
          {[session.me?.name, session.role ? roleLabel[session.role] : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Text variant="caption" color={color.onStructureMuted} numberOfLines={1}>
          {session.user?.email}
        </Text>
      </View>
      <View style={styles.actions}>
        <Link href="/meu-perfil" asChild>
          <Button label="Meu Perfil" variant="onStructure" size="sm" icon={UserRound} />
        </Link>
        {many ? (
          <Link href="/empresas" asChild>
            <Button label="Trocar empresa" variant="onStructure" size="sm" icon={ArrowLeftRight} />
          </Link>
        ) : null}
        {session.isPlatformAdmin ? (
          <Link href="/plataforma" asChild>
            <Button label="Plataforma" variant="onStructure" size="sm" icon={ShieldCheck} />
          </Link>
        ) : null}
        <Button
          label="Sair"
          variant="onStructure"
          size="sm"
          icon={LogOut}
          onPress={session.signOut}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: space[3], gap: space[3] },
  identity: { gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  rail: { alignItems: 'center' },
});
