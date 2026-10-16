import type { Permission } from '../users/permissions.js';

/**
 * Official Lastro plans. Plans are defined by the system, never registered freely by the
 * Super Admin: adding a plan (e.g. a future "Completo") means adding an entry here.
 *
 * Every existing module not listed in `features` stays available to every plan: customers,
 * products, inventory, orders, receivables, payments, reports and documents.
 */
export const planCodes = ['essencial', 'profissional'] as const;
export type PlanCode = (typeof planCodes)[number];

/**
 * Plan-gated capabilities. Only capabilities that already exist in the product are listed;
 * nothing here may be marked available before it is implemented.
 */
export const planFeatures = [
  // Tenant administrators invite additional users (still bounded by the user limit).
  'users.invite',
  // Public catalog / virtual storefront and its settings.
  'catalog.public',
  // Seller profile and customer portfolios assigned to sellers.
  'commercial.sellers',
] as const;
export type PlanFeature = (typeof planFeatures)[number];

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  /** Catalog version; bump when the commercial terms of the code change. */
  version: number;
  /** Commercial reference only: each subscription stores its own contracted price. */
  referencePriceCents: number;
  /** Maximum active users plus valid pending invitations for one company. */
  userLimit: number;
  features: readonly PlanFeature[];
  /** False keeps a plan readable for existing contracts but hidden for new ones. */
  offered: boolean;
}

export const planCatalog: Readonly<Record<PlanCode, PlanDefinition>> = Object.freeze({
  essencial: Object.freeze({
    code: 'essencial',
    name: 'Essencial',
    version: 1,
    referencePriceCents: 11_900,
    userLimit: 1,
    features: Object.freeze([]),
    offered: true,
  }),
  profissional: Object.freeze({
    code: 'profissional',
    name: 'Profissional',
    version: 1,
    referencePriceCents: 19_900,
    userLimit: 2,
    features: Object.freeze(['users.invite', 'catalog.public', 'commercial.sellers'] as const),
    offered: true,
  }),
});

export const featureLabels: Readonly<Record<PlanFeature, string>> = Object.freeze({
  'users.invite': 'Convite de usuários adicionais',
  'catalog.public': 'Catálogo / vitrine virtual',
  'commercial.sellers': 'Vendedores e carteiras de clientes',
});

/** Permissions that only exist while the plan includes the feature. */
const featurePermissions: Readonly<Partial<Record<PlanFeature, readonly Permission[]>>> =
  Object.freeze({
    'catalog.public': Object.freeze(['catalog:manage'] as const),
  });

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === 'string' && (planCodes as readonly string[]).includes(value);
}

export function planDefinition(code: PlanCode): PlanDefinition {
  return planCatalog[code];
}

export interface Entitlements {
  /** Null for contracts created before the official plans (legacy terms). */
  planCode: PlanCode | null;
  userLimit: number;
  features: readonly PlanFeature[];
}

/**
 * Capabilities granted by a subscription. The user limit always comes from the contract
 * snapshot, which plan changes keep aligned with the plan. Legacy contracts without an
 * official plan keep every existing capability, so the migration never disables features
 * unexpectedly.
 */
export function entitlementsFor(subscription: {
  planCode: PlanCode | null;
  userLimit: number;
}): Entitlements {
  if (subscription.planCode === null)
    return { planCode: null, userLimit: subscription.userLimit, features: planFeatures };
  return {
    planCode: subscription.planCode,
    userLimit: subscription.userLimit,
    features: planCatalog[subscription.planCode].features,
  };
}

/** Plan facts a tenant user may see about its own company. */
export function planSummary(entitlements: Entitlements) {
  return {
    code: entitlements.planCode,
    name: entitlements.planCode ? planCatalog[entitlements.planCode].name : null,
    userLimit: entitlements.userLimit,
    features: [...entitlements.features],
  };
}

export function hasFeature(entitlements: Entitlements, feature: PlanFeature): boolean {
  return entitlements.features.includes(feature);
}

/** Removes role permissions whose feature the plan does not include. */
export function withinPlan(
  permissions: readonly Permission[],
  entitlements: Entitlements,
): Permission[] {
  const blocked = new Set<Permission>();
  for (const [feature, gated] of Object.entries(featurePermissions) as [
    PlanFeature,
    readonly Permission[],
  ][])
    if (!hasFeature(entitlements, feature)) for (const permission of gated) blocked.add(permission);
  return permissions.filter((permission) => !blocked.has(permission));
}

/** Features present in `from` and missing in `to`; used to confirm downgrades explicitly. */
export function lostFeatures(from: Entitlements, to: Entitlements): PlanFeature[] {
  return from.features.filter((feature) => !to.features.includes(feature));
}
