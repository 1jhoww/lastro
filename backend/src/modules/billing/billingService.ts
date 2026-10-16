import { randomUUID } from 'node:crypto';
import { FieldPath, type Query, type Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Config } from '../../config/env.js';
import { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../auth/accessService.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { auditSchema, subscriptionSchema, tenantSchema } from '../../shared/schemas/models.js';
import {
  cancelChargeInput,
  chargeListQuery,
  chargeView,
  correctChargeInput,
  createChargeInput,
  payChargeInput,
} from '../../shared/schemas/billing.js';
import type { Actor } from '../../shared/types/context.js';
import { recordPlatformAudit } from '../../shared/audit/audit.js';
import { decodeCursor, encodeCursor } from '../../shared/utils/crypto.js';
import { addDays, billingDate } from './calendar.js';
import {
  DUE_SOON_DAYS,
  chargeId,
  chargeSchema,
  chargesDue,
  situationOf,
  type Charge,
} from './charges.js';

/** Identity recorded in the audit log for scheduled generation. */
export const billingJobActor = (): Actor => ({
  uid: 'lastro-billing-job',
  email: null,
  emailVerified: false,
  authTime: 0,
  requestId: randomUUID(),
});

export interface GenerationSummary {
  examined: number;
  created: number;
  existing: number;
  skipped: number;
  failed: number;
}

export class BillingService {
  constructor(
    readonly repo: FoundationRepository,
    readonly access: AccessService,
    readonly config: Config,
    readonly clock: () => Date = () => new Date(),
  ) {}

  private ref(id: string) {
    return this.repo.global('billingCharges', id);
  }
  private today() {
    return billingDate(this.clock());
  }
  view(charge: Charge, today = this.today()) {
    return chargeView.parse({ ...charge, situation: situationOf(charge, today) });
  }

  /**
   * Issues every charge due today for active subscriptions. Safe to run any number of times
   * and concurrently: each charge is created once inside a transaction that re-reads the
   * contract, so a charge always reflects the terms in force when it is issued.
   */
  async generateDue(actor: Actor): Promise<GenerationSummary> {
    const today = this.today();
    const summary: GenerationSummary = {
      examined: 0,
      created: 0,
      existing: 0,
      skipped: 0,
      failed: 0,
    };
    let after: string | undefined;
    for (;;) {
      let query = this.repo.db
        .collection('subscriptions')
        .where('status', '==', 'active')
        .orderBy(FieldPath.documentId())
        .limit(100);
      if (after) query = query.startAfter(after);
      const page = await query.get();
      for (const doc of page.docs) {
        summary.examined++;
        try {
          const due = chargesDue(subscriptionSchema.parse(doc.data()), today);
          if (!due.length) summary.skipped++;
          for (const { competence } of due) {
            const outcome = await this.issue(actor, doc.id, competence, today);
            summary[outcome]++;
          }
        } catch (error) {
          summary.failed++;
          console.error(
            JSON.stringify({
              event: 'billing.generation.failed',
              subscriptionId: doc.id,
              error: error instanceof Error ? error.name : 'unknown',
            }),
          );
        }
      }
      if (page.size < 100) break;
      after = page.docs.at(-1)!.id;
    }
    return summary;
  }

  private async issue(
    actor: Actor,
    subscriptionId: string,
    competence: string,
    today: string,
  ): Promise<'created' | 'existing' | 'skipped'> {
    return this.repo.db.runTransaction(async (tx) => {
      const subscription = await this.repo.read(
        this.repo.global('subscriptions', subscriptionId),
        subscriptionSchema,
        tx,
      );
      const id = chargeId(subscriptionId, competence);
      const existing = await tx.get(this.ref(id));
      if (existing.exists) return 'existing';
      const due = subscription
        ? chargesDue(subscription, today).find((c) => c.competence === competence)
        : undefined;
      // Terms changed between listing and issuing: the next run decides with the new terms.
      if (!subscription || !due) return 'skipped';
      const now = this.clock().toISOString();
      const charge = chargeSchema.parse({
        id,
        tenantId: subscription.tenantId,
        subscriptionId,
        competence,
        amountCents: subscription.monthlyPriceCents,
        dueDate: due.dueDate,
        status: 'pending',
        paidAt: null,
        paidAmountCents: null,
        notes: null,
        origin: 'automatic',
        planCode: subscription.planCode,
        version: 1,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      tx.create(this.ref(id), charge);
      recordPlatformAudit(
        this.repo,
        tx,
        actor,
        subscription.tenantId,
        'charge.generated',
        id,
        now,
        {
          competence,
          amountCents: charge.amountCents,
          dueDate: charge.dueDate,
          subscriptionVersion: subscription.version,
        },
      );
      return 'created';
    });
  }

  /** Manual trigger from the Super Admin panel; same idempotent generation as the job. */
  async generateNow(actor: Actor) {
    await this.access.platform(actor);
    return this.generateDue(actor);
  }

  async list(actor: Actor, input: z.infer<typeof chargeListQuery>) {
    await this.access.platform(actor);
    const situation = input.situation ?? 'all';
    const limit = Number(input.limit ?? '50');
    const today = this.today();
    const scope = `charges:${actor.uid}:${situation}:${input.tenantId ?? ''}`;
    const after = decodeCursor(this.config.invitationSecret, scope, input.cursor);
    const ascending = ['open', 'overdue', 'due_soon'].includes(situation);
    const direction = ascending ? 'asc' : 'desc';
    let query = this.repo.db.collection('billingCharges') as Query;
    if (input.tenantId) query = query.where('tenantId', '==', input.tenantId);
    if (situation === 'paid' || situation === 'canceled')
      query = query.where('status', '==', situation);
    if (ascending) query = query.where('status', '==', 'pending');
    if (situation === 'overdue') query = query.where('dueDate', '<', today);
    if (situation === 'due_soon')
      query = query
        .where('dueDate', '>=', today)
        .where('dueDate', '<=', addDays(today, DUE_SOON_DAYS));
    query = query
      .orderBy('dueDate', direction)
      .orderBy(FieldPath.documentId(), direction)
      .limit(limit + 1);
    if (after) {
      const [dueDate, id] = after.split('|');
      query = query.startAfter(dueDate, id);
    }
    const page = await query.get();
    const docs = page.docs.slice(0, limit);
    const last = docs.at(-1);
    return {
      items: docs.map((doc) => this.view(chargeSchema.parse(doc.data()), today)),
      nextCursor:
        page.size > limit && last
          ? encodeCursor(
              this.config.invitationSecret,
              scope,
              `${last.get('dueDate') as string}|${last.id}`,
            )
          : null,
    };
  }

  private async load(tx: Transaction, id: string) {
    const charge = await this.repo.read(this.ref(id), chargeSchema, tx);
    requireCondition(charge, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    return charge;
  }

  private commit(
    tx: Transaction,
    actor: Actor,
    previous: Charge,
    changes: Partial<Charge>,
    action: string,
    audit: Record<string, unknown>,
  ) {
    const now = this.clock().toISOString();
    const next = chargeSchema.parse({
      ...previous,
      ...changes,
      version: previous.version + 1,
      updatedAt: now,
    });
    tx.set(this.ref(previous.id), next);
    recordPlatformAudit(this.repo, tx, actor, previous.tenantId, action, previous.id, now, {
      ...audit,
      previousVersion: previous.version,
      version: next.version,
    });
    return this.view(next);
  }

  private requirePaidAt(paidAt: string) {
    requireCondition(
      paidAt <= this.today(),
      422,
      'VALIDATION_ERROR',
      'A data do pagamento não pode estar no futuro',
    );
  }

  /** Explicit charge, e.g. a month agreed outside the automatic rules. Never duplicated. */
  async create(actor: Actor, input: z.infer<typeof createChargeInput>) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const tenant = await this.repo.read(
        this.repo.global('tenants', input.tenantId),
        tenantSchema,
        tx,
      );
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
        409,
        'CONFLICT',
        'Assinatura encerrada não recebe cobranças',
      );
      const id = chargeId(subscription.id, input.competence);
      requireCondition(
        !(await tx.get(this.ref(id))).exists,
        409,
        'CHARGE_EXISTS',
        'Já existe cobrança desta assinatura para esta competência',
      );
      const now = this.clock().toISOString();
      const charge = chargeSchema.parse({
        id,
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        competence: input.competence,
        amountCents: input.amountCents,
        dueDate: input.dueDate,
        status: 'pending',
        paidAt: null,
        paidAmountCents: null,
        notes: input.notes ?? null,
        origin: 'manual',
        planCode: subscription.planCode,
        version: 1,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      tx.create(this.ref(id), charge);
      recordPlatformAudit(this.repo, tx, actor, tenant.id, 'charge.created', id, now, {
        competence: charge.competence,
        amountCents: charge.amountCents,
        dueDate: charge.dueDate,
        reason: input.reason,
      });
      return this.view(charge);
    });
  }

  async pay(actor: Actor, id: string, input: z.infer<typeof payChargeInput>) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const charge = await this.load(tx, id);
      requireCondition(
        charge.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      requireCondition(
        charge.status === 'pending',
        409,
        'CONFLICT',
        'Somente cobranças pendentes podem ser marcadas como pagas',
      );
      this.requirePaidAt(input.paidAt);
      const paidAmountCents = input.paidAmountCents ?? charge.amountCents;
      return this.commit(
        tx,
        actor,
        charge,
        {
          status: 'paid',
          paidAt: input.paidAt,
          paidAmountCents,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        'charge.paid',
        { paidAt: input.paidAt, paidAmountCents, amountCents: charge.amountCents },
      );
    });
  }

  /** Audited correction of any field, including reopening a paid or canceled charge. */
  async correct(actor: Actor, id: string, input: z.infer<typeof correctChargeInput>) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const charge = await this.load(tx, id);
      requireCondition(
        charge.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      const status = input.status ?? charge.status;
      requireCondition(
        status !== 'canceled' ||
          (input.paidAt === undefined && input.paidAmountCents === undefined),
        422,
        'VALIDATION_ERROR',
        'Cobrança cancelada não tem pagamento',
      );
      const next: Partial<Charge> = {
        status,
        amountCents: input.amountCents ?? charge.amountCents,
        dueDate: input.dueDate ?? charge.dueDate,
        notes: input.notes !== undefined ? input.notes : charge.notes,
      };
      if (status === 'paid') {
        const paidAt = input.paidAt ?? charge.paidAt;
        requireCondition(paidAt, 422, 'VALIDATION_ERROR', 'Informe a data do pagamento');
        this.requirePaidAt(paidAt);
        next.paidAt = paidAt;
        next.paidAmountCents =
          input.paidAmountCents ?? charge.paidAmountCents ?? next.amountCents ?? charge.amountCents;
      } else {
        requireCondition(
          input.paidAt === undefined && input.paidAmountCents === undefined,
          422,
          'VALIDATION_ERROR',
          'Pagamento só pode ser informado em cobrança paga',
        );
        next.paidAt = null;
        next.paidAmountCents = null;
      }
      const previous: Record<string, unknown> = {};
      const current: Record<string, unknown> = {};
      for (const key of Object.keys(next) as (keyof typeof next)[])
        if (JSON.stringify(next[key]) !== JSON.stringify(charge[key])) {
          previous[key] = charge[key];
          current[key] = next[key];
        }
      requireCondition(
        Object.keys(current).length > 0,
        422,
        'VALIDATION_ERROR',
        'Informe uma alteração',
      );
      return this.commit(tx, actor, charge, next, 'charge.corrected', {
        previous,
        current,
        reason: input.reason,
      });
    });
  }

  async cancel(actor: Actor, id: string, input: z.infer<typeof cancelChargeInput>) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const charge = await this.load(tx, id);
      requireCondition(
        charge.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      requireCondition(
        charge.status === 'pending',
        409,
        'CONFLICT',
        'Somente cobranças pendentes podem ser canceladas',
      );
      return this.commit(tx, actor, charge, { status: 'canceled' }, 'charge.canceled', {
        reason: input.reason,
      });
    });
  }

  async history(actor: Actor, id: string) {
    await this.access.platform(actor);
    const charge = await this.repo.read(this.ref(id), chargeSchema);
    requireCondition(charge, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
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
