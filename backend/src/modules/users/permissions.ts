import type { Role, Subscription } from '../../shared/schemas/models.js';
import { AppError } from '../../shared/errors/appError.js';
import { withinPlan, type Entitlements } from '../plans/catalog.js';
const seller = [
  'tenant:read',
  'products:read',
  'inventory:available:read',
  'customers:own:manage',
  'orders:own:create',
  'orders:own:confirm',
  'orders:own:read',
  'orders:own:dispatch',
  'orders:own:deliver',
  'orders:payment-options:read',
  'documents:own:read',
  'visits:own:manage',
] as const;
const administrator = [
  ...seller,
  'tenant:update',
  'users:manage',
  'customers:all:manage',
  'products:manage',
  'prices:manage',
  'discounts:apply',
  'inventory:manage',
  'orders:all:manage',
  'orders:dispatch',
  'reports:read',
  'receivables:read',
  'payments:manage',
  'payment-settings:manage',
  'payments:reverse',
  'financial-cancellation:manage',
  'refunds:manage',
  'returns:manage',
  'catalog:manage',
] as const;
export const permissionList = administrator;
export type Permission = (typeof administrator)[number];

/**
 * How an operation behaves for sellers:
 * - `required`: always granted (the seller cannot work without it);
 * - `default`: granted unless the administrator removes it;
 * - `grantable`: off by default, the administrator may grant it;
 * - `never`: administrative operation a seller can never receive (users, plans, settlements,
 *   credits, reversals, refunds, company-wide orders and customers...).
 */
export type SellerMode = 'required' | 'default' | 'grantable' | 'never';
export interface PermissionOperation {
  id: string;
  module: string;
  label: string;
  description: string;
  permissions: readonly Permission[];
  seller: SellerMode;
  /** Operations that must also be granted for this one to work (seller grants only). */
  requires: readonly string[];
}
const op = (
  id: string,
  module: string,
  label: string,
  description: string,
  permissions: readonly Permission[],
  seller: SellerMode,
  requires: readonly string[] = [],
): PermissionOperation => ({ id, module, label, description, permissions, seller, requires });

/**
 * Permission matrix by module and existing operation. Every entry maps to permissions already
 * enforced by the API routes; nothing here describes a feature that does not exist. Admins
 * always hold every operation (within the plan); sellers follow `seller`.
 */
export const permissionMatrix: readonly PermissionOperation[] = Object.freeze([
  op(
    'dashboard.view',
    'Dashboard',
    'Visualizar',
    'Painel inicial e dados da empresa.',
    ['tenant:read'],
    'required',
  ),
  op(
    'orders.view',
    'Pedidos',
    'Visualizar',
    'Consultar os próprios pedidos, histórico e condições de pagamento.',
    ['orders:own:read', 'orders:payment-options:read'],
    'default',
  ),
  op(
    'orders.edit',
    'Pedidos',
    'Criar e editar',
    'Criar e editar rascunhos dos próprios pedidos.',
    ['orders:own:create'],
    'default',
    ['orders.view', 'customers.manage', 'products.view'],
  ),
  op(
    'orders.confirm',
    'Pedidos',
    'Confirmar',
    'Confirmar os próprios pedidos, reservando estoque.',
    ['orders:own:confirm'],
    'default',
    ['orders.edit'],
  ),
  op(
    'orders.dispatch',
    'Pedidos',
    'Expedir',
    'Registrar a expedição dos próprios pedidos.',
    ['orders:own:dispatch'],
    'default',
    ['orders.view'],
  ),
  op(
    'orders.deliver',
    'Pedidos',
    'Confirmar entrega',
    'Registrar a entrega efetiva dos próprios pedidos expedidos.',
    ['orders:own:deliver'],
    'default',
    ['orders.view'],
  ),
  op(
    'orders.documents',
    'Pedidos',
    'Gerar documentos',
    'Baixar pedido comercial e romaneio em PDF.',
    ['documents:own:read'],
    'default',
    ['orders.view'],
  ),
  op(
    'orders.all',
    'Pedidos',
    'Gerenciar todos e cancelar',
    'Pedidos de toda a empresa, inclusive cancelamento.',
    ['orders:all:manage'],
    'never',
  ),
  op(
    'orders.discounts',
    'Pedidos',
    'Aprovar descontos',
    'Aprovar descontos acima do permitido.',
    ['discounts:apply'],
    'never',
  ),
  op(
    'customers.manage',
    'Clientes',
    'Gerenciar carteira própria',
    'Visualizar, criar e editar os clientes da própria carteira.',
    ['customers:own:manage'],
    'default',
  ),
  op(
    'customers.all',
    'Clientes',
    'Gerenciar todos e carteiras',
    'Clientes de toda a empresa, desativação e troca de responsável.',
    ['customers:all:manage'],
    'never',
  ),
  op(
    'visits.manage',
    'Visitas',
    'Registrar e consultar',
    'Visitas, histórico e estimativa de recompra dos clientes da própria carteira.',
    ['visits:own:manage'],
    'default',
    ['customers.manage'],
  ),
  op(
    'products.view',
    'Produtos',
    'Visualizar',
    'Consultar produtos e categorias ativos.',
    ['products:read'],
    'default',
  ),
  op(
    'products.manage',
    'Produtos',
    'Criar e editar',
    'Cadastrar, editar e desativar produtos, imagens e categorias.',
    ['products:manage'],
    'grantable',
    ['products.view'],
  ),
  op(
    'inventory.view',
    'Estoque',
    'Consultar disponibilidade',
    'Ver a quantidade disponível dos produtos.',
    ['inventory:available:read'],
    'default',
  ),
  op(
    'inventory.manage',
    'Estoque',
    'Registrar movimentações',
    'Entradas, ajustes, conferência, histórico e reposição de estoque.',
    ['inventory:manage'],
    'grantable',
    ['inventory.view', 'products.view'],
  ),
  op(
    'finance.view',
    'Financeiro',
    'Visualizar',
    'Recebíveis, pagamentos, créditos e devoluções.',
    ['receivables:read'],
    'never',
  ),
  op(
    'finance.receive',
    'Financeiro',
    'Registrar baixas e créditos',
    'Receber pagamentos e aplicar créditos.',
    ['payments:manage'],
    'never',
  ),
  op(
    'finance.reverse',
    'Financeiro',
    'Estornar',
    'Estornar pagamentos e créditos.',
    ['payments:reverse'],
    'never',
  ),
  op(
    'finance.cancel',
    'Financeiro',
    'Cancelar financeiramente',
    'Cancelamento financeiro de pedidos.',
    ['financial-cancellation:manage'],
    'never',
  ),
  op(
    'finance.refunds',
    'Financeiro',
    'Confirmar reembolsos',
    'Confirmar devoluções de dinheiro.',
    ['refunds:manage'],
    'never',
  ),
  op(
    'finance.returns',
    'Financeiro',
    'Gerenciar devoluções',
    'Registrar, receber e resolver devoluções de mercadoria.',
    ['returns:manage'],
    'never',
  ),
  op(
    'reports.view',
    'Relatórios',
    'Visualizar e exportar',
    'Relatórios comerciais dos clientes da própria carteira, em tela, CSV e PDF.',
    ['reports:read'],
    'grantable',
  ),
  op(
    'catalog.manage',
    'Catálogo',
    'Configurar vitrine',
    'Publicar e configurar o catálogo virtual.',
    ['catalog:manage'],
    'never',
  ),
  op(
    'settings.company',
    'Configurações',
    'Dados da empresa',
    'Alterar nome e fuso da empresa.',
    ['tenant:update'],
    'never',
  ),
  op(
    'settings.payments',
    'Configurações',
    'Condições e formas de pagamento',
    'Cadastrar condições e formas de pagamento.',
    ['payment-settings:manage'],
    'never',
  ),
  op(
    'users.manage',
    'Usuários',
    'Gerenciar usuários',
    'Convites, perfis, permissões e acessos da equipe.',
    ['users:manage'],
    'never',
  ),
]);
const operations = new Map(permissionMatrix.map((o) => [o.id, o]));
const sellerFixed = permissionMatrix.filter((o) => o.seller === 'required');
const sellerConfigurable = new Set(
  permissionMatrix
    .filter((o) => o.seller === 'default' || o.seller === 'grantable')
    .map((o) => o.id),
);
/** Operations a new seller receives (role defaults). */
export const sellerDefaultOperations: readonly string[] = permissionMatrix
  .filter((o) => o.seller === 'default')
  .map((o) => o.id);

export interface MemberGrant {
  role: Role;
  /** Seller operations chosen by an administrator; null keeps the role defaults. */
  operations?: readonly string[] | null;
}
/** Seller operations in force: chosen ones (or defaults) plus the required ones. */
export function sellerOperations(operationsChosen: readonly string[] | null | undefined): string[] {
  const chosen = (operationsChosen ?? sellerDefaultOperations).filter((id) =>
    sellerConfigurable.has(id),
  );
  return [...new Set([...sellerFixed.map((o) => o.id), ...chosen])];
}
/** Permissions of the member's role and custom grants, before the plan is applied. */
export function permissionsFor(subject: Role | MemberGrant): readonly Permission[] {
  const member = typeof subject === 'string' ? { role: subject } : subject;
  if (member.role === 'administrator') return administrator;
  if (member.operations == null) return seller;
  const permissions = new Set<Permission>();
  for (const id of sellerOperations(member.operations))
    for (const permission of operations.get(id)?.permissions ?? []) permissions.add(permission);
  return [...permissions];
}
/**
 * Validates an administrator's choice of seller operations: only configurable operations, with
 * their requirements. Administrative operations (`never`) are refused, whatever the request.
 */
export function validateSellerOperations(chosen: readonly string[]): string[] {
  const unique = [...new Set(chosen)];
  for (const id of unique)
    if (!sellerConfigurable.has(id))
      throw new AppError(403, 'PERMISSION_NOT_ALLOWED', 'Permissão indisponível para vendedores');
  const granted = new Set(sellerOperations(unique));
  for (const id of unique)
    for (const requirement of operations.get(id)?.requires ?? [])
      if (!granted.has(requirement))
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          `"${operations.get(id)?.module} · ${operations.get(id)?.label}" exige "${operations.get(requirement)?.module} · ${operations.get(requirement)?.label}"`,
        );
  return unique.sort();
}
/** Role permissions limited to what the contracted plan includes. */
export function effectivePermissions(
  member: Role | MemberGrant,
  entitlements: Entitlements,
): Permission[] {
  return withinPlan(permissionsFor(member), entitlements);
}
/** Distinguishes "the role cannot" (FORBIDDEN) from "the plan does not include" it. */
export function requirePermission(
  member: Role | MemberGrant,
  entitlements: Entitlements,
  permission: Permission,
): void {
  if (!permissionsFor(member).includes(permission))
    throw new AppError(403, 'FORBIDDEN', 'Operação não permitida');
  if (!effectivePermissions(member, entitlements).includes(permission)) throw featureNotInPlan();
}
/** Whether the caller holds a permission, for read models that adapt to it. */
export function holds(
  ctx: { membership: MemberGrant; entitlements: Entitlements },
  permission: Permission,
): boolean {
  return effectivePermissions(ctx.membership, ctx.entitlements).includes(permission);
}
export function featureNotInPlan(): AppError {
  return new AppError(403, 'FEATURE_NOT_IN_PLAN', 'Recurso indisponível no plano contratado');
}
export function enforceSubscription(status: Subscription['status']): void {
  if (status === 'suspended')
    throw new AppError(403, 'SUBSCRIPTION_SUSPENDED', 'Acesso indisponível para esta empresa');
  if (status === 'canceled')
    throw new AppError(403, 'SUBSCRIPTION_INACTIVE', 'Acesso indisponível para esta empresa');
}
// Shared by private endpoints and, in a future phase, the public catalog.
export function publicCatalogAllowed(status: Subscription['status']): boolean {
  return status === 'pending' || status === 'active' || status === 'past_due';
}
