import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import { financialOrder, financePost, titles, versions } from '../helpers/finance.js';
import { orderDocs, orderHeaders } from '../helpers/orders.js';
import { seedValidFinancialSources } from '../helpers/financialSourceSeed.js';

const f = registerFixture();
describe('F02: preparação direta de fontes financeiras válidas', () => {
  it('seed conserva origens, auditorias e ledger sem chamadas HTTP de recebimento', async () => {
    const setup = await financialOrder(f);
    const metrics = await seedValidFinancialSources(f, setup, 25);
    expect(metrics).toMatchObject({
      sources: 25,
      receiptHttpCalls: 0,
      seededEvents: 25,
      seededOperations: 25,
      seededAudits: 25,
      activeRows: 25,
    });
    expect(metrics.maxBatchWrites).toBeLessThanOrEqual(100);
    expect(metrics.maxBatchEstimatedBytes).toBeLessThan(2 * 1024 * 1024);
    const state = await request(f.app)
      .get(`/api/v1/orders/${setup.order.id}/financial-state`)
      .set(orderHeaders(f))
      .expect(200);
    expect(state.body.data).toMatchObject({
      cashReceivedCents: 25,
      cashSettledCents: 25,
      transferredCashCents: 0,
      creditSettledCents: 0,
      canceledCents: 0,
    });
    expect(state.body.data.titles[0]).toMatchObject({
      cashCents: 25,
      outstandingCents: setup.order.totalCents - 25,
    });
    const reconciliation = await request(f.app)
      .get(`/api/v1/orders/${setup.order.id}/financial-reconciliation?limit=100`)
      .set(orderHeaders(f))
      .expect(200);
    expect(reconciliation.body.data).toMatchObject({
      consistent: true,
      complete: true,
      checkedEvents: 25,
    });
    expect((await orderDocs(f, 'payments').get()).size).toBe(25);
    expect(
      (await orderDocs(f, 'auditLogs').where('action', '==', 'finance.receipt').get()).size,
    ).toBe(25);
    const source = (await orderDocs(f, 'payments').limit(1).get()).docs[0]!;
    const title = (await titles(f, setup.order))[0]!;
    await financePost(f, `/payments/${source.id}/reversals`, {
      ...(await versions(f, setup.order)),
      expectedVersion: 1,
      amountCents: 1,
      allocations: [{ receivableId: title.id, expectedVersion: title.version, amountCents: 1 }],
      reason: 'Estorno de fonte válida gerada no emulador',
    }).expect(200);
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).data(),
    ).toMatchObject({ cashReceivedCents: 24, cashSettledCents: 24, eventSequence: 26 });
  });
});
