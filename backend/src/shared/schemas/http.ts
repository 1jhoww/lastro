import { z } from 'zod';
import {
  opaqueId,
  role,
  email,
  instant,
  termsShape,
  subscriptionStatus,
  ianaTimezone,
} from './models.js';
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
export const updatePlanInput = createPlanInput
  .partial()
  .extend({
    expectedVersion: z.number().int().positive(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .strict();
export const createTenantInput = z.strictObject({
  name: z.string().trim().min(2).max(120),
  planId: opaqueId,
  ownerEmail: email,
});
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
export const updateSubscriptionInput = z.strictObject({
  expectedVersion: z.number().int().positive(),
  status: subscriptionStatus.optional(),
  signupFeeCents: termsShape.signupFeeCents.optional(),
  monthlyPriceCents: termsShape.monthlyPriceCents.optional(),
  userLimit: termsShape.userLimit.optional(),
  startsAt: instant.optional(),
  commercialNotes: z.string().max(500).nullable().optional(),
  reason: z.string().trim().min(3).max(200),
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
  version: z.number(),
  createdAt: instant,
  updatedAt: instant,
});
export const invitationView = z.object({ id: opaqueId, email, role, expiresAt: instant });
export const issuedInvitationView = z.object({ invitation: invitationView, token: z.string() });
export const usersView = z.object({
  items: z.array(memberView),
  nextCursor: z.string().nullable(),
  pendingInvitations: z.array(invitationView),
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
  version: z.number(),
  createdAt: instant,
  updatedAt: instant,
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
