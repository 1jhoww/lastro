import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { pageQuery, pageOf } from './http.js';
import { validDocument, normalizeDocument } from '../../modules/customers/documents.js';

export const name = z.string().trim().min(2).max(160);
export const searchKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const text = (size: number) => z.string().trim().max(size);
export const document = z
  .string()
  .trim()
  .max(32)
  .refine(validDocument, 'CPF/CNPJ inválido')
  .transform(normalizeDocument);
export const sku = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .transform((v) => v.toUpperCase())
  .pipe(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Z0-9][A-Z0-9._-]*$/),
  );
const phone = z
  .string()
  .trim()
  .max(32)
  .regex(/^\+?[0-9()\s.-]+$/)
  .transform((v) => v.replace(/[()\s.-]/g, ''))
  .refine((v) => /^\+?\d{8,15}$/.test(v), 'Telefone inválido');
export const address = z.strictObject({
  street: text(160).optional(),
  number: text(20).optional(),
  complement: text(100).optional(),
  district: text(100).optional(),
  city: text(100).optional(),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/))
    .optional(),
  postalCode: z
    .string()
    .regex(/^\d{5}-?\d{3}$/)
    .transform((v) => v.replace('-', ''))
    .pipe(z.string().regex(/^\d{8}$/))
    .optional(),
  country: z.literal('BR').optional(),
});
export const customerFields = {
  name,
  tradeName: text(160).nullable().optional(),
  document: document.nullable().optional(),
  email: z
    .email()
    .trim()
    .max(254)
    .transform((v) => v.toLowerCase())
    .nullable()
    .optional(),
  phone: phone.nullable().optional(),
  address: address.nullable().optional(),
  notes: text(2000).nullable().optional(),
};
export const status = z.enum(['active', 'inactive']);
export const expectedVersion = z.number().int().positive();
export const versionInput = z.strictObject({ expectedVersion });
export const customerCreate = z.strictObject({
  ...customerFields,
  assignedTo: opaqueId.nullable().optional(),
});
export const customerUpdate = z.strictObject({
  ...customerFields,
  name: name.optional(),
  status: status.optional(),
  expectedVersion,
});
export const assignmentInput = z.strictObject({ assignedTo: opaqueId.nullable(), expectedVersion });
const metadata = {
  id: opaqueId,
  version: expectedVersion,
  createdAt: instant,
  updatedAt: instant,
  createdBy: opaqueId,
  updatedBy: opaqueId,
};
export const customerView = z.object({
  ...customerFields,
  tradeName: text(160).nullable(),
  document: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: address.nullable(),
  notes: text(2000).nullable(),
  assignedTo: opaqueId.nullable(),
  status,
  ...metadata,
});
export const customerSchema = customerView
  .extend({ tenantId: opaqueId, nameKey: z.string(), schemaVersion: z.literal(1) })
  .strict();
export const categoryCreate = z.strictObject({ name, description: text(1000).optional() });
export const categoryUpdate = z.strictObject({
  name: name.optional(),
  description: text(1000).optional(),
  status: status.optional(),
  expectedVersion,
});
export const categoryView = z.object({ name, description: text(1000), status, ...metadata });
export const categorySchema = categoryView
  .extend({ tenantId: opaqueId, nameKey: z.string(), schemaVersion: z.literal(1) })
  .strict();
export const unit = z.enum(['UN', 'CX', 'PCT', 'KG', 'L']);
export const quantityPrecision = (value: z.infer<typeof unit>) =>
  value === 'KG' || value === 'L' ? 3 : 0;
export const priceCents = z.number().int().min(0).max(100_000_000);
export const productCreate = z.strictObject({
  name,
  description: text(2000).optional(),
  sku,
  categoryId: opaqueId.nullable().optional(),
  unit,
  priceCents,
  catalogVisible: z.boolean().optional(),
  minimumStock: z
    .string()
    .max(18)
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/)
    .optional(),
});
export const productUpdate = productCreate
  .partial()
  .extend({ status: status.optional(), expectedVersion })
  .strict();
export const imageView = z.object({
  id: opaqueId,
  contentType: z.literal('image/webp'),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const productView = z.object({
  name,
  description: text(2000),
  sku: z.string(),
  categoryId: opaqueId.nullable(),
  unit,
  quantityPrecision: z.number().int().min(0).max(3),
  priceCents,
  catalogVisible: z.boolean(),
  minimumStock: z
    .string()
    .max(18)
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/)
    .default('0'),
  image: imageView.nullable(),
  status,
  ...metadata,
});
export const productSchema = productView
  .extend({ tenantId: opaqueId, nameKey: z.string(), schemaVersion: z.literal(1) })
  .strict();
export const reservationSchema = z.strictObject({
  resourceId: opaqueId,
  schemaVersion: z.literal(1),
});
const listShape = {
  ...pageQuery.shape,
  status: z.enum(['active', 'inactive', 'all']).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(['name', 'createdAt']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
};
export const customerQuery = z.strictObject({
  ...listShape,
  assignedTo: z.union([opaqueId, z.literal('unassigned')]).optional(),
});
export const productQuery = z.strictObject({
  ...listShape,
  categoryId: opaqueId.optional(),
  sku: sku.optional(),
  catalogVisible: z.enum(['true', 'false']).optional(),
});
export const categoryQuery = z.strictObject(listShape);
export const imageQuery = z.strictObject({
  expectedVersion: z.string().regex(/^[1-9][0-9]{0,8}$/),
});
export const customersPage = pageOf(customerView);
export const productsPage = pageOf(productView);
export const categoriesPage = pageOf(categoryView);
export type Customer = z.infer<typeof customerSchema>;
export type Product = z.infer<typeof productSchema>;
export type Category = z.infer<typeof categorySchema>;
export type CommercialQuery = z.infer<typeof customerQuery> & z.infer<typeof productQuery>;
