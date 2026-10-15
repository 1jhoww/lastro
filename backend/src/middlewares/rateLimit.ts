import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { Timestamp } from 'firebase-admin/firestore';
import type { RequestHandler } from 'express';
import type { Config } from '../config/env.js';
import type { FoundationRepository } from '../infrastructure/repositories/foundationRepository.js';
import { digest } from '../shared/utils/crypto.js';
import { AppError } from '../shared/errors/appError.js';
export function apiRateLimit(config: Config, repo: FoundationRepository): RequestHandler {
  if (config.mode === 'emulator')
    return rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
      handler: (req, res) =>
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Muitas requisições',
            status: 429,
            requestId: req.requestId,
          },
        }),
    });
  return async (req, res, next) => {
    const now = Date.now();
    const window = Math.floor(now / 60_000);
    const ref = repo.global(
      'rateLimits',
      digest(`ip:${ipKeyGenerator(req.ip ?? 'unknown')}:${window}`),
    );
    const count = await repo.db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (typeof data?.count === 'number' && data.count >= config.rateLimitMax)
        return config.rateLimitMax + 1;
      const value = typeof data?.count === 'number' ? data.count + 1 : 1;
      tx.set(ref, { count: value, expiresAt: Timestamp.fromMillis((window + 2) * 60_000) });
      return value;
    });
    if (count > config.rateLimitMax) {
      res.setHeader('Retry-After', '60');
      throw new AppError(429, 'RATE_LIMITED', 'Muitas requisições');
    }
    next();
  };
}
export function invitationRateLimit(repo: FoundationRepository): RequestHandler {
  return actorRateLimit(repo, 'invitation');
}
export function imageRateLimit(repo: FoundationRepository): RequestHandler {
  return actorRateLimit(repo, 'image-upload');
}
export function downloadRateLimit(repo: FoundationRepository): RequestHandler {
  return actorRateLimit(repo, 'document-export');
}
function actorRateLimit(repo: FoundationRepository, operation: string): RequestHandler {
  return async (req, res, next) => {
    if (!req.actor) throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária');
    const window = Math.floor(Date.now() / 3_600_000);
    const ref = repo.global('rateLimits', digest(`${operation}:${req.actor.uid}:${window}`));
    const count = await repo.db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (typeof data?.count === 'number' && data.count >= 30) return 31;
      const value = typeof data?.count === 'number' ? data.count + 1 : 1;
      tx.set(ref, { count: value, expiresAt: Timestamp.fromMillis((window + 2) * 3_600_000) });
      return value;
    });
    if (count > 30) {
      res.setHeader('Retry-After', '3600');
      throw new AppError(429, 'RATE_LIMITED', 'Muitas tentativas');
    }
    next();
  };
}

export function publicCatalogMemoryLimit(config: Config): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: Math.min(config.rateLimitMax, 60),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    handler: (req, res) =>
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Muitas requisições',
          status: 429,
          requestId: req.requestId,
        },
      }),
  });
}
export function publicCatalogRateLimit(config: Config, repo: FoundationRepository): RequestHandler {
  return async (req, res, next) => {
    const window = Math.floor(Date.now() / 60_000),
      quote = req.method === 'POST',
      publicIp = ipKeyGenerator(req.ip ?? 'unknown');
    const budgets = [
      { key: `catalog-ip:${publicIp}:${window}`, max: Math.min(config.rateLimitMax, 60) },
      { key: `catalog-slug:${req.params.slug}:${window}`, max: 600 },
      ...(quote ? [{ key: `catalog-quote:${publicIp}:${window}`, max: 10 }] : []),
    ];
    const allowed = await repo.db.runTransaction(async (tx) => {
      const refs = budgets.map((b) => repo.global('rateLimits', digest(b.key))),
        values = await Promise.all(refs.map((ref) => tx.get(ref)));
      const counts = values.map((v) =>
        typeof v.get('count') === 'number' ? Number(v.get('count')) : 0,
      );
      if (counts.some((v) => !Number.isSafeInteger(v) || v < 0))
        throw new AppError(500, 'INTERNAL_ERROR', 'Erro interno do servidor');
      if (counts.some((v, i) => v >= budgets[i]!.max)) return false;
      refs.forEach((ref, i) =>
        tx.set(ref, {
          count: counts[i]! + 1,
          expiresAt: Timestamp.fromMillis((window + 2) * 60_000),
        }),
      );
      return true;
    });
    if (!allowed) {
      res.setHeader('Retry-After', '60');
      throw new AppError(429, 'RATE_LIMITED', 'Muitas requisições');
    }
    next();
  };
}
