import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture } from '../helpers/fixture.js';
import {
  receiptBody,
  financePost,
  titles,
  versions,
  creditSource,
  method,
} from '../helpers/finance.js';
import { orderHeaders, orderDocs, draft, confirm, command } from '../helpers/orders.js';
import { stockProduct, enter, balance } from '../helpers/inventory.js';
import { largeProducts, largeDraft } from '../helpers/largeOrders.js';
import { orderView } from '../../src/shared/schemas/orders.js';
import { seller } from '../helpers/commercial.js';
import * as audit from '../../src/shared/audit/audit.js';
type Order = ReturnType<typeof orderView.parse>;
const f = registerFixture({ rateLimitMax: 10000 });
const dispatch = async (order: Order) =>
  orderView.parse((await command(f, order, 'dispatch').expect(200)).body.data);
async function ten(customerId?: string) {
  const id = await stockProduct(f, { priceCents: 100 });
  await enter(f, id, '10').expect(201);
  const order = await dispatch(
    await confirm(
      f,
      await draft(f, f.ownerA, {
        productId: id,
        quantity: '10',
        ...(customerId ? { customerId } : {}),
      }),
    ),
  );
  return { order, method: await method(f) };
}
async function intent(order: Order, quantity = order.lines[0]!.quantity, lines?: object[]) {
  return (
    await financePost(f, `/orders/${order.id}/returns`, {
      ...(await versions(f, order)),
      lines: lines ?? [{ lineId: order.lines[0]!.id, quantity }],
      reason: 'Intenção sintética',
    }).expect(201)
  ).body.data;
}
async function returnBody(order: Order, value: { returnId: string }) {
  const current = (
    await request(f.app).get(`/api/v1/returns/${value.returnId}`).set(orderHeaders(f)).expect(200)
  ).body.data;
  return {
    ...(await versions(f, order)),
    expectedVersion: current.version,
    reason: 'Operação sintética de devolução',
  };
}
async function receive(
  order: Order,
  value: { returnId: string },
  quantity: string,
  damaged = false,
  key = randomUUID(),
) {
  return financePost(
    f,
    `/returns/${value.returnId}/receipts`,
    {
      ...(await returnBody(order, value)),
      lines: [
        {
          lineId: order.lines[0]!.id,
          ...(damaged ? { damagedQuantity: quantity } : { sellableQuantity: quantity }),
        },
      ],
    },
    key,
  );
}
async function resolve(order: Order, value: { returnId: string }, extra: object = {}) {
  return financePost(f, `/returns/${value.returnId}/resolve`, {
    ...(await returnBody(order, value)),
    disposition: 'customer_credit',
    ...extra,
  });
}
async function current(value: { returnId: string }) {
  return (
    await request(f.app).get(`/api/v1/returns/${value.returnId}`).set(orderHeaders(f)).expect(200)
  ).body.data;
}
async function preview(value: { returnId: string }) {
  return (
    await request(f.app)
      .get(`/api/v1/returns/${value.returnId}/resolution-preview`)
      .set(orderHeaders(f))
      .expect(200)
  ).body.data;
}
describe('Incremento E4: devoluções de expedidos', () => {
  it('encerrar uma intenção não libera outra intenção ainda pendente do mesmo pedido', async () => {
    const { order, method: m } = await ten(),
      first = await intent(order, '3'),
      second = await intent(order, '7');
    expect((await receive(order, first, '3')).status).toBe(200);
    expect((await resolve(order, first)).body.data.status).toBe('closed');
    const blocked = await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 1),
    ).expect(409);
    expect(blocked.body.error.code).toBe('RETURN_FINANCIAL_BLOCK');
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(order.id).get()).get('activeReturnCount'),
    ).toBe(1);
    await financePost(
      f,
      `/returns/${second.returnId}/cancel-pending`,
      await returnBody(order, second),
    ).expect(200);
    await financePost(f, `/orders/${order.id}/receipts`, await receiptBody(f, order, m, 1)).expect(
      200,
    );
    expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data.physical).toBe('3');
  });
  it('aceite parcial abate dívida, restaura crédito e destina somente caixa remanescente', async () => {
    const source = await creditSource(f),
      { order, method: m } = await ten(source.order.customerId!);
    const row = (await titles(f, order))[0]!;
    await financePost(f, `/orders/${order.id}/credit-applications`, {
      ...(await versions(f, order)),
      customerId: order.customerId,
      creditLotId: source.creditLotId,
      expectedLotVersion: 1,
      amountCents: 200,
      allocations: [{ receivableId: row.id, expectedVersion: row.version, amountCents: 200 }],
      reason: 'Crédito antes de dano parcial',
    }).expect(200);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 700),
    ).expect(200);
    const value = await intent(order, '4');
    expect((await receive(order, value, '4', true)).status).toBe(200);
    const result = (
      await resolve(order, value, {
        damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true, acceptedCents: 350 }],
      })
    ).body.data;
    expect((await titles(f, order))[0]).toMatchObject({
      outstandingCents: 0,
      creditCents: 0,
      cashCents: 650,
      canceledCents: 350,
    });
    expect((await orderDocs(f, 'creditLots').doc(source.creditLotId).get()).data()).toMatchObject({
      availableCents: 500,
      appliedCents: 0,
    });
    expect((await orderDocs(f, 'creditLots').doc(result.creditLotId).get()).data()).toMatchObject({
      issuedCents: 50,
      origin: 'order_return',
    });
    expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data.physical).toBe('0');
  });
  it.each(['receipt', 'reversal', 'credit'] as const)(
    'intenção versus %s serializa efeitos e mantém bloqueio após retry',
    async (kind) => {
      const source = kind === 'credit' ? await creditSource(f) : undefined,
        { order, method: m } = await ten(source?.order.customerId ?? undefined);
      let paymentId: string | undefined;
      if (kind === 'reversal')
        paymentId = (
          await financePost(
            f,
            `/orders/${order.id}/receipts`,
            await receiptBody(f, order, m, 200),
          ).expect(200)
        ).body.data.resourceId;
      const v = await versions(f, order),
        row = (await titles(f, order))[0]!,
        allocations = [{ receivableId: row.id, expectedVersion: row.version, amountCents: 100 }],
        path =
          kind === 'receipt'
            ? `/orders/${order.id}/receipts`
            : kind === 'reversal'
              ? `/payments/${paymentId}/reversals`
              : `/orders/${order.id}/credit-applications`,
        body =
          kind === 'receipt'
            ? await receiptBody(f, order, m, 100)
            : {
                ...v,
                amountCents: 100,
                allocations,
                reason: 'Mutação concorrente com devolução',
                ...(kind === 'reversal'
                  ? { expectedVersion: 1 }
                  : {
                      customerId: order.customerId,
                      creditLotId: source!.creditLotId,
                      expectedLotVersion: 1,
                    }),
              };
      const results = await Promise.all([
        financePost(f, `/orders/${order.id}/returns`, {
          ...v,
          lines: [{ lineId: order.lines[0]!.id, quantity: '4' }],
          reason: 'Intenção concorrente com financeiro',
        }),
        financePost(f, path, body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(
        results[0]!.status === 201 ? [201, 409] : [200, 409],
      );
      const value = results[0]!.status === 201 ? results[0]!.body.data : await intent(order, '4');
      const blocked = {
        ...body,
        ...(await versions(f, order)),
        allocations: [{ ...allocations[0], expectedVersion: (await titles(f, order))[0]!.version }],
        ...(kind === 'reversal' ? { expectedVersion: results[1]!.status === 200 ? 2 : 1 } : {}),
      };
      const failure = await financePost(f, path, blocked).expect(409);
      expect(failure.body.error.code).toBe('RETURN_FINANCIAL_BLOCK');
      expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data.physical).toBe(
        '0',
      );
      const title = (await titles(f, order))[0]!;
      expect(title.cashCents).toBe(
        kind === 'receipt'
          ? results[1]!.status === 200
            ? 100
            : 0
          : kind === 'reversal'
            ? results[1]!.status === 200
              ? 100
              : 200
            : 0,
      );
      expect(title.creditCents).toBe(kind === 'credit' && results[1]!.status === 200 ? 100 : 0);
      expect((await current(value)).status).toBe('pending');
    },
  );
  it('preview informa limites e versões sem efeitos; aceite parcial não cria estoque vendável', async () => {
    const { order } = await ten(),
      value = await intent(order, '4');
    expect((await receive(order, value, '4', true)).status).toBe(200);
    const before = await current(value),
      result = await preview(value);
    expect(result).toMatchObject({
      ...(await versions(f, order)),
      expectedVersion: before.version,
      lines: [
        {
          lineId: order.lines[0]!.id,
          damagedQuantity: '4',
          sellableCents: 0,
          damagedLimitCents: 400,
        },
      ],
    });
    expect(await current(value)).toEqual(before);
    const resolved = await resolve(order, value, {
      damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true, acceptedCents: 150 }],
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({
      amountCents: 150,
      status: 'closed',
      creditLotId: null,
      refundObligationId: null,
    });
    expect((await current(value)).lines[0]).toMatchObject({
      acceptedDamaged: '4',
      valueResolvedCents: 150,
      damagedValueReductionCents: 250,
    });
    expect((await titles(f, order))[0]).toMatchObject({
      outstandingCents: 850,
      canceledCents: 150,
    });
    expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data.available).toBe('0');
    expect((await preview(value)).lines[0]).toMatchObject({
      sellableCents: 0,
      damagedLimitCents: 0,
    });
  });
  it('aceite monetário zero encerra dano sem inventar crédito ou abatimento', async () => {
    const { order } = await ten(),
      value = await intent(order, '4');
    expect((await receive(order, value, '4', true)).status).toBe(200);
    expect(
      (
        await resolve(order, value, {
          damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true, acceptedCents: 0 }],
        })
      ).body.data,
    ).toMatchObject({
      amountCents: 0,
      status: 'closed',
      creditLotId: null,
      refundObligationId: null,
    });
    expect((await titles(f, order))[0]).toMatchObject({ outstandingCents: 1000, canceledCents: 0 });
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(0);
    expect((await orderDocs(f, 'refundObligations').get()).size).toBe(0);
    await financePost(f, `/orders/${order.id}/returns`, {
      ...(await versions(f, order)),
      lines: [{ lineId: order.lines[0]!.id, quantity: '7' }],
      reason: 'Não reutilizar dano recebido',
    }).expect(409);
  });
  it('limita valor do dano recebido e não modifica estado em rejeições', async () => {
    const { order } = await ten(),
      value = await intent(order, '4');
    expect((await receive(order, value, '4', true)).status).toBe(200);
    const before = await current(value);
    for (const [accept, acceptedCents, status] of [
      [true, 401, 409],
      [false, 1, 422],
      [true, -1, 422],
      [true, 0.5, 422],
    ] as const) {
      expect(
        (
          await resolve(order, value, {
            damagedDecisions: [{ lineId: order.lines[0]!.id, accept, acceptedCents }],
          })
        ).status,
      ).toBe(status);
      expect(await current(value)).toEqual(before);
    }
    expect(
      (
        await resolve(order, value, {
          damagedDecisions: [{ lineId: 'other-line', accept: true, acceptedCents: 1 }],
        })
      ).status,
    ).toBe(422);
  });
  it('retornos posteriores não recuperam redução de dano e integral física respeita valor aceito', async () => {
    const { order } = await ten(),
      value = await intent(order);
    await financePost(f, `/returns/${value.returnId}/receipts`, {
      ...(await returnBody(order, value)),
      lines: [{ lineId: order.lines[0]!.id, sellableQuantity: '2', damagedQuantity: '4' }],
    }).expect(200);
    expect(
      (
        await resolve(order, value, {
          damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true, acceptedCents: 150 }],
        })
      ).body.data.amountCents,
    ).toBe(350);
    expect((await current(value)).status).toBe('partially_received');
    expect((await receive(order, value, '4')).status).toBe(200);
    expect((await preview(value)).lines[0].sellableCents).toBe(400);
    expect((await resolve(order, value)).body.data).toMatchObject({
      amountCents: 400,
      status: 'closed',
    });
    expect((await titles(f, order))[0]).toMatchObject({
      outstandingCents: 250,
      canceledCents: 750,
    });
    expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data.available).toBe('6');
    expect(
      (
        await request(f.app)
          .get(`/api/v1/orders/${order.id}/financial-reconciliation`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data.consistent,
    ).toBe(true);
    const history = (
      await request(f.app)
        .get(`/api/v1/returns/${value.returnId}/history`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data.items;
    expect(history.filter((e: { type: string }) => e.type === 'resolved')).toHaveLength(2);
    expect(
      history.some(
        (e: { after: { lines: { damagedValueReductionCents?: number }[] } }) =>
          e.after.lines[0]?.damagedValueReductionCents === 250,
      ),
    ).toBe(true);
  });
  it('arredondamento do dano com valor reduzido não duplica centavo em outra intenção', async () => {
    const id = await stockProduct(f, { unit: 'KG', priceCents: 500 });
    await enter(f, id, '0.003').expect(201);
    const order = await dispatch(
      await confirm(f, await draft(f, f.ownerA, { productId: id, quantity: '0.003' })),
    );
    const first = await intent(order, '0.001');
    expect((await receive(order, first, '0.001', true)).status).toBe(200);
    expect(
      (
        await resolve(order, first, {
          damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true, acceptedCents: 0 }],
        })
      ).body.data.amountCents,
    ).toBe(0);
    const second = await intent(order, '0.001');
    expect((await receive(order, second, '0.001', true)).status).toBe(200);
    expect((await preview(second)).lines[0].damagedLimitCents).toBe(0);
    expect(
      (
        await resolve(order, second, {
          damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true, acceptedCents: 1 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await resolve(order, second, {
          damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true }],
        })
      ).body.data.amountCents,
    ).toBe(0);
    const third = await intent(order, '0.001');
    expect((await receive(order, third, '0.001')).status).toBe(200);
    expect((await resolve(order, third)).body.data.amountCents).toBe(1);
    expect((await titles(f, order))[0]).toMatchObject({ outstandingCents: 1, canceledCents: 1 });
  });
  it('resolução parcial paga abate dívida antes de constituir obrigação e registra devolução real separadamente', async () => {
    const { order, method: m } = await ten();
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 900),
    ).expect(200);
    const value = await intent(order, '4');
    expect((await receive(order, value, '4', true)).status).toBe(200);
    const resolved = await resolve(order, value, {
      disposition: 'refund',
      damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true, acceptedCents: 250 }],
    });
    expect(resolved.status).toBe(200);
    expect(
      (
        await orderDocs(f, 'refundObligations').doc(resolved.body.data.refundObligationId).get()
      ).data(),
    ).toMatchObject({ originalCents: 150, outstandingCents: 150, refundedCents: 0 });
    expect((await titles(f, order))[0]).toMatchObject({
      outstandingCents: 0,
      cashCents: 750,
      canceledCents: 250,
    });
  });
  it('resolução duplicada de aceite parcial emite apenas uma fonte e replay mantém resultado original', async () => {
    const { order, method: m } = await ten();
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 1000),
    ).expect(200);
    const value = await intent(order, '4');
    expect((await receive(order, value, '4', true)).status).toBe(200);
    const body = {
        ...(await returnBody(order, value)),
        disposition: 'customer_credit',
        damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true, acceptedCents: 150 }],
      },
      key = randomUUID();
    const results = await Promise.all([
      financePost(f, `/returns/${value.returnId}/resolve`, body, key),
      financePost(f, `/returns/${value.returnId}/resolve`, body, key),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body.data).toEqual(results[1]!.body.data);
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(1);
    expect(
      (await orderDocs(f, 'creditLots').doc(results[0]!.body.data.creditLotId).get()).data(),
    ).toMatchObject({ issuedCents: 150, availableCents: 150 });
    await financePost(
      f,
      `/returns/${value.returnId}/resolve`,
      { ...body, damagedDecisions: [{ ...body.damagedDecisions[0], acceptedCents: 151 }] },
      key,
    ).expect(409);
    const second = await intent(order, '1');
    expect((await receive(order, second, '1')).status).toBe(200);
    expect((await resolve(order, second)).status).toBe(200);
    expect(
      (await financePost(f, `/returns/${value.returnId}/resolve`, body, key).expect(200)).body.data,
    ).toEqual(results[0]!.body.data);
  });
  it('falha após staging de aceite parcial conserva fontes, bloqueio e guard; retry recupera', async () => {
    const { order, method: m } = await ten();
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 1000),
    ).expect(200);
    const value = await intent(order, '4');
    expect((await receive(order, value, '4', true)).status).toBe(200);
    const before = await current(value),
      body = {
        ...(await returnBody(order, value)),
        disposition: 'refund',
        damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true, acceptedCents: 150 }],
      },
      key = randomUUID(),
      original = audit.recordAudit;
    const spy = vi.spyOn(audit, 'recordAudit').mockImplementation((...args) => {
      original(...args);
      throw new Error('Falha sintética após aceite parcial');
    });
    try {
      await financePost(f, `/returns/${value.returnId}/resolve`, body, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await current(value)).toEqual(before);
    expect((await titles(f, order))[0]).toMatchObject({ cashCents: 1000, canceledCents: 0 });
    expect((await orderDocs(f, 'refundObligations').get()).size).toBe(0);
    expect(
      (await orderDocs(f, 'orderReturnLines').get()).docs[0]!.get('damagedValueReductionCents'),
    ).toBeUndefined();
    expect(
      (await financePost(f, `/returns/${value.returnId}/resolve`, body, key).expect(200)).body.data
        .amountCents,
    ).toBe(150);
  });
  it('receber versus cancelar saldo físico tem um vencedor e nenhum estoque fictício', async () => {
    const { order } = await ten(),
      value = await intent(order),
      body = await returnBody(order, value);
    const results = await Promise.all([
      financePost(f, `/returns/${value.returnId}/receipts`, {
        ...body,
        lines: [{ lineId: order.lines[0]!.id, sellableQuantity: '6' }],
      }),
      financePost(f, `/returns/${value.returnId}/cancel-pending`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const state = await current(value),
      received = results[0]!.status === 200;
    expect(state.lines[0].received).toBe(received ? '6' : '0');
    expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data.physical).toBe(
      received ? '6' : '0',
    );
    expect((await orderDocs(f, 'returnReceipts').get()).size).toBe(received ? 1 : 0);
    if (received) {
      expect((await resolve(order, value)).status).toBe(200);
      await financePost(
        f,
        `/returns/${value.returnId}/cancel-pending`,
        await returnBody(order, value),
      ).expect(200);
    }
    expect((await current(value)).status).toBe('closed');
  });
  it('preview financeiro recusa vendedor e tenant estrangeiro', async () => {
    const { order } = await ten(),
      value = await intent(order);
    await request(f.app)
      .get(`/api/v1/returns/${value.returnId}/resolution-preview`)
      .set(orderHeaders(f, await seller(f)))
      .expect(403);
    await request(f.app)
      .get(`/api/v1/returns/${value.returnId}/resolution-preview`)
      .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
      .expect(404);
  });
  it('caixa transferido deixa de ser reversível no recebimento original', async () => {
    const { order, method: m } = await ten(),
      payment = (
        await financePost(
          f,
          `/orders/${order.id}/receipts`,
          await receiptBody(f, order, m, 1000),
        ).expect(200)
      ).body.data,
      value = await intent(order, '6');
    expect((await receive(order, value, '6')).status).toBe(200);
    expect((await resolve(order, value)).status).toBe(200);
    const source = (
      await request(f.app)
        .get(`/api/v1/payments/${payment.resourceId}`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data;
    expect(source).toMatchObject({
      amountCents: 1000,
      transferredCents: 600,
      reversedCents: 0,
      version: 2,
    });
    expect(source.allocations[0].remainingCents).toBe(400);
    const row = (await titles(f, order))[0]!;
    await financePost(f, `/payments/${payment.resourceId}/reversals`, {
      ...(await versions(f, order)),
      expectedVersion: 2,
      amountCents: 401,
      allocations: [{ receivableId: row.id, expectedVersion: row.version, amountCents: 401 }],
      reason: 'Estorno acima da fonte restante',
    }).expect(409);
  });
  it('preço atual alterado não modifica total histórico devolvido', async () => {
    const { order } = await ten();
    await orderDocs(f, 'products').doc(order.lines[0]!.productId).update({ priceCents: 999999 });
    const value = await intent(order, '6');
    expect((await receive(order, value, '6')).status).toBe(200);
    expect((await resolve(order, value)).body.data.amountCents).toBe(600);
  });
  it('guard adulterado é rejeitado pela prova imutável', async () => {
    const { order } = await ten(),
      value = await intent(order);
    const guard = (await orderDocs(f, 'orderReturnLines').get()).docs[0]!;
    await guard.ref.update({ pendingScaled: 9000 });
    expect((await receive(order, value, '1')).status).toBe(409);
    expect((await orderDocs(f, 'returnReceipts').get()).size).toBe(0);
  });
  it('falha de resolução não abate dívida nem emite crédito parcial', async () => {
    const { order, method: m } = await ten();
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 1000),
    ).expect(200);
    const value = await intent(order, '6');
    expect((await receive(order, value, '6')).status).toBe(200);
    const key = randomUUID(),
      body = {
        ...(await returnBody(order, value)),
        disposition: 'customer_credit',
        reason: 'Resolução com falha sintética',
      },
      original = audit.recordAudit;
    const spy = vi.spyOn(audit, 'recordAudit').mockImplementation((...args) => {
      original(...args);
      throw new Error('Falha de resolução');
    });
    try {
      await financePost(f, `/returns/${value.returnId}/resolve`, body, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await titles(f, order))[0]).toMatchObject({ cashCents: 1000, canceledCents: 0 });
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(0);
    expect((await current(value)).lines[0].valueResolvedCents).toBe(0);
    await financePost(f, `/returns/${value.returnId}/resolve`, body, key).expect(200);
  });
  it('intenção não muda estoque e bloqueia novas baixas desde o início', async () => {
    const { order, method: m } = await ten(),
      value = await intent(order);
    expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data.physical).toBe('0');
    await financePost(f, `/orders/${order.id}/receipts`, await receiptBody(f, order, m, 1)).expect(
      409,
    );
    expect((await current(value)).status).toBe('pending');
    expect((await orderDocs(f, 'returnReceipts').get()).size).toBe(0);
  });
  it('recebe seis, resolve seis e mantém quatro pendentes e bloqueio até cancelamento auditado', async () => {
    const { order, method: m } = await ten();
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 1000),
    ).expect(200);
    const value = await intent(order);
    expect((await receive(order, value, '6')).status).toBe(200);
    expect((await resolve(order, value)).status).toBe(200);
    expect((await current(value)).lines[0]).toMatchObject({
      received: '6',
      pending: '4',
      valueResolvedCents: 600,
    });
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(order.id).get()).get('activeReturnCount'),
    ).toBe(1);
    const canceled = (
      await financePost(
        f,
        `/returns/${value.returnId}/cancel-pending`,
        await returnBody(order, value),
      ).expect(200)
    ).body.data;
    expect(canceled.status).toBe('closed');
    expect((await current(value)).lines[0]).toMatchObject({ received: '6', pending: '0' });
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(order.id).get()).get('activeReturnCount'),
    ).toBe(0);
    const receipts = (
      await request(f.app)
        .get(`/api/v1/returns/${value.returnId}/receipts`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data.items;
    expect(receipts[0]).toMatchObject({
      actorUid: f.ownerA.uid,
      lines: [{ sellableQuantity: '6', damagedQuantity: '0' }],
    });
    expect(
      (
        await request(f.app)
          .get(`/api/v1/returns/${value.returnId}/history`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(4);
  });
  it('parciais sucessivas reconciliam estoque e não permitem ultrapassar expedição', async () => {
    const { order } = await ten(),
      value = await intent(order);
    for (const qty of ['6', '4']) {
      expect((await receive(order, value, qty)).status).toBe(200);
      expect((await resolve(order, value)).status).toBe(200);
    }
    expect((await current(value)).status).toBe('closed');
    expect((await titles(f, order))[0]).toMatchObject({ canceledCents: 1000, outstandingCents: 0 });
    await financePost(f, `/orders/${order.id}/returns`, {
      ...(await versions(f, order)),
      lines: [{ lineId: order.lines[0]!.id, quantity: '1' }],
      reason: 'Duplicação proibida',
    }).expect(409);
    expect(
      (
        await request(f.app)
          .get(`/api/v1/inventory/${order.lines[0]!.productId}/reconciliation`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data,
    ).toMatchObject({ consistent: true, physical: '10', reserved: '0' });
  });
  it('duas intenções concorrentes não prometem as mesmas quantidades', async () => {
    const { order } = await ten(),
      body = {
        ...(await versions(f, order)),
        lines: [{ lineId: order.lines[0]!.id, quantity: '7' }],
        reason: 'Intenção concorrente',
      };
    expect(
      (
        await Promise.all([
          financePost(f, `/orders/${order.id}/returns`, body),
          financePost(f, `/orders/${order.id}/returns`, body),
        ])
      )
        .map((r) => r.status)
        .sort(),
    ).toEqual([201, 409]);
    expect((await orderDocs(f, 'returns').get()).size).toBe(1);
  });
  it('repetição concorrente de recebimento cria uma única movimentação', async () => {
    const { order } = await ten(),
      value = await intent(order),
      key = randomUUID(),
      body = {
        ...(await returnBody(order, value)),
        lines: [{ lineId: order.lines[0]!.id, sellableQuantity: '6' }],
      };
    const results = await Promise.all([
      financePost(f, `/returns/${value.returnId}/receipts`, body, key),
      financePost(f, `/returns/${value.returnId}/receipts`, body, key),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results[0]!.body.data).toEqual(results[1]!.body.data);
    expect((await orderDocs(f, 'returnReceipts').get()).size).toBe(1);
    expect(
      (await orderDocs(f, 'inventoryMovements').where('type', '==', 'STOCK_RETURN').get()).size,
    ).toBe(1);
  });
  it('corrige só saldo pendente sem apagar quantidades já recebidas', async () => {
    const { order } = await ten(),
      value = await intent(order);
    expect((await receive(order, value, '6')).status).toBe(200);
    const body = await returnBody(order, value);
    await request(f.app)
      .patch(`/api/v1/returns/${value.returnId}`)
      .set(orderHeaders(f))
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, lines: [{ lineId: order.lines[0]!.id, quantity: '5' }] })
      .expect(409);
    await request(f.app)
      .patch(`/api/v1/returns/${value.returnId}`)
      .set(orderHeaders(f))
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, lines: [{ lineId: order.lines[0]!.id, quantity: '8' }] })
      .expect(200);
    expect((await current(value)).lines[0]).toMatchObject({ received: '6', pending: '2' });
  });
  it('danificado fica separado e exige decisão administrativa antes de resolver', async () => {
    const { order } = await ten(),
      value = await intent(order, '4');
    expect((await receive(order, value, '4', true)).status).toBe(200);
    expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data.physical).toBe('0');
    expect(
      (await orderDocs(f, 'inventoryMovements').where('type', '==', 'STOCK_RETURN').get()).size,
    ).toBe(0);
    expect((await resolve(order, value)).status).toBe(422);
    expect(
      (
        await resolve(order, value, {
          damagedDecisions: [{ lineId: order.lines[0]!.id, accept: false }],
        })
      ).status,
    ).toBe(200);
    expect((await titles(f, order))[0]).toMatchObject({ outstandingCents: 1000, canceledCents: 0 });
    expect((await current(value)).lines[0]).toMatchObject({
      rejectedDamaged: '4',
      valueResolvedCents: 0,
    });
  });
  it('aceite de danificado abate dívida mas não aumenta estoque disponível', async () => {
    const { order } = await ten(),
      value = await intent(order, '4');
    expect((await receive(order, value, '4', true)).status).toBe(200);
    expect(
      (
        await resolve(order, value, {
          damagedDecisions: [{ lineId: order.lines[0]!.id, accept: true }],
        })
      ).status,
    ).toBe(200);
    expect((await titles(f, order))[0]).toMatchObject({
      outstandingCents: 600,
      canceledCents: 400,
    });
    expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data.available).toBe('0');
  });
  it('abate dívida antes de gerar obrigação exclusivamente sobre caixa liquidado', async () => {
    const { order, method: m } = await ten();
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, m, 700),
    ).expect(200);
    const value = await intent(order, '6');
    expect((await receive(order, value, '6')).status).toBe(200);
    const result = (await resolve(order, value, { disposition: 'refund' })).body.data;
    expect((await titles(f, order))[0]).toMatchObject({
      outstandingCents: 0,
      cashCents: 400,
      canceledCents: 600,
    });
    expect(
      (await orderDocs(f, 'refundObligations').doc(result.refundObligationId).get()).data(),
    ).toMatchObject({ originalCents: 300, refundedCents: 0, status: 'pending' });
  });
  it('restaura créditos à origem antes de destinar caixa e preserva outros pedidos', async () => {
    const source = await creditSource(f, 500),
      target = await confirm(f, await draft(f, f.ownerA, { customerId: source.order.customerId! })),
      other = await confirm(f, await draft(f, f.ownerA, { customerId: source.order.customerId! }));
    let lotVersion = 1;
    for (const [o, amount] of [
      [target, 200],
      [other, 100],
    ] as const) {
      const row = (await titles(f, o))[0]!;
      await financePost(f, `/orders/${o.id}/credit-applications`, {
        ...(await versions(f, o)),
        customerId: o.customerId,
        creditLotId: source.creditLotId,
        expectedLotVersion: lotVersion++,
        amountCents: amount,
        allocations: [{ receivableId: row.id, expectedVersion: row.version, amountCents: amount }],
        reason: 'Uso da mesma fonte',
      }).expect(200);
    }
    await financePost(
      f,
      `/orders/${target.id}/receipts`,
      await receiptBody(f, target, source.method, 500),
    ).expect(200);
    const order = await dispatch(target),
      value = await intent(order);
    expect((await receive(order, value, '1')).status).toBe(200);
    const result = (await resolve(order, value)).body.data;
    expect((await orderDocs(f, 'creditLots').doc(source.creditLotId).get()).data()).toMatchObject({
      availableCents: 400,
      appliedCents: 100,
    });
    expect(
      (await orderDocs(f, 'creditLots').doc(result.creditLotId).get()).get('issuedCents'),
    ).toBe(500);
    expect((await titles(f, other))[0]!.creditCents).toBe(100);
  });
  it('pedido em devolução não bloqueia recebimento de outro pedido do cliente', async () => {
    const { order, method: m } = await ten();
    await intent(order);
    const other = await confirm(f, await draft(f, f.ownerA, { customerId: order.customerId! }));
    await financePost(f, `/orders/${other.id}/receipts`, await receiptBody(f, other, m, 1)).expect(
      200,
    );
  });
  it('arredondamento cumulativo fracionário produz 1/0/1 sem crédito fictício', async () => {
    const id = await stockProduct(f, { unit: 'KG', priceCents: 500 });
    await enter(f, id, '0.003').expect(201);
    const order = await dispatch(
        await confirm(f, await draft(f, f.ownerA, { productId: id, quantity: '0.003' })),
      ),
      values: number[] = [];
    for (let i = 0; i < 3; i++) {
      const value = await intent(order, '0.001');
      expect((await receive(order, value, '0.001')).status).toBe(200);
      values.push((await resolve(order, value)).body.data.amountCents);
    }
    expect(values).toEqual([1, 0, 1]);
    expect((await titles(f, order))[0]).toMatchObject({
      originalCents: 2,
      canceledCents: 2,
      outstandingCents: 0,
    });
    expect((await orderDocs(f, 'payments').get()).size).toBe(0);
  });
  it('falha após preparar recebimento não deixa movimento, guard ou recibo parcial', async () => {
    const { order } = await ten(),
      value = await intent(order),
      key = randomUUID(),
      body = {
        ...(await returnBody(order, value)),
        lines: [{ lineId: order.lines[0]!.id, sellableQuantity: '6' }],
      },
      original = audit.recordAudit;
    const spy = vi.spyOn(audit, 'recordAudit').mockImplementation((...args) => {
      original(...args);
      throw new Error('Falha sintética de retorno');
    });
    try {
      await financePost(f, `/returns/${value.returnId}/receipts`, body, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await current(value)).lines[0].received).toBe('0');
    expect((await orderDocs(f, 'returnReceipts').get()).size).toBe(0);
    expect((await balance(f, order.lines[0]!.productId).expect(200)).body.data.physical).toBe('0');
    await financePost(f, `/returns/${value.returnId}/receipts`, body, key).expect(200);
  });
  it('tenant estrangeiro, vendedor e precisão inválida não acessam devolução', async () => {
    const { order } = await ten(),
      value = await intent(order);
    await request(f.app)
      .get(`/api/v1/returns/${value.returnId}`)
      .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
      .expect(404);
    await request(f.app)
      .get('/api/v1/returns')
      .set(orderHeaders(f, await seller(f)))
      .expect(403);
    expect((await receive(order, value, '0.1')).status).toBe(422);
    await financePost(f, `/returns/${value.returnId}/receipts`, {
      ...(await returnBody(order, value)),
      lines: [{ lineId: order.lines[0]!.id, sellableQuantity: '0' }],
    }).expect(422);
  });
  it('200 produtos retornam atomicamente com descontos originais e reconciliação completa', async () => {
    const ids = await largeProducts(f, 200),
      order = await dispatch(await confirm(f, await largeDraft(f, ids))),
      originals = (await orderDocs(f, 'receivables').get()).docs.map((d) => ({
        id: d.id,
        data: d.data(),
      }));
    const value = await intent(
        order,
        '1',
        order.lines.map((l) => ({ lineId: l.id, quantity: '1' })),
      ),
      start = performance.now();
    await financePost(f, `/returns/${value.returnId}/receipts`, {
      ...(await returnBody(order, value)),
      lines: order.lines.map((l) => ({ lineId: l.id, sellableQuantity: '1' })),
    }).expect(200);
    const physicalMs = Math.round(performance.now() - start),
      resolveStart = performance.now();
    expect((await resolve(order, value)).status).toBe(200);
    console.info(
      JSON.stringify({
        return200PhysicalMs: physicalMs,
        return200ResolveMs: Math.round(performance.now() - resolveStart),
      }),
    );
    expect(
      (await current(value)).lines.reduce(
        (a: number, l: { valueResolvedCents: number }) => a + l.valueResolvedCents,
        0,
      ),
    ).toBe(order.totalCents);
    expect((await titles(f, order)).every((t) => t.canceledCents === t.originalCents)).toBe(true);
    for (const r of originals)
      expect((await orderDocs(f, 'receivables').doc(r.id).get()).data()).toEqual(r.data);
    for (let i = 0; i < ids.length; i += 10)
      await Promise.all(
        ids
          .slice(i, i + 10)
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
    expect(
      (
        await request(f.app)
          .get(`/api/v1/orders/${order.id}/financial-reconciliation`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data.consistent,
    ).toBe(true);
  }, 90_000);
});
