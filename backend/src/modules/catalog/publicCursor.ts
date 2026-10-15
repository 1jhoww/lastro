import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { opaqueId } from '../../shared/schemas/models.js';
import { AppError } from '../../shared/errors/appError.js';
const keyFor = (secret: string) =>
  createHmac('sha256', secret).update('catalog-cursor-key-v1').digest();
export function encodePublicCursor(secret: string, scope: string, id: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', keyFor(secret), nonce);
  cipher.setAAD(Buffer.from(scope));
  const data = Buffer.concat([cipher.update(opaqueId.parse(id), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64url');
}
export function decodePublicCursor(secret: string, scope: string, cursor?: string) {
  if (!cursor) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]{39,208}$/.test(cursor)) throw new Error();
    const raw = Buffer.from(cursor, 'base64url');
    if (raw.toString('base64url') !== cursor) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', keyFor(secret), raw.subarray(0, 12));
    cipher.setAAD(Buffer.from(scope));
    cipher.setAuthTag(raw.subarray(12, 28));
    return opaqueId.parse(
      Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString('utf8'),
    );
  } catch {
    throw new AppError(422, 'VALIDATION_ERROR', 'Cursor inválido');
  }
}
