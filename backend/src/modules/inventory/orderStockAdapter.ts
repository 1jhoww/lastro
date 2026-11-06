import type { Transaction } from 'firebase-admin/firestore';
import type { OrderStockPort, ValidatedOrderStockOperation } from './orderStockContract.js';
import type { InventoryService } from './inventoryService.js';
import { orderSchema, stockReservationSchema } from '../../shared/schemas/orders.js';
import { parseQuantity } from './quantities.js';
import { digest } from '../../shared/utils/crypto.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { readOrderBonus } from '../bonuses/orderBonus.js';
import { StockLedger } from './stockLedger.js';
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
  /**
   * Stock effect of an order transition. The bonus of the order moves with it: callers list only
   * the sold lines and this adapter adds the bonus lines, so no path can dispatch or release an
   * order without its bonus. Partial batches come from a plan that already lists both.
   */
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
    const bonus = await readOrderBonus(repo, tx, tenantId, order.id);
    const linesById = new Map(order.lines.map((line) => [line.id, line]));
    const bonusById = new Map(bonus?.lines.map((line) => [line.id, line]));
    const total = order.lines.length + bonusById.size;
    requireCondition(
      (reserving ? order.status === 'draft' : order.status === 'confirmed') &&
        (!bonus || bonus.status === (reserving ? 'draft' : 'confirmed')) &&
        (partialRelease
          ? op.items.length > 0 && op.items.length <= total
          : op.items.length === order.lines.length &&
            new Set(op.items.map((i) => i.productId)).size === op.items.length) &&
        new Set(op.items.map((i) => i.lineId)).size === op.items.length,
      409,
      'INVALID_RESERVATION',
      'Operação de reserva inválida',
    );
    const items = partialRelease
      ? op.items
      : [
          ...op.items,
          ...(bonus?.lines ?? []).map((line) => ({
            lineId: line.id,
            productId: line.productId,
            quantityScaled: parseQuantity(line.quantity, line.unit),
            reservationId: reservationIdFor(tenantId, order.id, line.id, line.productId),
          })),
        ];
    const ledger = new StockLedger(this.inventory, tx, tenantId);
    const loaded = await Promise.all(
      items.map(async (item) => {
        const line = linesById.get(item.lineId) ?? bonusById.get(item.lineId);
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
        const product = await ledger.product(item.productId);
        requireCondition(
          product?.id === item.productId &&
            product.tenantId === tenantId &&
            product.unit === line.unit &&
            (!reserving || product.status === 'active'),
          409,
          'PRODUCT_UNAVAILABLE',
          'Produto indisponível ou unidade alterada',
        );
        return { item, line, id, ref, reservation, product };
      }),
    );
    const operationId = digest(`orders:${op.operationKey}`);
    const writes = loaded.map(({ item, line, id, ref, reservation, product }) => {
      const bonified = bonusById.has(item.lineId);
      ledger.stage(product, {
        id: digest(`${operationId}:${id}`),
        type: op.type,
        quantityScaled: item.quantityScaled,
        origin: bonified ? 'bonus' : 'order',
        originReference: order.id,
        actorUid: op.context.actor.uid,
        reason: bonified ? 'Bonificação vinculada ao pedido' : op.type,
        notes: null,
        occurredAt: op.occurredAt,
        requestId: op.context.actor.requestId,
        operationId,
      });
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
        if (reserving) tx.create(ref, nextReservation);
        else tx.set(ref, nextReservation);
      };
    });
    return {
      apply: () => {
        ledger.apply();
        writes.forEach((write) => write());
      },
    };
  }
}
