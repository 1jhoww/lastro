import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture } from '../helpers/fixture.js';
import { financialOrder, receiptBody, financePost, versions, titles } from '../helpers/finance.js';
import { orderHeaders, orderDocs } from '../helpers/orders.js';
import { seller } from '../helpers/commercial.js';
import { AccessService } from '../../src/modules/auth/accessService.js';
const f = registerFixture();
describe('Segurança e integridade financeira E', () => {
  it('replay exige autorização atual e não permite mudar ator/payload/comando', async () => {
    const { order, method: m } = await financialOrder(f),
      body = await receiptBody(f, order, m, 1),
      key = randomUUID();
    await financePost(f, `/orders/${order.id}/receipts`, body, key).expect(200);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      { ...body, reason: 'Outra intenção' },
      key,
    ).expect(409);
    await financePost(f, `/orders/${order.id}/receipts`, body, key, await seller(f)).expect(403);
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ status: 'suspended' });
    await financePost(f, `/orders/${order.id}/receipts`, body, key).expect(403);
  });
  it('rebaixamento após middleware é relido antes da escrita financeira', async () => {
    const { order, method: m } = await financialOrder(f),
      body = await receiptBody(f, order, m, 1),
      original = AccessService.prototype.tenant;
    let injected = false;
    const spy = vi.spyOn(AccessService.prototype, 'tenant').mockImplementation(async function (
      this: AccessService,
      ...args
    ) {
      if (args[3] && !injected) {
        injected = true;
        await f.firebase.db
          .doc(`tenants/${f.tenantA.tenant.id}/memberships/${f.ownerA.uid}`)
          .update({ role: 'seller' });
      }
      return original.apply(this, args);
    });
    try {
      await financePost(f, `/orders/${order.id}/receipts`, body).expect(403);
    } finally {
      spy.mockRestore();
    }
    expect((await orderDocs(f, 'payments').get()).size).toBe(0);
    expect(
      (await orderDocs(f, 'financialOperations').where('action', '==', 'receipt').get()).size,
    ).toBe(0);
  });
  it('estorno exige autenticação recente sem desfazer recebimento', async () => {
    const { order, method: m } = await financialOrder(f),
      payment = (
        await financePost(
          f,
          `/orders/${order.id}/receipts`,
          await receiptBody(f, order, m, 1),
        ).expect(200)
      ).body.data,
      row = (await titles(f, order))[0]!,
      v = await versions(f, order);
    f.offset = 301_000;
    const failure = await financePost(f, `/payments/${payment.resourceId}/reversals`, {
      ...v,
      expectedVersion: 1,
      amountCents: 1,
      allocations: [{ receivableId: row.id, expectedVersion: row.version, amountCents: 1 }],
      reason: 'Teste de autenticação',
    }).expect(403);
    expect(failure.body.error.code).toBe('REAUTHENTICATION_REQUIRED');
  });
  it('forma desativada é recusada mas snapshot de recebimento anterior permanece', async () => {
    const { order, method: m } = await financialOrder(f),
      payment = (
        await financePost(
          f,
          `/orders/${order.id}/receipts`,
          await receiptBody(f, order, m, 1),
        ).expect(200)
      ).body.data;
    await request(f.app)
      .patch(`/api/v1/payment-methods/${m.id}`)
      .set(orderHeaders(f))
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1, status: 'inactive' })
      .expect(200);
    await financePost(f, `/orders/${order.id}/receipts`, await receiptBody(f, order, m, 1)).expect(
      409,
    );
    expect(
      (
        await request(f.app)
          .get(`/api/v1/payments/${payment.resourceId}`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data.method,
    ).toMatchObject({ id: m.id, version: 1, kind: 'pix' });
  });
  it('projeção ou título D adulterados falham fechados', async () => {
    const { order, method: m } = await financialOrder(f);
    await financePost(f, `/orders/${order.id}/receipts`, await receiptBody(f, order, m, 1)).expect(
      200,
    );
    const row = (await titles(f, order))[0]!;
    await orderDocs(f, 'financialTitles')
      .doc(row.id)
      .update({ cashCents: 2, outstandingCents: row.originalCents - 2 });
    await request(f.app)
      .get(`/api/v1/orders/${order.id}/financial-state`)
      .set(orderHeaders(f))
      .expect(409);
    await request(f.app).get(`/api/v1/receivables/${row.id}`).set(orderHeaders(f)).expect(409);
  });
  it('recebimentos legados sem origem não são migrados por suposição', async () => {
    const { order, method: m } = await financialOrder(f);
    await orderDocs(f, 'orderFinancialGuards')
      .doc(order.id)
      .update({ receivedCents: 1, paymentCount: 1 });
    await request(f.app)
      .get(`/api/v1/orders/${order.id}/financial-state`)
      .set(orderHeaders(f))
      .expect(409);
    await financePost(f, `/orders/${order.id}/receipts`, {
      expectedOrderVersion: order.version,
      expectedGuardVersion: 1,
      customerId: order.customerId,
      methodId: m.id,
      methodVersion: 1,
      receivedOn: '2026-01-01',
      amountCents: 1,
      allocations: [
        { receivableId: order.installments[0]!.id, amountCents: 1, expectedVersion: 1 },
      ],
      reason: 'Não fabricar origem',
    }).expect(409);
    expect((await orderDocs(f, 'financialTitles').get()).size).toBe(0);
  });
  it('vendedor não recebe saldos, fontes ou relatórios por nenhum contrato financeiro', async () => {
    const { order } = await financialOrder(f),
      user = await seller(f);
    for (const path of [
      '/receivables',
      '/payments',
      '/credit-applications',
      '/refund-obligations',
      '/returns',
      `/customers/${order.customerId}/credits`,
      `/orders/${order.id}/financial-state`,
      `/orders/${order.id}/financial-history`,
      `/orders/${order.id}/financial-reconciliation`,
    ])
      await request(f.app).get(`/api/v1${path}`).set(orderHeaders(f, user)).expect(403);
  });
});
