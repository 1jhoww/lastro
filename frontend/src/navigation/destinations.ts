import type { Href } from 'expo-router';
import {
  Boxes,
  CircleDollarSign,
  ClipboardList,
  House,
  Package,
  Settings,
  ListClock,
  Store,
  Users,
  type LucideIcon,
} from '@/ui/icons';

/**
 * Permissões emitidas pelo backend em `/me` (memberships[].permissions). A navegação só esconde
 * o que o perfil não usa; a autorização efetiva é sempre do servidor.
 */
export type Permission =
  | 'tenant:read'
  | 'tenant:update'
  | 'users:manage'
  | 'customers:all:manage'
  | 'customers:own:manage'
  | 'products:read'
  | 'products:manage'
  | 'catalog:manage'
  | 'prices:manage'
  | 'inventory:available:read'
  | 'inventory:manage'
  | 'orders:own:create'
  | 'orders:own:read'
  | 'orders:own:confirm'
  | 'orders:own:dispatch'
  | 'orders:all:manage'
  | 'orders:dispatch'
  | 'discounts:apply'
  | 'receivables:read'
  | 'payments:manage'
  | 'payments:reverse'
  | 'refunds:manage'
  | 'payment-settings:manage'
  | 'reports:read'
  | 'documents:own:read';

export type Destination = {
  key: string;
  label: string;
  href: Href;
  icon: LucideIcon;
  /** Basta uma das permissões. */
  anyOf: Permission[];
  /** Aparece na barra inferior do celular; os demais vão para "Mais". */
  primaryOnMobile?: boolean;
  /** Módulo sem contrato de API ainda (Fase E). */
  pending?: boolean;
};

export const destinations: Destination[] = [
  {
    key: 'inicio',
    label: 'Início',
    href: '/',
    icon: House,
    anyOf: ['tenant:read'],
    primaryOnMobile: true,
  },
  {
    key: 'pedidos',
    label: 'Pedidos',
    href: '/pedidos',
    icon: ClipboardList,
    anyOf: ['orders:all:manage', 'orders:own:read'],
    primaryOnMobile: true,
  },
  {
    key: 'clientes',
    label: 'Clientes',
    href: '/clientes',
    icon: Users,
    anyOf: ['customers:all:manage', 'customers:own:manage'],
    primaryOnMobile: true,
  },
  {
    key: 'produtos',
    label: 'Produtos',
    href: '/produtos',
    icon: Package,
    anyOf: ['products:read', 'products:manage'],
  },
  {
    key: 'estoque',
    label: 'Estoque',
    href: '/estoque',
    icon: Boxes,
    // Vendedor vê só o disponível; administrador, saldos, entradas, ajustes e histórico.
    anyOf: ['inventory:manage', 'inventory:available:read'],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    href: '/financeiro',
    icon: CircleDollarSign,
    anyOf: ['receivables:read', 'payments:manage'],
  },
  {
    key: 'configuracoes',
    label: 'Configurações',
    href: '/configuracoes',
    icon: Settings,
    anyOf: ['tenant:read'],
  },
  {
    key: 'relatorios',
    label: 'Relatórios',
    href: '/relatorios',
    icon: ListClock,
    anyOf: ['reports:read'],
  },
  {
    key: 'catalogo',
    label: 'Catálogo público',
    href: '/configuracoes/catalogo',
    icon: Store,
    anyOf: ['catalog:manage'],
  },
];

export function visibleDestinations(permissions: readonly string[]): Destination[] {
  const granted = new Set(permissions);
  return destinations.filter((d) => d.anyOf.some((p) => granted.has(p)));
}

export function canCreateOrder(permissions: readonly string[]): boolean {
  return permissions.includes('orders:own:create') || permissions.includes('orders:all:manage');
}
