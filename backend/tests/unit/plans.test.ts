import { describe, it, expect } from 'vitest';
import {
  entitlementsFor,
  hasFeature,
  isPlanCode,
  lostFeatures,
  planCatalog,
  planCodes,
  planFeatures,
  planSummary,
  withinPlan,
} from '../../src/modules/plans/catalog.js';
import {
  enforceSubscription,
  permissionsFor,
  publicCatalogAllowed,
  requirePermission,
} from '../../src/modules/users/permissions.js';
import { reservedSeats } from '../../src/modules/users/capacity.js';
import {
  invitationSchema,
  membershipSchema,
  subscriptionSchema,
} from '../../src/shared/schemas/models.js';

const legacyDocument = {
  id: 'tenant-1',
  tenantId: 'tenant-1',
  planId: 'plan-1',
  planVersion: 1,
  status: 'active',
  signupFeeCents: 15000,
  monthlyPriceCents: 20000,
  userLimit: 2,
  startsAt: '2026-10-01T12:00:00.000Z',
  commercialNotes: null,
  version: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  schemaVersion: 1,
};

describe('Catálogo oficial de planos', () => {
  it('oferece somente Essencial e Profissional', () => {
    expect([...planCodes]).toEqual(['essencial', 'profissional']);
    expect(Object.values(planCatalog).filter((plan) => plan.offered)).toHaveLength(2);
  });
  it('Essencial: R$ 119, 1 usuário, sem convites, vitrine ou vendedores', () => {
    const plan = planCatalog.essencial;
    expect(plan).toMatchObject({ name: 'Essencial', referencePriceCents: 11900, userLimit: 1 });
    expect(plan.features).toEqual([]);
  });
  it('Profissional: R$ 199, 2 usuários e todos os recursos existentes', () => {
    const plan = planCatalog.profissional;
    expect(plan).toMatchObject({ name: 'Profissional', referencePriceCents: 19900, userLimit: 2 });
    expect([...plan.features].sort()).toEqual([...planFeatures].sort());
  });
  it('catálogo é imutável em tempo de execução', () => {
    expect(Object.isFrozen(planCatalog)).toBe(true);
    expect(Object.isFrozen(planCatalog.profissional.features)).toBe(true);
  });
  it('reconhece apenas códigos oficiais', () => {
    expect(isPlanCode('essencial')).toBe(true);
    expect(isPlanCode('completo')).toBe(false);
    expect(isPlanCode(undefined)).toBe(false);
  });
});

describe('Recursos por assinatura', () => {
  it('Essencial remove a gestão do catálogo e mantém os módulos básicos', () => {
    const essencial = entitlementsFor({ planCode: 'essencial', userLimit: 1 });
    const permissions = withinPlan(permissionsFor('administrator'), essencial);
    expect(permissions).not.toContain('catalog:manage');
    for (const permission of [
      'users:manage',
      'customers:all:manage',
      'products:manage',
      'orders:all:manage',
      'receivables:read',
      'payments:manage',
      'reports:read',
      'documents:own:read',
    ] as const)
      expect(permissions).toContain(permission);
  });
  it('Profissional mantém todas as permissões do papel', () => {
    const profissional = entitlementsFor({ planCode: 'profissional', userLimit: 2 });
    expect(withinPlan(permissionsFor('administrator'), profissional)).toEqual([
      ...permissionsFor('administrator'),
    ]);
    expect(hasFeature(profissional, 'users.invite')).toBe(true);
  });
  it('contrato legado preserva todos os recursos e o limite contratado', () => {
    const legacy = entitlementsFor({ planCode: null, userLimit: 5 });
    expect(legacy.userLimit).toBe(5);
    expect([...legacy.features]).toEqual([...planFeatures]);
    expect(withinPlan(permissionsFor('administrator'), legacy)).toContain('catalog:manage');
  });
  it('limite de usuários vem do contrato, não do nome do plano', () => {
    expect(entitlementsFor({ planCode: 'profissional', userLimit: 2 }).userLimit).toBe(2);
  });
  it('downgrade lista os recursos perdidos; upgrade não perde nada', () => {
    const essencial = entitlementsFor({ planCode: 'essencial', userLimit: 1 });
    const profissional = entitlementsFor({ planCode: 'profissional', userLimit: 2 });
    expect(lostFeatures(profissional, essencial).sort()).toEqual([...planFeatures].sort());
    expect(lostFeatures(essencial, profissional)).toEqual([]);
  });
});

describe('Aplicação das permissões do plano', () => {
  const essencial = entitlementsFor({ planCode: 'essencial', userLimit: 1 });
  it('papel sem permissão continua FORBIDDEN; plano sem recurso é FEATURE_NOT_IN_PLAN', () => {
    expect(() => requirePermission('seller', essencial, 'users:manage')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', status: 403 }),
    );
    expect(() => requirePermission('administrator', essencial, 'catalog:manage')).toThrow(
      expect.objectContaining({ code: 'FEATURE_NOT_IN_PLAN', status: 403 }),
    );
    expect(() => requirePermission('administrator', essencial, 'orders:all:manage')).not.toThrow();
  });
  it('/me resume o plano sem expor preço', () => {
    expect(planSummary(essencial)).toEqual({
      code: 'essencial',
      name: 'Essencial',
      userLimit: 1,
      features: [],
    });
    expect(planSummary(entitlementsFor({ planCode: null, userLimit: 3 })).name).toBeNull();
  });
  it('convites para Super Admin não reservam vaga', () => {
    const invitation = (seatExempt: boolean) =>
      invitationSchema.parse({
        id: 'inv',
        tenantId: 'tenant-1',
        email: 'pessoa@example.invalid',
        role: 'administrator',
        tokenHash: 'a'.repeat(64),
        status: 'pending',
        expiresAt: '2026-10-20T12:00:00.000Z',
        createdBy: 'owner',
        acceptedBy: null,
        seatExempt,
        createdAt: '2026-10-13T12:00:00.000Z',
        updatedAt: '2026-10-13T12:00:00.000Z',
        schemaVersion: 1,
      });
    expect(reservedSeats([invitation(false), invitation(true), invitation(false)])).toBe(2);
  });
  it('vínculos e convites antigos são lidos sem isenção de vaga', () => {
    expect(
      membershipSchema.parse({
        uid: 'u',
        tenantId: 't',
        role: 'seller',
        status: 'active',
        version: 1,
        createdAt: '2026-10-13T12:00:00.000Z',
        updatedAt: '2026-10-13T12:00:00.000Z',
        schemaVersion: 1,
      }).seatExempt,
    ).toBe(false);
  });
});

describe('Compatibilidade do modelo de assinatura', () => {
  it('documento anterior aos planos oficiais é lido como contrato legado', () => {
    const parsed = subscriptionSchema.parse(legacyDocument);
    expect(parsed).toMatchObject({
      planCode: null,
      billingDay: null,
      billingStartsOn: null,
      billingContact: null,
    });
  });
  it('aceita limite de 1 usuário e dados de cobrança válidos', () => {
    const parsed = subscriptionSchema.parse({
      ...legacyDocument,
      planCode: 'essencial',
      userLimit: 1,
      billingDay: 10,
      billingStartsOn: '2026-11-01',
      billingContact: { name: 'Responsável', email: 'contato@example.invalid', phone: null },
    });
    expect(parsed.userLimit).toBe(1);
  });
  it.each([
    ['dia de vencimento 29', { billingDay: 29 }],
    ['dia de vencimento 0', { billingDay: 0 }],
    ['data inválida', { billingStartsOn: '2026-02-30' }],
    ['plano inexistente', { planCode: 'completo' }],
    ['limite zero', { userLimit: 0 }],
    ['campo desconhecido', { discount: 10 }],
  ])('rejeita %s', (_label, change) => {
    expect(subscriptionSchema.safeParse({ ...legacyDocument, ...change }).success).toBe(false);
  });
  it('assinatura aguardando ativação mantém acesso e catálogo', () => {
    expect(() => enforceSubscription('pending')).not.toThrow();
    expect(publicCatalogAllowed('pending')).toBe(true);
  });
});
