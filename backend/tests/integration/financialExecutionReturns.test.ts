import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import {
  financePost,
  financialOrder,
  versions,
  receiptBody,
  creditSource,
  titles,
} from '../helpers/finance.js';
import { orderHeaders, command, orderDocs } from '../helpers/orders.js';
import { stockProduct, enter, balance } from '../helpers/inventory.js';
import { finishExecution, type Execution } from '../helpers/financialExecution.js';
import { orderView } from '../../src/shared/schemas/orders.js';
const f = registerFixture({ rateLimitMax: 10_000 });
describe('F02: resolução física e financeira', () => {
  it('duas resoluções e dois recebimentos parciais conservam crédito, linha cumulativa e estoque', async () => {
    const productId = await stockProduct(f, { priceCents: 100 });
    await enter(f, productId, '2').expect(201);
    const setup = await financialOrder(f, { lines: [{ productId, quantity: '2' }] });
    await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 120),
    ).expect(200);
    const order = orderView.parse(
      (await command(f, setup.order, 'dispatch').expect(200)).body.data,
    );
    const intent = (
      await financePost(f, `/orders/${order.id}/returns`, {
        ...(await versions(f, order)),
        lines: [{ lineId: order.lines[0]!.id, quantity: '2' }],
        reason: 'Intenção integral com físico parcial',
      }).expect(201)
    ).body.data;
    for (let i = 0; i < 2; i++) {
      const before = (
        await request(f.app)
          .get(`/api/v1/returns/${intent.returnId}`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data;
      await financePost(f, `/returns/${intent.returnId}/receipts`, {
        ...(await versions(f, order)),
        expectedVersion: before.version,
        lines: [{ lineId: order.lines[0]!.id, sellableQuantity: '1' }],
        reason: 'Recebimento físico de uma unidade',
      }).expect(200);
      const received = (
        await request(f.app)
          .get(`/api/v1/returns/${intent.returnId}`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data;
      const e = (
        await financePost(f, `/returns/${intent.returnId}/resolution-executions`, {
          ...(await versions(f, order)),
          expectedVersion: received.version,
          disposition: 'customer_credit',
          reason: 'Resolver somente unidade recebida',
        }).expect(202)
      ).body.data as Execution;
      expect((await finishExecution(f, e)).result?.amountCents).toBe(100);
      const after = (
        await request(f.app)
          .get(`/api/v1/returns/${intent.returnId}`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data;
      expect(after.status).toBe(i === 0 ? 'partially_received' : 'closed');
      expect(after.lines[0]).toMatchObject({
        requested: '2',
        received: String(i + 1),
        pending: String(1 - i),
        sellableReceived: String(i + 1),
        financialResolved: String(i + 1),
        valueResolvedCents: (i + 1) * 100,
      });
      expect((await balance(f, productId).expect(200)).body.data.physical).toBe(String(i + 1));
      expect(
        (await orderDocs(f, 'financialOrderStates').doc(order.id).get()).get('activeReturnCount'),
      ).toBe(i === 0 ? 1 : 0);
    }
    expect(
      (await orderDocs(f, 'creditLots').get()).docs
        .map((d) => d.get('issuedCents'))
        .sort((a, b) => a - b),
    ).toEqual([20, 100]);
    expect((await titles(f, order))[0]).toMatchObject({
      canceledCents: 200,
      outstandingCents: 0,
      cashCents: 0,
      creditCents: 0,
    });
    expect(
      (await orderDocs(f, 'returnReceipts').where('returnId', '==', intent.returnId).get()).size,
    ).toBe(2);
  }, 180_000);
  it('devolução ausente retorna 404 sem criar execução', async () => {
    await financePost(f, '/returns/return-inexistente/resolution-executions', {
      expectedOrderVersion: 1,
      expectedGuardVersion: 1,
      expectedVersion: 1,
      disposition: 'customer_credit',
      reason: 'Alvo ausente não cria intenção',
    }).expect(404);
    expect((await orderDocs(f, 'financialExecutions').get()).size).toBe(0);
  });
  async function setup(credit = false) {
    const source = credit ? await creditSource(f) : null;
    const productId = await stockProduct(f, { priceCents: 100 });
    await enter(f, productId, '10').expect(201);
    const setup = await financialOrder(f, {
      lines: [{ productId, quantity: '10' }],
      ...(source ? { customerId: source.order.customerId } : {}),
    });
    if (source) {
      const t = (await titles(f, setup.order))[0]!;
      await financePost(f, `/orders/${setup.order.id}/credit-applications`, {
        ...(await versions(f, setup.order)),
        customerId: setup.order.customerId,
        creditLotId: source.creditLotId,
        expectedLotVersion: 1,
        amountCents: 200,
        allocations: [{ receivableId: t.id, expectedVersion: t.version, amountCents: 200 }],
        reason: 'Crédito sintético F02',
      }).expect(200);
    }
    await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 700),
    ).expect(200);
    const order = orderView.parse(
      (await command(f, setup.order, 'dispatch').expect(200)).body.data,
    );
    const value = (
      await financePost(f, `/orders/${order.id}/returns`, {
        ...(await versions(f, order)),
        lines: [{ lineId: order.lines[0]!.id, quantity: '4' }],
        reason: 'Retorno físico parcial',
      }).expect(201)
    ).body.data;
    const returnValue = (
      await request(f.app).get(`/api/v1/returns/${value.returnId}`).set(orderHeaders(f)).expect(200)
    ).body.data;
    await financePost(f, `/returns/${value.returnId}/receipts`, {
      ...(await versions(f, order)),
      expectedVersion: returnValue.version,
      lines: [{ lineId: order.lines[0]!.id, damagedQuantity: '4' }],
      reason: 'Dano recebido separado',
    }).expect(200);
    return { order, returnId: value.returnId, source, productId };
  }
  it('dano parcial preserva dívida -> crédito -> caixa e não aumenta estoque vendável', async () => {
    const s = await setup(true);
    const value = (
      await request(f.app).get(`/api/v1/returns/${s.returnId}`).set(orderHeaders(f)).expect(200)
    ).body.data;
    const e = (
      await financePost(f, `/returns/${s.returnId}/resolution-executions`, {
        ...(await versions(f, s.order)),
        expectedVersion: value.version,
        disposition: 'refund',
        reason: 'Aceite parcial administrativo',
        damagedDecisions: [{ lineId: s.order.lines[0]!.id, accept: true, acceptedCents: 350 }],
      }).expect(202)
    ).body.data as Execution;
    const completed = await finishExecution(f, e);
    expect(completed.blockedResources.sharedLots).toBe(0);
    expect(completed.result).toMatchObject({
      amountCents: 350,
      creditLotId: null,
      refundObligationId: expect.any(String),
    });
    expect((await titles(f, s.order))[0]).toMatchObject({
      outstandingCents: 0,
      creditCents: 0,
      cashCents: 650,
      canceledCents: 350,
    });
    expect(
      (await orderDocs(f, 'creditLots').doc(s.source!.creditLotId).get()).data(),
    ).toMatchObject({ availableCents: 500, appliedCents: 0 });
    expect((await balance(f, s.productId).expect(200)).body.data.physical).toBe('0');
    const after = (
      await request(f.app).get(`/api/v1/returns/${s.returnId}`).set(orderHeaders(f)).expect(200)
    ).body.data;
    expect(after).toMatchObject({ status: 'closed', version: value.version + 1 });
    expect(after.lines[0]).toMatchObject({
      valueResolvedCents: 350,
      damagedValueReductionCents: 50,
      acceptedDamaged: '4',
    });
    expect(
      (await orderDocs(f, 'returnReceipts').where('returnId', '==', s.returnId).get()).size,
    ).toBe(1);
    expect(
      (await orderDocs(f, 'financialEvents').where('type', '==', 'return_resolved').get()).size,
    ).toBe(1);
  }, 120_000);
  it('aceite zero conclui quantidade danificada sem alterar caixa ou dívida', async () => {
    const s = await setup();
    const raw = (
      await request(f.app).get(`/api/v1/returns/${s.returnId}`).set(orderHeaders(f)).expect(200)
    ).body.data;
    const e = (
      await financePost(f, `/returns/${s.returnId}/resolution-executions`, {
        ...(await versions(f, s.order)),
        expectedVersion: raw.version,
        disposition: 'customer_credit',
        reason: 'Dano aceito sem valor',
        damagedDecisions: [{ lineId: s.order.lines[0]!.id, accept: true, acceptedCents: 0 }],
      }).expect(202)
    ).body.data as Execution;
    expect((await finishExecution(f, e)).result?.amountCents).toBe(0);
    expect((await titles(f, s.order))[0]).toMatchObject({
      cashCents: 700,
      outstandingCents: 300,
      canceledCents: 0,
    });
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(0);
  }, 120_000);
});
