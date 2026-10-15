import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture } from '../helpers/fixture.js';
import { seller, extraSeats } from '../helpers/commercial.js';
import {
  draft,
  command,
  confirm,
  orderHeaders,
  orderDocs,
  orderCustomer,
} from '../helpers/orders.js';
import { balance, stockProduct, enter } from '../helpers/inventory.js';
import { AccessService } from '../../src/modules/auth/accessService.js';
const f = registerFixture();
describe('Segurança de pedidos', () => {
  it('corrupção persistida em lista/resultado idempotente falha fechada e sanitizada', async () => {
    const o = await draft(f),
      key = randomUUID();
    await confirm(f, o, f.ownerA, key);
    const operation = (await orderDocs(f, 'orderOperations').get()).docs[0]!;
    await operation.ref.update({ result: { secret: 'não expor' } });
    const replay = await command(f, o, 'confirm', f.ownerA, key).expect(500);
    expect(JSON.stringify(replay.body)).not.toContain('não expor');
    await orderDocs(f, 'orders').doc(o.id).update({ totalCents: 1 });
    const list = await request(f.app).get('/api/v1/orders').set(orderHeaders(f)).expect(500);
    expect(list.body.error.code).toBe('INTERNAL_ERROR');
  });
  it('nega BOLA entre tenants, inclusive histórico e transições', async () => {
    const o = await draft(f);
    for (const suffix of ['', '/history'])
      await request(f.app)
        .get(`/api/v1/orders/${o.id}${suffix}`)
        .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
        .expect(404);
    await request(f.app)
      .post(`/api/v1/orders/${o.id}/confirm`)
      .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1 })
      .expect(404);
    await request(f.app).get(`/api/v1/orders/${o.id}`).set(orderHeaders(f, f.platform)).expect(403);
    await request(f.app).get(`/api/v1/orders/${o.id}`).expect(401);
  });
  it('vendedor não opera pedido alheio nem cliente fora da carteira', async () => {
    const user = await seller(f),
      o = await draft(f);
    await request(f.app).get(`/api/v1/orders/${o.id}`).set(orderHeaders(f, user)).expect(404);
    await command(f, o, 'confirm', user).expect(404);
    await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f, user))
      .send({ expectedVersion: 1, notes: 'Teste' })
      .expect(404);
    await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f, user))
      .send({
        customerId: o.customerId,
        lines: [{ productId: o.lines[0]!.productId, quantity: '1' }],
        payment: o.payment,
      })
      .expect(404);
    const own = await draft(f, user);
    await command(f, own, 'cancel', user).expect(403);
    expect(
      (
        await request(f.app).get('/api/v1/orders').set(orderHeaders(f, user)).expect(200)
      ).body.data.items.map((p: { id: string }) => p.id),
    ).toEqual([own.id]);
  });
  it.each(['discount', 'sellerUid'] as const)(
    'nega manipulação de %s por vendedor na criação e edição',
    async (field) => {
      const user = await seller(f),
        o = await draft(f, user);
      const forged =
        field === 'discount'
          ? { discount: { type: 'fixed', value: 1, reason: 'Tentativa' } }
          : { sellerUid: user.uid };
      await request(f.app)
        .post('/api/v1/orders')
        .set(orderHeaders(f, user))
        .send({
          customerId: o.customerId,
          lines: [{ productId: o.lines[0]!.productId, quantity: '1' }],
          payment: o.payment,
          ...forged,
        })
        .expect(403);
      await request(f.app)
        .patch(`/api/v1/orders/${o.id}`)
        .set(orderHeaders(f, user))
        .send({ expectedVersion: 1, ...forged })
        .expect(403);
      await request(f.app)
        .patch(`/api/v1/orders/${o.id}`)
        .set(orderHeaders(f, user))
        .send({ expectedVersion: 1, discount: null })
        .expect(403);
    },
  );
  it('rejeita preço/tenant/total/saldo/status, linhas repetidas, injeção e campos desconhecidos', async () => {
    const o = await draft(f);
    for (const forged of [
      { tenantId: f.tenantB.tenant.id },
      { totalCents: 1 },
      { status: 'confirmed' },
      { physical: 100 },
      { unitPriceCents: 1 },
    ]) {
      await request(f.app)
        .patch(`/api/v1/orders/${o.id}`)
        .set(orderHeaders(f))
        .send({ expectedVersion: 1, ...forged })
        .expect(422);
    }
    await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f))
      .send({
        expectedVersion: 1,
        lines: [{ productId: o.lines[0]!.productId, quantity: '1', unitPriceCents: 1 }],
      })
      .expect(422);
    await request(f.app)
      .get('/api/v1/orders')
      .query({ status: { $ne: 'draft' } })
      .set(orderHeaders(f))
      .expect(422);
    await command(f, o, 'confirm', f.ownerA, randomUUID(), { reservationId: 'forged' }).expect(422);
    await request(f.app)
      .post(`/api/v1/orders/${o.id}/confirm`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1 })
      .expect(422);
    await request(f.app)
      .patch('/api/v1/receivables/forged')
      .set(orderHeaders(f))
      .send({ outstandingCents: 0 })
      .expect(404);
  });
  it('inativação de produto e cliente impede confirmação sem criar efeitos', async () => {
    const o = await draft(f);
    await request(f.app)
      .delete(`/api/v1/products/${o.lines[0]!.productId}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1 })
      .expect(200);
    await command(f, o, 'confirm').expect(409);
    await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f))
      .send({
        customerId: o.customerId,
        lines: [{ productId: o.lines[0]!.productId, quantity: '1' }],
        payment: o.payment,
      })
      .expect(409);
    const other = await draft(f);
    await request(f.app)
      .delete(`/api/v1/customers/${other.customerId}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1 })
      .expect(200);
    await command(f, other, 'confirm').expect(409);
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(0);
  });
  it('transferência de carteira bloqueia antigo e novo vendedor, mantendo acesso administrativo', async () => {
    await extraSeats(f);
    const old = await seller(f, 'old'),
      newOwner = await seller(f, 'new');
    const o = await confirm(f, await draft(f, old), old);
    await request(f.app)
      .patch(`/api/v1/customers/${o.customerId}/assignment`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1, assignedTo: newOwner.uid })
      .expect(200);
    for (const user of [old, newOwner]) {
      for (const suffix of ['', '/history'])
        await request(f.app)
          .get(`/api/v1/orders/${o.id}${suffix}`)
          .set(orderHeaders(f, user))
          .expect(404);
      await command(f, o, 'dispatch', user).expect(404);
      expect(
        (await request(f.app).get('/api/v1/orders').set(orderHeaders(f, user)).expect(200)).body
          .data.items,
      ).toHaveLength(0);
    }
    await command(f, o, 'dispatch').expect(200);
  });
  it('suspensão ocorrida após middleware é relida na transação', async () => {
    const o = await draft(f),
      original = AccessService.prototype.tenant;
    let injected = false;
    const spy = vi.spyOn(AccessService.prototype, 'tenant').mockImplementation(async function (
      this: AccessService,
      ...args
    ) {
      if (args[3] && !injected) {
        injected = true;
        await f.firebase.db
          .doc(`subscriptions/${f.tenantA.subscription.id}`)
          .update({ status: 'suspended' });
      }
      return original.apply(this, args);
    });
    try {
      expect((await command(f, o, 'confirm').expect(403)).body.error.code).toBe(
        'SUBSCRIPTION_SUSPENDED',
      );
    } finally {
      spy.mockRestore();
    }
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(0);
    expect((await orderDocs(f, 'receivables').get()).size).toBe(0);
  });
  it('transferência após middleware é relida antes de confirmar', async () => {
    const user = await seller(f),
      o = await draft(f, user),
      original = AccessService.prototype.tenant;
    let injected = false;
    const spy = vi.spyOn(AccessService.prototype, 'tenant').mockImplementation(async function (
      this: AccessService,
      ...args
    ) {
      if (args[3] && !injected) {
        injected = true;
        await orderDocs(f, 'customers').doc(o.customerId!).update({ assignedTo: null, version: 2 });
      }
      return original.apply(this, args);
    });
    try {
      await command(f, o, 'confirm', user).expect(404);
    } finally {
      spy.mockRestore();
    }
    expect((await balance(f, o.lines[0]!.productId).expect(200)).body.data.reserved).toBe('0');
  });
  it('replay exige autorização atual e chave não pode mudar operação/pedido/ator', async () => {
    const user = await seller(f),
      o = await draft(f, user),
      key = randomUUID(),
      confirmed = await confirm(f, o, user, key);
    await command(f, confirmed, 'dispatch', user, key).expect(409);
    await command(f, o, 'confirm', f.ownerA, key).expect(409);
    const other = await draft(f, user);
    await command(f, other, 'confirm', user, key).expect(409);
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ status: 'suspended' });
    await command(f, o, 'confirm', user, key).expect(403);
  });
  it('reserva adulterada com origem de outro pedido não pode ser expedida/liberada', async () => {
    const one = await confirm(f, await draft(f)),
      two = await confirm(f, await draft(f, f.ownerA, { productId: one.lines[0]!.productId }));
    const reservation = (
      await orderDocs(f, 'stockReservations').where('orderId', '==', one.id).get()
    ).docs[0]!;
    await reservation.ref.update({ orderId: two.id, lineId: two.lines[0]!.id });
    for (const action of ['dispatch', 'cancel'] as const)
      expect((await command(f, one, action).expect(409)).body.error.code).toBe(
        'INVALID_RESERVATION',
      );
    expect((await balance(f, one.lines[0]!.productId).expect(200)).body.data).toMatchObject({
      physical: '10',
      reserved: '2',
    });
    expect(
      (await orderDocs(f, 'receivables').get()).docs.every((d) => d.get('status') === 'open'),
    ).toBe(true);
  });
  it('não confirma desconto de administrador desativado', async () => {
    const user = await seller(f),
      o = await draft(f, user);
    const result = await request(f.app)
      .patch(`/api/v1/orders/${o.id}`)
      .set(orderHeaders(f))
      .send({
        expectedVersion: 1,
        discount: { type: 'fixed', value: 1, reason: 'Teste autorização' },
      })
      .expect(200);
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/memberships/${f.ownerA.uid}`)
      .update({ status: 'disabled' });
    expect(
      (
        await command(f, { id: o.id, version: result.body.data.version }, 'confirm', user).expect(
          409,
        )
      ).body.error.code,
    ).toBe('DISCOUNT_APPROVAL_REQUIRED');
  });
  it('datas inválidas/passadas e responsável externo são rejeitados', async () => {
    const id = await stockProduct(f);
    await enter(f, id).expect(201);
    const customerId = await orderCustomer(f);
    const base = { customerId, lines: [{ productId: id, quantity: '1' }] };
    for (const dueDates of [['2090-02-30'], ['2020-01-01'], ['2091-01-01', '2090-01-01']]) {
      await request(f.app)
        .post('/api/v1/orders')
        .set(orderHeaders(f))
        .send({
          ...base,
          payment: { type: dueDates.length === 1 ? 'cash' : 'installments', dueDates },
        })
        .expect(422);
    }
    await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f))
      .send({
        ...base,
        payment: { type: 'cash', dueDates: ['2090-01-01'] },
        sellerUid: f.ownerB.uid,
      })
      .expect(422);
  });
});
