import { z } from 'zod';
import type { Transaction } from 'firebase-admin/firestore';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import type { Order } from '../../shared/schemas/orders.js';
import { cents, calendarDate } from '../../shared/schemas/orders.js';
import { opaqueId, instant } from '../../shared/schemas/models.js';
import { requireCondition } from '../../shared/errors/appError.js';
export const receivableSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  orderId: opaqueId,
  installmentId: opaqueId,
  installmentNumber: z.number().int().min(1).max(12),
  originalCents: cents,
  outstandingCents: cents,
  receivedCents: cents,
  dueDate: calendarDate,
  status: z.enum(['open', 'canceled', 'partially_paid', 'paid']),
  createdAt: instant,
  updatedAt: instant,
  origin: z.literal('order_confirmation'),
  originReference: opaqueId,
  schemaVersion: z.literal(1),
});
export const financialGuardSchema = z.strictObject({
  tenantId: opaqueId,
  orderId: opaqueId,
  receivedCents: z.number().int().nonnegative(),
  paymentCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  schemaVersion: z.literal(1),
});
// Phase E must atomically update this guard with every receipt/credit/payment.
export interface OrderReceivablesPort {
  prepare(
    tx: Transaction,
    order: Order,
    action: 'confirm' | 'cancel',
    now: string,
  ): Promise<{ apply(): void }>;
}
export class InitialOrderReceivables implements OrderReceivablesPort {
  constructor(readonly repo: CommercialRepository) {}
  async prepare(tx: Transaction, order: Order, action: 'confirm' | 'cancel', now: string) {
    const guardRef = this.repo.ref(order.tenantId, 'orderFinancialGuards', order.id);
    const guard = await this.repo.foundation.read(guardRef, financialGuardSchema, tx);
    const payments = await tx.get(
      this.repo
        .ref(order.tenantId, 'payments', 'placeholder')
        .parent.where('orderId', '==', order.id)
        .limit(1),
    );
    requireCondition(
      payments.empty && (!guard || (guard.receivedCents === 0 && guard.paymentCount === 0)),
      409,
      'FINANCIAL_CANCELLATION_REQUIRED',
      'Pedido possui registros financeiros; exige fluxo financeiro administrativo',
    );
    requireCondition(
      action === 'confirm'
        ? !guard
        : guard && guard.tenantId === order.tenantId && guard.orderId === order.id,
      409,
      'RECEIVABLE_INTEGRITY',
      'Controle financeiro inconsistente',
    );
    const writes = await Promise.all(
      order.installments.map(async (p) => {
        const ref = this.repo.ref(order.tenantId, 'receivables', p.id);
        const existing = await this.repo.foundation.read(ref, receivableSchema, tx);
        requireCondition(
          action === 'confirm'
            ? !existing
            : existing &&
                existing.id === p.id &&
                existing.tenantId === order.tenantId &&
                existing.orderId === order.id &&
                existing.installmentId === p.id &&
                existing.installmentNumber === p.number &&
                existing.originalCents === p.amountCents &&
                existing.outstandingCents === p.amountCents &&
                existing.receivedCents === 0 &&
                existing.status === 'open' &&
                existing.dueDate === p.dueDate &&
                existing.originReference === order.id,
          409,
          'FINANCIAL_CANCELLATION_REQUIRED',
          'Recebíveis exigem verificação financeira administrativa',
        );
        const next =
          action === 'confirm'
            ? receivableSchema.parse({
                id: p.id,
                tenantId: order.tenantId,
                orderId: order.id,
                installmentId: p.id,
                installmentNumber: p.number,
                originalCents: p.amountCents,
                outstandingCents: p.amountCents,
                receivedCents: 0,
                dueDate: p.dueDate,
                status: 'open',
                createdAt: now,
                updatedAt: now,
                origin: 'order_confirmation',
                originReference: order.id,
                schemaVersion: 1,
              })
            : receivableSchema.parse({
                ...existing,
                status: 'canceled',
                outstandingCents: 0,
                updatedAt: now,
              });
        return () => {
          if (action === 'confirm') tx.create(ref, next);
          else tx.set(ref, next);
        };
      }),
    );
    return {
      apply: () => {
        writes.forEach((w) => w());
        if (action === 'confirm')
          tx.create(guardRef, {
            tenantId: order.tenantId,
            orderId: order.id,
            receivedCents: 0,
            paymentCount: 0,
            version: 1,
            schemaVersion: 1,
          });
        else tx.set(guardRef, { ...guard, version: guard!.version + 1 });
      },
    };
  }
}
