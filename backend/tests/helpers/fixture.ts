import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { deleteApp } from 'firebase-admin/app';
import type { Express } from 'express';
import { loadConfig, type Config } from '../../src/config/env.js';
import { createFirebase, type Firebase } from '../../src/infrastructure/firebase/client.js';
import { createApp } from '../../src/app/app.js';
import { createdTenantView } from '../../src/shared/schemas/http.js';
import { billingDate } from '../../src/modules/billing/calendar.js';
import type { PlanCode } from '../../src/modules/plans/catalog.js';
import type { z } from 'zod';
export interface TestUser {
  uid: string;
  token: string;
  email: string;
}
export interface Fixture {
  firebase: Firebase;
  config: Config;
  app: Express;
  platform: TestUser;
  ownerA: TestUser;
  ownerB: TestUser;
  outsider: TestUser;
  tenantA: z.infer<typeof createdTenantView>;
  tenantB: z.infer<typeof createdTenantView>;
  offset: number;
}
export async function newUser(f: Fixture, label: string, verified = true): Promise<TestUser> {
  const uid = `${label}-${randomUUID()}`;
  const email = `${uid}@example.invalid`;
  const password = randomBytes(24).toString('base64url');
  await f.firebase.auth.createUser({ uid, email, password, emailVerified: verified });
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body: unknown = await response.json();
  if (
    !response.ok ||
    !body ||
    typeof body !== 'object' ||
    !('idToken' in body) ||
    typeof body.idToken !== 'string'
  )
    throw new Error('Falha no login sintético local');
  return { uid, email, token: body.idToken };
}
export const bearer = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
/** Awaits an async request helper and asserts its status with the error code in the message. */
export async function expectStatus(pending: PromiseLike<request.Response>, status: number) {
  const response = await pending;
  if (response.status !== status)
    throw new Error(
      `Esperado ${status}, recebido ${response.status}: ${response.body?.error?.code}`,
    );
  return response;
}
export const tenantHeaders = (user: TestUser, tenantId: string) => ({
  ...bearer(user),
  'X-Tenant-Id': tenantId,
});
/** POST /admin/tenants body on an official plan, billing from today. */
export const tenantInput = (
  name: string,
  ownerEmail: string,
  planCode: PlanCode = 'profissional',
  extra: object = {},
) => ({
  name,
  ownerEmail,
  planCode,
  billingDay: 10,
  billingStartsOn: billingDate(new Date()),
  ...extra,
});
/** Current subscription version, for commands that require `expectedVersion`. */
export async function subscriptionVersion(f: Fixture, tenantId = f.tenantA.tenant.id) {
  return (await f.firebase.db.doc(`subscriptions/${tenantId}`).get()).get('version') as number;
}
/**
 * Blocks the company's access. Suspension uses the Super Admin command; `canceled` is a legacy
 * state with no command (cancellation is not offered), so it is written directly.
 */
export async function blockSubscription(
  f: Fixture,
  status: 'suspended' | 'canceled',
  tenantId = f.tenantA.tenant.id,
) {
  if (status === 'canceled') {
    await f.firebase.db.doc(`subscriptions/${tenantId}`).update({ status });
    return;
  }
  await expectStatus(
    request(f.app)
      .post(`/api/v1/admin/subscriptions/${tenantId}/suspend`)
      .set(bearer(f.platform))
      .send({
        expectedVersion: await subscriptionVersion(f, tenantId),
        reason: 'Bloqueio de teste',
      }),
    200,
  );
}
async function clearLocalFixture(url: string) {
  // Emulator locks can outlive the completed request. Retry only its known
  // clearData lock-timeout response; never retry assertions/application commands.
  const deadline = Date.now() + 90_000;
  let retries = 0;
  for (;;) {
    const response = await fetch(url, { method: 'DELETE' });
    if (response.ok) {
      if (retries > 0) console.info(JSON.stringify({ fixtureClearLockRetries: retries }));
      return;
    }
    const body = await response.text();
    if (
      !url.startsWith('http://127.0.0.1:8080/emulator/v1/projects/demo-lastro-tests/') ||
      ![409, 500].includes(response.status) ||
      !body.includes('Transaction lock timeout') ||
      Date.now() >= deadline
    )
      throw new Error('Falha ao limpar somente fixtures do projeto demo-lastro-tests');
    retries++;
    await delay(1000);
  }
}
export function registerFixture(options: { rateLimitMax?: number } = {}): Fixture {
  const f = {} as Fixture;
  beforeAll(() => {
    if (
      process.env.FIREBASE_PROJECT_ID !== 'demo-lastro-tests' ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199'
    )
      throw new Error('Testes recusam projeto real ou emuladores não locais');
    f.config = loadConfig();
    if (options.rateLimitMax !== undefined)
      f.config = { ...f.config, rateLimitMax: options.rateLimitMax };
    f.firebase = createFirebase(f.config);
    f.offset = 0;
    if (f.firebase.bucket.name !== 'demo-lastro-tests.appspot.com')
      throw new Error('Bucket de teste inválido');
    f.app = createApp(f.config, f.firebase, () => new Date(Date.now() + f.offset));
  });
  beforeEach(async () => {
    f.offset = 0;
    await f.firebase.bucket.deleteFiles({ prefix: 'tenants/', force: true });
    for (const url of [
      `http://127.0.0.1:8080/emulator/v1/projects/demo-lastro-tests/databases/(default)/documents`,
      `http://127.0.0.1:9099/emulator/v1/projects/demo-lastro-tests/accounts`,
    ]) {
      await clearLocalFixture(url);
    }
    f.platform = await newUser(f, 'platform');
    f.ownerA = await newUser(f, 'owner-a');
    f.ownerB = await newUser(f, 'owner-b');
    f.outsider = await newUser(f, 'outsider');
    const now = new Date().toISOString();
    await f.firebase.db.doc(`identities/${f.platform.uid}`).set({
      uid: f.platform.uid,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    });
    await f.firebase.db
      .doc(`platformAdmins/${f.platform.uid}`)
      .set({ uid: f.platform.uid, status: 'active', createdAt: now, schemaVersion: 1 });
    // Profissional: 2 users and every existing capability, as the former test plan.
    for (const [name, owner, field] of [
      ['Empresa A', f.ownerA, 'tenantA'],
      ['Empresa B', f.ownerB, 'tenantB'],
    ] as const) {
      const response = await request(f.app)
        .post('/api/v1/admin/tenants')
        .set(bearer(f.platform))
        .set('Idempotency-Key', randomUUID())
        .send(tenantInput(name, owner.email))
        .expect(201);
      f[field] = createdTenantView.parse(response.body.data);
      await request(f.app)
        .post('/api/v1/users/invitations/accept')
        .set(bearer(owner))
        .send({ token: f[field].ownerInvitation.token })
        .expect(200);
    }
  });
  afterAll(async () => {
    await f.firebase.db.terminate();
    await deleteApp(f.firebase.app);
  });
  return f;
}
export async function issue(
  f: Fixture,
  user: TestUser,
  role: 'administrator' | 'seller' = 'administrator',
) {
  return request(f.app)
    .post('/api/v1/users/invitations')
    .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
    .send({ email: user.email, role });
}
export async function join(
  f: Fixture,
  user: TestUser,
  role: 'administrator' | 'seller' = 'administrator',
) {
  const invitation = await issue(f, user, role);
  if (invitation.status !== 201) throw new Error(`Convite falhou: ${invitation.body.error?.code}`);
  return request(f.app)
    .post('/api/v1/users/invitations/accept')
    .set(bearer(user))
    .send({ token: invitation.body.data.token });
}
