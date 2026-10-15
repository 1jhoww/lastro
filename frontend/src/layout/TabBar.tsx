import { Link, usePathname, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ellipsis, Plus } from '@/ui/icons';
import { canCreateOrder, visibleDestinations } from '@/navigation/destinations';
import { useSession } from '@/session/SessionContext';
import { color, layout, radius, space } from '@/theme';
import { Text } from '@/ui';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { Touchable } from '@/ui/Touchable';
import { NavMarker } from './NavMarker';
import { isActive } from './isActive';

/**
 * Navegação inferior do celular: a base do "L". O botão central é o quadrado amarelo do símbolo
 * e abre direto a criação de pedido, a tarefa mais frequente do vendedor.
 */
export function TabBar() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { permissions } = useSession();
  const primary = visibleDestinations(permissions).filter((d) => d.primaryOnMobile);
  const showCreate = canCreateOrder(permissions);
  const left = primary.slice(0, 2);
  const right = primary.slice(2);
  const moreActive =
    !primary.some((d) => isActive(pathname, String(d.href))) &&
    !pathname.startsWith('/pedidos/novo');

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.root, { paddingBottom: Math.max(insets.bottom, space[2]) }]}
    >
      {left.map((d) => (
        <Tab key={d.key} href={d.href} label={d.label} active={isActive(pathname, String(d.href))}>
          <NavMarker icon={d.icon} active={isActive(pathname, String(d.href))} />
        </Tab>
      ))}
      {showCreate ? (
        <View style={styles.tab}>
          <Link href="/pedidos/novo" asChild>
            <Touchable
              accessibilityRole="link"
              accessibilityLabel="Novo pedido"
              pressStyle={(s: InteractionState) => [
                styles.create,
                s.pressed && { backgroundColor: color.accentPressed },
                showFocusRing(s) && focusRing(true),
              ]}
            >
              <Plus size={24} color={color.onAccent} strokeWidth={2.25} />
            </Touchable>
          </Link>
        </View>
      ) : null}
      {right.map((d) => (
        <Tab key={d.key} href={d.href} label={d.label} active={isActive(pathname, String(d.href))}>
          <NavMarker icon={d.icon} active={isActive(pathname, String(d.href))} />
        </Tab>
      ))}
      <Tab href="/mais" label="Mais" active={moreActive}>
        <NavMarker icon={Ellipsis} active={moreActive} />
      </Tab>
    </View>
  );
}

function Tab(props: { href: Href; label: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={props.href} asChild>
      <Touchable
        accessibilityRole="tab"
        accessibilityLabel={props.label}
        accessibilityState={{ selected: props.active }}
        pressStyle={(s: InteractionState) => [styles.tab, showFocusRing(s) && focusRing(true)]}
      >
        {props.children}
        <Text
          variant="caption"
          color={props.active ? color.onStructure : color.onStructureMuted}
          numberOfLines={1}
        >
          {props.label}
        </Text>
      </Touchable>
    </Link>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    backgroundColor: color.structure,
    paddingTop: space[2],
    paddingHorizontal: space[1],
    minHeight: layout.tabBarHeight,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 52,
    borderRadius: radius.md,
  },
  create: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
