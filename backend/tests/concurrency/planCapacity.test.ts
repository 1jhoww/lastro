import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  registerFixture,
  newUser,
  issue,
  join,
  tenantHeaders,
  expectStatus,
  bearer,
} from '../helpers/fixture.js';
const f = registerFixture();

const onProfissional = () =>
  f.firebase.db
    .doc(`subscriptions/${f.tenantA.subscription.id}`)
    .update({ planCode: 'profissional', userLimit: 2 });
const tenant = async () =>
  (await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}`).get()).data()!;

describe('Limites do plano sob concorrência', () => {
  it('downgrade e convite simultâneos nunca deixam a empresa acima do novo limite', async () => {
    const invitee = await newUser(f, 'corrida');
    const [downgrade, invited] = await Promise.all([
      request(f.app)
        .post(`/api/v1/admin/subscriptions/${f.tenantA.subscription.id}/plan`)
        .set(bearer(f.platform))
        .send({
          expectedVersion: 1,
          planCode: 'essencial',
          acknowledgedLostFeatures: ['users.invite', 'catalog.public', 'commercial.sellers'],
          reason: 'Corrida de teste',
        }),
      issue(f, invitee),
    ]);
    const subscription = (
      await f.firebase.db.doc(`subscriptions/${f.tenantA.subscription.id}`).get()
    ).data()!;
    const pending = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/invitations`)
      .where('status', '==', 'pending')
      .get();
    expect((await tenant()).activeUsers + pending.size).toBeLessThanOrEqual(subscription.userLimit);
    // Either order is valid, but exactly one of them wins.
    expect([downgrade.status === 200, invited.status === 201].filter(Boolean)).toHaveLength(1);
    if (downgrade.status !== 200) expect(downgrade.body.error.code).toBe('USER_LIMIT_REACHED');
    else expect(invited.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
  });
  it('Profissional: cinco convites simultâneos reservam somente a vaga livre', async () => {
    await onProfissional();
    const invitees = await Promise.all(
      Array.from({ length: 5 }, (_, i) => newUser(f, `paralelo-${i}`)),
    );
    const results = await Promise.all(invitees.map((user) => issue(f, user)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const rejected of results.filter((r) => r.status !== 201))
      expect(rejected.body.error.code).toBe('USER_LIMIT_REACHED');
    const pending = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/invitations`)
      .where('status', '==', 'pending')
      .get();
    expect(pending.size).toBe(1);
  });
  it('Profissional: reativação e convite disputando a mesma vaga não ultrapassam o limite', async () => {
    const member = await newUser(f, 'membro');
    await expectStatus(join(f, member), 200);
    await request(f.app)
      .patch(`/api/v1/users/${member.uid}/status`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ status: 'disabled', expectedVersion: 1 })
      .expect(200);
    await onProfissional();
    const newcomer = await newUser(f, 'novo');
    const [reactivated, invited] = await Promise.all([
      request(f.app)
        .patch(`/api/v1/users/${member.uid}/status`)
        .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
        .send({ status: 'active', expectedVersion: 2 }),
      issue(f, newcomer),
    ]);
    // Exactly one of them takes the free seat.
    expect([reactivated.status, invited.status].filter((s) => s === 409)).toHaveLength(1);
    const pending = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/invitations`)
      .where('status', '==', 'pending')
      .get();
    expect((await tenant()).activeUsers + pending.size).toBe(2);
  });
});
