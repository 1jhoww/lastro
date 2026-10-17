import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { registerFixture, tenantHeaders, type TestUser } from '../helpers/fixture.js';
import { seller } from '../helpers/commercial.js';
import { command, confirm, draft } from '../helpers/orders.js';
import { financialOrder, financePost, receiptBody } from '../helpers/finance.js';
import { pdfText } from '../helpers/documents.js';
import { reportView } from '../../src/shared/schemas/reports.js';
import { orderView } from '../../src/shared/schemas/orders.js';

const f = registerFixture({ rateLimitMax: 10000 });
const report = (
  id: string,
  query: object = {},
  user: TestUser = f.ownerA,
  tenantId = f.tenantA.tenant.id,
) => request(f.app).get(`/api/v1/reports/${id}`).query(query).set(tenantHeaders(user, tenantId));
const view = async (id: string, query: object = {}) =>
  reportView.parse((await report(id, query).expect(200)).body.data);
const metric = (v: ReturnType<typeof reportView.parse>, key: string) =>
  v.summary.find((m) => m.key === key)?.value;

describe('Relatórios da Fase 6 nos emuladores', () => {
  it('vendas contam só pedidos confirmados/expedidos e não se confundem com recebimentos', async () => {
    const { order, method } = await financialOrder(f);
    await draft(f);
    const canceled = await confirm(f, await draft(f));
    await command(f, canceled, 'cancel').expect(200);

    const sales = await view('sales-period');
    expect(metric(sales, 'orders')).toBe(1);
    expect(metric(sales, 'net')).toBe(order.totalCents);
    expect(metric(sales, 'canceled')).toBe(1);
    expect(sales.period?.basis).toContain('confirmação');
    expect(sales.company).toBe('Empresa A');

    expect(metric(await view('receipts'), 'net')).toBe(0);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, method, 700),
    ).expect(200);
    const receipts = await view('receipts');
    expect(metric(receipts, 'net')).toBe(700);
    expect(receipts.rows).toHaveLength(1);
    expect(receipts.rows[0]!.cells.order).toBe(order.commercialId.slice(0, 12));
    // Money received never changes the sales figure.
    expect(metric(await view('sales-period'), 'net')).toBe(order.totalCents);

    const status = await view('orders-status');
    expect(metric(status, 'draft')).toBe(1);
    expect(metric(status, 'confirmed')).toBe(1);
    expect(metric(status, 'canceled')).toBe(1);
    expect((await view('orders-status', { status: 'canceled' })).rows).toHaveLength(1);

    const products = await view('sales-products');
    expect(products.rows).toHaveLength(1);
    expect(products.rows[0]!.cells.net).toBe(order.totalCents);
    const customers = await view('sales-customers');
    expect(customers.rows[0]!.cells.net).toBe(order.totalCents);
    expect(customers.rows[0]!.link).toEqual({ kind: 'customer', id: order.customerId });
  });

  it('contas a receber separam recebido, aberto e vencido', async () => {
    const { order, method } = await financialOrder(f);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, method, 300),
    ).expect(200);
    const due = order.installments.map((i) => i.dueDate).sort();
    const titles = await view('receivables', { from: due[0], to: due.at(-1) });
    expect(metric(titles, 'original')).toBe(order.totalCents);
    expect(metric(titles, 'cash')).toBe(300);
    expect(metric(titles, 'outstanding')).toBe(order.totalCents - 300);
    expect(titles.rows.length).toBe(order.installments.length);
    await report('receivables', { from: '2020-01-01', to: '2022-01-01' }).expect(422);
  });

  it('estoque mostra posição real e movimentações registradas', async () => {
    const order = await draft(f, f.ownerA, { quantity: '4' });
    const confirmed = await confirm(f, order);
    const productId = confirmed.lines[0]!.productId;
    const position = await view('stock-position', { productId });
    expect(position.rows[0]!.cells).toMatchObject({
      physical: '10',
      reserved: '4',
      available: '6',
    });
    const moves = await view('stock-movements', { productId });
    expect(moves.rows.map((r) => r.cells.type).sort()).toEqual(['Entrada', 'Reserva de pedido']);
    expect((await view('stock-movements', { productId, movement: 'exits' })).rows).toHaveLength(0);
    await command(f, confirmed, 'dispatch').expect(200);
    expect((await view('stock-movements', { productId, movement: 'exits' })).rows).toHaveLength(1);
  });

  it('isola empresas e nega vendedor, plataforma e sem autenticação', async () => {
    await financialOrder(f);
    const user = await seller(f);
    for (const id of ['sales-period', 'receivables', 'stock-position']) {
      await report(id, {}, user).expect(403);
      await report(id, {}, f.platform).expect(403);
      await report(id, {}, f.ownerB).expect(403);
      await request(f.app).get(`/api/v1/reports/${id}`).expect(401);
    }
    const other = reportView.parse(
      (await report('sales-period', {}, f.ownerB, f.tenantB.tenant.id).expect(200)).body.data,
    );
    expect(other.company).toBe('Empresa B');
    expect(metric(other, 'orders')).toBe(0);
    await request(f.app)
      .get('/api/v1/reports/sales-period/export.csv')
      .set(tenantHeaders(user, f.tenantA.tenant.id))
      .expect(403);
    await report('nao-existe').expect(422);
    await report('stock-position', { from: '2026-01-01' }).expect(422);
  });

  it('exporta todas as linhas em CSV e PDF com empresa, período e nome claro', async () => {
    const { order } = await financialOrder(f);
    const csv = await request(f.app)
      .get('/api/v1/reports/orders-status/export.csv')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
    expect(csv.headers['content-disposition']).toMatch(
      /^attachment; filename="pedidos-por-status_empresa-a_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('"Empresa";"Empresa A"');
    expect(csv.text).toContain('"Período"');
    expect(csv.text).toContain(order.commercialId.slice(0, 12));
    expect(csv.text).not.toContain(f.tenantA.tenant.id);
    const pdf = await request(f.app)
      .get('/api/v1/reports/orders-status/export.pdf')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const text = await pdfText(pdf.body as Buffer);
    expect(text.text).toContain('Empresa A');
    expect(text.text).toContain('PEDIDOS POR STATUS');
    expect(text.text).toContain(order.commercialId.slice(0, 12));
    expect(orderView.parse(order).id).toBeTruthy();
  });
});
