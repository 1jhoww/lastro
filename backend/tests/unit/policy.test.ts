import { describe, it, expect } from 'vitest';
import {
  enforceSubscription,
  permissionsFor,
  publicCatalogAllowed,
} from '../../src/modules/users/permissions.js';
import {
  digest,
  stableJson,
  encodeCursor,
  decodeCursor,
  invitationToken,
} from '../../src/shared/utils/crypto.js';
import { inviteInput, updateSubscriptionInput } from '../../src/shared/schemas/http.js';
import { openApiDocument } from '../../src/modules/auth/openapi.js';
import { routeDefinitions } from '../../src/app/routes.js';
describe('Contratos e políticas da fundação', () => {
  it('administrador tem permissões empresariais sem papel de plataforma', () => {
    expect(permissionsFor('administrator')).toContain('users:manage');
    expect(permissionsFor('administrator')).not.toContain('platform:manage');
  });
  it('vendedor confirma os próprios pedidos e não altera preços, descontos, estoque ou usuários', () => {
    const permissions = permissionsFor('seller');
    expect(permissions).toContain('orders:own:confirm');
    for (const permission of [
      'users:manage',
      'prices:manage',
      'discounts:apply',
      'inventory:manage',
      'payments:manage',
    ])
      expect(permissions).not.toContain(permission);
  });
  it.each(['active', 'past_due'] as const)('estado %s mantém acesso e catálogo', (status) => {
    expect(() => enforceSubscription(status)).not.toThrow();
    expect(publicCatalogAllowed(status)).toBe(true);
  });
  it.each(['suspended', 'canceled'] as const)('estado %s bloqueia acesso e catálogo', (status) => {
    expect(() => enforceSubscription(status)).toThrow();
    expect(publicCatalogAllowed(status)).toBe(false);
  });
  it('hash de comando é independente da ordem dos campos', () =>
    expect(digest(stableJson({ a: 1, b: 2 }))).toBe(digest(stableJson({ b: 2, a: 1 }))));
  it('cursor assinado não pode atravessar usuário/tenant', () => {
    const cursor = encodeCursor('unit-only-secret', 'a:uid-1', 'record');
    expect(decodeCursor('unit-only-secret', 'a:uid-1', cursor)).toBe('record');
    expect(() => decodeCursor('unit-only-secret', 'b:uid-1', cursor)).toThrow();
    expect(() => decodeCursor('unit-only-secret', 'a:uid-2', cursor)).toThrow();
    expect(() => decodeCursor('unit-only-secret', 'a:uid-1', `${cursor}x`)).toThrow();
  });
  it('convite é vinculado à empresa e não aceita campos de privilégios adicionais', () => {
    expect(invitationToken('unit-only-secret', 'a', 'id')).not.toBe(
      invitationToken('unit-only-secret', 'b', 'id'),
    );
    expect(
      inviteInput.safeParse({
        email: 'user@example.invalid',
        role: 'administrator',
        platformAdmin: true,
      }).success,
    ).toBe(false);
  });
  it('valores comerciais inválidos são rejeitados', () =>
    expect(
      updateSubscriptionInput.safeParse({
        expectedVersion: 1,
        monthlyPriceCents: 1.5,
        reason: 'Teste',
      }).success,
    ).toBe(false));
  it('OpenAPI representa todas as rotas reais, sem login ou módulos comerciais fictícios', () => {
    const spec = openApiDocument();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.values(spec.paths).flatMap((operations) => Object.keys(operations))).toHaveLength(
      routeDefinitions.length,
    );
    expect(spec.paths).not.toHaveProperty('/api/v1/auth/login');
    // Phase D implements orders; keep the inventory assertion aligned with real routes.
    expect(spec.paths).toHaveProperty('/api/v1/orders');
    expect(spec.paths).toHaveProperty('/api/v1/orders/{id}/confirm');
    expect(spec.paths).toHaveProperty('/api/v1/payments');
    expect(spec.paths).toHaveProperty('/api/v1/orders/{id}/receipts');
    expect(spec.paths).toHaveProperty('/api/v1/returns/{id}/resolution-preview');
    expect(spec.paths).toHaveProperty('/api/v1/public/catalogs/{slug}/quote-preview');
    const publicOperations = Object.values(spec.paths)
      .flatMap((operations) => Object.values(operations))
      .filter(
        (operation) =>
          typeof operation === 'object' &&
          operation !== null &&
          'tags' in operation &&
          Array.isArray(operation.tags) &&
          operation.tags.includes('public'),
      );
    expect(publicOperations).toHaveLength(7);
    for (const operation of publicOperations) expect(operation).toHaveProperty('security', []);
    for (const r of routeDefinitions.filter((r) => r.scope === 'tenant'))
      expect(r.permission).toBeTruthy();
  });
});
