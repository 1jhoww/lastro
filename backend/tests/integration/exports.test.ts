import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { registerFixture, bearer, tenantHeaders } from '../helpers/fixture.js';
import { seller, productInput, validAddress } from '../helpers/commercial.js';
import { orderHeaders, draft, confirm, orderDocs } from '../helpers/orders.js';
import { financialOrder, financePost, receiptBody } from '../helpers/finance.js';
import { CustomerService } from '../../src/modules/customers/customerService.js';
import { searchKey } from '../../src/shared/schemas/commercial.js';

const f = registerFixture({ rateLimitMax: 10000 });
afterEach(() => vi.restoreAllMocks());
const csv = (
  resource: string,
  query: object = {},
  user = f.ownerA,
  tenantId = f.tenantA.tenant.id,
) =>
  request(f.app)
    .get(`/api/v1/exports/${resource}.csv`)
    .query(query)
    .set(tenantHeaders(user, tenantId));
describe('CSV administrativo G nos emuladores', () => {
  it('expõe metadados de download apenas no CORS privado autorizado', async () => {
    const response = await csv('customers').set('Origin', f.config.corsOrigins[0]!).expect(200);
    const headers = response.headers['access-control-expose-headers'];
    expect(headers).toContain('Content-Disposition');
    expect(headers).toContain('X-Next-Cursor');
    expect(headers).toContain('X-Export-Row-Count');
    await csv('customers').set('Origin', 'https://untrusted.example.invalid').expect(403);
  });
  it('exporta centenas de clientes em páginas, com BOM/cursor e sem campos internos', async () => {
    const customer = (
      await request(f.app)
        .post('/api/v1/customers')
        .set(orderHeaders(f))
        .send({ address: validAddress, name: 'Cliente 000', notes: 'Comercial' })
        .expect(201)
    ).body.data;
    const original = (await orderDocs(f, 'customers').doc(customer.id).get()).data()!;
    const batch = f.firebase.db.batch();
    for (let i = 1; i < 230; i++) {
      const name = `Cliente ${String(i).padStart(3, '0')}`,
        id = `csv-customer-${i}`;
      batch.set(orderDocs(f, 'customers').doc(id), {
        ...original,
        id,
        name,
        nameKey: searchKey(name),
      });
    }
    await batch.commit();
    let cursor: string | undefined,
      count = 0,
      pages = 0;
    do {
      const page = await csv('customers', { limit: '100', ...(cursor ? { cursor } : {}) }).expect(
        200,
      );
      expect(page.headers['content-type']).toContain('text/csv; charset=utf-8');
      expect(page.headers['content-disposition']).toBe('attachment; filename="clientes.csv"');
      expect(page.text.charCodeAt(0)).toBe(0xfeff);
      const rows = Number(page.headers['x-export-row-count']);
      expect(rows).toBeLessThanOrEqual(100);
      count += rows;
      pages++;
      for (const secret of [f.tenantA.tenant.id, 'createdBy', 'assignedTo', 'schemaVersion'])
        expect(page.text).not.toContain(secret);
      cursor = page.headers['x-next-cursor'];
    } while (cursor);
    expect(count).toBe(230);
    expect(pages).toBe(3);
  });
  it.each(['customers', 'products', 'orders', 'receivables'])(
    'nega vendedor, plataforma e empresa alheia em %s',
    async (resource) => {
      const user = await seller(f);
      await csv(resource, {}, user).expect(403);
      await csv(resource, {}, f.platform).expect(403);
      await csv(resource, {}, f.ownerB).expect(403);
      await request(f.app).get(`/api/v1/exports/${resource}.csv`).expect(401);
    },
  );
  it('neutraliza fórmulas e mantém filtros explícitos por situação e nome', async () => {
    await request(f.app)
      .post('/api/v1/customers')
      .set(orderHeaders(f))
      .send({
        name: '=HYPERLINK("https://example.invalid")',
        notes: '+SUM(1;2)',
        tradeName: '@SUM(1)',
        address: { ...validAddress, street: '-1+1' },
      })
      .expect(201);
    await request(f.app)
      .post('/api/v1/customers')
      .set(orderHeaders(f))
      .send({ address: validAddress, name: 'Outro cliente' })
      .expect(201);
    const page = await csv('customers', { q: '=hyperlink', status: 'active' }).expect(200);
    expect(page.headers['x-export-row-count']).toBe('1');
    expect(page.text).toContain('"\'=HYPERLINK');
    expect(page.text).toContain('"\'+SUM');
    expect(page.text).toContain('"\'@SUM');
    expect(page.text).toContain('"\'-1+1');
    expect(page.text).not.toContain('Outro cliente');
  });
  it('exporta produto com nome da categoria, preço atual e nenhuma informação de estoque', async () => {
    const category = (
      await request(f.app)
        .post('/api/v1/categories')
        .set(orderHeaders(f))
        .send({ name: 'Categoria São José' })
        .expect(201)
    ).body.data;
    await request(f.app)
      .post('/api/v1/products')
      .set(orderHeaders(f))
      .send({
        ...productInput('CSV-PRODUTO'),
        name: 'Ação; produto "especial"',
        categoryId: category.id,
        priceCents: 1205,
      })
      .expect(201);
    const page = await csv('products', { categoryId: category.id }).expect(200);
    expect(page.text).toContain('Categoria São José');
    expect(page.text).toContain('"12,05"');
    expect(page.text).toContain('"CSV-PRODUTO"');
    expect(page.text).not.toContain('minimumStock');
    expect(page.text).not.toContain('image');
  });
  it('exporta pedido histórico após alteração de preço e nome', async () => {
    const order = await confirm(f, await draft(f));
    await request(f.app)
      .patch(`/api/v1/products/${order.lines[0]!.productId}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1, priceCents: 99999 })
      .expect(200);
    await request(f.app)
      .patch(`/api/v1/customers/${order.customerId}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1, name: 'Cliente modificado' })
      .expect(200);
    const page = await csv('orders', { customerId: order.customerId, status: 'confirmed' }).expect(
      200,
    );
    expect(page.text).toContain(order.commercialId);
    expect(page.text).toContain(order.customerName!);
    expect(page.text).toContain('"20,50"');
    expect(page.text).not.toContain('999,99');
    expect(page.text).not.toContain('Cliente modificado');
  });
  it('exporta saldo financeiro derivado após recebimento parcial, sem pagamentos internos', async () => {
    const setup = await financialOrder(f);
    await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 500),
    ).expect(200);
    const page = await csv('receivables', { orderId: setup.order.id }).expect(200);
    expect(page.text).toContain(setup.order.commercialId);
    expect(page.text).toContain('"20,50"');
    expect(page.text).toContain('"15,50"');
    expect(page.text).not.toContain('basisHash');
    expect(page.text).not.toContain('cashCents');
    const filter = await csv('receivables', { orderId: setup.order.id, status: 'open' }).expect(
      200,
    );
    expect(filter.headers['x-export-row-count']).toBe('0');
  });
  it('rejeita filtros/cursor adulterado e não aceita coleção global', async () => {
    await csv('orders', { limit: '11' }).expect(422);
    await csv('customers', { limit: '101' }).expect(422);
    await csv('customers', { tenantId: f.tenantB.tenant.id }).expect(422);
    await csv('products', { cursor: 'cursor-forjado' }).expect(422);
    await csv('subscriptions').expect(404);
  });
  it('cursor está ligado ao tenant, filtros e usuário', async () => {
    await request(f.app)
      .post('/api/v1/customers')
      .set(orderHeaders(f))
      .send({ address: validAddress, name: 'Cliente A' })
      .expect(201);
    await request(f.app)
      .post('/api/v1/customers')
      .set(orderHeaders(f))
      .send({ address: validAddress, name: 'Cliente B' })
      .expect(201);
    const cursor = (await csv('customers', { limit: '1' }).expect(200)).headers['x-next-cursor'];
    expect(cursor).toBeTruthy();
    await csv('customers', { limit: '1', cursor }, f.ownerB, f.tenantB.tenant.id).expect(422);
    await csv('customers', { limit: '1', cursor, q: 'cliente' }).expect(422);
  });
  it('revalida permissão depois de compor exportação', async () => {
    const original = CustomerService.prototype.list;
    vi.spyOn(CustomerService.prototype, 'list').mockImplementation(async function (
      this: CustomerService,
      ...args
    ) {
      const page = await original.apply(this, args);
      await f.firebase.db
        .doc(`tenants/${f.tenantA.tenant.id}/memberships/${f.ownerA.uid}`)
        .update({ status: 'disabled' });
      return page;
    });
    await csv('customers').expect(403);
  });
  it('rejeita arquivo que ultrapassa orçamento de tempo e libera capacidade', async () => {
    const original = CustomerService.prototype.list;
    const start = performance.now();
    vi.spyOn(CustomerService.prototype, 'list').mockImplementation(async function (
      this: CustomerService,
      ...args
    ) {
      const page = await original.apply(this, args);
      vi.spyOn(performance, 'now').mockReturnValue(start + 31_000);
      return page;
    });
    const result = await csv('customers').expect(413);
    expect(result.body.error.code).toBe('EXPORT_TIME_LIMIT');
    vi.restoreAllMocks();
    await csv('customers').expect(200);
  });
  it('limita duas exportações simultâneas sem fila ilimitada', async () => {
    const original = CustomerService.prototype.list;
    let started!: () => void,
      release!: () => void,
      count = 0;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(CustomerService.prototype, 'list').mockImplementation(async function (
      this: CustomerService,
      ...args
    ) {
      const page = await original.apply(this, args);
      if (++count === 2) started();
      await hold;
      return page;
    });
    const a = csv('customers')
        .expect(200)
        .then((r) => r.status),
      b = csv('customers')
        .expect(200)
        .then((r) => r.status);
    try {
      await ready;
      await csv('customers').expect(429);
    } finally {
      release();
    }
    expect(await Promise.all([a, b])).toEqual([200, 200]);
    vi.restoreAllMocks();
    await csv('customers').expect(200);
  });
  it('aplica cota compartilhada de trinta downloads por usuário/hora', async () => {
    for (let i = 0; i < 30; i++) await csv('products').expect(200);
    const last = await csv('customers').expect(429);
    // Seconds until the clock hour turns, when the counter resets.
    const retry = Number(last.headers['retry-after']);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(3600);
    expect(last.body.error.code).toBe('RATE_LIMITED');
  });
  it('downloads não alteram documentos comerciais, estoque ou financeiro', async () => {
    const setup = await financialOrder(f);
    const snapshot = async () =>
      JSON.stringify(
        await Promise.all(
          ['orders', 'inventory', 'receivables', 'financialTitles', 'payments', 'auditLogs'].map(
            async (c) => (await orderDocs(f, c).get()).docs.map((d) => d.data()),
          ),
        ),
      );
    const before = await snapshot();
    for (const resource of ['customers', 'products', 'orders', 'receivables'])
      await csv(resource).expect(200);
    expect(await snapshot()).toBe(before);
    expect(setup.order.totalCents).toBe(2050);
  });
  it('administração existente mantém duas vagas, contrato histórico, auditoria e ausência de acesso comercial', async () => {
    expect(f.tenantA.subscription).toMatchObject({ planCode: 'profissional', userLimit: 2 });
    await request(f.app)
      .post(`/api/v1/admin/subscriptions/${f.tenantB.subscription.id}/terms`)
      .set(bearer(f.platform))
      .send({ expectedVersion: 1, monthlyPriceCents: 21000, reason: 'Condição de outra empresa' })
      .expect(200);
    const subscriptions = await request(f.app)
      .get('/api/v1/admin/subscriptions')
      .set(bearer(f.platform))
      .expect(200);
    expect(
      subscriptions.body.data.items.find((s: { id: string }) => s.id === f.tenantA.subscription.id)
        .monthlyPriceCents,
    ).toBe(19900);
    const tenants = await request(f.app)
      .get('/api/v1/admin/tenants')
      .set(bearer(f.platform))
      .expect(200);
    expect(tenants.body.data.items).toHaveLength(2);
    const audits = (await f.firebase.db.collection('auditLogs').get()).docs.map(
      (d) => d.data().action,
    );
    expect(audits).toContain('subscription.terms.updated');
    expect(audits).toContain('tenant.created');
    await request(f.app).get('/api/v1/admin/plans').set(bearer(f.ownerA)).expect(403);
    await request(f.app).get('/api/v1/admin/plan-catalog').set(bearer(f.ownerA)).expect(403);
    await csv('orders', {}, f.platform).expect(403);
  });
});
