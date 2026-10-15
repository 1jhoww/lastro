import type { Product } from '../../shared/schemas/commercial.js';
import { stockSchema, type Stock } from '../../shared/schemas/inventory.js';
import { parseQuantity } from './quantities.js';
export function projectStock(
  product: Product,
  previous: Stock | null,
  updatedAt = product.updatedAt,
): Stock {
  const physicalScaled = previous?.physicalScaled ?? 0;
  const reservedScaled = previous?.reservedScaled ?? 0;
  const minimumScaled = parseQuantity(product.minimumStock, product.unit);
  const shortfallScaled = Math.max(0, minimumScaled - (physicalScaled - reservedScaled));
  return stockSchema.parse({
    id: product.id,
    tenantId: product.tenantId,
    name: product.name,
    nameKey: product.nameKey,
    sku: product.sku,
    unit: product.unit,
    status: product.status,
    categoryId: product.categoryId,
    physicalScaled,
    reservedScaled,
    minimumScaled,
    shortfallScaled,
    belowMinimum: shortfallScaled > 0,
    version: previous?.version ?? 0,
    movementCount: previous?.movementCount ?? 0,
    lastMovementId: previous?.lastMovementId ?? null,
    lastMovementHash: previous?.lastMovementHash ?? null,
    lastMovementAt: previous?.lastMovementAt ?? null,
    updatedAt,
    schemaVersion: 1,
  });
}
