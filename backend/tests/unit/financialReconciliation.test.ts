import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  signCheckpoint,
  readCheckpoint,
  type Checkpoint,
} from '../../src/modules/finance/reconciliationCursor.js';
import { digest, encodeCursor } from '../../src/shared/utils/crypto.js';
import { pageQuery } from '../../src/shared/schemas/http.js';

const secret = 'synthetic-financial-checkpoint-secret';
const scope = digest('synthetic-actor-tenant-order-scope');
const legacyScope = digest('synthetic-legacy-scope');
const checkpoint: Checkpoint = {
  format: 1,
  scope,
  version: 4,
  headHash: digest('head'),
  eventCount: 3,
  sequence: 1,
  checked: 1,
  lastId: 'first-event',
  previousHash: digest('first'),
  snapshotHash: digest('snapshot'),
  consistent: false,
};
describe('Checkpoint financeiro assinado', () => {
  it('preserva falha e contagem acumuladas em roundtrip', () => {
    expect(readCheckpoint(secret, signCheckpoint(secret, checkpoint), scope, legacyScope)).toEqual(
      checkpoint,
    );
  });
  it('cabe no contrato de 1024 caracteres com IDs e contadores máximos', () => {
    const max = {
      ...checkpoint,
      lastId: 'x'.repeat(128),
      version: Number.MAX_SAFE_INTEGER,
      eventCount: Number.MAX_SAFE_INTEGER,
      sequence: Number.MAX_SAFE_INTEGER,
      checked: Number.MAX_SAFE_INTEGER,
    };
    const token = signCheckpoint(secret, max);
    expect(token.length).toBeLessThanOrEqual(1024);
    expect(pageQuery.safeParse({ cursor: token }).success).toBe(true);
    expect(readCheckpoint(secret, token, scope, legacyScope)).toEqual(max);
  });
  it('rejeita outro escopo e outra chave', () => {
    const token = signCheckpoint(secret, checkpoint);
    expect(() => readCheckpoint(secret, token, digest('other-tenant'), legacyScope)).toThrowError(
      expect.objectContaining({ status: 422 }),
    );
    expect(() => readCheckpoint('other-secret', token, scope, legacyScope)).toThrowError(
      expect.objectContaining({ status: 422 }),
    );
  });
  it.each(['', 'not-a-cursor', 'a.b.c', `${'a'.repeat(1025)}.b`])(
    'rejeita token inválido %s',
    (token) => {
      expect(() => readCheckpoint(secret, token, scope, legacyScope)).toThrowError(
        expect.objectContaining({ status: 422, code: 'VALIDATION_ERROR' }),
      );
    },
  );
  it('não aceita checkpoint incompleto ou com formato desconhecido, mesmo com assinatura válida', () => {
    for (const value of [
      { scope, id: 'first-event' },
      { ...checkpoint, format: 2 },
    ]) {
      const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
      const signature = createHmac('sha256', secret)
        .update(`financial-reconciliation:v1:${payload}`)
        .digest('base64url');
      expect(() =>
        readCheckpoint(secret, `${payload}.${signature}`, scope, legacyScope),
      ).toThrowError(expect.objectContaining({ status: 422 }));
    }
  });
  it('rejeita cursor legado do escopo correto com reinício explícito', () => {
    const token = encodeCursor(secret, legacyScope, 'first-event');
    expect(() => readCheckpoint(secret, token, scope, legacyScope)).toThrowError(
      expect.objectContaining({
        status: 409,
        code: 'FINANCIAL_RECONCILIATION_RESTART_REQUIRED',
      }),
    );
    expect(() => readCheckpoint(secret, token, scope, digest('other-legacy-scope'))).toThrowError(
      expect.objectContaining({ status: 422 }),
    );
  });
  it('versiona checkpoint misto sem reinterpretar cursor v1', () => {
    const token = signCheckpoint(secret, { ...checkpoint, format: 2 });
    expect(readCheckpoint(secret, token, scope, legacyScope, 2).format).toBe(2);
    expect(() =>
      readCheckpoint(secret, signCheckpoint(secret, checkpoint), scope, legacyScope, 2),
    ).toThrowError(
      expect.objectContaining({ status: 409, code: 'FINANCIAL_RECONCILIATION_RESTART_REQUIRED' }),
    );
    expect(() =>
      readCheckpoint(secret, token, digest('other-tenant'), legacyScope, 2),
    ).toThrowError(expect.objectContaining({ status: 422 }));
  });
});
