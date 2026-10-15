import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors/appError.js';
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) {
    next(error);
    return;
  }
  let safe: AppError;
  if (error instanceof AppError) safe = error;
  else if (error instanceof ZodError)
    safe = new AppError(422, 'VALIDATION_ERROR', 'Dados inválidos');
  else if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 3 &&
    'message' in error &&
    typeof error.message === 'string' &&
    /(?:maximum|exceed|too (?:big|large)).*(?:size|bytes|MiB)|(?:size|bytes|MiB).*(?:maximum|exceed|too (?:big|large))/i.test(
      error.message,
    )
  )
    safe = new AppError(
      413,
      'ORDER_TECHNICAL_LIMIT',
      'Limite técnico do banco excedido; operação não aplicada',
    );
  else if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    error.type === 'encoding.unsupported'
  )
    safe = new AppError(415, 'VALIDATION_ERROR', 'Codificação não permitida');
  else if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    error.type === 'entity.too.large'
  )
    safe = new AppError(413, 'VALIDATION_ERROR', 'Requisição muito grande');
  else if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  )
    safe = new AppError(400, 'VALIDATION_ERROR', 'JSON inválido');
  else if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 10 || error.code === 6)
  )
    safe = new AppError(409, 'CONFLICT', 'Operação concorrente; tente novamente');
  else safe = new AppError(500, 'INTERNAL_ERROR', 'Erro interno do servidor');
  // Never log input, token, invitation, email, SDK stack or raw exception.
  if (safe.status >= 500)
    console.error(
      JSON.stringify({ event: 'http.failure', requestId: req.requestId, code: safe.code }),
    );
  res.status(safe.status).json({
    error: {
      code: safe.code,
      message: safe.message,
      status: safe.status,
      requestId: req.requestId,
    },
  });
};
