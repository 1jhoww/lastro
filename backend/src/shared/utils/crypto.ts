import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors/appError.js';
export const digest = (v: string): string => createHash('sha256').update(v).digest('hex');
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function equalDigest(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function invitationToken(secret: string, tenantId: string, id: string): string {
  const proof = createHmac('sha256', secret)
    .update(`invitation:${tenantId}:${id}`)
    .digest('base64url');
  return `${tenantId}.${id}.${proof}`;
}
export function encodeCursor(secret: string, scope: string, id: string): string {
  const payload = Buffer.from(JSON.stringify({ scope, id })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(`cursor:${payload}`).digest('base64url')}`;
}
export function decodeCursor(secret: string, scope: string, cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try {
    const [payload, signature, extra] = cursor.split('.');
    if (
      !payload ||
      !signature ||
      extra ||
      !equalDigest(
        signature,
        createHmac('sha256', secret).update(`cursor:${payload}`).digest('base64url'),
      )
    )
      throw new Error();
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      !('scope' in decoded) ||
      !('id' in decoded) ||
      decoded.scope !== scope ||
      typeof decoded.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(decoded.id)
    )
      throw new Error();
    return decoded.id;
  } catch {
    throw new AppError(422, 'VALIDATION_ERROR', 'Cursor inválido');
  }
}
