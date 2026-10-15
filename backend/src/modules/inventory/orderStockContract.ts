import type { Transaction } from 'firebase-admin/firestore';
import type { TenantContext } from '../../shared/types/context.js';
import type { MovementType } from './quantities.js';
// Internal contract: callers validate the real order/permissions in the same tx.
// The adapter independently binds every reservation to persisted order lines.
export interface ValidatedOrderStockOperation {
  context: TenantContext;
  orderId: string;
  orderVersion: number;
  operationKey: string;
  occurredAt: string;
  type: Extract<MovementType, 'STOCK_RESERVATION' | 'STOCK_RESERVATION_RELEASE' | 'STOCK_DISPATCH'>;
  items: readonly {
    lineId: string;
    productId: string;
    quantityScaled: number;
    reservationId: string;
  }[];
}
export interface OrderStockPort {
  // Read stock, real order, per-order reservation, idempotency and permissions before
  // staging any writes. apply() writes only within tx; caller also writes order/audit.
  prepare(tx: Transaction, operation: ValidatedOrderStockOperation): Promise<{ apply(): void }>;
  prepareReleaseBatch(
    tx: Transaction,
    operation: ValidatedOrderStockOperation,
  ): Promise<{ apply(): void }>;
}
