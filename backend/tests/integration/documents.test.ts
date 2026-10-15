import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { writeFile, mkdir } from 'node:fs/promises';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import { draft, confirm, command, orderHeaders, orderDocs } from '../helpers/orders.js';
import { largeProducts, largeDraft } from '../helpers/largeOrders.js';
import { seller } from '../helpers/commercial.js';
import { financePost, versions, financialOrder, receiptBody } from '../helpers/finance.js';
import { orderView } from '../../src/shared/schemas/orders.js';
import { PdfRenderer } from '../../src/modules/documents/pdfRenderer.js';
import { pdfText } from '../helpers/documents.js';
import { AppError } from '../../src/shared/errors/appError.js';
import { ReturnService } from '../../src/modules/returns/returnService.js';

const f = registerFixture({ rateLimitMax: 10000 });
afterEach(() => vi.restoreAllMocks());
const pdfRequest = (
  id: string,
  kind: 'commercial' | 'packing' = 'commercial',
  user = f.ownerA,
  tenantId = f.tenantA.tenant.id,
) =>
  request(f.app)
    .get(`/api/v1/orders/${id}/documents/${kind}.pdf`)
    .set(tenantHeaders(user, tenantId))
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
      res.on('error', callback);
    });
const pdfDownload = async (id: string, kind: 'commercial' | 'packing' = 'commercial') => {
  const response = await pdfRequest(id, kind).expect(200);
  expect(response.headers['content-type']).toContain('application/pdf');
  expect(response.headers['content-disposition']).toBe(
    `attachment; filename="${kind === 'commercial' ? 'pedido' : 'romaneio'}-${id}.pdf"`,
  );
  expect(response.headers['cache-control']).toBe('private, no-store');
  return pdfText(response.body as Buffer);
};
async function domainSnapshot() {
  const collections = [
    'orders',
    'products',
    'customers',
    'inventory',
    'inventoryMovements',
    'stockReservations',
    'receivables',
    'financialTitles',
    'orderFinancialGuards',
    'financialOrderStates',
    'payments',
    'creditLots',
    'returns',
    'orderReturnLines',
    'returnEvents',
    'auditLogs',
  ];
  const values = await Promise.all(
    collections.map(async (c) => [
      c,
      (await orderDocs(f, c).get()).docs.map((d) => [d.id, d.data()]),
    ]),
  );
  return JSON.stringify(values);
}
describe('Downloads PDF privados G nos emuladores', () => {
  it('gera romaneio de 200 produtos expedidos após retorno físico parcial com dano', async () => {
    const ids = await largeProducts(f, 200);
    let order = await confirm(f, await largeDraft(f, ids));
    order = orderView.parse((await command(f, order, 'dispatch').expect(200)).body.data);
    const value = (
      await financePost(f, `/orders/${order.id}/returns`, {
        ...(await versions(f, order)),
        reason: 'Intenção de retorno grande sintético',
        lines: order.lines.map((line) => ({ lineId: line.id, quantity: line.quantity })),
      }).expect(201)
    ).body.data;
    const current = (
      await request(f.app).get(`/api/v1/returns/${value.returnId}`).set(orderHeaders(f)).expect(200)
    ).body.data;
    await financePost(f, `/returns/${value.returnId}/receipts`, {
      ...(await versions(f, order)),
      expectedVersion: current.version,
      reason: 'Recebimento parcial grande sintético',
      lines: [
        { lineId: order.lines[0]!.id, sellableQuantity: '1' },
        { lineId: order.lines[1]!.id, damagedQuantity: '1' },
      ],
    }).expect(200);
    const proofReads = vi.spyOn(ReturnService.prototype, 'guards');
    const before = await domainSnapshot(),
      pdf = await pdfDownload(order.id, 'packing');
    expect(proofReads.mock.calls).toHaveLength(20);
    expect(proofReads.mock.calls.every((call) => call[2].length <= 20)).toBe(true);
    for (const line of order.lines) expect(pdf.text.replaceAll(' ', '')).toContain(line.sku);
    expect(pdf.text).toContain('Não autoriza nova expedição');
    expect(pdf.text).not.toContain('R$');
    expect((pdf.text.match(/1 UN\s+1\s+1\s+\[/g) ?? []).length).toBe(2);
    expect((pdf.text.match(/1 UN\s+1\s+0\s+\[/g) ?? []).length).toBe(198);
    expect(await domainSnapshot()).toBe(before);
  }, 90_000);
  it.each([1, 20, 50, 100, 200])(
    'entrega ambos PDFs com %s produtos e preserva domínio',
    async (count) => {
      const products = await largeProducts(f, count);
      const order = await confirm(f, await largeDraft(f, products));
      const before = await domainSnapshot(),
        start = performance.now();
      for (const kind of ['commercial', 'packing'] as const) {
        const response = await pdfRequest(order.id, kind).expect(200);
        const pdf = await pdfText(response.body as Buffer);
        for (const line of order.lines) expect(pdf.text.replaceAll(' ', '')).toContain(line.sku);
        expect(pdf.text).toContain(order.commercialId);
        if (count >= 20) expect(pdf.pageCount).toBeGreaterThan(1);
        if (kind === 'packing') expect(pdf.text).not.toContain('R$');
        if (count === 200) {
          await mkdir('reports/pdf', { recursive: true });
          await writeFile(`reports/pdf/${kind}-200.pdf`, response.body as Buffer);
          console.info(
            JSON.stringify({
              documentCapacity: {
                count,
                kind,
                pages: pdf.pageCount,
                bytes: (response.body as Buffer).length,
                elapsedMs: Math.round(performance.now() - start),
              },
            }),
          );
        }
      }
      expect(await domainSnapshot()).toBe(before);
    },
    90_000,
  );
  it.each(['draft', 'confirmed', 'canceled', 'dispatched'] as const)(
    'preserva estado %s sem alterar pedido',
    async (status) => {
      let order = await draft(f);
      if (status === 'confirmed' || status === 'dispatched') order = await confirm(f, order);
      if (status === 'canceled' || status === 'dispatched')
        order = orderView.parse(
          (await command(f, order, status === 'canceled' ? 'cancel' : 'dispatch').expect(200)).body
            .data,
        );
      const before = await domainSnapshot();
      const commercial = await pdfDownload(order.id),
        packing = await pdfDownload(order.id, 'packing');
      expect(commercial.text).toContain(
        {
          draft: 'Rascunho',
          confirmed: 'Confirmado',
          canceled: 'Cancelado',
          dispatched: 'Expedido',
        }[status],
      );
      if (status === 'dispatched') expect(packing.text).toContain('Não autoriza nova expedição');
      if (status === 'canceled') expect(packing.text).toContain('Não autoriza separação');
      expect(await domainSnapshot()).toBe(before);
    },
  );
  it('usa cliente/preço/condição históricos após cadastros mudarem', async () => {
    const setup = await financialOrder(f),
      order = setup.order;
    await request(f.app)
      .patch(`/api/v1/products/${order.lines[0]!.productId}`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1, name: 'Novo nome do produto', priceCents: 99999 })
      .expect(200);
    await request(f.app)
      .patch(`/api/v1/customers/${order.customerId}`)
      .set(orderHeaders(f))
      .send({
        expectedVersion: 1,
        name: 'Novo nome do cliente',
        address: { street: 'Endereço atual não histórico' },
      })
      .expect(200);
    await request(f.app)
      .patch(`/api/v1/payment-conditions/${setup.condition.id}`)
      .set(orderHeaders(f))
      .set('Idempotency-Key', '4d060a59-f501-445a-b9c9-692dfb35ab6a')
      .send({ expectedVersion: 1, name: 'Condição nova' })
      .expect(200);
    const pdf = await pdfDownload(order.id);
    expect(pdf.text).toContain(order.customerName!);
    expect(pdf.text).toContain(setup.condition.name);
    expect(pdf.text).toContain('20,50');
    expect(pdf.text).not.toContain('Novo nome');
    expect(pdf.text).not.toContain('Endereço atual');
    expect(pdf.text).not.toContain('999,99');
  });
  it('permite vendedor próprio e bloqueia outra carteira, empresa e plataforma', async () => {
    const user = await seller(f),
      order = await confirm(f, await draft(f, user), user);
    await pdfRequest(order.id, 'commercial', user).expect(200);
    await pdfRequest(order.id, 'packing', user).expect(200);
    await pdfRequest(order.id, 'commercial', f.ownerB).expect(403);
    await pdfRequest(order.id, 'commercial', f.ownerB, f.tenantB.tenant.id).expect(404);
    await pdfRequest(order.id, 'commercial', f.platform).expect(403);
    const own = await draft(f);
    await pdfRequest(own.id, 'commercial', user).expect(404);
    await request(f.app)
      .patch(`/api/v1/customers/${order.customerId}/assignment`)
      .set(orderHeaders(f))
      .send({ expectedVersion: 1, assignedTo: null })
      .expect(200);
    await pdfRequest(order.id, 'commercial', user).expect(404);
    await pdfRequest(order.id, 'packing', user).expect(404);
    await pdfRequest(order.id).expect(200);
  });
  it('não expõe recebimentos/créditos/notas comerciais no romaneio do vendedor', async () => {
    const user = await seller(f);
    const order = await confirm(
      f,
      await draft(f, user, {
        extra: { notes: 'Dados comerciais: desconto financeiro secreto R$ 987,65' },
      }),
      user,
    );
    const pdf = await pdfText(
      (await pdfRequest(order.id, 'packing', user).expect(200)).body as Buffer,
    );
    expect(pdf.text).not.toContain('R$');
    expect(pdf.text).not.toContain('secreto');
    expect(pdf.text).not.toContain('Parcela');
  });
  it.each(['partial', 'full', 'damaged'] as const)(
    'mostra retorno físico %s, não intenção',
    async (kind) => {
      let order = await confirm(f, await draft(f, f.ownerA, { quantity: '10' }));
      order = orderView.parse((await command(f, order, 'dispatch').expect(200)).body.data);
      const value = (
        await financePost(f, `/orders/${order.id}/returns`, {
          ...(await versions(f, order)),
          reason: 'Retorno sintético',
          lines: [{ lineId: order.lines[0]!.id, quantity: '10' }],
        }).expect(201)
      ).body.data;
      const intended = await pdfDownload(order.id, 'packing');
      expect(intended.text).toMatch(/10 UN\s+10\s+0\s+\[/);
      const current = (
        await request(f.app)
          .get(`/api/v1/returns/${value.returnId}`)
          .set(orderHeaders(f))
          .expect(200)
      ).body.data;
      await financePost(f, `/returns/${value.returnId}/receipts`, {
        ...(await versions(f, order)),
        expectedVersion: current.version,
        reason: 'Conferência real sintética',
        lines: [
          {
            lineId: order.lines[0]!.id,
            ...(kind === 'damaged'
              ? { damagedQuantity: '3' }
              : { sellableQuantity: kind === 'full' ? '10' : '3' }),
          },
        ],
      }).expect(200);
      const before = await domainSnapshot();
      const pdf = await pdfDownload(order.id, 'packing');
      expect(pdf.text).toMatch(new RegExp(`10 UN\\s+10\\s+${kind === 'full' ? '10' : '3'}\\s+\\[`));
      expect(pdf.text).not.toContain('R$');
      expect(await domainSnapshot()).toBe(before);
    },
  );
  it('falha de renderização não produz efeitos e permite recuperação', async () => {
    const order = await confirm(f, await draft(f)),
      before = await domainSnapshot();
    vi.spyOn(PdfRenderer.prototype, 'render').mockRejectedValueOnce(
      new AppError(500, 'INTERNAL_ERROR', 'Erro interno do servidor'),
    );
    await pdfRequest(order.id).expect(500);
    expect(await domainSnapshot()).toBe(before);
    await pdfRequest(order.id).expect(200);
  });
  it('revalida vínculo depois da renderização', async () => {
    const order = await confirm(f, await draft(f)),
      original = PdfRenderer.prototype.render;
    vi.spyOn(PdfRenderer.prototype, 'render').mockImplementation(async function (
      this: PdfRenderer,
      ...args
    ) {
      const bytes = await original.apply(this, args);
      await f.firebase.db
        .doc(`tenants/${f.tenantA.tenant.id}/memberships/${f.ownerA.uid}`)
        .update({ status: 'disabled' });
      return bytes;
    });
    await pdfRequest(order.id).expect(403);
  });
  it('recusa documento cujo pedido muda durante renderização', async () => {
    const order = await draft(f),
      original = PdfRenderer.prototype.render;
    vi.spyOn(PdfRenderer.prototype, 'render').mockImplementation(async function (
      this: PdfRenderer,
      ...args
    ) {
      const bytes = await original.apply(this, args);
      await request(f.app)
        .patch(`/api/v1/orders/${order.id}`)
        .set(orderHeaders(f))
        .send({ expectedVersion: order.version, notes: 'Nova observação concorrente' })
        .expect(200);
      return bytes;
    });
    const result = await request(f.app)
      .get(`/api/v1/orders/${order.id}/documents/commercial.pdf`)
      .set(orderHeaders(f))
      .expect(409);
    expect(result.body.error.code).toBe('DOCUMENT_CHANGED');
  });
  it('limita duas gerações simultâneas e libera capacidade após concluir', async () => {
    const order = await confirm(f, await draft(f)),
      original = PdfRenderer.prototype.render;
    let count = 0,
      started!: () => void,
      release!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(PdfRenderer.prototype, 'render').mockImplementation(async function (
      this: PdfRenderer,
      ...args
    ) {
      const bytes = await original.apply(this, args);
      if (++count === 2) started();
      await hold;
      return bytes;
    });
    const a = pdfRequest(order.id)
        .expect(200)
        .then((r) => r.status),
      b = pdfRequest(order.id)
        .expect(200)
        .then((r) => r.status);
    try {
      await ready;
      await pdfRequest(order.id).expect(429);
    } finally {
      release();
    }
    expect(await Promise.all([a, b])).toEqual([200, 200]);
    vi.restoreAllMocks();
    await pdfRequest(order.id).expect(200);
  });
  it('saldo financeiro recebido não aparece no PDF comercial', async () => {
    const setup = await financialOrder(f);
    await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 731),
    ).expect(200);
    const pdf = await pdfDownload(setup.order.id);
    expect(pdf.text).not.toContain('7,31');
    expect(pdf.text).not.toContain('Recebimento');
    expect(pdf.text).toContain('20,50');
  });
});
