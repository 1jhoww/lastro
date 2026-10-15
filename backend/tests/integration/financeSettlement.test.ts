import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture } from '../helpers/fixture.js';
import {
  financialOrder,
  receiptBody,
  financePost,
  titles,
  versions,
  creditSource,
} from '../helpers/finance.js';
import { orderHeaders, orderDocs, draft, confirm, command } from '../helpers/orders.js';
import { largeProducts, largeDraft } from '../helpers/largeOrders.js';
import { companyDate } from '../../src/modules/orders/calculation.js';
import * as audit from '../../src/shared/audit/audit.js';
const f = registerFixture({ rateLimitMax: 10000 });
const getLot = async (id: string) => (await orderDocs(f, 'creditLots').doc(id).get()).data()!;
describe('Incremento E3: estorno, crédito e cancelamento', () => {
  it('aplicação de crédito versus estorno de caixa tem um vencedor e preserva ambas as origens', async () => {
    const source = await creditSource(f),
      order = await confirm(f, await draft(f, f.ownerA, { customerId: source.order.customerId! }));
    const payment = (
      await financePost(
        f,
        `/orders/${order.id}/receipts`,
        await receiptBody(f, order, source.method, 200),
      ).expect(200)
    ).body.data;
    const row = (await titles(f, order))[0]!,
      v = await versions(f, order),
      allocations = [{ receivableId: row.id, expectedVersion: row.version, amountCents: 100 }];
    const results = await Promise.all([
      financePost(f, `/orders/${order.id}/credit-applications`, {
        ...v,
        customerId: order.customerId,
        creditLotId: source.creditLotId,
        expectedLotVersion: 1,
        amountCents: 100,
        allocations,
        reason: 'Aplicação concorrente de fonte',
      }),
      financePost(f, `/payments/${payment.resourceId}/reversals`, {
        ...v,
        expectedVersion: 1,
        amountCents: 100,
        allocations,
        reason: 'Estorno concorrente de caixa',
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const applied = results[0]!.status === 200;
    expect(await getLot(source.creditLotId)).toMatchObject({
      availableCents: applied ? 400 : 500,
      appliedCents: applied ? 100 : 0,
    });
    expect((await titles(f, order))[0]).toMatchObject({
      cashCents: applied ? 200 : 100,
      creditCents: applied ? 100 : 0,
      outstandingCents: order.totalCents - (applied ? 300 : 100),
    });
    expect(
      (
        await request(f.app)
          .get(`/api/v1/orders/${order.id}/financial-reconciliation`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data,
    ).toMatchObject({ consistent: true, complete: true });
  });
  it('estorno parcial auditado reabre saldo e respeita origem/cumulação/idempotência', async () => {
    const { order, method: m } = await financialOrder(f),
      payment = (
        await financePost(
          f,
          `/orders/${order.id}/receipts`,
          await receiptBody(f, order, m, 500),
        ).expect(200)
      ).body.data;
    const row = (await titles(f, order))[0]!,
      key = randomUUID(),
      body = {
        ...(await versions(f, order)),
        expectedVersion: 1,
        amountCents: 200,
        allocations: [{ receivableId: row.id, amountCents: 200, expectedVersion: row.version }],
        reason: 'Correção de lançamento',
      };
    const result = (
      await financePost(f, `/payments/${payment.resourceId}/reversals`, body, key).expect(200)
    ).body.data;
    expect(
      (await financePost(f, `/payments/${payment.resourceId}/reversals`, body, key).expect(200))
        .body.data,
    ).toEqual(result);
    expect((await titles(f, order))[0]).toMatchObject({ outstandingCents: 1750, cashCents: 300 });
    const next = (await titles(f, order))[0]!;
    await financePost(f, `/payments/${payment.resourceId}/reversals`, {
      ...body,
      ...(await versions(f, order)),
      expectedVersion: 2,
      amountCents: 400,
      allocations: [{ receivableId: next.id, amountCents: 400, expectedVersion: next.version }],
    }).expect(409);
    expect((await orderDocs(f, 'payments').doc(payment.resourceId).get()).get('amountCents')).toBe(
      500,
    );
  });
  it('cancelamento com recebimento parcial cria só crédito de caixa pago e libera reserva atomicamente', async () => {
    const setup = await creditSource(f, 500),
      lot = await getLot(setup.creditLotId);
    expect(lot).toMatchObject({
      issuedCents: 500,
      availableCents: 500,
      appliedCents: 0,
      origin: 'order_cancellation',
    });
    expect((await titles(f, setup.order))[0]).toMatchObject({
      outstandingCents: 0,
      canceledCents: 2050,
      cashCents: 0,
      status: 'canceled',
    });
    expect((await orderDocs(f, 'orders').doc(setup.order.id).get()).get('status')).toBe('canceled');
    expect(
      (await orderDocs(f, 'inventory').get()).docs.every((d) => d.get('reservedScaled') === 0),
    ).toBe(true);
    expect(
      (
        await request(f.app)
          .get(`/api/v1/orders/${setup.order.id}/financial-reconciliation`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data,
    ).toMatchObject({ consistent: true, complete: true });
  });
  it('obrigação manual não afirma devolução; confirmação parcial/integral registra prova uma vez', async () => {
    const { order, method: m } = await financialOrder(f);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 500),
    ).expect(200);
    const cancellation = (
      await financePost(f, `/orders/${order.id}/financial-cancellation`, {
        ...(await versions(f, order)),
        disposition: 'refund',
        reason: 'Cancelamento com devolução',
      }).expect(200)
    ).body.data;
    let refund = (
      await orderDocs(f, 'refundObligations').doc(cancellation.refundObligationId).get()
    ).data()!;
    expect(refund).toMatchObject({
      originalCents: 500,
      outstandingCents: 500,
      refundedCents: 0,
      status: 'pending',
    });
    const canceled = { ...order, version: cancellation.orderVersion },
      key = randomUUID();
    const body = {
      ...(await versions(f, canceled)),
      expectedVersion: 1,
      amountCents: 200,
      methodId: m.id,
      methodVersion: 1,
      refundedOn: companyDate(new Date(), 'America/Sao_Paulo'),
      reference: 'Comprovante sintético',
      reason: 'Saída confirmada manualmente',
    };
    const first = (
      await financePost(f, `/refund-obligations/${refund.id}/confirm`, body, key).expect(200)
    ).body.data;
    expect(
      (await financePost(f, `/refund-obligations/${refund.id}/confirm`, body, key).expect(200)).body
        .data,
    ).toEqual(first);
    const proof = (
      await request(f.app)
        .get(`/api/v1/refund-confirmations/${first.operationId}`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data;
    expect(proof).toMatchObject({
      amountCents: 200,
      reference: 'Comprovante sintético',
      actorUid: f.ownerA.uid,
    });
    await financePost(f, `/refund-obligations/${refund.id}/confirm`, {
      ...body,
      ...(await versions(f, canceled)),
      expectedVersion: 2,
      amountCents: 301,
    }).expect(409);
    await financePost(f, `/refund-obligations/${refund.id}/confirm`, {
      ...body,
      ...(await versions(f, canceled)),
      expectedVersion: 2,
      amountCents: 300,
    }).expect(200);
    refund = (await orderDocs(f, 'refundObligations').doc(refund.id).get()).data()!;
    expect(refund).toMatchObject({ outstandingCents: 0, refundedCents: 500, status: 'confirmed' });
    expect((await orderDocs(f, 'refundConfirmations').get()).size).toBe(2);
    expect(
      (
        await request(f.app)
          .get(`/api/v1/orders/${order.id}/financial-reconciliation`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data.consistent,
    ).toBe(true);
  });
  it('aplicar/reverter crédito preserva cliente/origem e não fabrica dinheiro', async () => {
    const source = await creditSource(f),
      target = await confirm(f, await draft(f, f.ownerA, { customerId: source.order.customerId! })),
      row = (await titles(f, target))[0]!;
    const applied = (
      await financePost(f, `/orders/${target.id}/credit-applications`, {
        ...(await versions(f, target)),
        customerId: target.customerId,
        creditLotId: source.creditLotId,
        expectedLotVersion: 1,
        amountCents: 100,
        allocations: [{ receivableId: row.id, amountCents: 100, expectedVersion: row.version }],
        reason: 'Uso de crédito legítimo',
      }).expect(200)
    ).body.data;
    expect(await getLot(source.creditLotId)).toMatchObject({
      availableCents: 400,
      appliedCents: 100,
    });
    const next = (await titles(f, target))[0]!;
    await financePost(f, `/credit-applications/${applied.resourceId}/reversals`, {
      ...(await versions(f, target)),
      expectedVersion: 1,
      expectedLotVersion: 2,
      amountCents: 50,
      allocations: [{ receivableId: next.id, amountCents: 50, expectedVersion: next.version }],
      reason: 'Correção do crédito aplicado',
    }).expect(200);
    expect(await getLot(source.creditLotId)).toMatchObject({
      availableCents: 450,
      appliedCents: 50,
    });
    expect((await titles(f, target))[0]).toMatchObject({
      creditCents: 50,
      outstandingCents: 2000,
      cashCents: 0,
    });
    expect((await orderDocs(f, 'payments').where('orderId', '==', target.id).get()).size).toBe(0);
  });
  it('cancelar pedido pago com crédito restaura apenas a fonte e não cria nova devolução', async () => {
    const source = await creditSource(f),
      target = await confirm(f, await draft(f, f.ownerA, { customerId: source.order.customerId! })),
      row = (await titles(f, target))[0]!;
    await financePost(f, `/orders/${target.id}/credit-applications`, {
      ...(await versions(f, target)),
      customerId: target.customerId,
      creditLotId: source.creditLotId,
      expectedLotVersion: 1,
      amountCents: 200,
      allocations: [{ receivableId: row.id, amountCents: 200, expectedVersion: row.version }],
      reason: 'Uso de fonte de crédito',
    }).expect(200);
    const result = (
      await financePost(f, `/orders/${target.id}/financial-cancellation`, {
        ...(await versions(f, target)),
        disposition: 'refund',
        reason: 'Cancelamento do pedido com crédito',
      }).expect(200)
    ).body.data;
    expect(result.creditLotId).toBeNull();
    expect(result.refundObligationId).toBeNull();
    expect(await getLot(source.creditLotId)).toMatchObject({
      availableCents: 500,
      appliedCents: 0,
    });
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(1);
    expect((await orderDocs(f, 'refundObligations').get()).size).toBe(0);
  });
  it('origem de crédito forjada ou cliente diferente são rejeitados', async () => {
    const source = await creditSource(f),
      target = await confirm(f, await draft(f)),
      row = (await titles(f, target))[0]!;
    const body = {
      ...(await versions(f, target)),
      customerId: target.customerId,
      creditLotId: source.creditLotId,
      expectedLotVersion: 1,
      amountCents: 1,
      allocations: [{ receivableId: row.id, amountCents: 1, expectedVersion: 1 }],
      reason: 'Tentativa inválida',
    };
    await financePost(f, `/orders/${target.id}/credit-applications`, body).expect(404);
    await orderDocs(f, 'creditLots')
      .doc(source.creditLotId)
      .update({ originReference: 'origem-inexistente' });
    await financePost(f, `/orders/${target.id}/credit-applications`, body).expect(409);
  });
  it('duas aplicações em pedidos distintos não consomem a mesma fonte duas vezes', async () => {
    const source = await creditSource(f),
      a = await confirm(f, await draft(f, f.ownerA, { customerId: source.order.customerId! })),
      b = await confirm(f, await draft(f, f.ownerA, { customerId: source.order.customerId! }));
    const requests = await Promise.all(
      [a, b].map(async (order) => {
        const row = (await titles(f, order))[0]!;
        return financePost(f, `/orders/${order.id}/credit-applications`, {
          ...(await versions(f, order)),
          customerId: order.customerId,
          creditLotId: source.creditLotId,
          expectedLotVersion: 1,
          amountCents: 400,
          allocations: [{ receivableId: row.id, amountCents: 400, expectedVersion: row.version }],
          reason: 'Aplicação concorrente',
        });
      }),
    );
    expect(requests.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await getLot(source.creditLotId)).toMatchObject({
      availableCents: 100,
      appliedCents: 400,
    });
  });
  it('receber versus cancelar tem um vencedor e nenhuma reserva ou obrigação órfã', async () => {
    const { order, method: m } = await financialOrder(f),
      body = await receiptBody(f, order, m, 500);
    const results = await Promise.all([
      financePost(f, `/orders/${order.id}/receipts`, body),
      financePost(f, `/orders/${order.id}/financial-cancellation`, {
        ...(await versions(f, order)),
        disposition: 'refund',
        reason: 'Cancelamento concorrente',
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const status = (await orderDocs(f, 'orders').doc(order.id).get()).get('status');
    expect(
      (await orderDocs(f, 'inventory').get()).docs.every(
        (d) => d.get('reservedScaled') === (status === 'canceled' ? 0 : 1000),
      ),
    ).toBe(true);
    expect((await orderDocs(f, 'refundObligations').get()).size).toBe(0);
  });
  it('falha no cancelamento pago não deixa crédito, liberações ou títulos parciais', async () => {
    const { order, method: m } = await financialOrder(f);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 500),
    ).expect(200);
    const key = randomUUID(),
      body = {
        ...(await versions(f, order)),
        disposition: 'customer_credit',
        reason: 'Cancelamento com falha sintética',
      },
      original = audit.recordAudit;
    const spy = vi.spyOn(audit, 'recordAudit').mockImplementation((...args) => {
      original(...args);
      throw new Error('Falha de cancelamento');
    });
    try {
      await financePost(f, `/orders/${order.id}/financial-cancellation`, body, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(0);
    expect((await orderDocs(f, 'orders').doc(order.id).get()).get('status')).toBe('confirmed');
    expect((await titles(f, order))[0]).toMatchObject({ cashCents: 500, outstandingCents: 1550 });
    expect((await orderDocs(f, 'inventory').get()).docs[0]!.get('reservedScaled')).toBe(1000);
    await financePost(f, `/orders/${order.id}/financial-cancellation`, body, key).expect(200);
  });
  it('cancelamento financeiro de 200 produtos mantém D histórico, recebíveis e reconciliação', async () => {
    const ids = await largeProducts(f, 200),
      drafted = await largeDraft(f, ids),
      confirmationKey = randomUUID(),
      order = await confirm(f, drafted, f.ownerA, confirmationKey),
      m = await import('../helpers/finance.js').then((mod) => mod.method(f));
    const snapshots = (await orderDocs(f, 'receivables').get()).docs.map((d) => ({
      id: d.id,
      data: d.data(),
    }));
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 500),
    ).expect(200);
    const start = performance.now();
    await financePost(f, `/orders/${order.id}/financial-cancellation`, {
      ...(await versions(f, order)),
      disposition: 'refund',
      reason: 'Cancelar pedido grande pago',
    }).expect(200);
    console.info(
      JSON.stringify({ financialCancellation200Ms: Math.round(performance.now() - start) }),
    );
    expect(
      (await command(f, drafted, 'confirm', f.ownerA, confirmationKey).expect(200)).body.data,
    ).toEqual(order);
    for (const item of snapshots)
      expect((await orderDocs(f, 'receivables').doc(item.id).get()).data()).toEqual(item.data);
    expect((await titles(f, order)).every((t) => t.status === 'canceled')).toBe(true);
    for (let offset = 0; offset < ids.length; offset += 10)
      await Promise.all(
        ids
          .slice(offset, offset + 10)
          .map(async (id) =>
            expect(
              (
                await request(f.app)
                  .get(`/api/v1/inventory/${id}/reconciliation`)
                  .set(orderHeaders(f))
                  .expect(200)
              ).body.data,
            ).toMatchObject({ consistent: true, complete: true, physical: '2', reserved: '0' }),
          ),
      );
  }, 90_000);
});
