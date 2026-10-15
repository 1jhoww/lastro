import type { ReactNode } from 'react';
import { Link, usePathname, type Href } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wordmark } from '@/brand';
import { NavMarker } from '@/layout/NavMarker';
import { useSession } from '@/session/SessionContext';
import { color, fontFamily, layout, radius, space, useLayoutSize } from '@/theme';
import { Button, Text } from '@/ui';
import { ArrowLeft, Building, CreditCard, Layers, LogOut } from '@/ui/icons';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { ReauthGate } from './ReauthGate';

const items = [
  { href: '/plataforma', label: 'Empresas', icon: Building },
  { href: '/plataforma/assinaturas', label: 'Assinaturas', icon: CreditCard },
  { href: '/plataforma/planos', label: 'Planos', icon: Layers },
] as const;

const activeHref = (pathname: string) =>
  [...items].reverse().find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    ?.href ?? '/plataforma';

/**
 * Área da plataforma Hepta, separada da área da empresa. Usa só rotas /admin do backend:
 * empresas, planos e assinaturas. Não lê clientes, produtos, estoque ou pedidos de ninguém.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const size = useLayoutSize();
  const pathname = usePathname();
  const session = useSession();
  const insets = useSafeAreaInsets();
  const inTenant = session.gate.kind === 'tenant';
  const current = activeHref(pathname);

  const body = (
    <ScrollView
      style={styles.main}
      contentContainerStyle={[styles.content, size === 'compact' && styles.contentCompact]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.inner}>
        <ReauthGate>{children}</ReauthGate>
      </View>
    </ScrollView>
  );

  if (size === 'compact') {
    return (
      <View style={styles.fill}>
        <View style={[styles.topbar, { paddingTop: insets.top + space[3] }]}>
          <View style={styles.topRow}>
            <View>
              <Wordmark size={22} tone="onDark" />
              <Text variant="caption" color={color.onStructureMuted}>
                Plataforma Hepta
              </Text>
            </View>
            <Button
              label="Sair"
              size="sm"
              variant="onStructure"
              icon={LogOut}
              onPress={session.signOut}
            />
          </View>
          <PlatformTabs current={current} />
        </View>
        {body}
      </View>
    );
  }

  return (
    <View style={[styles.fill, styles.row]}>
      <View style={styles.sidebar} role="navigation">
        <View style={styles.brand}>
          <Wordmark size={28} tone="onDark" />
          <Text variant="small" color={color.onStructureSecondary}>
            Plataforma Hepta
          </Text>
        </View>
        <View style={styles.list}>
          {items.map((i) => (
            <Link key={i.href} href={i.href as Href} asChild>
              <Touchable
                accessibilityRole="link"
                accessibilityLabel={i.label}
                aria-current={current === i.href ? 'page' : undefined}
                pressStyle={(s: InteractionState) => [
                  styles.item,
                  (current === i.href || s.hovered) && { backgroundColor: color.structureRaised },
                  showFocusRing(s) && focusRing(true),
                ]}
              >
                <NavMarker icon={i.icon} active={current === i.href} />
                <Text
                  variant="body"
                  color={current === i.href ? color.onStructure : color.onStructureSecondary}
                  style={current === i.href && { fontFamily: fontFamily.medium }}
                >
                  {i.label}
                </Text>
              </Touchable>
            </Link>
          ))}
        </View>
        <View style={styles.footer}>
          <Text variant="caption" color={color.onStructureMuted} numberOfLines={1}>
            {session.user?.email}
          </Text>
          <View style={styles.footerActions}>
            {inTenant ? (
              <Link href="/" asChild>
                <Button label="Voltar à empresa" size="sm" variant="onStructure" icon={ArrowLeft} />
              </Link>
            ) : null}
            <Button
              label="Sair"
              size="sm"
              variant="onStructure"
              icon={LogOut}
              onPress={session.signOut}
            />
          </View>
        </View>
      </View>
      {body}
    </View>
  );
}

/** Celular: seções da plataforma em abas sob a barra escura. */
function PlatformTabs({ current }: { current: string }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabs}
    >
      {items.map((i) => {
        const selected = current === i.href;
        return (
          <Link key={i.href} href={i.href as Href} asChild>
            <Touchable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              pressStyle={(s: InteractionState) => [
                styles.tab,
                selected && styles.tabSelected,
                showFocusRing(s) && focusRing(true),
              ]}
            >
              <Text
                variant="smallStrong"
                color={selected ? color.onAccent : color.onStructureSecondary}
              >
                {i.label}
              </Text>
            </Touchable>
          </Link>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.canvas },
  row: { flexDirection: 'row' },
  main: { flex: 1 },
  content: { padding: space[10], paddingBottom: space[12] },
  contentCompact: { padding: space[4], paddingBottom: space[12] },
  inner: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', gap: space[6] },
  sidebar: { width: layout.sidebarWidth, backgroundColor: color.structure, height: '100%' },
  brand: {
    paddingHorizontal: space[6],
    paddingTop: space[8],
    paddingBottom: space[6],
    gap: space[1],
  },
  list: { flex: 1, paddingHorizontal: space[3], gap: 2 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  footer: {
    padding: space[4],
    gap: space[3],
    borderTopWidth: 1,
    borderTopColor: color.structureLine,
  },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  topbar: {
    backgroundColor: color.structure,
    paddingHorizontal: space[4],
    paddingBottom: space[3],
    gap: space[3],
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tabs: { gap: space[2] },
  tab: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.sm },
  tabSelected: { backgroundColor: color.accent },
});
