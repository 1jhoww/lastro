import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { spawnSync } from 'node:child_process';
import { registerFixture, bearer, tenantHeaders, type Fixture } from '../helpers/fixture.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../../src/modules/auth/accessService.js';
import { BillingService, billingJobActor } from '../../src/modules/billing/billingService.js';
import { addDays, billingDate } from '../../src/modules/billing/calendar.js';

const f = registerFixture();

/** Billing service on a fixed calendar day (the HTTP app keeps the real clock for auth). */
const billingOn = (fixture: Fixture, day: string) => {
  const repo = new FoundationRepository(fixture.firebase.db);
  return new BillingService(
    repo,
    new AccessService(repo),
    fixture.config,
    () => new Date(`${day}T15:00:00.000Z`),
  );
};
const setTerms = (fixture: Fixture, tenantId: string, terms: object) =>
  fixture.firebase.db.doc(`subscriptions/${tenantId}`).update(terms);
const charges = async (fixture: Fixture) =>
  (await fixture.firebase.db.collection('billingCharges').get()).docs.map((d) => d.data());
const admin = (fixture: Fixture, method: 'get' | 'post', path: string) =>
  request(fixture.app)[method](`/api/v1/admin${path}`).set(bearer(fixture.platform));

describe('Geração mensal idempotente', () => {
  it('cria uma cobrança por assinatura e competência, com valor congelado na emissão', async () => {
    for (const tenant of [f.tenantA, f.tenantB])
      await setTerms(f, tenant.tenant.id, { billingDay: 10, billingStartsOn: '2030-01-01' });
    const first = await billingOn(f, '2030-01-05').generateDue(billingJobActor());
    expect(first).toMatchObject({ examined: 2, created: 2, existing: 0, failed: 0 });
    const again = await billingOn(f, '2030-01-06').generateDue(billingJobActor());
    expect(again).toMatchObject({ created: 0, existing: 2 });
    const issued = await charges(f);
    expect(issued.map((c) => c.id).sort()).toEqual(
      [f.tenantA, f.tenantB].map((t) => `${t.subscription.id}_2030-01`).sort(),
    );
    expect(issued[0]).toMatchObject({
      competence: '2030-01',
      dueDate: '2030-01-10',
      amountCents: 19900,
      status: 'pending',
      origin: 'automatic',
      planCode: 'profissional',
    });
    // A new price never rewrites an issued charge; it applies to the next month.
    await admin(f, 'post', `/subscriptions/${f.tenantA.subscription.id}/terms`)
      .send({ expectedVersion: 1, monthlyPriceCents: 25000, reason: 'Reajuste' })
      .expect(200);
    await billingOn(f, '2030-02-01').generateDue(billingJobActor());
    const byId = Object.fromEntries((await charges(f)).map((c) => [c.id, c]));
    expect(byId[`${f.tenantA.subscription.id}_2030-01`]?.amountCents).toBe(19900);
    expect(byId[`${f.tenantA.subscription.id}_2030-02`]?.amountCents).toBe(25000);
    const audits = await f.firebase.db
      .collection('auditLogs')
      .where('action', '==', 'charge.generated')
      .get();
    expect(audits.size).toBe(4);
  });
  it('não gera para assinaturas suspensas ou aguardando ativação, nem retroativamente', async () => {
    await setTerms(f, f.tenantA.tenant.id, { status: 'suspended', billingStartsOn: '2030-01-01' });
    await setTerms(f, f.tenantB.tenant.id, {
      status: 'pending',
      billingDay: null,
      billingStartsOn: null,
    });
    const summary = await billingOn(f, '2030-01-05').generateDue(billingJobActor());
    expect(summary).toMatchObject({ examined: 0, created: 0 });
    // Reactivated after the due date passed the grace period: no retroactive charge.
    await setTerms(f, f.tenantA.tenant.id, { status: 'active' });
    expect((await billingOn(f, '2030-01-20').generateDue(billingJobActor())).created).toBe(0);
    expect(await charges(f)).toEqual([]);
  });
  it('execuções simultâneas não duplicam cobranças', async () => {
    for (const tenant of [f.tenantA, f.tenantB])
      await setTerms(f, tenant.tenant.id, { billingDay: 10, billingStartsOn: '2030-01-01' });
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => billingOn(f, '2030-01-05').generateDue(billingJobActor())),
    );
    expect(runs.reduce((total, run) => total + run.created, 0)).toBe(2);
    expect(runs.every((run) => run.failed === 0)).toBe(true);
    expect(await charges(f)).toHaveLength(2);
  });
  it('job agendado roda isolado, imprime resumo e é idempotente', async () => {
    const today = billingDate(new Date());
    await setTerms(f, f.tenantA.tenant.id, {
      billingDay: Number(today.slice(8, 10)) > 28 ? 28 : Number(today.slice(8, 10)),
      billingStartsOn: addDays(today, -40),
    });
    const run = () => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/jobs/billingCycle.ts'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Record<string, unknown>;
    };
    const first = run();
    expect(first).toMatchObject({ event: 'billing.generation.completed', failed: 0 });
    expect(run()).toMatchObject({ created: 0, failed: 0 });
    for (const charge of await charges(f)) expect(charge.subscriptionId).toBeDefined();
  }, 60_000);
});

describe('Administração manual das cobranças', () => {
  const today = billingDate(new Date());
  const month = today.slice(0, 7);
  const create = (fixture: Fixture, extra: object = {}) =>
    admin(fixture, 'post', '/charges').send({
      tenantId: fixture.tenantA.tenant.id,
      competence: month,
      amountCents: 19900,
      dueDate: addDays(today, -1),
      reason: 'Competência acordada',
      ...extra,
    });

  it('cobrança vencida gera alerta, mas não bloqueia o acesso', async () => {
    const charge = (await create(f).expect(201)).body.data;
    expect(charge).toMatchObject({ situation: 'overdue', origin: 'manual', status: 'pending' });
    const duplicate = await create(f).expect(409);
    expect(duplicate.body.error.code).toBe('CHARGE_EXISTS');
    const overdue = (await admin(f, 'get', '/charges').query({ situation: 'overdue' }).expect(200))
      .body.data.items;
    expect(overdue.map((c: { id: string }) => c.id)).toEqual([charge.id]);
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
  });
  it('marca como paga, corrige com auditoria e cancela somente pendentes', async () => {
    const charge = (await create(f).expect(201)).body.data;
    await admin(f, 'post', `/charges/${charge.id}/pay`)
      .send({ expectedVersion: 1, paidAt: addDays(today, 1) })
      .expect(422);
    const paid = (
      await admin(f, 'post', `/charges/${charge.id}/pay`)
        .send({ expectedVersion: 1, paidAt: today, notes: 'PIX' })
        .expect(200)
    ).body.data;
    expect(paid).toMatchObject({
      status: 'paid',
      situation: 'paid',
      paidAt: today,
      paidAmountCents: 19900,
      notes: 'PIX',
    });
    await admin(f, 'post', `/charges/${charge.id}/pay`)
      .send({ expectedVersion: 2, paidAt: today })
      .expect(409);
    await admin(f, 'post', `/charges/${charge.id}/cancel`)
      .send({ expectedVersion: 2, reason: 'Paga não cancela' })
      .expect(409);
    const reopened = (
      await admin(f, 'post', `/charges/${charge.id}/correct`)
        .send({ expectedVersion: 2, status: 'pending', reason: 'Pagamento lançado por engano' })
        .expect(200)
    ).body.data;
    expect(reopened).toMatchObject({ status: 'pending', paidAt: null, paidAmountCents: null });
    await admin(f, 'post', `/charges/${charge.id}/correct`)
      .send({ expectedVersion: 3, paidAt: today, reason: 'Pagamento sem status pago' })
      .expect(422);
    await admin(f, 'post', `/charges/${charge.id}/correct`)
      .send({ expectedVersion: 2, amountCents: 1, reason: 'Versão antiga' })
      .expect(409);
    const canceled = (
      await admin(f, 'post', `/charges/${charge.id}/cancel`)
        .send({ expectedVersion: 3, reason: 'Cortesia' })
        .expect(200)
    ).body.data;
    expect(canceled.situation).toBe('canceled');
    const history = (await admin(f, 'get', `/charges/${charge.id}/history`).expect(200)).body.data
      .items as { action: string; changes: Record<string, unknown> }[];
    expect(history.map((h) => h.action)).toEqual([
      'charge.canceled',
      'charge.corrected',
      'charge.paid',
      'charge.created',
    ]);
    expect(history[1]?.changes).toMatchObject({
      previous: { status: 'paid', paidAt: today, paidAmountCents: 19900 },
      current: { status: 'pending', paidAt: null, paidAmountCents: null },
      reason: 'Pagamento lançado por engano',
    });
  });
  it('lista filtra por empresa e somente o Super Admin administra cobranças', async () => {
    const own = (await create(f).expect(201)).body.data;
    await create(f, { tenantId: f.tenantB.tenant.id }).expect(201);
    const listed = (
      await admin(f, 'get', '/charges').query({ tenantId: f.tenantA.tenant.id }).expect(200)
    ).body.data.items;
    expect(listed.map((c: { id: string }) => c.id)).toEqual([own.id]);
    for (const [method, path, body] of [
      ['get', '/api/v1/admin/charges', undefined],
      ['post', '/api/v1/admin/charges/generate', undefined],
      ['post', `/api/v1/admin/charges/${own.id}/pay`, { expectedVersion: 1, paidAt: today }],
    ] as const) {
      const call = request(f.app)[method](path).set(tenantHeaders(f.ownerA, f.tenantA.tenant.id));
      await (body ? call.send(body) : call).expect(403);
    }
    expect((await f.firebase.db.doc(`billingCharges/${own.id}`).get()).get('status')).toBe(
      'pending',
    );
  });
  it('geração manual pelo painel usa a mesma regra idempotente', async () => {
    const first = (await admin(f, 'post', '/charges/generate').expect(200)).body.data;
    expect(first).toMatchObject({ examined: 2, failed: 0 });
    const second = (await admin(f, 'post', '/charges/generate').expect(200)).body.data;
    expect(second.created).toBe(0);
  });
});
