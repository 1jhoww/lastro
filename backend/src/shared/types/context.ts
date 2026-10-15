import type { Membership, Tenant, Subscription } from '../schemas/models.js';
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
