import { useState } from 'react';
import { Link, router, usePathname, type Href } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSession } from '@/session/SessionContext';
import { color, fontFamily, layout, radius, space, useLayoutSize } from '@/theme';
import { Button, Dialog, Text } from '@/ui';
import {
  CalendarClock,
  Check,
  ChevronDown,
  CircleDollarSign,
  HandCoins,
  House,
  ListClock,
  Wallet,
  type LucideIcon,
} from '@/ui/icons';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { canManageFinance } from './FinanceAccess';

type Section = 'overview' | 'receivables' | 'settings' | 'credits' | 'refunds' | 'operations';
type Item = {
  key: Section;
  label: string;
  description: string;
  href: Href;
  permission: string;
  icon: LucideIcon;
  minor?: boolean;
};

const items: Item[] = [
  {
    key: 'overview',
    label: 'Visão geral',
    description: 'Quanto falta receber e o que vence em breve',
    href: '/financeiro',
    permission: 'receivables:read',
    icon: House,
  },
  {
    key: 'receivables',
    label: 'Contas a receber',
    description: 'Parcelas dos clientes e registro de pagamentos',
    href: '/financeiro/receber' as Href,
    permission: 'receivables:read',
    icon: CircleDollarSign,
  },
  {
    key: 'settings',
    label: 'Condições e formas',
    description: 'Prazos de pagamento e formas aceitas',
    href: '/financeiro/configuracoes' as Href,
    permission: 'payment-settings:manage',
    icon: CalendarClock,
  },
  {
    key: 'credits',
    label: 'Créditos',
    description: 'Valores que o cliente pode usar em compras',
    href: '/financeiro/creditos' as Href,
    permission: 'receivables:read',
    icon: Wallet,
    minor: true,
  },
  {
    key: 'refunds',
    label: 'Reembolsos',
    description: 'Valores a devolver e devoluções registradas',
    href: '/financeiro/reembolsos' as Href,
    permission: 'receivables:read',
    icon: HandCoins,
    minor: true,
  },
  {
    key: 'operations',
    label: 'Histórico e operações',
    description: 'Devoluções, operações em andamento e conferências',
    href: '/financeiro/operacoes' as Href,
    permission: 'receivables:read',
    icon: ListClock,
    minor: true,
  },
];

export function sectionOf(pathname: string): Section {
  const [, , first] = pathname.split('/');
  if (!first) return 'overview';
  if (first === 'receber' || first === 'pedidos') return 'receivables';
  if (first === 'configuracoes') return 'settings';
  if (first === 'creditos') return 'credits';
  if (first === 'reembolsos') return 'refunds';
  if (first === 'operacoes' || first === 'execucoes' || first === 'devolucoes') return 'operations';
  return 'receivables';
}

/**
 * Navegação do Financeiro. Desktop/tablet: três abas principais com destaque e, separadas, as
 * complementares. Celular: seletor compacto que abre a lista completa de seções, para nenhuma
 * opção ficar cortada fora da tela.
 */
export function FinanceNav() {
  const session = useSession();
  const compact = useLayoutSize() === 'compact';
  const active = sectionOf(usePathname());
  const visible = items.filter((i) => canManageFinance(session, i.permission));
  return compact ? (
    <CompactNav visible={visible} active={active} />
  ) : (
    <View style={styles.bar} accessibilityRole="tablist" accessibilityLabel="Seções do financeiro">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {visible.map((item, i) => {
          const selected = item.key === active;
          const divider = item.minor && !visible[i - 1]?.minor;
          return (
            <View key={item.key} style={styles.row}>
              {divider ? <View style={styles.divider} /> : null}
              <Link href={item.href} asChild>
                <Touchable
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item.label}
                  pressStyle={(s: InteractionState) => [
                    styles.tab,
                    selected && styles.tabActive,
                    (s.hovered || s.pressed) && !selected && styles.hover,
                    showFocusRing(s) && focusRing(),
                  ]}
                >
                  <Text
                    variant={item.minor ? 'small' : 'body'}
                    color={selected ? color.text : color.textSecondary}
                    style={{ fontFamily: selected ? fontFamily.semibold : fontFamily.medium }}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                </Touchable>
              </Link>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function CompactNav({ visible, active }: { visible: Item[]; active: Section }) {
  const [open, setOpen] = useState(false);
  const current = visible.find((i) => i.key === active) ?? visible[0];
  if (!current) return null;
  const Icon = current.icon;
  const groups = [
    { title: 'Principal', rows: visible.filter((i) => !i.minor) },
    { title: 'Mais opções', rows: visible.filter((i) => i.minor) },
  ].filter((g) => g.rows.length);
  return (
    <>
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`Seção do financeiro: ${current.label}. Trocar seção`}
        onPress={() => setOpen(true)}
        pressStyle={(s: InteractionState) => [
          styles.picker,
          (s.hovered || s.pressed) && styles.hover,
          showFocusRing(s) && focusRing(),
        ]}
      >
        <Icon size={18} color={color.text} strokeWidth={1.75} />
        <View style={styles.flex}>
          <Text variant="caption" color={color.textSecondary}>
            Financeiro
          </Text>
          <Text variant="bodyStrong" numberOfLines={1}>
            {current.label}
          </Text>
        </View>
        <Text variant="smallStrong" color={color.textSecondary}>
          Seções
        </Text>
        <ChevronDown size={18} color={color.textSecondary} />
      </Touchable>
      <Dialog
        visible={open}
        title="Seções do financeiro"
        onClose={() => setOpen(false)}
        actions={<Button label="Fechar" variant="ghost" onPress={() => setOpen(false)} />}
      >
        {groups.map((g) => (
          <View key={g.title} style={styles.group}>
            <Text variant="smallStrong" color={color.textSecondary}>
              {g.title}
            </Text>
            {g.rows.map((item) => {
              const selected = item.key === active;
              const RowIcon = item.icon;
              return (
                <Touchable
                  key={item.key}
                  accessibilityRole="link"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item.label}
                  onPress={() => {
                    setOpen(false);
                    if (!selected) router.navigate(item.href);
                  }}
                  pressStyle={(s: InteractionState) => [
                    styles.option,
                    selected && styles.optionActive,
                    (s.hovered || s.pressed) && !selected && styles.hover,
                    showFocusRing(s) && focusRing(),
                  ]}
                >
                  <RowIcon size={20} color={color.text} strokeWidth={1.75} />
                  <View style={styles.flex}>
                    <Text variant={selected ? 'bodyStrong' : 'body'}>{item.label}</Text>
                    <Text variant="small" color={color.textSecondary}>
                      {item.description}
                    </Text>
                  </View>
                  {selected ? <Check size={18} color={color.text} strokeWidth={2.25} /> : null}
                </Touchable>
              );
            })}
          </View>
        ))}
      </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: 1, borderBottomColor: color.border, marginTop: -space[2] },
  row: { flexDirection: 'row', alignItems: 'center' },
  tab: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabActive: { borderBottomColor: color.structure },
  hover: { backgroundColor: 'rgba(17,17,17,0.04)' },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: color.borderStrong,
    marginHorizontal: space[2],
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget + 8,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
    marginTop: -space[2],
  },
  flex: { flex: 1, minWidth: 0 },
  group: { gap: space[1] },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget + 8,
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  optionActive: { backgroundColor: color.accentSoft },
});
