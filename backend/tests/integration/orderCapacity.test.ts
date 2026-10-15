import { describe, it, expect, vi, beforeAll } from 'vitest';
import { writeFile } from 'node:fs/promises';
import request from 'supertest';
import { registerFixture } from '../helpers/fixture.js';
import { seller } from '../helpers/commercial.js';
import { stockProduct, enter } from '../helpers/inventory.js';
import {
  draft,
  confirm,
  command,
  orderHeaders,
  orderDocs,
  orderCustomer,
} from '../helpers/orders.js';
import { largeProducts, largeDraft, capacityRecord, newKey } from '../helpers/largeOrders.js';
import { orderView } from '../../src/shared/schemas/orders.js';
import * as audit from '../../src/shared/audit/audit.js';
const f = registerFixture({ rateLimitMax: 10000 });
beforeAll(async () => {
  await writeFile('reports/order-capacity.raw.json', '[]');
});
describe('Pedidos maiores e sem mínimo comercial', () => {
  it.each([1, 500])(
    'uma linha e uma unidade com total de %i centavos pode confirmar',
    async (priceCents) => {
      const id = await stockProduct(f, { priceCents });
      await enter(f, id, '1').expect(201);
      const o = await confirm(f, await draft(f, f.ownerA, { productId: id }));
      expect(o.totalCents).toBe(priceCents);
      expect(o.lines).toHaveLength(1);
      expect(o.lines[0]!.quantity).toBe('1');
    },
  );
  it('KG com 0.001 e total positivo não exige mínimo por produto', async () => {
    const id = await stockProduct(f, { unit: 'KG', priceCents: 1000 });
    await enter(f, id, '0.001').expect(201);
    const o = await confirm(f, await draft(f, f.ownerA, { productId: id, quantity: '0.001' }));
    expect(o.totalCents).toBe(1);
  });
  it('rascunho incompleto pode ser criado, consultado, listado, completado e confirmado', async () => {
    const user = await seller(f);
    const result = await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f, user))
      .send({ notes: 'Rascunho' })
      .expect(201);
    const o = orderView.parse(result.body.data);
    expect(o).toMatchObject({
      customerId: null,
      payment: null,
      lines: [],
      installments: [],
      totalCents: 0,
    });
    await request(f.app).get(`/api/v1/orders/${o.id}`).set(orderHeaders(f, user)).expect(200);
    expect(
      (await request(f.app).get('/api/v1/orders').set(orderHeaders(f, user)).expect(200)).body.data
        .items,
    ).toHaveLength(1);
    await command(f, o, 'confirm', user).expect(422);
    const id = await stockProduct(f, { priceCents: 500 });
    await enter(f, id, '1').expect(201);
    const response = await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f, user))
      .send({
        expectedVersion: 1,
        customerId: await orderCustomer(f, user),
        lines: [{ productId: id, quantity: '1' }],
        payment: { type: 'cash', dueDates: ['2090-01-01'] },
      })
      .expect(200);
    expect((await confirm(f, orderView.parse(response.body.data), user)).totalCents).toBe(500);
  });
  it('rascunho com linhas sem pagamento pode ser salvo e esvaziado sem quantidade inválida', async () => {
    const id = await stockProduct(f);
    const customerId = await orderCustomer(f);
    const response = await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f))
      .send({ customerId, lines: [{ productId: id, quantity: '1' }] })
      .expect(201);
    const o = orderView.parse(response.body.data);
    expect(o.totalCents).toBe(2050);
    expect(o.installments).toEqual([]);
    await command(f, o, 'confirm').expect(422);
    for (const quantity of ['0', '-1', '1.001'])
      await request(f.app)
        .patch(`/api/v1/orders/${o.id}`)
        .set(orderHeaders(f))
        .send({ expectedVersion: 1, lines: [{ productId: id, quantity }] })
        .expect(422);
    const edit = await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1, customerId: null, lines: [], payment: null })
      .expect(200);
    await command(f, orderView.parse(edit.body.data), 'cancel').expect(200);
  });
  it.each(['zeroPrice', 'fullDiscount', 'roundedZero'])(
    'total final zero (%s) não confirma nem cria efeitos',
    async (mode) => {
      const id = await stockProduct(f, {
        priceCents: mode === 'zeroPrice' ? 0 : 500,
        unit: mode === 'roundedZero' ? 'KG' : 'UN',
      });
      await enter(f, id, '1').expect(201);
      const o = await draft(f, f.ownerA, {
        productId: id,
        quantity: mode === 'roundedZero' ? '0.001' : '1',
        extra:
          mode === 'fullDiscount'
            ? { discount: { type: 'percentage', value: 10000, reason: 'Desconto integral' } }
            : {},
      });
      // For rounding-to-zero use 1 cent per KG, without any invalid quantity.
      if (mode === 'roundedZero')
        await request(f.app)
          .patch(`/api/v1/products/${id}`)
          .set(orderHeaders(f))
          .send({ expectedVersion: 1, priceCents: 1 })
          .expect(200);
      expect((await command(f, o, 'confirm').expect(422)).body.error.code).toBe(
        'ORDER_TOTAL_REQUIRED',
      );
      for (const c of ['stockReservations', 'receivables', 'orderOperations'])
        expect((await orderDocs(f, c).get()).size).toBe(0);
    },
  );
  it.each([20, 50, 100, 200])(
    '%i linhas: confirmação/replay, parcelas, expedição/cancelamento e reconciliação',
    async (count) => {
      const ids = await largeProducts(f, count);
      const o = await largeDraft(f, ids),
        key = newKey();
      let start = performance.now();
      const confirmed = await confirm(f, o, f.ownerA, key);
      const confirmMs = Math.round(performance.now() - start);
      expect(confirmed.lines).toHaveLength(count);
      expect(confirmed.totalCents).toBe(Math.round(count * 500 * 0.875));
      start = performance.now();
      expect((await command(f, o, 'confirm', f.ownerA, key).expect(200)).body.data).toEqual(
        confirmed,
      );
      const replayMs = Math.round(performance.now() - start);
      expect((await orderDocs(f, 'stockReservations').get()).size).toBe(count);
      const receivables = await orderDocs(f, 'receivables').where('orderId', '==', o.id).get();
      expect(receivables.size).toBe(12);
      expect(receivables.docs.reduce((a, d) => a + d.get('originalCents'), 0)).toBe(
        confirmed.totalCents,
      );
      expect(confirmed.installments.reduce((a, p) => a + p.amountCents, 0)).toBe(
        confirmed.totalCents,
      );
      start = performance.now();
      const dispatched = orderView.parse(
        (await command(f, confirmed, 'dispatch').expect(200)).body.data,
      );
      const dispatchMs = Math.round(performance.now() - start);
      expect(dispatched.lines).toEqual(confirmed.lines);
      const second = await confirm(f, await largeDraft(f, ids));
      start = performance.now();
      await command(f, second, 'cancel').expect(200);
      const cancelMs = Math.round(performance.now() - start);
      const reservations = await orderDocs(f, 'stockReservations').get();
      expect(reservations.size).toBe(count * 2);
      expect(reservations.docs.filter((d) => d.get('status') === 'reserved')).toHaveLength(0);
      const canceled = await orderDocs(f, 'receivables').where('orderId', '==', second.id).get();
      expect(
        canceled.docs.every(
          (d) => d.get('status') === 'canceled' && d.get('outstandingCents') === 0,
        ),
      ).toBe(true);
      // Every product, not just one sample, must reconcile across both orders.
      for (let offset = 0; offset < ids.length; offset += 10)
        await Promise.all(
          ids.slice(offset, offset + 10).map(async (id) => {
            const r = await request(f.app)
              .get(`/api/v1/inventory/${id}/reconciliation`)
              .set(orderHeaders(f))
              .expect(200);
            expect(r.body.data).toMatchObject({
              complete: true,
              consistent: true,
              physical: '1',
              reserved: '0',
              checkedMovements: 5,
            });
          }),
        );
      await capacityRecord(f, o.id, count, { confirmMs, replayMs, dispatchMs, cancelMs });
    },
    90_000,
  );
  it('estoque insuficiente na última de 200 linhas reverte todas as reservas', async () => {
    const ids = await largeProducts(f, 200, '1');
    const o = await largeDraft(f, ids);
    const last = ids[199]!;
    await request(f.app)
      .post('/api/v1/inventory/adjustments')
      .set(orderHeaders(f))
      .set('Idempotency-Key', newKey())
      .send({
        productId: last,
        delta: '-1',
        expectedVersion: 1,
        reason: 'Fixture sem disponibilidade',
      })
      .expect(201);
    await command(f, o, 'confirm').expect(409);
    for (const c of ['stockReservations', 'receivables', 'orderOperations'])
      expect((await orderDocs(f, c).get()).size).toBe(0);
    expect(
      (await orderDocs(f, 'inventory').get()).docs.every((d) => d.get('reservedScaled') === 0),
    ).toBe(true);
    expect((await orderDocs(f, 'orders').doc(o.id).get()).get('status')).toBe('draft');
  }, 90_000);
  it('falha após staging de 200 linhas não deixa efeitos parciais; retry funciona', async () => {
    const ids = await largeProducts(f, 200);
    const o = await largeDraft(f, ids),
      key = newKey(),
      original = audit.recordAudit;
    const spy = vi.spyOn(audit, 'recordAudit').mockImplementation((...args) => {
      original(...args);
      throw new Error('Falha sintética grande');
    });
    try {
      await command(f, o, 'confirm', f.ownerA, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    for (const c of ['stockReservations', 'receivables', 'orderOperations'])
      expect((await orderDocs(f, c).get()).size).toBe(0);
    expect(
      (await orderDocs(f, 'inventory').get()).docs.every((d) => d.get('reservedScaled') === 0),
    ).toBe(true);
    await confirm(f, o, f.ownerA, key);
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(200);
  }, 90_000);
  it('200 descrições UTF-8 extensas excedem documento: recusa integral com erro técnico', async () => {
    const ids = await largeProducts(f, 200, '1', '界'.repeat(2000));
    const response = await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f))
      .send({
        customerId: await orderCustomer(f),
        lines: ids.map((productId) => ({ productId, quantity: '1' })),
        payment: { type: 'cash', dueDates: ['2090-01-01'] },
      })
      .expect(413);
    expect(response.body.error.code).toBe('ORDER_TECHNICAL_LIMIT');
    expect((await orderDocs(f, 'orders').get()).size).toBe(0);
    for (const c of ['stockReservations', 'receivables', 'orderOperations'])
      expect((await orderDocs(f, c).get()).size).toBe(0);
  }, 90_000);
});
