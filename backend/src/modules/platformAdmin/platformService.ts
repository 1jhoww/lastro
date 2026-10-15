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
  type Subscription,
} from '../../shared/schemas/models.js';
import {
  createPlanInput,
  updatePlanInput,
  createTenantInput,
  updateSubscriptionInput,
  ownerInviteInput,
  planView,
  tenantView,
  subscriptionView,
  invitationView,
} from '../../shared/schemas/http.js';
import type { Actor } from '../../shared/types/context.js';
import { recordAudit } from '../../shared/audit/audit.js';
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
  async createPlan(actor: Actor, input: z.infer<typeof createPlanInput>, key: string) {
    const id = randomUUID();
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const replay = await this.replay(tx, actor, 'plan.create', key, input);
      if (replay.existing) {
        const p = await this.repo.read(
          this.repo.global('plans', replay.existing.result.id ?? ''),
          planSchema,
          tx,
        );
        requireCondition(p, 409, 'CONFLICT', 'Resultado indisponível');
        return planView.parse(p);
      }
      const plan = planSchema.parse({
        ...input,
        id,
        version: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      const ref = this.repo.global('plans', id);
      tx.create(ref, plan);
      tx.create(ref.collection('versions').doc('1'), plan);
      tx.create(replay.ref, {
        actorUid: actor.uid,
        operation: 'plan.create',
        payloadHash: replay.hash,
        result: { id },
        createdAt: now,
        expiresAt: Timestamp.fromMillis(this.clock().getTime() + 30 * 86400000),
        schemaVersion: 1,
      });
      recordAudit(this.repo, tx, actor, null, 'plan.created', id, now, { version: 1 });
      return planView.parse(plan);
    });
  }
  async updatePlan(actor: Actor, id: string, input: z.infer<typeof updatePlanInput>) {
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const ref = this.repo.global('plans', id);
      const previous = await this.repo.read(ref, planSchema, tx);
      requireCondition(previous, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
      requireCondition(
        previous.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      const { expectedVersion: _version, ...changes } = input;
      requireCondition(
        Object.keys(changes).length > 0,
        422,
        'VALIDATION_ERROR',
        'Informe uma alteração',
      );
      const next = planSchema.parse({
        ...previous,
        ...changes,
        version: previous.version + 1,
        updatedAt: now,
      });
      tx.set(ref, next);
      tx.create(ref.collection('versions').doc(String(next.version)), next);
      recordAudit(this.repo, tx, actor, null, 'plan.version.created', id, now, {
        previousVersion: previous.version,
        version: next.version,
      });
      return planView.parse(next);
    });
  }
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
      const plan = await this.repo.read(this.repo.global('plans', input.planId), planSchema, tx);
      requireCondition(plan?.status === 'active', 422, 'VALIDATION_ERROR', 'Plano indisponível');
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
        planId: plan.id,
        planVersion: plan.version,
        status: 'active',
        signupFeeCents: plan.signupFeeCents,
        monthlyPriceCents: plan.monthlyPriceCents,
        userLimit: plan.userLimit,
        startsAt: now,
        commercialNotes: null,
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
        planId: plan.id,
        planVersion: plan.version,
      });
      return {
        tenant: tenantView.parse(tenant),
        subscription: subscriptionView.parse(subscription),
        ownerInvitation: { invitation: invitationView.parse(invite), token },
      };
    });
  }
  async updateSubscription(
    actor: Actor,
    id: string,
    input: z.infer<typeof updateSubscriptionInput>,
  ) {
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const ref = this.repo.global('subscriptions', id);
      const previous = await this.repo.read(ref, subscriptionSchema, tx);
      requireCondition(previous, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
      const tenant = await this.repo.read(
        this.repo.global('tenants', previous.tenantId),
        tenantSchema,
        tx,
      );
      requireCondition(tenant, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
      const pending = await tx.get(
        this.repo.db
          .collection(`tenants/${tenant.id}/invitations`)
          .where('status', '==', 'pending')
          .where('expiresAt', '>', now)
          .limit(101),
      );
      requireCondition(
        previous.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      const transitions: Record<Subscription['status'], readonly Subscription['status'][]> = {
        active: ['active', 'past_due', 'suspended', 'canceled'],
        past_due: ['past_due', 'active', 'suspended', 'canceled'],
        suspended: ['suspended', 'active', 'canceled'],
        canceled: ['canceled'],
      };
      requireCondition(
        !input.status || transitions[previous.status].includes(input.status),
        409,
        'CONFLICT',
        'Transição de assinatura inválida',
      );
      requireCondition(
        (input.userLimit ?? previous.userLimit) >= tenant.activeUsers + pending.size,
        409,
        'USER_LIMIT_REACHED',
        'Limite inferior à capacidade já ocupada',
      );
      const { expectedVersion: _version, reason, ...changes } = input;
      requireCondition(
        Object.keys(changes).length > 0,
        422,
        'VALIDATION_ERROR',
        'Informe uma alteração',
      );
      const next = subscriptionSchema.parse({
        ...previous,
        ...changes,
        version: previous.version + 1,
        updatedAt: now,
      });
      tx.set(ref, next);
      recordAudit(this.repo, tx, actor, null, 'subscription.updated', id, now, {
        previous: subscriptionView.parse(previous),
        current: subscriptionView.parse(next),
        reason,
      });
      return subscriptionView.parse(next);
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
        subscription && (subscription.status === 'active' || subscription.status === 'past_due'),
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
