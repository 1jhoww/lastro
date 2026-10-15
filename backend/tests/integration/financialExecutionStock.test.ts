import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import {
  financePost,
  versions,
  financialOrder,
  condition,
  creditSource,
  titles,
  receiptBody,
} from '../helpers/finance.js';
import { orderHeaders, confirm, orderDocs } from '../helpers/orders.js';
import { largeProducts, largeDraft } from '../helpers/largeOrders.js';
import { balance, stockProduct, enter } from '../helpers/inventory.js';
import {
  advanceExecution,
  finishExecution,
  type Execution,
} from '../helpers/financialExecution.js';
const f = registerFixture({ rateLimitMax: 10_000 });
describe('F02: reservas e leitores', () => {
  it('duas execuções compartilham lote: cerco serializa restauração e não expõe crédito preparado', async () => {
    const source = await creditSource(f, 500),
      ids = await largeProducts(f, 200, '1', 'Produto de cerco financeiro');
    const first = await financialOrder(f, {
      customerId: source.order.customerId,
      lines: ids.map((productId) => ({ productId, quantity: '1' })),
    });
    const second = await financialOrder(f, { customerId: source.order.customerId });
    for (const [index, setup] of [first, second].entries()) {
      const title = (await titles(f, setup.order))[0]!;
      await financePost(f, `/orders/${setup.order.id}/credit-applications`, {
        ...(await versions(f, setup.order)),
        customerId: setup.order.customerId,
        creditLotId: source.creditLotId,
        expectedLotVersion: index + 1,
        amountCents: 200,
        allocations: [{ receivableId: title.id, expectedVersion: title.version, amountCents: 200 }],
        reason: 'Crédito compartilhado válido',
      }).expect(200);
    }
    const start = async (setup: typeof first) =>
      (
        await financePost(f, `/orders/${setup.order.id}/financial-cancellation-executions`, {
          ...(await versions(f, setup.order)),
          disposition: 'customer_credit',
          reason: 'Restaurar crédito compartilhado',
        }).expect(202)
      ).body.data as Execution;
    let a = await start(first),
      b = await start(second),
      guard = 0;
    while (a.progress.applied === 0) {
      expect(guard++).toBeLessThan(100);
      a = await advanceExecution(f, a);
    }
    expect(a.financialCompleted).toBe(false);
    const visible = (
      await request(f.app)
        .get(`/api/v1/customers/${source.order.customerId}/credits`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data.items.find((lot: { id: string }) => lot.id === source.creditLotId);
    expect(visible).toMatchObject({ availableCents: 100, appliedCents: 400 });
    expect(
      (await orderDocs(f, 'creditLots').doc(source.creditLotId).get()).get('availableCents'),
    ).toBe(300);
    guard = 0;
    while (b.status !== 'PAUSED') {
      expect(guard++).toBeLessThan(100);
      b = await advanceExecution(f, b);
    }
    expect(b.review?.code).toBe('FINANCIAL_LOT_LOCKED');
    expect(b.progress.applied).toBe(0);
    await finishExecution(f, a);
    b = (
      await financePost(f, `/financial-executions/${b.id}/resume`, {
        expectedRevision: b.revision,
        reason: 'Lote publicado permite retomada',
      }).expect(202)
    ).body.data;
    await finishExecution(f, b);
    expect((await orderDocs(f, 'creditLots').doc(source.creditLotId).get()).data()).toMatchObject({
      issuedCents: 500,
      availableCents: 500,
      appliedCents: 0,
    });
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(1);
  }, 300_000);
  for (const kind of ['cash', 'credit'] as const)
    it(`12 títulos com uma fonte ${kind}: fonte aplica uma vez, não por alocação`, async () => {
      const source = kind === 'credit' ? await creditSource(f, 12) : null;
      const c = await condition(f, {
        preset: undefined,
        schedule: Array.from({ length: 12 }, () => ({ offsetDays: 0, weight: 1 })),
      });
      const productId = await stockProduct(f, { priceCents: 12 });
      await enter(f, productId, '1').expect(201);
      const setup = await financialOrder(f, {
        paymentConditionId: c.id,
        paymentConditionVersion: c.version,
        lines: [{ productId, quantity: '1' }],
        ...(source ? { customerId: source.order.customerId } : {}),
      });
      if (source) {
        const rows = await titles(f, setup.order);
        await financePost(f, `/orders/${setup.order.id}/credit-applications`, {
          ...(await versions(f, setup.order)),
          customerId: setup.order.customerId,
          creditLotId: source.creditLotId,
          expectedLotVersion: 1,
          amountCents: 12,
          allocations: rows.map((t) => ({
            receivableId: t.id,
            expectedVersion: t.version,
            amountCents: 1,
          })),
          reason: 'Uma fonte para doze títulos',
        }).expect(200);
      } else
        await financePost(
          f,
          `/orders/${setup.order.id}/receipts`,
          await receiptBody(f, setup.order, setup.method, 12),
        ).expect(200);
      const e = (
        await financePost(f, `/orders/${setup.order.id}/financial-cancellation-executions`, {
          ...(await versions(f, setup.order)),
          disposition: 'customer_credit',
          reason: 'Cancelar fonte multialocada uma vez',
        }).expect(202)
      ).body.data as Execution;
      const done = await finishExecution(f, e);
      expect(done.progress.total).toBe(kind === 'cash' ? 1 : 2);
      const values = await titles(f, setup.order);
      expect(values).toHaveLength(12);
      for (const value of values)
        expect(value).toMatchObject({
          cashCents: 0,
          creditCents: 0,
          outstandingCents: 0,
          canceledCents: 1,
        });
      const sources = await orderDocs(f, kind === 'cash' ? 'payments' : 'creditApplications')
        .where('orderId', '==', setup.order.id)
        .get();
      expect(sources.size).toBe(1);
      expect(sources.docs[0]!.get('version')).toBe(2);
      expect(
        sources.docs[0]!.get(kind === 'cash' ? 'transferredCents' : 'restoredByCancellationCents'),
      ).toBe(12);
      if (source)
        expect(
          (await orderDocs(f, 'creditLots').doc(source.creditLotId).get()).data(),
        ).toMatchObject({ availableCents: 12, appliedCents: 0, issuedCents: 12 });
    }, 120_000);
  it('200 produtos e 12 títulos legados: backfill vazio certificado e liberação retomável', async () => {
    const ids = await largeProducts(f, 200, '2', 'Descrição preservada de produto');
    const order = await confirm(f, await largeDraft(f, ids, false));
    const e = (
      await financePost(f, `/orders/${order.id}/financial-cancellation-executions`, {
        ...(await versions(f, order)),
        disposition: 'customer_credit',
        reason: '200 reservas sem mínimo comercial',
      }).expect(202)
    ).body.data as Execution;
    const done = await finishExecution(f, e);
    expect(done.progress.releasedReservations).toBe(200);
    expect(done.progress.total).toBe(0);
    expect(
      (
        await orderDocs(f, 'stockReservations')
          .where('orderId', '==', order.id)
          .where('status', '==', 'released')
          .get()
      ).size,
    ).toBe(200);
    for (const id of [ids[0]!, ids[99]!, ids[199]!])
      expect((await balance(f, id).expect(200)).body.data).toMatchObject({
        physical: '2',
        reserved: '0',
      });
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(0);
  }, 300_000);
  it('PDF e CSV recusam pedido em execução; listagem administrativa e abort preservam contrato', async () => {
    const { order } = await financialOrder(f);
    const e = (
      await financePost(f, `/orders/${order.id}/financial-cancellation-executions`, {
        ...(await versions(f, order)),
        disposition: 'customer_credit',
        reason: 'Bloqueio dos documentos',
      }).expect(202)
    ).body.data as Execution;
    const routes = [
      `/orders/${order.id}/documents/commercial.pdf`,
      `/exports/orders.csv`,
      `/exports/receivables.csv`,
    ];
    for (const route of routes)
      await request(f.app).get(`/api/v1${route}`).set(orderHeaders(f)).expect(409);
    const page = (
      await request(f.app)
        .get('/api/v1/financial-executions')
        .query({ pending: 'true', orderId: order.id })
        .set(orderHeaders(f))
        .expect(200)
    ).body.data;
    expect(page.items.map((x: Execution) => x.id)).toEqual([e.id]);
    await financePost(f, `/financial-executions/${e.id}/abort`, {
      expectedRevision: e.revision,
      reason: 'Abort antes de aplicação',
    }).expect(200);
  }, 120_000);
});
