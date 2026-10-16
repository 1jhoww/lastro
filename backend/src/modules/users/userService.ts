import { randomUUID } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { z } from 'zod';
import { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import { AccessService, platformAdminSchema } from '../auth/accessService.js';
import type { Config } from '../../config/env.js';
import type { Actor } from '../../shared/types/context.js';
import { requireCondition } from '../../shared/errors/appError.js';
import {
  identitySchema,
  tenantSchema,
  subscriptionSchema,
  membershipSchema,
  invitationSchema,
} from '../../shared/schemas/models.js';
import {
  inviteInput,
  roleInput,
  statusInput,
  updateTenantInput,
  memberView,
  invitationView,
  tenantView,
} from '../../shared/schemas/http.js';
import { permissionsFor, enforceSubscription } from './permissions.js';
import { recordAudit } from '../../shared/audit/audit.js';
import {
  digest,
  equalDigest,
  invitationToken,
  encodeCursor,
  decodeCursor,
} from '../../shared/utils/crypto.js';

export class UserService {
  constructor(
    readonly repo: FoundationRepository,
    readonly access: AccessService,
    readonly auth: Auth,
    readonly config: Config,
    readonly clock: () => Date = () => new Date(),
  ) {}
  async me(actor: Actor) {
    const memberships = await this.repo.db
      .collectionGroup('memberships')
      .where('uid', '==', actor.uid)
      .where('status', '==', 'active')
      .limit(101)
      .get();
    requireCondition(
      memberships.size <= 100,
      409,
      'CONFLICT',
      'Quantidade de vínculos acima do limite suportado',
    );
    const admin = await this.repo.read(
      this.repo.global('platformAdmins', actor.uid),
      platformAdminSchema,
    );
    const identity = await this.repo.read(
      this.repo.global('identities', actor.uid),
      identitySchema,
    );
    const views = await Promise.all(
      memberships.docs.map(async (doc) => {
        const member = membershipSchema.parse(doc.data());
        requireCondition(
          doc.ref.path === `tenants/${member.tenantId}/memberships/${actor.uid}`,
          500,
          'INTERNAL_ERROR',
          'Erro interno',
        );
        const tenant = await this.repo.read(
          this.repo.global('tenants', member.tenantId),
          tenantSchema,
        );
        const subscription = tenant
          ? await this.repo.read(
              this.repo.global('subscriptions', tenant.subscriptionId),
              subscriptionSchema,
            )
          : null;
        requireCondition(
          tenant && subscription?.tenantId === tenant.id,
          500,
          'INTERNAL_ERROR',
          'Erro interno',
        );
        const access =
          tenant.status === 'provisioning'
            ? ('provisioning' as const)
            : subscription.status === 'suspended'
              ? ('suspended' as const)
              : subscription.status === 'canceled'
                ? ('canceled' as const)
                : ('allowed' as const);
        return {
          tenantId: member.tenantId,
          role: member.role,
          permissions: access === 'allowed' ? [...permissionsFor(member.role)] : [],
          access,
        };
      }),
    );
    return {
      uid: actor.uid,
      email: actor.email,
      platformAdmin: admin?.status === 'active' && identity?.status === 'active',
      memberships: views,
    };
  }
  async current(actor: Actor, tenantId: string) {
    return tenantView.parse((await this.access.tenant(actor, tenantId, 'tenant:read')).tenant);
  }
  async updateTenant(actor: Actor, tenantId: string, input: z.infer<typeof updateTenantInput>) {
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'tenant:update', tx);
      requireCondition(
        ctx.tenant.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      const next = tenantSchema.parse({
        ...ctx.tenant,
        name: input.name,
        timezone: input.timezone ?? ctx.tenant.timezone,
        version: ctx.tenant.version + 1,
        updatedAt: now,
      });
      tx.set(this.repo.global('tenants', tenantId), next);
      recordAudit(this.repo, tx, actor, tenantId, 'tenant.updated', tenantId, now, {
        previousName: ctx.tenant.name,
        name: next.name,
        previousTimezone: ctx.tenant.timezone,
        timezone: next.timezone,
      });
      return tenantView.parse(next);
    });
  }
  async list(actor: Actor, tenantId: string, limit: number, cursor?: string) {
    await this.access.tenant(actor, tenantId, 'users:manage');
    const scope = `users:${tenantId}:${actor.uid}`;
    const after = decodeCursor(this.config.invitationSecret, scope, cursor);
    let query = this.repo.db
      .collection(`tenants/${tenantId}/memberships`)
      .orderBy(FieldPath.documentId())
      .limit(limit + 1);
    if (after) query = query.startAfter(after);
    const [members, invites] = await Promise.all([
      query.get(),
      this.repo.db
        .collection(`tenants/${tenantId}/invitations`)
        .where('status', '==', 'pending')
        .where('expiresAt', '>', this.clock().toISOString())
        .limit(100)
        .get(),
    ]);
    const docs = members.docs.slice(0, limit);
    const last = docs.at(-1);
    const profiles = await this.profiles(docs.map((doc) => doc.id));
    return {
      items: docs.map((doc) =>
        memberView.parse({
          ...membershipSchema.parse(doc.data()),
          id: doc.id,
          name: profiles.get(doc.id)?.name ?? null,
          email: profiles.get(doc.id)?.email ?? null,
        }),
      ),
      pendingInvitations: invites.docs.map((doc) =>
        invitationView.parse(invitationSchema.parse(doc.data())),
      ),
      nextCursor:
        members.size > limit && last
          ? encodeCursor(this.config.invitationSecret, scope, last.id)
          : null,
    };
  }
  /**
   * Display name and e-mail for the team list. Read-only and best effort: the provider being
   * unavailable never blocks the list, which then falls back to the role alone.
   */
  private async profiles(uids: string[]) {
    const profiles = new Map<string, { name: string | null; email: string | null }>();
    if (!uids.length) return profiles;
    try {
      for (let i = 0; i < uids.length; i += 100) {
        const result = await this.auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
        for (const user of result.users)
          profiles.set(user.uid, {
            name: user.displayName?.trim() || null,
            email: user.email?.trim().toLowerCase() || null,
          });
      }
    } catch {
      // Listing without names is still correct; permissions never depend on this data.
    }
    return profiles;
  }
  async invite(actor: Actor, tenantId: string, input: z.infer<typeof inviteInput>) {
    const id = randomUUID();
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'users:manage', tx);
      const pending = await tx.get(
        this.repo.db
          .collection(`tenants/${tenantId}/invitations`)
          .where('status', '==', 'pending')
          .where('expiresAt', '>', now)
          .limit(101),
      );
      requireCondition(
        !pending.docs.some((doc) => invitationSchema.parse(doc.data()).email === input.email),
        409,
        'CONFLICT',
        'Já existe convite pendente para este destinatário',
      );
      requireCondition(
        ctx.tenant.activeUsers + pending.size < ctx.subscription.userLimit,
        409,
        'USER_LIMIT_REACHED',
        'Limite de usuários atingido',
      );
      const token = invitationToken(this.config.invitationSecret, tenantId, id);
      const invitation = invitationSchema.parse({
        id,
        tenantId,
        ...input,
        tokenHash: digest(token),
        status: 'pending',
        expiresAt: new Date(this.clock().getTime() + 7 * 86400000).toISOString(),
        createdBy: actor.uid,
        acceptedBy: null,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      tx.create(this.repo.tenant(tenantId, 'invitations', id), invitation);
      tx.set(this.repo.tenant(tenantId, 'invitationEmails', digest(input.email)), {
        invitationId: id,
      });
      // Serialize admission against every other admission/deactivation on this tenant.
      tx.update(this.repo.global('tenants', tenantId), { updatedAt: now });
      recordAudit(this.repo, tx, actor, tenantId, 'invitation.created', id, now, {
        role: input.role,
      });
      return { invitation: invitationView.parse(invitation), token };
    });
  }
  async accept(actor: Actor, token: string) {
    const [tenantId, id] = token.split('.');
    requireCondition(tenantId && id, 422, 'VALIDATION_ERROR', 'Convite inválido');
    // Fresh provider data prevents an old token/email claim from proving the recipient.
    const authUser = await this.auth.getUser(actor.uid);
    requireCondition(
      !authUser.disabled && authUser.emailVerified && authUser.email,
      403,
      'INVITATION_INVALID',
      'Identidade verificada necessária',
    );
    const verifiedEmail = authUser.email.trim().toLowerCase();
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      const [invitation, tenant, identity, previous] = await Promise.all([
        this.repo.read(this.repo.tenant(tenantId, 'invitations', id), invitationSchema, tx),
        this.repo.read(this.repo.global('tenants', tenantId), tenantSchema, tx),
        this.repo.read(this.repo.global('identities', actor.uid), identitySchema, tx),
        this.repo.read(this.repo.tenant(tenantId, 'memberships', actor.uid), membershipSchema, tx),
      ]);
      requireCondition(
        invitation &&
          tenant &&
          invitation.tenantId === tenantId &&
          invitation.status === 'pending' &&
          invitation.email === verifiedEmail &&
          equalDigest(invitation.tokenHash, digest(token)),
        403,
        'INVITATION_INVALID',
        'Convite inválido',
      );
      requireCondition(invitation.expiresAt > now, 410, 'INVITATION_EXPIRED', 'Convite expirado');
      requireCondition(
        !identity || identity.status === 'active',
        403,
        'FORBIDDEN',
        'Operação não permitida',
      );
      requireCondition(
        !previous || previous.status === 'disabled',
        409,
        'CONFLICT',
        'Vínculo já ativo',
      );
      const subscription = await this.repo.read(
        this.repo.global('subscriptions', tenant.subscriptionId),
        subscriptionSchema,
        tx,
      );
      requireCondition(
        subscription?.tenantId === tenantId,
        403,
        'INVITATION_INVALID',
        'Convite inválido',
      );
      enforceSubscription(subscription.status);
      requireCondition(
        tenant.activeUsers < subscription.userLimit,
        409,
        'USER_LIMIT_REACHED',
        'Limite de usuários atingido',
      );
      requireCondition(
        tenant.status !== 'provisioning' || invitation.role === 'administrator',
        409,
        'LAST_ADMIN_REQUIRED',
        'Administrador inicial obrigatório',
      );
      const member = membershipSchema.parse({
        uid: actor.uid,
        tenantId,
        role: invitation.role,
        status: 'active',
        version: (previous?.version ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        schemaVersion: 1,
      });
      if (!identity)
        tx.create(this.repo.global('identities', actor.uid), {
          uid: actor.uid,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1,
        });
      tx.set(this.repo.tenant(tenantId, 'memberships', actor.uid), member);
      tx.update(this.repo.tenant(tenantId, 'invitations', id), {
        status: 'accepted',
        acceptedBy: actor.uid,
        updatedAt: now,
      });
      tx.update(this.repo.global('tenants', tenantId), {
        status: 'active',
        activeUsers: tenant.activeUsers + 1,
        activeAdmins: tenant.activeAdmins + (member.role === 'administrator' ? 1 : 0),
        updatedAt: now,
      });
      recordAudit(this.repo, tx, actor, tenantId, 'invitation.accepted', id, now, {
        memberUid: actor.uid,
        role: member.role,
      });
      return { tenantId, user: memberView.parse({ ...member, id: actor.uid }) };
    });
  }
  async updateMember(
    actor: Actor,
    tenantId: string,
    uid: string,
    input: z.infer<typeof roleInput> | z.infer<typeof statusInput>,
  ) {
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'users:manage', tx);
      const ref = this.repo.tenant(tenantId, 'memberships', uid);
      const previous = await this.repo.read(ref, membershipSchema, tx);
      requireCondition(
        previous?.tenantId === tenantId && previous.uid === uid,
        404,
        'RESOURCE_NOT_FOUND',
        'Recurso não encontrado',
      );
      const identity = await this.repo.read(
        this.repo.global('identities', uid),
        identitySchema,
        tx,
      );
      const pending = await tx.get(
        this.repo.db
          .collection(`tenants/${tenantId}/invitations`)
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
      const next = membershipSchema.parse({
        ...previous,
        ...('role' in input ? { role: input.role } : { status: input.status }),
        version: previous.version + 1,
        updatedAt: now,
      });
      const beforeActive = previous.status === 'active';
      const afterActive = next.status === 'active';
      const activeUsers = ctx.tenant.activeUsers + Number(afterActive) - Number(beforeActive);
      const activeAdmins =
        ctx.tenant.activeAdmins +
        Number(afterActive && next.role === 'administrator') -
        Number(beforeActive && previous.role === 'administrator');
      requireCondition(
        activeAdmins >= 1,
        409,
        'LAST_ADMIN_REQUIRED',
        'Mantenha pelo menos um administrador ativo',
      );
      requireCondition(
        !afterActive || identity?.status === 'active',
        403,
        'FORBIDDEN',
        'Identidade indisponível',
      );
      requireCondition(
        activeUsers + pending.size <= ctx.subscription.userLimit,
        409,
        'USER_LIMIT_REACHED',
        'Limite de usuários atingido',
      );
      tx.set(ref, next);
      tx.update(this.repo.global('tenants', tenantId), {
        activeUsers,
        activeAdmins,
        updatedAt: now,
      });
      recordAudit(this.repo, tx, actor, tenantId, 'membership.updated', uid, now, {
        previousRole: previous.role,
        role: next.role,
        previousStatus: previous.status,
        status: next.status,
      });
      return memberView.parse({ ...next, id: uid });
    });
  }
  async revokeInvitation(actor: Actor, tenantId: string, id: string) {
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.tenant(actor, tenantId, 'users:manage', tx);
      const ref = this.repo.tenant(tenantId, 'invitations', id);
      const invitation = await this.repo.read(ref, invitationSchema, tx);
      requireCondition(
        invitation?.tenantId === tenantId,
        404,
        'RESOURCE_NOT_FOUND',
        'Recurso não encontrado',
      );
      requireCondition(invitation.status !== 'accepted', 409, 'CONFLICT', 'Convite já utilizado');
      if (invitation.status === 'revoked') return { id, status: 'revoked' as const };
      tx.update(ref, { status: 'revoked', updatedAt: now });
      tx.update(this.repo.global('tenants', tenantId), { updatedAt: now });
      recordAudit(this.repo, tx, actor, tenantId, 'invitation.revoked', id, now, {});
      return { id, status: 'revoked' as const };
    });
  }
}
