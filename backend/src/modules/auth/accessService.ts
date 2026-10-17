import { z } from 'zod';
import type { Transaction } from 'firebase-admin/firestore';
import { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import {
  identitySchema,
  membershipSchema,
  tenantSchema,
  subscriptionSchema,
} from '../../shared/schemas/models.js';
import type { Actor, TenantContext } from '../../shared/types/context.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { enforceSubscription, requirePermission, type Permission } from '../users/permissions.js';
import { entitlementsFor } from '../plans/catalog.js';

export const platformAdminSchema = z.strictObject({
  uid: z.string(),
  status: z.enum(['active', 'disabled']),
  createdAt: z.iso.datetime(),
  schemaVersion: z.literal(1),
});
export class AccessService {
  constructor(readonly repo: FoundationRepository) {}
  async isPlatformAdmin(uid: string, tx?: Transaction): Promise<boolean> {
    const [admin, identity] = await Promise.all([
      this.repo.read(this.repo.global('platformAdmins', uid), platformAdminSchema, tx),
      this.repo.read(this.repo.global('identities', uid), identitySchema, tx),
    ]);
    return admin?.status === 'active' && identity?.status === 'active';
  }
  async platform(actor: Actor, tx?: Transaction): Promise<void> {
    requireCondition(
      await this.isPlatformAdmin(actor.uid, tx),
      403,
      'FORBIDDEN',
      'Operação não permitida',
    );
  }
  async tenant(
    actor: Actor,
    tenantId: string,
    permission?: Permission,
    tx?: Transaction,
  ): Promise<TenantContext> {
    const [tenant, membership, identity] = await Promise.all([
      this.repo.read(this.repo.global('tenants', tenantId), tenantSchema, tx),
      this.repo.read(this.repo.tenant(tenantId, 'memberships', actor.uid), membershipSchema, tx),
      this.repo.read(this.repo.global('identities', actor.uid), identitySchema, tx),
    ]);
    requireCondition(
      tenant &&
        tenant.status === 'active' &&
        membership?.status === 'active' &&
        membership.uid === actor.uid &&
        membership.tenantId === tenantId &&
        identity?.status === 'active',
      403,
      'TENANT_ACCESS_DENIED',
      'Contexto de empresa não autorizado',
    );
    // A seat-exempt (support) membership is valid only while its holder is a Super Admin.
    requireCondition(
      !membership.seatExempt || (await this.isPlatformAdmin(actor.uid, tx)),
      403,
      'TENANT_ACCESS_DENIED',
      'Contexto de empresa não autorizado',
    );
    const subscription = await this.repo.read(
      this.repo.global('subscriptions', tenant.subscriptionId),
      subscriptionSchema,
      tx,
    );
    requireCondition(
      subscription?.tenantId === tenant.id,
      403,
      'TENANT_ACCESS_DENIED',
      'Contexto de empresa não autorizado',
    );
    enforceSubscription(subscription.status);
    const entitlements = entitlementsFor(subscription);
    if (permission) requirePermission(membership, entitlements, permission);
    return { actor, tenant, membership, subscription, entitlements };
  }
}
