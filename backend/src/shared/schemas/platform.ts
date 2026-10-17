import { z } from 'zod';
import {
  billingContactSchema,
  calendarDate,
  email,
  instant,
  opaqueId,
  planCode,
  role,
  subscriptionStatus,
} from './models.js';
import { planFeatures } from '../../modules/plans/catalog.js';
import { chargeView } from './billing.js';
import { emailChangeView, subscriptionView, tenantView } from './http.js';

const money = z.object({ count: z.number(), amountCents: z.number() });

export const overviewView = z.object({
  today: calendarDate,
  totalCompanies: z.number(),
  subscriptions: z.object({
    active: z.number(),
    pending: z.number(),
    suspended: z.number(),
    canceled: z.number(),
  }),
  /** Companies per plan, excluding canceled contracts. Legacy = before the official plans. */
  plans: z.object({ essencial: z.number(), profissional: z.number(), legacy: z.number() }),
  /** Contracted monthly revenue of active contracts; not money received. */
  mrrCents: z.number(),
  openCharges: money,
  overdueCharges: money,
  /** Payments recorded with payment date in the current month. */
  receivedThisMonthCents: z.number(),
  upcoming: z.array(chargeView.extend({ tenantName: z.string() })),
});

export const companyQuery = z.strictObject({
  q: z.string().trim().max(120).optional(),
  planCode: z.enum(['essencial', 'profissional', 'legacy']).optional(),
  status: subscriptionStatus.optional(),
  attention: z.enum(['overdue', 'open']).optional(),
});
export const companyRow = z.object({
  id: opaqueId,
  name: z.string(),
  tenantStatus: z.enum(['provisioning', 'active']),
  createdAt: instant,
  subscriptionId: opaqueId,
  subscriptionVersion: z.number(),
  subscriptionStatus,
  planCode: planCode.nullable(),
  planName: z.string().nullable(),
  monthlyPriceCents: z.number(),
  billingDay: z.number().nullable(),
  nextDueDate: calendarDate.nullable(),
  activeUsers: z.number(),
  userLimit: z.number(),
  contact: billingContactSchema.nullable(),
  openCharges: z.object({ count: z.number(), overdueCount: z.number(), amountCents: z.number() }),
});
export const companyList = z.object({ items: z.array(companyRow), total: z.number() });

export const companyDetail = z.object({
  tenant: tenantView,
  subscription: subscriptionView.extend({
    planName: z.string().nullable(),
    nextDueDate: calendarDate.nullable(),
    features: z.array(z.enum(planFeatures)),
  }),
  capacity: z.object({
    userLimit: z.number(),
    activeUsers: z.number(),
    reservedInvitations: z.number(),
    available: z.number(),
  }),
  users: z.array(
    z.object({
      uid: opaqueId,
      name: z.string().nullable(),
      email: z.string().nullable(),
      role,
      status: z.enum(['active', 'disabled']),
      seatExempt: z.boolean(),
      /** Membership version, required by status commands. */
      version: z.number(),
      /** Account blocked at platform level (Lastro identity or sign-in provider), every company. */
      accountBlocked: z.boolean(),
      createdAt: instant,
      /** Pending e-mail change of this account, if any. */
      emailChange: emailChangeView
        .extend({
          /** The identity provider already holds the new address (holder confirmed it). */
          appliedByProvider: z.boolean(),
        })
        .nullable(),
    }),
  ),
  invitations: z.array(
    z.object({
      id: opaqueId,
      email: z.string(),
      role,
      status: z.enum(['pending', 'accepted', 'revoked']),
      expired: z.boolean(),
      seatExempt: z.boolean(),
      expiresAt: instant,
      createdAt: instant,
      replacedBy: opaqueId.nullable(),
    }),
  ),
  publicCatalogEnabled: z.boolean(),
});
export const companyInvitationParams = z.strictObject({ id: opaqueId, invitationId: opaqueId });
const reason = z.string().trim().min(3).max(200);
export const revokeInvitationInput = z.strictObject({ reason });
/** New access invitation for an existing company; always bounded by the contracted seats. */
export const companyInviteInput = z.strictObject({ email, role, reason });
/** Resend a pending invitation (new link, same seat) or correct its e-mail. */
export const companyReissueInput = z.strictObject({ email: email.optional(), reason });
export const companyMemberParams = z.strictObject({ id: opaqueId, uid: opaqueId });
export const companyMemberStatusInput = z.strictObject({
  status: z.enum(['active', 'disabled']),
  expectedVersion: z.number().int().positive(),
  reason,
});
export const emailChangeInput = z.strictObject({ newEmail: email, reason });
export const emailChangeCancelInput = z.strictObject({ reason });
export const accountUnblockedView = z.object({ uid: opaqueId, blocked: z.literal(false) });
export const companyMemberView = z.object({
  uid: opaqueId,
  role,
  status: z.enum(['active', 'disabled']),
  version: z.number(),
});

export const ownerInvitationList = z.object({
  items: z.array(
    z.object({
      tenantId: opaqueId,
      tenantName: z.string(),
      tenantVersion: z.number(),
      planCode: planCode.nullable(),
      createdAt: instant,
      invitation: z
        .object({
          id: opaqueId,
          email: z.string(),
          status: z.enum(['pending', 'accepted', 'revoked']),
          expired: z.boolean(),
          expiresAt: instant,
          /** Only while pending and valid, to copy the link again. */
          token: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
});
