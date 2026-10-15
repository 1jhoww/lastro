import { z } from 'zod';
import type { ExportRequest, ExportResource } from '@/features/files/api';
export type ExportFields = Record<
  | 'status'
  | 'q'
  | 'customerId'
  | 'orderId'
  | 'from'
  | 'to'
  | 'assignedTo'
  | 'categoryId'
  | 'sku'
  | 'catalogVisible'
  | 'direction'
  | 'sort'
  | 'limit',
  string
>;
export const exportDefaults: ExportFields = {
  status: '',
  q: '',
  customerId: '',
  orderId: '',
  from: '',
  to: '',
  assignedTo: '',
  categoryId: '',
  sku: '',
  catalogVisible: '',
  direction: 'asc',
  sort: 'name',
  limit: '10',
};
const id = z.string().trim().min(1).max(160).optional();
const catalogQuery = z.object({
  status: z.enum(['active', 'inactive', 'all']).optional(),
  q: z.string().trim().max(80).optional(),
  direction: z.enum(['asc', 'desc']),
  sort: z.enum(['name', 'createdAt']),
  limit: z.string().regex(/^(?:[1-9]|[1-9][0-9]|100)$/),
});
const orderQuery = z.object({
  status: z.enum(['draft', 'confirmed', 'dispatched', 'canceled']).optional(),
  customerId: id,
  direction: z.enum(['asc', 'desc']),
  limit: z.string().regex(/^(?:[1-9]|10)$/),
});
const titlesQuery = z
  .object({
    status: z.enum(['open', 'partially_paid', 'paid', 'canceled', 'zero']).optional(),
    customerId: id,
    orderId: id,
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    limit: z.string().regex(/^(?:[1-9]|10)$/),
  })
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    'Data inicial deve ser anterior ou igual à final.',
  );
export function buildExportRequest(resource: ExportResource, fields: ExportFields): ExportRequest {
  const f = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, value.trim() || undefined]),
  );
  if (resource === 'orders') return { resource, query: orderQuery.parse(f) };
  if (resource === 'receivables') return { resource, query: titlesQuery.parse(f) };
  if (f.q && (f.sort !== 'name' || f.direction !== 'asc'))
    throw new Error('Busca por nome exige ordem por nome crescente.');
  if (resource === 'customers')
    return { resource, query: catalogQuery.extend({ assignedTo: id }).parse(f) };
  return {
    resource,
    query: catalogQuery
      .extend({
        categoryId: id,
        sku: z.string().max(80).optional(),
        catalogVisible: z.enum(['true', 'false']).optional(),
      })
      .parse(f),
  };
}
export function nextExportPage(request: ExportRequest, cursor: string): ExportRequest {
  switch (request.resource) {
    case 'customers':
      return { resource: request.resource, query: { ...request.query, cursor } };
    case 'products':
      return { resource: request.resource, query: { ...request.query, cursor } };
    case 'orders':
      return { resource: request.resource, query: { ...request.query, cursor } };
    case 'receivables':
      return { resource: request.resource, query: { ...request.query, cursor } };
  }
}
