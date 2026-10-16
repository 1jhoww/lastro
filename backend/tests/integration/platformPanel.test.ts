import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  registerFixture,
  bearer,
  tenantHeaders,
  newUser,
  issue,
  expectStatus,
  tenantInput,
  type Fixture,
} from '../helpers/fixture.js';
import { configure } from '../helpers/catalog.js';
import { addDays, billingDate } from '../../src/modules/billing/calendar.js';

const f = registerFixture();
const admin = (fixture: Fixture, method: 'get' | 'post', path: string) =>
  request(fixture.app)[method](`/api/v1/admin${path}`).set(bearer(fixture.platform));
const today = billingDate(new Date());
const charge = (fixture: Fixture, tenantId: string, dueDate: string, competence: string) =>
  admin(fixture, 'post', '/charges')
    .send({ tenantId, competence, amountCents: 19900, dueDate, reason: 'Teste do painel' })
    .expect(201);

describe('Visão geral do Super Admin', () => {
  it('indicadores vêm dos dados persistidos e separam contratado de recebido', async () => {
    const month = today.slice(0, 7);
    const overdue = (await charge(f, f.tenantA.tenant.id, addDays(today, -2), month)).body.data;
    const toPay = (await charge(f, f.tenantB.tenant.id, addDays(today, 3), month)).body.data;
    await admin(f, 'post', `/charges/${toPay.id}/pay`)
      .send({ expectedVersion: 1, paidAt: today, paidAmountCents: 19000 })
      .expect(200);
    await admin(f, 'post', `/subscriptions/${f.tenantB.subscription.id}/suspend`)
      .send({ expectedVersion: 1, reason: 'Teste' })
      .expect(200);
    const view = (await admin(f, 'get', '/overview').expect(200)).body.data;
    expect(view).toMatchObject({
      today,
      totalCompanies: 2,
      subscriptions: { active: 1, pending: 0, suspended: 1, canceled: 0 },
      plans: { essencial: 0, profissional: 2, legacy: 0 },
      mrrCents: 19900,
      openCharges: { count: 1, amountCents: 19900 },
      overdueCharges: { count: 1, amountCents: 19900 },
      receivedThisMonthCents: 19000,
    });
    expect(view.upcoming).toEqual([
      expect.objectContaining({ id: overdue.id, situation: 'overdue', tenantName: 'Empresa A' }),
    ]);
  });
  it('contratos legados e cancelados entram nas contagens certas', async () => {
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ planCode: null, status: 'past_due' });
    await f.firebase.db.doc(`subscriptions/${f.tenantB.subscription.id}`).update({
      status: 'canceled',
    });
    const view = (await admin(f, 'get', '/overview').expect(200)).body.data;
    expect(view.plans).toEqual({ essencial: 0, profissional: 0, legacy: 1 });
    expect(view.subscriptions).toMatchObject({ active: 1, canceled: 1 });
    expect(view.mrrCents).toBe(19900);
  });
});

describe('Empresas', () => {
  it('lista com plano, vencimento, vagas, contato e cobranças; pesquisa e filtra', async () => {
    await charge(f, f.tenantA.tenant.id, addDays(today, -1), today.slice(0, 7));
    const all = (await admin(f, 'get', '/companies').expect(200)).body.data;
    expect(all.total).toBe(2);
    const row = all.items.find((r: { id: string }) => r.id === f.tenantA.tenant.id);
    expect(row).toMatchObject({
      name: 'Empresa A',
      tenantStatus: 'active',
      subscriptionStatus: 'active',
      planCode: 'profissional',
      planName: 'Profissional',
      monthlyPriceCents: 19900,
      billingDay: 10,
      activeUsers: 1,
      userLimit: 2,
      contact: { name: null, email: f.ownerA.email, phone: null },
      openCharges: { count: 1, overdueCount: 1, amountCents: 19900 },
    });
    expect(row.nextDueDate).toMatch(/^\d{4}-\d{2}-10$/);
    const names = async (query: Record<string, string>) =>
      (await admin(f, 'get', '/companies').query(query).expect(200)).body.data.items.map(
        (r: { name: string }) => r.name,
      );
    expect(await names({ q: 'émpresa b' })).toEqual(['Empresa B']);
    expect(await names({ attention: 'overdue' })).toEqual(['Empresa A']);
    expect(await names({ planCode: 'essencial' })).toEqual([]);
    expect(await names({ status: 'active' })).toEqual(['Empresa A', 'Empresa B']);
    await admin(f, 'get', '/companies').query({ planCode: 'completo' }).expect(422);
  });
  it('detalhe mostra usuários, convites, vagas e vitrine, sem dados comerciais', async () => {
    await configure(f).expect(200);
    await expectStatus(issue(f, await newUser(f, 'convidado'), 'seller'), 201);
    const detail = (await admin(f, 'get', `/companies/${f.tenantA.tenant.id}`).expect(200)).body
      .data;
    expect(detail.subscription).toMatchObject({
      planName: 'Profissional',
      planCode: 'profissional',
    });
    expect(detail.capacity).toEqual({
      userLimit: 2,
      activeUsers: 1,
      reservedInvitations: 1,
      available: 0,
    });
    expect(detail.users).toEqual([
      expect.objectContaining({
        uid: f.ownerA.uid,
        email: f.ownerA.email,
        role: 'administrator',
        seatExempt: false,
      }),
    ]);
    expect(detail.invitations.map((i: { status: string }) => i.status).sort()).toEqual([
      'accepted',
      'pending',
    ]);
    expect(detail.publicCatalogEnabled).toBe(true);
    for (const key of ['customers', 'products', 'orders']) expect(detail).not.toHaveProperty(key);
    await admin(f, 'get', '/companies/inexistente').expect(404);
  });
  it('empresa não acessa dados de outras nem o painel', async () => {
    for (const path of [
      '/api/v1/admin/overview',
      '/api/v1/admin/companies',
      `/api/v1/admin/companies/${f.tenantB.tenant.id}`,
      '/api/v1/admin/invitations',
    ])
      await request(f.app).get(path).set(tenantHeaders(f.ownerA, f.tenantA.tenant.id)).expect(403);
  });
});

describe('Convites', () => {
  it('lista empresas aguardando administrador com link vigente; expirado não expõe link', async () => {
    const created = (
      await admin(f, 'post', '/tenants')
        .set('Idempotency-Key', randomUUID())
        .send(tenantInput('Empresa C', f.outsider.email, 'essencial'))
        .expect(201)
    ).body.data;
    const listed = (await admin(f, 'get', '/invitations').expect(200)).body.data.items;
    expect(listed).toEqual([
      expect.objectContaining({
        tenantId: created.tenant.id,
        tenantName: 'Empresa C',
        planCode: 'essencial',
        invitation: expect.objectContaining({
          email: f.outsider.email,
          status: 'pending',
          expired: false,
          token: created.ownerInvitation.token,
        }),
      }),
    ]);
    await f.firebase.db
      .doc(`tenants/${created.tenant.id}/invitations/${created.ownerInvitation.invitation.id}`)
      .update({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const expired = (await admin(f, 'get', '/invitations').expect(200)).body.data.items[0];
    expect(expired.invitation).toMatchObject({ expired: true, token: null });
  });
  it('Super Admin revoga convite pendente e libera a vaga, com auditoria', async () => {
    const invite = await expectStatus(issue(f, await newUser(f, 'reserva')), 201);
    const id = invite.body.data.invitation.id;
    const path = `/companies/${f.tenantA.tenant.id}/invitations/${id}/revoke`;
    await admin(f, 'post', path).send({ reason: 'Liberar vaga para downgrade' }).expect(200);
    const detail = (await admin(f, 'get', `/companies/${f.tenantA.tenant.id}`).expect(200)).body
      .data;
    expect(detail.capacity.reservedInvitations).toBe(0);
    const audit = await f.firebase.db
      .collection('auditLogs')
      .where('action', '==', 'invitation.revoked')
      .where('resourceId', '==', id)
      .get();
    expect(audit.docs[0]?.data()).toMatchObject({
      tenantId: f.tenantA.tenant.id,
      changes: { reason: 'Liberar vaga para downgrade' },
    });
    const accepted = (
      await f.firebase.db
        .collection(`tenants/${f.tenantA.tenant.id}/invitations`)
        .where('status', '==', 'accepted')
        .get()
    ).docs[0]!.id;
    await admin(f, 'post', `/companies/${f.tenantA.tenant.id}/invitations/${accepted}/revoke`)
      .send({ reason: 'Tentativa' })
      .expect(409);
    await admin(f, 'post', `/companies/${f.tenantB.tenant.id}/invitations/${id}/revoke`)
      .send({ reason: 'Outra empresa' })
      .expect(404);
  });
});
