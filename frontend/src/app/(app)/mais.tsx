import type { Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { visibleDestinations } from '@/navigation/destinations';
import { roleLabel, useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Button, ListRow, Panel, Skeleton, Text } from '@/ui';
import { ArrowLeftRight, LogOut, Palette, ShieldCheck, UserRound } from '@/ui/icons';

/** Celular: seções que não cabem na barra inferior e a conta. */
export default function More() {
  const session = useSession();
  const tenant = useTenant();
  const rest = visibleDestinations(session.permissions).filter((d) => !d.primaryOnMobile);
  const many = (session.me?.memberships.length ?? 0) > 1;
  const extras = [
    many
      ? { key: 'trocar', icon: ArrowLeftRight, title: 'Trocar empresa', href: '/empresas' as Href }
      : null,
    session.isPlatformAdmin
      ? {
          key: 'plataforma',
          icon: ShieldCheck,
          title: 'Plataforma Hepta',
          href: '/plataforma' as Href,
        }
      : null,
    __DEV__
      ? {
          key: 'sistema',
          icon: Palette,
          title: 'Design system (desenvolvimento)',
          href: '/sistema' as Href,
        }
      : null,
  ].filter((x) => x !== null);

  return (
    <Screen title="Mais">
      <Panel flush>
        {rest.map((d, i) => (
          <ListRow
            key={d.key}
            icon={d.icon}
            title={d.label}
            href={d.href}
            meta={d.pending ? 'em breve' : undefined}
            last={i === rest.length - 1}
          />
        ))}
      </Panel>

      <Panel title="Conta">
        <View style={styles.account}>
          {tenant.isPending ? (
            <Skeleton width="60%" height={18} />
          ) : (
            <Text variant="bodyStrong">{tenant.data?.name ?? 'Empresa'}</Text>
          )}
          <Text variant="small" color={color.textSecondary}>
            {[session.me?.name, session.role ? roleLabel[session.role] : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text variant="small" color={color.textSecondary}>
            {session.user?.email}
          </Text>
        </View>
      </Panel>
      <Panel flush>
        <ListRow icon={UserRound} title="Meu Perfil" description="Nome, e-mail e senha" href="/meu-perfil" last />
      </Panel>
      {extras.length ? (
        <Panel flush>
          {extras.map((x, i) => (
            <ListRow
              key={x.key}
              icon={x.icon}
              title={x.title}
              href={x.href}
              last={i === extras.length - 1}
            />
          ))}
        </Panel>
      ) : null}
      <Button label="Sair" variant="outline" icon={LogOut} fullWidth onPress={session.signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  account: { gap: space[1] },
});
