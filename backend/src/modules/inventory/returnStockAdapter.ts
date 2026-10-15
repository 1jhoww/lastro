import type { Transaction } from 'firebase-admin/firestore';
import type { Book } from '../finance/financialBook.js';
import type { InventoryService } from './inventoryService.js';
import { movementHash } from './inventoryService.js';
import { productSchema } from '../../shared/schemas/commercial.js';
import { stockReservationSchema } from '../../shared/schemas/orders.js';
import { movementSchema } from '../../shared/schemas/inventory.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { reservationIdFor } from './orderStockAdapter.js';
import { parseQuantity, transition } from './quantities.js';
import { projectStock } from './stockProjection.js';
import { digest } from '../../shared/utils/crypto.js';
import type { Actor } from '../../shared/types/context.js';
export class ReturnStockAdapter {
  constructor(readonly inventory: InventoryService) {}
  async prepare(
    tx: Transaction,
    book: Book,
    items: { lineId: string; quantityScaled: number }[],
    actor: Actor,
    returnId: string,
    op: string,
    now: string,
  ) {
    const repo = this.inventory.repo,
      order = book.order,
      lines = new Map(order.lines.map((l) => [l.id, l]));
    requireCondition(
      order.status === 'dispatched' &&
        order.dispatchReference &&
        new Set(items.map((i) => i.lineId)).size === items.length,
      409,
      'RETURN_SOURCE_INVALID',
      'Expedição original inválida',
    );
    const writes = await Promise.all(
      items.map(async (item) => {
        const line = lines.get(item.lineId);
        requireCondition(
          line &&
            item.quantityScaled > 0 &&
            item.quantityScaled <= parseQuantity(line.quantity, line.unit),
          409,
          'RETURN_LIMIT',
          'Retorno excede expedição original',
        );
        const id = reservationIdFor(order.tenantId, order.id, line.id, line.productId),
          reservation = await repo.foundation.read(
            repo.ref(order.tenantId, 'stockReservations', id),
            stockReservationSchema,
            tx,
          );
        requireCondition(
          reservation?.tenantId === order.tenantId &&
            reservation.orderId === order.id &&
            reservation.lineId === line.id &&
            reservation.productId === line.productId &&
            reservation.unit === line.unit &&
            reservation.quantityScaled === parseQuantity(line.quantity, line.unit) &&
            reservation.status === 'dispatched',
          409,
          'RETURN_SOURCE_INVALID',
          'Reserva consumida não corresponde à expedição',
        );
        const product = await repo.foundation.read(
          repo.ref(order.tenantId, 'products', line.productId),
          productSchema,
          tx,
        );
        requireCondition(
          product?.id === line.productId &&
            product.tenantId === order.tenantId &&
            product.unit === line.unit,
          409,
          'PRODUCT_UNAVAILABLE',
          'Produto/unidade do retorno incompatível',
        );
        const stock = await this.inventory.stockFor(product, tx),
          balances = transition(
            stock.physicalScaled,
            stock.reservedScaled,
            'STOCK_RETURN',
            item.quantityScaled,
          ),
          movementId = digest(`return-movement:${op}:${line.id}`);
        const content = {
          id: movementId,
          tenantId: order.tenantId,
          productId: line.productId,
          type: 'STOCK_RETURN' as const,
          unit: line.unit,
          quantityScaled: item.quantityScaled,
          previousPhysicalScaled: stock.physicalScaled,
          previousReservedScaled: stock.reservedScaled,
          ...balances,
          sequence: stock.movementCount + 1,
          origin: 'order' as const,
          originReference: order.id,
          actorUid: actor.uid,
          reason: 'Recebimento físico de devolução',
          notes: `return:${returnId};dispatch:${order.dispatchReference};receipt:${op}`,
          occurredAt: now,
          requestId: actor.requestId,
          operationId: op,
          previousHash: stock.lastMovementHash,
          schemaVersion: 1 as const,
        };
        const movement = movementSchema.parse({ ...content, hash: movementHash(content) }),
          next = projectStock(
            product,
            {
              ...stock,
              ...balances,
              version: stock.version + 1,
              movementCount: movement.sequence,
              lastMovementId: movementId,
              lastMovementHash: movement.hash,
              lastMovementAt: now,
            },
            now,
          );
        return {
          lineId: line.id,
          movementId,
          apply: () => {
            tx.set(repo.ref(order.tenantId, 'inventory', product.id), next);
            tx.create(repo.ref(order.tenantId, 'inventoryMovements', movementId), movement);
          },
        };
      }),
    );
    return {
      movementIds: new Map(writes.map((w) => [w.lineId, w.movementId])),
      apply: () => writes.forEach((w) => w.apply()),
    };
  }
}
