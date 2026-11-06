import type { Permission } from '../users/permissions.js';
import { AppError } from '../../shared/errors/appError.js';

/**
 * Official Lastro plans. They are defined by the system: adding one (e.g. a future "Completo")
 * means adding an entry here. Offers negotiated with one company are custom plans, kept apart in
 * `customPlans` so that they never change this catalog or its prices.
 *
 * Every module not listed in `features` stays available to every plan: customers, products,
 * inventory, orders, receivables, payments, the commercial reports and documents.
 */
export const planCodes = ['essencial', 'profissional', 'gestao'] as const;
export type PlanCode = (typeof planCodes)[number];

/** `planCode` of a contract on a custom plan: its terms live in the contract snapshot. */
export const customPlanCode = 'custom';
export const contractPlanCodes = [...planCodes, customPlanCode] as const;
export type ContractPlanCode = (typeof contractPlanCodes)[number];

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
  // Commercial visits, customer relationship history and repurchase estimates.
  'commercial.visits',
  // Company logo uploads; logo and product photos in order PDFs; logo in the public catalog.
  // Without it documents keep the company name and the Lastro identity, and stored logos and
  // product photos are preserved for a later upgrade.
  'branding.custom',
  // Supplier registry, including marking customers as suppliers (Lastro Gestão).
  'purchasing.suppliers',
  // Purchase orders and goods receipts: a purchase without its receipt never reaches the stock.
  'purchasing.orders',
  // Product acquisition costs, margins and profitability.
  'costing.products',
  // Accounts payable and one-off expenses.
  'finance.payables',
  // Recurring expenses and the titles they generate.
  'finance.recurring',
  // Financial dashboard: consolidated cash flow, forecast and period result.
  'finance.dashboard',
  // Financial reports.
  'finance.management',
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

const professionalFeatures = [
  'users.invite',
  'catalog.public',
  'commercial.sellers',
  'commercial.visits',
  'branding.custom',
] as const;

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
    features: Object.freeze([...professionalFeatures]),
    offered: true,
  }),
  gestao: Object.freeze({
    code: 'gestao',
    name: 'Gestão',
    version: 1,
    referencePriceCents: 29_900,
    userLimit: 5,
    features: Object.freeze([
      ...professionalFeatures,
      'purchasing.suppliers',
      'purchasing.orders',
      'costing.products',
      'finance.payables',
      'finance.recurring',
      'finance.dashboard',
      'finance.management',
    ] as const),
    offered: true,
  }),
});

export const featureLabels: Readonly<Record<PlanFeature, string>> = Object.freeze({
  'users.invite': 'Convite de usuários adicionais',
  'catalog.public': 'Catálogo / vitrine virtual',
  'commercial.sellers': 'Vendedores e carteiras de clientes',
  'commercial.visits': 'Visitas e recompra',
  'branding.custom': 'Logotipo e fotos nos documentos e no catálogo',
  'purchasing.suppliers': 'Fornecedores',
  'purchasing.orders': 'Compras e recebimento de mercadorias',
  'costing.products': 'Custos de aquisição, margens e rentabilidade',
  'finance.payables': 'Contas a pagar e despesas',
  'finance.recurring': 'Despesas recorrentes',
  'finance.dashboard': 'Dashboard financeiro e fluxo de caixa',
  'finance.management': 'Relatórios financeiros',
});

export const featureCategories = [
  { code: 'commercial', label: 'Equipe e comercial' },
  { code: 'storefront', label: 'Catálogo e marca' },
  { code: 'purchasing', label: 'Compras e custos' },
  { code: 'finance', label: 'Financeiro' },
] as const;
export type FeatureCategory = (typeof featureCategories)[number]['code'];

export interface FeatureDefinition {
  code: PlanFeature;
  label: string;
  description: string;
  category: FeatureCategory;
  /** Features without which this one leaves screens broken or operations incomplete. */
  requires: readonly PlanFeature[];
}

const feature = (
  code: PlanFeature,
  category: FeatureCategory,
  description: string,
  requires: readonly PlanFeature[] = [],
): FeatureDefinition => ({ code, label: featureLabels[code], category, description, requires });

/**
 * What a custom plan can include. The record is keyed by `PlanFeature`, so a new feature does not
 * compile until it has a category and its dependencies here.
 */
export const featureCatalog: Readonly<Record<PlanFeature, FeatureDefinition>> = Object.freeze({
  'users.invite': feature(
    'users.invite',
    'commercial',
    'O administrador da empresa convida outras pessoas, dentro do limite de usuários.',
  ),
  'commercial.sellers': feature(
    'commercial.sellers',
    'commercial',
    'Perfil Vendedor, carteiras de clientes e relatório por vendedor.',
    ['users.invite'],
  ),
  'commercial.visits': feature(
    'commercial.visits',
    'commercial',
    'Registro de visitas, histórico do cliente e estimativa de recompra.',
  ),
  'catalog.public': feature(
    'catalog.public',
    'storefront',
    'Vitrine pública com os produtos da empresa e suas configurações.',
  ),
  'branding.custom': feature(
    'branding.custom',
    'storefront',
    'Logotipo e fotos de produto nos documentos e no catálogo.',
  ),
  'purchasing.suppliers': feature(
    'purchasing.suppliers',
    'purchasing',
    'Cadastro de fornecedores e marcação de clientes como fornecedores.',
  ),
  'purchasing.orders': feature(
    'purchasing.orders',
    'purchasing',
    'Pedidos de compra e recebimento das mercadorias, que entra no estoque e atualiza o custo.',
    ['purchasing.suppliers', 'costing.products', 'finance.payables'],
  ),
  'costing.products': feature(
    'costing.products',
    'purchasing',
    'Custo de referência, custo médio, margens e rentabilidade dos produtos.',
  ),
  'finance.payables': feature(
    'finance.payables',
    'finance',
    'Títulos a pagar, despesas avulsas, pagamentos, estornos e créditos de fornecedor.',
  ),
  'finance.recurring': feature(
    'finance.recurring',
    'finance',
    'Regras que geram títulos a pagar por vencimento, inclusive pela rotina diária.',
    ['finance.payables'],
  ),
  'finance.dashboard': feature(
    'finance.dashboard',
    'finance',
    'Painel com entradas, saídas, previsão, saldo e resultado do período.',
    ['finance.payables', 'costing.products'],
  ),
  'finance.management': feature(
    'finance.management',
    'finance',
    'Fluxo de caixa, resultado e rentabilidade em relatórios de toda a empresa.',
    ['finance.payables', 'costing.products'],
  ),
});

/**
 * Modules every plan has, shown as included and never selectable. The Essencial plan is the floor
 * of any offer: confirming an order creates receivables and moves stock, so taking one of them
 * out would leave operations half done. Every permission is either here or in `featurePermissions`.
 */
export const baseResources: readonly {
  code: string;
  label: string;
  description: string;
  permissions: readonly Permission[];
}[] = Object.freeze([
  {
    code: 'customers-orders',
    label: 'Clientes e pedidos',
    description: 'Cadastro de clientes, pedidos, expedição, entrega e documentos.',
    permissions: [
      'customers:own:manage',
      'customers:all:manage',
      'orders:own:create',
      'orders:own:confirm',
      'orders:own:read',
      'orders:own:dispatch',
      'orders:own:deliver',
      'orders:payment-options:read',
      'orders:all:manage',
      'orders:dispatch',
      'discounts:apply',
      'bonuses:grant',
      'documents:own:read',
      'returns:manage',
    ],
  },
  {
    code: 'products-inventory',
    label: 'Produtos e estoque',
    description: 'Produtos, categorias, preços, saldos, movimentações e reposição.',
    permissions: [
      'products:read',
      'products:manage',
      'prices:manage',
      'inventory:available:read',
      'inventory:manage',
    ],
  },
  {
    code: 'receivables',
    label: 'Contas a receber',
    description: 'Parcelas dos pedidos, recebimentos, créditos, estornos e reembolsos.',
    permissions: [
      'receivables:read',
      'receivables:manage',
      'payments:manage',
      'payments:reverse',
      'payment-settings:manage',
      'financial-cancellation:manage',
      'refunds:manage',
    ],
  },
  {
    code: 'commercial-reports',
    label: 'Relatórios comerciais',
    description: 'Relatórios de vendas e clientes em tela, CSV e PDF.',
    permissions: ['reports:read'],
  },
  {
    code: 'company',
    label: 'Empresa e equipe',
    description: 'Dados da empresa, painel inicial e gestão dos usuários.',
    permissions: ['tenant:read', 'tenant:update', 'users:manage'],
  },
]);

/** Permissions that only exist while the plan includes the feature. */
const featurePermissions: Readonly<Partial<Record<PlanFeature, readonly Permission[]>>> =
  Object.freeze({
    'catalog.public': Object.freeze(['catalog:manage'] as const),
    'commercial.visits': Object.freeze(['visits:own:manage'] as const),
    'branding.custom': Object.freeze(['branding:manage'] as const),
    'purchasing.suppliers': Object.freeze(['suppliers:manage'] as const),
    'purchasing.orders': Object.freeze([
      'purchases:read',
      'purchases:create',
      'purchases:edit',
      'purchases:confirm',
      'purchases:receive',
      'purchases:close',
    ] as const),
    'costing.products': Object.freeze(['costs:read'] as const),
    'finance.payables': Object.freeze([
      'payables:read',
      'payables:manage',
      'payables:pay',
      'payables:reverse',
    ] as const),
    'finance.recurring': Object.freeze(['recurring:read', 'recurring:manage'] as const),
    'finance.dashboard': Object.freeze(['financial-dashboard:read'] as const),
    'finance.management': Object.freeze(['financial-reports:read'] as const),
  });

/**
 * Permissions no feature grants or removes: they keep reading records the company already has
 * after a plan change. The role still decides who holds them, and the service that owns the
 * records decides when there is something left to read.
 */
export const retainedPermissions: readonly Permission[] = Object.freeze(['supplier-credits:read']);

/** Permissions a feature grants; `users.invite` and `commercial.sellers` are checked directly. */
export function permissionsOfFeature(code: PlanFeature): readonly Permission[] {
  return featurePermissions[code] ?? [];
}

/**
 * Features the backend recognizes, in catalog order. Stored lists go through here, so a feature
 * retired from the code grants nothing and one added later is never granted by default.
 */
export function recognizedFeatures(features: readonly string[]): PlanFeature[] {
  return planFeatures.filter((code) => features.includes(code));
}

/** The chosen features plus everything they depend on, directly or not. */
export function withDependencies(features: readonly PlanFeature[]): PlanFeature[] {
  const included = new Set<PlanFeature>();
  const visit = (code: PlanFeature) => {
    if (included.has(code)) return;
    included.add(code);
    featureCatalog[code].requires.forEach(visit);
  };
  features.forEach(visit);
  return planFeatures.filter((code) => included.has(code));
}

/**
 * Refuses a combination that would leave screens broken or operations incomplete. Dependencies
 * are never added here: the Super Admin sees them first and the request states the final list.
 */
export function requireValidComposition(input: {
  features: readonly PlanFeature[];
  userLimit: number;
}): void {
  for (const code of input.features) {
    const missing = featureCatalog[code].requires.filter((r) => !input.features.includes(r));
    if (missing.length)
      throw new AppError(
        422,
        'PLAN_DEPENDENCY_MISSING',
        `"${featureLabels[code]}" exige ${missing.map((m) => `"${featureLabels[m]}"`).join(', ')}`,
      );
  }
  if (input.features.includes('users.invite') && input.userLimit < 2)
    throw new AppError(
      422,
      'PLAN_USER_LIMIT_INVALID',
      'Convites de usuários adicionais exigem limite de pelo menos 2 usuários',
    );
}

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === 'string' && (planCodes as readonly string[]).includes(value);
}

export function planDefinition(code: PlanCode): PlanDefinition {
  return planCatalog[code];
}

export interface Entitlements {
  /** Null for contracts created before the official plans (legacy terms). */
  planCode: ContractPlanCode | null;
  /** Null for legacy contracts. */
  planName: string | null;
  userLimit: number;
  features: readonly PlanFeature[];
}

/**
 * Capabilities granted by a subscription. The user limit always comes from the contract
 * snapshot, which plan changes keep aligned with the plan. Official plans take their features from
 * the catalog; a custom plan takes them from its own contract snapshot, so editing the offer never
 * reaches a company. Anything else gets no plan-gated feature: premium capabilities are only
 * granted by what the company contracted, never by default.
 */
export function entitlementsFor(subscription: {
  planCode: ContractPlanCode | null;
  userLimit: number;
  customContract?: { planName: string; features: readonly string[] } | null | undefined;
}): Entitlements {
  const { planCode, userLimit, customContract } = subscription;
  if (planCode === null) return { planCode: null, planName: null, userLimit, features: [] };
  if (planCode === customPlanCode)
    return {
      planCode,
      planName: customContract?.planName ?? 'Plano personalizado',
      userLimit,
      features: recognizedFeatures(customContract?.features ?? []),
    };
  const plan = planCatalog[planCode];
  return { planCode, planName: plan.name, userLimit, features: plan.features };
}

/** Plan facts a tenant user may see about its own company. */
export function planSummary(entitlements: Entitlements) {
  return {
    code: entitlements.planCode,
    name: entitlements.planName,
    userLimit: entitlements.userLimit,
    features: [...entitlements.features],
  };
}

export function hasFeature(entitlements: Entitlements, feature: PlanFeature): boolean {
  return entitlements.features.includes(feature);
}

/**
 * Company identity (logo, product photos) in order PDFs and in the public catalog. One rule for
 * every place that shows it; any plan that lists `branding.custom` inherits it.
 */
export function brandingAllowed(entitlements: Entitlements): boolean {
  return hasFeature(entitlements, 'branding.custom');
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

/**
 * Whether an operation is offered to a company. One operation can span related features, and
 * `withinPlan` already removes what the contract lacks, so any included feature keeps it offered.
 */
export function operationInPlan(
  permissions: readonly Permission[],
  entitlements: Entitlements,
): boolean {
  const gated = new Set(Object.values(featurePermissions).flatMap((list) => list ?? []));
  const owned = permissions.filter((permission) => gated.has(permission));
  return !owned.length || withinPlan(owned, entitlements).length > 0;
}

/** Features present in `from` and missing in `to`; used to confirm downgrades explicitly. */
export function lostFeatures(from: Entitlements, to: Entitlements): PlanFeature[] {
  return from.features.filter((feature) => !to.features.includes(feature));
}
