import { randomUUID } from 'node:crypto';
import { FieldPath, type Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import type { AccessService } from '../auth/accessService.js';
import * as s from '../../shared/schemas/management.js';
import { productSchema } from '../../shared/schemas/commercial.js';
import type { pageQuery } from '../../shared/schemas/http.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
import { requirePermission } from '../users/permissions.js';
import { formatQuantity } from '../inventory/quantities.js';
import { cursorPage } from '../../shared/operations/cursorPage.js';
import { grossMargin, milliToCents } from './calculation.js';

const cents = (milli: number | null | undefined) =>
  milli === null || milli === undefined ? null : milliToCents(milli);

export function costView(
  product: { id: string; priceCents: number },
  cost: s.ProductCost | null,
): z.infer<typeof s.productCostView> {
  const average = cents(cost?.averageCostMilli);
  const reference = cost?.referenceCostCents ?? null;
  const basis = average !== null ? 'average' : reference !== null ? 'reference' : null;
  return s.productCostView.parse({
    productId: product.id,
    priceCents: product.priceCents,
    referenceCostCents: reference,
    averageCostCents: average,
    lastPurchaseCostCents: cents(cost?.lastPurchaseCostMilli),
    costBasis: basis,
    ...grossMargin(product.priceCents, average ?? reference),
    version: cost?.version ?? 0,
    updatedAt: cost?.updatedAt ?? null,
  });
}
const eventView = (e: z.infer<typeof s.productCostEventSchema>) =>
  s.productCostEventView.parse({
    ...e,
    referenceCostCents: e.next.referenceCostCents,
    averageCostCents: cents(e.next.averageCostMilli),
    lastPurchaseCostCents: cents(e.next.lastPurchaseCostMilli),
    previousAverageCostCents: cents(e.previous.averageCostMilli),
    quantity: e.quantityScaled === null ? null : formatQuantity(e.quantityScaled),
    unitCostCents: cents(e.unitCostMilli),
  });

/** Reference cost (manual) and cost history. Costs never live on the product document. */
export class CostService {
  constructor(
    readonly repo: CommercialRepository,
    readonly access: AccessService,
    readonly clock: () => Date,
  ) {}
  private async product(tx: Transaction, tenantId: string, id: string) {
    const product = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'products', id),
      productSchema,
      tx,
    );
    requireCondition(
      product?.id === id && product.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return product;
  }
  cost(tx: Transaction, tenantId: string, id: string) {
    return this.repo.foundation.read(
      this.repo.ref(tenantId, 'productCosts', id),
      s.productCostSchema,
      tx,
    );
  }
  async get(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.access.tenant(actor, tenantId, 'costs:read', tx);
        const product = await this.product(tx, tenantId, id);
        return costView(product, await this.cost(tx, tenantId, id));
      },
      { readOnly: true },
    );
  }
  async suggestion(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.access.tenant(actor, tenantId, 'purchases:create', tx);
        await this.product(tx, tenantId, id);
        return {
          productId: id,
          suggestedUnitCostCents: suggestedCost(await this.cost(tx, tenantId, id)),
        };
      },
      { readOnly: true },
    );
  }
  async updateReference(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.productCostUpdate>,
  ) {
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'costs:read', tx);
      requirePermission(ctx.membership, ctx.entitlements, 'products:manage');
      const product = await this.product(tx, tenantId, id);
      const previous = await this.cost(tx, tenantId, id);
      requireCondition(
        (previous?.version ?? 0) === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      const now = this.clock().toISOString();
      const next = s.productCostSchema.parse({
        id,
        tenantId,
        averageCostMilli: null,
        lastPurchaseCostMilli: null,
        lastReceiptId: null,
        ...previous,
        referenceCostCents: input.referenceCostCents,
        version: (previous?.version ?? 0) + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        schemaVersion: 1,
      });
      tx.set(this.repo.ref(tenantId, 'productCosts', id), next);
      const eventId = randomUUID();
      tx.create(
        this.repo.ref(tenantId, 'productCostEvents', eventId),
        costEvent({
          id: eventId,
          tenantId,
          productId: id,
          type: 'reference_updated',
          previous,
          next,
          reason: input.reason ?? null,
          actor,
          occurredAt: now,
        }),
      );
      recordAudit(this.repo.foundation, tx, actor, tenantId, 'product.cost.updated', id, now, {
        previousReferenceCostCents: previous?.referenceCostCents ?? null,
        referenceCostCents: next.referenceCostCents,
      });
      return costView(product, next);
    });
  }
  async history(actor: Actor, tenantId: string, id: string, input: z.infer<typeof pageQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.access.tenant(actor, tenantId, 'costs:read', tx);
        await this.product(tx, tenantId, id);
        const collection = this.repo.ref(tenantId, 'productCostEvents', 'placeholder').parent;
        const page = await cursorPage({
          repo: this.repo,
          tx,
          tenantId,
          collection: 'productCostEvents',
          scope: digest(stableJson({ actor: actor.uid, tenantId, id, limit: input.limit })),
          query: collection
            .where('productId', '==', id)
            .orderBy('occurredAt', 'desc')
            .orderBy(FieldPath.documentId(), 'desc'),
          input,
          schema: s.productCostEventSchema,
        });
        return { items: page.items.map(eventView), nextCursor: page.nextCursor };
      },
      { readOnly: true },
    );
  }
}

/** Purchase suggestion: the reference cost and, without one, the last cost received. */
export function suggestedCost(cost: s.ProductCost | null) {
  return cost?.referenceCostCents ?? cents(cost?.lastPurchaseCostMilli);
}

const position = (cost: s.ProductCost | null) => ({
  referenceCostCents: cost?.referenceCostCents ?? null,
  averageCostMilli: cost?.averageCostMilli ?? null,
  lastPurchaseCostMilli: cost?.lastPurchaseCostMilli ?? null,
});
export function costEvent(input: {
  id: string;
  tenantId: string;
  productId: string;
  type: z.infer<typeof s.costEventType>;
  previous: s.ProductCost | null;
  next: s.ProductCost;
  quantityScaled?: number;
  valueCents?: number;
  unitCostMilli?: number;
  purchaseId?: string;
  receiptId?: string;
  reason?: string | null;
  actor: Actor;
  occurredAt: string;
}) {
  return s.productCostEventSchema.parse({
    id: input.id,
    tenantId: input.tenantId,
    productId: input.productId,
    type: input.type,
    previous: position(input.previous),
    next: position(input.next),
    quantityScaled: input.quantityScaled ?? null,
    valueCents: input.valueCents ?? null,
    unitCostMilli: input.unitCostMilli ?? null,
    purchaseId: input.purchaseId ?? null,
    receiptId: input.receiptId ?? null,
    reason: input.reason ?? null,
    actorUid: input.actor.uid,
    occurredAt: input.occurredAt,
    requestId: input.actor.requestId,
    schemaVersion: 1,
  });
}
