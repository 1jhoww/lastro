import { z } from 'zod';
import { planFeatures } from '../../modules/plans/catalog.js';
import {
  customContractSchema,
  customPlanPrice,
  customPlanSchema,
  instant,
  opaqueId,
  planCode,
  subscriptionStatus,
  termsShape,
} from './models.js';

const expectedVersion = z.number().int().positive();
const reason = z.string().trim().min(3).max(200);
/** Only codes the backend recognizes get through: anything else is refused with 422. */
const features = z.array(z.enum(planFeatures)).max(planFeatures.length);
const name = customPlanSchema.shape.name;
const description = customPlanSchema.shape.description;

export const customPlanQuery = z.strictObject({
  status: z.enum(['active', 'inactive']).optional(),
});
export const createCustomPlanInput = z.strictObject({
  name,
  description,
  monthlyPriceCents: customPlanPrice,
  userLimit: termsShape.userLimit,
  features,
  /** Official plan the form started from, kept as reference only. */
  sourcePlanCode: planCode.nullable(),
});
export const updateCustomPlanInput = z.strictObject({
  expectedVersion,
  name: name.optional(),
  description: description.optional(),
  monthlyPriceCents: customPlanPrice.optional(),
  userLimit: termsShape.userLimit.optional(),
  features: features.optional(),
  reason,
});
export const duplicateCustomPlanInput = z.strictObject({ name });
export const customPlanCommandInput = z.strictObject({ expectedVersion, reason });

export const customPlanPreviewQuery = z.strictObject({ planId: opaqueId });
export const assignCustomPlanInput = z.strictObject({
  expectedVersion,
  planId: opaqueId,
  /** Version the Super Admin reviewed: an offer edited meanwhile must be reviewed again. */
  planVersion: z.number().int().positive(),
  /** Negotiated value; the offer's value when omitted. */
  monthlyPriceCents: customPlanPrice.optional(),
  /** Must list exactly the features the change removes. */
  acknowledgedLostFeatures: features,
  reason,
});
export const changeContractInput = z.strictObject({
  expectedVersion,
  monthlyPriceCents: customPlanPrice.optional(),
  userLimit: termsShape.userLimit.optional(),
  features: features.optional(),
  acknowledgedLostFeatures: features,
  /** The change applies to this company only, right away: the request must say so. */
  confirmed: z.literal(true),
  reason,
});

export const customPlanView = z.object({
  id: opaqueId,
  name: z.string(),
  description: z.string(),
  status: z.enum(['active', 'inactive']),
  monthlyPriceCents: z.number(),
  userLimit: z.number(),
  features: z.array(z.enum(planFeatures)),
  sourcePlanCode: planCode.nullable(),
  duplicatedFromId: opaqueId.nullable(),
  version: z.number(),
  createdAt: instant,
  updatedAt: instant,
});
export const customPlanRow = customPlanView.extend({
  /** Contracts not canceled that came from this plan. */
  linkedCompanies: z.number(),
});
export const customPlanList = z.object({ items: z.array(customPlanRow) });
export const linkedCompany = z.object({
  tenantId: opaqueId,
  tenantName: z.string(),
  subscriptionId: opaqueId,
  subscriptionStatus,
  monthlyPriceCents: z.number(),
  userLimit: z.number(),
  /** Plan version this company contracted. */
  planVersion: z.number(),
  /** The offer changed after this contract was signed. */
  outdated: z.boolean(),
  /** This contract was adjusted individually after it was signed. */
  adjusted: z.boolean(),
});
export const customPlanDetail = z.object({
  plan: customPlanView,
  companies: z.array(linkedCompany),
});
export const customPlanPreviewView = z.object({
  subscriptionVersion: z.number(),
  planId: opaqueId,
  planVersion: z.number(),
  planName: z.string(),
  targetUserLimit: z.number(),
  activeUsers: z.number(),
  reservedInvitations: z.number(),
  /** Seats to free before the change is allowed. */
  excessSeats: z.number(),
  lostFeatures: z.array(z.enum(planFeatures)),
  gainedFeatures: z.array(z.enum(planFeatures)),
  publicCatalogEnabled: z.boolean(),
  monthlyPriceCents: z.number(),
  offerPriceCents: z.number(),
});
const terms = z.object({
  monthlyPriceCents: z.number(),
  userLimit: z.number(),
  features: z.array(z.enum(planFeatures)),
});
const difference = z.object({
  monthlyPriceDeltaCents: z.number(),
  userLimitDelta: z.number(),
  addedFeatures: z.array(z.enum(planFeatures)),
  removedFeatures: z.array(z.enum(planFeatures)),
  /** True when the contract matches the compared terms exactly. */
  same: z.boolean(),
});
export const contractDiffView = z.object({
  planId: opaqueId,
  planName: z.string(),
  contractedVersion: z.number(),
  currentVersion: z.number(),
  planStatus: z.enum(['active', 'inactive']),
  contract: terms,
  /** The offer as it was when this company contracted it. */
  origin: terms,
  /** The offer as it is today. */
  current: terms,
  againstOrigin: difference,
  againstCurrent: difference,
});
export { customContractSchema };
