import { z } from 'zod';
import { opaqueId, instant } from './models.js';
import { expectedVersion } from './commercial.js';
import { pageQuery, pageOf } from './http.js';

export const schedule = z
  .array(
    z.strictObject({
      offsetDays: z.number().int().nonnegative().safe(),
      weight: z.number().int().positive().safe().default(1),
    }),
  )
  .min(1)
  .max(12)
  .refine(
    (v) => v.every((p, i) => !i || p.offsetDays >= v[i - 1]!.offsetDays),
    'Prazos devem estar ordenados',
  );
export const preset = z.enum(['cash', 'net30', '30_60', '30_60_90']);
export const methodKind = z.enum(['pix', 'cash', 'transfer', 'card', 'boleto', 'other']);
const name = z.string().trim().min(2).max(100);
const metadata = {
  id: opaqueId,
  version: expectedVersion,
  status: z.enum(['active', 'inactive']),
  createdAt: instant,
  updatedAt: instant,
  createdBy: opaqueId,
  updatedBy: opaqueId,
};
export const conditionView = z.object({
  ...metadata,
  name,
  description: z.string().max(500),
  schedule,
});
export const conditionSchema = conditionView
  .extend({ tenantId: opaqueId, nameKey: z.string(), schemaVersion: z.literal(1) })
  .strict();
export const methodView = z.object({ ...metadata, name, kind: methodKind });
export const methodSchema = methodView
  .extend({ tenantId: opaqueId, nameKey: z.string(), schemaVersion: z.literal(1) })
  .strict();
export const conditionCreate = z
  .strictObject({
    name,
    description: z.string().trim().max(500).optional(),
    preset: preset.optional(),
    schedule: schedule.optional(),
  })
  .refine(
    (v) => Number(v.preset !== undefined) + Number(v.schedule !== undefined) === 1,
    'Escolha preset ou parcelas personalizadas',
  );
export const conditionUpdate = z.strictObject({
  expectedVersion,
  name: name.optional(),
  description: z.string().trim().max(500).optional(),
  schedule: schedule.optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
export const methodCreate = z.strictObject({ name, kind: methodKind });
export const methodUpdate = z.strictObject({
  expectedVersion,
  name: name.optional(),
  kind: methodKind.optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
export const settingsQuery = z.strictObject({
  ...pageQuery.shape,
  status: z.enum(['active', 'inactive', 'all']).optional(),
});
export const conditionOption = conditionView.pick({
  id: true,
  name: true,
  version: true,
  schedule: true,
});
export const methodOption = methodView.pick({ id: true, name: true, version: true, kind: true });
export const conditionsPage = pageOf(conditionView);
export const methodsPage = pageOf(methodView);
export const conditionOptionsPage = pageOf(conditionOption);
export const methodOptionsPage = pageOf(methodOption);
export const methodSnapshot = methodOption;
export const termsSnapshot = conditionOption.extend({
  baseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string(),
  dueDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1)
    .max(12),
});
export const settingNameSchema = z.strictObject({
  resourceId: opaqueId,
  kind: z.enum(['condition', 'method']),
  schemaVersion: z.literal(1),
});
