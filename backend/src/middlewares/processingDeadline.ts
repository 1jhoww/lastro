import type { RequestHandler } from 'express';
import { withRequestSignal } from '../shared/operations/readBudget.js';

export const HTTP_PROCESSING_MS = 120_000;
export function processingDeadline(timeoutMs = HTTP_PROCESSING_MS): RequestHandler {
  return (req, res, next) => {
    const controller = new AbortController();
    const cleanup = () => {
      clearTimeout(timer);
      if (!res.writableFinished) controller.abort();
    };
    const timer = setTimeout(() => {
      controller.abort();
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.status(503).json({
        error: {
          code: 'REQUEST_OUTCOME_UNKNOWN',
          status: 503,
          message:
            'Prazo de resposta excedido; consulte estado e repita a mesma chave idempotente. Efeitos podem ter sido aplicados.',
          requestId: req.requestId,
        },
      });
    }, timeoutMs);
    timer.unref();
    res.once('finish', cleanup);
    res.once('close', cleanup);
    withRequestSignal(controller.signal, next);
  };
}
