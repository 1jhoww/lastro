import type { Transaction } from 'firebase-admin/firestore';
import type { OrderStockPort, ValidatedOrderStockOperation } from './orderStockContract.js';
import type { InventoryService } from './inventoryService.js';
import { movementHash } from './inventoryService.js';
import { productSchema } from '../../shared/schemas/commercial.js';
import { orderSchema, stockReservationSchema } from '../../shared/schemas/orders.js';
import { movementSchema } from '../../shared/schemas/inventory.js';
import { parseQuantity, transition } from './quantities.js';
import { projectStock } from './stockProjection.js';
import { digest } from '../../shared/utils/crypto.js';
import { requireCondition } from '../../shared/errors/appError.js';
export const reservationIdFor = (
  tenantId: string,
  orderId: string,
  lineId: string,
  productId: string,
) => digest(`reservation:${tenantId}:${orderId}:${lineId}:${productId}`);
export class FirestoreOrderStockAdapter implements OrderStockPort {
  constructor(readonly inventory: InventoryService) {}
  async prepareReleaseBatch(tx: Transaction, op: ValidatedOrderStockOperation) {
    requireCondition(
      op.type === 'STOCK_RESERVATION_RELEASE',
      409,
      'INVALID_RESERVATION',
      'Liberação parcial inválida',
    );
    return this.prepare(tx, op, true);
  }
  async prepare(tx: Transaction, op: ValidatedOrderStockOperation, partialRelease = false) {
    const repo = this.inventory.repo,
      tenantId = op.context.tenant.id;
    const order = await repo.foundation.read(
      repo.ref(tenantId, 'orders', op.orderId),
      orderSchema,
      tx,
    );
    requireCondition(
      order &&
        order.tenantId === tenantId &&
        order.id === op.orderId &&
        order.version === op.orderVersion,
      409,
      'CONFLICT',
      'Pedido indisponível ou alterado',
    );
    const reserving = op.type === 'STOCK_RESERVATION';
    const linesById = new Map(order.lines.map((line) => [line.id, line]));
    requireCondition(
      (reserving ? order.status === 'draft' : order.status === 'confirmed') &&
        (partialRelease
          ? op.items.length > 0 && op.items.length <= order.lines.length
          : op.items.length === order.lines.length) &&
        new Set(op.items.map((i) => i.productId)).size === op.items.length,
      409,
      'INVALID_RESERVATION',
      'Operação de reserva inválida',
    );
    const staged = await Promise.all(
      op.items.map(async (item) => {
        const line = linesById.get(item.lineId);
        const id = reservationIdFor(tenantId, order.id, item.lineId, item.productId);
        requireCondition(
          line &&
            line.productId === item.productId &&
            item.reservationId === id &&
            item.quantityScaled === parseQuantity(line.quantity, line.unit),
          409,
          'INVALID_RESERVATION',
          'Reserva não corresponde ao pedido',
        );
        const ref = repo.ref(tenantId, 'stockReservations', id);
        const reservation = await repo.foundation.read(ref, stockReservationSchema, tx);
        requireCondition(
          reserving
            ? !reservation
            : reservation &&
                reservation.id === id &&
                reservation.tenantId === tenantId &&
                reservation.orderId === order.id &&
                reservation.lineId === line.id &&
                reservation.productId === line.productId &&
                reservation.quantityScaled === item.quantityScaled &&
                reservation.unit === line.unit &&
                reservation.status === 'reserved',
          409,
          'INVALID_RESERVATION',
          'Reserva indisponível ou de outro pedido',
        );
        const product = await repo.foundation.read(
          repo.ref(tenantId, 'products', item.productId),
          productSchema,
          tx,
        );
        requireCondition(
          product?.id === item.productId &&
            product.tenantId === tenantId &&
            product.unit === line.unit &&
            (!reserving || product.status === 'active'),
          409,
          'PRODUCT_UNAVAILABLE',
          'Produto indisponível ou unidade alterada',
        );
        const stock = await this.inventory.stockFor(product, tx);
        const balances = transition(
          stock.physicalScaled,
          stock.reservedScaled,
          op.type,
          item.quantityScaled,
        );
        const operationId = digest(`orders:${op.operationKey}`);
        const movementId = digest(`${operationId}:${id}`);
        const content = {
          id: movementId,
          tenantId,
          productId: product.id,
          type: op.type,
          unit: line.unit,
          quantityScaled: item.quantityScaled,
          previousPhysicalScaled: stock.physicalScaled,
          previousReservedScaled: stock.reservedScaled,
          ...balances,
          sequence: stock.movementCount + 1,
          origin: 'order' as const,
          originReference: order.id,
          actorUid: op.context.actor.uid,
          reason: op.type,
          notes: null,
          occurredAt: op.occurredAt,
          requestId: op.context.actor.requestId,
          operationId,
          previousHash: stock.lastMovementHash,
          schemaVersion: 1 as const,
        };
        const movement = movementSchema.parse({ ...content, hash: movementHash(content) });
        const next = projectStock(
          product,
          {
            ...stock,
            ...balances,
            version: stock.version + 1,
            movementCount: movement.sequence,
            lastMovementId: movementId,
            lastMovementHash: movement.hash,
            lastMovementAt: op.occurredAt,
          },
          op.occurredAt,
        );
        const nextReservation = stockReservationSchema.parse({
          id,
          tenantId,
          orderId: order.id,
          lineId: line.id,
          productId: line.productId,
          unit: line.unit,
          quantityScaled: item.quantityScaled,
          status: reserving ? 'reserved' : op.type === 'STOCK_DISPATCH' ? 'dispatched' : 'released',
          createdAt: reservation?.createdAt ?? op.occurredAt,
          updatedAt: op.occurredAt,
          operationId,
          schemaVersion: 1,
        });
        return () => {
          tx.set(repo.ref(tenantId, 'inventory', product.id), next);
          tx.create(repo.ref(tenantId, 'inventoryMovements', movementId), movement);
          if (reserving) tx.create(ref, nextReservation);
          else tx.set(ref, nextReservation);
        };
      }),
    );
    return { apply: () => staged.forEach((write) => write()) };
  }
}
