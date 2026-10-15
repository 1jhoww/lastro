import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import { financialOrder, receiptBody, financePost, versions } from '../helpers/finance.js';
import { orderHeaders, orderDocs } from '../helpers/orders.js';

const f = registerFixture({ rateLimitMax: 10_000 });
describe('F02: execução retomável pelo contrato HTTP', () => {
  it('cancelamento publica uma vez; passos e início repetidos não repetem dinheiro ou reserva', async () => {
    const setup = await financialOrder(f);
    await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 100),
    ).expect(200);
    const body = {
      ...(await versions(f, setup.order)),
      disposition: 'customer_credit',
      reason: 'Cancelamento retomável local',
    };
    const key = randomUUID();
    let execution = (
      await financePost(
        f,
        `/orders/${setup.order.id}/financial-cancellation-executions`,
        body,
        key,
      ).expect(202)
    ).body.data;
    expect(execution).toMatchObject({
      status: 'ACCEPTED',
      financialCompleted: false,
      result: null,
    });
    const repeated = await financePost(
      f,
      `/orders/${setup.order.id}/financial-cancellation-executions`,
      body,
      key,
    ).expect(202);
    expect(repeated.body.data.id).toBe(execution.id);
    let calls = 0;
    while (!execution.financialCompleted) {
      expect(calls++).toBeLessThan(100);
      const input = { expectedRevision: execution.revision, fencingToken: execution.fencingToken };
      const stepKey = randomUUID();
      const response = await financePost(
        f,
        `/financial-executions/${execution.id}/advance`,
        input,
        stepKey,
      );
      expect(response.status).toBe(response.body.data.financialCompleted ? 200 : 202);
      expect(
        (await financePost(f, `/financial-executions/${execution.id}/advance`, input, stepKey)).body
          .data,
      ).toEqual(response.body.data);
      execution = response.body.data;
      const state = (
        await request(f.app)
          .get(`/api/v1/orders/${setup.order.id}/financial-state`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data;
      expect(state.cashSettledCents).toBe(execution.financialCompleted ? 0 : 100);
      expect(state.transferredCashCents).toBe(execution.financialCompleted ? 100 : 0);
    }
    expect(execution).toMatchObject({ status: 'COMPLETED', financialCompleted: true });
    expect(
      (
        await financePost(
          f,
          `/orders/${setup.order.id}/financial-cancellation-executions`,
          body,
          key,
        ).expect(200)
      ).body.data.financialCompleted,
    ).toBe(true);
    expect((await orderDocs(f, 'creditLots').get()).docs.map((d) => d.data())).toEqual([
      expect.objectContaining({ issuedCents: 100, availableCents: 100, appliedCents: 0 }),
    ]);
    const events = await orderDocs(f, 'financialEvents')
      .where('type', '==', 'financial_cancellation')
      .get();
    expect(events.size).toBe(1);
    expect(events.docs[0]!.get('schemaVersion')).toBe(2);
    expect(events.docs[0]!.get('references').length).toBeLessThanOrEqual(4);
    const commercial = (
      await orderDocs(f, 'orderEvents')
        .where('orderId', '==', setup.order.id)
        .where('type', '==', 'canceled')
        .get()
    ).docs[0]!;
    expect(commercial.get('operationId')).not.toBe(execution.id);
    expect(
      (
        await request(f.app)
          .get(`/api/v1/orders/${setup.order.id}`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data,
    ).toMatchObject({ status: 'canceled', version: setup.order.version + 1 });
    const reconciliation = await request(f.app)
      .get(`/api/v1/financial-executions/${execution.id}/proof-reconciliation`)
      .set(orderHeaders(f))
      .expect(200);
    expect(reconciliation.body.data).toMatchObject({ consistent: true, complete: true });
  }, 120_000);
});
