import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture } from '../helpers/fixture.js';
import {
  financialOrder,
  receiptBody,
  financePost,
  titles,
  condition,
  method,
} from '../helpers/finance.js';
import { orderDocs, orderHeaders, draft, confirm } from '../helpers/orders.js';
import { stockProduct, enter } from '../helpers/inventory.js';
import { seller } from '../helpers/commercial.js';
import * as audit from '../../src/shared/audit/audit.js';
import { reconciliationView } from '../../src/shared/schemas/finance.js';
const f = registerFixture();
describe('Incremento E2: recebimentos e diário', () => {
  it('títulos D são lidos sem migração destrutiva; receber materializa projeção sem reescrever original', async () => {
    const order = await confirm(f, await draft(f)),
      m = await method(f),
      before = await orderDocs(f, 'receivables').doc(order.installments[0]!.id).get();
    expect((await titles(f, order))[0]).toMatchObject({
      originalCents: 2050,
      outstandingCents: 2050,
      status: 'open',
      version: 1,
    });
    expect((await orderDocs(f, 'financialTitles').get()).size).toBe(0);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 500),
    ).expect(200);
    expect((await orderDocs(f, 'receivables').doc(before.id).get()).data()).toEqual(before.data());
    expect((await titles(f, order))[0]).toMatchObject({
      outstandingCents: 1550,
      cashCents: 500,
      status: 'partially_paid',
      version: 2,
    });
  });
  it('recebimentos parcial e integral usam forma efetiva independente da prevista', async () => {
    const { order, method: planned } = await financialOrder(f),
      actual = await method(f, 'cash');
    const a = (
      await financePost(
        f,
        `/orders/${order.id}/receipts`,
        await receiptBody(f, order, actual, 500),
      ).expect(200)
    ).body.data;
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, actual, 1550),
    ).expect(200);
    expect((await titles(f, order))[0]).toMatchObject({
      outstandingCents: 0,
      cashCents: 2050,
      status: 'paid',
    });
    const payment = (
      await request(f.app).get(`/api/v1/payments/${a.resourceId}`).set(orderHeaders(f)).expect(200)
    ).body.data;
    expect(payment.method.id).toBe(actual.id);
    expect(order.intendedPaymentMethod?.id).toBe(planned.id);
  });
  it('não recebe excedente nem permite a opção de crédito', async () => {
    const { order, method: m } = await financialOrder(f),
      rows = await titles(f, order);
    const base = {
      ...(await receiptBody(f, order, m, 2050)),
      amountCents: 2051,
      allocations: [{ receivableId: rows[0]!.id, amountCents: 2051, expectedVersion: 1 }],
    };
    expect(
      (await financePost(f, `/orders/${order.id}/receipts`, base).expect(409)).body.error.code,
    ).toBe('EXCESS_PAYMENT');
    await financePost(f, `/orders/${order.id}/receipts`, {
      ...base,
      excessDestination: 'credit',
    }).expect(422);
    expect((await orderDocs(f, 'payments').get()).size).toBe(0);
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(0);
  });
  it('um recebimento aloca a três títulos do mesmo pedido com soma exata', async () => {
    const { order, method: m } = await financialOrder(f, {
      paymentConditionId: null,
      paymentConditionVersion: undefined,
      payment: { type: 'installments', dueDates: ['2090-01-01', '2090-02-01', '2090-03-01'] },
    });
    const body = await receiptBody(f, order, m, 2050);
    expect(body.allocations).toHaveLength(3);
    await financePost(f, `/orders/${order.id}/receipts`, body).expect(200);
    expect((await titles(f, order)).every((t) => t.outstandingCents === 0)).toBe(true);
  });
  it('doze parcelas de um centavo não criam recebimento fictício nas onze parcelas zero', async () => {
    const c = await condition(f, {
        preset: undefined,
        schedule: Array.from({ length: 12 }, () => ({ offsetDays: 0, weight: 1 })),
      }),
      m = await method(f),
      id = await stockProduct(f, { priceCents: 1 });
    await enter(f, id, '1').expect(201);
    const order = await confirm(
      f,
      await draft(f, f.ownerA, {
        productId: id,
        extra: { payment: undefined, paymentConditionId: c.id, paymentConditionVersion: 1 },
      }),
    );
    expect((await titles(f, order)).filter((t) => t.status === 'zero')).toHaveLength(11);
    await financePost(f, `/orders/${order.id}/receipts`, await receiptBody(f, order, m, 1)).expect(
      200,
    );
    expect((await orderDocs(f, 'payments').get()).size).toBe(1);
    const zero = (await titles(f, order)).find((t) => t.originalCents === 0)!;
    await financePost(f, `/orders/${order.id}/receipts`, {
      ...(await receiptBody(f, order, m, 1)),
      allocations: [{ receivableId: zero.id, amountCents: 1, expectedVersion: zero.version }],
    }).expect(409);
  });
  it('mesma chave concorrente retorna resultado original e apenas um lançamento', async () => {
    const { order, method: m } = await financialOrder(f),
      body = await receiptBody(f, order, m, 500),
      key = randomUUID();
    const results = await Promise.all([
      financePost(f, `/orders/${order.id}/receipts`, body, key),
      financePost(f, `/orders/${order.id}/receipts`, body, key),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body.data).toEqual(results[1]!.body.data);
    expect((await orderDocs(f, 'payments').get()).size).toBe(1);
    expect((await orderDocs(f, 'financialEvents').get()).size).toBe(1);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      { ...body, reason: 'Outro motivo' },
      key,
    ).expect(409);
  });
  it('duas baixas da mesma versão têm só um vencedor', async () => {
    const { order, method: m } = await financialOrder(f),
      body = await receiptBody(f, order, m, 1500);
    const results = await Promise.all([
      financePost(f, `/orders/${order.id}/receipts`, body),
      financePost(f, `/orders/${order.id}/receipts`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await titles(f, order))[0]!.outstandingCents).toBe(550);
  });
  it('falha após staging reverte pagamento/projeções/guard/diário/idempotência e permite retry', async () => {
    const { order, method: m } = await financialOrder(f),
      body = await receiptBody(f, order, m, 500),
      key = randomUUID(),
      original = audit.recordAudit;
    const spy = vi.spyOn(audit, 'recordAudit').mockImplementation((...args) => {
      original(...args);
      throw new Error('Falha financeira sintética');
    });
    try {
      await financePost(f, `/orders/${order.id}/receipts`, body, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    for (const c of ['payments', 'financialTitles', 'financialOrderStates', 'financialEvents'])
      expect((await orderDocs(f, c).get()).size).toBe(0);
    expect((await orderDocs(f, 'orderFinancialGuards').doc(order.id).get()).get('version')).toBe(1);
    await financePost(f, `/orders/${order.id}/receipts`, body, key).expect(200);
  });
  it('nega alocação entre pedidos, cliente errado, data futura e quantia inválida', async () => {
    const { order, method: m } = await financialOrder(f),
      other = await confirm(f, await draft(f)),
      body = await receiptBody(f, order, m, 1);
    await financePost(f, `/orders/${order.id}/receipts`, {
      ...body,
      allocations: [
        { receivableId: other.installments[0]!.id, amountCents: 1, expectedVersion: 1 },
      ],
    }).expect(404);
    await financePost(f, `/orders/${order.id}/receipts`, {
      ...body,
      customerId: other.customerId,
    }).expect(404);
    await financePost(f, `/orders/${order.id}/receipts`, {
      ...body,
      receivedOn: '2090-01-01',
    }).expect(422);
    for (const amountCents of [0, -1, 0.1])
      await financePost(f, `/orders/${order.id}/receipts`, { ...body, amountCents }).expect(422);
  });
  it('vendedor e tenant externo não leem financeiro nem operam pagamentos', async () => {
    const { order, method: m } = await financialOrder(f),
      user = await seller(f),
      body = await receiptBody(f, order, m, 1);
    for (const path of [
      '/receivables',
      '/payments',
      `/receivables/${order.installments[0]!.id}`,
      `/orders/${order.id}/financial-history`,
    ])
      await request(f.app).get(`/api/v1${path}`).set(orderHeaders(f, user)).expect(403);
    await financePost(f, `/orders/${order.id}/receipts`, body, randomUUID(), user).expect(403);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      body,
      randomUUID(),
      f.ownerB,
      f.tenantB.tenant.id,
    ).expect(404);
  });
  it('diário paginado reconcilia centavos e detecta evento histórico adulterado', async () => {
    const { order, method: m } = await financialOrder(f);
    for (const amount of [500, 400, 100])
      await financePost(
        f,
        `/orders/${order.id}/receipts`,
        await receiptBody(f, order, m, amount),
      ).expect(200);
    const history = (
      await request(f.app)
        .get(`/api/v1/orders/${order.id}/financial-history`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data;
    expect(history.items).toHaveLength(3);
    expect(history.items[0]).not.toHaveProperty('tenantId');
    const path = `/api/v1/orders/${order.id}/financial-reconciliation?limit=1`,
      a = (await request(f.app).get(path).set(orderHeaders(f)).expect(200)).body.data;
    expect(a).toMatchObject({ consistent: true, complete: false, checkedEvents: 1 });
    const b = (
      await request(f.app).get(`${path}&cursor=${a.nextCursor}`).set(orderHeaders(f)).expect(200)
    ).body.data;
    expect(b).toMatchObject({ consistent: true, complete: false, checkedEvents: 2 });
    const c = (
      await request(f.app).get(`${path}&cursor=${b.nextCursor}`).set(orderHeaders(f)).expect(200)
    ).body.data;
    expect(c).toMatchObject({ consistent: true, complete: true, checkedEvents: 3 });
    const events = await orderDocs(f, 'financialEvents').orderBy('sequence').get();
    await events.docs[0]!.ref.update({ amountCents: 1 });
    let cursor: string | null = null;
    for (const checkedEvents of [1, 2, 3]) {
      const page = reconciliationView.parse(
        (
          await request(f.app)
            .get(`${path}${cursor ? `&cursor=${cursor}` : ''}`)
            .set(orderHeaders(f))
            .expect(200)
        ).body.data,
      );
      expect(page).toMatchObject({
        consistent: false,
        complete: checkedEvents === 3,
        checkedEvents,
      });
      cursor = page.nextCursor;
    }
  });
});
