import type { Role, Subscription } from '../../shared/schemas/models.js';
import { AppError } from '../../shared/errors/appError.js';
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
export function enforceSubscription(status: Subscription['status']): void {
  if (status === 'suspended')
    throw new AppError(403, 'SUBSCRIPTION_SUSPENDED', 'Acesso indisponível para esta empresa');
  if (status === 'canceled')
    throw new AppError(403, 'SUBSCRIPTION_INACTIVE', 'Acesso indisponível para esta empresa');
}
// Shared by private endpoints and, in a future phase, the public catalog.
export function publicCatalogAllowed(status: Subscription['status']): boolean {
  return status === 'active' || status === 'past_due';
}
