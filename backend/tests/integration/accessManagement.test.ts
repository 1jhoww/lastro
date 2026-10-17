import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  registerFixture,
  tenantHeaders,
  bearer,
  newUser,
  expectStatus,
  issue,
  join,
  type Fixture,
  type TestUser,
} from '../helpers/fixture.js';
import { createApp } from '../../src/app/app.js';
import type { PlanCode } from '../../src/modules/plans/catalog.js';

const f = registerFixture();

/** Places tenant A on a plan with a given seat limit (contract snapshot). */
async function onPlan(fixture: Fixture, planCode: PlanCode, userLimit: number) {
  await fixture.firebase.db
    .doc(`subscriptions/${fixture.tenantA.subscription.id}`)
    .update({ planCode, userLimit });
}
const tenantA = () => f.tenantA.tenant.id;
const admin = () => tenantHeaders(f.ownerA, tenantA());
const capacity = async () =>
  (await request(f.app).get('/api/v1/users').set(admin()).expect(200)).body.data.capacity;
const accept = (user: TestUser, token: string) =>
  request(f.app).post('/api/v1/users/invitations/accept').set(bearer(user)).send({ token });
const member = async (uid: string) =>
  (await f.firebase.db.doc(`tenants/${tenantA()}/memberships/${uid}`).get()).data()!;
const setStatus = (uid: string, status: 'active' | 'disabled', expectedVersion: number) =>
  request(f.app)
    .patch(`/api/v1/users/${uid}/status`)
    .set(admin())
    .send({ status, expectedVersion });
const platformInvite = (email: string, role: 'administrator' | 'seller' = 'seller') =>
  request(f.app)
    .post(`/api/v1/admin/companies/${tenantA()}/invitations`)
    .set(bearer(f.platform))
    .send({ email, role, reason: 'Novo acesso solicitado' });
/** Fresh ID token from the Auth emulator, as a sign-in with e-mail and password. */
async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { idToken?: string };
  if (!response.ok || !body.idToken) throw new Error('Falha no login sintético local');
  return body.idToken;
}
async function seller(): Promise<TestUser> {
  const user = await newUser(f, 'seller');
  await expectStatus(join(f, user, 'seller'), 200);
  return user;
}

describe('Vagas por plano', () => {
  it('plano com 1 acesso impede convites adicionais, inclusive do Super Admin', async () => {
    await onPlan(f, 'profissional', 1);
    const invite = await issue(f, await newUser(f, 'extra'));
    expect(invite.status).toBe(409);
    expect(invite.body.error.code).toBe('USER_LIMIT_REACHED');
    expect(invite.body.error.message).toBe(
      'Seu plano permite até 1 usuário. Todos os acessos estão ocupados.',
    );
    const platform = await platformInvite((await newUser(f, 'extra2')).email);
    expect(platform.status).toBe(409);
    expect(platform.body.error.code).toBe('USER_LIMIT_REACHED');
    await onPlan(f, 'essencial', 1);
    expect((await issue(f, await newUser(f, 'extra3'))).body.error.code).toBe(
      'FEATURE_NOT_IN_PLAN',
    );
  });
  it('plano com 2 acessos permite somente um funcionário além do administrador', async () => {
    await onPlan(f, 'profissional', 2);
    await expectStatus(issue(f, await newUser(f, 'um'), 'seller'), 201);
    const second = await issue(f, await newUser(f, 'dois'), 'seller');
    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe(
      'Seu plano permite até 2 usuários. Todos os acessos estão ocupados.',
    );
  });
  it('plano com 3 acessos permite somente dois funcionários além do administrador', async () => {
    await onPlan(f, 'profissional', 3);
    await expectStatus(issue(f, await newUser(f, 'um'), 'seller'), 201);
    await expectStatus(join(f, await newUser(f, 'dois'), 'seller'), 200);
    expect((await issue(f, await newUser(f, 'tres'), 'seller')).status).toBe(409);
    expect(await capacity()).toEqual({
      userLimit: 3,
      activeUsers: 2,
      reservedInvitations: 1,
      available: 0,
    });
  });
  it('convite pendente ocupa vaga e convite aceito não conta duas vezes', async () => {
    const invitee = await newUser(f, 'pendente');
    const invite = await expectStatus(issue(f, invitee, 'seller'), 201);
    expect(await capacity()).toMatchObject({
      activeUsers: 1,
      reservedInvitations: 1,
      available: 0,
    });
    await expectStatus(accept(invitee, invite.body.data.token), 200);
    expect(await capacity()).toMatchObject({
      activeUsers: 2,
      reservedInvitations: 0,
      available: 0,
    });
  });
  it('convite revogado e convite expirado liberam a vaga', async () => {
    const invite = await expectStatus(issue(f, await newUser(f, 'revogado'), 'seller'), 201);
    await request(f.app)
      .post(`/api/v1/users/invitations/${invite.body.data.invitation.id}/revoke`)
      .set(admin())
      .expect(200);
    expect(await capacity()).toMatchObject({ reservedInvitations: 0, available: 1 });
    await expectStatus(issue(f, await newUser(f, 'expira'), 'seller'), 201);
    f.offset = 8 * 86400000;
    expect(await capacity()).toMatchObject({ reservedInvitations: 0, available: 1 });
    await expectStatus(issue(f, await newUser(f, 'depois'), 'seller'), 201);
  });
  it('desativação libera a vaga e reativação sem vaga é bloqueada', async () => {
    const person = await seller();
    await expectStatus(setStatus(person.uid, 'disabled', 1), 200);
    expect(await capacity()).toMatchObject({ activeUsers: 1, available: 1 });
    await expectStatus(issue(f, await newUser(f, 'substituto'), 'seller'), 201);
    const reactivated = await setStatus(person.uid, 'active', 2);
    expect(reactivated.status).toBe(409);
    expect(reactivated.body.error.code).toBe('USER_LIMIT_REACHED');
    // History is preserved: the membership stays, only disabled.
    expect((await member(person.uid)).status).toBe('disabled');
  });
  it('convites simultâneos não ultrapassam o limite', async () => {
    await onPlan(f, 'profissional', 3);
    const people = await Promise.all([1, 2, 3, 4, 5].map((i) => newUser(f, `c${i}`)));
    const results = await Promise.all(people.map((person) => issue(f, person, 'seller')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await capacity()).toMatchObject({ reservedInvitations: 2, available: 0 });
  });
  it('limites continuam válidos após reinicialização do ambiente', async () => {
    await expectStatus(issue(f, await newUser(f, 'antes'), 'seller'), 201);
    const restarted = createApp(f.config, f.firebase);
    const response = await request(restarted)
      .post('/api/v1/users/invitations')
      .set(admin())
      .send({ email: (await newUser(f, 'depois')).email, role: 'seller' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('USER_LIMIT_REACHED');
  });
});

describe('Reenvio e correção de convite', () => {
  it('alterar o e-mail invalida o convite antigo e mantém a mesma vaga', async () => {
    const wrong = await newUser(f, 'errado');
    const right = await newUser(f, 'certo');
    const invite = await expectStatus(issue(f, wrong, 'seller'), 201);
    const reissued = await expectStatus(
      request(f.app)
        .post(`/api/v1/users/invitations/${invite.body.data.invitation.id}/reissue`)
        .set(admin())
        .send({ email: right.email }),
      201,
    );
    expect(reissued.body.data.invitation.email).toBe(right.email);
    expect(await capacity()).toMatchObject({ reservedInvitations: 1, available: 0 });
    expect((await accept(wrong, invite.body.data.token)).status).toBe(403);
    await expectStatus(accept(right, reissued.body.data.token), 200);
    const old = await f.firebase.db
      .doc(`tenants/${tenantA()}/invitations/${invite.body.data.invitation.id}`)
      .get();
    expect(old.get('status')).toBe('revoked');
    expect(old.get('replacedBy')).toBe(reissued.body.data.invitation.id);
  });
  it('convite revogado não é reutilizado e expirado só volta com vaga livre', async () => {
    const invite = await expectStatus(issue(f, await newUser(f, 'x'), 'seller'), 201);
    const id = invite.body.data.invitation.id;
    await request(f.app).post(`/api/v1/users/invitations/${id}/revoke`).set(admin()).expect(200);
    const reused = await request(f.app)
      .post(`/api/v1/users/invitations/${id}/reissue`)
      .set(admin())
      .send({});
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('INVITATION_REVOKED');
    const expiring = await expectStatus(issue(f, await newUser(f, 'y'), 'seller'), 201);
    f.offset = 8 * 86400000;
    await expectStatus(issue(f, await newUser(f, 'z'), 'seller'), 201);
    const resent = await request(f.app)
      .post(`/api/v1/users/invitations/${expiring.body.data.invitation.id}/reissue`)
      .set(admin())
      .send({});
    expect(resent.body.error.code).toBe('USER_LIMIT_REACHED');
  });
});

describe('Super Admin', () => {
  it('cria convite para empresa existente quando há vaga e reenvia com e-mail corrigido', async () => {
    const wrong = await newUser(f, 'sa-errado');
    const right = await newUser(f, 'sa-certo');
    const created = await expectStatus(platformInvite(wrong.email), 201);
    const reissued = await expectStatus(
      request(f.app)
        .post(
          `/api/v1/admin/companies/${tenantA()}/invitations/${created.body.data.invitation.id}/reissue`,
        )
        .set(bearer(f.platform))
        .send({ email: right.email, reason: 'E-mail digitado errado' }),
      201,
    );
    await expectStatus(accept(right, reissued.body.data.token), 200);
    const detail = (
      await request(f.app)
        .get(`/api/v1/admin/companies/${tenantA()}`)
        .set(bearer(f.platform))
        .expect(200)
    ).body.data;
    expect(detail.capacity).toMatchObject({ userLimit: 2, activeUsers: 2, available: 0 });
    const logs = await f.firebase.db
      .collection('auditLogs')
      .where('tenantId', '==', tenantA())
      .where('action', '==', 'invitation.reissued')
      .get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0]!.get('changes.reason')).toBe('E-mail digitado errado');
  });
  it('não ultrapassa o limite contratado e preserva o último administrador', async () => {
    await expectStatus(platformInvite((await newUser(f, 'um')).email), 201);
    expect((await platformInvite((await newUser(f, 'dois')).email)).status).toBe(409);
    const lastAdmin = await request(f.app)
      .post(`/api/v1/admin/companies/${tenantA()}/users/${f.ownerA.uid}/status`)
      .set(bearer(f.platform))
      .send({ status: 'disabled', expectedVersion: 1, reason: 'Teste' });
    expect(lastAdmin.status).toBe(409);
    expect(lastAdmin.body.error.code).toBe('LAST_ADMIN_REQUIRED');
  });
  it('substitui acesso desativando e convidando outra pessoa', async () => {
    const person = await seller();
    await expectStatus(
      request(f.app)
        .post(`/api/v1/admin/companies/${tenantA()}/users/${person.uid}/status`)
        .set(bearer(f.platform))
        .send({ status: 'disabled', expectedVersion: 1, reason: 'Saiu da empresa' }),
      200,
    );
    await expectStatus(platformInvite((await newUser(f, 'novo')).email), 201);
  });
  it('não age sobre convite de outra empresa', async () => {
    const invite = await expectStatus(issue(f, await newUser(f, 'a'), 'seller'), 201);
    await request(f.app)
      .post(
        `/api/v1/admin/companies/${f.tenantB.tenant.id}/invitations/${invite.body.data.invitation.id}/reissue`,
      )
      .set(bearer(f.platform))
      .send({ reason: 'Teste cruzado' })
      .expect(404);
  });
});

describe('Alteração de e-mail de conta ativa', () => {
  it('preserva identidade e vínculos e só conclui após o provedor aplicar o novo e-mail', async () => {
    const person = await seller();
    const newEmail = `novo-${person.uid}@example.invalid`.toLowerCase();
    const taken = await request(f.app)
      .post(`/api/v1/admin/companies/${tenantA()}/users/${person.uid}/email-change`)
      .set(bearer(f.platform))
      .send({ newEmail: f.ownerB.email, reason: 'Troca' });
    expect(taken.body.error.code).toBe('EMAIL_IN_USE');
    await expectStatus(
      request(f.app)
        .post(`/api/v1/admin/companies/${tenantA()}/users/${person.uid}/email-change`)
        .set(bearer(f.platform))
        .send({ newEmail, reason: 'E-mail corporativo novo' }),
      201,
    );
    const mine = await request(f.app)
      .get('/api/v1/me/email-change')
      .set(bearer(person))
      .expect(200);
    expect(mine.body.data.emailChange.newEmail).toBe(newEmail);
    // Nothing changes before the holder verifies the new address with the provider.
    const early = await request(f.app).post('/api/v1/me/email-change/complete').set(bearer(person));
    expect(early.body.error.code).toBe('EMAIL_CHANGE_NOT_CONFIRMED');
    expect((await f.firebase.auth.getUser(person.uid)).email).toBe(person.email);
    // What Firebase does once the verification link sent to the new address is opened; the
    // provider may end older sessions, so the holder signs in again with the new address.
    const password = `senha-${person.uid}`;
    await f.firebase.auth.updateUser(person.uid, {
      email: newEmail,
      emailVerified: true,
      password,
    });
    const renewed = { ...person, email: newEmail, token: await signIn(newEmail, password) };
    await expectStatus(
      request(f.app).post('/api/v1/me/email-change/complete').set(bearer(renewed)),
      200,
    );
    expect((await member(person.uid)).status).toBe('active');
    expect((await member(person.uid)).role).toBe('seller');
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(renewed, tenantA()))
      .expect(200);
    const identities = await f.firebase.db
      .collection('identities')
      .where('uid', '==', person.uid)
      .get();
    expect(identities.size).toBe(1);
  });
});

describe('Permissões e restrições de vendedores', () => {
  it('vendedor não gerencia usuários nem eleva os próprios privilégios', async () => {
    const person = await seller();
    const headers = tenantHeaders(person, tenantA());
    await request(f.app).get('/api/v1/users').set(headers).expect(403);
    await request(f.app)
      .post('/api/v1/users/invitations')
      .set(headers)
      .send({ email: (await newUser(f, 'x')).email, role: 'seller' })
      .expect(403);
    await request(f.app)
      .patch(`/api/v1/users/${person.uid}/permissions`)
      .set(headers)
      .send({ operations: ['users.manage'], expectedVersion: 1 })
      .expect(403);
    await request(f.app)
      .patch(`/api/v1/users/${person.uid}/role`)
      .set(headers)
      .send({ role: 'administrator', expectedVersion: 1 })
      .expect(403);
  });
  it('vendedor nunca recebe financeiro administrativo nem gestão de usuários', async () => {
    const person = await seller();
    await request(f.app)
      .get('/api/v1/receivables')
      .set(tenantHeaders(person, tenantA()))
      .expect(403);
    for (const operation of [
      'finance.view',
      'finance.receive',
      'finance.reverse',
      'users.manage',
    ]) {
      const response = await request(f.app)
        .patch(`/api/v1/users/${person.uid}/permissions`)
        .set(admin())
        .send({ operations: [operation], expectedVersion: 1 });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('PERMISSION_NOT_ALLOWED');
    }
  });
  it('alterações de permissões são respeitadas nas APIs protegidas', async () => {
    const person = await seller();
    const headers = tenantHeaders(person, tenantA());
    await request(f.app).get('/api/v1/inventory/movements').set(headers).expect(403);
    await request(f.app).get('/api/v1/orders').set(headers).expect(200);
    const missing = await request(f.app)
      .patch(`/api/v1/users/${person.uid}/permissions`)
      .set(admin())
      .send({ operations: ['orders.confirm'], expectedVersion: 1 });
    expect(missing.status).toBe(422);
    const updated = await expectStatus(
      request(f.app)
        .patch(`/api/v1/users/${person.uid}/permissions`)
        .set(admin())
        .send({
          operations: ['customers.manage', 'products.view', 'inventory.view', 'inventory.manage'],
          expectedVersion: 1,
        }),
      200,
    );
    expect(updated.body.data.customOperations).toBe(true);
    await request(f.app).get('/api/v1/inventory/movements').set(headers).expect(200);
    await request(f.app).get('/api/v1/orders').set(headers).expect(403);
    const stale = await request(f.app)
      .patch(`/api/v1/users/${person.uid}/permissions`)
      .set(admin())
      .send({ operations: [], expectedVersion: 1 });
    expect(stale.body.error.code).toBe('CONFLICT');
    const me = (await request(f.app).get('/api/v1/me').set(bearer(person)).expect(200)).body.data;
    expect(me.memberships[0].permissions).toContain('inventory:manage');
    expect(me.memberships[0].permissions).not.toContain('orders:own:read');
  });
  it('usuário desativado perde acesso mesmo com token válido', async () => {
    const person = await seller();
    await expectStatus(setStatus(person.uid, 'disabled', 1), 200);
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(person, tenantA()))
      .expect(403);
  });
  it('uma empresa não modifica usuários nem convites de outra', async () => {
    const invite = await expectStatus(issue(f, await newUser(f, 'a'), 'seller'), 201);
    const headersB = tenantHeaders(f.ownerB, f.tenantB.tenant.id);
    await request(f.app)
      .post(`/api/v1/users/invitations/${invite.body.data.invitation.id}/reissue`)
      .set(headersB)
      .send({})
      .expect(404);
    await request(f.app)
      .patch(`/api/v1/users/${f.ownerA.uid}/permissions`)
      .set(headersB)
      .send({ operations: [], expectedVersion: 1 })
      .expect(404);
    await request(f.app).get('/api/v1/users').set(tenantHeaders(f.ownerB, tenantA())).expect(403);
  });
});
