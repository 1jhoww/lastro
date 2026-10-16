import { randomUUID } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../auth/accessService.js';
import {
  invitationSchema,
  membershipSchema,
  subscriptionSchema,
  tenantSchema,
  type Membership,
  type Subscription,
} from '../../shared/schemas/models.js';
import type { Actor } from '../../shared/types/context.js';
import { recordPlatformAudit } from '../../shared/audit/audit.js';
import { planCatalog } from '../plans/catalog.js';
import { pendingInvitations, reservedSeats } from '../users/capacity.js';

/**
 * Migration of companies created before the official plans.
 *
 * - A legacy contract with the standard 2-user limit moves to Profissional (2 users, every
 *   existing capability), keeping its price. It waits for activation (`pending`): access stays
 *   as it is and no charge is created until the Super Admin sets the due day and start date.
 * - Never moves anyone to Essencial, never deactivates users and never creates past charges.
 * - Contracts with a custom limit above 2 or more occupied seats than Profissional allows,
 *   and canceled contracts, are left untouched and reported for a decision.
 * - Super Admin memberships stop occupying seats, unless that would leave the company without
 *   its own administrator (reported instead).
 */
const target = planCatalog.profissional;

export type SkipReason = 'canceled' | 'custom_user_limit' | 'over_capacity';
export type Warning = 'super_admin_is_only_admin' | 'counter_mismatch';

export interface MigrationInput {
  subscription: Pick<
    Subscription,
    'planCode' | 'status' | 'userLimit' | 'billingContact' | 'monthlyPriceCents'
  >;
  activeUsers: number;
  activeAdmins: number;
  reservedInvitations: number;
  memberships: (Pick<Membership, 'uid' | 'role' | 'status' | 'seatExempt'> & {
    platformAdmin: boolean;
  })[];
  /** E-mail of the first accepted administrator invitation, used as default contact. */
  ownerEmail: string | null;
}

export interface MigrationDecision {
  subscription: Partial<Subscription> | null;
  skipped: SkipReason | null;
  exemptUids: string[];
  counters: { activeUsers: number; activeAdmins: number };
  warnings: Warning[];
}

export function decideMigration(input: MigrationInput): MigrationDecision {
  const warnings: Warning[] = [];
  const candidates = input.memberships.filter((m) => m.platformAdmin && !m.seatExempt);
  const activeCandidates = candidates.filter((m) => m.status === 'active');
  const adminsLost = activeCandidates.filter((m) => m.role === 'administrator').length;
  const keepsOwnAdmin = input.activeAdmins - adminsLost >= 1;
  if (adminsLost > 0 && !keepsOwnAdmin) warnings.push('super_admin_is_only_admin');
  const exempt = keepsOwnAdmin ? candidates : candidates.filter((m) => m.status !== 'active');
  const counters = {
    activeUsers: input.activeUsers - exempt.filter((m) => m.status === 'active').length,
    activeAdmins:
      input.activeAdmins -
      exempt.filter((m) => m.status === 'active' && m.role === 'administrator').length,
  };
  const exemptUids = new Set(exempt.map((m) => m.uid));
  const counted = input.memberships.filter(
    (m) => m.status === 'active' && !m.seatExempt && !exemptUids.has(m.uid),
  ).length;
  if (counted !== counters.activeUsers) warnings.push('counter_mismatch');

  const result = (subscription: Partial<Subscription> | null, skipped: SkipReason | null) => ({
    subscription,
    skipped,
    exemptUids: [...exemptUids],
    counters,
    warnings,
  });
  const { subscription } = input;
  if (subscription.planCode !== null) return result(null, null);
  if (subscription.status === 'canceled') return result(null, 'canceled');
  if (subscription.userLimit > target.userLimit) return result(null, 'custom_user_limit');
  if (counters.activeUsers + input.reservedInvitations > target.userLimit)
    return result(null, 'over_capacity');
  return result(
    {
      planCode: target.code,
      planId: target.code,
      planVersion: target.version,
      userLimit: target.userLimit,
      // Billing starts only after explicit activation; suspended contracts stay suspended.
      status: subscription.status === 'suspended' ? 'suspended' : 'pending',
      billingDay: null,
      billingStartsOn: null,
      billingContact:
        subscription.billingContact ??
        (input.ownerEmail ? { name: null, email: input.ownerEmail, phone: null } : null),
    },
    null,
  );
}

export interface MigrationEntry {
  tenantId: string;
  tenantName: string;
  action: 'migrated' | 'already_official' | 'skipped';
  skipped: SkipReason | null;
  exemptedMemberships: number;
  warnings: Warning[];
  before: { planCode: string | null; status: string; userLimit: number; priceCents: number };
  after: { planCode: string | null; status: string; userLimit: number; priceCents: number };
}

export const migrationActor = (): Actor => ({
  uid: 'lastro-plan-migration',
  email: null,
  emailVerified: false,
  authTime: 0,
  requestId: randomUUID(),
});

export class PlanMigration {
  constructor(
    readonly repo: FoundationRepository,
    readonly access: AccessService,
    readonly clock: () => Date = () => new Date(),
  ) {}

  /** Analyzes (and with `apply`, migrates) one company inside a transaction. */
  async tenant(tenantId: string, apply: boolean, actor: Actor): Promise<MigrationEntry | null> {
    return this.repo.db.runTransaction(async (tx) => {
      const tenant = await this.repo.read(this.repo.global('tenants', tenantId), tenantSchema, tx);
      if (!tenant) return null;
      const subscription = await this.repo.read(
        this.repo.global('subscriptions', tenant.subscriptionId),
        subscriptionSchema,
        tx,
      );
      if (subscription?.tenantId !== tenant.id) return null;
      const now = this.clock().toISOString();
      const [members, pending, invitations] = await Promise.all([
        tx.get(this.repo.db.collection(`tenants/${tenantId}/memberships`).limit(101)),
        tx.get(
          this.repo.db
            .collection(`tenants/${tenantId}/invitations`)
            .where('status', '==', 'pending')
            .where('expiresAt', '>', now)
            .limit(101),
        ),
        tx.get(
          this.repo.db
            .collection(`tenants/${tenantId}/invitations`)
            .where('status', '==', 'accepted')
            .limit(101),
        ),
      ]);
      const memberships = members.docs.map((doc) => membershipSchema.parse(doc.data()));
      const admins = await Promise.all(
        memberships.map((m) => this.access.isPlatformAdmin(m.uid, tx)),
      );
      const owner = invitations.docs
        .map((doc) => invitationSchema.parse(doc.data()))
        .filter((invitation) => invitation.role === 'administrator')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      const decision = decideMigration({
        subscription,
        activeUsers: tenant.activeUsers,
        activeAdmins: tenant.activeAdmins,
        reservedInvitations: reservedSeats(pendingInvitations(pending)),
        memberships: memberships.map((m, i) => ({ ...m, platformAdmin: admins[i]! })),
        ownerEmail: owner?.email ?? null,
      });
      const next = decision.subscription
        ? subscriptionSchema.parse({
            ...subscription,
            ...decision.subscription,
            version: subscription.version + 1,
            updatedAt: now,
          })
        : subscription;
      if (apply) {
        if (decision.subscription) {
          tx.set(this.repo.global('subscriptions', subscription.id), next);
          recordPlatformAudit(
            this.repo,
            tx,
            actor,
            tenant.id,
            'subscription.migrated',
            subscription.id,
            now,
            {
              previous: {
                planId: subscription.planId,
                planVersion: subscription.planVersion,
                planCode: subscription.planCode,
                status: subscription.status,
                userLimit: subscription.userLimit,
                billingContact: subscription.billingContact,
              },
              current: decision.subscription,
              previousVersion: subscription.version,
              version: next.version,
            },
          );
        }
        if (decision.exemptUids.length) {
          for (const member of memberships.filter((m) => decision.exemptUids.includes(m.uid))) {
            tx.update(this.repo.tenant(tenant.id, 'memberships', member.uid), {
              seatExempt: true,
              version: member.version + 1,
              updatedAt: now,
            });
            recordPlatformAudit(
              this.repo,
              tx,
              actor,
              tenant.id,
              'membership.seat_exempted',
              member.uid,
              now,
              { role: member.role, status: member.status },
            );
          }
          tx.update(this.repo.global('tenants', tenant.id), {
            ...decision.counters,
            updatedAt: now,
          });
        }
      }
      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        action: decision.subscription
          ? 'migrated'
          : decision.skipped
            ? 'skipped'
            : 'already_official',
        skipped: decision.skipped,
        exemptedMemberships: decision.exemptUids.length,
        warnings: decision.warnings,
        before: {
          planCode: subscription.planCode,
          status: subscription.status,
          userLimit: subscription.userLimit,
          priceCents: subscription.monthlyPriceCents,
        },
        after: {
          planCode: next.planCode,
          status: next.status,
          userLimit: next.userLimit,
          priceCents: next.monthlyPriceCents,
        },
      };
    });
  }

  async run(options: { apply: boolean; tenantId?: string }) {
    const actor = migrationActor();
    const ids = options.tenantId
      ? [options.tenantId]
      : (
          await this.repo.db.collection('tenants').orderBy(FieldPath.documentId()).select().get()
        ).docs.map((doc) => doc.id);
    const entries: MigrationEntry[] = [];
    for (const id of ids) {
      const entry = await this.tenant(id, options.apply, actor);
      if (entry) entries.push(entry);
    }
    return {
      mode: options.apply ? ('apply' as const) : ('dry-run' as const),
      examined: entries.length,
      migrated: entries.filter((e) => e.action === 'migrated').length,
      skipped: entries.filter((e) => e.action === 'skipped').length,
      alreadyOfficial: entries.filter((e) => e.action === 'already_official').length,
      exemptedMemberships: entries.reduce((total, e) => total + e.exemptedMemberships, 0),
      entries,
    };
  }
}
