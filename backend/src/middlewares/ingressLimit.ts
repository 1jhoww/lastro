import { ipKeyGenerator } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { AppError } from '../shared/errors/appError.js';

// Bound memory even when many distinct peers arrive within the same window.
export function ingressLimit(limit: number, clock = Date.now, maxClients = 10_000): RequestHandler {
  const counts = new Map<string, number>();
  let window = Math.floor(clock() / 60_000);
  return (req, res, next) => {
    const current = Math.floor(clock() / 60_000);
    if (current !== window) {
      counts.clear();
      window = current;
    }
    const key = ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown');
    const count = counts.get(key) ?? 0;
    if (count >= limit || (!counts.has(key) && counts.size >= maxClients)) {
      res.set('Retry-After', String(60 - (Math.floor(clock() / 1000) % 60)));
      next(new AppError(429, 'RATE_LIMITED', 'Muitas requisições'));
      return;
    }
    counts.set(key, count + 1);
    next();
  };
}
