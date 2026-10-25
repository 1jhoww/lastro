import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';
import { planCodes } from '../../modules/plans/catalog.js';

export const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const instant = z.iso.datetime();
export const email = z
  .email()
  .max(254)
  .refine((v) => v === v.trim().toLowerCase(), 'Use email normalizado em minúsculas');
export const role = z.enum(['administrator', 'seller']);
/** Permission matrix operation id, such as `orders.confirm`. */
export const operationId = z.string().regex(/^[a-z]+\.[a-z]+$/);
/**
 * Administrative state of the contract, independent of each charge's financial state.
 * `pending` keeps access while billing terms are not activated (no charges are generated).
 * `past_due` is a legacy value kept readable; it never blocks access.
 */
export const subscriptionStatus = z.enum([
  'pending',
  'active',
  'past_due',
  'suspended',
  'canceled',
]);
export const planCode = z.enum(planCodes);
/** Calendar date (YYYY-MM-DD) interpreted in America/Sao_Paulo. */
export const calendarDate = z.iso.date();
/** Due day limited to 28 so every month has it. */
export const billingDay = z.number().int().min(1).max(28);
const amount = z.number().int().min(0).max(100_000_000);
export const termsShape = {
  signupFeeCents: amount,
  monthlyPriceCents: amount,
  userLimit: z.number().int().min(1).max(100),
};
export const billingContactSchema = z.strictObject({
  name: z.string().trim().min(2).max(120).nullable(),
  email: email.nullable(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9()+\-. ]{8,20}$/)
    .nullable(),
});
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
/**
 * Company logo, kept privately at `tenants/{tenantId}/branding/{id}.webp`. The id changes on
 * every upload, so a replaced object is never served again.
 */
export const tenantLogoSchema = z.object({
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
export const tenantSchema = z.strictObject({
  id: opaqueId,
  name: z.string().trim().min(2).max(120),
  /** Absent on companies created before logos existed. */
  logo: tenantLogoSchema.nullable().default(null),
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
  /**
   * Lastro Super Admin support access: never occupies a contracted seat nor counts as the
   * company's administrator, and is valid only while the platform role stays active.
   */
  seatExempt: z.boolean().default(false),
  /**
   * Seller operations chosen by an administrator (see permissionMatrix); null keeps the role
   * defaults. Administrators always hold every operation, so theirs stays null.
   */
  operations: z.array(operationId).max(50).nullable().default(null),
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
  /** Addressed to an active Super Admin: reserves no seat (see membership.seatExempt). */
  seatExempt: z.boolean().default(false),
  /** Invitation issued in place of this one (resend or e-mail correction). */
  replacedBy: opaqueId.nullable().default(null),
  ...metadata,
});
/**
 * E-mail change of an active account, started by the Super Admin and applied only by the
 * identity provider after the holder re-authenticates and verifies the new address. One
 * document per identity; the history lives in the audit trail.
 */
export const emailChangeSchema = z.strictObject({
  uid: opaqueId,
  tenantId: opaqueId,
  currentEmail: email.nullable(),
  newEmail: email,
  status: z.enum(['pending', 'completed', 'canceled']),
  reason: z.string().trim().min(3).max(200),
  requestedBy: opaqueId,
  expiresAt: instant,
  completedAt: instant.nullable(),
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
  // Fields below were added with the official plans; older documents read them as null.
  /** Official plan; null for legacy contracts created before the plan catalog. */
  planCode: planCode.nullable().default(null),
  /** Monthly due day; null until billing is activated. */
  billingDay: billingDay.nullable().default(null),
  /** First day that can be charged; charges never cover dates before it. */
  billingStartsOn: calendarDate.nullable().default(null),
  billingContact: billingContactSchema.nullable().default(null),
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
export type EmailChange = z.infer<typeof emailChangeSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type Audit = z.infer<typeof auditSchema>;
export type Idempotency = z.infer<typeof idempotencySchema>;
export type Role = z.infer<typeof role>;
