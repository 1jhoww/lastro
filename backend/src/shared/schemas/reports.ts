import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { calendarDate } from './orders.js';

export const reportIds = [
  'sales-period',
  'orders-status',
  'sales-customers',
  'sales-products',
  'sales-sellers',
  'receivables',
  'overdue',
  'upcoming',
  'receipts',
  'delinquency',
  'stock-position',
  'stock-low',
  'stock-empty',
  'stock-movements',
] as const;
export type ReportId = (typeof reportIds)[number];
export const reportId = z.enum(reportIds);
export const reportParams = z.strictObject({ report: reportId });

export const reportStatuses = [
  'draft',
  'confirmed',
  'dispatched',
  'canceled',
  'open',
  'partially_paid',
  'paid',
  'active',
  'inactive',
  'all',
] as const;
export const movementGroups = ['entries', 'exits', 'adjustments', 'reservations'] as const;
export const reportQuery = z
  .strictObject({
    from: calendarDate.optional().describe('Início do período (AAAA-MM-DD, fuso da empresa).'),
    to: calendarDate.optional().describe('Fim do período, inclusivo.'),
    status: z.enum(reportStatuses).optional(),
    customerId: opaqueId.optional(),
    productId: opaqueId.optional(),
    sellerUid: opaqueId.optional(),
    movement: z.enum(movementGroups).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Período inválido');
export type ReportQuery = z.infer<typeof reportQuery>;

export const reportValueKind = z.enum([
  'text',
  'money',
  'count',
  'quantity',
  'date',
  'datetime',
  'percent',
]);
export type ReportValueKind = z.infer<typeof reportValueKind>;
export const reportView = z.object({
  report: reportId,
  category: z.enum(['commercial', 'financial', 'inventory']),
  title: z.string(),
  description: z.string(),
  company: z.string(),
  timezone: z.string(),
  generatedAt: instant,
  period: z
    .object({ from: calendarDate, to: calendarDate, basis: z.string() })
    .nullable()
    .describe('Período consultado e a data usada como referência (confirmação, vencimento...).'),
  filters: z.array(z.object({ label: z.string(), value: z.string() })),
  summary: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      kind: reportValueKind,
      value: z.number().describe('Dinheiro em centavos; percentual com uma casa decimal.'),
      tone: z.enum(['default', 'danger', 'warning', 'success']),
      caption: z.string().nullable(),
    }),
  ),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      kind: reportValueKind,
      align: z.enum(['left', 'right']),
    }),
  ),
  rows: z.array(
    z.object({
      cells: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
      link: z
        .object({ kind: z.enum(['order', 'customer', 'product', 'title']), id: opaqueId })
        .nullable(),
    }),
  ),
  chart: z
    .object({
      label: z.string(),
      kind: reportValueKind,
      points: z.array(z.object({ label: z.string(), value: z.number() })),
    })
    .nullable()
    .describe(
      'Série completa para gráfico de barras (inclui dias sem movimento); null quando um gráfico não ajuda.',
    ),
  notes: z.array(z.string()),
});
export type ReportView = z.infer<typeof reportView>;
