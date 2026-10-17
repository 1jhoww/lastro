import type { Auth } from 'firebase-admin/auth';
import { FieldPath, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Config } from '../../config/env.js';
import { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../auth/accessService.js';
import { requireCondition } from '../../shared/errors/appError.js';
import {
  invitationSchema,
  membershipSchema,
  subscriptionSchema,
  tenantSchema,
  type Subscription,
  type Tenant,
} from '../../shared/schemas/models.js';
import { catalogSettingsSchema } from '../../shared/schemas/catalog.js';
import { subscriptionView, tenantView } from '../../shared/schemas/http.js';
import { companyQuery } from '../../shared/schemas/platform.js';
import type { Actor } from '../../shared/types/context.js';
import { recordPlatformAudit } from '../../shared/audit/audit.js';
import { invitationToken } from '../../shared/utils/crypto.js';
import { entitlementsFor, planCatalog } from '../plans/catalog.js';
import { pendingInvitations, reservedSeats } from '../users/capacity.js';
import { billingDate } from '../billing/calendar.js';
import { chargeSchema, nextDueDate, situationOf, type Charge } from '../billing/charges.js';
import { BillingService } from '../billing/billingService.js';
import { EmailChangeService } from '../users/emailChangeService.js';

/** Read models of the Super Admin panel stay in memory up to this many documents per query. */
const MAX_ROWS = 5000;

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Super Admin read models: dashboard indicators, companies and owner invitations. Every number
 * comes from persisted documents; contracted revenue (MRR) and received payments are separate.
 * Only platform administration data is read: never customers, products or orders.
 */
export class CompanyService {
  readonly billing: BillingService;
  constructor(
    readonly repo: FoundationRepository,
    readonly access: AccessService,
    readonly auth: Auth,
    readonly config: Config,
    readonly clock: () => Date = () => new Date(),
    readonly emailChanges = new EmailChangeService(repo, access, auth, clock),
  ) {
    this.billing = new BillingService(repo, access, config, clock);
  }

  private async rows(query: Query): Promise<QueryDocumentSnapshot[]> {
    const page = await query.limit(MAX_ROWS + 1).get();
    requireCondition(
      page.size <= MAX_ROWS,
      409,
      'CONFLICT',
      'Quantidade de registros acima do suportado pelo painel',
    );
    return page.docs;
  }
  private async contracts() {
    const [tenants, subscriptions] = await Promise.all([
      this.rows(this.repo.db.collection('tenants').orderBy(FieldPath.documentId())),
      this.rows(this.repo.db.collection('subscriptions').orderBy(FieldPath.documentId())),
    ]);
    const byId = new Map<string, Subscription>();
    for (const doc of subscriptions) {
      const subscription = subscriptionSchema.parse(doc.data());
      byId.set(subscription.id, subscription);
    }
    return tenants.flatMap((doc) => {
      const tenant = tenantSchema.parse(doc.data());
      const subscription = byId.get(tenant.subscriptionId);
      return subscription?.tenantId === tenant.id ? [{ tenant, subscription }] : [];
    });
  }
  private async openCharges(): Promise<Charge[]> {
    return (
      await this.rows(
        this.repo.db
          .collection('billingCharges')
          .where('status', '==', 'pending')
          .orderBy(FieldPath.documentId()),
      )
    ).map((doc) => chargeSchema.parse(doc.data()));
  }

  async overview(actor: Actor) {
    await this.access.platform(actor);
    const today = billingDate(this.clock());
    const month = today.slice(0, 7);
    const [contracts, open, paid] = await Promise.all([
      this.contracts(),
      this.openCharges(),
      this.rows(
        this.repo.db
          .collection('billingCharges')
          .where('status', '==', 'paid')
          .where('paidAt', '>=', `${month}-01`)
          .where('paidAt', '<=', `${month}-31`),
      ),
    ]);
    const statuses = { active: 0, pending: 0, suspended: 0, canceled: 0 };
    const plans = { essencial: 0, profissional: 0, legacy: 0 };
    let mrrCents = 0;
    for (const { subscription } of contracts) {
      // Legacy past_due keeps access and billing: it counts as active.
      const status = subscription.status === 'past_due' ? 'active' : subscription.status;
      statuses[status]++;
      if (status === 'active') mrrCents += subscription.monthlyPriceCents;
      if (status !== 'canceled') plans[subscription.planCode ?? 'legacy']++;
    }
    const names = new Map(contracts.map(({ tenant }) => [tenant.id, tenant.name]));
    const overdue = open.filter((charge) => charge.dueDate < today);
    const sum = (charges: Charge[]) => charges.reduce((total, c) => total + c.amountCents, 0);
    return {
      today,
      totalCompanies: contracts.length,
      subscriptions: statuses,
      plans,
      mrrCents,
      openCharges: { count: open.length, amountCents: sum(open) },
      overdueCharges: { count: overdue.length, amountCents: sum(overdue) },
      receivedThisMonthCents: paid.reduce(
        (total, doc) => total + (chargeSchema.parse(doc.data()).paidAmountCents ?? 0),
        0,
      ),
      upcoming: [...open]
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
        .slice(0, 10)
        .map((charge) => ({
          ...this.billing.view(charge, today),
          tenantName: names.get(charge.tenantId) ?? '',
        })),
    };
  }

  private row(tenant: Tenant, subscription: Subscription, open: Charge[], today: string) {
    const own = open.filter((charge) => charge.tenantId === tenant.id);
    return {
      id: tenant.id,
      name: tenant.name,
      tenantStatus: tenant.status,
      createdAt: tenant.createdAt,
      subscriptionId: subscription.id,
      subscriptionVersion: subscription.version,
      subscriptionStatus: subscription.status,
      planCode: subscription.planCode,
      planName: subscription.planCode ? planCatalog[subscription.planCode].name : null,
      monthlyPriceCents: subscription.monthlyPriceCents,
      billingDay: subscription.billingDay,
      nextDueDate: nextDueDate(subscription, today),
      activeUsers: tenant.activeUsers,
      userLimit: subscription.userLimit,
      contact: subscription.billingContact,
      openCharges: {
        count: own.length,
        overdueCount: own.filter((charge) => situationOf(charge, today) === 'overdue').length,
        amountCents: own.reduce((total, charge) => total + charge.amountCents, 0),
      },
    };
  }

  async companies(actor: Actor, input: z.infer<typeof companyQuery>) {
    await this.access.platform(actor);
    const today = billingDate(this.clock());
    const [contracts, open] = await Promise.all([this.contracts(), this.openCharges()]);
    const q = input.q ? normalize(input.q) : null;
    const items = contracts
      .map(({ tenant, subscription }) => this.row(tenant, subscription, open, today))
      .filter(
        (row) =>
          (!q || normalize(row.name).includes(q) || row.id.startsWith(input.q ?? '')) &&
          (!input.planCode || (row.planCode ?? 'legacy') === input.planCode) &&
          (!input.status || row.subscriptionStatus === input.status) &&
          (input.attention !== 'overdue' || row.openCharges.overdueCount > 0) &&
          (input.attention !== 'open' || row.openCharges.count > 0),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
    return { items, total: contracts.length };
  }

  async company(actor: Actor, id: string) {
    await this.access.platform(actor);
    const now = this.clock();
    const tenant = await this.repo.read(this.repo.global('tenants', id), tenantSchema);
    requireCondition(tenant, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    const [subscription, members, invitations, pending, catalog] = await Promise.all([
      this.repo.read(this.repo.global('subscriptions', tenant.subscriptionId), subscriptionSchema),
      this.repo.db.collection(`tenants/${id}/memberships`).limit(101).get(),
      this.repo.db
        .collection(`tenants/${id}/invitations`)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get(),
      this.repo.db
        .collection(`tenants/${id}/invitations`)
        .where('status', '==', 'pending')
        .where('expiresAt', '>', now.toISOString())
        .limit(101)
        .get(),
      this.repo.read(
        this.repo.db.collection('tenants').doc(id).collection('catalogSettings').doc('current'),
        catalogSettingsSchema,
      ),
    ]);
    requireCondition(
      subscription?.tenantId === tenant.id,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    const memberships = members.docs.map((doc) => membershipSchema.parse(doc.data()));
    const profiles = await this.profiles(memberships.map((member) => member.uid));
    const identities = memberships.length
      ? await this.repo.db.getAll(
          ...memberships.map((member) => this.repo.global('identities', member.uid)),
        )
      : [];
    const identityBlocked = new Set(
      identities.filter((doc) => doc.get('status') === 'disabled').map((doc) => doc.id),
    );
    const changes = await this.emailChanges.forMembers(
      memberships.map((member) => member.uid),
      new Map([...profiles].map(([uid, profile]) => [uid, profile.email])),
    );
    const entitlements = entitlementsFor(subscription);
    const reserved = reservedSeats(pendingInvitations(pending));
    return {
      tenant: tenantView.parse(tenant),
      subscription: {
        ...subscriptionView.parse(subscription),
        planName: subscription.planCode ? planCatalog[subscription.planCode].name : null,
        nextDueDate: nextDueDate(subscription, billingDate(now)),
        features: [...entitlements.features],
      },
      capacity: {
        userLimit: entitlements.userLimit,
        activeUsers: tenant.activeUsers,
        reservedInvitations: reserved,
        available: Math.max(0, entitlements.userLimit - tenant.activeUsers - reserved),
      },
      users: memberships.map((member) => ({
        uid: member.uid,
        name: profiles.get(member.uid)?.name ?? null,
        email: profiles.get(member.uid)?.email ?? null,
        role: member.role,
        status: member.status,
        seatExempt: member.seatExempt,
        version: member.version,
        createdAt: member.createdAt,
        accountBlocked:
          identityBlocked.has(member.uid) || profiles.get(member.uid)?.disabled === true,
        emailChange: changes.get(member.uid) ?? null,
      })),
      invitations: invitations.docs.map((doc) => {
        const invitation = invitationSchema.parse(doc.data());
        return {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expired: invitation.status === 'pending' && invitation.expiresAt <= now.toISOString(),
          seatExempt: invitation.seatExempt,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          replacedBy: invitation.replacedBy,
        };
      }),
      publicCatalogEnabled: catalog?.enabled === true,
    };
  }

  /** Name and e-mail from the identity provider; best effort, never blocks the page. */
  private async profiles(uids: string[]) {
    const profiles = new Map<
      string,
      { name: string | null; email: string | null; disabled: boolean }
    >();
    try {
      for (let i = 0; i < uids.length; i += 100) {
        const result = await this.auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
        for (const user of result.users)
          profiles.set(user.uid, {
            name: user.displayName?.trim() || null,
            email: user.email?.trim().toLowerCase() || null,
            disabled: user.disabled,
          });
      }
    } catch {
      // The list stays correct without names; nothing depends on this data.
    }
    return profiles;
  }

  /** Companies still waiting for their first administrator, with the latest owner invitation. */
  async ownerInvitations(actor: Actor) {
    await this.access.platform(actor);
    const now = this.clock().toISOString();
    const waiting = (await this.contracts()).filter(
      ({ tenant }) => tenant.status === 'provisioning',
    );
    const items = await Promise.all(
      waiting.map(async ({ tenant, subscription }) => {
        const latest = await this.repo.db
          .collection(`tenants/${tenant.id}/invitations`)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        const invitation = latest.empty ? null : invitationSchema.parse(latest.docs[0]!.data());
        const valid = invitation?.status === 'pending' && invitation.expiresAt > now;
        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantVersion: tenant.version,
          planCode: subscription.planCode,
          createdAt: tenant.createdAt,
          invitation: invitation && {
            id: invitation.id,
            email: invitation.email,
            status: invitation.status,
            expired: invitation.status === 'pending' && !valid,
            expiresAt: invitation.expiresAt,
            token: valid
              ? invitationToken(this.config.invitationSecret, tenant.id, invitation.id)
              : null,
          },
        };
      }),
    );
    return {
      items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  /** Lets the Super Admin free a reserved seat, e.g. before a downgrade. */
  async revokeInvitation(actor: Actor, tenantId: string, invitationId: string, reason: string) {
    const now = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const ref = this.repo.tenant(tenantId, 'invitations', invitationId);
      const invitation = await this.repo.read(ref, invitationSchema, tx);
      requireCondition(
        invitation?.tenantId === tenantId,
        404,
        'RESOURCE_NOT_FOUND',
        'Recurso não encontrado',
      );
      requireCondition(invitation.status !== 'accepted', 409, 'CONFLICT', 'Convite já utilizado');
      if (invitation.status === 'revoked') return { id: invitationId, status: 'revoked' as const };
      tx.update(ref, { status: 'revoked', updatedAt: now });
      // Serialize with admissions on this company, as tenant-side revocation does.
      tx.update(this.repo.global('tenants', tenantId), { updatedAt: now });
      recordPlatformAudit(this.repo, tx, actor, tenantId, 'invitation.revoked', invitationId, now, {
        email: invitation.email,
        role: invitation.role,
        reason,
      });
      return { id: invitationId, status: 'revoked' as const };
    });
  }
}
