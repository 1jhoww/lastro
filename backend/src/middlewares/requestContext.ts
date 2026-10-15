import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
export const requestContext: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  next();
};
export function requestLog(enabled: boolean): RequestHandler {
  return (req, res, next) => {
    const started = performance.now();
    if (enabled)
      res.on('finish', () =>
        console.log(
          JSON.stringify({
            event: 'http.request',
            requestId: req.requestId,
            method: req.method,
            route: typeof req.route?.path === 'string' ? req.route.path : 'unmatched',
            status: res.statusCode,
            durationMs: Math.round(performance.now() - started),
          }),
        ),
      );
    next();
  };
}
