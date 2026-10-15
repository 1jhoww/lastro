import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../shared/errors/appError.js';
import { decodeCursor, equalDigest } from '../../shared/utils/crypto.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const checkpointSchema = z.strictObject({
  format: z.union([z.literal(1), z.literal(2)]),
  scope: hash,
  version: count,
  headHash: hash,
  eventCount: count,
  sequence: count,
  checked: count,
  lastId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .nullable(),
  previousHash: hash,
  snapshotHash: hash.nullable(),
  consistent: z.boolean(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;

export function signCheckpoint(secret: string, checkpoint: Checkpoint): string {
  const payload = Buffer.from(JSON.stringify(checkpointSchema.parse(checkpoint))).toString(
    'base64url',
  );
  return `${payload}.${createHmac('sha256', secret).update(`financial-reconciliation:v${checkpoint.format}:${payload}`).digest('base64url')}`;
}

export function readCheckpoint(
  secret: string,
  token: string,
  scope: string,
  legacyScope: string,
  expectedFormat: 1 | 2 = 1,
): Checkpoint {
  let checkpoint: Checkpoint;
  try {
    const [payload, signature, extra] = token.split('.');
    if (token.length > 1024 || !payload || !signature || extra) throw new Error();
    checkpoint = checkpointSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (
      !equalDigest(
        signature,
        createHmac('sha256', secret)
          .update(`financial-reconciliation:v${checkpoint.format}:${payload}`)
          .digest('base64url'),
      )
    )
      throw new Error();
    if (checkpoint.scope !== scope) throw new Error();
  } catch {
    // Old signed cursors cannot carry a trustworthy cumulative result.
    try {
      if (token.length > 1024 || !decodeCursor(secret, legacyScope, token)) throw new Error();
    } catch {
      throw new AppError(422, 'VALIDATION_ERROR', 'Cursor inválido; reinicie a reconciliação');
    }
    throw new AppError(
      409,
      'FINANCIAL_RECONCILIATION_RESTART_REQUIRED',
      'Cursor anterior ao checkpoint financeiro; reinicie a reconciliação',
    );
  }
  if (checkpoint.format !== expectedFormat)
    throw new AppError(
      409,
      'FINANCIAL_RECONCILIATION_RESTART_REQUIRED',
      'Formato do diário mudou; reinicie a reconciliação',
    );
  return checkpoint;
}
