import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  registerFixture,
  bearer,
  tenantHeaders,
  newUser,
  issue,
  join,
} from '../helpers/fixture.js';
const f = registerFixture();
describe('Fundação com Auth e Firestore Emulator reais', () => {
  it('cria primeiro administrador pelo convite e preserva sua identidade separada', async () => {
    const current = await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
    expect(current.body.data.status).toBe('active');
    expect(current.body.data).not.toHaveProperty('activeAdmins');
    const me = await request(f.app).get('/api/v1/me').set(bearer(f.ownerA)).expect(200);
    expect(me.body.data.platformAdmin).toBe(false);
    expect(me.body.data.memberships[0].role).toBe('administrator');
    expect(
      (await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}`).get()).data()?.activeAdmins,
    ).toBe(1);
  });
  it('permite dois administradores sem adicional e bloqueia a terceira vaga', async () => {
    const second = await newUser(f, 'second-admin');
    await (
      await join(f, second)
    ).body;
    const list = await request(f.app)
      .get('/api/v1/users')
      .set(tenantHeaders(second, f.tenantA.tenant.id))
      .expect(200);
    expect(list.body.data.items.map((v: { role: string }) => v.role)).toEqual([
      'administrator',
      'administrator',
    ]);
    const rejected = await issue(f, f.outsider);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('USER_LIMIT_REACHED');
    expect(
      (await f.firebase.db.doc(`subscriptions/${f.tenantA.tenant.id}`).get()).data()
        ?.monthlyPriceCents,
    ).toBe(20000);
  });
  it('lista de usuários traz nome e e-mail só dos membros da própria empresa', async () => {
    await f.firebase.auth.updateUser(f.ownerA.uid, { displayName: 'Ana Administradora' });
    const seller = await newUser(f, 'seller-profile');
    expect((await join(f, seller, 'seller')).status).toBe(200);
    const list = await request(f.app)
      .get('/api/v1/users')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
    const items = list.body.data.items as {
      id: string;
      name: string | null;
      email: string | null;
    }[];
    expect(items.find((m) => m.id === f.ownerA.uid)).toMatchObject({
      name: 'Ana Administradora',
      email: f.ownerA.email.toLowerCase(),
    });
    expect(items.find((m) => m.id === seller.uid)).toMatchObject({
      name: null,
      email: seller.email.toLowerCase(),
    });
    expect(items.map((m) => m.id)).not.toContain(f.ownerB.uid);
  });
  it('permite administrador e vendedor com permissões atuais no servidor', async () => {
    const seller = await newUser(f, 'seller');
    expect((await join(f, seller, 'seller')).status).toBe(200);
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(seller, f.tenantA.tenant.id))
      .expect(200);
    await request(f.app)
      .get('/api/v1/users')
      .set(tenantHeaders(seller, f.tenantA.tenant.id))
      .expect(403);
    const me = await request(f.app).get('/api/v1/me').set(bearer(seller)).expect(200);
    expect(me.body.data.memberships[0].permissions).toContain('orders:own:confirm');
  });
  it('convite pendente reserva vaga; vencimento libera vaga sem job de limpeza', async () => {
    const response = await issue(f, f.outsider);
    expect(response.status).toBe(201);
    expect((await issue(f, await newUser(f, 'third'))).body.error.code).toBe('USER_LIMIT_REACHED');
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/invitations/${response.body.data.invitation.id}`)
      .update({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const expired = await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.outsider))
      .send({ token: response.body.data.token })
      .expect(410);
    expect(expired.body.error.code).toBe('INVITATION_EXPIRED');
    expect((await issue(f, await newUser(f, 'next'))).status).toBe(201);
  });
  it('convite é de uso único e mantém prova de destinatário verificado', async () => {
    const invitation = await issue(f, f.outsider);
    await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.ownerB))
      .send({ token: invitation.body.data.token })
      .expect(403);
    await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.outsider))
      .send({ token: invitation.body.data.token })
      .expect(200);
    const replay = await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.outsider))
      .send({ token: invitation.body.data.token })
      .expect(403);
    expect(replay.body.error.code).toBe('INVITATION_INVALID');
    const stored = (
      await f.firebase.db
        .doc(`tenants/${f.tenantA.tenant.id}/invitations/${invitation.body.data.invitation.id}`)
        .get()
    ).data();
    expect(stored).not.toHaveProperty('token');
    expect(stored?.tokenHash).toHaveLength(64);
  });
  it('não usa email de token antigo nem email não verificado como prova', async () => {
    const user = await newUser(f, 'unverified', false);
    const invitation = await issue(f, user);
    await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(user))
      .send({ token: invitation.body.data.token })
      .expect(403);
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/invitations/${invitation.body.data.invitation.id}`)
      .update({ expiresAt: new Date(Date.now() - 1).toISOString() });
    const valid = await issue(f, f.outsider);
    // Auth revocation timestamps have second precision. Ensure the old session
    // predates this account mutation instead of depending on execution speed.
    await new Promise<void>((resolve) => setTimeout(resolve, 1100));
    await f.firebase.auth.updateUser(f.outsider.uid, {
      email: 'changed@example.invalid',
      emailVerified: true,
    });
    // Firebase revokes the old session when its account email changes.
    await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.outsider))
      .send({ token: valid.body.data.token })
      .expect(401);
  });
  it.each(['role', 'status'] as const)(
    'protege último administrador em alteração de %s',
    async (operation) => {
      const response = await request(f.app)
        .patch(`/api/v1/users/${f.ownerA.uid}/${operation}`)
        .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
        .send({
          expectedVersion: 1,
          ...(operation === 'role' ? { role: 'seller' } : { status: 'disabled' }),
        })
        .expect(409);
      expect(response.body.error.code).toBe('LAST_ADMIN_REQUIRED');
    },
  );
  it('desativação bloqueia imediatamente o token existente e reativação respeita limite', async () => {
    const user = await newUser(f, 'second');
    expect((await join(f, user)).status).toBe(200);
    await request(f.app)
      .patch(`/api/v1/users/${user.uid}/status`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ expectedVersion: 1, status: 'disabled' })
      .expect(200);
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(user, f.tenantA.tenant.id))
      .expect(403);
    await issue(f, f.outsider);
    const blocked = await request(f.app)
      .patch(`/api/v1/users/${user.uid}/status`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ expectedVersion: 2, status: 'active' })
      .expect(409);
    expect(blocked.body.error.code).toBe('USER_LIMIT_REACHED');
  });
  it('mudança de perfil vale com o mesmo token e é auditada', async () => {
    const user = await newUser(f, 'second');
    expect((await join(f, user)).status).toBe(200);
    await request(f.app)
      .patch(`/api/v1/users/${user.uid}/role`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ expectedVersion: 1, role: 'seller' })
      .expect(200);
    await request(f.app)
      .get('/api/v1/users')
      .set(tenantHeaders(user, f.tenantA.tenant.id))
      .expect(403);
    const audits = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/auditLogs`)
      .where('action', '==', 'membership.updated')
      .get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0]?.data().changes.role).toBe('seller');
  });
  it.each(['suspended', 'canceled'] as const)(
    '%s bloqueia todas as rotas privadas e não bloqueia plataforma',
    async (status) => {
      await request(f.app)
        .patch(`/api/v1/admin/subscriptions/${f.tenantA.subscription.id}`)
        .set(bearer(f.platform))
        .send({ expectedVersion: 1, status, reason: 'Teste de política' })
        .expect(200);
      for (const path of ['/tenants/current', '/users']) {
        const denied = await request(f.app)
          .get(`/api/v1${path}`)
          .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
          .expect(403);
        expect(denied.body.error.code).toBe(
          status === 'suspended' ? 'SUBSCRIPTION_SUSPENDED' : 'SUBSCRIPTION_INACTIVE',
        );
      }
      await request(f.app).get('/api/v1/admin/subscriptions').set(bearer(f.platform)).expect(200);
      expect(
        (
          await f.firebase.db
            .doc(`tenants/${f.tenantA.tenant.id}/memberships/${f.ownerA.uid}`)
            .get()
        ).exists,
      ).toBe(true);
      const me = await request(f.app).get('/api/v1/me').set(bearer(f.ownerA)).expect(200);
      expect(me.body.data.memberships[0].permissions).toEqual([]);
      expect(me.body.data.memberships[0]).not.toHaveProperty('monthlyPriceCents');
    },
  );
  it('past_due mantém acesso e reativação restaura permissões atuais', async () => {
    const path = `/api/v1/admin/subscriptions/${f.tenantA.subscription.id}`;
    await request(f.app)
      .patch(path)
      .set(bearer(f.platform))
      .send({ expectedVersion: 1, status: 'past_due', reason: 'Teste' })
      .expect(200);
    await request(f.app)
      .get('/api/v1/users')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
    await request(f.app)
      .patch(path)
      .set(bearer(f.platform))
      .send({ expectedVersion: 2, status: 'suspended', reason: 'Teste' })
      .expect(200);
    await request(f.app)
      .patch(path)
      .set(bearer(f.platform))
      .send({ expectedVersion: 3, status: 'active', reason: 'Teste' })
      .expect(200);
    await request(f.app)
      .get('/api/v1/users')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
  });
  it('plano versionado não altera contrato; condições especiais só mudam assinatura explicitamente', async () => {
    await request(f.app)
      .patch(`/api/v1/admin/plans/${f.plan.id}`)
      .set(bearer(f.platform))
      .send({ expectedVersion: 1, monthlyPriceCents: 30000 })
      .expect(200);
    expect(
      (await f.firebase.db.doc(`subscriptions/${f.tenantA.subscription.id}`).get()).data()
        ?.monthlyPriceCents,
    ).toBe(20000);
    expect(
      (await f.firebase.db.doc(`plans/${f.plan.id}/versions/1`).get()).data()?.monthlyPriceCents,
    ).toBe(20000);
    await request(f.app)
      .patch(`/api/v1/admin/subscriptions/${f.tenantA.subscription.id}`)
      .set(bearer(f.platform))
      .send({
        expectedVersion: 1,
        signupFeeCents: 0,
        monthlyPriceCents: 18000,
        commercialNotes:
          'Condição sintética para teste do piloto; não é uma condição real aprovada',
        reason: 'Fixture sintética',
      })
      .expect(200);
    expect(
      (await f.firebase.db.doc(`subscriptions/${f.tenantB.subscription.id}`).get()).data()
        ?.monthlyPriceCents,
    ).toBe(20000);
    expect((await f.firebase.db.doc(`plans/${f.plan.id}`).get()).data()?.monthlyPriceCents).toBe(
      30000,
    );
  });
  it('idempotência impede criação duplicada e conflito de payload', async () => {
    const key = randomUUID();
    const body = {
      name: 'Nova empresa sintética',
      planId: f.plan.id,
      ownerEmail: f.outsider.email,
    };
    const first = await request(f.app)
      .post('/api/v1/admin/tenants')
      .set(bearer(f.platform))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const second = await request(f.app)
      .post('/api/v1/admin/tenants')
      .set(bearer(f.platform))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(second.body.data).toEqual(first.body.data);
    await request(f.app)
      .post('/api/v1/admin/tenants')
      .set(bearer(f.platform))
      .set('Idempotency-Key', key)
      .send({ ...body, name: 'Outro nome' })
      .expect(409);
    expect((await f.firebase.db.collection('tenants').get()).size).toBe(3);
  });
  it('paginação produz cursor utilizável e filtros desconhecidos são rejeitados', async () => {
    const first = await request(f.app)
      .get('/api/v1/admin/tenants?limit=1')
      .set(bearer(f.platform))
      .expect(200);
    expect(first.body.data.items).toHaveLength(1);
    const second = await request(f.app)
      .get('/api/v1/admin/tenants')
      .query({ limit: '1', cursor: first.body.data.nextCursor })
      .set(bearer(f.platform))
      .expect(200);
    expect(second.body.data.items[0].id).not.toBe(first.body.data.items[0].id);
    await request(f.app)
      .get('/api/v1/admin/tenants?limit=1000')
      .set(bearer(f.platform))
      .expect(422);
  });
  it('revoga convite, libera capacidade e impede aceitação do token anterior', async () => {
    const invitation = await issue(f, f.outsider);
    await request(f.app)
      .post(`/api/v1/users/invitations/${invitation.body.data.invitation.id}/revoke`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
    await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.outsider))
      .send({ token: invitation.body.data.token })
      .expect(403);
    expect((await issue(f, await newUser(f, 'replacement'))).status).toBe(201);
  });
  it('plataforma recupera convite inicial sem vincular usuário automaticamente', async () => {
    const created = await request(f.app)
      .post('/api/v1/admin/tenants')
      .set(bearer(f.platform))
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Provisionamento sintético', planId: f.plan.id, ownerEmail: f.outsider.email })
      .expect(201);
    const id = created.body.data.tenant.id;
    const key = randomUUID();
    const renewed = await request(f.app)
      .post(`/api/v1/admin/tenants/${id}/owner-invitations`)
      .set(bearer(f.platform))
      .set('Idempotency-Key', key)
      .send({ ownerEmail: f.outsider.email, expectedVersion: 1 })
      .expect(201);
    const repeat = await request(f.app)
      .post(`/api/v1/admin/tenants/${id}/owner-invitations`)
      .set(bearer(f.platform))
      .set('Idempotency-Key', key)
      .send({ ownerEmail: f.outsider.email, expectedVersion: 1 })
      .expect(201);
    expect(repeat.body.data.token).toBe(renewed.body.data.token);
    await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.outsider))
      .send({ token: created.body.data.ownerInvitation.token })
      .expect(403);
    await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(f.outsider))
      .send({ token: renewed.body.data.token })
      .expect(200);
    await request(f.app)
      .post(`/api/v1/admin/tenants/${id}/owner-invitations`)
      .set(bearer(f.platform))
      .set('Idempotency-Key', randomUUID())
      .send({ ownerEmail: f.outsider.email, expectedVersion: 2 })
      .expect(409);
  });
});
