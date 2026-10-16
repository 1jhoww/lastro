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
  'orders:payment-options:read',
  'documents:own:read',
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
export type Permission = (typeof administrator)[number];
export function permissionsFor(role: Role): readonly Permission[] {
  return role === 'administrator' ? administrator : seller;
}
/** Role permissions limited to what the contracted plan includes. */
export function effectivePermissions(role: Role, entitlements: Entitlements): Permission[] {
  return withinPlan(permissionsFor(role), entitlements);
}
/** Distinguishes "the role cannot" (FORBIDDEN) from "the plan does not include" it. */
export function requirePermission(
  role: Role,
  entitlements: Entitlements,
  permission: Permission,
): void {
  if (!permissionsFor(role).includes(permission))
    throw new AppError(403, 'FORBIDDEN', 'Operação não permitida');
  if (!effectivePermissions(role, entitlements).includes(permission)) throw featureNotInPlan();
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
