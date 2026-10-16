import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  registerFixture,
  tenantHeaders,
  bearer,
  newUser,
  expectStatus,
  tenantInput,
  issue,
  join,
  type Fixture,
} from '../helpers/fixture.js';
import { configure, publicPath } from '../helpers/catalog.js';
import type { PlanCode } from '../../src/modules/plans/catalog.js';

const f = registerFixture();

/** Places tenant A directly on an official plan (the admin flow arrives in a later stage). */
async function onPlan(fixture: Fixture, planCode: PlanCode | null, userLimit: number) {
  await fixture.firebase.db
    .doc(`subscriptions/${fixture.tenantA.subscription.id}`)
    .update({ planCode, userLimit });
}
const users = (fixture: Fixture) =>
  request(fixture.app)
    .get('/api/v1/users')
    .set(tenantHeaders(fixture.ownerA, fixture.tenantA.tenant.id))
    .expect(200);
const tenantDoc = async (fixture: Fixture) =>
  (await fixture.firebase.db.doc(`tenants/${fixture.tenantA.tenant.id}`).get()).data()!;

describe('Plano Essencial', () => {
  it('limita a 1 usuário, sem convites, sem vitrine e reflete isso no /me', async () => {
    await onPlan(f, 'essencial', 1);
    const invite = await issue(f, await newUser(f, 'extra'));
    expect(invite.status).toBe(403);
    expect(invite.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    const settings = await request(f.app)
      .get('/api/v1/catalog-settings')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(403);
    expect(settings.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    const me = (await request(f.app).get('/api/v1/me').set(bearer(f.ownerA)).expect(200)).body.data;
    const membership = me.memberships.find(
      (m: { tenantId: string }) => m.tenantId === f.tenantA.tenant.id,
    );
    expect(membership.plan).toEqual({
      code: 'essencial',
      name: 'Essencial',
      userLimit: 1,
      features: [],
    });
    expect(membership.permissions).not.toContain('catalog:manage');
    expect(membership.permissions).toContain('orders:all:manage');
    expect((await users(f)).body.data.capacity).toEqual({
      userLimit: 1,
      activeUsers: 1,
      reservedInvitations: 0,
      available: 0,
    });
  });
  it('rejeita aceite de convite antigo que ultrapassaria o limite', async () => {
    const invitee = await newUser(f, 'antigo');
    const invite = await expectStatus(issue(f, invitee), 201);
    await onPlan(f, 'essencial', 1);
    const accepted = await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(invitee))
      .send({ token: invite.body.data.token })
      .expect(409);
    expect(accepted.body.error.code).toBe('USER_LIMIT_REACHED');
    expect((await tenantDoc(f)).activeUsers).toBe(1);
  });
  it('rejeita reativação de usuário desativado acima do limite', async () => {
    const member = await newUser(f, 'membro');
    await expectStatus(join(f, member), 200);
    await request(f.app)
      .patch(`/api/v1/users/${member.uid}/status`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ status: 'disabled', expectedVersion: 1 })
      .expect(200);
    await onPlan(f, 'essencial', 1);
    const reactivated = await request(f.app)
      .patch(`/api/v1/users/${member.uid}/status`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ status: 'active', expectedVersion: 2 })
      .expect(409);
    expect(reactivated.body.error.code).toBe('USER_LIMIT_REACHED');
  });
  it('não permite tornar alguém vendedor sem o recurso de vendedores', async () => {
    const member = await newUser(f, 'admin2');
    await expectStatus(join(f, member), 200);
    await onPlan(f, 'essencial', 2);
    const changed = await request(f.app)
      .patch(`/api/v1/users/${member.uid}/role`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ role: 'seller', expectedVersion: 1 })
      .expect(403);
    expect(changed.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
  });
  it('vitrine publicada deixa de ser servida e volta no Profissional sem perder a configuração', async () => {
    await configure(f).expect(200);
    await request(f.app).get(publicPath()).expect(200);
    await onPlan(f, 'essencial', 1);
    await request(f.app).get(publicPath()).expect(404);
    await onPlan(f, 'profissional', 2);
    await request(f.app).get(publicPath()).expect(200);
  });
});

describe('Plano Profissional', () => {
  it('permite convites até 2 usuários, contando convites pendentes', async () => {
    await onPlan(f, 'profissional', 2);
    const first = await newUser(f, 'primeiro');
    await expectStatus(issue(f, first, 'seller'), 201);
    expect((await users(f)).body.data.capacity).toEqual({
      userLimit: 2,
      activeUsers: 1,
      reservedInvitations: 1,
      available: 0,
    });
    const second = await issue(f, await newUser(f, 'segundo'));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('USER_LIMIT_REACHED');
    const me = (await request(f.app).get('/api/v1/me').set(bearer(f.ownerA)).expect(200)).body.data;
    expect(me.memberships[0].permissions).toContain('catalog:manage');
  });
  it('contrato legado preserva limite e recursos contratados', async () => {
    await onPlan(f, null, 2);
    const me = (await request(f.app).get('/api/v1/me').set(bearer(f.ownerA)).expect(200)).body.data;
    expect(me.memberships[0].plan).toMatchObject({ code: null, name: null, userLimit: 2 });
    expect(me.memberships[0].permissions).toContain('catalog:manage');
  });
});

describe('Super Admin não ocupa vaga', () => {
  it('convite e vínculo de suporte não reservam vaga nem contam como usuário', async () => {
    await onPlan(f, 'profissional', 2);
    const invite = await expectStatus(issue(f, f.platform), 201);
    expect(invite.body.data.invitation.seatExempt).toBe(true);
    expect((await users(f)).body.data.capacity.available).toBe(1);
    const accepted = await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.platform))
      .send({ token: invite.body.data.token })
      .expect(200);
    expect(accepted.body.data.user.seatExempt).toBe(true);
    expect(await tenantDoc(f)).toMatchObject({ activeUsers: 1, activeAdmins: 1 });
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.platform, f.tenantA.tenant.id))
      .expect(200);
    // The customer still has its second seat.
    await expectStatus(join(f, await newUser(f, 'cliente')), 200);
    expect(await tenantDoc(f)).toMatchObject({ activeUsers: 2 });
  });
  it('no Essencial o cliente pode liberar acesso de suporte sem perder a vaga', async () => {
    await onPlan(f, 'essencial', 1);
    const invite = await expectStatus(issue(f, f.platform), 201);
    await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.platform))
      .send({ token: invite.body.data.token })
      .expect(200);
    expect((await tenantDoc(f)).activeUsers).toBe(1);
  });
  it('acesso de suporte termina quando a conta deixa de ser Super Admin', async () => {
    const invite = await expectStatus(issue(f, f.platform), 201);
    await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.platform))
      .send({ token: invite.body.data.token })
      .expect(200);
    await f.firebase.db.doc(`platformAdmins/${f.platform.uid}`).update({ status: 'disabled' });
    const denied = await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.platform, f.tenantA.tenant.id))
      .expect(403);
    expect(denied.body.error.code).toBe('TENANT_ACCESS_DENIED');
    const me = (await request(f.app).get('/api/v1/me').set(bearer(f.platform)).expect(200)).body
      .data;
    expect(me.memberships).toEqual([]);
    expect(me.platformAdmin).toBe(false);
  });
  it('primeiro administrador da empresa não pode ser o Super Admin', async () => {
    const created = await request(f.app)
      .post('/api/v1/admin/tenants')
      .set(bearer(f.platform))
      .set('Idempotency-Key', randomUUID())
      .send(tenantInput('Empresa C', f.platform.email))
      .expect(201);
    const accepted = await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.platform))
      .send({ token: created.body.data.ownerInvitation.token })
      .expect(409);
    expect(accepted.body.error.code).toBe('CUSTOMER_ADMIN_REQUIRED');
  });
});
