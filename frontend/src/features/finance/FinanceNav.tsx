import { useState, type ReactNode } from 'react';
import { Link, router, usePathname, type Href } from 'expo-router';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSession } from '@/session/SessionContext';
import { breakpoint, color, fontFamily, layout, radius, space } from '@/theme';
import { Button, Dialog, Text } from '@/ui';
import {
  CalendarClock,
  Check,
  ChevronDown,
  CircleDollarSign,
  FileText,
  HandCoins,
  House,
  ListClock,
  Repeat,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from '@/ui/icons';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { canManageFinance } from './FinanceAccess';

type Section =
  | 'overview'
  | 'management'
  | 'receivables'
  | 'payables'
  | 'recurring'
  | 'reports'
  | 'supplierCredits'
  | 'settings'
  | 'credits'
  | 'refunds'
  | 'operations';
type Item = {
  key: Section;
  label: string;
  description: string;
  href: Href;
  permission: string;
  icon: LucideIcon;
  minor?: boolean;
  /** Basta a permissão: vale para vendedor autorizado, não só para administrador. */
  byPermission?: boolean;
  /** Além de `permission`, exige ao menos uma destas. */
  anyOf?: string[];
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
    key: 'management',
    label: 'Painel de gestão',
    description: 'Caixa, previsão e resultado do período',
    href: '/financeiro/gestao' as Href,
    permission: 'financial-dashboard:read',
    icon: TrendingUp,
    byPermission: true,
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
    key: 'payables',
    label: 'Contas a pagar',
    description: 'Títulos de compras e despesas e seus pagamentos',
    href: '/financeiro/pagar' as Href,
    permission: 'payables:read',
    icon: Wallet,
    byPermission: true,
  },
  {
    key: 'recurring',
    label: 'Despesas recorrentes',
    description: 'Aluguel, internet e o que se repete',
    href: '/financeiro/recorrentes' as Href,
    permission: 'recurring:read',
    icon: Repeat,
    byPermission: true,
  },
  {
    key: 'reports',
    label: 'Relatórios',
    description: 'Títulos, resultado e despesas, com filtros e exportação',
    href: '/financeiro/relatorios' as Href,
    permission: 'reports:read',
    icon: FileText,
    anyOf: ['receivables:read', 'financial-reports:read'],
  },
  {
    key: 'supplierCredits',
    label: 'Créditos de fornecedores',
    description: 'Valores de compras encerradas, a usar ou a recuperar',
    href: '/financeiro/creditos-fornecedor' as Href,
    permission: 'supplier-credits:read',
    icon: Wallet,
    minor: true,
    byPermission: true,
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
  {
    key: 'settings',
    label: 'Condições e formas',
    description: 'Prazos de pagamento e formas aceitas',
    href: '/financeiro/configuracoes' as Href,
    permission: 'payment-settings:manage',
    icon: CalendarClock,
    minor: true,
  },
];

type FinanceSession = Parameters<typeof canManageFinance>[0];

/** Só o que o plano e as permissões da pessoa alcançam; o servidor continua autorizando tudo. */
export function financeSections(session: FinanceSession): Item[] {
  return items.filter((i) => {
    if (i.anyOf && !i.anyOf.some((p) => session.permissions.includes(p))) return false;
    return i.byPermission
      ? session.permissions.includes(i.permission)
      : canManageFinance(session, i.permission);
  });
}

const groupsOf = (visible: Item[]) =>
  [
    { title: 'Principal', rows: visible.filter((i) => !i.minor) },
    { title: 'Mais opções', rows: visible.filter((i) => i.minor) },
  ].filter((g) => g.rows.length);

/**
 * A coluna só cabe ao lado da barra lateral do app com folga para tabelas; abaixo disso, a mesma
 * lista abre pelo seletor.
 */
export function useFinanceRail() {
  return useWindowDimensions().width >= breakpoint.financeRail;
}

export function sectionOf(pathname: string): Section {
  const [, , first] = pathname.split('/');
  if (!first) return 'overview';
  if (first === 'gestao') return 'management';
  if (first === 'pagar') return 'payables';
  if (first === 'recorrentes') return 'recurring';
  if (first === 'relatorios') return 'reports';
  if (first === 'creditos-fornecedor') return 'supplierCredits';
  if (first === 'receber' || first === 'pedidos') return 'receivables';
  if (first === 'configuracoes') return 'settings';
  if (first === 'creditos') return 'credits';
  if (first === 'reembolsos') return 'refunds';
  if (first === 'operacoes' || first === 'execucoes' || first === 'devolucoes') return 'operations';
  return 'receivables';
}

/**
 * Seletor do Financeiro dentro de cada tela, para quando a coluna lateral não cabe: abre a lista
 * completa de seções, para nenhuma opção ficar cortada fora da tela.
 */
export function FinanceNav() {
  const session = useSession();
  const rail = useFinanceRail();
  const active = sectionOf(usePathname());
  if (rail) return null;
  return <CompactNav visible={financeSections(session)} active={active} />;
}

/** Área do Financeiro: a coluna fica fora da rolagem e não muda entre as seções. */
export function FinanceFrame({ children }: { children: ReactNode }) {
  const rail = useFinanceRail();
  return (
    <View style={styles.frame}>
      {rail ? <FinanceSideNav /> : null}
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

function FinanceSideNav() {
  const session = useSession();
  const active = sectionOf(usePathname());
  const groups = groupsOf(financeSections(session));
  if (!groups.length) return null;
  return (
    <View style={styles.rail} role="navigation" aria-label="Seções do financeiro">
      <ScrollView contentContainerStyle={styles.railList}>
        {groups.map((g) => (
          <View key={g.title} style={styles.railGroup}>
            <Text variant="caption" color={color.textSecondary} style={styles.railTitle}>
              {g.title}
            </Text>
            {g.rows.map((item) => {
              const selected = item.key === active;
              const Icon = item.icon;
              return (
                <Link key={item.key} href={item.href} asChild>
                  <Touchable
                    accessibilityRole="link"
                    accessibilityState={{ selected }}
                    accessibilityLabel={item.label}
                    aria-current={selected ? 'page' : undefined}
                    pressStyle={(s: InteractionState) => [
                      styles.railItem,
                      selected && styles.optionActive,
                      (s.hovered || s.pressed) && !selected && styles.hover,
                      showFocusRing(s) && focusRing(),
                    ]}
                  >
                    <Icon
                      size={18}
                      color={selected ? color.text : color.textSecondary}
                      strokeWidth={1.75}
                    />
                    <Text
                      variant="small"
                      color={selected ? color.text : color.textSecondary}
                      style={[
                        styles.flex,
                        { fontFamily: selected ? fontFamily.semibold : fontFamily.medium },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Touchable>
                </Link>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function CompactNav({ visible, active }: { visible: Item[]; active: Section }) {
  const [open, setOpen] = useState(false);
  const current = visible.find((i) => i.key === active) ?? visible[0];
  if (!current) return null;
  const Icon = current.icon;
  const groups = groupsOf(visible);
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
  frame: { flex: 1, flexDirection: 'row', backgroundColor: color.canvas },
  rail: {
    width: layout.financeRailWidth,
    backgroundColor: color.surface,
    borderRightWidth: 1,
    borderRightColor: color.border,
  },
  railList: {
    paddingTop: space[8],
    paddingBottom: space[6],
    paddingHorizontal: space[3],
    gap: space[6],
  },
  railGroup: { gap: 2 },
  railTitle: { paddingHorizontal: space[3], paddingBottom: space[1] },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget - 4,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
  },
  hover: { backgroundColor: 'rgba(17,17,17,0.04)' },
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
