import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { equalDigest } from '../../shared/utils/crypto.js';
import { AppError } from '../../shared/errors/appError.js';
import { MAX_SCALED } from './quantities.js';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const checkpointSchema = z.strictObject({
  scope: hash,
  version: z.number().int().min(0),
  sequence: z.number().int().min(0),
  checked: z.number().int().min(0),
  lastId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .nullable(),
  physical: z.number().int().min(0).max(MAX_SCALED),
  reserved: z.number().int().min(0).max(MAX_SCALED),
  previousHash: hash.nullable(),
  consistent: z.boolean(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export function signCheckpoint(secret: string, checkpoint: Checkpoint): string {
  const payload = Buffer.from(JSON.stringify(checkpoint)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(`reconciliation:${payload}`).digest('base64url')}`;
}
export function readCheckpoint(secret: string, token: string, scope: string): Checkpoint {
  try {
    const [payload, signature, extra] = token.split('.');
    if (
      !payload ||
      !signature ||
      extra ||
      !equalDigest(
        signature,
        createHmac('sha256', secret).update(`reconciliation:${payload}`).digest('base64url'),
      )
    )
      throw new Error();
    const checkpoint = checkpointSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString()),
    );
    if (checkpoint.scope !== scope) throw new Error();
    return checkpoint;
  } catch {
    throw new AppError(422, 'VALIDATION_ERROR', 'Cursor inválido');
  }
}
