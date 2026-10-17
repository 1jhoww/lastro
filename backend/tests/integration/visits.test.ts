import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  registerFixture,
  tenantHeaders,
  expectStatus,
  type Fixture,
  type TestUser,
} from '../helpers/fixture.js';
import { seller, extraSeats, validAddress } from '../helpers/commercial.js';
import { command, confirm, draft, orderDocs } from '../helpers/orders.js';
import { stockProduct, enter } from '../helpers/inventory.js';
import { orderView } from '../../src/shared/schemas/orders.js';
import {
  visitView,
  visitsPage,
  customerRepurchaseView,
  customerTimelineView,
  repurchasePage,
  deliveryView,
} from '../../src/shared/schemas/visits.js';
import { localDay } from '../../src/modules/visits/visitService.js';
import { shiftDate } from '../../src/modules/visits/repurchase.js';

const f = registerFixture({ rateLimitMax: 10000 });
const DAY = 86_400_000;
const tenantA = () => f.tenantA.tenant.id;
const headers = (user: TestUser, tenantId = tenantA()) => tenantHeaders(user, tenantId);
const today = () => localDay(new Date(Date.now() + f.offset), 'America/Sao_Paulo');

async function customer(fixture: Fixture, user: TestUser, name = 'Cliente visita') {
  const result = await expectStatus(
    request(fixture.app)
      .post('/api/v1/customers')
      .set(headers(user))
      .send({ name, address: validAddress }),
    201,
  );
  return result.body.data.id as string;
}
const createVisit = (user: TestUser, body: object, key = randomUUID(), tenantId = tenantA()) =>
  request(f.app)
    .post('/api/v1/visits')
    .set(headers(user, tenantId))
    .set('Idempotency-Key', key)
    .send({ visitDate: today(), kind: 'in_person', notes: 'Visita de acompanhamento', ...body });
const listVisits = async (user: TestUser, query: object = {}) =>
  visitsPage.parse(
    (await expectStatus(request(f.app).get('/api/v1/visits').query(query).set(headers(user)), 200))
      .body.data,
  );
const deliver = (user: TestUser, orderId: string, body: object = {}) =>
  request(f.app)
    .post(`/api/v1/orders/${orderId}/delivery`)
    .set(headers(user))
    .send({ deliveredOn: today(), ...body });
const timeline = (user: TestUser, id: string) =>
  request(f.app).get(`/api/v1/customers/${id}/timeline`).set(headers(user));
const repurchaseOf = (user: TestUser, id: string) =>
  request(f.app).get(`/api/v1/customers/${id}/repurchase`).set(headers(user));
const repurchaseList = async (user: TestUser, query: object = {}) =>
  repurchasePage.parse(
    (
      await expectStatus(
        request(f.app).get('/api/v1/repurchase').query(query).set(headers(user)),
        200,
      )
    ).body.data,
  );
const visitCount = async () => (await orderDocs(f, 'visits').get()).size;

/** Confirmed order for a customer, with the clock moved `daysAgo` back at confirmation. */
async function purchase(user: TestUser, customerId: string, productId: string, daysAgo = 0) {
  const order = await draft(f, user, { customerId, productId });
  f.offset = -daysAgo * DAY;
  try {
    return await confirm(f, order, user);
  } finally {
    f.offset = 0;
  }
}
async function dispatched(user: TestUser, customerId: string, productId: string) {
  const confirmed = await purchase(user, customerId, productId);
  return orderView.parse((await command(f, confirmed, 'dispatch', user).expect(200)).body.data);
}
async function product() {
  const id = await stockProduct(f);
  await enter(f, id, '100').expect(201);
  return id;
}

describe('Visitas manuais', () => {
  it('registra visita sem pedido, sem estoque nem financeiro, e lista para o administrador', async () => {
    const customerId = await customer(f, f.ownerA);
    const before = await Promise.all(
      ['orders', 'inventoryMovements', 'receivables', 'payments'].map(
        async (c) => (await orderDocs(f, c).get()).size,
      ),
    );
    const created = visitView.parse(
      (await expectStatus(createVisit(f.ownerA, { customerId }), 201)).body.data,
    );
    expect(created).toMatchObject({
      customerId,
      source: 'manual',
      kind: 'in_person',
      responsibleUid: f.ownerA.uid,
      orderId: null,
      orderAccessible: false,
    });
    const after = await Promise.all(
      ['orders', 'inventoryMovements', 'receivables', 'payments'].map(
        async (c) => (await orderDocs(f, c).get()).size,
      ),
    );
    expect(after).toEqual(before);
    const page = await listVisits(f.ownerA, { customerId });
    expect(page.items.map((v) => v.id)).toEqual([created.id]);
  });

  it('relaciona pedido opcional do mesmo cliente e recusa pedido de outro cliente', async () => {
    const productId = await product();
    const customerId = await customer(f, f.ownerA);
    const other = await customer(f, f.ownerA, 'Outro cliente');
    const order = await draft(f, f.ownerA, { customerId, productId });
    const linked = visitView.parse(
      (await expectStatus(createVisit(f.ownerA, { customerId, orderId: order.id }), 201)).body.data,
    );
    expect(linked).toMatchObject({ orderId: order.id, orderAccessible: true });
    const refused = await expectStatus(
      createVisit(f.ownerA, { customerId: other, orderId: order.id }),
      422,
    );
    expect(refused.body.error.code).toBe('INVALID_RELATED_ORDER');
  });

  it('repete a mesma chave sem duplicar e recusa a chave com outro conteúdo', async () => {
    const customerId = await customer(f, f.ownerA);
    const key = randomUUID();
    const first = await expectStatus(createVisit(f.ownerA, { customerId }, key), 201);
    const again = await expectStatus(createVisit(f.ownerA, { customerId }, key), 201);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await visitCount()).toBe(1);
    const conflict = await expectStatus(
      createVisit(f.ownerA, { customerId, notes: 'Outro conteúdo' }, key),
      409,
    );
    expect(conflict.body.error.code).toBe('CONFLICT');
  });

  it('recusa data futura', async () => {
    const customerId = await customer(f, f.ownerA);
    const future = await expectStatus(
      createVisit(f.ownerA, { customerId, visitDate: shiftDate(today(), 2) }),
      422,
    );
    expect(future.body.error.code).toBe('VISIT_DATE_IN_FUTURE');
  });
});

describe('Registro automático de entrega', () => {
  it('não cria registro ao criar, confirmar, expedir ou cancelar pedidos', async () => {
    const productId = await product();
    const customerId = await customer(f, f.ownerA);
    const order = await draft(f, f.ownerA, { customerId, productId });
    const confirmed = await confirm(f, order);
    const early = await expectStatus(deliver(f.ownerA, confirmed.id), 409);
    expect(early.body.error.code).toBe('INVALID_ORDER_STATE');
    await command(f, confirmed, 'dispatch').expect(200);
    const canceled = await draft(f, f.ownerA, { customerId, productId });
    await command(f, await confirm(f, canceled), 'cancel').expect(200);
    expect(await visitCount()).toBe(0);
    expect((await orderDocs(f, 'deliveries').get()).size).toBe(0);
  });

  it('cria um registro automático por entrega confirmada, sem alterar pedido, estoque ou financeiro', async () => {
    const productId = await product();
    const sellerA = await seller(f, 'seller-delivery');
    const customerId = await customer(f, sellerA);
    const order = await dispatched(sellerA, customerId, productId);
    const before = await Promise.all(
      ['inventoryMovements', 'receivables', 'payments', 'orderEvents'].map(
        async (c) => (await orderDocs(f, c).get()).size,
      ),
    );
    const delivery = deliveryView.parse(
      (await expectStatus(deliver(f.ownerA, order.id, { receivedBy: 'Maria' }), 200)).body.data,
    );
    expect(delivery).toMatchObject({
      orderId: order.id,
      customerId,
      sellerUid: sellerA.uid,
      confirmedBy: f.ownerA.uid,
      deliveredOn: today(),
    });
    const after = await Promise.all(
      ['inventoryMovements', 'receivables', 'payments', 'orderEvents'].map(
        async (c) => (await orderDocs(f, c).get()).size,
      ),
    );
    expect(after).toEqual(before);
    const current = orderView.parse(
      (
        await expectStatus(
          request(f.app).get(`/api/v1/orders/${order.id}`).set(headers(f.ownerA)),
          200,
        )
      ).body.data,
    );
    expect(current).toMatchObject({ status: 'dispatched', version: order.version });
    const [visit] = (await listVisits(f.ownerA, { source: 'automatic' })).items;
    expect(visit).toMatchObject({
      id: delivery.visitId,
      source: 'automatic',
      kind: 'delivery',
      customerId,
      orderId: order.id,
      orderCommercialId: order.commercialId,
      responsibleUid: sellerA.uid,
      visitDate: today(),
      orderAccessible: true,
    });
    expect(visit!.notes).toContain('Recebido por Maria');
    const fetched = await expectStatus(
      request(f.app).get(`/api/v1/orders/${order.id}/delivery`).set(headers(sellerA)),
      200,
    );
    expect(fetched.body.data.delivery.visitId).toBe(delivery.visitId);
  });

  it('é idempotente: repetir a confirmação não duplica; dados diferentes são recusados', async () => {
    const productId = await product();
    const customerId = await customer(f, f.ownerA);
    const order = await dispatched(f.ownerA, customerId, productId);
    const first = await expectStatus(deliver(f.ownerA, order.id, { notes: 'Portaria' }), 200);
    const replay = await Promise.all([
      deliver(f.ownerA, order.id, { notes: 'Portaria' }),
      deliver(f.ownerA, order.id, { notes: 'Portaria' }),
    ]);
    for (const response of replay) {
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(first.body.data);
    }
    // Dispatch is integral: no partial or second delivery for the same order.
    const second = await expectStatus(deliver(f.ownerA, order.id, { notes: 'Segunda parte' }), 409);
    expect(second.body.error.code).toBe('DELIVERY_ALREADY_CONFIRMED');
    expect(await visitCount()).toBe(1);
    expect((await orderDocs(f, 'deliveries').get()).size).toBe(1);
  });

  it('entregas de pedidos distintos geram registros distintos e datas fora da expedição são recusadas', async () => {
    const productId = await product();
    const customerId = await customer(f, f.ownerA);
    const one = await dispatched(f.ownerA, customerId, productId);
    const two = await dispatched(f.ownerA, customerId, productId);
    const before = await expectStatus(
      deliver(f.ownerA, one.id, { deliveredOn: shiftDate(today(), -3) }),
      422,
    );
    expect(before.body.error.code).toBe('INVALID_DELIVERY_DATE');
    await expectStatus(deliver(f.ownerA, one.id, { deliveredOn: shiftDate(today(), 1) }), 422);
    await expectStatus(deliver(f.ownerA, one.id), 200);
    await expectStatus(deliver(f.ownerA, two.id), 200);
    const page = await listVisits(f.ownerA, { customerId, source: 'automatic' });
    expect(page.items.map((v) => v.orderId).sort()).toEqual([one.id, two.id].sort());
  });
});

describe('Carteiras', () => {
  it('vendedor acessa a própria carteira e não acessa clientes de outra', async () => {
    const sellerA = await seller(f, 'seller-portfolio');
    const own = await customer(f, sellerA, 'Cliente do vendedor');
    const foreign = await customer(f, f.ownerA, 'Cliente da empresa');
    await expectStatus(createVisit(f.ownerA, { customerId: foreign }), 201);
    const mine = visitView.parse(
      (await expectStatus(createVisit(sellerA, { customerId: own }), 201)).body.data,
    );
    expect((await listVisits(sellerA)).items.map((v) => v.id)).toEqual([mine.id]);
    await expectStatus(timeline(sellerA, own), 200);
    await expectStatus(repurchaseOf(sellerA, own), 200);
    for (const pending of [
      createVisit(sellerA, { customerId: foreign }),
      timeline(sellerA, foreign),
      repurchaseOf(sellerA, foreign),
      request(f.app).get('/api/v1/visits').query({ customerId: foreign }).set(headers(sellerA)),
    ])
      expect((await expectStatus(pending, 404)).body.error.code).toBe('RESOURCE_NOT_FOUND');
    const rows = await repurchaseList(sellerA);
    expect(rows.items.map((r) => r.customerId)).toEqual([own]);
    await expectStatus(
      createVisit(sellerA, { customerId: own, responsibleUid: f.ownerA.uid }),
      403,
    );
    await expectStatus(
      request(f.app)
        .get('/api/v1/repurchase')
        .query({ sellerUid: f.ownerA.uid })
        .set(headers(sellerA)),
      403,
    );
  });

  it('vendedor não confirma entrega de pedido fora da própria carteira', async () => {
    const productId = await product();
    const sellerA = await seller(f, 'seller-foreign-delivery');
    const customerId = await customer(f, f.ownerA);
    const order = await dispatched(f.ownerA, customerId, productId);
    await expectStatus(deliver(sellerA, order.id), 404);
    await expectStatus(
      request(f.app).get(`/api/v1/orders/${order.id}/delivery`).set(headers(sellerA)),
      404,
    );
    expect(await visitCount()).toBe(0);
  });

  it('troca de vendedor muda quem vê o histórico, não a autoria', async () => {
    await extraSeats(f);
    const productId = await product();
    const first = await seller(f, 'seller-first');
    const second = await seller(f, 'seller-second');
    const customerId = await customer(f, first);
    const visit = visitView.parse(
      (await expectStatus(createVisit(first, { customerId }), 201)).body.data,
    );
    const order = await dispatched(first, customerId, productId);
    await expectStatus(deliver(first, order.id), 200);
    const current = await request(f.app)
      .get(`/api/v1/customers/${customerId}`)
      .set(headers(f.ownerA));
    await expectStatus(
      request(f.app)
        .patch(`/api/v1/customers/${customerId}/assignment`)
        .set(headers(f.ownerA))
        .send({ assignedTo: second.uid, expectedVersion: current.body.data.version }),
      200,
    );
    await expectStatus(timeline(first, customerId), 404);
    expect((await listVisits(first)).items).toHaveLength(0);
    const seen = await listVisits(second);
    expect(seen.items).toHaveLength(2);
    const manual = seen.items.find((v) => v.id === visit.id)!;
    expect(manual).toMatchObject({ responsibleUid: first.uid, createdBy: first.uid });
    const automatic = seen.items.find((v) => v.source === 'automatic')!;
    // The order still belongs to the first seller: visible in history, not openable.
    expect(automatic).toMatchObject({ responsibleUid: first.uid, orderAccessible: false });
    const history = customerTimelineView.parse(
      (await expectStatus(timeline(second, customerId), 200)).body.data,
    );
    expect(history.items.map((e) => e.type).sort()).toEqual(['delivery', 'purchase', 'visit']);
    expect(history.items.find((e) => e.type === 'purchase')?.order?.accessible).toBe(false);
    await expectStatus(createVisit(second, { customerId }), 201);
  });

  it('administrador vê a empresa inteira', async () => {
    const sellerA = await seller(f, 'seller-admin-view');
    const own = await customer(f, sellerA);
    const company = await customer(f, f.ownerA);
    await expectStatus(createVisit(sellerA, { customerId: own }), 201);
    await expectStatus(createVisit(f.ownerA, { customerId: company }), 201);
    const all = await listVisits(f.ownerA);
    expect(all.items.map((v) => v.customerId).sort()).toEqual([own, company].sort());
    expect((await listVisits(f.ownerA, { responsibleUid: sellerA.uid })).items).toHaveLength(1);
    const rows = await repurchaseList(f.ownerA);
    expect(rows.items.map((r) => r.customerId).sort()).toEqual([own, company].sort());
    await expectStatus(
      createVisit(f.ownerA, { customerId: own, responsibleUid: sellerA.uid }),
      201,
    );
  });
});

describe('Recompra', () => {
  it('estima pela mediana com histórico suficiente e separa última compra da última entrega', async () => {
    const productId = await product();
    const customerId = await customer(f, f.ownerA);
    const old = await purchase(f.ownerA, customerId, productId, 60);
    await purchase(f.ownerA, customerId, productId, 30);
    await purchase(f.ownerA, customerId, productId, 0);
    await command(f, old, 'dispatch').expect(200);
    await expectStatus(deliver(f.ownerA, old.id), 200);
    const view = customerRepurchaseView.parse(
      (await expectStatus(repurchaseOf(f.ownerA, customerId), 200)).body.data,
    );
    expect(view).toMatchObject({
      lastPurchaseOn: today(),
      lastDeliveryOn: today(),
      purchaseCount: 3,
      frequencyDays: 30,
      nextEstimatedOn: shiftDate(today(), 30),
      status: 'on_track',
    });
    const [row] = (await repurchaseList(f.ownerA, { status: 'on_track' })).items;
    expect(row).toMatchObject({ customerId, frequencyDays: 30, status: 'on_track' });
  });

  it('última compra e última entrega são datas distintas', async () => {
    const productId = await product();
    const customerId = await customer(f, f.ownerA);
    const earlier = await purchase(f.ownerA, customerId, productId, 10);
    f.offset = -9 * DAY;
    await command(f, earlier, 'dispatch').expect(200);
    await expectStatus(deliver(f.ownerA, earlier.id), 200);
    const deliveredOn = today();
    f.offset = 0;
    await purchase(f.ownerA, customerId, productId, 0);
    const view = customerRepurchaseView.parse(
      (await expectStatus(repurchaseOf(f.ownerA, customerId), 200)).body.data,
    );
    expect(view.lastPurchaseOn).toBe(today());
    expect(view.lastDeliveryOn).toBe(deliveredOn);
    expect(view.lastDeliveryOn).not.toBe(view.lastPurchaseOn);
  });

  it('sem histórico suficiente mostra só a última compra', async () => {
    const productId = await product();
    const customerId = await customer(f, f.ownerA);
    await draft(f, f.ownerA, { customerId, productId });
    await purchase(f.ownerA, customerId, productId, 5);
    const view = customerRepurchaseView.parse(
      (await expectStatus(repurchaseOf(f.ownerA, customerId), 200)).body.data,
    );
    expect(view).toMatchObject({
      lastPurchaseOn: shiftDate(today(), -5),
      lastDeliveryOn: null,
      purchaseCount: 1,
      frequencyDays: null,
      nextEstimatedOn: null,
      status: 'insufficient_history',
    });
    const page = await repurchaseList(f.ownerA);
    expect(page.totals.insufficient_history).toBe(1);
  });

  it('pedidos cancelados não entram no cálculo; visitas e entregas também não', async () => {
    const productId = await product();
    const customerId = await customer(f, f.ownerA);
    await purchase(f.ownerA, customerId, productId, 40);
    await purchase(f.ownerA, customerId, productId, 20);
    const canceled = await purchase(f.ownerA, customerId, productId, 0);
    await command(f, canceled, 'cancel').expect(200);
    await expectStatus(createVisit(f.ownerA, { customerId }), 201);
    const view = customerRepurchaseView.parse(
      (await expectStatus(repurchaseOf(f.ownerA, customerId), 200)).body.data,
    );
    expect(view).toMatchObject({
      lastPurchaseOn: shiftDate(today(), -20),
      purchaseCount: 2,
      status: 'insufficient_history',
    });
    const history = customerTimelineView.parse(
      (await expectStatus(timeline(f.ownerA, customerId), 200)).body.data,
    );
    expect(history.items.filter((e) => e.type === 'purchase')).toHaveLength(2);
    expect(history.items.filter((e) => e.type === 'visit')).toHaveLength(1);
  });

  it('estimativa vencida aparece primeiro na visão de recompra', async () => {
    const productId = await product();
    const late = await customer(f, f.ownerA, 'Cliente atrasado');
    const fine = await customer(f, f.ownerA, 'Cliente em dia');
    for (const daysAgo of [90, 80, 70]) await purchase(f.ownerA, late, productId, daysAgo);
    for (const daysAgo of [20, 10, 0]) await purchase(f.ownerA, fine, productId, daysAgo);
    const page = await repurchaseList(f.ownerA);
    expect(page.items.map((r) => [r.customerId, r.status])).toEqual([
      [late, 'overdue'],
      [fine, 'on_track'],
    ]);
    expect(page.totals).toEqual({ insufficient_history: 0, on_track: 1, overdue: 1 });
    expect(page.items[0]!.daysFromEstimate).toBe(60);
    expect((await repurchaseList(f.ownerA, { q: 'atrasado' })).items).toHaveLength(1);
  });
});

describe('Plano e empresas', () => {
  it('Essencial não acessa visitas nem recompra; a entrega continua disponível em Pedidos', async () => {
    const productId = await product();
    const customerId = await customer(f, f.ownerA);
    const order = await dispatched(f.ownerA, customerId, productId);
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ planCode: 'essencial' });
    for (const pending of [
      request(f.app).get('/api/v1/visits').set(headers(f.ownerA)),
      createVisit(f.ownerA, { customerId }),
      request(f.app).get('/api/v1/repurchase').set(headers(f.ownerA)),
      timeline(f.ownerA, customerId),
      repurchaseOf(f.ownerA, customerId),
    ])
      expect((await expectStatus(pending, 403)).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    await expectStatus(deliver(f.ownerA, order.id), 200);
    const me = await request(f.app)
      .get('/api/v1/me')
      .set({ Authorization: `Bearer ${f.ownerA.token}` });
    const permissions = me.body.data.memberships[0].permissions as string[];
    expect(permissions).not.toContain('visits:own:manage');
    expect(permissions).toContain('orders:own:deliver');
  });

  it('isola empresas', async () => {
    const productId = await product();
    const customerId = await customer(f, f.ownerA);
    const order = await dispatched(f.ownerA, customerId, productId);
    await expectStatus(createVisit(f.ownerA, { customerId }), 201);
    await expectStatus(deliver(f.ownerA, order.id), 200);
    const tenantB = f.tenantB.tenant.id;
    const asB = (path: string) =>
      request(f.app).get(`/api/v1${path}`).set(headers(f.ownerB, tenantB));
    for (const path of [
      `/customers/${customerId}/timeline`,
      `/customers/${customerId}/repurchase`,
      `/orders/${order.id}/delivery`,
    ])
      await expectStatus(asB(path), 404);
    await expectStatus(
      request(f.app)
        .post(`/api/v1/orders/${order.id}/delivery`)
        .set(headers(f.ownerB, tenantB))
        .send({ deliveredOn: today() }),
      404,
    );
    await expectStatus(createVisit(f.ownerB, { customerId }, randomUUID(), tenantB), 404);
    expect((await asB('/visits')).body.data.items).toEqual([]);
    expect((await asB('/repurchase')).body.data.items).toEqual([]);
    await expectStatus(request(f.app).get('/api/v1/visits').set(headers(f.ownerB)), 403);
  });
});
