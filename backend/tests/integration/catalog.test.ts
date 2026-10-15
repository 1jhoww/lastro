import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import { configure, publicPath, catalogProduct, quotePreview } from '../helpers/catalog.js';
import { png } from '../helpers/commercial.js';
import { createApp } from '../../src/app/app.js';
import { CatalogService } from '../../src/modules/catalog/catalogService.js';
import { publicCatalogRateLimit } from '../../src/middlewares/rateLimit.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';
import { requestContext } from '../../src/middlewares/requestContext.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { largeProducts } from '../helpers/largeOrders.js';
import { digest } from '../../src/shared/utils/crypto.js';
const f = registerFixture({ rateLimitMax: 10000 });
beforeEach(() => {
  f.app = createApp(f.config, f.firebase, () => new Date(Date.now() + f.offset));
});
const updateProduct = (id: string, body: object) =>
  request(f.app)
    .patch(`/api/v1/products/${id}`)
    .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
    .send({ expectedVersion: 1, ...body });
async function prepare(extra: object = {}) {
  await configure(f, extra).expect(200);
  return catalogProduct(f);
}
describe('F2 consulta pública e imagens privadas', () => {
  it('limite em memória barra abuso antes de ler Firestore e não consome orçamento privado', async () => {
    await prepare();
    const app = createApp({ ...f.config, rateLimitMax: 2 }, f.firebase),
      spy = vi.spyOn(f.firebase.db, 'runTransaction');
    try {
      await request(app).get(publicPath()).expect(200);
      await request(app).get(publicPath()).expect(200);
      const calls = spy.mock.calls.length;
      await request(app).get(publicPath()).expect(429);
      expect(spy.mock.calls.length).toBe(calls);
      await request(f.app)
        .get('/api/v1/me')
        .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
        .expect(200);
    } finally {
      spy.mockRestore();
    }
  });
  it('orçamento compartilhado por catálogo impede leituras após atingir limite da janela', async () => {
    await prepare();
    const now = Date.now(),
      spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await f.firebase.db
        .doc(`rateLimits/${digest(`catalog-slug:lastro-a:${Math.floor(now / 60_000)}`)}`)
        .set({ count: 600 });
      await request(f.app).get(publicPath()).expect(429);
    } finally {
      spy.mockRestore();
    }
  });
  it('página vazia de categorias tem cursor opaco utilizável sem expor categoria não publicada', async () => {
    await configure(f).expect(200);
    const category = async (name: string) =>
      (
        await request(f.app)
          .post('/api/v1/categories')
          .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
          .send({ name })
          .expect(201)
      ).body.data;
    const hidden = await category('A Interna'),
      published = await category('B Publicada');
    await catalogProduct(f, { categoryId: published.id });
    const first = (
      await request(f.app).get(publicPath('/categories')).query({ limit: '1' }).expect(200)
    ).body.data;
    expect(first.items).toEqual([]);
    expect(first.nextCursor).toBeTypeOf('string');
    expect(Buffer.from(first.nextCursor, 'base64url').toString()).not.toContain(hidden.id);
    const second = (
      await request(f.app)
        .get(publicPath('/categories'))
        .query({ limit: '1', cursor: first.nextCursor })
        .expect(200)
    ).body.data;
    expect(second.items).toEqual([{ id: published.id, name: 'B Publicada' }]);
  });
  it('publica somente ativos selecionados e não expõe tenant, SKU, autores ou estoque', async () => {
    const product = await prepare();
    await catalogProduct(f, { catalogVisible: false });
    const inactive = await catalogProduct(f);
    await updateProduct(inactive.id, { status: 'inactive' }).expect(200);
    const body = (await request(f.app).get(publicPath('/products')).expect(200)).body.data;
    expect(body.items.map((p: { id: string }) => p.id)).toEqual([product.id]);
    expect(body.items[0]).toMatchObject({ unit: 'UN', unitPriceCents: 2050, imagePath: null });
    expect(JSON.stringify(body)).not.toMatch(
      /tenantId|sku|createdBy|updatedBy|minimumStock|physical|reserved|available|subscription|cashCents/,
    );
    expect(
      (
        await request(f.app)
          .get(publicPath(`/products/${product.id}`))
          .expect(200)
      ).body.data,
    ).toEqual(body.items[0]);
    await request(f.app).get(`/api/v1/products/${product.id}`).expect(401);
  });
  it('resolve empresa pelo slug e ignora tentativa de ampliar tenant pelo header', async () => {
    const a = await prepare();
    await configure(f, { slug: 'lastro-b' }, randomUUID(), f.ownerB, f.tenantB.tenant.id).expect(
      200,
    );
    const b = await catalogProduct(f, { name: 'Produto empresa B' }, f.ownerB, f.tenantB.tenant.id);
    await request(f.app)
      .get(publicPath(`/products/${b.id}`))
      .set('X-Tenant-Id', f.tenantB.tenant.id)
      .expect(404);
    await request(f.app)
      .get(publicPath(`/products/${a.id}`, 'lastro-b'))
      .expect(404);
    const list = (await request(f.app).get(publicPath('/products', 'lastro-b')).expect(200)).body
      .data;
    expect(list.items.map((p: { id: string }) => p.id)).toEqual([b.id]);
  });
  it('pesquisa prefixada normaliza acentos e pagina sem misturar filtros ou catálogos', async () => {
    await configure(f).expect(200);
    const a = await catalogProduct(f, { name: 'Água Mineral' });
    await catalogProduct(f, { name: 'Agua Natural' });
    await catalogProduct(f, { name: 'Biscoito' });
    const first = (
      await request(f.app).get(publicPath('/products')).query({ q: 'agua', limit: '1' }).expect(200)
    ).body.data;
    expect(first.items[0].id).toBe(a.id);
    expect(first.nextCursor).toBeTypeOf('string');
    const second = (
      await request(f.app)
        .get(publicPath('/products'))
        .query({ q: 'agua', limit: '1', cursor: first.nextCursor })
        .expect(200)
    ).body.data;
    expect(second.items[0].name).toBe('Agua Natural');
    expect(second.nextCursor).toBeNull();
    await request(f.app)
      .get(publicPath('/products'))
      .query({ q: 'biscoito', limit: '1', cursor: first.nextCursor })
      .expect(422);
    await request(f.app)
      .get(publicPath('/products'))
      .query({ q: 'agua', limit: '1', cursor: `${first.nextCursor}x` })
      .expect(422);
    await configure(f, { slug: 'lastro-b' }, randomUUID(), f.ownerB, f.tenantB.tenant.id).expect(
      200,
    );
    await request(f.app)
      .get(publicPath('/products', 'lastro-b'))
      .query({ q: 'agua', limit: '1', cursor: first.nextCursor })
      .expect(422);
  });
  it('categorias mostram somente referências publicadas e filtro inativo não revela informação interna', async () => {
    await configure(f).expect(200);
    const category = async (name: string) =>
      (
        await request(f.app)
          .post('/api/v1/categories')
          .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
          .send({ name })
          .expect(201)
      ).body.data;
    const a = await category('Publicada'),
      hidden = await category('Interna');
    const product = await catalogProduct(f, { categoryId: a.id });
    await catalogProduct(f, { categoryId: hidden.id, catalogVisible: false });
    const categories = (await request(f.app).get(publicPath('/categories')).expect(200)).body.data;
    expect(categories.items).toEqual([{ id: a.id, name: 'Publicada' }]);
    expect(
      (await request(f.app).get(publicPath('/products')).query({ categoryId: a.id }).expect(200))
        .body.data.items,
    ).toHaveLength(1);
    await request(f.app)
      .patch(`/api/v1/categories/${a.id}`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ expectedVersion: 1, status: 'inactive' })
      .expect(200);
    expect(
      (await request(f.app).get(publicPath('/products')).query({ categoryId: a.id }).expect(200))
        .body.data.items,
    ).toEqual([]);
    expect(
      (
        await request(f.app)
          .get(publicPath(`/products/${product.id}`))
          .expect(200)
      ).body.data.category,
    ).toBeNull();
  });
  it('não usa cache de preço ou visibilidade após alteração e invalida cursor após configurar catálogo', async () => {
    const product = await prepare();
    await catalogProduct(f);
    const first = (
      await request(f.app).get(publicPath('/products')).query({ limit: '1' }).expect(200)
    ).body.data;
    await updateProduct(product.id, { priceCents: 999 }).expect(200);
    expect(
      (
        await request(f.app)
          .get(publicPath(`/products/${product.id}`))
          .expect(200)
      ).body.data.unitPriceCents,
    ).toBe(999);
    await configure(f, { expectedVersion: 1, showPrices: false }).expect(200);
    const hidden = await request(f.app)
      .get(publicPath(`/products/${product.id}`))
      .expect(200);
    expect(hidden.body.data.unitPriceCents).toBeNull();
    expect(hidden.headers['cache-control']).toContain('no-store');
    await request(f.app)
      .get(publicPath('/products'))
      .query({ limit: '1', cursor: first.nextCursor })
      .expect(422);
    await request(f.app)
      .patch(`/api/v1/products/${product.id}`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ expectedVersion: 2, catalogVisible: false })
      .expect(200);
    await request(f.app)
      .get(publicPath(`/products/${product.id}`))
      .expect(404);
  });
  it('imagem passa somente por API pública controlada, mantendo objeto e rota interna privados', async () => {
    const product = await prepare();
    await request(f.app)
      .put(`/api/v1/products/${product.id}/image`)
      .query({ expectedVersion: '1' })
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(200);
    const image = await request(f.app)
      .get(publicPath(`/products/${product.id}/image`))
      .expect(200);
    expect(image.headers['content-type']).toContain('image/webp');
    expect(image.headers['cache-control']).toContain('no-store');
    expect(image.body.length).toBeGreaterThan(0);
    await request(f.app).get(`/api/v1/products/${product.id}/image`).expect(401);
    await configure(f, { expectedVersion: 1, enabled: false }).expect(200);
    await request(f.app)
      .get(publicPath(`/products/${product.id}/image`))
      .expect(404);
  });
  it('despublicação durante I/O de Storage bloqueia entrega da imagem', async () => {
    const product = await prepare();
    await request(f.app)
      .put(`/api/v1/products/${product.id}/image`)
      .query({ expectedVersion: '1' })
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(200);
    const original = CatalogService.prototype.resolve;
    let reads = 0;
    const spy = vi.spyOn(CatalogService.prototype, 'resolve').mockImplementation(async function (
      this: CatalogService,
      ...args
    ) {
      if (++reads === 2)
        await f.firebase.db
          .doc(`tenants/${f.tenantA.tenant.id}/products/${product.id}`)
          .update({ catalogVisible: false });
      return original.apply(this, args);
    });
    try {
      await request(f.app)
        .get(publicPath(`/products/${product.id}/image`))
        .expect(404);
    } finally {
      spy.mockRestore();
    }
    expect(reads).toBe(2);
  });
  it('CORS permite consulta pública sem credenciais e preserva rejeição das rotas privadas', async () => {
    await prepare();
    const result = await request(f.app)
      .get(publicPath())
      .set('Origin', 'https://catalogo.example.invalid')
      .expect(200);
    expect(result.headers['access-control-allow-origin']).toBe('*');
    expect(result.headers['access-control-allow-credentials']).toBeUndefined();
    await request(f.app)
      .get('/api/v1/me')
      .set('Origin', 'https://catalogo.example.invalid')
      .expect(403);
    await request(f.app).get('/api/v1/public/private-resource').expect(404);
  });
  it('entradas públicas strict recusam filtro interno, paginação excessiva e JSON grande', async () => {
    await prepare();
    for (const query of [
      { limit: '51' },
      { status: 'inactive' },
      { tenantId: f.tenantB.tenant.id },
      { sort: 'priceCents' },
      { q: 'x'.repeat(81) },
    ])
      await request(f.app).get(publicPath('/products')).query(query).expect(422);
    await request(f.app)
      .post(publicPath('/quote-preview'))
      .send({ lines: [], notes: 'x'.repeat(70000) })
      .expect(413);
    await request(f.app).get('/api/v1/public/catalogs/UPPER').expect(422);
  });
  it('limite público é compartilhado entre instâncias', async () => {
    const instance = () => {
      const app = express();
      app.use(
        requestContext,
        publicCatalogRateLimit(
          { ...f.config, rateLimitMax: 2 },
          new FoundationRepository(f.firebase.db),
        ),
      );
      app.get('/probe', (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);
      return app;
    };
    const a = instance(),
      b = instance();
    await request(a).get('/probe').expect(200);
    await request(b).get('/probe').expect(200);
    expect((await request(a).get('/probe').expect(429)).headers['retry-after']).toBe('60');
  });
});

describe('F3 orçamento transitório e WhatsApp', () => {
  it('preview e link compartilham limite adicional de dez solicitações por minuto', async () => {
    const product = await prepare(),
      lines = [{ productId: product.id, quantity: '1' }];
    let token = '';
    for (let i = 0; i < 10; i++)
      token = (await quotePreview(f, lines).expect(200)).body.data.reviewToken;
    await request(f.app)
      .post(publicPath('/whatsapp'))
      .send({ lines, reviewToken: token })
      .expect(429);
  });
  it('200 produtos podem ser revisados sem reservas, pedidos ou mudanças no estoque', async () => {
    await configure(f).expect(200);
    const ids = await largeProducts(f, 200),
      batch = f.firebase.db.batch();
    ids.forEach((id) =>
      batch.update(f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}/products/${id}`), {
        catalogVisible: true,
      }),
    );
    await batch.commit();
    const refs = ids.map((id) =>
        f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}/inventory/${id}`),
      ),
      before = await f.firebase.db.getAll(...refs);
    const result = (
      await quotePreview(
        f,
        ids.map((productId) => ({ productId, quantity: '1' })),
      ).expect(200)
    ).body.data;
    expect(result.lines).toHaveLength(200);
    expect(Number.isSafeInteger(result.totalEstimatedCents)).toBe(true);
    const after = await f.firebase.db.getAll(...refs);
    expect(after.map((d) => d.data())).toEqual(before.map((d) => d.data()));
    for (const collection of ['orders', 'receivables', 'stockReservations', 'financialEvents'])
      expect(
        (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/${collection}`).get()).size,
      ).toBe(0);
  }, 90_000);
  it('calcula centavos atuais, decimais e total; repetição não cria operações comerciais', async () => {
    await configure(f).expect(200);
    const unit = await catalogProduct(f, { unit: 'UN', priceCents: 1 }),
      kg = await catalogProduct(f, { unit: 'KG', priceCents: 2050 });
    const lines = [
      { productId: unit.id, quantity: '1' },
      { productId: kg.id, quantity: '0.125' },
    ];
    const a = (await quotePreview(f, lines).expect(200)).body.data,
      b = (await quotePreview(f, lines).expect(200)).body.data;
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      totalEstimatedCents: 257,
      confirmedOrder: false,
      kind: 'quote_request',
    });
    expect(a.lines[1]).toMatchObject({ quantity: '0.125', subtotalCents: 256 });
    const result = (
      await request(f.app)
        .post(publicPath('/whatsapp'))
        .send({ lines, reviewToken: a.reviewToken })
        .expect(200)
    ).body.data;
    expect(result.message).toContain('Total estimado: R$ 2,57');
    expect(new URL(result.whatsappUrl).searchParams.get('text')).toBe(result.message);
    for (const collection of [
      'orders',
      'stockReservations',
      'inventoryMovements',
      'receivables',
      'payments',
      'creditLots',
      'refundObligations',
      'financialOperations',
      'financialEvents',
      'quotes',
    ])
      expect(
        (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/${collection}`).get()).size,
      ).toBe(0);
    expect(
      (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/customers`).get()).size,
    ).toBe(0);
    expect(
      (await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}/inventory/${unit.id}`).get()).get(
        'physicalScaled',
      ),
    ).toBe(0);
  });
  it('preço oculto não aparece no resumo, link, erro monetário ou prova após mudança de preço', async () => {
    const product = await prepare({ showPrices: false }),
      lines = [{ productId: product.id, quantity: '1000000000' }];
    const a = (await quotePreview(f, lines).expect(200)).body.data;
    expect(a).toMatchObject({
      totalEstimatedCents: null,
      lines: [{ unitPriceCents: null, subtotalCents: null }],
    });
    await updateProduct(product.id, { priceCents: 100_000_000 }).expect(200);
    const b = (await quotePreview(f, lines).expect(200)).body.data;
    expect(b.reviewToken).toBe(a.reviewToken);
    const result = (
      await request(f.app)
        .post(publicPath('/whatsapp'))
        .send({ lines, reviewToken: a.reviewToken })
        .expect(200)
    ).body.data;
    expect(result.message).not.toMatch(/R\$|100000000000000000|Total estimado|Unitário/);
    expect(new URL(result.whatsappUrl).origin).toBe('https://wa.me');
  });
  it('preço alterado exige novo preview antes de preparar mensagem', async () => {
    const product = await prepare(),
      lines = [{ productId: product.id, quantity: '1' }],
      before = (await quotePreview(f, lines).expect(200)).body.data;
    await updateProduct(product.id, { priceCents: 2999 }).expect(200);
    const changed = await request(f.app)
      .post(publicPath('/whatsapp'))
      .send({ lines, reviewToken: before.reviewToken })
      .expect(409);
    expect(changed.body.error.code).toBe('QUOTE_CHANGED');
    const current = (await quotePreview(f, lines).expect(200)).body.data;
    expect(current.totalEstimatedCents).toBe(2999);
    await request(f.app)
      .post(publicPath('/whatsapp'))
      .send({ lines, reviewToken: current.reviewToken })
      .expect(200);
  });
  it.each([{ catalogVisible: false }, { status: 'inactive' }])(
    'produto retirado durante carrinho %j não pode gerar mensagem',
    async (change) => {
      const product = await prepare(),
        lines = [{ productId: product.id, quantity: '1' }],
        before = (await quotePreview(f, lines).expect(200)).body.data;
      await updateProduct(product.id, change).expect(200);
      expect(
        (
          await request(f.app)
            .post(publicPath('/whatsapp'))
            .send({ lines, reviewToken: before.reviewToken })
            .expect(404)
        ).body.error.code,
      ).toBe('PRODUCT_UNAVAILABLE');
      await quotePreview(f, lines).expect(404);
    },
  );
  it('catálogo oculto entre revisão e link não prepara mensagem nem vaza total', async () => {
    const product = await prepare(),
      lines = [{ productId: product.id, quantity: '1' }],
      before = (await quotePreview(f, lines).expect(200)).body.data;
    await configure(f, { expectedVersion: 1, showPrices: false }).expect(200);
    const changed = await request(f.app)
      .post(publicPath('/whatsapp'))
      .send({ lines, reviewToken: before.reviewToken })
      .expect(409);
    expect(changed.body.error.code).toBe('QUOTE_CHANGED');
    expect(JSON.stringify(changed.body)).not.toMatch(/2050|20,50/);
    await configure(f, { expectedVersion: 2, enabled: false }).expect(200);
    await quotePreview(f, lines).expect(404);
  });
  it.each(['0', '0.5', '1000000001', '1e3', '-1'])(
    'quantidade UN inválida %s não cria efeitos',
    async (quantity) => {
      const product = await prepare();
      await quotePreview(f, [{ productId: product.id, quantity }]).expect(422);
    },
  );
  it('quantidades CX/PCT inteiras e L decimais usam regras existentes; preço zero não exige mínimo', async () => {
    await configure(f).expect(200);
    const cx = await catalogProduct(f, { unit: 'CX', priceCents: 0 }),
      pct = await catalogProduct(f, { unit: 'PCT', priceCents: 1 }),
      l = await catalogProduct(f, { unit: 'L', priceCents: 500 });
    const result = (
      await quotePreview(f, [
        { productId: cx.id, quantity: '1' },
        { productId: pct.id, quantity: '2' },
        { productId: l.id, quantity: '0.001' },
      ]).expect(200)
    ).body.data;
    expect(result.totalEstimatedCents).toBe(3);
    expect(result.lines[2]).toMatchObject({ quantity: '0.001', subtotalCents: 1 });
    await quotePreview(f, [{ productId: l.id, quantity: '0.0001' }]).expect(422);
  });
  it('não aceita nomes, preço, total, unidade, destino ou mensagem do navegador', async () => {
    const product = await prepare(),
      lines = [{ productId: product.id, quantity: '1' }];
    for (const field of [
      'totalEstimatedCents',
      'priceCents',
      'tenantId',
      'message',
      'whatsappNumber',
      'unit',
    ])
      await request(f.app)
        .post(publicPath('/quote-preview'))
        .send({ lines, [field]: 'forged' })
        .expect(422);
    await request(f.app)
      .post(publicPath('/quote-preview'))
      .send({ lines: [{ ...lines[0], name: 'Preço grátis' }] })
      .expect(422);
    await request(f.app)
      .post(publicPath('/whatsapp'))
      .send({ lines, reviewToken: '0'.repeat(64) })
      .expect(409);
  });
  it('limita itens e total público sem criar registro persistente ou revelar outro tenant', async () => {
    const product = await prepare();
    await quotePreview(
      f,
      Array.from({ length: 201 }, (_, i) => ({ productId: `p-${i}`, quantity: '1' })),
    ).expect(422);
    await quotePreview(f, [{ productId: product.id, quantity: '1000000000' }]).expect(422);
    const foreign = await catalogProduct(f, {}, f.ownerB, f.tenantB.tenant.id);
    await quotePreview(f, [{ productId: foreign.id, quantity: '1' }]).expect(404);
  });
  it('previews e mensagens concorrentes repetem conteúdo sem efeitos comerciais', async () => {
    const product = await prepare(),
      lines = [{ productId: product.id, quantity: '1' }];
    const results = await Promise.all([quotePreview(f, lines), quotePreview(f, lines)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body.data).toEqual(results[1]!.body.data);
    const body = { lines, reviewToken: results[0]!.body.data.reviewToken },
      links = await Promise.all([
        request(f.app).post(publicPath('/whatsapp')).send(body),
        request(f.app).post(publicPath('/whatsapp')).send(body),
      ]);
    expect(links.map((r) => r.status)).toEqual([200, 200]);
    expect(links[0]!.body.data).toEqual(links[1]!.body.data);
  });
});
