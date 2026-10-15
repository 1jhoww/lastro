import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';

export const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const instant = z.iso.datetime();
export const email = z
  .email()
  .max(254)
  .refine((v) => v === v.trim().toLowerCase(), 'Use email normalizado em minúsculas');
export const role = z.enum(['administrator', 'seller']);
export const subscriptionStatus = z.enum(['active', 'past_due', 'suspended', 'canceled']);
const amount = z.number().int().min(0).max(100_000_000);
export const termsShape = {
  signupFeeCents: amount,
  monthlyPriceCents: amount,
  userLimit: z.number().int().min(2).max(100),
};
const metadata = { createdAt: instant, updatedAt: instant, schemaVersion: z.literal(1) };
export const ianaTimezone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Fuso IANA inválido');
export const identitySchema = z.strictObject({
  uid: opaqueId,
  status: z.enum(['active', 'disabled']),
  ...metadata,
});
export const tenantSchema = z.strictObject({
  id: opaqueId,
  name: z.string().trim().min(2).max(120),
  timezone: ianaTimezone,
  status: z.enum(['provisioning', 'active']),
  subscriptionId: opaqueId,
  activeUsers: z.number().int().min(0),
  activeAdmins: z.number().int().min(0),
  version: z.number().int().positive(),
  ...metadata,
});
export const membershipSchema = z.strictObject({
  uid: opaqueId,
  tenantId: opaqueId,
  role,
  status: z.enum(['active', 'disabled']),
  version: z.number().int().positive(),
  ...metadata,
});
export const invitationSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  email,
  role,
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['pending', 'accepted', 'revoked']),
  expiresAt: instant,
  createdBy: opaqueId,
  acceptedBy: opaqueId.nullable(),
  ...metadata,
});
export const planSchema = z.strictObject({
  id: opaqueId,
  name: z.string().trim().min(2).max(120),
  version: z.number().int().positive(),
  ...termsShape,
  status: z.enum(['active', 'archived']),
  ...metadata,
});
export const subscriptionSchema = z.strictObject({
  id: opaqueId,
  tenantId: opaqueId,
  planId: opaqueId,
  planVersion: z.number().int().positive(),
  status: subscriptionStatus,
  ...termsShape,
  startsAt: instant,
  commercialNotes: z.string().max(500).nullable(),
  version: z.number().int().positive(),
  ...metadata,
});
export const auditSchema = z.strictObject({
  id: opaqueId,
  actorUid: opaqueId,
  tenantId: opaqueId.nullable(),
  action: z.string(),
  resourceId: opaqueId,
  requestId: z.string().uuid(),
  occurredAt: instant,
  changes: z.record(z.string(), z.unknown()),
  schemaVersion: z.literal(1),
});
export const idempotencySchema = z.strictObject({
  actorUid: opaqueId,
  operation: z.string(),
  payloadHash: z.string(),
  result: z.record(z.string(), z.string()),
  createdAt: instant,
  // Legacy ISO documents remain readable. This is a replay deadline, never a TTL field.
  expiresAt: z.union([instant, z.instanceof(Timestamp).transform((v) => v.toDate().toISOString())]),
  schemaVersion: z.literal(1),
});
export type Identity = z.infer<typeof identitySchema>;
export type Tenant = z.infer<typeof tenantSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type Audit = z.infer<typeof auditSchema>;
export type Idempotency = z.infer<typeof idempotencySchema>;
export type Role = z.infer<typeof role>;
