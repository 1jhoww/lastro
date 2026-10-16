import { z } from 'zod';
import {
  opaqueId,
  role,
  email,
  instant,
  termsShape,
  subscriptionStatus,
  ianaTimezone,
  planCode,
  billingDay,
  calendarDate,
  billingContactSchema,
} from './models.js';
import { planFeatures } from '../../modules/plans/catalog.js';
export const empty = z.strictObject({});
export const idParams = z.strictObject({ id: opaqueId });
export const pageQuery = z.strictObject({
  limit: z
    .string()
    .regex(/^(?:[1-9][0-9]?|100)$/)
    .optional(),
  cursor: z.string().max(1024).optional(),
});
export const createPlanInput = z.strictObject({
  name: z.string().trim().min(2).max(120),
  ...termsShape,
});
const expectedVersion = z.number().int().positive();
const reason = z.string().trim().min(3).max(200);
const internalNotes = z.string().trim().max(500).nullable();
export const createTenantInput = z.strictObject({
  name: z.string().trim().min(2).max(120),
  ownerEmail: email,
  planCode,
  /** Contracted price; the plan's reference price when omitted. */
  monthlyPriceCents: termsShape.monthlyPriceCents.optional(),
  billingDay,
  billingStartsOn: calendarDate,
  billingContact: billingContactSchema.nullable().optional(),
  commercialNotes: internalNotes.optional(),
});
export const activateSubscriptionInput = z.strictObject({
  expectedVersion,
  monthlyPriceCents: termsShape.monthlyPriceCents,
  billingDay,
  billingStartsOn: calendarDate,
  reason,
});
export const planChangeQuery = z.strictObject({ planCode });
export const changePlanInput = z.strictObject({
  expectedVersion,
  planCode,
  /** Unchanged when omitted: a plan change never alters the price silently. */
  monthlyPriceCents: termsShape.monthlyPriceCents.optional(),
  /** Must list exactly the features the change removes. */
  acknowledgedLostFeatures: z.array(z.enum(planFeatures)).max(planFeatures.length),
  reason,
});
export const subscriptionTermsInput = z.strictObject({
  expectedVersion,
  monthlyPriceCents: termsShape.monthlyPriceCents.optional(),
  billingDay: billingDay.optional(),
  commercialNotes: internalNotes.optional(),
  billingContact: billingContactSchema.nullable().optional(),
  reason,
});
export const subscriptionCommandInput = z.strictObject({ expectedVersion, reason });
export const updateTenantInput = z.strictObject({
  name: z.string().trim().min(2).max(120),
  timezone: ianaTimezone.optional(),
  expectedVersion: z.number().int().positive(),
});
export const inviteInput = z.strictObject({ email, role });
export const ownerInviteInput = z.strictObject({
  ownerEmail: email,
  expectedVersion: z.number().int().positive(),
});
export const acceptInput = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{43}$/),
});
export const roleInput = z.strictObject({ role, expectedVersion: z.number().int().positive() });
export const statusInput = z.strictObject({
  status: z.enum(['active', 'disabled']),
  expectedVersion: z.number().int().positive(),
});
export const tenantView = z.object({
  id: opaqueId,
  name: z.string(),
  timezone: z.string(),
  status: z.enum(['provisioning', 'active']),
  version: z.number(),
  createdAt: instant,
  updatedAt: instant,
});
export const memberView = z.object({
  id: opaqueId,
  /** From the sign-in provider, listing only; null when the account has no such data. */
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  role,
  status: z.enum(['active', 'disabled']),
  /** Lastro support access: occupies no seat. */
  seatExempt: z.boolean(),
  version: z.number(),
  createdAt: instant,
  updatedAt: instant,
});
export const invitationView = z.object({
  id: opaqueId,
  email,
  role,
  expiresAt: instant,
  seatExempt: z.boolean(),
});
export const issuedInvitationView = z.object({ invitation: invitationView, token: z.string() });
export const seatCapacityView = z.object({
  userLimit: z.number(),
  activeUsers: z.number(),
  reservedInvitations: z.number(),
  available: z.number(),
});
export const usersView = z.object({
  items: z.array(memberView),
  nextCursor: z.string().nullable(),
  pendingInvitations: z.array(invitationView),
  capacity: seatCapacityView,
});
export const membershipPlanView = z.object({
  /** Null for legacy contracts created before the official plans. */
  code: planCode.nullable(),
  name: z.string().nullable(),
  userLimit: z.number(),
  features: z.array(z.enum(planFeatures)),
});
export const planView = createPlanInput
  .extend({
    id: opaqueId,
    version: z.number(),
    status: z.enum(['active', 'archived']),
    createdAt: instant,
    updatedAt: instant,
  })
  .strip();
export const subscriptionView = z.object({
  id: opaqueId,
  tenantId: opaqueId,
  planId: opaqueId,
  planVersion: z.number(),
  status: subscriptionStatus,
  ...termsShape,
  startsAt: instant,
  commercialNotes: z.string().nullable(),
  planCode: planCode.nullable(),
  billingDay: z.number().nullable(),
  billingStartsOn: calendarDate.nullable(),
  billingContact: billingContactSchema.nullable(),
  version: z.number(),
  createdAt: instant,
  updatedAt: instant,
});
export const planCatalogView = z.object({
  items: z.array(
    z.object({
      code: planCode,
      name: z.string(),
      version: z.number(),
      referencePriceCents: z.number(),
      userLimit: z.number(),
      features: z.array(z.object({ code: z.enum(planFeatures), label: z.string() })),
      offered: z.boolean(),
    }),
  ),
  /** Every plan-gated capability, for comparison tables. */
  features: z.array(z.object({ code: z.enum(planFeatures), label: z.string() })),
});
export const planChangePreviewView = z.object({
  subscriptionVersion: z.number(),
  currentPlanCode: planCode.nullable(),
  targetPlanCode: planCode,
  targetUserLimit: z.number(),
  activeUsers: z.number(),
  reservedInvitations: z.number(),
  /** Seats to free (deactivate users or revoke invitations) before the change is allowed. */
  excessSeats: z.number(),
  lostFeatures: z.array(z.enum(planFeatures)),
  publicCatalogEnabled: z.boolean(),
  monthlyPriceCents: z.number(),
  referencePriceCents: z.number(),
});
export const subscriptionHistoryView = z.object({
  items: z.array(
    z.object({
      id: opaqueId,
      action: z.string(),
      actorUid: opaqueId,
      occurredAt: instant,
      changes: z.record(z.string(), z.unknown()),
    }),
  ),
});
export const meView = z.object({
  uid: opaqueId,
  email: z.email().nullable(),
  platformAdmin: z.boolean(),
  memberships: z.array(
    z.object({
      tenantId: opaqueId,
      role,
      permissions: z.array(z.string()),
      access: z.enum(['allowed', 'suspended', 'canceled', 'provisioning']),
      plan: membershipPlanView,
    }),
  ),
});
export const createdTenantView = z.object({
  tenant: tenantView,
  subscription: subscriptionView,
  ownerInvitation: issuedInvitationView,
});
export const acceptedView = z.object({ tenantId: opaqueId, user: memberView });
export const revokedView = z.object({ id: opaqueId, status: z.literal('revoked') });
export const errorView = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    status: z.number(),
    requestId: z.string().uuid(),
  }),
});
export const pageOf = <T extends z.ZodType>(schema: T) =>
  z.object({ items: z.array(schema), nextCursor: z.string().nullable() });
