import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { registerFixture, bearer, subscriptionVersion } from '../helpers/fixture.js';
import { customerInput, seller, validAddress } from '../helpers/commercial.js';
import {
  api,
  available,
  companyDay,
  condition,
  confirmed,
  draft,
  gestao,
  method,
  product,
  receive,
  supplier,
} from '../helpers/management.js';

const f = registerFixture();
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe('Plano Gestão', () => {
  it('está no catálogo com 5 usuários e R$ 299', async () => {
    const catalog = await request(f.app)
      .get('/api/v1/admin/plan-catalog')
      .set(bearer(f.platform))
      .expect(200);
    const plan = catalog.body.data.items.find((p: { code: string }) => p.code === 'gestao');
    expect(plan).toMatchObject({ name: 'Gestão', referencePriceCents: 29900, userLimit: 5 });
  });
  it('Super Admin migra para Gestão e o acesso aos módulos é liberado', async () => {
    await api(f).get('/purchases').expect(403);
    const id = f.tenantA.subscription.id;
    await request(f.app)
      .post(`/api/v1/admin/subscriptions/${id}/plan`)
      .set(bearer(f.platform))
      .send({
        expectedVersion: await subscriptionVersion(f),
        planCode: 'gestao',
        acknowledgedLostFeatures: [],
        reason: 'Migração de teste',
      })
      .expect(200);
    const contract = await f.firebase.db.doc(`subscriptions/${id}`).get();
    expect(contract.get('userLimit')).toBe(5);
    await api(f).get('/purchases').expect(200);
    await api(f).get('/payables').expect(200);
    await api(f).get('/finance/management').expect(200);
  });
  it('Essencial e Profissional não acessam recursos exclusivos', async () => {
    const response = await api(f).get('/payables').expect(403);
    expect(response.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    for (const path of ['/purchases', '/recurring-expenses', '/finance/management', '/suppliers'])
      await api(f).get(path).expect(403);
    await api(f).get('/reports/cash-flow').expect(403);
    await api(f)
      .post('/customers', { ...customerInput, relationships: ['supplier'] })
      .expect(403);
  });
  it('downgrade preserva os dados e só bloqueia o acesso', async () => {
    await gestao(f);
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 1000 }]);
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ planCode: 'profissional', userLimit: 2 });
    await api(f).get(`/purchases/${purchase.id}`).expect(403);
    const stored = await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/purchases/${purchase.id}`)
      .get();
    expect(stored.exists).toBe(true);
    const titles = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/payables`)
      .where('originReference', '==', purchase.id)
      .get();
    expect(titles.size).toBe(3);
    await gestao(f);
    await api(f).get(`/purchases/${purchase.id}`).expect(200);
  });
});

describe('Cadastro unificado', () => {
  beforeEach(() => gestao(f));
  it('cliente passa a ser fornecedor sem novo cadastro', async () => {
    const created = await api(f).post('/customers', customerInput).expect(201);
    expect(created.body.data.relationships).toEqual(['customer']);
    const updated = await api(f)
      .patch(`/customers/${created.body.data.id}`, {
        relationships: ['customer', 'supplier'],
        expectedVersion: created.body.data.version,
      })
      .expect(200);
    expect(updated.body.data.relationships).toEqual(['customer', 'supplier']);
    const suppliers = await api(f).get('/customers?relationship=supplier').expect(200);
    expect(suppliers.body.data.items.map((c: { id: string }) => c.id)).toEqual([
      created.body.data.id,
    ]);
    const customers = await api(f).get('/customers').expect(200);
    expect(customers.body.data.items).toHaveLength(1);
  });
  it('empresa pode nascer cliente e fornecedor', async () => {
    const created = await api(f)
      .post('/customers', { ...customerInput, relationships: ['customer', 'supplier'] })
      .expect(201);
    expect(created.body.data.relationships).toEqual(['customer', 'supplier']);
  });
  it('não duplica CPF/CNPJ entre cliente e fornecedor', async () => {
    await api(f).post('/customers', customerInput).expect(201);
    const duplicate = await api(f)
      .post('/customers', { ...customerInput, relationships: ['supplier'] })
      .expect(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_DOCUMENT');
    const found = await api(f).get(`/customers?document=52998224725&relationship=all`).expect(200);
    expect(found.body.data.items).toHaveLength(1);
  });
  it('fornecedor puro não aparece como cliente nem entra em pedido', async () => {
    const vendor = await supplier(f);
    const customers = await api(f).get('/customers').expect(200);
    expect(customers.body.data.items).toEqual([]);
    const order = await api(f).post('/orders', { customerId: vendor.id }).expect(409);
    expect(order.body.error.code).toBe('CUSTOMER_INACTIVE');
  });
  it('relacionamento com histórico não pode ser removido', async () => {
    const productId = await product(f);
    const purchase = await draft(f, [{ productId, quantity: '1', unitCostCents: 100 }]);
    const vendor = await api(f).get(`/customers/${purchase.supplierId}`).expect(200);
    const response = await api(f)
      .patch(`/customers/${purchase.supplierId}`, {
        relationships: ['customer'],
        expectedVersion: vendor.body.data.version,
      })
      .expect(409);
    expect(response.body.error.code).toBe('RELATIONSHIP_IN_USE');
  });
  it('registro antigo sem relacionamento segue cliente', async () => {
    const created = await api(f).post('/customers', customerInput).expect(201);
    const ref = f.firebase.db.doc(
      `tenants/${f.tenantA.tenant.id}/customers/${created.body.data.id}`,
    );
    const legacy = { ...(await ref.get()).data() };
    delete legacy.relationships;
    delete legacy.isSupplier;
    delete legacy.contactName;
    await ref.set(legacy);
    const read = await api(f).get(`/customers/${created.body.data.id}`).expect(200);
    expect(read.body.data).toMatchObject({ relationships: ['customer'], contactName: null });
  });
});

describe('Custos dos produtos', () => {
  beforeEach(() => gestao(f));
  it('calcula lucro e margem sem tocar no preço', async () => {
    const productId = await product(f, 3500);
    const costs = await api(f)
      .patch(`/products/${productId}/costs`, { expectedVersion: 0, referenceCostCents: 1850 })
      .expect(200);
    expect(costs.body.data).toMatchObject({
      costBasis: 'reference',
      unitGrossProfitCents: 1650,
      grossMarginBp: 4714,
    });
    const read = await api(f).get(`/products/${productId}`).expect(200);
    expect(read.body.data.priceCents).toBe(3500);
    expect(read.body.data).not.toHaveProperty('referenceCostCents');
  });
  it('custo de referência vira sugestão, editável na compra', async () => {
    const productId = await product(f);
    await api(f)
      .patch(`/products/${productId}/costs`, { expectedVersion: 0, referenceCostCents: 1850 })
      .expect(200);
    const suggestion = await api(f).get(`/products/${productId}/cost-suggestion`).expect(200);
    expect(suggestion.body.data.suggestedUnitCostCents).toBe(1850);
    const purchase = await draft(f, [{ productId, quantity: '1', unitCostCents: 2000 }]);
    expect(purchase.lines[0]).toMatchObject({ suggestedUnitCostCents: 1850, unitCostCents: 2000 });
  });
  it('venda preserva o custo do momento', async () => {
    const productId = await product(f, 5000);
    const first = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 1000 }]);
    await receive(f, first, [{ lineId: first.lines[0]!.id, quantity: '10' }]).expect(201);
    const customer = await api(f).post('/customers', customerInput).expect(201);
    const created = await api(f)
      .post('/orders', {
        customerId: customer.body.data.id,
        lines: [{ productId, quantity: '2' }],
        payment: { type: 'cash', dueDates: [companyDay()] },
      })
      .expect(201);
    await api(f)
      .post(`/orders/${created.body.data.id}/confirm`, {
        expectedVersion: created.body.data.version,
      })
      .expect(200);
    const second = await confirmed(f, [{ productId, quantity: '8', unitCostCents: 9000 }]);
    await receive(f, second, [{ lineId: second.lines[0]!.id, quantity: '8' }]).expect(201);
    const snapshot = await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/orderCostSnapshots/${created.body.data.id}`)
      .get();
    expect(snapshot.get('costCents')).toBe(2000);
    const report = await api(f).get(`/reports/product-profitability`).expect(200);
    expect(report.body.data.rows[0].cells).toMatchObject({
      revenue: 10000,
      cost: 2000,
      gross: 8000,
      margin: 80,
    });
  });
  it('histórico registra custo de referência e recebimento', async () => {
    const productId = await product(f);
    await api(f)
      .patch(`/products/${productId}/costs`, { expectedVersion: 0, referenceCostCents: 100 })
      .expect(200);
    const purchase = await confirmed(f, [{ productId, quantity: '1', unitCostCents: 200 }]);
    await receive(f, purchase, [{ lineId: purchase.lines[0]!.id, quantity: '1' }]).expect(201);
    const history = await api(f).get(`/products/${productId}/cost-history`).expect(200);
    expect(history.body.data.items.map((e: { type: string }) => e.type)).toEqual([
      'purchase_received',
      'reference_updated',
    ]);
  });
});

describe('Compras', () => {
  beforeEach(() => gestao(f));
  it('um pedido com vários produtos calcula subtotais e total', async () => {
    const [a, b] = [await product(f), await product(f)];
    const purchase = await draft(
      f,
      [
        { productId: a, quantity: '50', unitCostCents: 1850 },
        { productId: b, quantity: '30', unitCostCents: 2000 },
      ],
      { freightCents: 5000, otherCostsCents: 1000, discountCents: 2000 },
    );
    expect(purchase.lines).toHaveLength(2);
    expect(purchase).toMatchObject({ status: 'draft', totalCents: 156500 });
  });
  it('numera as compras em sequência', async () => {
    const productId = await product(f);
    const lines = [{ productId, quantity: '1', unitCostCents: 100 }];
    const first = await draft(f, lines);
    const second = await draft(f, lines);
    expect((second as unknown as { number: number }).number).toBe(
      (first as unknown as { number: number }).number + 1,
    );
  });
  it('compra criada e confirmada não altera o estoque', async () => {
    const productId = await product(f);
    await confirmed(f, [{ productId, quantity: '10', unitCostCents: 100 }]);
    expect(await available(f, productId)).toBe('0');
  });
  it('usa condições existentes e parcela com arredondamento exato', async () => {
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '1', unitCostCents: 10000 }]);
    expect(purchase.installments.map((p) => p.amountCents)).toEqual([3334, 3333, 3333]);
    expect(purchase.installments.reduce((a, p) => a + p.amountCents, 0)).toBe(purchase.totalCents);
  });
  it('aceita parcelas ajustadas que somam o total e recusa as demais', async () => {
    const productId = await product(f);
    const purchase = await draft(f, [{ productId, quantity: '1', unitCostCents: 10000 }]);
    const dueDate = addDays(companyDay(), 10);
    const wrong = await api(f)
      .post(`/purchases/${purchase.id}/confirm`, {
        expectedVersion: purchase.version,
        installments: [{ amountCents: 9999, dueDate }],
      })
      .expect(422);
    expect(wrong.body.error.code).toBe('INSTALLMENTS_TOTAL_MISMATCH');
    await api(f)
      .post(`/purchases/${purchase.id}/confirm`, {
        expectedVersion: purchase.version,
        installments: [
          { amountCents: 4000, dueDate },
          { amountCents: 6000, dueDate: addDays(dueDate, 5) },
        ],
      })
      .expect(200);
  });
  it('confirmação repetida com a mesma chave não duplica títulos', async () => {
    const productId = await product(f);
    const purchase = await draft(f, [{ productId, quantity: '1', unitCostCents: 900 }]);
    const key = randomUUID();
    const body = { expectedVersion: purchase.version };
    await api(f).post(`/purchases/${purchase.id}/confirm`, body, key).expect(200);
    await api(f).post(`/purchases/${purchase.id}/confirm`, body, key).expect(200);
    const titles = await api(f).get(`/payables?originReference=${purchase.id}`).expect(200);
    expect(titles.body.data.items).toHaveLength(3);
  });
  it('confirmada não edita valores; reabrir cancela títulos e não duplica', async () => {
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '1', unitCostCents: 900 }]);
    await api(f)
      .patch(`/purchases/${purchase.id}`, { expectedVersion: purchase.version, freightCents: 1 })
      .expect(409);
    const reopened = await api(f)
      .post(`/purchases/${purchase.id}/reopen`, {
        expectedVersion: purchase.version,
        reason: 'Preço errado',
      })
      .expect(200);
    expect(reopened.body.data.status).toBe('draft');
    await api(f)
      .post(`/purchases/${purchase.id}/confirm`, { expectedVersion: reopened.body.data.version })
      .expect(200);
    const open = await api(f).get(`/payables?originReference=${purchase.id}`).expect(200);
    expect(open.body.data.items).toHaveLength(3);
    const canceled = await api(f)
      .get(`/payables?originReference=${purchase.id}&situation=canceled`)
      .expect(200);
    expect(canceled.body.data.items).toHaveLength(3);
  });
  it('previsão de entrega muda com motivo e histórico', async () => {
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '1', unitCostCents: 900 }]);
    await api(f)
      .post(`/purchases/${purchase.id}/amendments`, {
        expectedVersion: purchase.version,
        expectedDeliveryDate: addDays(companyDay(), 20),
        reason: 'Fornecedor atrasou',
      })
      .expect(200);
    const history = await api(f).get(`/purchases/${purchase.id}/history`).expect(200);
    expect(history.body.data.items[0]).toMatchObject({
      type: 'amended',
      reason: 'Fornecedor atrasou',
    });
  });
  describe('cancelamento', () => {
    it('sem recebimento nem pagamento cancela os títulos', async () => {
      const productId = await product(f);
      const purchase = await confirmed(f, [{ productId, quantity: '1', unitCostCents: 900 }]);
      await api(f)
        .post(`/purchases/${purchase.id}/cancel`, {
          expectedVersion: purchase.version,
          reason: 'Pedido desistido',
        })
        .expect(200);
      const titles = await api(f)
        .get(`/payables?originReference=${purchase.id}&situation=all`)
        .expect(200);
      expect(titles.body.data.items.every((t: { status: string }) => t.status === 'canceled')).toBe(
        true,
      );
    });
    it('com título pago é recusado até o estorno', async () => {
      const productId = await product(f);
      const purchase = await confirmed(f, [{ productId, quantity: '1', unitCostCents: 900 }]);
      const title = await api(f)
        .get(`/payables/${purchase.installments[0]!.payableId}`)
        .expect(200);
      const form = await method(f);
      const paid = await api(f)
        .post(`/payables/${title.body.data.id}/payments`, {
          expectedVersion: title.body.data.version,
          principalCents: 300,
          paidOn: companyDay(),
          methodId: form.id,
          methodVersion: form.version,
        })
        .expect(201);
      const refused = await api(f)
        .post(`/purchases/${purchase.id}/cancel`, {
          expectedVersion: purchase.version,
          reason: 'Pedido desistido',
        })
        .expect(409);
      expect(refused.body.error.code).toBe('PURCHASE_HAS_PAYMENTS');
      await api(f)
        .post(`/payable-payments/${paid.body.data.payment.id}/reversal`, { reason: 'Pago errado' })
        .expect(200);
      await api(f)
        .post(`/purchases/${purchase.id}/cancel`, {
          expectedVersion: purchase.version,
          reason: 'Pedido desistido',
        })
        .expect(200);
    });
    it('com recebimento é recusado e recebida não some', async () => {
      const productId = await product(f);
      const purchase = await confirmed(f, [{ productId, quantity: '1', unitCostCents: 900 }]);
      const received = await receive(f, purchase, [
        { lineId: purchase.lines[0]!.id, quantity: '1' },
      ]).expect(201);
      const refused = await api(f)
        .post(`/purchases/${purchase.id}/cancel`, {
          expectedVersion: received.body.data.purchase.version,
          reason: 'Pedido desistido',
        })
        .expect(409);
      expect(refused.body.error.code).toBe('PURCHASE_HAS_RECEIPTS');
    });
  });
});

describe('Recebimento e estoque', () => {
  beforeEach(() => gestao(f));
  it('recebimento parcial, sucessivo e completo', async () => {
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '100', unitCostCents: 1000 }]);
    const lineId = purchase.lines[0]!.id;
    const first = await receive(f, purchase, [{ lineId, quantity: '60' }]).expect(201);
    expect(first.body.data.purchase).toMatchObject({ status: 'partially_received' });
    expect(first.body.data.purchase.lines[0]).toMatchObject({
      receivedQuantity: '60',
      pendingQuantity: '40',
    });
    expect(await available(f, productId)).toBe('60');
    const pending = await api(f).get('/purchases?pendingReceipt=true').expect(200);
    expect(pending.body.data.items.map((p: { id: string }) => p.id)).toContain(purchase.id);
    const second = await receive(f, first.body.data.purchase, [{ lineId, quantity: '40' }]).expect(
      201,
    );
    expect(second.body.data.purchase).toMatchObject({ status: 'received', pendingReceipt: false });
    expect(await available(f, productId)).toBe('100');
    const movements = await api(f).get(`/inventory/movements?productId=${productId}`).expect(200);
    expect(movements.body.data.items).toHaveLength(2);
    expect(movements.body.data.items[0]).toMatchObject({
      type: 'STOCK_PURCHASE_ENTRY',
      origin: 'purchase',
    });
    const reconciled = await api(f).get(`/inventory/${productId}/reconciliation`).expect(200);
    expect(reconciled.body.data.consistent).toBe(true);
  });
  it('recusa receber acima do pendente', async () => {
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 1000 }]);
    const response = await receive(f, purchase, [
      { lineId: purchase.lines[0]!.id, quantity: '11' },
    ]).expect(409);
    expect(response.body.error.code).toBe('RECEIPT_EXCEEDS_PENDING');
    expect(await available(f, productId)).toBe('0');
  });
  it('recebimento repetido não duplica a entrada', async () => {
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 1000 }]);
    const items = [{ lineId: purchase.lines[0]!.id, quantity: '4' }];
    const key = randomUUID();
    await receive(f, purchase, items, key).expect(201);
    await receive(f, purchase, items, key).expect(201);
    await receive(f, purchase, items).expect(409);
    expect(await available(f, productId)).toBe('4');
  });
  it('recebimentos simultâneos respeitam o pendente', async () => {
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 1000 }]);
    const items = [{ lineId: purchase.lines[0]!.id, quantity: '6' }];
    const results = await Promise.all([receive(f, purchase, items), receive(f, purchase, items)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await available(f, productId)).toBe('6');
  });
  it('rateia frete e custo médio entre parciais sem duplicar', async () => {
    const productId = await product(f, 5000);
    const purchase = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 1000 }], {
      freightCents: 1000,
    });
    expect(purchase.totalCents).toBe(11000);
    const lineId = purchase.lines[0]!.id;
    const first = await receive(f, purchase, [{ lineId, quantity: '3' }]).expect(201);
    await receive(f, first.body.data.purchase, [{ lineId, quantity: '7' }]).expect(201);
    const costs = await api(f).get(`/products/${productId}/costs`).expect(200);
    expect(costs.body.data).toMatchObject({
      averageCostCents: 1100,
      lastPurchaseCostCents: 1100,
      referenceCostCents: 1100,
    });
    const titles = await api(f).get(`/payables?originReference=${purchase.id}`).expect(200);
    expect(
      titles.body.data.items.reduce(
        (a: number, t: { originalCents: number }) => a + t.originalCents,
        0,
      ),
    ).toBe(11000);
  });
  it('custo médio pondera compras diferentes e não muda o preço', async () => {
    const productId = await product(f, 5000);
    const first = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 1000 }]);
    await receive(f, first, [{ lineId: first.lines[0]!.id, quantity: '10' }]).expect(201);
    const second = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 2000 }]);
    await receive(f, second, [{ lineId: second.lines[0]!.id, quantity: '10' }]).expect(201);
    const costs = await api(f).get(`/products/${productId}/costs`).expect(200);
    expect(costs.body.data).toMatchObject({
      averageCostCents: 1500,
      lastPurchaseCostCents: 2000,
      referenceCostCents: 1000,
      priceCents: 5000,
    });
  });
  it('estorno devolve estoque, pendente e custo', async () => {
    const productId = await product(f, 5000);
    const first = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 1000 }]);
    await receive(f, first, [{ lineId: first.lines[0]!.id, quantity: '10' }]).expect(201);
    const second = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 2000 }]);
    const received = await receive(f, second, [
      { lineId: second.lines[0]!.id, quantity: '10' },
    ]).expect(201);
    const reversed = await api(f)
      .post(`/purchase-receipts/${received.body.data.receipt.id}/reversal`, {
        reason: 'Mercadoria devolvida',
      })
      .expect(200);
    expect(reversed.body.data.purchase).toMatchObject({ status: 'confirmed' });
    expect(reversed.body.data.receipt.status).toBe('reversed');
    expect(await available(f, productId)).toBe('10');
    const costs = await api(f).get(`/products/${productId}/costs`).expect(200);
    expect(costs.body.data).toMatchObject({ averageCostCents: 1000, lastPurchaseCostCents: 1000 });
    await api(f)
      .post(`/purchase-receipts/${received.body.data.receipt.id}/reversal`, {
        reason: 'De novo aqui',
      })
      .expect(409);
    const reconciled = await api(f).get(`/inventory/${productId}/reconciliation`).expect(200);
    expect(reconciled.body.data.consistent).toBe(true);
  });
  it('estorno recusa estoque já reservado', async () => {
    const productId = await product(f, 5000);
    const purchase = await confirmed(f, [{ productId, quantity: '2', unitCostCents: 1000 }]);
    const received = await receive(f, purchase, [
      { lineId: purchase.lines[0]!.id, quantity: '2' },
    ]).expect(201);
    const customer = await api(f).post('/customers', customerInput).expect(201);
    const order = await api(f)
      .post('/orders', {
        customerId: customer.body.data.id,
        lines: [{ productId, quantity: '2' }],
        payment: { type: 'cash', dueDates: [companyDay()] },
      })
      .expect(201);
    await api(f)
      .post(`/orders/${order.body.data.id}/confirm`, { expectedVersion: order.body.data.version })
      .expect(200);
    const refused = await api(f)
      .post(`/purchase-receipts/${received.body.data.receipt.id}/reversal`, {
        reason: 'Mercadoria devolvida',
      })
      .expect(409);
    expect(refused.body.error.code).toBe('INSUFFICIENT_STOCK');
  });
  describe('entrada avulsa', () => {
    it('continua funcionando sem compra, fornecedor ou justificativa', async () => {
      const productId = await product(f);
      const response = await api(f)
        .post('/inventory/entries', { productId, quantity: '10' })
        .expect(201);
      expect(response.body.data.movement).toMatchObject({
        type: 'STOCK_ENTRY',
        reason: 'Entrada avulsa',
        previousPhysical: '0',
        physical: '10',
        actorUid: f.ownerA.uid,
      });
      expect(await available(f, productId)).toBe('10');
    });
    it('não gera título nem altera o custo médio', async () => {
      const productId = await product(f, 5000);
      const purchase = await confirmed(f, [{ productId, quantity: '10', unitCostCents: 1000 }]);
      await receive(f, purchase, [{ lineId: purchase.lines[0]!.id, quantity: '10' }]).expect(201);
      const before = await api(f).get('/payables?situation=all').expect(200);
      await api(f).post('/inventory/entries', { productId, quantity: '10' }).expect(201);
      const after = await api(f).get('/payables?situation=all').expect(200);
      expect(after.body.data.items).toHaveLength(before.body.data.items.length);
      const costs = await api(f).get(`/products/${productId}/costs`).expect(200);
      expect(costs.body.data.averageCostCents).toBe(1000);
    });
    it('funciona nos planos inferiores', async () => {
      await f.firebase.db
        .doc(`subscriptions/${f.tenantA.subscription.id}`)
        .update({ planCode: 'essencial', userLimit: 1 });
      const productId = await product(f);
      await api(f).post('/inventory/entries', { productId, quantity: '1' }).expect(201);
    });
  });
});

describe('Contas a pagar', () => {
  beforeEach(() => gestao(f));
  async function expense(amountCents = 300000, dueDate = addDays(companyDay(), 10)) {
    const created = await api(f)
      .post('/payables', { kind: 'expense', description: 'Aluguel', amountCents, dueDate })
      .expect(201);
    return created.body.data as { id: string; version: number };
  }
  const pay = async (id: string, version: number, principalCents: number, extra: object = {}) => {
    const form = await method(f);
    return api(f).post(`/payables/${id}/payments`, {
      expectedVersion: version,
      principalCents,
      paidOn: companyDay(),
      methodId: form.id,
      methodVersion: form.version,
      ...extra,
    });
  };
  it('compra parcelada gera um título independente por parcela', async () => {
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '6', unitCostCents: 100000 }]);
    const titles = await api(f).get(`/payables?originReference=${purchase.id}`).expect(200);
    expect(titles.body.data.items.map((t: { originalCents: number }) => t.originalCents)).toEqual([
      200000, 200000, 200000,
    ]);
    expect(titles.body.data.items[0]).toMatchObject({
      origin: 'purchase',
      situation: 'open',
      installmentNumber: 1,
      installmentCount: 3,
    });
  });
  it('pagamento integral quita o título', async () => {
    const title = await expense();
    const paid = await await pay(title.id, title.version, 300000);
    expect(paid.status).toBe(201);
    expect(paid.body.data.payable).toMatchObject({
      status: 'paid',
      outstandingCents: 0,
      originalCents: 300000,
      paidOn: companyDay(),
    });
  });
  it('pagamento parcial mantém o valor original e o saldo', async () => {
    const title = await expense();
    const paid = await pay(title.id, title.version, 100000);
    expect(paid.body.data.payable).toMatchObject({
      status: 'partially_paid',
      originalCents: 300000,
      paidCents: 100000,
      outstandingCents: 200000,
    });
  });
  it('múltiplos pagamentos ficam no histórico próprio', async () => {
    const title = await expense();
    const first = await pay(title.id, title.version, 100000);
    await pay(title.id, first.body.data.payable.version, 200000);
    const list = await api(f).get(`/payable-payments?payableId=${title.id}`).expect(200);
    expect(list.body.data.items).toHaveLength(2);
  });
  it('juros, multa e desconto afetam o caixa, não o saldo', async () => {
    const title = await expense(10000);
    const paid = await pay(title.id, title.version, 10000, {
      interestCents: 200,
      penaltyCents: 100,
      discountCents: 50,
    });
    expect(paid.body.data.payment.cashCents).toBe(10250);
    expect(paid.body.data.payable.status).toBe('paid');
  });
  it('não permite pagar acima do saldo', async () => {
    const title = await expense(1000);
    const refused = await pay(title.id, title.version, 1001);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');
  });
  it('evita baixa duplicada por chave e por versão', async () => {
    const title = await expense(1000);
    const form = await method(f);
    const body = {
      expectedVersion: title.version,
      principalCents: 400,
      paidOn: companyDay(),
      methodId: form.id,
      methodVersion: form.version,
    };
    const key = randomUUID();
    await api(f).post(`/payables/${title.id}/payments`, body, key).expect(201);
    const replay = await api(f).post(`/payables/${title.id}/payments`, body, key).expect(201);
    expect(replay.body.data.payable.outstandingCents).toBe(600);
    await api(f).post(`/payables/${title.id}/payments`, body).expect(409);
  });
  it('título vencido é calculado e estorno reabre o saldo', async () => {
    const yesterday = addDays(companyDay(), -1);
    const title = await expense(1000, yesterday);
    const overdue = await api(f).get('/payables?situation=overdue').expect(200);
    expect(overdue.body.data.items[0]).toMatchObject({ id: title.id, situation: 'overdue' });
    const paid = await pay(title.id, title.version, 1000);
    expect(paid.body.data.payable.status).toBe('paid');
    const reversed = await api(f)
      .post(`/payable-payments/${paid.body.data.payment.id}/reversal`, { reason: 'Duplicado' })
      .expect(200);
    expect(reversed.body.data.payable).toMatchObject({
      status: 'open',
      situation: 'overdue',
      outstandingCents: 1000,
    });
    expect(reversed.body.data.payment).toMatchObject({
      status: 'reversed',
      reversalReason: 'Duplicado',
    });
    await api(f)
      .post(`/payable-payments/${paid.body.data.payment.id}/reversal`, { reason: 'De novo' })
      .expect(409);
    const list = await api(f).get(`/payable-payments?payableId=${title.id}`).expect(200);
    expect(list.body.data.items).toHaveLength(1);
  });
  it('título de compra só corrige vencimento e cancela pela compra', async () => {
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '1', unitCostCents: 900 }]);
    const id = purchase.installments[0]!.payableId;
    const title = await api(f).get(`/payables/${id}`).expect(200);
    await api(f)
      .patch(`/payables/${id}`, {
        expectedVersion: title.body.data.version,
        amountCents: 1,
        reason: 'Tentativa',
      })
      .expect(409);
    await api(f)
      .post(`/payables/${id}/cancel`, { expectedVersion: title.body.data.version, reason: 'Teste' })
      .expect(409);
    await api(f)
      .patch(`/payables/${id}`, {
        expectedVersion: title.body.data.version,
        dueDate: addDays(companyDay(), 45),
        reason: 'Renegociado',
      })
      .expect(200);
  });
  it('cancelamento recusa título com pagamento', async () => {
    const title = await expense(1000);
    const paid = await pay(title.id, title.version, 100);
    const refused = await api(f)
      .post(`/payables/${title.id}/cancel`, {
        expectedVersion: paid.body.data.payable.version,
        reason: 'Teste',
      })
      .expect(409);
    expect(refused.body.error.code).toBe('PAYABLE_HAS_PAYMENTS');
  });
});

describe('Despesas recorrentes', () => {
  beforeEach(() => gestao(f));
  const internet = (extra: object = {}) => ({
    description: 'Internet',
    amountCents: 15900,
    frequency: 'monthly',
    dueDay: 10,
    startDate: addDays(companyDay(), -40),
    ...extra,
  });
  it('gera títulos sem duplicar em execuções repetidas', async () => {
    const created = await api(f).post('/recurring-expenses', internet()).expect(201);
    const first = await api(f)
      .get(`/payables?originReference=${created.body.data.id}&situation=all`)
      .expect(200);
    expect(first.body.data.items.length).toBeGreaterThan(0);
    await api(f).post('/recurring-expenses/generate').expect(200);
    const repeated = await Promise.all([
      api(f).post('/recurring-expenses/generate'),
      api(f).post('/recurring-expenses/generate'),
    ]);
    expect(repeated.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const after = await api(f)
      .get(`/payables?originReference=${created.body.data.id}&situation=all`)
      .expect(200);
    expect(after.body.data.items).toHaveLength(first.body.data.items.length);
    expect(after.body.data.items[0]).toMatchObject({ origin: 'recurring', originalCents: 15900 });
  });
  it('alteração vale para o futuro e preserva títulos pagos', async () => {
    const created = await api(f).post('/recurring-expenses', internet()).expect(201);
    const titles = await api(f)
      .get(`/payables?originReference=${created.body.data.id}&situation=all`)
      .expect(200);
    const past = titles.body.data.items[0];
    const form = await method(f);
    await api(f)
      .post(`/payables/${past.id}/payments`, {
        expectedVersion: past.version,
        principalCents: past.originalCents,
        paidOn: companyDay(),
        methodId: form.id,
        methodVersion: form.version,
      })
      .expect(201);
    await api(f)
      .patch(`/recurring-expenses/${created.body.data.id}`, {
        expectedVersion: created.body.data.version,
        amountCents: 19900,
      })
      .expect(200);
    const paid = await api(f).get(`/payables/${past.id}`).expect(200);
    expect(paid.body.data.originalCents).toBe(15900);
    const stored = await api(f).get(`/recurring-expenses/${created.body.data.id}`).expect(200);
    expect(stored.body.data.amountCents).toBe(19900);
  });
  it('pausar interrompe; retomar não cobra o período pausado', async () => {
    const created = await api(f).post('/recurring-expenses', internet()).expect(201);
    const paused = await api(f)
      .post(`/recurring-expenses/${created.body.data.id}/commands`, {
        expectedVersion: created.body.data.version,
        action: 'pause',
      })
      .expect(200);
    expect(paused.body.data).toMatchObject({ status: 'paused', nextDueDate: null });
    const resumed = await api(f)
      .post(`/recurring-expenses/${created.body.data.id}/commands`, {
        expectedVersion: paused.body.data.version,
        action: 'resume',
      })
      .expect(200);
    const ended = await api(f)
      .post(`/recurring-expenses/${created.body.data.id}/commands`, {
        expectedVersion: resumed.body.data.version,
        action: 'end',
      })
      .expect(200);
    expect(ended.body.data.status).toBe('ended');
  });
  it('categorias personalizadas e sugeridas sem repetição', async () => {
    const custom = await api(f).post('/expense-categories', { name: 'Frota' }).expect(201);
    await api(f).post('/expense-categories', { name: 'frota' }).expect(409);
    const seeded = await api(f).post('/expense-categories/seed').expect(200);
    expect(seeded.body.data.created).toBe(8);
    const again = await api(f).post('/expense-categories/seed').expect(200);
    expect(again.body.data.created).toBe(0);
    const expense = await api(f)
      .post('/payables', {
        kind: 'expense',
        description: 'Pneus',
        amountCents: 1000,
        dueDate: companyDay(),
        categoryId: custom.body.data.id,
      })
      .expect(201);
    expect(expense.body.data.categoryName).toBe('Frota');
  });
});

describe('Financeiro consolidado', () => {
  beforeEach(() => gestao(f));
  it('título em aberto é previsão; pagamento é caixa; compra não vira despesa', async () => {
    const today = companyDay();
    const productId = await product(f, 5000);
    const purchase = await confirmed(
      f,
      [{ productId, quantity: '10', unitCostCents: 1000 }],
      {},
      [0],
    );
    await receive(f, purchase, [{ lineId: purchase.lines[0]!.id, quantity: '10' }]).expect(201);
    const expense = await api(f)
      .post('/payables', {
        kind: 'expense',
        description: 'Energia',
        amountCents: 2000,
        dueDate: addDays(today, 3),
      })
      .expect(201);
    const customer = await api(f).post('/customers', customerInput).expect(201);
    const order = await api(f)
      .post('/orders', {
        customerId: customer.body.data.id,
        lines: [{ productId, quantity: '1' }],
        payment: { type: 'cash', dueDates: [today] },
      })
      .expect(201);
    await api(f)
      .post(`/orders/${order.body.data.id}/confirm`, { expectedVersion: order.body.data.version })
      .expect(200);
    const before = (await api(f).get('/finance/management').expect(200)).body.data;
    expect(before.payables).toMatchObject({ openCents: 12000, paidInPeriodCents: 0 });
    expect(before.receivables).toMatchObject({ openCents: 5000, receivedInPeriodCents: 0 });
    expect(before.cash.periodBalanceCents).toBe(0);
    expect(before.profitability).toMatchObject({
      revenueCents: 5000,
      cogsCents: 1000,
      grossProfitCents: 4000,
      grossMarginBp: 8000,
      operatingExpensesCents: 2000,
      estimatedResultCents: 2000,
    });
    const form = await method(f);
    await api(f)
      .post(`/payables/${expense.body.data.id}/payments`, {
        expectedVersion: expense.body.data.version,
        principalCents: 2000,
        paidOn: today,
        methodId: form.id,
        methodVersion: form.version,
      })
      .expect(201);
    const after = (await api(f).get('/finance/management').expect(200)).body.data;
    expect(after.payables).toMatchObject({ openCents: 10000, paidInPeriodCents: 2000 });
    expect(after.cash.periodBalanceCents).toBe(-2000);
    expect(after.profitability.operatingExpensesCents).toBe(2000);
    expect(after.cash.balanceCents).toBeNull();
  });
  it('saldo de caixa parte do valor informado', async () => {
    await api(f)
      .put('/finance/settings', {
        expectedVersion: 0,
        openingBalanceCents: 100000,
        openingDate: companyDay(),
      })
      .expect(200);
    const view = (await api(f).get('/finance/management').expect(200)).body.data;
    expect(view.cash).toMatchObject({ balanceCents: 100000, openingDate: companyDay() });
  });
  it('estados vazios não inventam valores', async () => {
    const view = (await api(f).get('/finance/management').expect(200)).body.data;
    expect(view.payables.openCents).toBe(0);
    expect(view.profitability).toMatchObject({ revenueCents: 0, grossMarginBp: null });
    expect(view.realized.length).toBeGreaterThan(0);
  });
  it('relatórios gerenciais respondem com a infraestrutura existente', async () => {
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '2', unitCostCents: 1000 }]);
    await receive(f, purchase, [{ lineId: purchase.lines[0]!.id, quantity: '2' }]).expect(201);
    const wide = `from=${addDays(companyDay(), -30)}&to=${addDays(companyDay(), 100)}`;
    for (const [report, rows] of [
      ['payables-period', 3],
      ['payables-supplier', 1],
      ['payables-overdue', 0],
      ['payable-payments', 0],
      ['purchases-supplier', 1],
      ['purchases-product', 1],
      ['cost-evolution', 1],
      ['product-profitability', 0],
      ['expenses-category', 0],
    ] as const) {
      const range =
        report === 'payables-overdue'
          ? ''
          : `?${wide.replace(addDays(companyDay(), 100), companyDay())}`;
      const query =
        report === 'payables-period' || report === 'payables-supplier' ? `?${wide}` : range;
      const response = await api(f).get(`/reports/${report}${query}`).expect(200);
      expect(response.body.data.rows).toHaveLength(rows);
      expect(response.body.data.category).toBe('management');
    }
    const flow = await api(f).get('/reports/cash-flow').expect(200);
    expect(flow.body.data.chart.points.length).toBeGreaterThan(0);
    const csv = await api(f).get(`/reports/purchases-supplier/export.csv`).expect(200);
    expect(csv.text).toContain('Fornecedor');
  });
});

describe('Segurança', () => {
  beforeEach(() => gestao(f));
  const grant = async (uid: string, operations: string[]) => {
    const version = (
      await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}/memberships/${uid}`).get()
    ).get('version') as number;
    return api(f).patch(`/users/${uid}/permissions`, { operations, expectedVersion: version });
  };
  it('vendedor não acessa custos, compras nem financeiro restrito', async () => {
    const user = await seller(f);
    const productId = await product(f);
    const client = api(f, f.tenantA.tenant.id, user);
    for (const path of [
      `/products/${productId}/costs`,
      '/purchases',
      '/payables',
      '/finance/management',
      '/recurring-expenses',
      '/payable-payments',
    ]) {
      const response = await client.get(path);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
    const product_ = await client.get(`/products/${productId}`).expect(200);
    expect(JSON.stringify(product_.body.data)).not.toMatch(/[Cc]ost/);
  });
  it('autorização explícita libera o custo ao vendedor', async () => {
    const user = await seller(f);
    const productId = await product(f);
    await grant(user.uid, ['products.view', 'costs.view']).then((r) => expect(r.status).toBe(200));
    await api(f, f.tenantA.tenant.id, user).get(`/products/${productId}/costs`).expect(200);
  });
  it('compras sem custos é recusada na concessão', async () => {
    const user = await seller(f);
    const response = await grant(user.uid, ['purchases.view']);
    expect(response.status).toBe(422);
  });
  it('vendedor não vê fornecedor na carteira', async () => {
    const user = await seller(f);
    const vendor = await supplier(f);
    await api(f, f.tenantA.tenant.id, user).get(`/customers/${vendor.id}`).expect(404);
    await api(f, f.tenantA.tenant.id, user).get('/customers?relationship=supplier').expect(403);
  });
  it('uma empresa não acessa dados de outra', async () => {
    await gestao(f, f.tenantB.tenant.id);
    const productId = await product(f);
    const purchase = await confirmed(f, [{ productId, quantity: '1', unitCostCents: 100 }]);
    const titleId = purchase.installments[0]!.payableId;
    const other = api(f, f.tenantB.tenant.id, f.ownerB);
    await other.get(`/purchases/${purchase.id}`).expect(404);
    await other.get(`/payables/${titleId}`).expect(404);
    await other.get(`/products/${productId}/costs`).expect(404);
    const list = await other.get('/purchases').expect(200);
    expect(list.body.data.items).toEqual([]);
    await other.post('/purchases', { supplierId: purchase.lines[0]!.productId }).expect(422);
    await request(f.app)
      .get('/api/v1/purchases')
      .set({ ...bearer(f.ownerB), 'X-Tenant-Id': f.tenantA.tenant.id })
      .expect(403);
  });
  it('fornecedor exige o endereço do cadastro existente', async () => {
    await api(f)
      .post('/customers', { name: 'Sem endereço', relationships: ['supplier'] })
      .expect(422);
    await api(f)
      .post('/customers', {
        name: 'Com endereço',
        address: validAddress,
        relationships: ['supplier'],
      })
      .expect(201);
    await condition(f);
  });
});
