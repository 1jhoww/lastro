import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../auth/accessService.js';
import { AppError, requireCondition } from '../../shared/errors/appError.js';
import {
  auditSchema,
  subscriptionSchema,
  tenantSchema,
  type Subscription,
} from '../../shared/schemas/models.js';
import { catalogSettingsSchema } from '../../shared/schemas/catalog.js';
import {
  activateSubscriptionInput,
  changePlanInput,
  subscriptionCommandInput,
  subscriptionTermsInput,
  subscriptionView,
} from '../../shared/schemas/http.js';
import type { Actor } from '../../shared/types/context.js';
import { recordPlatformAudit } from '../../shared/audit/audit.js';
import {
  entitlementsFor,
  featureLabels,
  lostFeatures,
  planCatalog,
  planCodes,
  planFeatures,
  type PlanCode,
} from '../plans/catalog.js';
import { pendingInvitations, reservedSeats } from '../users/capacity.js';
import { addDays, billingDate } from '../billing/calendar.js';

/** Billing may start today or within one year; never retroactively. */
export function requireBillingStart(date: string, now: Date): void {
  const today = billingDate(now);
  requireCondition(
    date >= today && date <= addDays(today, 366),
    422,
    'VALIDATION_ERROR',
    'O início da cobrança deve ser hoje ou uma data futura de até um ano',
  );
}

const sameFeatures = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Super Admin commands over a company's contract. Each command requires the expected
 * version, a reason and writes the previous and new values to the platform audit log.
 * Charges already issued are never changed here: new terms apply to future charges only.
 */
export class SubscriptionService {
  constructor(
    readonly repo: FoundationRepository,
    readonly access: AccessService,
    readonly clock: () => Date = () => new Date(),
  ) {}

  async catalog(actor: Actor) {
    await this.access.platform(actor);
    const label = (code: (typeof planFeatures)[number]) => ({ code, label: featureLabels[code] });
    return {
      items: planCodes.map((code) => {
        const plan = planCatalog[code];
        return {
          code,
          name: plan.name,
          version: plan.version,
          referencePriceCents: plan.referencePriceCents,
          userLimit: plan.userLimit,
          features: plan.features.map(label),
          offered: plan.offered,
        };
      }),
      features: planFeatures.map(label),
    };
  }

  private async load(tx: Transaction, id: string) {
    const subscription = await this.repo.read(
      this.repo.global('subscriptions', id),
      subscriptionSchema,
      tx,
    );
    requireCondition(subscription, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    const tenant = await this.repo.read(
      this.repo.global('tenants', subscription.tenantId),
      tenantSchema,
      tx,
    );
    requireCondition(
      tenant?.subscriptionId === subscription.id,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return { subscription, tenant };
  }

  private requireVersion(subscription: Subscription, expectedVersion: number) {
    requireCondition(
      subscription.version === expectedVersion,
      409,
      'CONFLICT',
      'Versão desatualizada',
    );
  }

  private requireOpen(subscription: Subscription) {
    requireCondition(
      subscription.status !== 'canceled',
      409,
      'CONFLICT',
      'Assinatura encerrada não pode ser alterada',
    );
  }

  /** Users and still-valid invitations that would have to fit into the target plan. */
  private async occupancy(tx: Transaction, tenantId: string, activeUsers: number) {
    const pending = pendingInvitations(
      await tx.get(
        this.repo.db
          .collection(`tenants/${tenantId}/invitations`)
          .where('status', '==', 'pending')
          .where('expiresAt', '>', this.clock().toISOString())
          .limit(101),
      ),
    );
    return { activeUsers, reservedInvitations: reservedSeats(pending) };
  }

  private async publicCatalogEnabled(tx: Transaction, tenantId: string) {
    const settings = await this.repo.read(
      this.repo.db.collection('tenants').doc(tenantId).collection('catalogSettings').doc('current'),
      catalogSettingsSchema,
      tx,
    );
    return settings?.enabled === true;
  }

  private planChange(subscription: Subscription, planCode: PlanCode) {
    const target = planCatalog[planCode];
    requireCondition(target.offered, 422, 'VALIDATION_ERROR', 'Plano indisponível');
    requireCondition(
      subscription.planCode !== planCode,
      422,
      'VALIDATION_ERROR',
      'A empresa já está neste plano',
    );
    const lost = lostFeatures(
      entitlementsFor(subscription),
      entitlementsFor({ planCode, userLimit: target.userLimit }),
    );
    return { target, lost };
  }

  private commit(
    tx: Transaction,
    actor: Actor,
    previous: Subscription,
    changes: Partial<Subscription>,
    action: string,
    audit: Record<string, unknown>,
  ) {
    const now = this.clock().toISOString();
    const next = subscriptionSchema.parse({
      ...previous,
      ...changes,
      version: previous.version + 1,
      updatedAt: now,
    });
    tx.set(this.repo.global('subscriptions', previous.id), next);
    recordPlatformAudit(this.repo, tx, actor, previous.tenantId, action, previous.id, now, {
      ...audit,
      previousVersion: previous.version,
      version: next.version,
    });
    return subscriptionView.parse(next);
  }

  async previewPlanChange(actor: Actor, id: string, planCode: PlanCode) {
    return this.repo.db.runTransaction(
      async (tx) => {
        await this.access.platform(actor, tx);
        const { subscription, tenant } = await this.load(tx, id);
        const { target, lost } = this.planChange(subscription, planCode);
        const seats = await this.occupancy(tx, tenant.id, tenant.activeUsers);
        return {
          subscriptionVersion: subscription.version,
          currentPlanCode: subscription.planCode,
          targetPlanCode: planCode,
          targetUserLimit: target.userLimit,
          ...seats,
          excessSeats: Math.max(
            0,
            seats.activeUsers + seats.reservedInvitations - target.userLimit,
          ),
          lostFeatures: lost,
          publicCatalogEnabled: await this.publicCatalogEnabled(tx, tenant.id),
          monthlyPriceCents: subscription.monthlyPriceCents,
          referencePriceCents: target.referencePriceCents,
        };
      },
      { readOnly: true },
    );
  }

  /**
   * Upgrades and downgrades take effect immediately for limits and features. A downgrade
   * never deactivates users: it is refused until the company fits the target limit.
   */
  async changePlan(actor: Actor, id: string, input: z.infer<typeof changePlanInput>) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const { subscription, tenant } = await this.load(tx, id);
      const seats = await this.occupancy(tx, tenant.id, tenant.activeUsers);
      this.requireVersion(subscription, input.expectedVersion);
      this.requireOpen(subscription);
      const { target, lost } = this.planChange(subscription, input.planCode);
      requireCondition(
        sameFeatures(lost, input.acknowledgedLostFeatures),
        409,
        'FEATURE_LOSS_UNCONFIRMED',
        'Confirme os recursos que a empresa deixará de ter',
      );
      requireCondition(
        seats.activeUsers + seats.reservedInvitations <= target.userLimit,
        409,
        'USER_LIMIT_REACHED',
        'A empresa ocupa mais vagas do que o plano permite; libere vagas antes da troca',
      );
      return this.commit(
        tx,
        actor,
        subscription,
        {
          planCode: target.code,
          planId: target.code,
          planVersion: target.version,
          userLimit: target.userLimit,
          monthlyPriceCents: input.monthlyPriceCents ?? subscription.monthlyPriceCents,
        },
        'subscription.plan.changed',
        {
          previousPlanCode: subscription.planCode,
          planCode: target.code,
          previousUserLimit: subscription.userLimit,
          userLimit: target.userLimit,
          previousMonthlyPriceCents: subscription.monthlyPriceCents,
          monthlyPriceCents: input.monthlyPriceCents ?? subscription.monthlyPriceCents,
          lostFeatures: lost,
          ...seats,
          reason: input.reason,
        },
      );
    });
  }

  /** Starts billing for a contract waiting for activation (e.g. migrated companies). */
  async activate(actor: Actor, id: string, input: z.infer<typeof activateSubscriptionInput>) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const { subscription } = await this.load(tx, id);
      this.requireVersion(subscription, input.expectedVersion);
      requireCondition(
        subscription.status === 'pending',
        409,
        'CONFLICT',
        'Somente assinaturas aguardando ativação podem ser ativadas',
      );
      requireBillingStart(input.billingStartsOn, this.clock());
      return this.commit(
        tx,
        actor,
        subscription,
        {
          status: 'active',
          monthlyPriceCents: input.monthlyPriceCents,
          billingDay: input.billingDay,
          billingStartsOn: input.billingStartsOn,
        },
        'subscription.activated',
        {
          previousStatus: subscription.status,
          status: 'active',
          previousMonthlyPriceCents: subscription.monthlyPriceCents,
          monthlyPriceCents: input.monthlyPriceCents,
          billingDay: input.billingDay,
          billingStartsOn: input.billingStartsOn,
          reason: input.reason,
        },
      );
    });
  }

  /** Price, due day, internal notes and billing contact. Issued charges stay as they are. */
  async updateTerms(actor: Actor, id: string, input: z.infer<typeof subscriptionTermsInput>) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const { subscription } = await this.load(tx, id);
      this.requireVersion(subscription, input.expectedVersion);
      this.requireOpen(subscription);
      requireCondition(
        input.billingDay === undefined || subscription.billingDay !== null,
        409,
        'CONFLICT',
        'Ative a cobrança antes de definir o dia de vencimento',
      );
      const { expectedVersion: _version, reason, ...requested } = input;
      const changes: Partial<Subscription> = {};
      const previous: Record<string, unknown> = {};
      const current: Record<string, unknown> = {};
      for (const key of Object.keys(requested) as (keyof typeof requested)[]) {
        const value = requested[key];
        if (value === undefined) continue;
        if (JSON.stringify(value) === JSON.stringify(subscription[key])) continue;
        Object.assign(changes, { [key]: value });
        previous[key] = subscription[key];
        current[key] = value;
      }
      requireCondition(
        Object.keys(changes).length > 0,
        422,
        'VALIDATION_ERROR',
        'Informe uma alteração',
      );
      return this.commit(tx, actor, subscription, changes, 'subscription.terms.updated', {
        previous,
        current,
        reason,
      });
    });
  }

  /** Administrative suspension: blocks the company's access, keeps every record. */
  async suspend(actor: Actor, id: string, input: z.infer<typeof subscriptionCommandInput>) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const { subscription } = await this.load(tx, id);
      this.requireVersion(subscription, input.expectedVersion);
      requireCondition(
        ['pending', 'active', 'past_due'].includes(subscription.status),
        409,
        'CONFLICT',
        'Esta assinatura não pode ser suspensa',
      );
      return this.commit(
        tx,
        actor,
        subscription,
        { status: 'suspended' },
        'subscription.suspended',
        { previousStatus: subscription.status, status: 'suspended', reason: input.reason },
      );
    });
  }

  /** Returns to active billing, or to waiting for activation when billing never started. */
  async reactivate(actor: Actor, id: string, input: z.infer<typeof subscriptionCommandInput>) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const { subscription } = await this.load(tx, id);
      this.requireVersion(subscription, input.expectedVersion);
      requireCondition(
        subscription.status === 'suspended',
        409,
        'CONFLICT',
        'Somente assinaturas suspensas podem ser reativadas',
      );
      const status = subscription.billingDay === null ? 'pending' : 'active';
      return this.commit(tx, actor, subscription, { status }, 'subscription.reactivated', {
        previousStatus: subscription.status,
        status,
        reason: input.reason,
      });
    });
  }

  async history(actor: Actor, id: string) {
    await this.access.platform(actor);
    const subscription = await this.repo.read(
      this.repo.global('subscriptions', id),
      subscriptionSchema,
    );
    if (!subscription) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    const logs = await this.repo.db
      .collection('auditLogs')
      .where('resourceId', '==', id)
      .orderBy('occurredAt', 'desc')
      .limit(100)
      .get();
    return {
      items: logs.docs.map((doc) => {
        const log = auditSchema.parse(doc.data());
        return {
          id: log.id,
          action: log.action,
          actorUid: log.actorUid,
          occurredAt: log.occurredAt,
          changes: log.changes,
        };
      }),
    };
  }
}
