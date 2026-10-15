import type { RequestHandler } from 'express';
import type { Auth } from 'firebase-admin/auth';
import { FoundationRepository } from '../infrastructure/repositories/foundationRepository.js';
import { identitySchema } from '../shared/schemas/models.js';
import { AppError } from '../shared/errors/appError.js';
export function authentication(auth: Auth, repo: FoundationRepository): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header || !/^Bearer [^\s]{1,8192}$/.test(header))
      throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária');
    let token;
    try {
      token = await auth.verifyIdToken(header.slice(7), true);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code === 'auth/user-disabled')
        throw new AppError(403, 'FORBIDDEN', 'Operação não permitida');
      throw new AppError(401, 'UNAUTHORIZED', 'Autenticação inválida');
    }
    const identity = await repo.read(repo.global('identities', token.uid), identitySchema);
    if (identity?.status === 'disabled')
      throw new AppError(403, 'FORBIDDEN', 'Operação não permitida');
    req.actor = {
      uid: token.uid,
      email: token.email ?? null,
      emailVerified: token.email_verified ?? false,
      authTime: token.auth_time,
      requestId: req.requestId,
    };
    next();
  };
}
