import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { spawnSync } from 'node:child_process';
import { FieldValue } from 'firebase-admin/firestore';
import {
  registerFixture,
  newUser,
  join,
  expectStatus,
  tenantHeaders,
  type Fixture,
} from '../helpers/fixture.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../../src/modules/auth/accessService.js';
import { PlanMigration } from '../../src/modules/platformAdmin/planMigration.js';
import { BillingService, billingJobActor } from '../../src/modules/billing/billingService.js';

const f = registerFixture();

/** Recreates documents as they were before the official plans existed. */
async function legacyCompanies(fixture: Fixture) {
  const legacy = {
    planId: 'plano-inicial',
    planCode: FieldValue.delete(),
    billingDay: FieldValue.delete(),
    billingStartsOn: FieldValue.delete(),
    billingContact: FieldValue.delete(),
    monthlyPriceCents: 20000,
  };
  // Pilot: owner + a second user, plus the Super Admin counted as a member (old behaviour).
  // The second user joins before the plan fields are removed: without a plan nobody is invited.
  await expectStatus(join(fixture, await newUser(fixture, 'segundo'), 'seller'), 200);
  await fixture.firebase.db.doc(`subscriptions/${fixture.tenantA.subscription.id}`).update(legacy);
  await fixture.firebase.db
    .doc(`subscriptions/${fixture.tenantB.subscription.id}`)
    .update({ ...legacy, userLimit: 5 });
  const now = new Date().toISOString();
  await fixture.firebase.db
    .doc(`tenants/${fixture.tenantA.tenant.id}/memberships/${fixture.platform.uid}`)
    .set({
      uid: fixture.platform.uid,
      tenantId: fixture.tenantA.tenant.id,
      role: 'administrator',
      status: 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    });
  await fixture.firebase.db
    .doc(`tenants/${fixture.tenantA.tenant.id}`)
    .update({ activeUsers: 3, activeAdmins: 2 });
}
const migration = (fixture: Fixture) => {
  const repo = new FoundationRepository(fixture.firebase.db);
  return new PlanMigration(repo, new AccessService(repo));
};
const doc = async (fixture: Fixture, path: string) =>
  (await fixture.firebase.db.doc(path).get()).data()!;

describe('Migração das empresas existentes', () => {
  it('dry-run não escreve; aplicação preserva usuários, valor e acesso, sem cobranças', async () => {
    await legacyCompanies(f);
    const before = await doc(f, `subscriptions/${f.tenantA.subscription.id}`);
    const dry = await migration(f).run({ apply: false });
    expect(dry).toMatchObject({ mode: 'dry-run', examined: 2, migrated: 1, skipped: 1 });
    expect(await doc(f, `subscriptions/${f.tenantA.subscription.id}`)).toEqual(before);

    const applied = await migration(f).run({ apply: true });
    const pilot = applied.entries.find((e) => e.tenantId === f.tenantA.tenant.id)!;
    expect(pilot).toMatchObject({
      action: 'migrated',
      exemptedMemberships: 1,
      warnings: [],
      before: { planCode: null, status: 'active', userLimit: 2, priceCents: 20000 },
      after: { planCode: 'profissional', status: 'pending', userLimit: 2, priceCents: 20000 },
    });
    expect(applied.entries.find((e) => e.tenantId === f.tenantB.tenant.id)).toMatchObject({
      action: 'skipped',
      skipped: 'custom_user_limit',
    });
    expect(await doc(f, `subscriptions/${f.tenantB.subscription.id}`)).toMatchObject({
      userLimit: 5,
      planId: 'plano-inicial',
    });
    expect(await doc(f, `tenants/${f.tenantA.tenant.id}`)).toMatchObject({
      activeUsers: 2,
      activeAdmins: 1,
    });
    const members = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/memberships`)
      .get();
    expect(members.docs.map((m) => m.get('status'))).toEqual(['active', 'active', 'active']);
    expect(
      (await doc(f, `tenants/${f.tenantA.tenant.id}/memberships/${f.platform.uid}`)).seatExempt,
    ).toBe(true);
    expect((await doc(f, `subscriptions/${f.tenantA.subscription.id}`)).billingContact).toEqual({
      name: null,
      email: f.ownerA.email,
      phone: null,
    });
    // Access and every capability remain; nothing is charged before activation.
    await request(f.app)
      .get('/api/v1/catalog-settings')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
    const repo = new FoundationRepository(f.firebase.db);
    await new BillingService(repo, new AccessService(repo), f.config).generateDue(
      billingJobActor(),
    );
    expect((await f.firebase.db.collection('billingCharges').get()).size).toBe(0);
    const audits = await f.firebase.db
      .collection('auditLogs')
      .where('action', 'in', ['subscription.migrated', 'membership.seat_exempted'])
      .get();
    expect(audits.size).toBe(2);
    // Idempotent: a second run finds nothing left to change.
    const again = await migration(f).run({ apply: true });
    expect(again).toMatchObject({ migrated: 0, exemptedMemberships: 0, alreadyOfficial: 1 });
  });
  it('linha de comando é dry-run por padrão e rejeita argumentos desconhecidos', async () => {
    await legacyCompanies(f);
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ['--import', 'tsx', 'src/jobs/migratePlans.ts', ...args], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
      });
    const dry = run();
    expect(dry.status, dry.stderr).toBe(0);
    expect(JSON.parse(dry.stdout)).toMatchObject({ mode: 'dry-run', migrated: 1 });
    expect((await doc(f, `subscriptions/${f.tenantA.subscription.id}`)).planCode).toBeUndefined();
    expect(run('--force').status).not.toBe(0);
    const applied = run('--apply', `--tenant=${f.tenantA.tenant.id}`);
    expect(applied.status, applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({ mode: 'apply', examined: 1, migrated: 1 });
  }, 60_000);
});
