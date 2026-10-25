import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import {
  financialOrder,
  receiptBody,
  financePost,
  titles,
  versions,
  method,
  condition,
} from '../helpers/finance.js';
import { orderDocs, orderHeaders, draft, confirm, command } from '../helpers/orders.js';
import { seller } from '../helpers/commercial.js';
import { orderView, type Order } from '../../src/shared/schemas/orders.js';
import { dueDateChangeResult, reconciliationView } from '../../src/shared/schemas/finance.js';
import { companyDate } from '../../src/modules/orders/calculation.js';
import { addDays } from '../../src/modules/billing/calendar.js';

const f = registerFixture({ rateLimitMax: 10000 });
const today = () => companyDate(new Date(Date.now() + f.offset), f.tenantA.tenant.timezone);
const readOrder = async (id: string) =>
  orderView.parse(
    (await request(f.app).get(`/api/v1/orders/${id}`).set(orderHeaders(f)).expect(200)).body.data,
  );
/** Body for the title at `index`, built from what the screen would show. */
async function body(
  order: Pick<Order, 'id'>,
  dueDate: string,
  index = 0,
  reason = 'Cliente pediu',
) {
  const current = await readOrder(order.id);
  const rows = (await titles(f, current)).sort((a, b) => a.installmentNumber - b.installmentNumber);
  return {
    ...(await versions(f, current)),
    receivableId: rows[index]!.id,
    expectedVersion: rows[index]!.version,
    dueDate,
    reason,
  };
}
const change = (order: Pick<Order, 'id'>, payload: object, key = randomUUID(), user = f.ownerA) =>
  financePost(f, `/orders/${order.id}/due-date-changes`, payload, key, user);
const snapshot = async (...collections: string[]) =>
  JSON.stringify(
    await Promise.all(
      collections.map(async (c) =>
        (await orderDocs(f, c).get()).docs.map((d) => [d.id, d.data()]).sort(),
      ),
    ),
  );

describe('Correção de vencimento de contas a receber', () => {
  it('altera a data em pedido, recebível e filtros sem tocar valores, estoque ou diário', async () => {
    const order = await confirm(f, await draft(f));
    const stockBefore = await snapshot('inventory', 'inventoryMovements', 'stockReservations');
    const [before] = await titles(f, order);
    expect(before).toMatchObject({ dueDate: '2090-01-01', originalCents: 2050, version: 1 });
    const result = dueDateChangeResult.parse(
      (await change(order, await body(order, '2090-01-15', 0, 'Acordo com a cliente')).expect(200))
        .body.data,
    );
    expect(result.change).toMatchObject({
      receivableId: before!.id,
      previousDueDate: '2090-01-01',
      dueDate: '2090-01-15',
      reason: 'Acordo com a cliente',
      actorUid: f.ownerA.uid,
      orderVersion: order.version + 1,
    });
    const [after] = await titles(f, order);
    expect(after).toMatchObject({
      dueDate: '2090-01-15',
      originalCents: 2050,
      outstandingCents: 2050,
      cashCents: 0,
      status: 'open',
      version: 1,
    });
    const updated = await readOrder(order.id);
    expect(updated.version).toBe(order.version + 1);
    expect(updated.installments[0]).toMatchObject({ dueDate: '2090-01-15', amountCents: 2050 });
    expect(updated.payment?.dueDates).toEqual(['2090-01-15']);
    expect(updated.totalCents).toBe(order.totalCents);
    expect((await orderDocs(f, 'receivables').doc(before!.id).get()).get('dueDate')).toBe(
      '2090-01-15',
    );
    // Date filters and the "upcoming" indicator follow the new date.
    const listed = async (query: string) =>
      (await request(f.app).get(`/api/v1/receivables?${query}`).set(orderHeaders(f)).expect(200))
        .body.data.items.length;
    expect(await listed('from=2090-01-10&to=2090-01-20')).toBe(1);
    expect(await listed('from=2089-12-25&to=2090-01-05')).toBe(0);
    const upcoming = (
      await request(f.app)
        .get('/api/v1/reports/upcoming?from=2090-01-10&to=2090-01-20')
        .set(orderHeaders(f))
        .expect(200)
    ).body.data;
    expect(JSON.stringify(upcoming.rows)).toContain('2090-01-15');
    // History: immutable record, audit and order history; journal and stock untouched.
    const changes = (
      await request(f.app)
        .get(`/api/v1/receivables/${before!.id}/due-date-changes`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data.items;
    expect(changes).toEqual([expect.objectContaining({ previousDueDate: '2090-01-01' })]);
    const audit = (
      await orderDocs(f, 'auditLogs').where('action', '==', 'finance.due_date_changed').get()
    ).docs.map((d) => d.data());
    expect(audit).toEqual([
      expect.objectContaining({
        actorUid: f.ownerA.uid,
        resourceId: before!.id,
        occurredAt: result.change.occurredAt,
        changes: expect.objectContaining({
          previousDueDate: '2090-01-01',
          dueDate: '2090-01-15',
          reason: 'Acordo com a cliente',
          orderId: order.id,
        }),
      }),
    ]);
    const history = (
      await request(f.app)
        .get(`/api/v1/orders/${order.id}/history`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data.items;
    expect(history.at(-1)).toMatchObject({
      type: 'due_date_changed',
      status: 'confirmed',
      reason: 'Acordo com a cliente',
    });
    expect((await orderDocs(f, 'financialEvents').get()).size).toBe(0);
    expect(await snapshot('inventory', 'inventoryMovements', 'stockReservations')).toBe(
      stockBefore,
    );
    // Nothing was received: plain cancellation still works and cancels the corrected title.
    await command(f, updated, 'cancel').expect(200);
    expect((await titles(f, order))[0]).toMatchObject({
      status: 'canceled',
      dueDate: '2090-01-15',
    });
  });
  it('parcela parcialmente paga muda de data; pagamentos e reconciliação continuam íntegros', async () => {
    const { order, method: m } = await financialOrder(f);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 500),
    ).expect(200);
    const payments = await snapshot('payments');
    const newDate = addDays(today(), 10);
    await change(order, await body(order, newDate)).expect(200);
    expect((await titles(f, order))[0]).toMatchObject({
      dueDate: newDate,
      status: 'partially_paid',
      cashCents: 500,
      outstandingCents: 1550,
      version: 2,
    });
    expect(await snapshot('payments')).toBe(payments);
    const reconciliation = reconciliationView.parse(
      (
        await request(f.app)
          .get(`/api/v1/orders/${order.id}/financial-reconciliation`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data,
    );
    expect(reconciliation).toMatchObject({ consistent: true, complete: true });
    // Later receipts use the same title version and settle the remaining balance.
    const current = await readOrder(order.id);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, current, m, 1550),
    ).expect(200);
    expect((await titles(f, order))[0]).toMatchObject({ status: 'paid', dueDate: newDate });
  });
  it('bloqueia parcela quitada, pedido cancelado, rascunho e datas inválidas', async () => {
    const { order, method: m } = await financialOrder(f);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, order.totalCents),
    ).expect(200);
    const paid = await change(order, await body(order, addDays(today(), 5))).expect(409);
    expect(paid.body.error.code).toBe('DUE_DATE_LOCKED');
    const canceled = await confirm(f, await draft(f));
    const payload = await body(canceled, '2090-02-01');
    await command(f, canceled, 'cancel').expect(200);
    // Current versions, so the refusal comes from the state and not from a stale screen.
    const after = await versions(f, await readOrder(canceled.id));
    expect((await change(canceled, { ...payload, ...after }).expect(409)).body.error.code).toBe(
      'INVALID_ORDER_STATE',
    );
    const open = await draft(f);
    const draftRefusal = await change(open, {
      expectedOrderVersion: open.version,
      expectedGuardVersion: 1,
      receivableId: open.id,
      expectedVersion: 1,
      dueDate: '2090-02-01',
      reason: 'Rascunho',
    }).expect(409);
    expect(draftRefusal.body.error.code).toBe('INVALID_ORDER_STATE');
    const valid = await confirm(f, await draft(f));
    for (const [dueDate, code] of [
      ['2090-01-01', 'DUE_DATE_UNCHANGED'],
      [addDays(today(), -1), 'INVALID_DUE_DATE'],
    ] as const)
      expect((await change(valid, await body(valid, dueDate)).expect(422)).body.error.code).toBe(
        code,
      );
    await change(valid, { ...(await body(valid, '2090-02-01')), dueDate: '2090-02-30' }).expect(
      422,
    );
    await change(valid, { ...(await body(valid, '2090-02-01')), reason: '' }).expect(422);
    await change(valid, { ...(await body(valid, '2090-02-01')), receivableId: 'outro' }).expect(
      404,
    );
  });
  it('parcelamento: corrige uma parcela dentro da ordem e preserva as demais', async () => {
    const c = await condition(f, {
      preset: undefined,
      schedule: [
        { offsetDays: 30, weight: 1 },
        { offsetDays: 60, weight: 1 },
        { offsetDays: 90, weight: 1 },
      ],
    });
    const m = await method(f);
    const order = await confirm(
      f,
      await draft(f, f.ownerA, {
        quantity: '3',
        extra: {
          payment: undefined,
          paymentConditionId: c.id,
          paymentConditionVersion: c.version,
          intendedPaymentMethodId: m.id,
          intendedPaymentMethodVersion: m.version,
        },
      }),
    );
    const before = (await titles(f, order)).sort(
      (a, b) => a.installmentNumber - b.installmentNumber,
    );
    expect(before.map((t) => t.dueDate)).toEqual([30, 60, 90].map((d) => addDays(today(), d)));
    expect(
      (await change(order, await body(order, addDays(today(), 95), 1)).expect(422)).body.error.code,
    ).toBe('DUE_DATE_ORDER');
    expect(
      (await change(order, await body(order, addDays(today(), 20), 1)).expect(422)).body.error.code,
    ).toBe('DUE_DATE_ORDER');
    await change(order, await body(order, addDays(today(), 75), 1)).expect(200);
    const after = (await titles(f, order)).sort(
      (a, b) => a.installmentNumber - b.installmentNumber,
    );
    expect(after.map((t) => t.dueDate)).toEqual([30, 75, 90].map((d) => addDays(today(), d)));
    expect(after.map((t) => t.originalCents)).toEqual(before.map((t) => t.originalCents));
    expect(after.reduce((a, t) => a + t.originalCents, 0)).toBe(order.totalCents);
    const current = await readOrder(order.id);
    expect(current.installments.map((p) => p.dueDate)).toEqual(after.map((t) => t.dueDate));
    // The terms snapshot of the confirmation is history and stays as agreed.
    expect(current.paymentTerms?.dueDates).toEqual(before.map((t) => t.dueDate));
    // Expedited orders can still be corrected.
    const shipped = orderView.parse((await command(f, current, 'dispatch').expect(200)).body.data);
    await change(shipped, await body(shipped, addDays(today(), 80), 1)).expect(200);
  });
  it('permissões, isolamento, concorrência e repetição da mesma operação', async () => {
    const order = await confirm(f, await draft(f));
    const payload = await body(order, '2090-03-01');
    const user = await seller(f);
    await change(order, payload, randomUUID(), user).expect(403);
    await request(f.app)
      .get(`/api/v1/receivables/${payload.receivableId}/due-date-changes`)
      .set(tenantHeaders(user, f.tenantA.tenant.id))
      .expect(403);
    await change(order, payload, randomUUID(), f.ownerB).expect(403);
    await request(f.app)
      .post(`/api/v1/orders/${order.id}/due-date-changes`)
      .set(tenantHeaders(f.ownerB, f.tenantB.tenant.id))
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(404);
    // Two concurrent corrections from the same screen: exactly one wins.
    const statuses = (
      await Promise.all([
        change(order, payload),
        change(order, { ...payload, dueDate: '2090-04-01' }),
      ])
    )
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([200, 409]);
    // Replaying the same key returns the same result and writes nothing new.
    const fresh = await body(order, '2090-05-01');
    const key = randomUUID();
    const first = (await change(order, fresh, key).expect(200)).body.data;
    expect((await change(order, fresh, key).expect(200)).body.data).toEqual(first);
    await change(order, { ...fresh, dueDate: '2090-06-01' }, key).expect(409);
    expect((await orderDocs(f, 'receivableDueDateChanges').get()).size).toBe(2);
    expect((await titles(f, order))[0]!.dueDate).toBe('2090-05-01');
  });
});
