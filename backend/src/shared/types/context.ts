import type { Membership, Tenant, Subscription } from '../schemas/models.js';
import type { Entitlements } from '../../modules/plans/catalog.js';
export interface Actor {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  authTime: number;
  requestId: string;
}
export interface TenantContext {
  actor: Actor;
  tenant: Tenant;
  membership: Membership;
  subscription: Subscription;
  /** Plan capabilities of the subscription; permissions were already filtered by them. */
  entitlements: Entitlements;
}
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      actor?: Actor;
      tenantContext?: TenantContext;
    }
  }
}
