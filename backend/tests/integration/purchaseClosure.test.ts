import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import { seller } from '../helpers/commercial.js';
import request from 'supertest';
import {
  api,
  available,
  companyDay,
  confirmed,
  gestao,
  method,
  product,
  receive,
  type PurchaseShape,
} from '../helpers/management.js';

const f = registerFixture();

type Treatment = 'abatement' | 'full_charge' | 'supplier_credit';
interface Title {
  id: string;
  originalCents: number;
  paidCents: number;
  canceledCents: number;
  outstandingCents: number;
  status: string;
  situation: string;
  dueDate: string;
  version: number;
  cancelReason: string | null;
}

const titles = async (purchase: { installments: { payableId: string }[] }) => {
  const rows: Title[] = [];
  for (const row of purchase.installments)
    rows.push((await api(f).get(`/payables/${row.payableId}`).expect(200)).body.data);
  return rows;
};
const pay = async (title: Title, cents: number) => {
  const form = await method(f);
  return api(f)
    .post(`/payables/${title.id}/payments`, {
      expectedVersion: title.version,
      principalCents: cents,
      paidOn: companyDay(),
      methodId: form.id,
      methodVersion: form.version,
    })
    .expect(201);
};
const preview = async (id: string, treatment: Treatment) =>
  (await api(f).post(`/purchases/${id}/closure-preview`, { treatment }).expect(200)).body.data;
const close = async (
  purchase: { id: string; version: number },
  treatment: Treatment,
  extra: object = {},
  key?: string,
) => {
  const impact = await preview(purchase.id, treatment);
  return api(f).post(
    `/purchases/${purchase.id}/close`,
    {
      expectedVersion: purchase.version,
      treatment,
      reason: 'Fornecedor não tem mais o produto',
      expectedUndeliveredCents: impact.undeliveredValueCents,
      expectedExcessCents: impact.excessCents,
      ...extra,
    },
    key,
  );
};
const received = async (purchase: PurchaseShape, quantity: string) => {
  const result = await receive(f, purchase, [{ lineId: purchase.lines[0]!.id, quantity }]).expect(
    201,
  );
  return result.body.data.purchase as PurchaseShape;
};
/** 30 units at R$ 10,00 in three installments of R$ 100,00 each. */
const installmented = async () => {
  const id = await product(f);
  return {
    id,
    purchase: await confirmed(f, [{ productId: id, quantity: '30', unitCostCents: 1000 }]),
  };
};

beforeEach(() => gestao(f));

describe('Encerrar saldo pendente', () => {
  it('abatimento reduz títulos abertos a partir da última parcela e preserva o estoque', async () => {
    const { id, purchase } = await installmented();
    const partial = await received(purchase, '10');
    const before = await available(f, id);
    const impact = await preview(purchase.id, 'abatement');
    expect(impact).toMatchObject({
      undeliveredValueCents: 20000,
      openBalanceCents: 30000,
      abatedCents: 20000,
      excessCents: 0,
      creditCents: 0,
    });
    expect(impact.items).toHaveLength(1);
    expect(impact.items[0]).toMatchObject({ orderedQuantity: '30', undeliveredQuantity: '20' });
    expect(impact.titles.map((t: { abatedCents: number }) => t.abatedCents)).toEqual([
      10000, 10000,
    ]);
    const done = await close(partial, 'abatement').then((r) => r);
    expect(done.status).toBe(201);
    const { purchase: closed, closure } = done.body.data;
    expect(closed).toMatchObject({ status: 'closed', pendingReceipt: false });
    expect(closed.closure).toMatchObject({ treatment: 'abatement', abatedCents: 20000 });
    expect(closed.lines[0]).toMatchObject({
      quantity: '30',
      receivedQuantity: '10',
      pendingQuantity: '0',
      undeliveredQuantity: '20',
    });
    expect(closed.totalCents).toBe(30000);
    expect(closure.titles).toHaveLength(2);
    const [first, second, third] = await titles(purchase);
    expect(first).toMatchObject({ outstandingCents: 10000, canceledCents: 0, status: 'open' });
    expect(second).toMatchObject({ outstandingCents: 0, canceledCents: 10000, status: 'canceled' });
    expect(third).toMatchObject({ outstandingCents: 0, canceledCents: 10000, status: 'canceled' });
    expect(second!.cancelReason).toBe('Fornecedor não tem mais o produto');
    expect(await available(f, id)).toBe(before);
    const read = await api(f).get(`/purchases/${purchase.id}/closure`).expect(200);
    expect(read.body.data.items[0].undeliveredValueCents).toBe(20000);
  });

  it('com pagamento parcial, abate o saldo e registra o que foi pago a maior', async () => {
    const { purchase } = await installmented();
    const partial = await received(purchase, '10');
    const [first, second] = await titles(purchase);
    await pay(first!, 10000);
    const paid = await pay(second!, 5000);
    const impact = await preview(purchase.id, 'abatement');
    expect(impact).toMatchObject({
      undeliveredValueCents: 20000,
      openBalanceCents: 15000,
      paidCents: 15000,
      abatedCents: 15000,
      excessCents: 5000,
      creditCents: 5000,
    });
    const refused = await close(partial, 'abatement');
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('EXCESS_DESTINATION_REQUIRED');
    const done = await close(partial, 'abatement', { excessAs: 'recoverable' });
    expect(done.status).toBe(201);
    const closure = done.body.data.closure;
    expect(closure).toMatchObject({ excessAs: 'recoverable', excessCents: 5000 });
    const [one, two, three] = await titles(purchase);
    expect(one).toMatchObject({ paidCents: 10000, outstandingCents: 0, status: 'paid' });
    expect(two).toMatchObject({
      paidCents: 5000,
      canceledCents: 5000,
      outstandingCents: 0,
      status: 'paid',
    });
    expect(three).toMatchObject({ outstandingCents: 0, status: 'canceled' });
    const payments = await api(f).get(`/payable-payments?payableId=${second!.id}`).expect(200);
    expect(payments.body.data.items).toHaveLength(1);
    expect(payments.body.data.items[0]).toMatchObject({
      id: paid.body.data.payment.id,
      status: 'active',
      principalCents: 5000,
    });
    const credit = await api(f).get(`/supplier-credits/${closure.creditId}`).expect(200);
    expect(credit.body.data).toMatchObject({
      kind: 'recoverable',
      originalCents: 5000,
      balanceCents: 5000,
      status: 'open',
      purchaseId: purchase.id,
    });
  });

  it('recebimentos sucessivos com frete fecham a soma exata do total', async () => {
    const [a, b] = [await product(f), await product(f)];
    const purchase = await confirmed(
      f,
      [
        { productId: a, quantity: '3', unitCostCents: 333 },
        { productId: b, quantity: '7', unitCostCents: 777 },
      ],
      { freightCents: 1001, discountCents: 13 },
    );
    const lineA = purchase.lines[0]!.id;
    const lineB = purchase.lines[1]!.id;
    const one = await receive(f, purchase, [{ lineId: lineA, quantity: '1' }]).expect(201);
    const two = await receive(f, one.body.data.purchase, [
      { lineId: lineA, quantity: '1' },
      { lineId: lineB, quantity: '2' },
    ]).expect(201);
    const three = await receive(f, two.body.data.purchase, [
      { lineId: lineB, quantity: '2' },
    ]).expect(201);
    const partial = three.body.data.purchase;
    const stockValue = partial.lines.reduce(
      (t: number, l: { receivedValueCents: number }) => t + l.receivedValueCents,
      0,
    );
    const done = await close(partial, 'abatement');
    expect(done.status).toBe(201);
    const { closure } = done.body.data;
    expect(stockValue + closure.undeliveredValueCents).toBe(purchase.totalCents);
    const rows = await titles(purchase);
    expect(rows.reduce((t, r) => t + r.outstandingCents, 0)).toBe(stockValue);
    expect(rows.every((r) => r.outstandingCents >= 0)).toBe(true);
    expect(
      rows.every((r) => r.originalCents === r.outstandingCents + r.paidCents + r.canceledCents),
    ).toBe(true);
  });

  it('cobrança integral mantém os títulos e aparece no painel', async () => {
    const { purchase } = await installmented();
    const partial = await received(purchase, '10');
    const before = await titles(purchase);
    const done = await close(partial, 'full_charge');
    expect(done.status).toBe(201);
    expect(done.body.data.closure).toMatchObject({
      abatedCents: 0,
      creditCents: 0,
      creditId: null,
      titles: [],
    });
    expect(await titles(purchase)).toEqual(before);
    const panel = await api(f).get('/finance/management').expect(200);
    expect(panel.body.data.payables.openCents).toBe(30000);
    expect(panel.body.data.notes.join(' ')).toContain('cobradas e não entregues');
    expect(panel.body.data.profitability).toMatchObject({
      cogsCents: 0,
      grossProfitCents: 0,
      operatingExpensesCents: 0,
      undeliveredLossCents: 20000,
      estimatedResultCents: -20000,
    });
  });

  it('crédito do fornecedor mantém os títulos e compensa outra compra sem mexer no caixa', async () => {
    const { purchase } = await installmented();
    const partial = await received(purchase, '10');
    const before = await titles(purchase);
    const done = await close(partial, 'supplier_credit');
    expect(done.status).toBe(201);
    expect(await titles(purchase)).toEqual(before);
    const creditId = done.body.data.closure.creditId as string;
    const result = await api(f).get('/finance/management').expect(200);
    expect(result.body.data.profitability.undeliveredLossCents).toBe(0);
    const listed = await api(f).get('/supplier-credits').expect(200);
    expect(listed.body.data.items.map((c: { id: string }) => c.id)).toContain(creditId);

    const supplierId = done.body.data.purchase.supplierId as string;
    const other = await confirmed(
      f,
      [{ productId: await product(f), quantity: '5', unitCostCents: 1000 }],
      { supplierId },
      [30],
    );
    const [target] = await titles(other);
    const credit = (await api(f).get(`/supplier-credits/${creditId}`)).body.data;
    const applied = await api(f)
      .post(`/supplier-credits/${creditId}/applications`, {
        expectedVersion: credit.version,
        payableId: target!.id,
        amountCents: 5000,
      })
      .expect(201);
    expect(applied.body.data.credit).toMatchObject({ balanceCents: 15000, appliedCents: 5000 });
    const [settled] = await titles(other);
    expect(settled).toMatchObject({ outstandingCents: 0, status: 'paid', paidCents: 0 });
    const panel = await api(f).get('/finance/management').expect(200);
    expect(panel.body.data.payables.paidInPeriodCents).toBe(0);
    expect(panel.body.data.payables.supplierCreditsCents).toBe(15000);

    const blocked = await api(f).post(`/purchases/${other.id}/cancel`, {
      expectedVersion: other.version,
      reason: 'Tentativa de cancelar',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PURCHASE_HAS_CREDITS');

    const movementId = applied.body.data.movement.id as string;
    const undone = await api(f)
      .post(`/supplier-credit-movements/${movementId}/reversal`, { reason: 'Lançado errado' })
      .expect(200);
    expect(undone.body.data.credit).toMatchObject({ balanceCents: 20000, appliedCents: 0 });
    expect(undone.body.data.movement).toMatchObject({ status: 'reversed' });
    const [restored] = await titles(other);
    expect(restored).toMatchObject({ outstandingCents: 5000, canceledCents: 0, status: 'open' });
    const twice = await api(f).post(`/supplier-credit-movements/${movementId}/reversal`, {
      reason: 'Lançado errado',
    });
    expect(twice.status).toBe(409);
    const movements = await api(f).get(`/supplier-credits/${creditId}/movements`).expect(200);
    expect(movements.body.data.items).toHaveLength(1);
  });

  it('valor recuperado entra no caixa; estorno retira', async () => {
    const { purchase } = await installmented();
    const partial = await received(purchase, '10');
    const [first, second, third] = await titles(purchase);
    await pay(first!, 10000);
    await pay(second!, 10000);
    await pay(third!, 10000);
    const done = await close(partial, 'abatement', { excessAs: 'recoverable' });
    expect(done.status).toBe(201);
    expect(done.body.data.closure).toMatchObject({ abatedCents: 0, excessCents: 20000 });
    const creditId = done.body.data.closure.creditId as string;
    const recovered = await api(f)
      .post(`/supplier-credits/${creditId}/recoveries`, {
        expectedVersion: 1,
        amountCents: 20000,
        recoveredOn: companyDay(),
      })
      .expect(201);
    expect(recovered.body.data.credit).toMatchObject({ balanceCents: 0, status: 'settled' });
    const inflow = await api(f).get('/finance/management').expect(200);
    expect(inflow.body.data.payables.supplierCreditsCents).toBe(0);
    expect(inflow.body.data.receivables.receivedInPeriodCents).toBe(20000);
    await api(f)
      .post(`/supplier-credit-movements/${recovered.body.data.movement.id}/reversal`, {
        reason: 'Depósito devolvido',
      })
      .expect(200);
    const reversed = await api(f).get('/finance/management').expect(200);
    expect(reversed.body.data.receivables.receivedInPeriodCents).toBe(0);
    expect(reversed.body.data.payables.supplierCreditsCents).toBe(20000);
  });

  it('crédito respeita saldo e fornecedor', async () => {
    const { purchase } = await installmented();
    const partial = await received(purchase, '10');
    const done = await close(partial, 'supplier_credit');
    const creditId = done.body.data.closure.creditId as string;
    const foreign = await confirmed(
      f,
      [{ productId: await product(f), quantity: '1', unitCostCents: 1000 }],
      {},
      [30],
    );
    const [title] = await titles(foreign);
    const mismatch = await api(f).post(`/supplier-credits/${creditId}/applications`, {
      expectedVersion: 1,
      payableId: title!.id,
      amountCents: 100,
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('CREDIT_TITLE_MISMATCH');
    const above = await api(f).post(`/supplier-credits/${creditId}/recoveries`, {
      expectedVersion: 1,
      amountCents: 20001,
      recoveredOn: companyDay(),
    });
    expect(above.status).toBe(409);
    expect(above.body.error.code).toBe('CREDIT_EXCEEDS_BALANCE');
  });

  it('impede encerramento duplicado, inclusive simultâneo', async () => {
    const { purchase } = await installmented();
    const partial = await received(purchase, '10');
    const key = randomUUID();
    const first = await close(partial, 'supplier_credit', {}, key);
    expect(first.status).toBe(201);
    const impact = {
      expectedVersion: partial.version,
      treatment: 'supplier_credit',
      reason: 'Fornecedor não tem mais o produto',
      expectedUndeliveredCents: 20000,
      expectedExcessCents: 0,
    };
    const replay = await api(f).post(`/purchases/${purchase.id}/close`, impact, key);
    expect(replay.status).toBe(201);
    expect(replay.body.data.closure.id).toBe(first.body.data.closure.id);
    const again = await api(f).post(`/purchases/${purchase.id}/close`, {
      ...impact,
      expectedVersion: first.body.data.purchase.version,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PURCHASE_ALREADY_CLOSED');

    const other = await installmented();
    const next = await received(other.purchase, '10');
    const body = { ...impact, expectedVersion: next.version };
    const raced = await Promise.all([
      api(f).post(`/purchases/${other.purchase.id}/close`, body),
      api(f).post(`/purchases/${other.purchase.id}/close`, body),
      api(f).post(`/purchases/${other.purchase.id}/close`, body),
    ]);
    expect(raced.filter((r) => r.status === 201)).toHaveLength(1);
    const credits = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/supplierCredits`)
      .where('purchaseId', '==', other.purchase.id)
      .get();
    expect(credits.size).toBe(1);
  });

  it('recusa valores diferentes da prévia', async () => {
    const { purchase } = await installmented();
    const partial = await received(purchase, '10');
    const [first] = await titles(purchase);
    const impact = await preview(purchase.id, 'abatement');
    await pay(first!, 10000);
    await pay((await titles(purchase))[1]!, 10000);
    await pay((await titles(purchase))[2]!, 10000);
    const stale = await api(f).post(`/purchases/${purchase.id}/close`, {
      expectedVersion: partial.version,
      treatment: 'abatement',
      reason: 'Fornecedor não tem mais o produto',
      expectedUndeliveredCents: impact.undeliveredValueCents,
      expectedExcessCents: impact.excessCents,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CLOSURE_VALUES_CHANGED');
  });

  it('só aceita compra parcialmente recebida e congela o que veio depois', async () => {
    const { purchase } = await installmented();
    const waiting = await api(f).post(`/purchases/${purchase.id}/closure-preview`, {
      treatment: 'abatement',
    });
    expect(waiting.status).toBe(409);
    expect(waiting.body.error.code).toBe('INVALID_PURCHASE_STATE');
    const partial = await received(purchase, '10');
    const receipts = await api(f).get(`/purchases/${purchase.id}/receipts`).expect(200);
    const done = await close(partial, 'full_charge');
    const closed = done.body.data.purchase;
    const more = await receive(f, closed, [{ lineId: closed.lines[0].id, quantity: '1' }]);
    expect(more.status).toBe(409);
    expect(more.body.error.code).toBe('INVALID_PURCHASE_STATE');
    const reversal = await api(f).post(
      `/purchase-receipts/${receipts.body.data.items[0].id}/reversal`,
      { reason: 'Conferência errada' },
    );
    expect(reversal.status).toBe(409);
    expect(reversal.body.error.code).toBe('PURCHASE_CLOSED');
    const cancel = await api(f).post(`/purchases/${purchase.id}/cancel`, {
      expectedVersion: closed.version,
      reason: 'Tentativa de cancelar',
    });
    expect(cancel.status).toBe(409);
    const amend = await api(f).post(`/purchases/${purchase.id}/amendments`, {
      expectedVersion: closed.version,
      notes: 'Outra coisa',
      reason: 'Tentativa de alterar',
    });
    expect(amend.status).toBe(409);
  });

  it('recebimento acima do comprado continua recusado', async () => {
    const { purchase } = await installmented();
    const refused = await receive(f, purchase, [{ lineId: purchase.lines[0]!.id, quantity: '31' }]);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('RECEIPT_EXCEEDS_PENDING');
  });

  it('deixa rastro no histórico e na auditoria', async () => {
    const { purchase } = await installmented();
    const partial = await received(purchase, '10');
    await close(partial, 'abatement');
    const history = await api(f).get(`/purchases/${purchase.id}/history`).expect(200);
    expect(history.body.data.items[0]).toMatchObject({
      type: 'closed',
      previousStatus: 'partially_received',
      status: 'closed',
      reason: 'Fornecedor não tem mais o produto',
    });
    const audit = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/auditLogs`)
      .where('action', '==', 'purchase.closed')
      .get();
    expect(audit.size).toBe(1);
  });

  it('relatórios separam o que não foi entregue', async () => {
    const { purchase } = await installmented();
    const partial = await received(purchase, '10');
    await close(partial, 'abatement');
    const report = await api(f).get('/reports/purchases-supplier').expect(200);
    const row = report.body.data.rows[0].values ?? report.body.data.rows[0];
    expect(JSON.stringify(row)).toContain('20000');
    expect(
      report.body.data.summary.find((m: { key: string }) => m.key === 'undelivered'),
    ).toBeTruthy();
  });

  it('exige plano e permissão no backend', async () => {
    const { purchase } = await installmented();
    const partial = await received(purchase, '10');
    const person = await seller(f);
    const denied = await request(f.app)
      .post(`/api/v1/purchases/${purchase.id}/closure-preview`)
      .set(tenantHeaders(person, f.tenantA.tenant.id))
      .send({ treatment: 'abatement' });
    expect(denied.status).toBe(403);
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.tenant.id}`)
      .update({ planCode: 'essencial', userLimit: 1 });
    const blocked = await api(f).post(`/purchases/${partial.id}/closure-preview`, {
      treatment: 'abatement',
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    const credits = await api(f).get('/supplier-credits');
    expect(credits.status).toBe(403);
  });
});
