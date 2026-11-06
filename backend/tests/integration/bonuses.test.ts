import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { registerFixture, tenantHeaders, type TestUser } from '../helpers/fixture.js';
import { extraSeats, seller } from '../helpers/commercial.js';
import { balance, enter, stockProduct } from '../helpers/inventory.js';
import {
  command,
  confirm,
  draft,
  orderCustomer,
  orderDocs,
  orderHeaders,
} from '../helpers/orders.js';
import { gestao } from '../helpers/management.js';
import { financePost, financialOrder, versions, condition, method } from '../helpers/finance.js';
import { largeProducts } from '../helpers/largeOrders.js';
import { finishExecution, type Execution } from '../helpers/financialExecution.js';
import { rollbackBlockers } from '../../src/modules/platformAdmin/rollbackCheck.js';

const f = registerFixture({ rateLimitMax: 10_000 });

const stocked = async (quantity = '10', body: object = {}) => {
  const productId = await stockProduct(f, body);
  await enter(f, productId, quantity).expect(201);
  return productId;
};
const stock = async (productId: string) => (await balance(f, productId).expect(200)).body.data;
const standalone = (
  body: object,
  user: TestUser = f.ownerA,
  key: string = randomUUID(),
  tenantId = f.tenantA.tenant.id,
) =>
  request(f.app)
    .post('/api/v1/bonuses')
    .set(tenantHeaders(user, tenantId))
    .set('Idempotency-Key', key)
    .send(body);
const giveBack = (id: string, body: object, user: TestUser = f.ownerA, key = randomUUID()) =>
  request(f.app)
    .post(`/api/v1/bonuses/${id}/returns`)
    .set(orderHeaders(f, user))
    .set('Idempotency-Key', key)
    .send(body);
const bonusOf = async (id: string, user: TestUser = f.ownerA) =>
  (await request(f.app).get(`/api/v1/bonuses/${id}`).set(orderHeaders(f, user)).expect(200)).body
    .data;
const orderOf = async (id: string) =>
  (await request(f.app).get(`/api/v1/orders/${id}`).set(orderHeaders(f)).expect(200)).body.data;
const report = async (id: string, user: TestUser = f.ownerA, query: object = {}) =>
  (
    await request(f.app)
      .get(`/api/v1/reports/${id}`)
      .set(orderHeaders(f, user))
      .query(query)
      .expect(200)
  ).body.data;
const grant = async (user: TestUser, operations: string[]) =>
  request(f.app)
    .patch(`/api/v1/users/${user.uid}/permissions`)
    .set(orderHeaders(f))
    .send({ operations, expectedVersion: 1 })
    .expect(200);
const sellerOperations = [
  'orders.view',
  'orders.edit',
  'orders.confirm',
  'customers.manage',
  'products.view',
  'inventory.view',
];
const ownCustomer = async (user: TestUser) => orderCustomer(f, user);
const referenceCost = async (productId: string, cents: number) => {
  await request(f.app)
    .patch(`/api/v1/products/${productId}/costs`)
    .set(orderHeaders(f))
    .send({ expectedVersion: 0, referenceCostCents: cents })
    .expect(200);
};

describe('Bonificação vinculada ao pedido', () => {
  it('mesmo produto vendido e bonificado: reserva e saída encadeadas, sem baixa dupla', async () => {
    const productId = await stocked('10');
    const order = await draft(f, f.ownerA, {
      productId,
      quantity: '2',
      extra: { bonus: { lines: [{ productId, quantity: '3' }] } },
    });
    expect(order.totalCents).toBe(4100);
    const created = await orderOf(order.id);
    expect(created.bonus).toMatchObject({
      commercialId: `BON-${order.id.toUpperCase()}`,
      status: 'draft',
      lines: [{ productId, quantity: '3' }],
    });
    expect(created.lines).toHaveLength(1);
    expect(created.commercialId.slice(4)).toBe(created.bonus.commercialId.slice(4));
    expect(await stock(productId)).toMatchObject({ physical: '10', reserved: '0' });

    const confirmed = await confirm(f, order);
    expect(confirmed.totalCents).toBe(4100);
    expect(await stock(productId)).toMatchObject({ physical: '10', reserved: '5', available: '5' });
    const receivables = await orderDocs(f, 'receivables').get();
    expect(receivables.docs.reduce((a, d) => a + d.get('originalCents'), 0)).toBe(4100);
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(2);

    await command(f, confirmed, 'dispatch').expect(200);
    expect(await stock(productId)).toMatchObject({ physical: '5', reserved: '0' });
    expect((await orderOf(order.id)).bonus.status).toBe('dispatched');

    const movements = await orderDocs(f, 'inventoryMovements')
      .where('productId', '==', productId)
      .orderBy('sequence')
      .get();
    expect(movements.docs.map((d) => [d.get('type'), d.get('origin')])).toEqual([
      ['STOCK_ENTRY', 'administrative'],
      ['STOCK_RESERVATION', 'order'],
      ['STOCK_RESERVATION', 'bonus'],
      ['STOCK_DISPATCH', 'order'],
      ['STOCK_DISPATCH', 'bonus'],
    ]);
    const check = await request(f.app)
      .get(`/api/v1/inventory/${productId}/reconciliation`)
      .set(orderHeaders(f))
      .query({ limit: '100' });
    expect(check.body.data).toMatchObject({ complete: true, consistent: true, physical: '5' });
  });

  it('estoque insuficiente para venda mais bonificação não confirma nada', async () => {
    const productId = await stocked('4');
    const order = await draft(f, f.ownerA, {
      productId,
      quantity: '3',
      extra: { bonus: { lines: [{ productId, quantity: '2' }] } },
    });
    await command(f, order, 'confirm').expect(409);
    expect(await stock(productId)).toMatchObject({ physical: '4', reserved: '0' });
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(0);
    expect((await orderOf(order.id)).status).toBe('draft');
  });

  it('confirmação simultânea com a mesma chave ou chaves diferentes reserva uma vez', async () => {
    const productId = await stocked('10');
    const order = await draft(f, f.ownerA, {
      productId,
      extra: { bonus: { lines: [{ productId, quantity: '1' }] } },
    });
    const key = randomUUID();
    const results = await Promise.all([
      command(f, order, 'confirm', f.ownerA, key),
      command(f, order, 'confirm', f.ownerA, key),
      command(f, order, 'confirm', f.ownerA, randomUUID()),
    ]);
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(await stock(productId)).toMatchObject({ physical: '10', reserved: '2' });
  });

  it('cancelamento libera venda e bonificação; rascunho cancelado não toca o estoque', async () => {
    const productId = await stocked('10'),
      other = await stocked('10');
    const confirmed = await confirm(
      f,
      await draft(f, f.ownerA, {
        productId,
        extra: { bonus: { lines: [{ productId: other, quantity: '2' }] } },
      }),
    );
    expect(await stock(other)).toMatchObject({ reserved: '2' });
    await command(f, confirmed, 'cancel').expect(200);
    expect(await stock(other)).toMatchObject({ physical: '10', reserved: '0' });
    expect((await orderOf(confirmed.id)).bonus.status).toBe('canceled');

    const pending = await draft(f, f.ownerA, {
      productId,
      extra: { bonus: { lines: [{ productId: other, quantity: '1' }] } },
    });
    await command(f, pending, 'cancel').expect(200);
    expect((await orderOf(pending.id)).bonus.status).toBe('canceled');
    expect(await stock(other)).toMatchObject({ physical: '10', reserved: '0' });
  });

  it('cancelamento financeiro atômico e retomável liberam a bonificação junto', async () => {
    const productId = await stocked('10'),
      gift = await stocked('10');
    const atomic = await financialOrder(f, {
      bonus: { lines: [{ productId: gift, quantity: '2' }] },
    });
    await financePost(f, `/orders/${atomic.order.id}/financial-cancellation`, {
      ...(await versions(f, atomic.order)),
      disposition: 'customer_credit',
      reason: 'Cancelamento com bonificação',
    }).expect(200);
    expect(await stock(gift)).toMatchObject({ reserved: '0' });
    expect((await orderOf(atomic.order.id)).bonus.status).toBe('canceled');

    const c = await condition(f),
      m = await method(f);
    const resumable = await confirm(
      f,
      await draft(f, f.ownerA, {
        productId,
        extra: {
          payment: undefined,
          paymentConditionId: c.id,
          paymentConditionVersion: c.version,
          intendedPaymentMethodId: m.id,
          intendedPaymentMethodVersion: m.version,
          bonus: { lines: [{ productId, quantity: '2' }] },
        },
      }),
    );
    expect(await stock(productId)).toMatchObject({ reserved: '3' });
    const started = (
      await financePost(f, `/orders/${resumable.id}/financial-cancellation-executions`, {
        ...(await versions(f, resumable)),
        disposition: 'customer_credit',
        reason: 'Cancelamento retomável com bonificação',
      }).expect(202)
    ).body.data as Execution;
    const done = await finishExecution(f, started);
    expect(done.financialCompleted).toBe(true);
    expect(await stock(productId)).toMatchObject({ physical: '10', reserved: '0' });
    expect((await orderOf(resumable.id)).status).toBe('canceled');
    expect((await orderOf(resumable.id)).bonus.status).toBe('canceled');
    const check = await request(f.app)
      .get(`/api/v1/inventory/${productId}/reconciliation`)
      .set(orderHeaders(f))
      .query({ limit: '100' });
    expect(check.body.data).toMatchObject({ complete: true, consistent: true });
  });

  it('cancelamento retomável em lotes libera 120 produtos vendidos e bonificados', async () => {
    const ids = await largeProducts(f, 120, '10', 'Produto vendido e bonificado');
    const setup = await financialOrder(f, {
      lines: ids.map((productId) => ({ productId, quantity: '1' })),
      bonus: { lines: ids.map((productId) => ({ productId, quantity: '2' })) },
    });
    expect(await stock(ids[0]!)).toMatchObject({ reserved: '3' });
    const started = (
      await financePost(f, `/orders/${setup.order.id}/financial-cancellation-executions`, {
        ...(await versions(f, setup.order)),
        disposition: 'customer_credit',
        reason: 'Pedido grande com bonificação',
      }).expect(202)
    ).body.data as Execution;
    await finishExecution(f, started);
    for (const productId of [ids[0]!, ids[119]!])
      expect(await stock(productId)).toMatchObject({ physical: '10', reserved: '0' });
    expect((await orderOf(setup.order.id)).bonus.status).toBe('canceled');
    const released = await orderDocs(f, 'stockReservations')
      .where('status', '==', 'released')
      .get();
    expect(released.size).toBe(240);
  }, 180_000);

  it('edição do rascunho troca ou remove a bonificação e invalida desconto aprovado', async () => {
    const productId = await stocked('10'),
      gift = await stocked('10');
    const order = await draft(f, f.ownerA, {
      productId,
      extra: {
        discount: { type: 'fixed', value: 100, reason: 'Desconto aprovado' },
        bonus: { lines: [{ productId: gift, quantity: '1' }] },
      },
    });
    const edited = await request(f.app)
      .patch(`/api/v1/orders/${order.id}`)
      .set(orderHeaders(f))
      .send({
        expectedVersion: order.version,
        bonus: { lines: [{ productId: gift, quantity: '4' }], reason: 'campaign' },
      })
      .expect(200);
    expect(edited.body.data).toMatchObject({
      discount: null,
      bonus: { reason: 'campaign', lines: [{ quantity: '4' }] },
    });
    const removed = await request(f.app)
      .patch(`/api/v1/orders/${order.id}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: edited.body.data.version, bonus: null })
      .expect(200);
    expect(removed.body.data.bonus).toBeNull();
    expect((await orderDocs(f, 'bonuses').doc(order.id).get()).exists).toBe(false);
  });

  it('pedido só com bonificação não confirma: exige item vendido', async () => {
    const gift = await stocked('10');
    const customerId = await orderCustomer(f);
    const created = await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f))
      .send({
        customerId,
        lines: [],
        payment: { type: 'cash', dueDates: ['2090-01-01'] },
        bonus: { lines: [{ productId: gift, quantity: '1' }] },
      })
      .expect(201);
    await command(f, created.body.data, 'confirm').expect(422);
    expect(await stock(gift)).toMatchObject({ reserved: '0' });
  });

  it('pedido antigo, sem documento de bonificação, segue o fluxo normal', async () => {
    const order = await confirm(f, await draft(f));
    expect((await orderOf(order.id)).bonus).toBeNull();
    await command(f, order, 'dispatch').expect(200);
    expect((await orderDocs(f, 'bonuses').get()).size).toBe(0);
    const stored = (await orderDocs(f, 'orders').doc(order.id).get()).data()!;
    expect(stored).not.toHaveProperty('bonus');
  });

  it('documentos identificam a bonificação sem somar ao total', async () => {
    const productId = await stocked('10');
    const confirmed = await confirm(
      f,
      await draft(f, f.ownerA, {
        productId,
        extra: { bonus: { lines: [{ productId, quantity: '2' }] } },
      }),
    );
    for (const name of ['commercial', 'packing'])
      await request(f.app)
        .get(`/api/v1/orders/${confirmed.id}/documents/${name}.pdf`)
        .set(orderHeaders(f))
        .expect(200)
        .expect('content-type', /pdf/);
  });
});

describe('Bonificação avulsa', () => {
  const valid = async (extra: object = {}) => ({
    customerId: await orderCustomer(f),
    lines: [{ productId: await stocked('10'), quantity: '3' }],
    reason: 'sample',
    ...extra,
  });

  it('dá saída imediata, sem pedido, recebível ou faturamento, com número e comprovante', async () => {
    const body = await valid();
    const created = await standalone(body).expect(201);
    const bonus = created.body.data;
    expect(bonus).toMatchObject({
      kind: 'standalone',
      status: 'dispatched',
      orderId: null,
      responsibleUid: f.ownerA.uid,
      commercialId: `BON-${bonus.id.toUpperCase()}`,
    });
    const productId = body.lines[0]!.productId;
    expect(await stock(productId)).toMatchObject({ physical: '7', reserved: '0' });
    expect((await orderDocs(f, 'orders').get()).size).toBe(0);
    expect((await orderDocs(f, 'receivables').get()).size).toBe(0);
    expect(created.body.data).not.toHaveProperty('linePrices');
    await request(f.app)
      .get(`/api/v1/bonuses/${bonus.id}/receipt.pdf`)
      .set(orderHeaders(f))
      .expect(200)
      .expect('content-type', /pdf/);
    const list = await request(f.app).get('/api/v1/bonuses').set(orderHeaders(f)).expect(200);
    expect(list.body.data.items.map((b: { id: string }) => b.id)).toEqual([bonus.id]);
  });

  it('repetição simultânea com a mesma chave baixa uma vez; chaves diferentes não vendem o que não há', async () => {
    const body = await valid(),
      key = randomUUID();
    const productId = body.lines[0]!.productId;
    const replays = await Promise.all([
      standalone(body, f.ownerA, key),
      standalone(body, f.ownerA, key),
    ]);
    expect(replays.map((r) => r.status).sort()).toEqual([201, 201]);
    expect(replays[0]!.body.data.id).toBe(replays[1]!.body.data.id);
    expect(await stock(productId)).toMatchObject({ physical: '7' });
    const race = await Promise.all(
      [1, 2, 3].map(() =>
        standalone({ ...body, lines: [{ productId, quantity: '3' }] }, f.ownerA, randomUUID()),
      ),
    );
    expect(race.filter((r) => r.status === 201)).toHaveLength(2);
    expect(race.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await stock(productId)).toMatchObject({ physical: '1' });
    await standalone({ ...body, reason: 'campaign' }, f.ownerA, key).expect(409);
  });

  it('respeita o reservado: só bonifica o disponível', async () => {
    const productId = await stocked('5');
    await confirm(f, await draft(f, f.ownerA, { productId, quantity: '4' }));
    const body = { ...(await valid()), lines: [{ productId, quantity: '2' }] };
    await standalone(body).expect(409);
    expect(await stock(productId)).toMatchObject({ physical: '5', reserved: '4' });
  });

  it('valida motivo: Outro exige descrição e os demais recusam', async () => {
    const body = await valid();
    await standalone({ ...body, reason: 'other' }).expect(422);
    await standalone({ ...body, reasonDetail: 'Sobra de texto' }).expect(422);
    await standalone({ ...body, reason: 'other', reasonDetail: 'Evento regional' }).expect(201);
    const { reason: _reason, ...withoutReason } = body;
    await standalone(withoutReason).expect(422);
  });
});

describe('Retornos', () => {
  it('parcial e total: vendável volta, danificado não, custo médio intacto, sem exceder', async () => {
    await gestao(f);
    const productId = await stocked('10');
    await referenceCost(productId, 500);
    const customerId = await orderCustomer(f);
    const bonus = (
      await standalone({
        customerId,
        lines: [{ productId, quantity: '4' }],
        reason: 'campaign',
      }).expect(201)
    ).body.data;
    const before = (await orderDocs(f, 'productCosts').doc(productId).get()).data();
    const lineId = bonus.lines[0].id;
    const first = await giveBack(bonus.id, {
      expectedVersion: 1,
      reason: 'Cliente devolveu parte',
      lines: [{ lineId, sellable: '1', damaged: '1' }],
    }).expect(200);
    expect(first.body.data.lines[0]).toMatchObject({
      returnedSellable: '1',
      returnedDamaged: '1',
    });
    expect(await stock(productId)).toMatchObject({ physical: '7', reserved: '0' });
    expect((await bonusOf(bonus.id)).cost).toMatchObject({ grossCents: 2000, netCents: 1500 });
    await giveBack(bonus.id, {
      expectedVersion: 2,
      reason: 'Excede',
      lines: [{ lineId, sellable: '3' }],
    }).expect(409);
    await giveBack(bonus.id, {
      expectedVersion: 1,
      reason: 'Versão velha',
      lines: [{ lineId, sellable: '1' }],
    }).expect(409);
    await giveBack(bonus.id, {
      expectedVersion: 2,
      reason: 'Restante',
      lines: [{ lineId, sellable: '2' }],
    }).expect(200);
    expect(await stock(productId)).toMatchObject({ physical: '9' });
    expect((await orderDocs(f, 'productCosts').doc(productId).get()).data()).toEqual(before);
    const detail = await bonusOf(bonus.id);
    expect(detail.history.map((e: { type: string }) => e.type)).toEqual([
      'created',
      'returned',
      'returned',
    ]);
    expect(
      (await orderDocs(f, 'inventoryMovements').where('type', '==', 'STOCK_BONUS_OUT').get()).size,
    ).toBe(1);
  });

  it('retorno repetido com a mesma chave vale uma vez; concorrente perde pela versão', async () => {
    const productId = await stocked('10');
    const bonus = (
      await standalone({
        customerId: await orderCustomer(f),
        lines: [{ productId, quantity: '4' }],
        reason: 'sample',
      }).expect(201)
    ).body.data;
    const body = {
      expectedVersion: 1,
      reason: 'Retorno concorrente',
      lines: [{ lineId: bonus.lines[0].id, sellable: '3' }],
    };
    const key = randomUUID();
    await Promise.all([
      giveBack(bonus.id, body, f.ownerA, key),
      giveBack(bonus.id, body, f.ownerA, key),
    ]);
    expect(await stock(productId)).toMatchObject({ physical: '9' });
    await giveBack(bonus.id, body).expect(409);
    expect(await stock(productId)).toMatchObject({ physical: '9' });
  });

  it('vinculada só retorna depois da expedição', async () => {
    const productId = await stocked('10');
    const confirmed = await confirm(
      f,
      await draft(f, f.ownerA, {
        productId,
        extra: { bonus: { lines: [{ productId, quantity: '2' }] } },
      }),
    );
    const bonus = await bonusOf(confirmed.id);
    const body = {
      expectedVersion: bonus.version,
      reason: 'Antes da saída',
      lines: [{ lineId: bonus.lines[0].id, sellable: '1' }],
    };
    await giveBack(confirmed.id, body).expect(409);
    await command(f, confirmed, 'dispatch').expect(200);
    await giveBack(confirmed.id, { ...body, expectedVersion: bonus.version + 1 }).expect(200);
    expect(await stock(productId)).toMatchObject({ physical: '8', reserved: '0' });
  });
});

describe('Permissões, planos e isolamento', () => {
  it('vendedor sem a permissão não concede; com ela, só na própria carteira e sem custos', async () => {
    await extraSeats(f);
    const user = await seller(f, 'vendedor-bonus');
    const productId = await stocked('10');
    const customerId = await ownCustomer(user);
    const body = { customerId, lines: [{ productId, quantity: '1' }], reason: 'sample' };

    await standalone(body, user).expect(403);
    await request(f.app).get('/api/v1/bonuses').set(orderHeaders(f, user)).expect(403);
    await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f, user))
      .send({ customerId, bonus: { lines: [{ productId, quantity: '1' }] } })
      .expect(403);

    await grant(user, [...sellerOperations, 'orders.bonuses']);
    const created = await standalone(body, user).expect(201);
    expect(created.body.data.responsibleUid).toBe(user.uid);
    const detail = await bonusOf(created.body.data.id, user);
    expect(detail.cost).toBeNull();
    await standalone({ ...body, responsibleUid: f.ownerA.uid }, user).expect(403);
    await standalone({ ...body, customerId: await orderCustomer(f) }, user).expect(404);
    await giveBack(
      created.body.data.id,
      {
        expectedVersion: 1,
        reason: 'Vendedor não retorna',
        lines: [{ lineId: created.body.data.lines[0].id, sellable: '1' }],
      },
      user,
    ).expect(403);
  });

  it('outra empresa não enxerga nem usa bonificação, produto ou cliente', async () => {
    const productId = await stocked('10');
    const customerId = await orderCustomer(f);
    const bonus = (
      await standalone({
        customerId,
        lines: [{ productId, quantity: '1' }],
        reason: 'sample',
      }).expect(201)
    ).body.data;
    const headers = tenantHeaders(f.ownerB, f.tenantB.tenant.id);
    await request(f.app).get(`/api/v1/bonuses/${bonus.id}`).set(headers).expect(404);
    await request(f.app).get(`/api/v1/bonuses/${bonus.id}/receipt.pdf`).set(headers).expect(404);
    const list = await request(f.app).get('/api/v1/bonuses').set(headers).expect(200);
    expect(list.body.data.items).toEqual([]);
    await standalone(
      { customerId, lines: [{ productId, quantity: '1' }], reason: 'sample' },
      f.ownerB,
      randomUUID(),
      f.tenantB.tenant.id,
    ).expect(404);
  });

  it('plano sem custos: bonifica em todo plano, sem capturar nem expor custo', async () => {
    const productId = await stocked('10');
    const bonus = (
      await standalone({
        customerId: await orderCustomer(f),
        lines: [{ productId, quantity: '1' }],
        reason: 'sample',
      }).expect(201)
    ).body.data;
    expect((await bonusOf(bonus.id)).cost).toBeNull();
    expect((await orderDocs(f, 'bonusCostSnapshots').get()).size).toBe(0);
    const view = await report('bonuses-period');
    expect(view.columns.map((c: { key: string }) => c.key)).not.toContain('cost');
    expect(view.summary.map((m: { key: string }) => m.key)).not.toContain('cost');
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ planCode: 'essencial' });
    await request(f.app).get('/api/v1/reports/bonuses-sellers').set(orderHeaders(f)).expect(403);
    await report('bonuses-period');
    await standalone({
      customerId: await orderCustomer(f),
      lines: [{ productId, quantity: '1' }],
      reason: 'sample',
    }).expect(201);
  });

  it('checagem de reversão aponta empresa com bonificação', async () => {
    await standalone({
      customerId: await orderCustomer(f),
      lines: [{ productId: await stocked('10'), quantity: '1' }],
      reason: 'sample',
    }).expect(201);
    const result = await rollbackBlockers(f.firebase.db);
    expect(result.blockers).toContainEqual({
      tenantId: f.tenantA.tenant.id,
      reason: 'bonus_record',
    });
  });
});

describe('Custos, relatórios e Resultado estimado', () => {
  it('custo congelado, fora de CMV e faturamento, em linha própria do Resultado', async () => {
    await gestao(f);
    const sold = await stocked('10', { priceCents: 3000 });
    const gift = await stocked('10', { priceCents: 3000 });
    await referenceCost(sold, 1000);
    await referenceCost(gift, 700);
    const customerId = await orderCustomer(f);
    const confirmed = await confirm(
      f,
      await draft(f, f.ownerA, {
        productId: sold,
        customerId,
        extra: { bonus: { lines: [{ productId: gift, quantity: '2' }] } },
      }),
    );
    await standalone({
      customerId,
      lines: [{ productId: gift, quantity: '1' }],
      reason: 'other',
      reasonDetail: 'Feira regional',
    }).expect(201);
    expect(
      (await orderDocs(f, 'bonusCostSnapshots').doc(confirmed.id).get()).get('costCents'),
    ).toBe(1400);
    const cogs = (await orderDocs(f, 'orderCostSnapshots').doc(confirmed.id).get()).data()!;
    expect(cogs.lines).toHaveLength(1);
    expect(cogs.costCents).toBe(1000);

    const overview = await request(f.app)
      .get('/api/v1/finance/management')
      .set(orderHeaders(f))
      .expect(200);
    expect(overview.body.data.profitability).toMatchObject({
      revenueCents: 3000,
      cogsCents: 1000,
      grossProfitCents: 2000,
      bonusesGrantedCents: 2100,
      estimatedResultCents: -100,
      bonusesWithoutCost: 0,
    });

    const period = await report('bonuses-period');
    expect(period.rows).toHaveLength(2);
    const value = (key: string) => period.summary.find((m: { key: string }) => m.key === key).value;
    expect([value('bonuses'), value('standalone'), value('linked'), value('units')]).toEqual([
      2, 1, 1, 3,
    ]);
    expect(value('cost')).toBe(2100);
    const sales = await report('sales-products');
    expect(sales.rows).toHaveLength(1);

    const customers = await report('bonuses-customers');
    expect(customers.rows[0].cells).toMatchObject({ bonuses: 2, units: '3', cost: 2100 });
    const products = await report('bonuses-products', f.ownerA, { productId: gift });
    expect(products.rows[0].cells).toMatchObject({ units: '3', cost: 2100 });
    const orders = await report('bonuses-orders');
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0].link).toEqual({ kind: 'order', id: confirmed.id });
    const reasons = await report('bonuses-reasons');
    expect(reasons.rows).toHaveLength(1);
    expect(reasons.rows[0].cells).toMatchObject({ reason: 'Outro', bonuses: 1 });
    const kind = await report('bonuses-period', f.ownerA, { bonusKind: 'standalone' });
    expect(kind.rows).toHaveLength(1);
    const sellers = await report('bonuses-sellers');
    expect(sellers.rows).toHaveLength(1);

    for (const format of ['csv', 'pdf'])
      await request(f.app)
        .get(`/api/v1/reports/bonuses-period/export.${format}`)
        .set(orderHeaders(f))
        .expect(200);
    const canceled = await request(f.app)
      .post(`/api/v1/orders/${confirmed.id}/cancel`)
      .set(orderHeaders(f))
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: confirmed.version, reason: 'Sai dos relatórios' })
      .expect(200);
    expect(canceled.body.data.status).toBe('canceled');
    expect((await report('bonuses-orders')).rows).toHaveLength(0);
  });

  it('relatório do vendedor fica na própria carteira e sem custo', async () => {
    await gestao(f);
    await extraSeats(f);
    const user = await seller(f, 'vendedor-relatorio');
    await grant(user, [...sellerOperations, 'orders.bonuses', 'reports.view']);
    const productId = await stocked('10');
    await referenceCost(productId, 300);
    await standalone(
      {
        customerId: await ownCustomer(user),
        lines: [{ productId, quantity: '1' }],
        reason: 'sample',
      },
      user,
    ).expect(201);
    await standalone({
      customerId: await orderCustomer(f),
      lines: [{ productId, quantity: '1' }],
      reason: 'sample',
    }).expect(201);
    const view = await report('bonuses-period', user);
    expect(view.rows).toHaveLength(1);
    expect(view.columns.map((c: { key: string }) => c.key)).not.toContain('cost');
    const admin = await report('bonuses-period');
    expect(admin.rows).toHaveLength(2);
  });

  it('movimentação de estoque identifica a origem bonificação', async () => {
    const productId = await stocked('10');
    await standalone({
      customerId: await orderCustomer(f),
      lines: [{ productId, quantity: '1' }],
      reason: 'sample',
    }).expect(201);
    const view = await report('stock-movements', f.ownerA, { movement: 'exits' });
    expect(view.rows[0].cells).toMatchObject({
      type: 'Saída por bonificação',
      origin: 'Bonificação',
    });
  });
});
