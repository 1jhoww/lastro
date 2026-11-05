import { describe, expect, it } from 'vitest';
import {
  baseResources,
  retainedPermissions,
  entitlementsFor,
  featureCatalog,
  planCatalog,
  planFeatures,
  permissionsOfFeature,
  planSummary,
  recognizedFeatures,
  requireValidComposition,
  withDependencies,
  withinPlan,
  type PlanFeature,
} from '../../src/modules/plans/catalog.js';
import {
  permissionList,
  permissionMatrix,
  permissionsFor,
  requirePermission,
  type Permission,
} from '../../src/modules/users/permissions.js';
import { contractAdjusted } from '../../src/modules/platformAdmin/customPlanService.js';
import { subscriptionSchema } from '../../src/shared/schemas/models.js';
import {
  changeContractInput,
  createCustomPlanInput,
} from '../../src/shared/schemas/customPlans.js';

const custom = (features: string[], userLimit = 3) =>
  entitlementsFor({
    planCode: 'custom',
    userLimit,
    customContract: { planName: 'Oferta Acme', features },
  });
const contract = {
  id: 'tenant-1',
  tenantId: 'tenant-1',
  planId: 'plan-1',
  planVersion: 2,
  planCode: 'custom',
  status: 'active',
  signupFeeCents: 0,
  monthlyPriceCents: 25000,
  userLimit: 3,
  startsAt: '2026-10-01T12:00:00.000Z',
  commercialNotes: null,
  customContract: {
    planName: 'Oferta Acme',
    sourcePlanCode: 'profissional',
    features: ['catalog.public'],
    contractedAt: '2026-10-01T12:00:00.000Z',
    origin: { monthlyPriceCents: 25000, userLimit: 3, features: ['catalog.public'] },
  },
  version: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  schemaVersion: 1,
};

describe('Recursos contratados de um plano personalizado', () => {
  it('vêm do contrato, não do plano de origem', () => {
    const entitlements = custom(['catalog.public', 'commercial.visits']);
    expect(entitlements.features).toEqual(['catalog.public', 'commercial.visits']);
    expect(planSummary(entitlements)).toEqual({
      code: 'custom',
      name: 'Oferta Acme',
      userLimit: 3,
      features: ['catalog.public', 'commercial.visits'],
    });
  });
  it('contrato sem cópia dos termos não libera nenhum recurso', () => {
    expect(entitlementsFor({ planCode: 'custom', userLimit: 2 }).features).toEqual([]);
    expect(
      entitlementsFor({ planCode: 'custom', userLimit: 2, customContract: null }).features,
    ).toEqual([]);
  });
  it('recurso desconhecido gravado no contrato não libera nada nem quebra a leitura', () => {
    const stored = subscriptionSchema.parse({
      ...contract,
      customContract: {
        ...contract.customContract,
        features: ['catalog.public', 'modulo.retirado'],
      },
    });
    expect(entitlementsFor(stored).features).toEqual(['catalog.public']);
    expect(recognizedFeatures(['modulo.futuro'])).toEqual([]);
  });
  it('bloqueia a permissão fora do contrato e mantém a permissão individual separada', () => {
    const entitlements = custom(['finance.payables']);
    expect(() => requirePermission('administrator', entitlements, 'purchases:read')).toThrow(
      'Recurso indisponível no plano contratado',
    );
    expect(() => requirePermission('seller', entitlements, 'payables:manage')).toThrow(
      'Operação não permitida',
    );
    expect(() => requirePermission('administrator', entitlements, 'payables:manage')).not.toThrow();
  });
  it('contas a pagar não libera recorrências, painel nem relatórios financeiros', () => {
    const permissions = withinPlan(permissionsFor('administrator'), custom(['finance.payables']));
    expect(permissions).toContain('payables:manage');
    for (const gated of [
      'recurring:read',
      'recurring:manage',
      'financial-dashboard:read',
      'financial-reports:read',
    ] as const)
      expect(permissions).not.toContain(gated);
  });
  it('vendedor com a operação de relatórios financeiros mantém painel e relatórios', () => {
    const permissions = permissionsFor({
      role: 'seller',
      operations: ['reports.view', 'payables.view', 'costs.view', 'reports.financial'],
    });
    expect(permissions).toEqual(
      expect.arrayContaining([
        'recurring:read',
        'financial-dashboard:read',
        'financial-reports:read',
      ]),
    );
  });
});

describe('Estrutura mínima de um plano personalizado', () => {
  it('sem nenhum recurso adicional, tem exatamente o que o Essencial tem', () => {
    const essencial = entitlementsFor({ planCode: 'essencial', userLimit: 1 });
    for (const role of ['administrator', 'seller'] as const)
      expect(withinPlan(permissionsFor(role), custom([], 1)).sort()).toEqual(
        withinPlan(permissionsFor(role), essencial).sort(),
      );
  });
  it('nenhuma escolha de recursos retira um módulo base', () => {
    const base = baseResources.flatMap((resource) => resource.permissions);
    expect(withinPlan(base, custom([]))).toEqual(base);
  });
});

describe('Planos oficiais continuam como definidos', () => {
  it('mantêm preços, limites e nomes', () => {
    expect(
      Object.values(planCatalog).map((p) => [p.code, p.referencePriceCents, p.userLimit]),
    ).toEqual([
      ['essencial', 11900, 1],
      ['profissional', 19900, 2],
      ['gestao', 29900, 5],
    ]);
  });
  it('Gestão inclui todos os recursos, e cada plano oficial respeita as dependências', () => {
    expect([...planCatalog.gestao.features].sort()).toEqual([...planFeatures].sort());
    for (const plan of Object.values(planCatalog))
      expect(() =>
        requireValidComposition({ features: plan.features, userLimit: plan.userLimit }),
      ).not.toThrow();
  });
  it('administrador do Gestão mantém todas as permissões da divisão de recursos', () => {
    const gestao = entitlementsFor({ planCode: 'gestao', userLimit: 5 });
    expect(withinPlan(permissionsFor('administrator'), gestao).sort()).toEqual(
      [...permissionList].sort(),
    );
  });
});

describe('Registro de recursos', () => {
  it('toda permissão pertence a um recurso contratável ou a um módulo base', () => {
    const covered = new Set<Permission>([
      ...planFeatures.flatMap((code) => permissionsOfFeature(code)),
      ...baseResources.flatMap((resource) => resource.permissions),
      ...retainedPermissions,
    ]);
    expect(permissionList.filter((permission) => !covered.has(permission))).toEqual([]);
  });
  it('nenhuma permissão é ao mesmo tempo base e contratável', () => {
    const gated = new Set(planFeatures.flatMap((code) => permissionsOfFeature(code)));
    expect(
      baseResources.flatMap((r) => r.permissions).filter((permission) => gated.has(permission)),
    ).toEqual([]);
  });
  it('as dependências entre recursos cobrem as exigências da matriz de permissões', () => {
    const owner = (permission: Permission) =>
      planFeatures.find((code) => permissionsOfFeature(code).includes(permission));
    const operations = new Map(permissionMatrix.map((operation) => [operation.id, operation]));
    for (const operation of permissionMatrix) {
      const features = new Set(operation.permissions.flatMap((p) => owner(p) ?? []));
      for (const code of features) {
        const available = withDependencies([code]);
        for (const id of operation.requires)
          for (const permission of operations.get(id)?.permissions ?? []) {
            const needed = owner(permission);
            if (needed && needed !== 'finance.recurring' && needed !== 'finance.dashboard')
              expect(available, `${operation.id} exige ${id}`).toContain(needed);
          }
      }
    }
  });
  it('dependências existem no catálogo e não exigem o próprio recurso', () => {
    for (const code of planFeatures)
      for (const requirement of featureCatalog[code].requires) {
        expect(planFeatures).toContain(requirement);
        expect(requirement).not.toBe(code);
      }
  });
});

describe('Dependências', () => {
  it('compras exigem fornecedores, custos e contas a pagar', () => {
    expect(withDependencies(['purchasing.orders'])).toEqual([
      'purchasing.suppliers',
      'purchasing.orders',
      'costing.products',
      'finance.payables',
    ]);
  });
  it('recusa combinação incompleta com o código próprio', () => {
    expect(() =>
      requireValidComposition({ features: ['purchasing.orders'], userLimit: 2 }),
    ).toThrow(expect.objectContaining({ code: 'PLAN_DEPENDENCY_MISSING', status: 422 }));
  });
  it('aceita a mesma combinação depois de incluir as dependências', () => {
    const features: PlanFeature[] = withDependencies(['finance.management', 'purchasing.orders']);
    expect(() => requireValidComposition({ features, userLimit: 2 })).not.toThrow();
  });
  it('convites exigem pelo menos 2 usuários', () => {
    expect(() => requireValidComposition({ features: ['users.invite'], userLimit: 1 })).toThrow(
      expect.objectContaining({ code: 'PLAN_USER_LIMIT_INVALID' }),
    );
    expect(() =>
      requireValidComposition({ features: ['users.invite'], userLimit: 2 }),
    ).not.toThrow();
  });
});

describe('Entradas validadas pelo backend', () => {
  const input = {
    name: 'Oferta Acme',
    description: '',
    monthlyPriceCents: 25000,
    userLimit: 3,
    features: ['catalog.public'],
    sourcePlanCode: null,
  };
  it('aceita somente recursos conhecidos', () => {
    expect(createCustomPlanInput.safeParse(input).success).toBe(true);
    expect(createCustomPlanInput.safeParse({ ...input, features: ['admin.total'] }).success).toBe(
      false,
    );
    expect(createCustomPlanInput.safeParse({ ...input, extra: true }).success).toBe(false);
  });
  it('recusa valor e limite inválidos', () => {
    for (const change of [
      { monthlyPriceCents: -1 },
      { monthlyPriceCents: 10.5 },
      { monthlyPriceCents: 100_000_001 },
      { userLimit: 0 },
      { userLimit: 101 },
    ])
      expect(createCustomPlanInput.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it('aceita plano gratuito', () => {
    expect(createCustomPlanInput.safeParse({ ...input, monthlyPriceCents: 0 }).success).toBe(true);
  });
  it('alteração individual exige confirmação explícita', () => {
    const body = { expectedVersion: 1, acknowledgedLostFeatures: [], reason: 'Nova negociação' };
    expect(changeContractInput.safeParse(body).success).toBe(false);
    expect(changeContractInput.safeParse({ ...body, confirmed: false }).success).toBe(false);
    expect(changeContractInput.safeParse({ ...body, confirmed: true }).success).toBe(true);
  });
});

describe('Contrato preservado', () => {
  it('contrato oficial não ganha o campo novo ao ser lido', () => {
    const { customContract: _contract, ...official } = contract;
    const parsed = subscriptionSchema.parse({ ...official, planCode: 'gestao' });
    expect(parsed).not.toHaveProperty('customContract');
  });
  it('identifica ajuste individual em relação à oferta contratada', () => {
    const stored = subscriptionSchema.parse(contract);
    expect(contractAdjusted(stored)).toBe(false);
    expect(contractAdjusted({ ...stored, monthlyPriceCents: 20000 })).toBe(true);
    expect(contractAdjusted({ ...stored, userLimit: 4 })).toBe(true);
    expect(
      contractAdjusted({
        ...stored,
        customContract: { ...stored.customContract!, features: ['branding.custom'] },
      }),
    ).toBe(true);
  });
});
