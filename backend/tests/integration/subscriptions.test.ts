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
  expectStatus,
  tenantInput,
  type Fixture,
} from '../helpers/fixture.js';
import { configure } from '../helpers/catalog.js';
import { addDays, billingDate } from '../../src/modules/billing/calendar.js';

const f = registerFixture();
const path = (fixture: Fixture, suffix = '', id = fixture.tenantA.subscription.id) =>
  `/api/v1/admin/subscriptions/${id}${suffix}`;
const command = (fixture: Fixture, suffix: string, body: object, id?: string) =>
  request(fixture.app)
    .post(path(fixture, suffix, id))
    .set(bearer(fixture.platform))
    .send(body);
const subscription = async (fixture: Fixture, id = fixture.tenantA.subscription.id) =>
  (await fixture.firebase.db.doc(`subscriptions/${id}`).get()).data()!;
const history = async (fixture: Fixture, id = fixture.tenantA.subscription.id) =>
  (
    await request(fixture.app)
      .get(path(fixture, '/history', id))
      .set(bearer(fixture.platform))
  ).body.data.items as { action: string; changes: Record<string, unknown> }[];
const allFeatures = ['users.invite', 'catalog.public', 'commercial.sellers', 'commercial.visits'];

describe('Criação de empresa com plano oficial', () => {
  it('Essencial recebe limite de 1 usuário, valor de referência e dados de cobrança', async () => {
    const owner = await newUser(f, 'dono-essencial');
    const created = await request(f.app)
      .post('/api/v1/admin/tenants')
      .set(bearer(f.platform))
      .set('Idempotency-Key', randomUUID())
      .send(tenantInput('Essencial Ltda', owner.email, 'essencial', { billingDay: 5 }))
      .expect(201);
    expect(created.body.data.subscription).toMatchObject({
      planCode: 'essencial',
      planId: 'essencial',
      status: 'active',
      userLimit: 1,
      monthlyPriceCents: 11900,
      billingDay: 5,
      billingStartsOn: billingDate(new Date()),
    });
    const tenantId = created.body.data.tenant.id;
    await request(f.app)
      .post('/api/v1/users/invitations/accept')
      .set(bearer(owner))
      .send({ token: created.body.data.ownerInvitation.token })
      .expect(200);
    const invite = await request(f.app)
      .post('/api/v1/users/invitations')
      .set(tenantHeaders(owner, tenantId))
      .send({ email: f.outsider.email, role: 'administrator' })
      .expect(403);
    expect(invite.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
  });
  it('aceita valor negociado e recusa início de cobrança retroativo', async () => {
    const custom = await request(f.app)
      .post('/api/v1/admin/tenants')
      .set(bearer(f.platform))
      .set('Idempotency-Key', randomUUID())
      .send(
        tenantInput('Negociada', f.outsider.email, 'profissional', { monthlyPriceCents: 15000 }),
      )
      .expect(201);
    expect(custom.body.data.subscription).toMatchObject({ monthlyPriceCents: 15000, userLimit: 2 });
    const retro = await request(f.app)
      .post('/api/v1/admin/tenants')
      .set(bearer(f.platform))
      .set('Idempotency-Key', randomUUID())
      .send(
        tenantInput('Retroativa', f.outsider.email, 'profissional', {
          billingStartsOn: addDays(billingDate(new Date()), -1),
        }),
      )
      .expect(422);
    expect(retro.body.error.code).toBe('VALIDATION_ERROR');
    for (const invalid of [{ planCode: 'completo' }, { billingDay: 29 }, { planId: 'legado' }])
      await request(f.app)
        .post('/api/v1/admin/tenants')
        .set(bearer(f.platform))
        .set('Idempotency-Key', randomUUID())
        .send({ ...tenantInput('Inválida', f.outsider.email), ...invalid })
        .expect(422);
  });
  it('catálogo oficial expõe os dois planos com recursos e preços de referência', async () => {
    const catalog = (
      await request(f.app).get('/api/v1/admin/plan-catalog').set(bearer(f.platform)).expect(200)
    ).body.data;
    expect(
      catalog.items.map((p: { code: string; userLimit: number; referencePriceCents: number }) => [
        p.code,
        p.userLimit,
        p.referencePriceCents,
      ]),
    ).toEqual([
      ['essencial', 1, 11900],
      ['profissional', 2, 19900],
    ]);
    expect(catalog.features).toHaveLength(4);
  });
});

describe('Troca de plano', () => {
  it('downgrade exige vagas livres e confirmação, sem desativar ninguém nem mudar o valor', async () => {
    await configure(f).expect(200);
    const invite = await expectStatus(issue(f, await newUser(f, 'pendente')), 201);
    const preview = (
      await request(f.app)
        .get(path(f, '/plan-change'))
        .query({ planCode: 'essencial' })
        .set(bearer(f.platform))
        .expect(200)
    ).body.data;
    expect(preview).toMatchObject({
      currentPlanCode: 'profissional',
      targetPlanCode: 'essencial',
      targetUserLimit: 1,
      activeUsers: 1,
      reservedInvitations: 1,
      excessSeats: 1,
      publicCatalogEnabled: true,
      monthlyPriceCents: 19900,
    });
    expect([...preview.lostFeatures].sort()).toEqual([...allFeatures].sort());
    const body = {
      expectedVersion: 1,
      planCode: 'essencial',
      acknowledgedLostFeatures: [] as string[],
      reason: 'Cliente pediu o Essencial',
    };
    const unconfirmed = await command(f, '/plan', body).expect(409);
    expect(unconfirmed.body.error.code).toBe('FEATURE_LOSS_UNCONFIRMED');
    const full = await command(f, '/plan', {
      ...body,
      acknowledgedLostFeatures: allFeatures,
    }).expect(409);
    expect(full.body.error.code).toBe('USER_LIMIT_REACHED');
    await request(f.app)
      .post(`/api/v1/users/invitations/${invite.body.data.invitation.id}/revoke`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
    const changed = await command(f, '/plan', {
      ...body,
      acknowledgedLostFeatures: allFeatures,
    }).expect(200);
    expect(changed.body.data).toMatchObject({
      planCode: 'essencial',
      userLimit: 1,
      monthlyPriceCents: 19900,
      version: 2,
    });
    const tenant = (await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}`).get()).data()!;
    expect(tenant.activeUsers).toBe(1);
    const me = (await request(f.app).get('/api/v1/me').set(bearer(f.ownerA)).expect(200)).body.data;
    expect(me.memberships[0].plan.features).toEqual([]);
    const [last] = await history(f);
    expect(last).toMatchObject({
      action: 'subscription.plan.changed',
      changes: {
        previousPlanCode: 'profissional',
        planCode: 'essencial',
        reason: 'Cliente pediu o Essencial',
      },
    });
  });
  it('upgrade não perde recursos e altera o valor somente quando informado', async () => {
    await f.firebase.db.doc(`subscriptions/${f.tenantA.subscription.id}`).update({
      planCode: 'essencial',
      planId: 'essencial',
      userLimit: 1,
      monthlyPriceCents: 11900,
    });
    await command(f, '/plan', {
      expectedVersion: 1,
      planCode: 'profissional',
      monthlyPriceCents: 19900,
      acknowledgedLostFeatures: [],
      reason: 'Upgrade',
    }).expect(200);
    expect(await subscription(f)).toMatchObject({
      planCode: 'profissional',
      userLimit: 2,
      monthlyPriceCents: 19900,
    });
    const same = await command(f, '/plan', {
      expectedVersion: 2,
      planCode: 'profissional',
      acknowledgedLostFeatures: [],
      reason: 'Repetido',
    }).expect(422);
    expect(same.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('contrato legado com mais usuários não é rebaixado sem resolução', async () => {
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ planCode: null, planId: 'legado', userLimit: 5 });
    for (const label of ['a', 'b']) await expectStatus(join(f, await newUser(f, label)), 200);
    const preview = (
      await request(f.app)
        .get(path(f, '/plan-change'))
        .query({ planCode: 'profissional' })
        .set(bearer(f.platform))
        .expect(200)
    ).body.data;
    expect(preview).toMatchObject({ lostFeatures: [], activeUsers: 3, excessSeats: 1 });
    const refused = await command(f, '/plan', {
      expectedVersion: 1,
      planCode: 'profissional',
      acknowledgedLostFeatures: [],
      reason: 'Migração',
    }).expect(409);
    expect(refused.body.error.code).toBe('USER_LIMIT_REACHED');
    expect(await subscription(f)).toMatchObject({ planCode: null, userLimit: 5 });
  });
});

describe('Condições, ativação, suspensão e histórico', () => {
  it('ajusta valor e vencimento com versão, motivo e auditoria', async () => {
    const updated = await command(f, '/terms', {
      expectedVersion: 1,
      monthlyPriceCents: 17500,
      billingDay: 20,
      billingContact: { name: 'Financeiro', email: 'financeiro@example.invalid', phone: null },
      reason: 'Renegociação',
    }).expect(200);
    expect(updated.body.data).toMatchObject({ monthlyPriceCents: 17500, billingDay: 20 });
    const stale = await command(f, '/terms', {
      expectedVersion: 1,
      monthlyPriceCents: 1,
      reason: 'Versão antiga',
    }).expect(409);
    expect(stale.body.error.code).toBe('CONFLICT');
    const unchanged = await command(f, '/terms', {
      expectedVersion: 2,
      monthlyPriceCents: 17500,
      reason: 'Sem mudança',
    }).expect(422);
    expect(unchanged.body.error.code).toBe('VALIDATION_ERROR');
    const [entry] = await history(f);
    expect(entry).toMatchObject({
      action: 'subscription.terms.updated',
      changes: {
        previous: {
          monthlyPriceCents: 19900,
          billingDay: 10,
          billingContact: { name: null, email: f.ownerA.email, phone: null },
        },
        current: { monthlyPriceCents: 17500, billingDay: 20 },
        reason: 'Renegociação',
      },
    });
  });
  it('assinatura aguardando ativação mantém acesso e só cobra após ativar sem retroatividade', async () => {
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ status: 'pending', billingDay: null, billingStartsOn: null });
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
    const blocked = await command(f, '/terms', {
      expectedVersion: 1,
      billingDay: 15,
      reason: 'Antes da ativação',
    }).expect(409);
    expect(blocked.body.error.code).toBe('CONFLICT');
    const today = billingDate(new Date());
    const activation = {
      expectedVersion: 1,
      monthlyPriceCents: 19900,
      billingDay: 15,
      billingStartsOn: addDays(today, -1),
      reason: 'Ativação da piloto',
    };
    await command(f, '/activate', activation).expect(422);
    const active = await command(f, '/activate', {
      ...activation,
      billingStartsOn: today,
    }).expect(200);
    expect(active.body.data).toMatchObject({ status: 'active', billingDay: 15 });
    await command(f, '/activate', { ...activation, expectedVersion: 2 }).expect(409);
  });
  it('suspensão bloqueia sem apagar dados e reativação restaura o acesso', async () => {
    await command(f, '/suspend', { expectedVersion: 1, reason: 'Inadimplência' }).expect(200);
    const denied = await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(403);
    expect(denied.body.error.code).toBe('SUBSCRIPTION_SUSPENDED');
    await command(f, '/suspend', { expectedVersion: 2, reason: 'De novo' }).expect(409);
    const reactivated = await command(f, '/reactivate', {
      expectedVersion: 2,
      reason: 'Regularizado',
    }).expect(200);
    expect(reactivated.body.data.status).toBe('active');
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
    expect(
      (
        await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}/memberships/${f.ownerA.uid}`).get()
      ).data()?.status,
    ).toBe('active');
    const actions = (await history(f)).map((entry) => entry.action);
    expect(actions.slice(0, 2)).toEqual(['subscription.reactivated', 'subscription.suspended']);
    expect(actions).toContain('tenant.created');
  });
  it('cancelada é terminal e não aceita alterações', async () => {
    await f.firebase.db.doc(`subscriptions/${f.tenantA.subscription.id}`).update({
      status: 'canceled',
    });
    await command(f, '/terms', {
      expectedVersion: 1,
      monthlyPriceCents: 1,
      reason: 'Tentativa',
    }).expect(409);
    await command(f, '/suspend', { expectedVersion: 1, reason: 'Tentativa' }).expect(409);
    await command(f, '/reactivate', { expectedVersion: 1, reason: 'Tentativa' }).expect(409);
  });
  it('histórico é isolado por assinatura e restrito ao Super Admin', async () => {
    await command(f, '/suspend', { expectedVersion: 1, reason: 'Somente A' }).expect(200);
    const other = (await history(f, f.tenantB.subscription.id)).map((entry) => entry.action);
    expect(other).not.toContain('subscription.suspended');
    await request(f.app).get(path(f, '/history')).set(bearer(f.ownerA)).expect(403);
    await request(f.app)
      .get(path(f, '/history', 'inexistente'))
      .set(bearer(f.platform))
      .expect(404);
  });
});
