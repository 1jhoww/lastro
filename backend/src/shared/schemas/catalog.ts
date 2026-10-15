import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { expectedVersion, unit, priceCents } from './commercial.js';
import { quantityText } from './inventory.js';
import { pageOf } from './http.js';

const text = (size: number) =>
  z
    .string()
    .trim()
    .max(size)
    .refine(
      (v) => !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(v),
      'Texto público contém caracteres de controle',
    );
export const catalogSlug = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export const catalogFields = {
  slug: catalogSlug,
  enabled: z.boolean(),
  tradeName: text(160).min(2),
  description: text(1000),
  whatsappNumber: z.string().regex(/^[1-9][0-9]{7,14}$/),
  showPrices: z.boolean(),
};
export const catalogConfigure = z.strictObject({
  ...catalogFields,
  expectedVersion: z.number().int().nonnegative().safe(),
});
export const catalogAdminView = z.object({
  ...catalogFields,
  version: expectedVersion,
  createdAt: instant,
  updatedAt: instant,
  createdBy: opaqueId,
  updatedBy: opaqueId,
});
export const catalogSettingsSchema = catalogAdminView
  .extend({ tenantId: opaqueId, schemaVersion: z.literal(1) })
  .strict();
export const catalogAdminResult = z.object({ catalog: catalogAdminView.nullable() });
export const catalogSlugSchema = z.strictObject({
  tenantId: opaqueId,
  slug: catalogSlug,
  schemaVersion: z.literal(1),
});
export const catalogOperationSchema = z.strictObject({
  actorUid: opaqueId,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: catalogAdminView,
  createdAt: instant,
  schemaVersion: z.literal(1),
});
export const catalogPublicView = z.object({
  slug: catalogSlug,
  tradeName: z.string(),
  description: z.string(),
  whatsappNumber: catalogFields.whatsappNumber,
  showPrices: z.boolean(),
});
export const publicCategoryView = z.object({ id: opaqueId, name: z.string() });
export const publicProductView = z.object({
  id: opaqueId,
  name: z.string(),
  description: z.string(),
  unit,
  quantityPrecision: z.number().int().min(0).max(3),
  category: publicCategoryView.nullable(),
  unitPriceCents: priceCents.nullable(),
  imagePath: z.string().nullable(),
});
export const catalogParams = z.strictObject({ slug: catalogSlug });
export const catalogProductParams = catalogParams.extend({ id: opaqueId });
export const publicPageQuery = z.strictObject({
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-4][0-9]|50)$/)
    .optional(),
  cursor: z.string().max(1024).optional(),
  q: z.string().trim().min(1).max(80).optional(),
});
export const catalogProductsQuery = publicPageQuery.extend({ categoryId: opaqueId.optional() });
export const publicProductsPage = pageOf(publicProductView),
  publicCategoriesPage = pageOf(publicCategoryView);
export const quoteInput = z.strictObject({
  lines: z
    .array(z.strictObject({ productId: opaqueId, quantity: quantityText }))
    .min(1)
    .max(200)
    .refine((v) => new Set(v.map((l) => l.productId)).size === v.length, 'Produto repetido'),
});
export const quoteLineView = z.object({
  productId: opaqueId,
  name: z.string(),
  unit,
  quantity: quantityText,
  unitPriceCents: priceCents.nullable(),
  subtotalCents: priceCents.nullable(),
});
export const quoteSummary = z.object({
  catalog: catalogPublicView,
  lines: z.array(quoteLineView),
  currency: z.literal('BRL'),
  totalEstimatedCents: priceCents.nullable(),
  kind: z.literal('quote_request'),
  confirmedOrder: z.literal(false),
});
export const quotePreviewView = quoteSummary.extend({
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
});
export const whatsappInput = quoteInput.extend({ reviewToken: z.string().regex(/^[a-f0-9]{64}$/) });
export const whatsappView = quotePreviewView.extend({
  message: z.string().max(12000),
  whatsappUrl: z.url().max(16000),
});
export type CatalogSettings = z.infer<typeof catalogSettingsSchema>;
