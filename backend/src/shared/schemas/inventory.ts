import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { pageQuery, pageOf } from './http.js';
import { productQuery, unit } from './commercial.js';
import { MAX_SCALED, movementTypes } from '../../modules/inventory/quantities.js';
export const quantityText = z
  .string()
  .max(18)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/);
export const signedQuantityText = z
  .string()
  .max(18)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,3})?$/);
const scaled = z.number().int().min(0).max(MAX_SCALED);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const stockSchema = z
  .strictObject({
    id: opaqueId,
    tenantId: opaqueId,
    name: z.string(),
    nameKey: z.string(),
    sku: z.string(),
    unit,
    status: z.enum(['active', 'inactive']),
    categoryId: opaqueId.nullable(),
    physicalScaled: scaled,
    reservedScaled: scaled,
    minimumScaled: scaled,
    belowMinimum: z.boolean(),
    shortfallScaled: scaled,
    version: z.number().int().min(0),
    movementCount: z.number().int().min(0),
    lastMovementId: opaqueId.nullable(),
    lastMovementHash: hash.nullable(),
    lastMovementAt: instant.nullable(),
    updatedAt: instant,
    schemaVersion: z.literal(1),
  })
  .refine(
    (v) =>
      v.reservedScaled <= v.physicalScaled &&
      v.shortfallScaled === Math.max(0, v.minimumScaled - (v.physicalScaled - v.reservedScaled)) &&
      v.belowMinimum === v.shortfallScaled > 0 &&
      (v.unit === 'KG' ||
        v.unit === 'L' ||
        [v.physicalScaled, v.reservedScaled, v.minimumScaled].every((q) => q % 1000 === 0)),
    'Estoque inconsistente',
  );
export const movementSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  productId: opaqueId,
  type: z.enum(movementTypes),
  unit,
  quantityScaled: scaled.positive(),
  previousPhysicalScaled: scaled,
  physicalScaled: scaled,
  previousReservedScaled: scaled,
  reservedScaled: scaled,
  sequence: z.number().int().positive(),
  origin: z.enum(['administrative', 'order']),
  originReference: z.string().uuid(),
  actorUid: opaqueId,
  reason: z.string().min(3).max(200),
  notes: z.string().max(1000).nullable(),
  occurredAt: instant,
  requestId: z.string().uuid(),
  operationId: hash,
  previousHash: hash.nullable(),
  hash,
  schemaVersion: z.literal(1),
});
export const entryInput = z.strictObject({
  productId: opaqueId,
  quantity: quantityText,
  reason: z.string().trim().min(3).max(200),
  notes: z.string().trim().max(1000).optional(),
});
export const adjustmentInput = z.strictObject({
  productId: opaqueId,
  delta: signedQuantityText,
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(3).max(200),
  notes: z.string().trim().max(1000).optional(),
});
export const inventoryParams = z.strictObject({ productId: opaqueId });
export const stockAdminView = z.object({
  productId: opaqueId,
  name: z.string(),
  sku: z.string(),
  unit,
  status: z.enum(['active', 'inactive']),
  physical: quantityText,
  reserved: quantityText,
  available: quantityText,
  minimumStock: quantityText,
  suggestedQuantity: quantityText,
  version: z.number().int().min(0),
  lastMovementAt: instant.nullable(),
});
export const availabilityView = z.object({
  productId: opaqueId,
  name: z.string(),
  sku: z.string(),
  unit,
  available: quantityText,
});
export const inventoryView = z.union([stockAdminView, availabilityView]);
export const inventoryPage = pageOf(inventoryView);
export const replenishmentPage = pageOf(stockAdminView);
export const movementView = movementSchema
  .omit({
    tenantId: true,
    quantityScaled: true,
    previousPhysicalScaled: true,
    physicalScaled: true,
    previousReservedScaled: true,
    reservedScaled: true,
    hash: true,
    previousHash: true,
    schemaVersion: true,
  })
  .extend({
    quantity: quantityText,
    previousPhysical: quantityText,
    physical: quantityText,
    previousReserved: quantityText,
    reserved: quantityText,
  })
  .strip();
export const movementPage = pageOf(movementView);
export const movementResult = z.object({ movement: movementView, stock: stockAdminView });
export const inventoryQuery = productQuery.omit({ catalogVisible: true });
export const replenishmentQuery = z.strictObject({
  ...pageQuery.shape,
  status: z.enum(['active', 'inactive', 'all']).optional(),
  categoryId: opaqueId.optional(),
  q: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(['name', 'shortfall']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
});
const filterInstant = instant
  .regex(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  .transform((value) => new Date(value).toISOString());
export const movementQuery = z.strictObject({
  ...pageQuery.shape,
  productId: opaqueId.optional(),
  type: z.enum(movementTypes).optional(),
  from: filterInstant.optional(),
  to: filterInstant.optional(),
  direction: z.enum(['asc', 'desc']).optional(),
});
export const reconciliationView = z.object({
  productId: opaqueId,
  stockVersion: z.number().int().min(0),
  checkedMovements: z.number().int().min(0),
  complete: z.boolean(),
  consistent: z.boolean(),
  physical: quantityText,
  reserved: quantityText,
  nextCursor: z.string().nullable(),
});
export type Stock = z.infer<typeof stockSchema>;
export type Movement = z.infer<typeof movementSchema>;
