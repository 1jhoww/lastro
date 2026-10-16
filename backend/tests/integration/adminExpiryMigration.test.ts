import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Timestamp } from 'firebase-admin/firestore';
import { registerFixture, bearer, tenantInput } from '../helpers/fixture.js';
import { digest } from '../../src/shared/utils/crypto.js';

const f = registerFixture();
describe('F04: conversão administrativa local supervisionada', () => {
  it('dry-run e páginas com checkpoint conservam registros, resultados e replay', async () => {
    const key = randomUUID();
    const body = tenantInput('Migração preservada', f.outsider.email);
    const call = () =>
      request(f.app)
        .post('/api/v1/admin/tenants')
        .set(bearer(f.platform))
        .set('Idempotency-Key', key)
        .send(body);
    const created = (await call().expect(201)).body.data.tenant;
    const ref = f.firebase.db.doc(
      `idempotencyRecords/${digest(`${f.platform.uid}:tenant.create:${key}`)}`,
    );
    const deadline = new Date(Date.now() + 30 * 86400000).toISOString();
    await ref.update({ expiresAt: deadline });
    const batch = f.firebase.db.batch();
    for (let i = 0; i < 103; i++)
      batch.create(f.firebase.db.doc(`idempotencyRecords/${digest(`migration-${i}`)}`), {
        actorUid: f.platform.uid,
        operation: 'tenant.create',
        payloadHash: digest(`input-${i}`),
        result: { id: created.id },
        createdAt: new Date().toISOString(),
        expiresAt: deadline,
        schemaVersion: 1,
      });
    await batch.commit();
    const before = await f.firebase.db.collection('idempotencyRecords').get();
    const run = (...args: string[]) => {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/migrate-admin-expiry.ts', ...args],
        { encoding: 'utf8', windowsHide: true, timeout: 15_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as {
        mode: string;
        examined: number;
        converted: number;
        nextCursor: string | null;
      };
    };
    const dry = run();
    expect(dry).toMatchObject({ mode: 'dry-run', examined: 100 });
    expect(dry.converted).toBeGreaterThan(90);
    expect(dry.nextCursor).toBeTruthy();
    expect((await ref.get()).get('expiresAt')).toBe(deadline);
    const first = run('--apply');
    expect(first.nextCursor).toBe(dry.nextCursor);
    const last = run('--apply', `--cursor=${first.nextCursor}`);
    expect(last.nextCursor).toBeNull();
    const after = await f.firebase.db.collection('idempotencyRecords').get();
    expect(after.size).toBe(before.size);
    for (const doc of after.docs) {
      const prior = before.docs.find((d) => d.id === doc.id)!;
      expect(doc.get('expiresAt')).toBeInstanceOf(Timestamp);
      expect(doc.get('result')).toEqual(prior.get('result'));
      expect(doc.get('payloadHash')).toBe(prior.get('payloadHash'));
      const old = prior.get('expiresAt');
      expect(doc.get('expiresAt').toDate().toISOString()).toBe(
        typeof old === 'string' ? old : old.toDate().toISOString(),
      );
    }
    expect((await call().expect(201)).body.data.tenant.id).toBe(created.id);
    expect(run().converted).toBe(0);
  }, 60_000);
});
