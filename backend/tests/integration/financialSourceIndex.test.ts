import { describe, expect, it } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import { financialOrder, receiptBody, financePost, titles, versions } from '../helpers/finance.js';
import { orderDocs } from '../helpers/orders.js';

const f = registerFixture();
async function active(orderId: string) {
  const page = await orderDocs(f, 'financialSourceGenerations')
    .where('orderId', '==', orderId)
    .where('kind', '==', 'active')
    .get();
  expect(page.size).toBe(1);
  return page.docs[0]!.data();
}
describe('F02: projeção atômica de fontes positivas', () => {
  it('receber, estornar e cancelar conservam índice certificado sem apagar histórico', async () => {
    const setup = await financialOrder(f);
    const initialOperations = await orderDocs(f, 'financialOperations').get();
    const receipt = (
      await financePost(
        f,
        `/orders/${setup.order.id}/receipts`,
        await receiptBody(f, setup.order, setup.method, 10),
      ).expect(200)
    ).body.data;
    let generation = await active(setup.order.id);
    expect(generation).toMatchObject({ certified: true, rowCount: 1 });
    let rows = await orderDocs(f, 'financialActiveSources')
      .where('generationId', '==', generation.generationId)
      .get();
    expect(rows.size).toBe(1);
    expect(rows.docs[0]!.data()).toMatchObject({
      sourceId: receipt.resourceId,
      remainingCents: 10,
      sourceVersion: 1,
    });
    const title = (await titles(f, setup.order))[0]!;
    await financePost(f, `/payments/${receipt.resourceId}/reversals`, {
      ...(await versions(f, setup.order)),
      expectedVersion: 1,
      amountCents: 4,
      allocations: [{ receivableId: title.id, amountCents: 4, expectedVersion: title.version }],
      reason: 'Estorno local',
    }).expect(200);
    generation = await active(setup.order.id);
    rows = await orderDocs(f, 'financialActiveSources')
      .where('generationId', '==', generation.generationId)
      .get();
    expect(rows.docs[0]!.data()).toMatchObject({ remainingCents: 6, sourceVersion: 2 });
    await financePost(f, `/orders/${setup.order.id}/financial-cancellation`, {
      ...(await versions(f, setup.order)),
      disposition: 'customer_credit',
      reason: 'Cancelamento local',
    }).expect(200);
    generation = await active(setup.order.id);
    expect(generation).toMatchObject({ certified: true, rowCount: 0 });
    expect(
      (
        await orderDocs(f, 'financialActiveSources')
          .where('generationId', '==', generation.generationId)
          .get()
      ).size,
    ).toBe(0);
    expect((await orderDocs(f, 'payments').get()).size).toBe(1);
    expect((await orderDocs(f, 'financialEvents').get()).size).toBe(3);
    const operations = await orderDocs(f, 'financialOperations').get();
    expect(operations.size).toBe(initialOperations.size + 3);
    for (const original of initialOperations.docs)
      expect(operations.docs.find((d) => d.id === original.id)?.data()).toEqual(original.data());
  });
  it('fonte multialocada mantém uma linha por título positivo e elimina somente o saldo zerado', async () => {
    const setup = await financialOrder(f, {
      paymentConditionId: null,
      paymentConditionVersion: undefined,
      payment: { type: 'installments', dueDates: ['2090-01-01', '2090-02-01', '2090-03-01'] },
    });
    const body = await receiptBody(f, setup.order, setup.method, setup.order.totalCents);
    const receipt = (await financePost(f, `/orders/${setup.order.id}/receipts`, body).expect(200))
      .body.data;
    const generation = await active(setup.order.id);
    expect(generation).toMatchObject({ certified: true, rowCount: 3 });
    const before = await orderDocs(f, 'financialActiveSources')
      .where('generationId', '==', generation.generationId)
      .get();
    expect(before.docs.reduce((sum, d) => sum + Number(d.get('remainingCents')), 0)).toBe(
      setup.order.totalCents,
    );
    const title = (await titles(f, setup.order))[0]!;
    await financePost(f, `/payments/${receipt.resourceId}/reversals`, {
      ...(await versions(f, setup.order)),
      expectedVersion: 1,
      amountCents: title.cashCents,
      allocations: [
        { receivableId: title.id, amountCents: title.cashCents, expectedVersion: title.version },
      ],
      reason: 'Estorno de parcela local',
    }).expect(200);
    expect(await active(setup.order.id)).toMatchObject({ certified: true, rowCount: 2 });
    const after = await orderDocs(f, 'financialActiveSources')
      .where('generationId', '==', generation.generationId)
      .get();
    expect(after.size).toBe(2);
    expect(
      after.docs.every((d) => d.get('sourceVersion') === 2 && d.get('remainingCents') > 0),
    ).toBe(true);
  });
});
