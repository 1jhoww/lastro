import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { OrderService } from './orderService.js';
import type { Actor, TenantContext } from '../../shared/types/context.js';
import { customerSchema } from '../../shared/schemas/commercial.js';
import { orderSchema } from '../../shared/schemas/orders.js';
import * as s from '../../shared/schemas/visits.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { digest } from '../../shared/utils/crypto.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { localDay } from '../visits/visitService.js';

/** Id of the automatic relationship record of an order's delivery. */
export const deliveryVisitId = (tenantId: string, orderId: string) =>
  digest(`visits:delivery:${tenantId}:${orderId}`);

/**
 * Effective delivery of a dispatched order. Dispatch (stock exit) never implies delivery: this
 * separate confirmation is the only event that creates the automatic relationship record. It
 * does not change the order, its stock, receivables or payments. Dispatch is always integral,
 * so an order has at most one delivery; confirming again with the same data replays it.
 */
export class DeliveryService {
  constructor(readonly orders: OrderService) {}
  private get repo() {
    return this.orders.repo;
  }

  /** Same visibility as the order itself in Pedidos. */
  private async visibleOrder(tx: Transaction, ctx: TenantContext, id: string) {
    const tenantId = ctx.tenant.id;
    const order = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'orders', id),
      orderSchema,
      tx,
    );
    requireCondition(
      order?.id === id && order.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    const customer = order.customerId
      ? await this.repo.foundation.read(
          this.repo.ref(tenantId, 'customers', order.customerId),
          customerSchema,
          tx,
        )
      : null;
    requireCondition(
      ctx.membership.role === 'administrator' ||
        (order.sellerUid === ctx.actor.uid &&
          customer?.tenantId === tenantId &&
          customer.assignedTo === ctx.actor.uid),
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return { order, customer };
  }

  private view(delivery: s.Delivery) {
    const { id: _id, tenantId: _tenant, schemaVersion: _version, ...fields } = delivery;
    return s.deliveryView.parse(fields);
  }

  async get(actor: Actor, tenantId: string, orderId: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.orders.access.tenant(actor, tenantId, 'orders:own:read', tx);
        await this.visibleOrder(tx, ctx, orderId);
        const delivery = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'deliveries', orderId),
          s.deliverySchema,
          tx,
        );
        requireCondition(
          !delivery || delivery.tenantId === tenantId,
          500,
          'INTERNAL_ERROR',
          'Erro interno do servidor',
        );
        return s.orderDeliveryView.parse({ delivery: delivery ? this.view(delivery) : null });
      },
      { readOnly: true },
    );
  }

  async confirm(
    actor: Actor,
    tenantId: string,
    orderId: string,
    input: z.infer<typeof s.deliveryInput>,
  ) {
    const now = this.orders.clock();
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const ctx = await this.orders.access.tenant(actor, tenantId, 'orders:own:deliver', tx);
      const { order, customer } = await this.visibleOrder(tx, ctx, orderId);
      const ref = this.repo.ref(tenantId, 'deliveries', orderId);
      const receivedBy = input.receivedBy ?? null;
      const notes = input.notes ?? '';
      const previous = await this.repo.foundation.read(ref, s.deliverySchema, tx);
      if (previous) {
        // Reprocessing the same confirmation is harmless; different data is a new decision.
        requireCondition(
          previous.tenantId === tenantId &&
            previous.deliveredOn === input.deliveredOn &&
            previous.receivedBy === receivedBy &&
            previous.notes === notes,
          409,
          'DELIVERY_ALREADY_CONFIRMED',
          'A entrega deste pedido já foi confirmada',
        );
        return this.view(previous);
      }
      requireCondition(
        order.status === 'dispatched' && order.dispatchedAt !== null && customer,
        409,
        'INVALID_ORDER_STATE',
        'A entrega só pode ser confirmada em pedido expedido',
      );
      const timezone = ctx.tenant.timezone;
      requireCondition(
        input.deliveredOn >= localDay(order.dispatchedAt, timezone) &&
          input.deliveredOn <= localDay(now, timezone),
        422,
        'INVALID_DELIVERY_DATE',
        'A data da entrega deve estar entre a expedição e hoje',
      );
      const confirmedAt = now.toISOString();
      const visitId = deliveryVisitId(tenantId, orderId);
      const delivery = s.deliverySchema.parse({
        id: orderId,
        tenantId,
        orderId,
        orderCommercialId: order.commercialId,
        customerId: customer.id,
        sellerUid: order.sellerUid,
        deliveredOn: input.deliveredOn,
        receivedBy,
        notes,
        confirmedAt,
        confirmedBy: actor.uid,
        visitId,
        schemaVersion: 1,
      });
      // Automatic record: a delivery, attributed to the order's seller, never an in-person visit.
      const visit = s.visitSchema.parse({
        id: visitId,
        tenantId,
        customerId: customer.id,
        customerName: customer.name,
        source: 'automatic',
        kind: 'delivery',
        visitDate: input.deliveredOn,
        responsibleUid: order.sellerUid,
        notes: [receivedBy ? `Recebido por ${receivedBy}.` : '', notes]
          .filter(Boolean)
          .join(' ')
          .slice(0, 1000),
        orderId,
        orderCommercialId: order.commercialId,
        createdAt: confirmedAt,
        createdBy: actor.uid,
        payloadHash: null,
        schemaVersion: 1,
      });
      tx.create(ref, delivery);
      tx.create(this.repo.ref(tenantId, 'visits', visitId), visit);
      recordAudit(
        this.repo.foundation,
        tx,
        actor,
        tenantId,
        'orders.delivered',
        orderId,
        confirmedAt,
        {
          deliveredOn: delivery.deliveredOn,
          visitId,
        },
      );
      return this.view(delivery);
    });
  }
}
