import type { RequestHandler, Request } from 'express';
import { opaqueId } from '../shared/schemas/models.js';
import { AppError, requireCondition } from '../shared/errors/appError.js';
import type { Actor } from '../shared/types/context.js';
import type { AccessService } from '../modules/auth/accessService.js';
import type { Permission } from '../modules/users/permissions.js';
export function actorFor(req: Request): Actor {
  requireCondition(req.actor, 401, 'UNAUTHORIZED', 'Autenticação necessária');
  return req.actor;
}
export function selectedTenant(req: Request): string {
  const parsed = opaqueId.safeParse(req.headers['x-tenant-id']);
  if (!parsed.success)
    throw new AppError(403, 'TENANT_ACCESS_DENIED', 'Contexto de empresa não autorizado');
  return parsed.data;
}
export function tenantAuthorization(access: AccessService, permission: Permission): RequestHandler {
  return async (req, _res, next) => {
    req.tenantContext = await access.tenant(actorFor(req), selectedTenant(req), permission);
    next();
  };
}
export function platformAuthorization(access: AccessService, clock: () => Date): RequestHandler {
  return async (req, _res, next) => {
    const actor = actorFor(req);
    await access.platform(actor);
    requireCondition(
      clock().getTime() / 1000 - actor.authTime <= 300 &&
        actor.authTime <= clock().getTime() / 1000 + 30,
      403,
      // Distinct from FORBIDDEN (not a Super Admin): only this one asks for the password again.
      'REAUTHENTICATION_REQUIRED',
      'Reautenticação recente necessária',
    );
    next();
  };
}
