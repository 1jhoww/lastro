import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { registerFixture } from '../helpers/fixture.js';
import {
  financialOrder,
  receiptBody,
  financePost,
  creditSource,
  titles,
  versions,
} from '../helpers/finance.js';
import { command, orderDocs } from '../helpers/orders.js';

const f = registerFixture();
async function lockOrder(orderId: string, status = 'PAUSED', lotId?: string) {
  const tenantId = f.tenantA.tenant.id;
  const base = f.firebase.db.doc(`tenants/${tenantId}`);
  const executionId = 'local-lock-owner';
  const now = new Date().toISOString();
  await base
    .collection('financialExecutions')
    .doc(executionId)
    .create({
      id: executionId,
      tenantId,
      orderId,
      status,
      fencingToken: 1,
      leaseUntil: '2020-01-01T00:00:00.000Z',
      applicationStartedAt: null,
      publication: null,
      progress: { applied: 0, releasedReservations: 0 },
    });
  await base
    .collection(lotId ? 'financialExecutionLotLocks' : 'financialExecutionOrderLocks')
    .doc(lotId ?? orderId)
    .create({
      tenantId,
      resourceId: lotId ?? orderId,
      executionId,
      fencingToken: 1,
      baselineVersion: 1,
      createdAt: now,
      schemaVersion: 1,
    });
  return { base, executionId };
}
describe('F02: bloqueios econômicos duráveis', () => {
  it.each(['ACCEPTED', 'READY', 'APPLYING', 'PAUSED', 'NEEDS_REVIEW'])(
    'lease vencido não libera pedido em %s',
    async (status) => {
      const setup = await financialOrder(f);
      const body = await receiptBody(f, setup.order, setup.method, 1);
      await lockOrder(setup.order.id, status);
      const response = await financePost(f, `/orders/${setup.order.id}/receipts`, body).expect(409);
      expect(response.body.error.code).toBe('FINANCIAL_OPERATION_IN_PROGRESS');
      const dispatch = await command(f, setup.order, 'dispatch').expect(409);
      expect(dispatch.body.error.code).toBe('FINANCIAL_OPERATION_IN_PROGRESS');
      expect((await orderDocs(f, 'payments').get()).size).toBe(0);
      expect(
        (await orderDocs(f, 'financialOperations').where('action', '==', 'receipt').get()).size,
      ).toBe(0);
    },
  );
  it('replay concluído conserva resposta anterior sem nova movimentação', async () => {
    const setup = await financialOrder(f);
    const body = await receiptBody(f, setup.order, setup.method, 1),
      key = randomUUID();
    const original = await financePost(f, `/orders/${setup.order.id}/receipts`, body, key).expect(
      200,
    );
    await lockOrder(setup.order.id);
    const replay = await financePost(f, `/orders/${setup.order.id}/receipts`, body, key).expect(
      200,
    );
    expect(replay.body.data).toEqual(original.body.data);
    expect((await orderDocs(f, 'payments').get()).size).toBe(1);
    await financePost(f, `/orders/${setup.order.id}/receipts`, body).expect(409);
  });
  it('lote compartilhado bloqueia crédito de outro pedido, mas não seu recebimento', async () => {
    const source = await creditSource(f);
    const target = await financialOrder(f, { customerId: source.order.customerId });
    const row = (await titles(f, target.order))[0]!;
    await lockOrder(source.order.id, 'APPLYING', source.creditLotId);
    const response = await financePost(f, `/orders/${target.order.id}/credit-applications`, {
      ...(await versions(f, target.order)),
      customerId: target.order.customerId,
      creditLotId: source.creditLotId,
      expectedLotVersion: 1,
      amountCents: 1,
      allocations: [{ receivableId: row.id, amountCents: 1, expectedVersion: row.version }],
      reason: 'Crédito local',
    }).expect(409);
    expect(response.body.error.code).toBe('FINANCIAL_LOT_LOCKED');
    await financePost(
      f,
      `/orders/${target.order.id}/receipts`,
      await receiptBody(f, target.order, target.method, 1),
    ).expect(200);
    expect((await orderDocs(f, 'creditApplications').get()).size).toBe(0);
  });
  it('libera somente abort admissível e não ignora proprietário ausente', async () => {
    const setup = await financialOrder(f);
    const lock = await lockOrder(setup.order.id, 'ABORTED');
    await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 1),
    ).expect(200);
    await lock.base.collection('financialExecutions').doc(lock.executionId).delete();
    const response = await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 1),
    ).expect(409);
    expect(response.body.error.code).toBe('FINANCIAL_INTEGRITY');
    expect((await orderDocs(f, 'payments').get()).size).toBe(1);
  });
});
