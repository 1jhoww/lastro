import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture } from '../helpers/fixture.js';
import { seller } from '../helpers/commercial.js';
import { draft, confirm, orderHeaders, command, orderDocs } from '../helpers/orders.js';
import { condition, method } from '../helpers/finance.js';
import { companyDate } from '../../src/modules/orders/calculation.js';
import { calendarFor } from '../../src/modules/finance/paymentCalculation.js';
const f = registerFixture();
describe('Incremento E1: cadastros e seleção comercial', () => {
  it('empresa configura fuso IANA validado sem alterar calendário histórico', async () => {
    await request(f.app)
      .patch('/api/v1/tenants/current')
      .set(orderHeaders(f))
      .send({
        name: f.tenantA.tenant.name,
        expectedVersion: f.tenantA.tenant.version,
        timezone: 'Asia/Tokyo',
      })
      .expect(200);
    const c = await condition(f),
      o = await confirm(
        f,
        await draft(f, f.ownerA, {
          extra: { payment: undefined, paymentConditionId: c.id, paymentConditionVersion: 1 },
        }),
      );
    expect(o.paymentTerms?.timeZone).toBe('Asia/Tokyo');
    expect(o.paymentTerms?.baseDate).toBe(companyDate(new Date(o.confirmedAt!), 'Asia/Tokyo'));
    await request(f.app)
      .patch('/api/v1/tenants/current')
      .set(orderHeaders(f))
      .send({
        name: f.tenantA.tenant.name,
        expectedVersion: f.tenantA.tenant.version + 1,
        timezone: 'Zona/Inexistente',
      })
      .expect(422);
  });
  it('cadastro idempotente, nome único normalizado por empresa e tipos separados', async () => {
    const key = randomUUID(),
      body = { name: 'À vista', preset: 'cash' };
    const call = () =>
      request(f.app)
        .post('/api/v1/payment-conditions')
        .set(orderHeaders(f))
        .set('Idempotency-Key', key)
        .send(body);
    const a = (await call().expect(201)).body.data;
    expect((await call().expect(201)).body.data).toEqual(a);
    await request(f.app)
      .post('/api/v1/payment-conditions')
      .set(orderHeaders(f))
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, name: 'A VISTA' })
      .expect(409);
    await request(f.app)
      .post('/api/v1/payment-conditions')
      .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(201);
    await request(f.app)
      .post('/api/v1/payment-methods')
      .set(orderHeaders(f))
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'À vista', kind: 'cash' })
      .expect(201);
    expect((await orderDocs(f, 'paymentConditions').get()).size).toBe(1);
  });
  it('cadastros com mesmo nome concorrente têm somente um vencedor', async () => {
    const calls = await Promise.all(
      [1, 2].map(() =>
        request(f.app)
          .post('/api/v1/payment-conditions')
          .set(orderHeaders(f))
          .set('Idempotency-Key', randomUUID())
          .send({ name: '30 dias', preset: 'net30' }),
      ),
    );
    expect(calls.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await orderDocs(f, 'paymentConditions').get()).size).toBe(1);
  });
  it('vendedor só vê opções ativas, sem metadados administrativos ou cadastros financeiros', async () => {
    const user = await seller(f),
      c = await condition(f),
      m = await method(f);
    for (const path of [
      '/payment-conditions',
      '/payment-methods',
      `/payment-conditions/${c.id}`,
      `/payment-methods/${m.id}`,
    ])
      await request(f.app).get(`/api/v1${path}`).set(orderHeaders(f, user)).expect(403);
    const options = (
      await request(f.app)
        .get('/api/v1/orders/payment-options/conditions')
        .set(orderHeaders(f, user))
        .expect(200)
    ).body.data.items;
    expect(options).toHaveLength(1);
    expect(options[0]).not.toHaveProperty('createdBy');
    await request(f.app)
      .patch(`/api/v1/payment-conditions/${c.id}`)
      .set(orderHeaders(f))
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1, status: 'inactive' })
      .expect(200);
    expect(
      (
        await request(f.app)
          .get('/api/v1/orders/payment-options/conditions')
          .set(orderHeaders(f, user))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(0);
    await request(f.app)
      .get('/api/v1/orders/payment-options/conditions?status=all')
      .set(orderHeaders(f, user))
      .expect(422);
  });
  it('confirmação fixa fuso/data-base e prazos 30/60/90; forma prevista não significa recebimento', async () => {
    const c = await condition(f, { preset: '30_60_90' }),
      m = await method(f, 'card');
    const o = await confirm(
      f,
      await draft(f, f.ownerA, {
        extra: {
          payment: undefined,
          paymentConditionId: c.id,
          paymentConditionVersion: 1,
          intendedPaymentMethodId: m.id,
          intendedPaymentMethodVersion: 1,
        },
      }),
    );
    const base = companyDate(new Date(o.confirmedAt!), 'America/Sao_Paulo');
    expect(o.paymentTerms?.baseDate).toBe(base);
    expect(o.payment?.dueDates).toEqual(calendarFor(base, c.schedule));
    expect(o.installments.map((p) => p.amountCents)).toEqual([684, 683, 683]);
    expect(o.intendedPaymentMethod?.kind).toBe('card');
    expect((await orderDocs(f, 'payments').get()).size).toBe(0);
  });
  it('customização de pesos e doze parcelas conserva centavos', async () => {
    const c = await condition(f, {
      preset: undefined,
      schedule: Array.from({ length: 12 }, (_, i) => ({ offsetDays: i, weight: i + 1 })),
    });
    const o = await confirm(
      f,
      await draft(f, f.ownerA, {
        extra: { payment: undefined, paymentConditionId: c.id, paymentConditionVersion: 1 },
      }),
    );
    expect(o.installments).toHaveLength(12);
    expect(o.installments.reduce((a, p) => a + p.amountCents, 0)).toBe(o.totalCents);
  });
  it('preview não cria efeitos e fica restrito ao pedido autorizado', async () => {
    const c = await condition(f, { preset: 'net30' }),
      o = await draft(f);
    const path = `/api/v1/orders/${o.id}/payment-preview`,
      body = { expectedVersion: o.version, paymentConditionId: c.id, paymentConditionVersion: 1 };
    const result = (await request(f.app).post(path).set(orderHeaders(f)).send(body).expect(200))
      .body.data;
    expect(result.installments).toHaveLength(1);
    expect(result.totalCents).toBe(o.totalCents);
    for (const collection of ['receivables', 'stockReservations', 'payments'])
      expect((await orderDocs(f, collection).get()).size).toBe(0);
    await request(f.app)
      .post(path)
      .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
      .send(body)
      .expect(404);
  });
  it('condição alterada bloqueia confirmação até revisão e edição invalida desconto', async () => {
    const c = await condition(f),
      o = await draft(f, f.ownerA, {
        extra: {
          payment: undefined,
          paymentConditionId: c.id,
          paymentConditionVersion: 1,
          discount: { type: 'fixed', value: 10, reason: 'Aprovação sintética' },
        },
      });
    await request(f.app)
      .patch(`/api/v1/payment-conditions/${c.id}`)
      .set(orderHeaders(f))
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1, schedule: [{ offsetDays: 30, weight: 1 }] })
      .expect(200);
    const failure = await command(f, o, 'confirm').expect(409);
    expect(failure.body.error.code).toBe('PAYMENT_TERMS_CHANGED');
    const edited = (
      await request(f.app)
        .patch(`/api/v1/orders/${o.id}`)
        .set(orderHeaders(f))
        .send({ expectedVersion: 1, paymentConditionId: c.id, paymentConditionVersion: 2 })
        .expect(200)
    ).body.data;
    expect(edited.discount).toBeNull();
    await confirm(f, edited);
  });
  it('condição à vista muda data-base na confirmação posterior sem usar prazo antigo', async () => {
    const c = await condition(f),
      o = await draft(f, f.ownerA, {
        extra: { payment: undefined, paymentConditionId: c.id, paymentConditionVersion: 1 },
      });
    f.offset = 86_400_000;
    const confirmed = await confirm(f, o);
    expect(confirmed.paymentTerms?.baseDate).toBe(
      companyDate(new Date(confirmed.confirmedAt!), 'America/Sao_Paulo'),
    );
  });
  it('nega IDs externos, combinação manual/cadastrada e versões ausentes', async () => {
    const c = await condition(f);
    await request(f.app)
      .get(`/api/v1/payment-conditions/${c.id}`)
      .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
      .expect(404);
    await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f))
      .send({ paymentConditionId: c.id })
      .expect(422);
    await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f))
      .send({
        paymentConditionId: c.id,
        paymentConditionVersion: 1,
        payment: { type: 'cash', dueDates: ['2090-01-01'] },
      })
      .expect(422);
  });
});
