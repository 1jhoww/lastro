import { randomUUID } from 'node:crypto';
import { FieldPath, type Transaction } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { z } from 'zod';
import { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../auth/accessService.js';
import type { Config } from '../../config/env.js';
import type { Actor } from '../../shared/types/context.js';
import { AppError, requireCondition } from '../../shared/errors/appError.js';
import {
  identitySchema,
  tenantSchema,
  subscriptionSchema,
  membershipSchema,
  invitationSchema,
  type Membership,
  type Role,
  type Subscription,
  type Tenant,
} from '../../shared/schemas/models.js';
import {
  inviteInput,
  operationsInput,
  profileInput,
  reissueInvitationInput,
  roleInput,
  statusInput,
  updateTenantInput,
  memberView,
  invitationView,
  tenantView,
} from '../../shared/schemas/http.js';
import {
  effectivePermissions,
  enforceSubscription,
  featureNotInPlan,
  permissionMatrix,
  sellerOperations,
  validateSellerOperations,
} from './permissions.js';
import {
  entitlementsFor,
  hasFeature,
  planSummary,
  withinPlan,
  type Entitlements,
} from '../plans/catalog.js';
import {
  occupiedSeats,
  reservedSeats,
  userLimitReached,
  validPendingInvitations,
} from './capacity.js';
import { recordAudit, recordPlatformAudit } from '../../shared/audit/audit.js';
import {
  digest,
  equalDigest,
  invitationToken,
  encodeCursor,
  decodeCursor,
} from '../../shared/utils/crypto.js';

/** Days an invitation link stays valid. */
const INVITATION_DAYS = 7;

/**
 * Who performs a seat-affecting command: a company administrator (tenant audit trail, plan
 * features apply) or the Super Admin (platform audit trail with a reason). Both are bounded
 * by the same contracted seats: there is no limit bypass.
 */
type Operator =
  { kind: 'tenant'; actor: Actor } | { kind: 'platform'; actor: Actor; reason: string };

/** Company state a seat-affecting command works on, read inside its transaction. */
interface Company {
  tenant: Tenant;
  subscription: Subscription;
  entitlements: Entitlements;
}

/** Member view with the permission matrix operations in force. */
export function memberViewOf(
  member: Membership,
  extra: { name?: string | null; email?: string | null } = {},
) {
  return memberView.parse({
    ...member,
    ...extra,
    id: member.uid,
    operations:
      member.role === 'administrator'
        ? permissionMatrix.map((operation) => operation.id)
        : sellerOperations(member.operations),
    customOperations: member.role === 'seller' && member.operations !== null,
  });
}

export class UserService {
  constructor(
    readonly repo: FoundationRepository,
    readonly access: AccessService,
    readonly auth: Auth,
    readonly config: Config,
    readonly clock: () => Date = () => new Date(),
  ) {}
  async me(actor: Actor) {
    const [name, view] = await Promise.all([this.displayName(actor.uid), this.memberships(actor)]);
    return { ...view, name };
  }
  /**
   * The person's own name from the identity provider. Best effort: the provider being unavailable
   * never blocks the session, which then greets without a name.
   */
  private async displayName(uid: string): Promise<string | null> {
    try {
      return (await this.auth.getUser(uid)).displayName?.trim() || null;
    } catch {
      return null;
    }
  }
  /** Updates only the caller's own display name; nobody edits another person's name here. */
  async updateProfile(actor: Actor, input: z.infer<typeof profileInput>) {
    await this.auth.updateUser(actor.uid, { displayName: input.name });
    return this.me(actor);
  }
  private async memberships(actor: Actor) {
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
    const platformAdmin = await this.access.isPlatformAdmin(actor.uid);
    const views = await Promise.all(
      memberships.docs.map(async (doc) => {
        const member = membershipSchema.parse(doc.data());
        requireCondition(
          doc.ref.path === `tenants/${member.tenantId}/memberships/${actor.uid}`,
          500,
          'INTERNAL_ERROR',
          'Erro interno',
        );
        // Support access ends with the Super Admin role; access.tenant denies it as well.
        if (member.seatExempt && !platformAdmin) return null;
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
        const entitlements = entitlementsFor(subscription);
        return {
          tenantId: member.tenantId,
          role: member.role,
          permissions: access === 'allowed' ? effectivePermissions(member, entitlements) : [],
          access,
          plan: planSummary(entitlements),
        };
      }),
    );
    return {
      uid: actor.uid,
      email: actor.email,
      platformAdmin,
      memberships: views.filter((view) => view !== null),
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
    const ctx = await this.access.tenant(actor, tenantId, 'users:manage');
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
    const pending = invites.docs.map((doc) => invitationSchema.parse(doc.data()));
    const reserved = reservedSeats(pending);
    const userLimit = ctx.entitlements.userLimit;
    return {
      items: docs.map((doc) =>
        memberViewOf(membershipSchema.parse(doc.data()), {
          name: profiles.get(doc.id)?.name ?? null,
          email: profiles.get(doc.id)?.email ?? null,
        }),
      ),
      pendingInvitations: pending.map((invitation) => invitationView.parse(invitation)),
      capacity: {
        userLimit,
        activeUsers: ctx.tenant.activeUsers,
        reservedInvitations: reserved,
        available: Math.max(0, userLimit - ctx.tenant.activeUsers - reserved),
      },
      permissionMatrix: permissionMatrix.map((operation) => ({
        id: operation.id,
        module: operation.module,
        label: operation.label,
        description: operation.description,
        seller: operation.seller,
        requires: [...operation.requires],
        inPlan:
          withinPlan(operation.permissions, ctx.entitlements).length ===
          operation.permissions.length,
      })),
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
  /** Firebase Auth uid registered for an email, if any. */
  async uidForEmail(email: string): Promise<string | null> {
    try {
      return (await this.auth.getUserByEmail(email)).uid;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code === 'auth/user-not-found') return null;
      throw error;
    }
  }
  /** Company, contract and plan for a Super Admin command; the platform role is re-checked. */
  private async platformCompany(actor: Actor, tenantId: string, tx: Transaction): Promise<Company> {
    await this.access.platform(actor, tx);
    const tenant = await this.repo.read(this.repo.global('tenants', tenantId), tenantSchema, tx);
    requireCondition(tenant, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    const subscription = await this.repo.read(
      this.repo.global('subscriptions', tenant.subscriptionId),
      subscriptionSchema,
      tx,
    );
    requireCondition(
      subscription?.tenantId === tenant.id,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    requireCondition(
      subscription.status !== 'canceled',
      403,
      'SUBSCRIPTION_INACTIVE',
      'Empresa indisponível',
    );
    return { tenant, subscription, entitlements: entitlementsFor(subscription) };
  }
  private audit(
    operator: Operator,
    tx: Transaction,
    tenantId: string,
    action: string,
    resourceId: string,
    now: string,
    changes: Record<string, unknown>,
  ) {
    if (operator.kind === 'platform')
      recordPlatformAudit(this.repo, tx, operator.actor, tenantId, action, resourceId, now, {
        ...changes,
        reason: operator.reason,
      });
    else recordAudit(this.repo, tx, operator.actor, tenantId, action, resourceId, now, changes);
  }
  /** Refuses an invitation to someone who already holds an active access to the company. */
  private async requireNoActiveAccess(tx: Transaction, tenantId: string, uid: string | null) {
    if (!uid) return;
    const member = await this.repo.read(
      this.repo.tenant(tenantId, 'memberships', uid),
      membershipSchema,
      tx,
    );
    requireCondition(
      member?.status !== 'active',
      409,
      'CONFLICT',
      'Já existe acesso ativo para este e-mail',
    );
  }
  /**
   * Writes a new pending invitation. The caller already verified seats and permissions in the
   * same transaction; the tenant write serializes it with every other admission.
   */
  private writeInvitation(
    tx: Transaction,
    operator: Operator,
    tenantId: string,
    input: { email: string; role: Role },
    seatExempt: boolean,
    now: string,
  ) {
    const id = randomUUID();
    const token = invitationToken(this.config.invitationSecret, tenantId, id);
    const invitation = invitationSchema.parse({
      id,
      tenantId,
      email: input.email,
      role: input.role,
      tokenHash: digest(token),
      status: 'pending',
      expiresAt: new Date(this.clock().getTime() + INVITATION_DAYS * 86400000).toISOString(),
      createdBy: operator.actor.uid,
      acceptedBy: null,
      seatExempt,
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
    return { invitation, token };
  }
  /** Plan rules of a new invitation that are not about seats. */
  private requireInvitationAllowed(
    operator: Operator,
    company: Company,
    role: Role,
    seatExempt: boolean,
  ) {
    if (role === 'seller' && !hasFeature(company.entitlements, 'commercial.sellers'))
      throw featureNotInPlan();
    // "users.invite" is the company administrators' capability of inviting more people. The
    // Super Admin replaces or provisions accesses within the same seat limit.
    if (
      operator.kind === 'tenant' &&
      !seatExempt &&
      !hasFeature(company.entitlements, 'users.invite')
    )
      throw featureNotInPlan();
    requireCondition(
      company.tenant.status !== 'provisioning' || role === 'administrator',
      409,
      'LAST_ADMIN_REQUIRED',
      'Administrador inicial obrigatório',
    );
  }
  private async createInvitation(
    tx: Transaction,
    operator: Operator,
    company: Company,
    input: { email: string; role: Role },
    recipientUid: string | null,
    now: string,
  ) {
    const tenantId = company.tenant.id;
    // Super Admin recipients reserve no seat (support access).
    const seatExempt =
      recipientUid !== null && (await this.access.isPlatformAdmin(recipientUid, tx));
    this.requireInvitationAllowed(operator, company, input.role, seatExempt);
    const pending = await validPendingInvitations(this.repo.db, tx, tenantId, now);
    await this.requireNoActiveAccess(tx, tenantId, recipientUid);
    requireCondition(
      !pending.some((invitation) => invitation.email === input.email),
      409,
      'CONFLICT',
      'Já existe convite pendente para este destinatário',
    );
    if (
      !seatExempt &&
      occupiedSeats(company.tenant.activeUsers, pending) >= company.entitlements.userLimit
    )
      throw userLimitReached(company.entitlements.userLimit);
    const issued = this.writeInvitation(tx, operator, tenantId, input, seatExempt, now);
    this.audit(operator, tx, tenantId, 'invitation.created', issued.invitation.id, now, {
      role: input.role,
      seatExempt,
      ...(operator.kind === 'platform' ? { email: input.email } : {}),
    });
    return { invitation: invitationView.parse(issued.invitation), token: issued.token };
  }
  async invite(actor: Actor, tenantId: string, input: z.infer<typeof inviteInput>) {
    const now = this.clock().toISOString();
    // The recipient's platform role is confirmed again inside the transaction.
    const recipientUid = await this.uidForEmail(input.email);
    return this.repo.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'users:manage', tx);
      return this.createInvitation(tx, { kind: 'tenant', actor }, ctx, input, recipientUid, now);
    });
  }
  /** Super Admin: new access invitation for an existing company, within its contracted seats. */
  async platformInvite(
    actor: Actor,
    tenantId: string,
    input: { email: string; role: Role; reason: string },
  ) {
    const now = this.clock().toISOString();
    const recipientUid = await this.uidForEmail(input.email);
    return this.repo.db.runTransaction(async (tx) => {
      const company = await this.platformCompany(actor, tenantId, tx);
      return this.createInvitation(
        tx,
        { kind: 'platform', actor, reason: input.reason },
        company,
        { email: input.email, role: input.role },
        recipientUid,
        now,
      );
    });
  }
  /**
   * Resends a pending invitation with a new link, optionally to a corrected e-mail. The old
   * link stops working in the same transaction and its seat passes to the new invitation, so
   * occupancy never counts both. Revoked or accepted invitations are never reissued. An
   * expired invitation reserved no seat anymore: reissuing it needs a free seat.
   */
  private async reissueInvitation(
    tx: Transaction,
    operator: Operator,
    company: Company,
    invitationId: string,
    email: string | undefined,
    recipientUid: string | null,
    now: string,
  ) {
    const tenantId = company.tenant.id;
    const ref = this.repo.tenant(tenantId, 'invitations', invitationId);
    const previous = await this.repo.read(ref, invitationSchema, tx);
    requireCondition(
      previous?.tenantId === tenantId && previous.id === invitationId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    requireCondition(previous.status !== 'accepted', 409, 'CONFLICT', 'Convite já utilizado');
    requireCondition(
      previous.status !== 'revoked',
      409,
      'INVITATION_REVOKED',
      'Convite revogado não pode ser reutilizado; crie um novo convite',
    );
    const target = email ?? previous.email;
    const changed = target !== previous.email;
    const seatExempt =
      recipientUid !== null && (await this.access.isPlatformAdmin(recipientUid, tx));
    this.requireInvitationAllowed(operator, company, previous.role, seatExempt);
    const pending = await validPendingInvitations(this.repo.db, tx, tenantId, now);
    if (changed) await this.requireNoActiveAccess(tx, tenantId, recipientUid);
    const others = pending.filter((invitation) => invitation.id !== previous.id);
    requireCondition(
      !others.some((invitation) => invitation.email === target),
      409,
      'CONFLICT',
      'Já existe convite pendente para este destinatário',
    );
    if (
      !seatExempt &&
      occupiedSeats(company.tenant.activeUsers, others) >= company.entitlements.userLimit
    )
      throw userLimitReached(company.entitlements.userLimit);
    const issued = this.writeInvitation(
      tx,
      operator,
      tenantId,
      { email: target, role: previous.role },
      seatExempt,
      now,
    );
    tx.update(ref, { status: 'revoked', replacedBy: issued.invitation.id, updatedAt: now });
    this.audit(operator, tx, tenantId, 'invitation.reissued', issued.invitation.id, now, {
      previousInvitationId: previous.id,
      role: previous.role,
      emailChanged: changed,
      ...(changed ? { previousEmail: previous.email, email: target } : {}),
    });
    return { invitation: invitationView.parse(issued.invitation), token: issued.token };
  }
  async reissue(
    actor: Actor,
    tenantId: string,
    invitationId: string,
    input: z.infer<typeof reissueInvitationInput>,
  ) {
    const now = this.clock().toISOString();
    const lookup = input.email ?? (await this.invitationEmail(tenantId, invitationId));
    const recipientUid = lookup ? await this.uidForEmail(lookup) : null;
    return this.repo.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'users:manage', tx);
      return this.reissueInvitation(
        tx,
        { kind: 'tenant', actor },
        ctx,
        invitationId,
        input.email,
        recipientUid,
        now,
      );
    });
  }
  async platformReissue(
    actor: Actor,
    tenantId: string,
    invitationId: string,
    input: { email?: string | undefined; reason: string },
  ) {
    const now = this.clock().toISOString();
    const lookup = input.email ?? (await this.invitationEmail(tenantId, invitationId));
    const recipientUid = lookup ? await this.uidForEmail(lookup) : null;
    return this.repo.db.runTransaction(async (tx) => {
      const company = await this.platformCompany(actor, tenantId, tx);
      return this.reissueInvitation(
        tx,
        { kind: 'platform', actor, reason: input.reason },
        company,
        invitationId,
        input.email,
        recipientUid,
        now,
      );
    });
  }
  /**
   * Reactivation is useless while the identity provider refuses the account's sign-in, so it
   * is refused with the reason instead of leaving an "active" access nobody can use.
   */
  private async requireSignInEnabled(uid: string) {
    let disabled: boolean;
    try {
      disabled = (await this.auth.getUser(uid)).disabled;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code === 'auth/user-not-found')
        throw new AppError(
          409,
          'IDENTITY_NOT_FOUND',
          'A conta de acesso desta pessoa não existe mais',
        );
      throw error;
    }
    requireCondition(
      !disabled,
      403,
      'IDENTITY_DISABLED',
      'A conta desta pessoa está bloqueada no Lastro. Desbloqueie a conta antes de reativar o acesso.',
    );
  }
  /**
   * Super Admin: unblocks an account blocked at platform level (Lastro identity and sign-in
   * provider). The block is global, so is the unblock; the person's accesses keep their own
   * status in every company (a disabled access stays disabled until reactivated). Sign-in is
   * enabled first: if the identity write then fails, the Lastro identity still refuses every
   * request, so a partial unblock never grants access, and retrying completes it.
   */
  async platformUnblockAccount(actor: Actor, tenantId: string, uid: string, reason: string) {
    await this.access.platform(actor);
    const [member, holderIsPlatformAdmin] = await Promise.all([
      this.repo.read(this.repo.tenant(tenantId, 'memberships', uid), membershipSchema),
      this.access.isPlatformAdmin(uid),
    ]);
    requireCondition(
      member?.tenantId === tenantId && member.uid === uid && !member.seatExempt,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    requireCondition(
      !holderIsPlatformAdmin,
      403,
      'PLATFORM_ACCOUNT_PROTECTED',
      'Contas do Super Admin não são alteradas por este fluxo',
    );
    let signInWasDisabled: boolean;
    try {
      signInWasDisabled = (await this.auth.getUser(uid)).disabled;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code === 'auth/user-not-found')
        throw new AppError(
          409,
          'IDENTITY_NOT_FOUND',
          'A conta de acesso desta pessoa não existe mais',
        );
      throw error;
    }
    if (signInWasDisabled) await this.auth.updateUser(uid, { disabled: false });
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const ref = this.repo.global('identities', uid);
      const identity = await this.repo.read(ref, identitySchema, tx);
      const identityWasDisabled = identity?.status === 'disabled';
      if (identityWasDisabled) tx.update(ref, { status: 'active', updatedAt: now });
      recordPlatformAudit(this.repo, tx, actor, tenantId, 'identity.unblocked', uid, now, {
        signInWasDisabled,
        identityWasDisabled,
        reason,
      });
      return { uid, blocked: false };
    });
  }
  /** Recipient lookup before the transaction; the invitation itself is re-read inside it. */
  private async invitationEmail(tenantId: string, id: string): Promise<string | null> {
    const invitation = await this.repo.read(
      this.repo.tenant(tenantId, 'invitations', id),
      invitationSchema,
    );
    return invitation?.tenantId === tenantId ? invitation.email : null;
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
      const [invitation, tenant, identity, previous, platformAdmin] = await Promise.all([
        this.repo.read(this.repo.tenant(tenantId, 'invitations', id), invitationSchema, tx),
        this.repo.read(this.repo.global('tenants', tenantId), tenantSchema, tx),
        this.repo.read(this.repo.global('identities', actor.uid), identitySchema, tx),
        this.repo.read(this.repo.tenant(tenantId, 'memberships', actor.uid), membershipSchema, tx),
        this.access.isPlatformAdmin(actor.uid, tx),
      ]);
      requireCondition(
        invitation &&
          tenant &&
          invitation.tenantId === tenantId &&
          invitation.status === 'pending' &&
          invitation.email === verifiedEmail &&
          equalDigest(invitation.tokenHash, digest(token)) &&
          (!invitation.seatExempt || platformAdmin),
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
      // This invitation's own reservation becomes the active seat; other reservations stay.
      const others = (await validPendingInvitations(this.repo.db, tx, tenantId, now)).filter(
        (pending) => pending.id !== invitation.id,
      );
      // A Super Admin never occupies a seat, so the first administrator must be the customer's.
      const seatExempt = platformAdmin;
      requireCondition(
        !seatExempt || tenant.status !== 'provisioning',
        409,
        'CUSTOMER_ADMIN_REQUIRED',
        'O primeiro administrador deve ser um usuário da empresa cliente',
      );
      const userLimit = entitlementsFor(subscription).userLimit;
      if (!seatExempt && occupiedSeats(tenant.activeUsers, others) >= userLimit)
        throw userLimitReached(userLimit);
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
        seatExempt,
        // A returning person starts again from the role defaults.
        operations: null,
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
      tx.update(
        this.repo.global('tenants', tenantId),
        seatExempt
          ? { updatedAt: now }
          : {
              status: 'active',
              activeUsers: tenant.activeUsers + 1,
              activeAdmins: tenant.activeAdmins + (member.role === 'administrator' ? 1 : 0),
              updatedAt: now,
            },
      );
      recordAudit(this.repo, tx, actor, tenantId, 'invitation.accepted', id, now, {
        memberUid: actor.uid,
        role: member.role,
        seatExempt,
      });
      return { tenantId, user: memberViewOf(member) };
    });
  }
  /**
   * Role or status change of one membership. Only a change that adds an occupied seat
   * (reactivation) needs a free seat: deactivation and role changes are always possible, even
   * while a company is above its limit (e.g. after a legacy contract), and never grant seats.
   */
  private async changeMember(
    tx: Transaction,
    operator: Operator,
    company: Company,
    uid: string,
    input: z.infer<typeof roleInput> | z.infer<typeof statusInput>,
    now: string,
  ) {
    const tenantId = company.tenant.id;
    const ref = this.repo.tenant(tenantId, 'memberships', uid);
    const previous = await this.repo.read(ref, membershipSchema, tx);
    requireCondition(
      previous?.tenantId === tenantId && previous.uid === uid,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    const [identity, holderIsPlatformAdmin, pending] = await Promise.all([
      this.repo.read(this.repo.global('identities', uid), identitySchema, tx),
      previous.seatExempt ? this.access.isPlatformAdmin(uid, tx) : Promise.resolve(false),
      validPendingInvitations(this.repo.db, tx, tenantId, now),
    ]);
    requireCondition(
      previous.version === input.expectedVersion,
      409,
      'CONFLICT',
      'Versão desatualizada',
    );
    if (
      'role' in input &&
      input.role === 'seller' &&
      previous.role !== 'seller' &&
      !hasFeature(company.entitlements, 'commercial.sellers')
    )
      throw featureNotInPlan();
    const roleChanged = 'role' in input && input.role !== previous.role;
    const next = membershipSchema.parse({
      ...previous,
      ...('role' in input ? { role: input.role } : { status: input.status }),
      // A new role starts from its defaults: custom seller grants never carry over.
      operations: roleChanged ? null : previous.operations,
      version: previous.version + 1,
      updatedAt: now,
    });
    // Seat-exempt support access never changes the company's seat or admin counters.
    const counted = !previous.seatExempt;
    const beforeActive = counted && previous.status === 'active';
    const afterActive = counted && next.status === 'active';
    const activeUsers = company.tenant.activeUsers + Number(afterActive) - Number(beforeActive);
    const activeAdmins =
      company.tenant.activeAdmins +
      Number(afterActive && next.role === 'administrator') -
      Number(beforeActive && previous.role === 'administrator');
    requireCondition(
      activeAdmins >= 1,
      409,
      'LAST_ADMIN_REQUIRED',
      'Mantenha pelo menos um administrador ativo',
    );
    // Specific reasons, never a generic FORBIDDEN: the client must not mistake them for an
    // authentication problem (stale login), and nothing is written when any of them applies.
    if (next.status === 'active') {
      requireCondition(
        identity?.status === 'active',
        403,
        'IDENTITY_DISABLED',
        'A conta desta pessoa está bloqueada no Lastro. Desbloqueie a conta antes de reativar o acesso.',
      );
      requireCondition(
        counted || holderIsPlatformAdmin,
        403,
        'SUPPORT_ACCESS_ENDED',
        'Acesso de suporte encerrado: a pessoa não é mais Super Admin',
      );
    }
    if (
      afterActive &&
      !beforeActive &&
      occupiedSeats(activeUsers, pending) > company.entitlements.userLimit
    )
      throw userLimitReached(company.entitlements.userLimit);
    tx.set(ref, next);
    tx.update(this.repo.global('tenants', tenantId), {
      activeUsers,
      activeAdmins,
      updatedAt: now,
    });
    this.audit(operator, tx, tenantId, 'membership.updated', uid, now, {
      previousRole: previous.role,
      role: next.role,
      previousStatus: previous.status,
      status: next.status,
    });
    return next;
  }
  async updateMember(
    actor: Actor,
    tenantId: string,
    uid: string,
    input: z.infer<typeof roleInput> | z.infer<typeof statusInput>,
  ) {
    if ('status' in input && input.status === 'active') await this.requireSignInEnabled(uid);
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'users:manage', tx);
      return memberViewOf(
        await this.changeMember(tx, { kind: 'tenant', actor }, ctx, uid, input, now),
      );
    });
  }
  /** Super Admin: deactivates or reactivates an access (e.g. to replace a person). */
  async platformMemberStatus(
    actor: Actor,
    tenantId: string,
    uid: string,
    input: z.infer<typeof statusInput> & { reason: string },
  ) {
    if (input.status === 'active') await this.requireSignInEnabled(uid);
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      const company = await this.platformCompany(actor, tenantId, tx);
      const next = await this.changeMember(
        tx,
        { kind: 'platform', actor, reason: input.reason },
        company,
        uid,
        { status: input.status, expectedVersion: input.expectedVersion },
        now,
      );
      return { uid, role: next.role, status: next.status, version: next.version };
    });
  }
  /**
   * Replaces a seller's operations with the administrator's choice. Only operations offered to
   * sellers are accepted; administrative ones (users, plans, settlements, credits, reversals)
   * are refused whatever the request. Administrators always hold every operation. Nobody
   * edits their own grants.
   */
  async updateOperations(
    actor: Actor,
    tenantId: string,
    uid: string,
    input: z.infer<typeof operationsInput>,
  ) {
    const now = this.clock().toISOString();
    const operations = validateSellerOperations(input.operations);
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.tenant(actor, tenantId, 'users:manage', tx);
      requireCondition(
        uid !== actor.uid,
        403,
        'FORBIDDEN',
        'Não é possível alterar as próprias permissões',
      );
      const ref = this.repo.tenant(tenantId, 'memberships', uid);
      const previous = await this.repo.read(ref, membershipSchema, tx);
      requireCondition(
        previous?.tenantId === tenantId && previous.uid === uid,
        404,
        'RESOURCE_NOT_FOUND',
        'Recurso não encontrado',
      );
      requireCondition(
        previous.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      if (previous.role !== 'seller')
        throw new AppError(
          409,
          'PERMISSIONS_ROLE_FIXED',
          'Administradores têm acesso completo; personalize permissões de vendedores',
        );
      const next = membershipSchema.parse({
        ...previous,
        operations,
        version: previous.version + 1,
        updatedAt: now,
      });
      tx.set(ref, next);
      recordAudit(this.repo, tx, actor, tenantId, 'membership.permissions.updated', uid, now, {
        previousOperations: sellerOperations(previous.operations),
        operations: sellerOperations(operations),
      });
      return memberViewOf(next);
    });
  }
  private async revoke(
    tx: Transaction,
    operator: Operator,
    tenantId: string,
    id: string,
    now: string,
  ) {
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
    // Serialize with admissions on this company.
    tx.update(this.repo.global('tenants', tenantId), { updatedAt: now });
    this.audit(operator, tx, tenantId, 'invitation.revoked', id, now, {});
    return { id, status: 'revoked' as const };
  }
  async revokeInvitation(actor: Actor, tenantId: string, id: string) {
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.tenant(actor, tenantId, 'users:manage', tx);
      return this.revoke(tx, { kind: 'tenant', actor }, tenantId, id, now);
    });
  }
}
