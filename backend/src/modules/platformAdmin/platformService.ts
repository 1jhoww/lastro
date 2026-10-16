import { randomUUID } from 'node:crypto';
import { FieldPath, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { Config } from '../../config/env.js';
import { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../auth/accessService.js';
import { requireCondition } from '../../shared/errors/appError.js';
import {
  planSchema,
  tenantSchema,
  subscriptionSchema,
  invitationSchema,
  idempotencySchema,
} from '../../shared/schemas/models.js';
import {
  createTenantInput,
  ownerInviteInput,
  planView,
  tenantView,
  subscriptionView,
  invitationView,
} from '../../shared/schemas/http.js';
import type { Actor } from '../../shared/types/context.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { planCatalog } from '../plans/catalog.js';
import { requireBillingStart } from './subscriptionService.js';
import {
  digest,
  stableJson,
  invitationToken,
  encodeCursor,
  decodeCursor,
} from '../../shared/utils/crypto.js';

export class PlatformService {
  constructor(
    readonly repo: FoundationRepository,
    readonly access: AccessService,
    readonly config: Config,
    readonly clock: () => Date = () => new Date(),
  ) {}
  async replay(tx: Transaction, actor: Actor, operation: string, key: string, input: unknown) {
    const ref = this.repo.global('idempotencyRecords', digest(`${actor.uid}:${operation}:${key}`));
    const existing = await this.repo.read(ref, idempotencySchema, tx);
    requireCondition(
      !existing || existing.payloadHash === digest(stableJson(input)),
      409,
      'CONFLICT',
      'Chave de idempotência já utilizada com outro comando',
    );
    requireCondition(
      !existing || existing.expiresAt > this.clock().toISOString(),
      410,
      'IDEMPOTENCY_EXPIRED',
      'Chave administrativa expirada; use nova chave para novo comando',
    );
    return { ref, existing, hash: digest(stableJson(input)) };
  }
  /**
   * Creates the company, its contract on an official plan and the first administrator's
   * invitation in one transaction. Billing starts on `billingStartsOn`, never before today.
   */
  async createTenant(actor: Actor, input: z.infer<typeof createTenantInput>, key: string) {
    const id = randomUUID();
    const inviteId = randomUUID();
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const replay = await this.replay(tx, actor, 'tenant.create', key, input);
      if (replay.existing) {
        const tenantId = replay.existing.result.id ?? '';
        const invitationId = replay.existing.result.invitationId ?? '';
        const [tenant, subscription, invite] = await Promise.all([
          this.repo.read(this.repo.global('tenants', tenantId), tenantSchema, tx),
          this.repo.read(this.repo.global('subscriptions', tenantId), subscriptionSchema, tx),
          this.repo.read(
            this.repo.tenant(tenantId, 'invitations', invitationId),
            invitationSchema,
            tx,
          ),
        ]);
        requireCondition(
          tenant && subscription && invite && invite.status === 'pending' && invite.expiresAt > now,
          409,
          'CONFLICT',
          'Convite inicial indisponível; empresa já criada',
        );
        return {
          tenant: tenantView.parse(tenant),
          subscription: subscriptionView.parse(subscription),
          ownerInvitation: {
            invitation: invitationView.parse(invite),
            token: invitationToken(this.config.invitationSecret, tenantId, invitationId),
          },
        };
      }
      const plan = planCatalog[input.planCode];
      requireCondition(plan.offered, 422, 'VALIDATION_ERROR', 'Plano indisponível');
      requireBillingStart(input.billingStartsOn, this.clock());
      const tenant = tenantSchema.parse({
        id,
        name: input.name,
        timezone: 'America/Sao_Paulo',
        status: 'provisioning',
        subscriptionId: id,
        activeUsers: 0,
        activeAdmins: 0,
        version: 1,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      const subscription = subscriptionSchema.parse({
        id,
        tenantId: id,
        planId: plan.code,
        planVersion: plan.version,
        planCode: plan.code,
        status: 'active',
        signupFeeCents: 0,
        monthlyPriceCents: input.monthlyPriceCents ?? plan.referencePriceCents,
        userLimit: plan.userLimit,
        startsAt: now,
        billingDay: input.billingDay,
        billingStartsOn: input.billingStartsOn,
        // The first administrator is the default contact until the Super Admin sets another.
        billingContact: input.billingContact ?? {
          name: null,
          email: input.ownerEmail,
          phone: null,
        },
        commercialNotes: input.commercialNotes ?? null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      const token = invitationToken(this.config.invitationSecret, id, inviteId);
      const invite = invitationSchema.parse({
        id: inviteId,
        tenantId: id,
        email: input.ownerEmail,
        role: 'administrator',
        tokenHash: digest(token),
        status: 'pending',
        expiresAt: new Date(this.clock().getTime() + 7 * 86400000).toISOString(),
        createdBy: actor.uid,
        acceptedBy: null,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      tx.create(this.repo.global('tenants', id), tenant);
      tx.create(this.repo.global('subscriptions', id), subscription);
      tx.create(this.repo.tenant(id, 'invitations', inviteId), invite);
      tx.create(this.repo.tenant(id, 'invitationEmails', digest(input.ownerEmail)), {
        invitationId: inviteId,
      });
      tx.create(replay.ref, {
        actorUid: actor.uid,
        operation: 'tenant.create',
        payloadHash: replay.hash,
        result: { id, invitationId: inviteId },
        createdAt: now,
        expiresAt: Timestamp.fromMillis(this.clock().getTime() + 30 * 86400000),
        schemaVersion: 1,
      });
      recordAudit(this.repo, tx, actor, null, 'tenant.created', id, now, {
        planCode: plan.code,
        planVersion: plan.version,
        monthlyPriceCents: subscription.monthlyPriceCents,
        userLimit: subscription.userLimit,
        billingDay: subscription.billingDay,
        billingStartsOn: subscription.billingStartsOn,
      });
      return {
        tenant: tenantView.parse(tenant),
        subscription: subscriptionView.parse(subscription),
        ownerInvitation: { invitation: invitationView.parse(invite), token },
      };
    });
  }
  async list(
    actor: Actor,
    collection: 'tenants' | 'plans' | 'subscriptions',
    limit: number,
    cursor?: string,
  ) {
    await this.access.platform(actor);
    const scope = `platform:${actor.uid}:${collection}`;
    const after = decodeCursor(this.config.invitationSecret, scope, cursor);
    let query = this.repo.db
      .collection(collection)
      .orderBy(FieldPath.documentId())
      .limit(limit + 1);
    if (after) query = query.startAfter(after);
    const snapshots = await query.get();
    const docs = snapshots.docs.slice(0, limit);
    const items = docs.map((doc) =>
      collection === 'tenants'
        ? tenantView.parse(tenantSchema.parse(doc.data()))
        : collection === 'plans'
          ? planView.parse(planSchema.parse(doc.data()))
          : subscriptionView.parse(subscriptionSchema.parse(doc.data())),
    );
    const last = docs.at(-1);
    return {
      items,
      nextCursor:
        snapshots.size > limit && last
          ? encodeCursor(this.config.invitationSecret, scope, last.id)
          : null,
    };
  }
  async renewOwnerInvitation(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof ownerInviteInput>,
    key: string,
  ) {
    const id = randomUUID();
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const replay = await this.replay(tx, actor, `tenant.owner.invite:${tenantId}`, key, input);
      const tenant = await this.repo.read(this.repo.global('tenants', tenantId), tenantSchema, tx);
      requireCondition(
        tenant?.status === 'provisioning' && tenant.activeUsers === 0,
        409,
        'CONFLICT',
        'Empresa já ativada ou indisponível',
      );
      const subscription = await this.repo.read(
        this.repo.global('subscriptions', tenant.subscriptionId),
        subscriptionSchema,
        tx,
      );
      requireCondition(
        subscription &&
          (subscription.status === 'pending' ||
            subscription.status === 'active' ||
            subscription.status === 'past_due'),
        403,
        'SUBSCRIPTION_INACTIVE',
        'Empresa indisponível',
      );
      if (replay.existing) {
        const invite = await this.repo.read(
          this.repo.tenant(tenantId, 'invitations', replay.existing.result.invitationId ?? ''),
          invitationSchema,
          tx,
        );
        requireCondition(
          invite?.status === 'pending' && invite.expiresAt > now,
          409,
          'CONFLICT',
          'Convite indisponível',
        );
        return {
          invitation: invitationView.parse(invite),
          token: invitationToken(this.config.invitationSecret, tenantId, invite.id),
        };
      }
      requireCondition(
        tenant.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      const pending = await tx.get(
        this.repo.db
          .collection(`tenants/${tenantId}/invitations`)
          .where('status', '==', 'pending')
          .limit(101),
      );
      const token = invitationToken(this.config.invitationSecret, tenantId, id);
      const invite = invitationSchema.parse({
        id,
        tenantId,
        email: input.ownerEmail,
        role: 'administrator',
        tokenHash: digest(token),
        status: 'pending',
        expiresAt: new Date(this.clock().getTime() + 7 * 86400000).toISOString(),
        createdBy: actor.uid,
        acceptedBy: null,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      for (const doc of pending.docs) tx.update(doc.ref, { status: 'revoked', updatedAt: now });
      tx.create(this.repo.tenant(tenantId, 'invitations', id), invite);
      tx.set(this.repo.tenant(tenantId, 'invitationEmails', digest(input.ownerEmail)), {
        invitationId: id,
      });
      tx.update(this.repo.global('tenants', tenantId), {
        version: tenant.version + 1,
        updatedAt: now,
      });
      tx.create(replay.ref, {
        actorUid: actor.uid,
        operation: `tenant.owner.invite:${tenantId}`,
        payloadHash: replay.hash,
        result: { invitationId: id },
        createdAt: now,
        expiresAt: Timestamp.fromMillis(this.clock().getTime() + 30 * 86400000),
        schemaVersion: 1,
      });
      recordAudit(this.repo, tx, actor, null, 'tenant.owner.invitation.renewed', tenantId, now, {
        invitationId: id,
      });
      return { invitation: invitationView.parse(invite), token };
    });
  }
}
