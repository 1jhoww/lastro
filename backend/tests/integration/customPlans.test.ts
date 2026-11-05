import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  bearer,
  expectStatus,
  issue,
  join,
  newUser,
  registerFixture,
  tenantHeaders,
  tenantInput,
  type Fixture,
} from '../helpers/fixture.js';
import { api, gestao } from '../helpers/management.js';
import { configure, publicPath } from '../helpers/catalog.js';
import { rollbackBlockers } from '../../src/modules/platformAdmin/rollbackCheck.js';
import { billingDate } from '../../src/modules/billing/calendar.js';

const f = registerFixture();
const subscriptionId = (fixture: Fixture) => fixture.tenantA.subscription.id;
const tenantId = (fixture: Fixture) => fixture.tenantA.tenant.id;
const admin = (fixture: Fixture, path: string) => ({
  get: () => request(fixture.app).get(`/api/v1/admin${path}`).set(bearer(fixture.platform)),
  post: (body: object, key: string = randomUUID()) =>
    request(fixture.app)
      .post(`/api/v1/admin${path}`)
      .set(bearer(fixture.platform))
      .set('Idempotency-Key', key)
      .send(body),
  patch: (body: object) =>
    request(fixture.app).patch(`/api/v1/admin${path}`).set(bearer(fixture.platform)).send(body),
});
const offer = (extra: object = {}) => ({
  name: 'Oferta Acme',
  description: 'Negociada com a diretoria',
  monthlyPriceCents: 25000,
  userLimit: 4,
  features: ['users.invite', 'catalog.public', 'commercial.visits'],
  sourcePlanCode: null,
  ...extra,
});
const createPlan = async (fixture: Fixture, extra: object = {}) =>
  (await expectStatus(admin(fixture, '/custom-plans').post(offer(extra)), 201)).body.data as {
    id: string;
    version: number;
    name: string;
    userLimit: number;
    features: string[];
  };
const contract = async (fixture: Fixture, id = subscriptionId(fixture)) =>
  (await fixture.firebase.db.doc(`subscriptions/${id}`).get()).data()!;
const assign = async (
  fixture: Fixture,
  plan: { id: string; version: number },
  extra: object = {},
) => {
  const version = (await contract(fixture)).version as number;
  return admin(fixture, `/subscriptions/${subscriptionId(fixture)}/custom-plan`).post({
    expectedVersion: version,
    planId: plan.id,
    planVersion: plan.version,
    // Confirms what the preview reports, unless a case states what was confirmed.
    acknowledgedLostFeatures: await lost(fixture, plan),
    reason: 'Contrato negociado',
    ...extra,
  });
};
const changeContract = async (fixture: Fixture, extra: object) => {
  const version = (await contract(fixture)).version as number;
  return admin(fixture, `/subscriptions/${subscriptionId(fixture)}/contract`).post({
    expectedVersion: version,
    acknowledgedLostFeatures: [],
    confirmed: true,
    reason: 'Ajuste individual',
    ...extra,
  });
};
const membership = async (fixture: Fixture) => {
  const me = await request(fixture.app).get('/api/v1/me').set(bearer(fixture.ownerA)).expect(200);
  return me.body.data.memberships.find(
    (m: { tenantId: string }) => m.tenantId === tenantId(fixture),
  );
};

describe('Cadastro de planos personalizados', () => {
  it('cria, audita e não aparece no catálogo de planos oficiais', async () => {
    const plan = await createPlan(f);
    expect(plan).toMatchObject({ status: 'active', version: 1, name: 'Oferta Acme' });
    const catalog = (await admin(f, '/plan-catalog').get().expect(200)).body.data;
    expect(catalog.items.map((p: { code: string }) => p.code)).toEqual([
      'essencial',
      'profissional',
      'gestao',
    ]);
    expect(JSON.stringify(catalog)).not.toContain('Oferta Acme');
    const history = (await admin(f, `/custom-plans/${plan.id}/history`).get().expect(200)).body
      .data;
    expect(history.items[0]).toMatchObject({ action: 'custom_plan.created' });
  });
  it('catálogo traz recursos reais, categorias, dependências e módulos base', async () => {
    const catalog = (await admin(f, '/plan-catalog').get().expect(200)).body.data;
    expect(catalog.features.find((x: { code: string }) => x.code === 'purchasing.orders')).toEqual(
      expect.objectContaining({
        category: 'purchasing',
        requires: ['purchasing.suppliers', 'costing.products', 'finance.payables'],
      }),
    );
    expect(catalog.baseResources.map((r: { code: string }) => r.code)).toContain('receivables');
    expect(catalog.categories.length).toBeGreaterThan(0);
  });
  it('repetir a criação com a mesma chave não cria segundo plano', async () => {
    const key = randomUUID();
    const first = await expectStatus(admin(f, '/custom-plans').post(offer(), key), 201);
    const second = await expectStatus(admin(f, '/custom-plans').post(offer(), key), 201);
    expect(second.body.data.id).toBe(first.body.data.id);
    const plans = await admin(f, '/custom-plans').get().expect(200);
    expect(plans.body.data.items).toHaveLength(1);
  });
  it('usa plano oficial como modelo, sem alterar o plano oficial', async () => {
    const catalog = (await admin(f, '/plan-catalog').get().expect(200)).body.data;
    const model = catalog.items.find((p: { code: string }) => p.code === 'gestao');
    const created = await expectStatus(
      admin(f, '/custom-plans').post(
        offer({
          name: 'Gestão negociado',
          monthlyPriceCents: 24900,
          userLimit: model.userLimit,
          features: model.features.map((x: { code: string }) => x.code),
          sourcePlanCode: 'gestao',
        }),
      ),
      201,
    );
    expect(created.body.data).toMatchObject({ sourcePlanCode: 'gestao', monthlyPriceCents: 24900 });
    const after = (await admin(f, '/plan-catalog').get().expect(200)).body.data;
    expect(after.items).toEqual(catalog.items);
    expect(after.items.find((p: { code: string }) => p.code === 'gestao').referencePriceCents).toBe(
      29900,
    );
  });
  it('duplica plano personalizado com nova identidade e sem empresas', async () => {
    const plan = await createPlan(f);
    expect((await assign(f, plan)).status).toBe(200);
    const copy = await expectStatus(
      admin(f, `/custom-plans/${plan.id}/duplicate`).post({ name: 'Oferta Acme 2' }),
      201,
    );
    expect(copy.body.data).toMatchObject({
      name: 'Oferta Acme 2',
      duplicatedFromId: plan.id,
      monthlyPriceCents: 25000,
      version: 1,
    });
    expect(copy.body.data.id).not.toBe(plan.id);
    const detail = await admin(f, `/custom-plans/${copy.body.data.id}`).get().expect(200);
    expect(detail.body.data.companies).toEqual([]);
  });
  it('edita com versão esperada e guarda valores anteriores no histórico', async () => {
    const plan = await createPlan(f);
    const stale = await admin(f, `/custom-plans/${plan.id}`).patch({
      expectedVersion: 9,
      monthlyPriceCents: 26000,
      reason: 'Reajuste',
    });
    expect(stale.status).toBe(409);
    const updated = await admin(f, `/custom-plans/${plan.id}`)
      .patch({ expectedVersion: 1, monthlyPriceCents: 26000, reason: 'Reajuste' })
      .expect(200);
    expect(updated.body.data).toMatchObject({ version: 2, monthlyPriceCents: 26000 });
    const history = (await admin(f, `/custom-plans/${plan.id}/history`).get().expect(200)).body
      .data;
    expect(history.items[0]).toMatchObject({
      action: 'custom_plan.updated',
      changes: {
        previous: { monthlyPriceCents: 25000 },
        current: { monthlyPriceCents: 26000 },
        reason: 'Reajuste',
      },
    });
  });
  it('recusa recurso desconhecido, dependência faltando e limite incoerente', async () => {
    const unknown = await admin(f, '/custom-plans').post(offer({ features: ['admin.total'] }));
    expect(unknown.status).toBe(422);
    const dependency = await admin(f, '/custom-plans').post(
      offer({ features: ['purchasing.orders'] }),
    );
    expect(dependency.status).toBe(422);
    expect(dependency.body.error.code).toBe('PLAN_DEPENDENCY_MISSING');
    const limit = await admin(f, '/custom-plans').post(
      offer({ userLimit: 1, features: ['users.invite'] }),
    );
    expect(limit.body.error.code).toBe('PLAN_USER_LIMIT_INVALID');
    const negative = await admin(f, '/custom-plans').post(offer({ monthlyPriceCents: -1 }));
    expect(negative.status).toBe(422);
    expect((await admin(f, '/custom-plans').get().expect(200)).body.data.items).toEqual([]);
  });
  it('plano desativado não aceita novos contratos e mantém os existentes', async () => {
    const plan = await createPlan(f);
    await expectStatus(assign(f, plan), 200);
    const off = await expectStatus(
      admin(f, `/custom-plans/${plan.id}/deactivate`).post({
        expectedVersion: 1,
        reason: 'Campanha encerrada',
      }),
      200,
    );
    expect(off.body.data.status).toBe('inactive');
    expect((await contract(f)).planCode).toBe('custom');
    expect((await membership(f)).plan.features).toContain('catalog.public');
    const other = await admin(f, `/subscriptions/${f.tenantB.subscription.id}/custom-plan`).post({
      expectedVersion: (await contract(f, f.tenantB.subscription.id)).version,
      planId: plan.id,
      planVersion: off.body.data.version,
      acknowledgedLostFeatures: [],
      reason: 'Oferta encerrada',
    });
    expect(other.body.error.code).toBe('CUSTOM_PLAN_INACTIVE');
    const owner = await newUser(f, 'dono-inativo');
    const refused = await admin(f, '/tenants').post({
      ...tenantInput('Empresa Nova', owner.email, 'essencial'),
      planCode: undefined,
      customPlanId: plan.id,
    });
    expect(refused.body.error.code).toBe('CUSTOM_PLAN_INACTIVE');
    await expectStatus(
      admin(f, `/custom-plans/${plan.id}/reactivate`).post({
        expectedVersion: off.body.data.version,
        reason: 'Campanha retomada',
      }),
      200,
    );
  });
});

describe('Contratos de plano personalizado', () => {
  it('vincula a empresa, guarda a cópia dos termos e libera só o contratado', async () => {
    const plan = await createPlan(f);
    const assigned = await expectStatus(assign(f, plan), 200);
    expect(assigned.body.data).toMatchObject({
      planCode: 'custom',
      planId: plan.id,
      planVersion: 1,
      monthlyPriceCents: 25000,
      userLimit: 4,
    });
    const stored = await contract(f);
    expect(stored.customContract).toMatchObject({
      planName: 'Oferta Acme',
      features: ['users.invite', 'catalog.public', 'commercial.visits'],
      origin: { monthlyPriceCents: 25000, userLimit: 4 },
    });
    const access = await membership(f);
    expect(access.plan).toEqual({
      code: 'custom',
      name: 'Oferta Acme',
      userLimit: 4,
      features: ['users.invite', 'catalog.public', 'commercial.visits'],
    });
    expect(access.permissions).toContain('catalog:manage');
    expect(access.permissions).not.toContain('purchases:read');
  });
  it('bloqueia na API o recurso fora do contrato, mesmo para administrador', async () => {
    await expectStatus(assign(f, await createPlan(f)), 200);
    const denied = await api(f).get('/purchases').expect(403);
    expect(denied.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    const settings = await api(f).get('/catalog-settings');
    expect(settings.status).toBe(200);
  });
  it('recurso contratado funciona depois do vínculo', async () => {
    const plan = await createPlan(f, { features: ['finance.payables'] });
    await expectStatus(assign(f, plan), 200);
    await api(f).get('/payables').expect(200);
    const recurring = await api(f).get('/recurring-expenses').expect(403);
    expect(recurring.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
  });
  it('editar o plano não altera contrato já assinado; empresa vê a diferença', async () => {
    const plan = await createPlan(f);
    await expectStatus(assign(f, plan), 200);
    const before = await contract(f);
    await admin(f, `/custom-plans/${plan.id}`)
      .patch({
        expectedVersion: 1,
        monthlyPriceCents: 40000,
        userLimit: 10,
        features: ['users.invite', 'catalog.public', 'commercial.visits', 'branding.custom'],
        reason: 'Nova tabela',
      })
      .expect(200);
    expect(await contract(f)).toEqual(before);
    expect((await membership(f)).plan.features).not.toContain('branding.custom');
    const diff = (
      await admin(f, `/subscriptions/${subscriptionId(f)}/contract-diff`)
        .get()
        .expect(200)
    ).body.data;
    expect(diff).toMatchObject({
      contractedVersion: 1,
      currentVersion: 2,
      againstOrigin: { same: true },
      againstCurrent: {
        same: false,
        monthlyPriceDeltaCents: -15000,
        userLimitDelta: -6,
        removedFeatures: ['branding.custom'],
      },
    });
    const detail = (await admin(f, `/custom-plans/${plan.id}`).get().expect(200)).body.data;
    expect(detail.companies).toEqual([
      expect.objectContaining({
        tenantId: tenantId(f),
        planVersion: 1,
        outdated: true,
        adjusted: false,
      }),
    ]);
  });
  it('oferta alterada depois da revisão exige nova revisão', async () => {
    const plan = await createPlan(f);
    await admin(f, `/custom-plans/${plan.id}`)
      .patch({ expectedVersion: 1, monthlyPriceCents: 30000, reason: 'Reajuste' })
      .expect(200);
    const refused = await assign(f, plan);
    expect(refused.status).toBe(409);
    expect((await contract(f)).planCode).not.toBe('custom');
  });
  it('altera valor de uma assinatura sem afetar plano nem outras empresas', async () => {
    const plan = await createPlan(f);
    await expectStatus(assign(f, plan), 200);
    const other = f.tenantB.subscription.id;
    const preview = await admin(f, `/subscriptions/${other}/custom-plan-change?planId=${plan.id}`)
      .get()
      .expect(200);
    await expectStatus(
      admin(f, `/subscriptions/${other}/custom-plan`).post({
        expectedVersion: preview.body.data.subscriptionVersion,
        planId: plan.id,
        planVersion: plan.version,
        acknowledgedLostFeatures: preview.body.data.lostFeatures,
        reason: 'Mesma oferta',
      }),
      200,
    );
    await expectStatus(changeContract(f, { monthlyPriceCents: 22000 }), 200);
    expect((await contract(f)).monthlyPriceCents).toBe(22000);
    expect((await contract(f, f.tenantB.subscription.id)).monthlyPriceCents).toBe(25000);
    const detail = (await admin(f, `/custom-plans/${plan.id}`).get().expect(200)).body.data;
    expect(detail.plan.monthlyPriceCents).toBe(25000);
    expect(
      detail.companies.find((c: { tenantId: string }) => c.tenantId === tenantId(f)).adjusted,
    ).toBe(true);
    const history = (
      await admin(f, `/subscriptions/${subscriptionId(f)}/history`)
        .get()
        .expect(200)
    ).body.data;
    expect(history.items[0]).toMatchObject({
      action: 'subscription.contract.changed',
      changes: {
        previousMonthlyPriceCents: 25000,
        monthlyPriceCents: 22000,
        reason: 'Ajuste individual',
      },
    });
  });
  it('altera limite de usuários e recursos do contrato, valendo na hora', async () => {
    await expectStatus(assign(f, await createPlan(f)), 200);
    await expectStatus(
      changeContract(f, {
        userLimit: 6,
        features: ['users.invite', 'catalog.public', 'commercial.visits', 'branding.custom'],
      }),
      200,
    );
    const access = await membership(f);
    expect(access.plan.userLimit).toBe(6);
    expect(access.permissions).toContain('branding:manage');
  });
  it('alteração individual respeita dependências e recursos conhecidos', async () => {
    await expectStatus(assign(f, await createPlan(f)), 200);
    const dependency = await changeContract(f, {
      features: ['users.invite', 'catalog.public', 'commercial.visits', 'finance.recurring'],
    });
    expect(dependency.body.error.code).toBe('PLAN_DEPENDENCY_MISSING');
    const unknown = await changeContract(f, { features: ['admin.total'] });
    expect(unknown.status).toBe(422);
    const unconfirmed = await changeContract(f, { confirmed: false, monthlyPriceCents: 1000 });
    expect(unconfirmed.status).toBe(422);
  });
  it('plano gratuito não gera cobrança nem vencimento, e mantém os recursos', async () => {
    const plan = await createPlan(f, { name: 'Cortesia', monthlyPriceCents: 0 });
    await expectStatus(assign(f, plan), 200);
    expect((await contract(f)).monthlyPriceCents).toBe(0);
    expect((await membership(f)).permissions).toContain('catalog:manage');
    const generated = await expectStatus(admin(f, '/charges/generate').post({}), 200);
    expect(generated.body.data.failed).toBe(0);
    const charges = await f.firebase.db
      .collection('billingCharges')
      .where('subscriptionId', '==', subscriptionId(f))
      .get();
    expect(charges.empty).toBe(true);
    const company = await admin(f, `/companies/${tenantId(f)}`)
      .get()
      .expect(200);
    expect(company.body.data.subscription.nextDueDate).toBeNull();
  });
  it('empresa nova nasce gratuita a partir de oferta paga, se negociado', async () => {
    const plan = await createPlan(f);
    const owner = await newUser(f, 'dono-cortesia');
    const { planCode: _official, ...input } = tenantInput('Cortesia', owner.email, 'essencial');
    const created = await expectStatus(
      admin(f, '/tenants').post({ ...input, customPlanId: plan.id, monthlyPriceCents: 0 }),
      201,
    );
    expect(created.body.data.subscription.monthlyPriceCents).toBe(0);
    expect(created.body.data.subscription.customContract.origin.monthlyPriceCents).toBe(25000);
  });
  it('contrato gratuito que passa a pagar não cobra os meses gratuitos', async () => {
    const plan = await createPlan(f, { monthlyPriceCents: 0 });
    await expectStatus(assign(f, plan), 200);
    await f.firebase.db
      .doc(`subscriptions/${subscriptionId(f)}`)
      .update({ billingStartsOn: '2020-01-01', billingDay: 1 });
    await expectStatus(changeContract(f, { monthlyPriceCents: 15000 }), 200);
    const stored = await contract(f);
    expect(stored.billingStartsOn).toBe(billingDate(new Date()));
    await expectStatus(admin(f, '/charges/generate').post({}), 200);
    const charges = await f.firebase.db
      .collection('billingCharges')
      .where('subscriptionId', '==', subscriptionId(f))
      .get();
    for (const charge of charges.docs)
      expect(charge.get('dueDate') >= stored.billingStartsOn).toBe(true);
  });
  it('zerar o valor preserva cobrança já emitida e para as próximas', async () => {
    await expectStatus(assign(f, await createPlan(f)), 200);
    const today = billingDate(new Date());
    const charge = await expectStatus(
      admin(f, '/charges').post({
        tenantId: tenantId(f),
        competence: today.slice(0, 7),
        amountCents: 25000,
        dueDate: today,
        reason: 'Cobrança do contrato',
      }),
      201,
    );
    await expectStatus(changeContract(f, { monthlyPriceCents: 0 }), 200);
    const stored = await f.firebase.db.doc(`billingCharges/${charge.body.data.id}`).get();
    expect(stored.get('amountCents')).toBe(25000);
    expect(stored.get('status')).toBe('pending');
    const company = await admin(f, `/companies/${tenantId(f)}`)
      .get()
      .expect(200);
    expect(company.body.data.subscription.nextDueDate).toBeNull();
  });
  it('contrato gratuito recusa cobrança manual sem valor e aceita a combinada', async () => {
    await expectStatus(assign(f, await createPlan(f, { monthlyPriceCents: 0 })), 200);
    const today = billingDate(new Date());
    const body = {
      tenantId: tenantId(f),
      competence: today.slice(0, 7),
      dueDate: today,
      reason: 'Implantação combinada',
    };
    expect((await admin(f, '/charges').post({ ...body, amountCents: 0 })).status).toBe(422);
    await expectStatus(admin(f, '/charges').post({ ...body, amountCents: 50000 }), 201);
  });
  describe('saída de um contrato gratuito para um plano oficial', () => {
    const toGestao = async (extra: object = {}) => {
      const preview = (
        await admin(f, `/subscriptions/${subscriptionId(f)}/plan-change?planCode=gestao`)
          .get()
          .expect(200)
      ).body.data;
      return {
        preview,
        response: await admin(f, `/subscriptions/${subscriptionId(f)}/plan`).post({
          expectedVersion: (await contract(f)).version,
          planCode: 'gestao',
          acknowledgedLostFeatures: preview.lostFeatures,
          reason: 'Fim da cortesia',
          ...extra,
        }),
      };
    };
    const startFree = async () =>
      expectStatus(assign(f, await createPlan(f, { monthlyPriceCents: 0 })), 200);

    it('recusa herdar R$ 0,00 e não muda o contrato', async () => {
      await startFree();
      const before = await contract(f);
      const { response } = await toGestao();
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('PLAN_PRICE_REQUIRED');
      expect(await contract(f)).toEqual(before);
    });
    it('aceita o preço oficial sugerido, sem cobrar o período gratuito', async () => {
      await startFree();
      await f.firebase.db
        .doc(`subscriptions/${subscriptionId(f)}`)
        .update({ billingStartsOn: '2026-01-01' });
      const { preview, response } = await toGestao({ monthlyPriceCents: 29900 });
      expect(preview).toMatchObject({ monthlyPriceCents: 0, referencePriceCents: 29900 });
      expect(response.status).toBe(200);
      const stored = await contract(f);
      expect(stored).toMatchObject({ planCode: 'gestao', monthlyPriceCents: 29900 });
      expect(stored.billingStartsOn).toBe(billingDate(new Date()));
      const history = (
        await admin(f, `/subscriptions/${subscriptionId(f)}/history`)
          .get()
          .expect(200)
      ).body.data;
      expect(JSON.stringify(history.items[0])).toContain('referencePriceCents');
    });
    it('condição especial exige valor informado e confirmado', async () => {
      await startFree();
      const refused = await toGestao({ monthlyPriceCents: 15000 });
      expect(refused.response.status).toBe(422);
      expect(refused.response.body.error.code).toBe('NEGOTIATED_PRICE_UNCONFIRMED');
      const { response } = await toGestao({
        monthlyPriceCents: 15000,
        negotiatedPriceConfirmed: true,
      });
      expect(response.status).toBe(200);
      expect((await contract(f)).monthlyPriceCents).toBe(15000);
    });
    it('manter gratuito no plano oficial também precisa ser confirmado', async () => {
      await startFree();
      const refused = await toGestao({ monthlyPriceCents: 0 });
      expect(refused.response.body.error.code).toBe('NEGOTIATED_PRICE_UNCONFIRMED');
      const { response } = await toGestao({ monthlyPriceCents: 0, negotiatedPriceConfirmed: true });
      expect(response.status).toBe(200);
      expect((await contract(f)).monthlyPriceCents).toBe(0);
    });
    it('não altera cobrança já emitida', async () => {
      await expectStatus(assign(f, await createPlan(f)), 200);
      const today = billingDate(new Date());
      const charge = await expectStatus(
        admin(f, '/charges').post({
          tenantId: tenantId(f),
          competence: today.slice(0, 7),
          amountCents: 25000,
          dueDate: today,
          reason: 'Cobrança do contrato',
        }),
        201,
      );
      await expectStatus(changeContract(f, { monthlyPriceCents: 0 }), 200);
      expect((await toGestao({ monthlyPriceCents: 29900 })).response.status).toBe(200);
      const stored = await f.firebase.db.doc(`billingCharges/${charge.body.data.id}`).get();
      expect(stored.get('amountCents')).toBe(25000);
      expect(stored.get('status')).toBe('pending');
    });
    it('contrato pago continua mantendo o valor quando nada é informado', async () => {
      await expectStatus(assign(f, await createPlan(f)), 200);
      expect((await toGestao()).response.status).toBe(200);
      expect((await contract(f)).monthlyPriceCents).toBe(25000);
    });
  });
  it('recurso repetido na lista não duplica o contrato', async () => {
    await expectStatus(assign(f, await createPlan(f)), 200);
    await expectStatus(
      changeContract(f, {
        features: ['users.invite', 'users.invite', 'catalog.public', 'commercial.visits'],
        monthlyPriceCents: 24000,
      }),
      200,
    );
    expect((await contract(f)).customContract.features).toEqual([
      'users.invite',
      'catalog.public',
      'commercial.visits',
    ]);
  });
  it('contrato oficial não recebe recursos individuais', async () => {
    const refused = await changeContract(f, { monthlyPriceCents: 1000 });
    expect(refused.status).toBe(409);
    expect((await contract(f)).monthlyPriceCents).not.toBe(1000);
  });
  it('downgrade exige confirmação dos recursos perdidos e preserva os dados', async () => {
    await configure(f);
    const plan = await createPlan(f, { features: ['users.invite', 'commercial.visits'] });
    const preview = (
      await admin(f, `/subscriptions/${subscriptionId(f)}/custom-plan-change?planId=${plan.id}`)
        .get()
        .expect(200)
    ).body.data;
    expect(preview.lostFeatures).toContain('catalog.public');
    expect(preview.publicCatalogEnabled).toBe(true);
    const unconfirmed = await assign(f, plan, { acknowledgedLostFeatures: [] });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error.code).toBe('FEATURE_LOSS_UNCONFIRMED');
    await expectStatus(assign(f, plan), 200);
    await request(f.app).get(publicPath()).expect(404);
    const stored = await f.firebase.db
      .collection(`tenants/${tenantId(f)}/catalogSettings`)
      .doc('current')
      .get();
    expect(stored.data()?.enabled).toBe(true);
  });
  it('downgrade de vagas é recusado sem desativar ninguém', async () => {
    const pending = await newUser(f, 'pendente');
    await expectStatus(issue(f, pending), 201);
    const plan = await createPlan(f, { userLimit: 1, features: ['commercial.visits'] });
    const preview = (
      await admin(f, `/subscriptions/${subscriptionId(f)}/custom-plan-change?planId=${plan.id}`)
        .get()
        .expect(200)
    ).body.data;
    expect(preview.excessSeats).toBe(1);
    const refused = await assign(f, plan);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('USER_LIMIT_REACHED');
    const tenant = (await f.firebase.db.doc(`tenants/${tenantId(f)}`).get()).data()!;
    expect(tenant.activeUsers).toBe(1);
    expect((await contract(f)).planCode).not.toBe('custom');
  });
  it('limite individual abaixo das vagas ocupadas é recusado', async () => {
    const member = await newUser(f, 'membro-2');
    await expectStatus(assign(f, await createPlan(f)), 200);
    await expectStatus(join(f, member), 200);
    const refused = await changeContract(f, {
      userLimit: 1,
      features: ['catalog.public'],
      acknowledgedLostFeatures: ['users.invite', 'commercial.visits'],
    });
    expect(refused.body.error.code).toBe('USER_LIMIT_REACHED');
  });
  it('volta a um plano oficial sem deixar o campo do contrato gravado', async () => {
    const plan = await createPlan(f);
    await expectStatus(assign(f, plan), 200);
    const version = (await contract(f)).version as number;
    const preview = (
      await admin(f, `/subscriptions/${subscriptionId(f)}/plan-change?planCode=gestao`)
        .get()
        .expect(200)
    ).body.data;
    expect(preview.currentPlanCode).toBe('custom');
    await expectStatus(
      admin(f, `/subscriptions/${subscriptionId(f)}/plan`).post({
        expectedVersion: version,
        planCode: 'gestao',
        acknowledgedLostFeatures: preview.lostFeatures,
        reason: 'Fim da negociação',
      }),
      200,
    );
    const stored = await contract(f);
    expect(stored).toMatchObject({ planCode: 'gestao', planId: 'gestao', userLimit: 5 });
    expect(stored).not.toHaveProperty('customContract');
    expect((await membership(f)).permissions).toContain('purchases:read');
  });
  it('substitui por outro plano personalizado e atualiza para a versão mais nova', async () => {
    const first = await createPlan(f);
    const second = await createPlan(f, { name: 'Oferta Nova', monthlyPriceCents: 31000 });
    await expectStatus(assign(f, first), 200);
    await expectStatus(assign(f, second), 200);
    expect(await contract(f)).toMatchObject({ planId: second.id, monthlyPriceCents: 31000 });
    const same = await assign(f, second);
    expect(same.status).toBe(422);
    const updated = await admin(f, `/custom-plans/${second.id}`)
      .patch({ expectedVersion: 1, monthlyPriceCents: 32000, reason: 'Reajuste' })
      .expect(200);
    await expectStatus(assign(f, updated.body.data), 200);
    expect(await contract(f)).toMatchObject({ planVersion: 2, monthlyPriceCents: 32000 });
  });
  it('valor negociado no vínculo fica no contrato; a oferta original também', async () => {
    const plan = await createPlan(f);
    await expectStatus(assign(f, plan, { monthlyPriceCents: 20000 }), 200);
    const stored = await contract(f);
    expect(stored.monthlyPriceCents).toBe(20000);
    expect(stored.customContract.origin.monthlyPriceCents).toBe(25000);
  });
  it('cria empresa nova já em plano personalizado', async () => {
    const plan = await createPlan(f);
    const owner = await newUser(f, 'dono-personalizado');
    const { planCode: _official, ...input } = tenantInput('Nova Oferta', owner.email, 'essencial', {
      billingDay: 7,
    });
    const created = await expectStatus(
      admin(f, '/tenants').post({ ...input, customPlanId: plan.id }),
      201,
    );
    expect(created.body.data.subscription).toMatchObject({
      planCode: 'custom',
      planId: plan.id,
      monthlyPriceCents: 25000,
      userLimit: 4,
      billingDay: 7,
    });
  });
  it('exige plano oficial ou personalizado, nunca os dois', async () => {
    const plan = await createPlan(f);
    const owner = await newUser(f, 'dono-ambos');
    const both = await admin(f, '/tenants').post({
      ...tenantInput('Empresa Ambígua', owner.email, 'essencial'),
      customPlanId: plan.id,
    });
    expect(both.status).toBe(422);
  });
  it('cobrança nasce do contrato personalizado sem mudar a anterior', async () => {
    await expectStatus(assign(f, await createPlan(f)), 200);
    const today = billingDate(new Date());
    const charge = await expectStatus(
      admin(f, '/charges').post({
        tenantId: tenantId(f),
        competence: today.slice(0, 7),
        amountCents: 25000,
        dueDate: today,
        reason: 'Cobrança do contrato',
      }),
      201,
    );
    expect(charge.body.data).toMatchObject({ planCode: 'custom', amountCents: 25000 });
    await expectStatus(changeContract(f, { monthlyPriceCents: 21000 }), 200);
    const stored = await f.firebase.db.doc(`billingCharges/${charge.body.data.id}`).get();
    expect(stored.get('amountCents')).toBe(25000);
  });
  it('painel mostra nome, recursos, filtro e contagem do plano personalizado', async () => {
    await expectStatus(assign(f, await createPlan(f)), 200);
    const company = await admin(f, `/companies/${tenantId(f)}`)
      .get()
      .expect(200);
    expect(company.body.data.subscription).toMatchObject({
      planName: 'Oferta Acme',
      features: ['users.invite', 'catalog.public', 'commercial.visits'],
    });
    const list = await admin(f, '/companies?planCode=custom').get().expect(200);
    expect(list.body.data.items.map((c: { id: string }) => c.id)).toEqual([tenantId(f)]);
    const overview = await admin(f, '/overview').get().expect(200);
    expect(overview.body.data.plans.custom).toBe(1);
  });
  it('plano personalizado impede a reversão da API, e voltar ao oficial libera', async () => {
    const plan = await createPlan(f);
    expect(await rollbackBlockers(f.firebase.db)).toMatchObject({ rollbackSafe: true });
    await expectStatus(assign(f, plan), 200);
    expect(await rollbackBlockers(f.firebase.db)).toMatchObject({
      rollbackSafe: false,
      blockers: [{ tenantId: tenantId(f), reason: 'plan_custom' }],
    });
    const preview = await admin(
      f,
      `/subscriptions/${subscriptionId(f)}/plan-change?planCode=profissional`,
    )
      .get()
      .expect(200);
    await expectStatus(
      admin(f, `/subscriptions/${subscriptionId(f)}/plan`).post({
        expectedVersion: (await contract(f)).version,
        planCode: 'profissional',
        acknowledgedLostFeatures: preview.body.data.lostFeatures,
        reason: 'Fim da negociação',
      }),
      200,
    );
    expect(await rollbackBlockers(f.firebase.db)).toMatchObject({ rollbackSafe: true });
    const stored = await f.firebase.db.doc(`subscriptions/${subscriptionId(f)}`).get();
    expect(stored.data()).not.toHaveProperty('customContract');
  });
  it('cobrança emitida em plano personalizado continua impedindo a reversão', async () => {
    const charge = (planCode: string, id: string) =>
      f.firebase.db.doc(`billingCharges/${id}`).set({ id, tenantId: tenantId(f), planCode });
    await charge('profissional', 'cobranca-oficial');
    expect(await rollbackBlockers(f.firebase.db)).toMatchObject({ rollbackSafe: true });
    await charge('custom', 'cobranca-1');
    await charge('custom', 'cobranca-2');
    await charge('gestao', 'cobranca-3');
    const result = await rollbackBlockers(f.firebase.db);
    expect(result.rollbackSafe).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        { tenantId: tenantId(f), reason: 'charge_custom' },
        { tenantId: tenantId(f), reason: 'charge_gestao' },
      ]),
    );
    expect(result.blockers).toHaveLength(2);
  });
  it('a empresa vê o nome do plano, sem detalhes internos da negociação', async () => {
    const plan = await createPlan(f, {
      description: 'Desconto aprovado pela diretoria',
      monthlyPriceCents: 24700,
    });
    await expectStatus(assign(f, plan), 200);
    const access = await membership(f);
    expect(access.plan).toEqual({
      code: 'custom',
      name: 'Oferta Acme',
      userLimit: plan.userLimit,
      features: expect.arrayContaining(plan.features),
    });
    const body = JSON.stringify(
      (await request(f.app).get('/api/v1/me').set(bearer(f.ownerA)).expect(200)).body,
    );
    for (const internal of [
      'Desconto aprovado pela diretoria',
      'Contrato negociado',
      'monthlyPriceCents',
      'commercialNotes',
      'customContract',
      'origin',
    ])
      expect(body).not.toContain(internal);
  });
  it('suspender um contrato personalizado preserva o contrato, e reativar devolve o acesso', async () => {
    const plan = await createPlan(f);
    await expectStatus(assign(f, plan), 200);
    const before = await contract(f);
    await expectStatus(
      admin(f, `/subscriptions/${subscriptionId(f)}/suspend`).post({
        expectedVersion: before.version,
        reason: 'Pedido da empresa',
      }),
      200,
    );
    const suspended = await contract(f);
    expect(suspended).toMatchObject({
      status: 'suspended',
      planCode: 'custom',
      monthlyPriceCents: before.monthlyPriceCents,
      userLimit: before.userLimit,
      customContract: before.customContract,
    });
    await expectStatus(
      admin(f, `/subscriptions/${subscriptionId(f)}/reactivate`).post({
        expectedVersion: suspended.version,
        reason: 'Retomada combinada',
      }),
      200,
    );
    expect(await contract(f)).toMatchObject({
      status: 'active',
      customContract: before.customContract,
    });
  });
});

describe('Compatibilidade com planos oficiais', () => {
  it('Gestão mantém acesso a compras, recorrências, painel e relatórios', async () => {
    await gestao(f);
    await api(f).get('/purchases').expect(200);
    await api(f).get('/recurring-expenses').expect(200);
    await api(f).get('/finance/settings').expect(200);
    const access = await membership(f);
    expect(access.plan.code).toBe('gestao');
    expect(access.permissions).toEqual(
      expect.arrayContaining([
        'suppliers:manage',
        'recurring:manage',
        'financial-dashboard:read',
        'financial-reports:read',
      ]),
    );
  });
  it('Profissional continua sem os recursos do Gestão', async () => {
    await f.firebase.db
      .doc(`subscriptions/${subscriptionId(f)}`)
      .update({ planCode: 'profissional', userLimit: 2 });
    const denied = await api(f).get('/recurring-expenses').expect(403);
    expect(denied.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    expect((await membership(f)).plan.features).toEqual([
      'users.invite',
      'catalog.public',
      'commercial.sellers',
      'commercial.visits',
      'branding.custom',
    ]);
  });
  it('Essencial continua sem recursos do plano', async () => {
    await f.firebase.db
      .doc(`subscriptions/${subscriptionId(f)}`)
      .update({ planCode: 'essencial', userLimit: 1 });
    expect((await membership(f)).plan.features).toEqual([]);
  });
});

describe('Consulta de créditos de fornecedores depois de uma troca de plano', () => {
  const now = '2026-10-01T12:00:00.000Z';
  const credit = async (tenant: string, id: string, balanceCents = 12000) =>
    f.firebase.db.doc(`tenants/${tenant}/supplierCredits/${id}`).set({
      id,
      tenantId: tenant,
      supplierId: 'fornecedor-1',
      supplierName: 'Distribuidora Exemplo',
      purchaseId: 'compra-1',
      purchaseCode: 'C-41',
      closureId: 'encerramento-1',
      kind: 'credit',
      originalCents: 12000,
      appliedCents: 12000 - balanceCents,
      recoveredCents: 0,
      balanceCents,
      hasBalance: balanceCents > 0,
      status: balanceCents > 0 ? 'open' : 'settled',
      issuedOn: '2026-10-01',
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: 'u1',
      updatedBy: 'u1',
      schemaVersion: 1,
    });
  const denied = async (pending: PromiseLike<request.Response>, code: string) => {
    const response = await pending;
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(code);
  };

  it('sem compras no plano e sem crédito registrado, a consulta não existe', async () => {
    expect((await membership(f)).permissions).not.toContain('supplier-credits:read');
    await denied(api(f).get('/supplier-credits'), 'FEATURE_NOT_IN_PLAN');
  });
  it('com saldo zerado, o histórico continua legível e só de leitura', async () => {
    await credit(tenantId(f), 'quitado', 0);
    const access = await membership(f);
    expect(access.permissions).toContain('supplier-credits:read');
    expect(access.permissions).not.toContain('purchases:read');
    const settled = (await api(f).get('/supplier-credits?status=settled').expect(200)).body.data;
    expect(settled.items.map((c: { id: string }) => c.id)).toEqual(['quitado']);
    await api(f).get('/supplier-credits/quitado').expect(200);
    await api(f).get('/supplier-credits/quitado/movements').expect(200);
    await denied(
      api(f).post('/supplier-credits/quitado/applications', {
        expectedVersion: 1,
        payableId: 'titulo-1',
        amountCents: 100,
      }),
      'FEATURE_NOT_IN_PLAN',
    );
    await denied(api(f).post('/purchases', {}), 'FEATURE_NOT_IN_PLAN');
  });
  it('com saldo registrado, o histórico continua legível e só de leitura', async () => {
    await credit(tenantId(f), 'aberto');
    await credit(tenantId(f), 'quitado', 0);
    const access = await membership(f);
    expect(access.permissions).toContain('supplier-credits:read');
    expect(access.permissions).not.toContain('payables:read');
    expect(access.permissions).not.toContain('purchases:read');
    const open = (await api(f).get('/supplier-credits').expect(200)).body.data;
    expect(open.items.map((c: { id: string }) => c.id)).toEqual(['aberto']);
    const all = (await api(f).get('/supplier-credits?status=all').expect(200)).body.data;
    expect(all.items).toHaveLength(2);
    await api(f).get('/supplier-credits/quitado').expect(200);
    await api(f).get('/supplier-credits/aberto/movements').expect(200);
    await denied(
      api(f).post('/supplier-credits/aberto/applications', {
        expectedVersion: 1,
        payableId: 'titulo-1',
        amountCents: 100,
      }),
      'FEATURE_NOT_IN_PLAN',
    );
    await denied(
      api(f).post('/supplier-credits/aberto/recoveries', {
        expectedVersion: 1,
        amountCents: 100,
        recoveredOn: '2026-10-02',
      }),
      'FEATURE_NOT_IN_PLAN',
    );
    await denied(api(f).post('/purchases', {}), 'FEATURE_NOT_IN_PLAN');
    await denied(api(f).get('/payables'), 'FEATURE_NOT_IN_PLAN');
  });
  it('contas a pagar sem compras: o crédito registrado decide, e usar continua possível', async () => {
    const plan = await createPlan(f, { features: ['finance.payables'] });
    await expectStatus(assign(f, plan), 200);
    expect((await membership(f)).permissions).not.toContain('supplier-credits:read');
    await credit(tenantId(f), 'aberto');
    const access = await membership(f);
    expect(access.permissions).toEqual(
      expect.arrayContaining(['supplier-credits:read', 'payables:manage']),
    );
    await api(f).get('/supplier-credits').expect(200);
  });
  it('crédito de outra empresa não abre a consulta nem é alcançável', async () => {
    await credit(f.tenantB.tenant.id, 'de-outra-empresa');
    expect((await membership(f)).permissions).not.toContain('supplier-credits:read');
    await denied(api(f).get('/supplier-credits'), 'FEATURE_NOT_IN_PLAN');
    await credit(tenantId(f), 'proprio');
    await api(f).get('/supplier-credits/de-outra-empresa').expect(404);
    const items = (await api(f).get('/supplier-credits').expect(200)).body.data.items;
    expect(items.map((c: { id: string }) => c.id)).toEqual(['proprio']);
  });
  it('quem não tem permissão financeira continua de fora', async () => {
    const seller = await newUser(f, 'vendedor-creditos');
    await expectStatus(join(f, seller, 'seller'), 200);
    await credit(tenantId(f), 'quitado', 0);
    const me = await request(f.app).get('/api/v1/me').set(bearer(seller)).expect(200);
    expect(me.body.data.memberships[0].permissions).not.toContain('supplier-credits:read');
    await denied(api(f, tenantId(f), seller).get('/supplier-credits'), 'FORBIDDEN');
  });
  it('Gestão consulta mesmo sem nenhum crédito registrado', async () => {
    await gestao(f);
    expect((await membership(f)).permissions).toContain('supplier-credits:read');
    await api(f).get('/supplier-credits').expect(200);
  });
});

describe('Segurança do Super Admin', () => {
  it('administrador comum não lê nem altera planos personalizados', async () => {
    const plan = await createPlan(f);
    const headers = tenantHeaders(f.ownerA, tenantId(f));
    const calls = [
      request(f.app).get('/api/v1/admin/custom-plans').set(headers),
      request(f.app).get(`/api/v1/admin/custom-plans/${plan.id}`).set(headers),
      request(f.app)
        .post('/api/v1/admin/custom-plans')
        .set(headers)
        .set('Idempotency-Key', randomUUID())
        .send(offer()),
      request(f.app)
        .patch(`/api/v1/admin/custom-plans/${plan.id}`)
        .set(headers)
        .send({ expectedVersion: 1, monthlyPriceCents: 100, reason: 'Sem autorização' }),
      request(f.app)
        .post(`/api/v1/admin/subscriptions/${subscriptionId(f)}/custom-plan`)
        .set(headers)
        .send({
          expectedVersion: 1,
          planId: plan.id,
          planVersion: 1,
          acknowledgedLostFeatures: [],
          reason: 'Sem autorização',
        }),
      request(f.app)
        .post(`/api/v1/admin/subscriptions/${subscriptionId(f)}/contract`)
        .set(headers)
        .send({
          expectedVersion: 1,
          features: ['finance.payables'],
          acknowledgedLostFeatures: [],
          confirmed: true,
          reason: 'Sem autorização',
        }),
    ];
    for (const call of calls) expect((await call).status).toBe(403);
    expect((await contract(f)).planCode).not.toBe('custom');
  });
  it('sem autenticação não acessa', async () => {
    await request(f.app).get('/api/v1/admin/custom-plans').expect(401);
  });
  it('detalhe do plano não expõe dados de outra coleção da empresa', async () => {
    const plan = await createPlan(f);
    await expectStatus(assign(f, plan), 200);
    const detail = (await admin(f, `/custom-plans/${plan.id}`).get().expect(200)).body.data;
    expect(Object.keys(detail.companies[0]).sort()).toEqual(
      [
        'adjusted',
        'monthlyPriceCents',
        'outdated',
        'planVersion',
        'subscriptionId',
        'subscriptionStatus',
        'tenantId',
        'tenantName',
        'userLimit',
      ].sort(),
    );
  });
});

async function lost(fixture: Fixture, plan: { id: string }) {
  const preview = await admin(
    fixture,
    `/subscriptions/${subscriptionId(fixture)}/custom-plan-change?planId=${plan.id}`,
  )
    .get()
    .expect(200);
  return preview.body.data.lostFeatures as string[];
}
