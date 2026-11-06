import type { Transaction } from 'firebase-admin/firestore';
import type { Product } from '../../shared/schemas/commercial.js';
import { productSchema } from '../../shared/schemas/commercial.js';
import { movementSchema, type Movement, type Stock } from '../../shared/schemas/inventory.js';
import { movementHash, type InventoryService } from './inventoryService.js';
import { transition, type MovementType } from './quantities.js';
import { projectStock } from './stockProjection.js';

export interface StagedMovement {
  id: string;
  type: MovementType;
  quantityScaled: number;
  origin: Movement['origin'];
  originReference: string;
  actorUid: string;
  reason: string;
  notes: string | null;
  occurredAt: string;
  requestId: string;
  operationId: string;
}

/**
 * Movements of one transaction, chained per product. A product sold and bonified in the same order
 * moves twice: each movement starts from the balance the previous one left, with its own sequence
 * and hash, and the aggregate is written once. Reading stock per line instead would lose the
 * first update and fork the movement chain.
 */
export class StockLedger {
  private readonly loaded = new Map<string, Promise<Product | null>>();
  private readonly balances = new Map<string, Stock>();
  private readonly touched = new Set<string>();
  private readonly movements: Movement[] = [];
  constructor(
    private readonly inventory: InventoryService,
    private readonly tx: Transaction,
    private readonly tenantId: string,
  ) {}
  /** Reads a product and its stock once, however many lines refer to it. */
  product(productId: string): Promise<Product | null> {
    let read = this.loaded.get(productId);
    if (!read) {
      read = (async () => {
        const repo = this.inventory.repo;
        const product = await repo.foundation.read(
          repo.ref(this.tenantId, 'products', productId),
          productSchema,
          this.tx,
        );
        if (product?.id === productId && product.tenantId === this.tenantId)
          this.balances.set(productId, await this.inventory.stockFor(product, this.tx));
        return product;
      })();
      this.loaded.set(productId, read);
    }
    return read;
  }
  /** Only computes. The caller stages lines in a stable order and writes through `apply`. */
  stage(product: Product, input: StagedMovement): Movement {
    const stock = this.balances.get(product.id)!;
    const balances = transition(
      stock.physicalScaled,
      stock.reservedScaled,
      input.type,
      input.quantityScaled,
    );
    const content = {
      ...input,
      tenantId: this.tenantId,
      productId: product.id,
      unit: product.unit,
      previousPhysicalScaled: stock.physicalScaled,
      previousReservedScaled: stock.reservedScaled,
      ...balances,
      sequence: stock.movementCount + 1,
      previousHash: stock.lastMovementHash,
      schemaVersion: 1 as const,
    };
    const movement = movementSchema.parse({ ...content, hash: movementHash(content) });
    this.balances.set(
      product.id,
      projectStock(
        product,
        {
          ...stock,
          ...balances,
          version: stock.version + 1,
          movementCount: movement.sequence,
          lastMovementId: movement.id,
          lastMovementHash: movement.hash,
          lastMovementAt: input.occurredAt,
        },
        input.occurredAt,
      ),
    );
    this.touched.add(product.id);
    this.movements.push(movement);
    return movement;
  }
  apply() {
    const repo = this.inventory.repo;
    for (const id of this.touched)
      this.tx.set(repo.ref(this.tenantId, 'inventory', id), this.balances.get(id)!);
    for (const movement of this.movements)
      this.tx.create(repo.ref(this.tenantId, 'inventoryMovements', movement.id), movement);
  }
}
