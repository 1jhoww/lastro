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
  operationId,
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
/** Seller operations chosen by the administrator (the whole set, replacing the previous one). */
export const operationsInput = z.strictObject({
  operations: z.array(operationId).max(50),
  expectedVersion: z.number().int().positive(),
});
/** Resend (new link, same seat) or correct the recipient of a pending invitation. */
export const reissueInvitationInput = z.strictObject({ email: email.optional() });
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
  /** Permission matrix operations in force (administrators hold all of them). */
  operations: z.array(z.string()).optional(),
  /** True when an administrator replaced the seller defaults with a custom choice. */
  customOperations: z.boolean().optional(),
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
  createdAt: instant.optional(),
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
  /** Modules and existing operations; how each one applies to sellers. */
  permissionMatrix: z.array(
    z.object({
      id: z.string(),
      module: z.string(),
      label: z.string(),
      description: z.string(),
      seller: z.enum(['required', 'default', 'grantable', 'never']),
      requires: z.array(z.string()),
      /** False when the contracted plan does not include the operation. */
      inPlan: z.boolean(),
    }),
  ),
});
/** E-mail change of an active account awaiting the holder (see emailChangeSchema). */
export const emailChangeView = z.object({
  uid: opaqueId,
  newEmail: email,
  status: z.enum(['pending', 'completed', 'canceled']),
  expiresAt: instant,
  expired: z.boolean(),
  createdAt: instant,
});
export const myEmailChangeView = z.object({ emailChange: emailChangeView.nullable() });
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
/**
 * Person's own display name (Firebase Auth `displayName`, the same source as the team list).
 * Whitespace collapses; an e-mail-like value is refused so the address never stands in for a name.
 */
export const personName = z
  .string()
  .transform((v) => v.normalize('NFC').trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'Informe pelo menos 2 caracteres')
      .max(80, 'Nome deve ter até 80 caracteres')
      .refine((v) => /\p{L}/u.test(v) && !v.includes('@'), 'Informe um nome de pessoa'),
  );
export const profileInput = z.strictObject({ name: personName });
export const meView = z.object({
  uid: opaqueId,
  email: z.email().nullable(),
  /** Name as registered by the person; null when never informed. */
  name: z.string().nullable(),
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
