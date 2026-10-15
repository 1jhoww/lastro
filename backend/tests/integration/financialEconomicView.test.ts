import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { registerFixture } from '../helpers/fixture.js';
import { financialOrder, receiptBody, financePost } from '../helpers/finance.js';
import { orderDocs, orderHeaders } from '../helpers/orders.js';
import { paymentSchema } from '../../src/shared/schemas/finance.js';
import { sealSourceProof } from '../../src/modules/finance/resolution/proofRecords.js';
import { proofRootHash, proofLeafHash } from '../../src/modules/finance/resolution/proofs.js';

const f = registerFixture();
async function pendingPayment() {
  const setup = await financialOrder(f);
  const receipt = (
    await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 100),
    ).expect(200)
  ).body.data;
  const before = paymentSchema.parse(
    (await orderDocs(f, 'payments').doc(receipt.resourceId).get()).data(),
  );
  const after = {
    ...before,
    transferredCents: 40,
    version: before.version + 1,
    allocations: before.allocations.map((a, i) => ({
      ...a,
      remainingCents: a.remainingCents - (i === 0 ? 40 : 0),
    })),
  };
  const executionId = 'local-prepared-execution';
  const tenantId = f.tenantA.tenant.id;
  const entry = sealSourceProof({
    tenantId,
    executionId,
    collection: 'payments',
    sourceId: before.id,
    fence: 1,
    position: 0,
    before,
    after,
  });
  const rootHash = proofRootHash(
    { tenantId, executionId, entryCount: 1 },
    proofLeafHash({ tenantId, executionId, entryCount: 1 }, 0, entry.hash),
  );
  const base = f.firebase.db.doc(`tenants/${tenantId}`);
  await base.collection('financialExecutions').doc(executionId).create({
    tenantId,
    id: executionId,
    orderId: setup.order.id,
    status: 'APPLYING',
    proofRootHash: rootHash,
    proofEntryCount: 1,
    publication: null,
  });
  await base
    .collection('financialProofEntries')
    .doc(entry.id)
    .create({ ...entry, siblings: [] });
  await orderDocs(f, 'payments')
    .doc(before.id)
    .set({
      ...after,
      pendingExecutionId: executionId,
      pendingProofEntryId: entry.id,
      pendingFence: 1,
    });
  return { ...setup, before, entry, base };
}

describe('F02: leitores HTTP de fontes preparadas', () => {
  it('detalhe, lista, títulos e estado preservam visão anterior', async () => {
    const setup = await pendingPayment();
    const detail = await request(f.app)
      .get(`/api/v1/payments/${setup.before.id}`)
      .set(orderHeaders(f))
      .expect(200);
    expect(detail.body.data).toMatchObject({ transferredCents: 0, version: 1 });
    expect(detail.body.data).not.toHaveProperty('pendingExecutionId');
    const list = await request(f.app)
      .get('/api/v1/payments')
      .query({ orderId: setup.order.id })
      .set(orderHeaders(f))
      .expect(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({ transferredCents: 0, version: 1 });
    const state = await request(f.app)
      .get(`/api/v1/orders/${setup.order.id}/financial-state`)
      .set(orderHeaders(f))
      .expect(200);
    expect(state.body.data).toMatchObject({ cashSettledCents: 100, transferredCashCents: 0 });
    const titles = await request(f.app)
      .get('/api/v1/receivables')
      .query({ orderId: setup.order.id })
      .set(orderHeaders(f))
      .expect(200);
    expect(titles.body.data.items[0]).toMatchObject({ cashCents: 100 });
    await request(f.app)
      .get(`/api/v1/payments/${setup.before.id}`)
      .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
      .expect(404);
    expect((await setup.base.collection('financialExecutions').get()).size).toBe(1);
  });
  it('prova ausente falha sem divulgar depois e sem reparar documento', async () => {
    const setup = await pendingPayment();
    await setup.base.collection('financialProofEntries').doc(setup.entry.id).delete();
    const detail = await request(f.app)
      .get(`/api/v1/payments/${setup.before.id}`)
      .set(orderHeaders(f))
      .expect(409);
    expect(detail.body.error.code).toBe('FINANCIAL_INTEGRITY');
    await request(f.app).get('/api/v1/payments').set(orderHeaders(f)).expect(409);
    expect(
      (await orderDocs(f, 'payments').doc(setup.before.id).get()).data()?.transferredCents,
    ).toBe(40);
  });
});
