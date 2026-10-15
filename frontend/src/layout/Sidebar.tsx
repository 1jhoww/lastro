import { Link, usePathname, type Href } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Plus } from '@/ui/icons';
import { BrandSymbol, Wordmark } from '@/brand';
import { canCreateOrder, visibleDestinations, type Destination } from '@/navigation/destinations';
import { useSession } from '@/session/SessionContext';
import { color, fontFamily, layout, radius, space } from '@/theme';
import { Button, Text } from '@/ui';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { Touchable } from '@/ui/Touchable';
import { AccountMenu } from './AccountMenu';
import { NavMarker } from './NavMarker';
import { isActive } from './isActive';

/** Barra lateral escura: o pilar do "L". `rail` mostra só ícones (tablets e janelas médias). */
export function Sidebar({ rail = false }: { rail?: boolean }) {
  const pathname = usePathname();
  const session = useSession();
  const items = visibleDestinations(session.permissions);
  const settings = items.find((d) => d.key === 'configuracoes');
  const main = items.filter((d) => d.key !== 'configuracoes');

  return (
    <View
      style={[styles.root, { width: rail ? layout.railWidth : layout.sidebarWidth }]}
      role="navigation"
    >
      <View style={[styles.brand, rail && styles.brandRail]}>
        {rail ? <BrandSymbol size={30} tone="onDark" /> : <Wordmark size={30} tone="onDark" />}
      </View>

      {canCreateOrder(session.permissions) ? (
        <View style={[styles.cta, rail && styles.ctaRail]}>
          {rail ? (
            <Link href="/pedidos/novo" asChild>
              <Touchable
                accessibilityRole="link"
                accessibilityLabel="Novo pedido"
                pressStyle={(s: InteractionState) => [
                  styles.ctaSquare,
                  s.pressed && { backgroundColor: color.accentPressed },
                  showFocusRing(s) && focusRing(true),
                ]}
              >
                <Plus size={22} color={color.onAccent} strokeWidth={2.25} />
              </Touchable>
            </Link>
          ) : (
            <Link href="/pedidos/novo" asChild>
              <Button label="Novo pedido" icon={Plus} fullWidth />
            </Link>
          )}
        </View>
      ) : null}

      <ScrollView style={styles.flex} contentContainerStyle={styles.list}>
        {main.map((d) => (
          <NavItem key={d.key} item={d} active={isActive(pathname, String(d.href))} rail={rail} />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {settings ? (
          <NavItem item={settings} active={isActive(pathname, String(settings.href))} rail={rail} />
        ) : null}
        <AccountMenu rail={rail} />
      </View>
    </View>
  );
}

function NavItem({ item, active, rail }: { item: Destination; active: boolean; rail: boolean }) {
  return (
    <Link href={item.href as Href} asChild>
      <Touchable
        accessibilityRole="link"
        accessibilityLabel={item.label}
        accessibilityState={{ selected: active }}
        aria-current={active ? 'page' : undefined}
        pressStyle={(s: InteractionState) => [
          styles.item,
          rail && styles.itemRail,
          (active || s.hovered) && { backgroundColor: color.structureRaised },
          showFocusRing(s) && focusRing(true),
        ]}
      >
        <NavMarker icon={item.icon} active={active} />
        {rail ? null : (
          <>
            <Text
              variant="body"
              color={active ? color.onStructure : color.onStructureSecondary}
              style={[styles.flex, active && { fontFamily: fontFamily.medium }]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
            {item.pending ? (
              <Text variant="caption" color={color.onStructureMuted}>
                em breve
              </Text>
            ) : null}
          </>
        )}
      </Touchable>
    </Link>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.structure, height: '100%' },
  flex: { flex: 1 },
  brand: { paddingHorizontal: space[6], paddingTop: space[8], paddingBottom: space[6] },
  brandRail: { paddingHorizontal: 0, alignItems: 'center' },
  cta: { paddingHorizontal: space[4], paddingBottom: space[5] },
  ctaRail: { alignItems: 'center', paddingHorizontal: 0 },
  ctaSquare: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingHorizontal: space[3], gap: 2 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  itemRail: { justifyContent: 'center', paddingHorizontal: 0 },
  footer: {
    paddingHorizontal: space[3],
    paddingVertical: space[4],
    gap: space[3],
    borderTopWidth: 1,
    borderTopColor: color.structureLine,
  },
});
