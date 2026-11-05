import { randomUUID } from 'node:crypto';
import { FieldPath, Timestamp, type Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../auth/accessService.js';
import { requireCondition } from '../../shared/errors/appError.js';
import {
  customPlanSchema,
  subscriptionSchema,
  tenantSchema,
  type CustomPlan,
  type Subscription,
} from '../../shared/schemas/models.js';
import {
  createCustomPlanInput,
  customPlanCommandInput,
  customPlanDetail,
  customPlanList,
  customPlanQuery,
  customPlanView,
  duplicateCustomPlanInput,
  updateCustomPlanInput,
} from '../../shared/schemas/customPlans.js';
import type { Actor } from '../../shared/types/context.js';
import { auditHistory, recordAudit } from '../../shared/audit/audit.js';
import {
  customPlanCode,
  recognizedFeatures,
  requireValidComposition,
  type PlanFeature,
} from '../plans/catalog.js';
import type { PlatformService } from './platformService.js';

/** The panel reads every plan and contract at once, and refuses to work on a partial picture. */
const MAX_ROWS = 2000;

const sameList = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join() === [...b].sort().join();

/** Whether a contract still has the terms it was signed with. */
export function contractAdjusted(subscription: Subscription): boolean {
  const contract = subscription.customContract;
  if (!contract) return false;
  return (
    subscription.monthlyPriceCents !== contract.origin.monthlyPriceCents ||
    subscription.userLimit !== contract.origin.userLimit ||
    !sameList(contract.features, contract.origin.features)
  );
}

/** Copies the offer into a contract: later edits of the plan never reach this snapshot. */
export function customContractFrom(plan: CustomPlan, monthlyPriceCents: number, now: string) {
  return {
    planId: plan.id,
    planVersion: plan.version,
    planCode: customPlanCode,
    userLimit: plan.userLimit,
    monthlyPriceCents,
    customContract: {
      planName: plan.name,
      sourcePlanCode: plan.sourcePlanCode,
      features: [...plan.features],
      contractedAt: now,
      origin: {
        monthlyPriceCents: plan.monthlyPriceCents,
        userLimit: plan.userLimit,
        features: [...plan.features],
      },
    },
  } satisfies Partial<Subscription>;
}

/** Reads a plan a new contract is about to use. */
export async function offeredPlan(repo: FoundationRepository, tx: Transaction, id: string) {
  const plan = await repo.read(repo.global('customPlans', id), customPlanSchema, tx);
  requireCondition(plan, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
  requireCondition(
    plan.status === 'active',
    409,
    'CUSTOM_PLAN_INACTIVE',
    'Plano personalizado desativado não aceita novos contratos',
  );
  return plan;
}

/**
 * Commercial offers the Super Admin negotiates with specific companies. A plan here is a model:
 * contracts copy it, so nothing in this service ever writes to a subscription. Plans are never
 * deleted (contracts keep pointing at them); deactivating only stops new contracts.
 */
export class CustomPlanService {
  constructor(
    readonly repo: FoundationRepository,
    readonly access: AccessService,
    readonly platform: PlatformService,
    readonly clock: () => Date = () => new Date(),
  ) {}

  private ref(id: string) {
    return this.repo.global('customPlans', id);
  }

  private view(plan: CustomPlan) {
    return customPlanView.parse({ ...plan, features: recognizedFeatures(plan.features) });
  }

  private async load(tx: Transaction, id: string) {
    const plan = await this.repo.read(this.ref(id), customPlanSchema, tx);
    requireCondition(plan, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    return plan;
  }

  private write(
    tx: Transaction,
    actor: Actor,
    plan: CustomPlan,
    action: string,
    changes: Record<string, unknown>,
  ) {
    tx.set(this.ref(plan.id), customPlanSchema.parse(plan));
    recordAudit(this.repo, tx, actor, null, action, plan.id, plan.updatedAt, changes);
    return this.view(plan);
  }

  private async contracts(): Promise<Subscription[]> {
    const page = await this.repo.db
      .collection('subscriptions')
      .where('planCode', '==', customPlanCode)
      .limit(MAX_ROWS + 1)
      .get();
    requireCondition(
      page.size <= MAX_ROWS,
      409,
      'CONFLICT',
      'Quantidade de registros acima do suportado pelo painel',
    );
    return page.docs.map((doc) => subscriptionSchema.parse(doc.data()));
  }

  async list(actor: Actor, input: z.infer<typeof customPlanQuery>) {
    await this.access.platform(actor);
    const [plans, contracts] = await Promise.all([
      this.repo.db
        .collection('customPlans')
        .orderBy(FieldPath.documentId())
        .limit(MAX_ROWS + 1)
        .get(),
      this.contracts(),
    ]);
    requireCondition(
      plans.size <= MAX_ROWS,
      409,
      'CONFLICT',
      'Quantidade de registros acima do suportado pelo painel',
    );
    const linked = new Map<string, number>();
    for (const contract of contracts)
      if (contract.status !== 'canceled')
        linked.set(contract.planId, (linked.get(contract.planId) ?? 0) + 1);
    return customPlanList.parse({
      items: plans.docs
        .map((doc) => customPlanSchema.parse(doc.data()))
        .filter((plan) => !input.status || plan.status === input.status)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id))
        .map((plan) => ({ ...this.view(plan), linkedCompanies: linked.get(plan.id) ?? 0 })),
    });
  }

  async get(actor: Actor, id: string) {
    await this.access.platform(actor);
    const plan = await this.repo.read(this.ref(id), customPlanSchema);
    requireCondition(plan, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    const contracts = (await this.contracts()).filter((c) => c.planId === id);
    const tenants = contracts.length
      ? await this.repo.db.getAll(
          ...contracts.map((contract) => this.repo.global('tenants', contract.tenantId)),
        )
      : [];
    const names = new Map(
      tenants.flatMap((doc) => {
        const tenant = tenantSchema.safeParse(doc.data());
        return tenant.success ? [[tenant.data.id, tenant.data.name] as const] : [];
      }),
    );
    return customPlanDetail.parse({
      plan: this.view(plan),
      companies: contracts
        .map((contract) => ({
          tenantId: contract.tenantId,
          tenantName: names.get(contract.tenantId) ?? '',
          subscriptionId: contract.id,
          subscriptionStatus: contract.status,
          monthlyPriceCents: contract.monthlyPriceCents,
          userLimit: contract.userLimit,
          planVersion: contract.planVersion,
          outdated: contract.planVersion !== plan.version,
          adjusted: contractAdjusted(contract),
        }))
        .sort((a, b) => a.tenantName.localeCompare(b.tenantName, 'pt-BR')),
    });
  }

  /** Runs a creation at most once per Idempotency-Key, returning the same plan on a retry. */
  private async once(
    tx: Transaction,
    actor: Actor,
    operation: string,
    key: string,
    input: unknown,
    create: (id: string, now: string) => CustomPlan | Promise<CustomPlan>,
    changes: (plan: CustomPlan) => Record<string, unknown>,
  ) {
    const replay = await this.platform.replay(tx, actor, operation, key, input);
    if (replay.existing) return this.view(await this.load(tx, replay.existing.result.id ?? ''));
    const id = randomUUID();
    const now = this.clock().toISOString();
    const plan = await create(id, now);
    requireValidComposition({
      features: recognizedFeatures(plan.features),
      userLimit: plan.userLimit,
    });
    tx.create(replay.ref, {
      actorUid: actor.uid,
      operation,
      payloadHash: replay.hash,
      result: { id },
      createdAt: now,
      expiresAt: Timestamp.fromMillis(this.clock().getTime() + 30 * 86400000),
      schemaVersion: 1,
    });
    return this.write(tx, actor, plan, 'custom_plan.created', changes(plan));
  }

  async create(actor: Actor, input: z.infer<typeof createCustomPlanInput>, key: string) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      return this.once(
        tx,
        actor,
        'custom_plan.create',
        key,
        input,
        (id, now) => ({
          ...input,
          id,
          features: recognizedFeatures(input.features),
          status: 'active',
          duplicatedFromId: null,
          version: 1,
          createdBy: actor.uid,
          updatedBy: actor.uid,
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1,
        }),
        (plan) => ({
          name: plan.name,
          monthlyPriceCents: plan.monthlyPriceCents,
          userLimit: plan.userLimit,
          features: plan.features,
          sourcePlanCode: plan.sourcePlanCode,
        }),
      );
    });
  }

  async duplicate(
    actor: Actor,
    id: string,
    input: z.infer<typeof duplicateCustomPlanInput>,
    key: string,
  ) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const source = await this.load(tx, id);
      return this.once(
        tx,
        actor,
        'custom_plan.duplicate',
        key,
        { id, ...input },
        (newId, now) => ({
          ...source,
          id: newId,
          name: input.name,
          status: 'active',
          features: recognizedFeatures(source.features),
          duplicatedFromId: source.id,
          version: 1,
          createdBy: actor.uid,
          updatedBy: actor.uid,
          createdAt: now,
          updatedAt: now,
        }),
        (plan) => ({ name: plan.name, duplicatedFromId: source.id, version: source.version }),
      );
    });
  }

  /** Changes the offer for future contracts. Existing contracts keep their snapshot. */
  async update(actor: Actor, id: string, input: z.infer<typeof updateCustomPlanInput>) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const plan = await this.load(tx, id);
      this.requireVersion(plan, input.expectedVersion);
      const { expectedVersion: _version, reason, ...requested } = input;
      const previous: Record<string, unknown> = {};
      const current: Record<string, unknown> = {};
      for (const key of Object.keys(requested) as (keyof typeof requested)[]) {
        const given = requested[key];
        if (given === undefined) continue;
        const value = key === 'features' ? recognizedFeatures(given as PlanFeature[]) : given;
        const same =
          key === 'features'
            ? sameList(value as PlanFeature[], plan.features)
            : value === plan[key];
        if (same) continue;
        previous[key] = plan[key];
        current[key] = value;
      }
      requireCondition(
        Object.keys(current).length > 0,
        422,
        'VALIDATION_ERROR',
        'Informe uma alteração',
      );
      const next = {
        ...plan,
        ...(current as Partial<CustomPlan>),
        version: plan.version + 1,
        updatedBy: actor.uid,
        updatedAt: this.clock().toISOString(),
      };
      requireValidComposition({
        features: recognizedFeatures(next.features),
        userLimit: next.userLimit,
      });
      return this.write(tx, actor, next, 'custom_plan.updated', {
        previous,
        current,
        previousVersion: plan.version,
        version: next.version,
        reason,
      });
    });
  }

  async setStatus(
    actor: Actor,
    id: string,
    status: CustomPlan['status'],
    input: z.infer<typeof customPlanCommandInput>,
  ) {
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const plan = await this.load(tx, id);
      this.requireVersion(plan, input.expectedVersion);
      requireCondition(plan.status !== status, 409, 'CONFLICT', 'O plano já está nesta situação');
      // The version counts terms: contracts on this one are not outdated by a change of status.
      const next = {
        ...plan,
        status,
        version: plan.version + 1,
        updatedBy: actor.uid,
        updatedAt: this.clock().toISOString(),
      };
      return this.write(
        tx,
        actor,
        next,
        status === 'active' ? 'custom_plan.reactivated' : 'custom_plan.deactivated',
        {
          previousStatus: plan.status,
          status,
          previousVersion: plan.version,
          version: next.version,
          reason: input.reason,
        },
      );
    });
  }

  private requireVersion(plan: CustomPlan, expected: number) {
    requireCondition(plan.version === expected, 409, 'CONFLICT', 'Versão desatualizada');
  }

  async history(actor: Actor, id: string) {
    await this.access.platform(actor);
    const plan = await this.repo.read(this.ref(id), customPlanSchema);
    requireCondition(plan, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    return auditHistory(this.repo, id);
  }
}
