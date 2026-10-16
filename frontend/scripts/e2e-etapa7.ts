/** Etapa 7: somente API e emuladores locais, sem escrita direta no banco ou alteração do backend. */
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import createPublicClient from 'openapi-fetch';
import type { paths } from '../src/api/schema';
import { unwrap } from '../src/api/client';
import { exportPage, orderDocument } from '../src/features/files/api';
import { todayIn } from '../src/features/orders/rules';
import {
  assert,
  check,
  client,
  createSeller,
  createTenant,
  expectError,
  header,
  report,
  results,
  seedPassword,
  signIn,
  e2eAddress,
} from './e2eSupport';
const base = process.env.API_URL ?? 'http://127.0.0.1:3000';
const url = new URL(base);
if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname))
  throw new Error('E2E exige API local.');
const output = resolve('.local/etapa7');
mkdirSync(output, { recursive: true });
const publicApi = createPublicClient<paths>({ baseUrl: base });
const artifacts: Record<string, string> = {};
async function main() {
  const platform = await signIn('platform.demo@lastro.invalid', seedPassword);
  const root = client(platform.token, null);
  const a = await createTenant(root, 'Etapa 7 sintética'),
    b = await createTenant(root, 'Etapa 7 isolamento');
  const admin = client(a.admin.token, a.tenantId),
    outside = client(b.admin.token, b.tenantId),
    h = header(a.tenantId);
  const sellerUser = await createSeller(admin, a.tenantId),
    seller = client(sellerUser.token, a.tenantId);
  const idem = (key = randomUUID()) => ({ ...h, 'Idempotency-Key': key });
  const slug = `etapa7-${randomUUID().slice(0, 8)}`;
  const settings = {
    expectedVersion: 0,
    slug,
    enabled: true,
    tradeName: 'Empresa pública sintética',
    description: 'Solicitação de orçamento local.',
    whatsappNumber: '5511999999999',
    showPrices: true,
  };
  const category = await unwrap(
    admin.POST('/api/v1/categories', { params: { header: h }, body: { name: 'Cafés sintéticos' } }),
  );
  const product = await unwrap(
    admin.POST('/api/v1/products', {
      params: { header: h },
      body: {
        name: 'Café Etapa 7',
        sku: `E7-${randomUUID().slice(0, 8)}`,
        description: 'Descrição pública de teste',
        unit: 'KG',
        priceCents: 1500,
        categoryId: category.id,
        catalogVisible: true,
        minimumStock: '0',
      },
    }),
  );
  const hidden = await unwrap(
    admin.POST('/api/v1/products', {
      params: { header: h },
      body: {
        name: 'Produto privado E7',
        sku: `E7-${randomUUID().slice(0, 8)}`,
        unit: 'UN',
        priceCents: 99900,
        catalogVisible: false,
      },
    }),
  );
  const customer = await unwrap(
    admin.POST('/api/v1/customers', {
      params: { header: h },
      body: {
        address: e2eAddress,
        name: '=SOMA(1;1)',
        assignedTo: sellerUser.uid,
        notes: 'Nota privada que nunca aparece no catálogo',
      },
    }),
  );
  await unwrap(
    admin.POST('/api/v1/customers', {
      params: { header: h },
      body: { address: e2eAddress, name: 'Cliente E7 adicional' },
    }),
  );
  await unwrap(
    admin.POST('/api/v1/inventory/entries', {
      params: { header: idem() },
      body: { productId: product.id, quantity: '10', reason: 'Estoque sintético E2E E7' },
    }),
  );
  const draft = await unwrap(
    seller.POST('/api/v1/orders', {
      params: { header: h },
      body: {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: '2' }],
        payment: { type: 'cash', dueDates: [todayIn('America/Sao_Paulo')] },
      },
    }),
  );
  const order = await unwrap(
    seller.POST('/api/v1/orders/{id}/confirm', {
      params: { header: idem(), path: { id: draft.id } },
      body: { expectedVersion: draft.version },
    }),
  );
  let configured = settings as typeof settings & { version?: number };
  await check(
    'configuração inicial ausente; PUT autorizado e replay da mesma intenção',
    async () => {
      const before = await unwrap(admin.GET('/api/v1/catalog-settings', { params: { header: h } }));
      assert(before.catalog === null, 'configuração inicial incorreta');
      const key = randomUUID();
      const first = await unwrap(
        admin.PUT('/api/v1/catalog-settings', { params: { header: idem(key) }, body: settings }),
      );
      const replay = await unwrap(
        admin.PUT('/api/v1/catalog-settings', { params: { header: idem(key) }, body: settings }),
      );
      assert(
        first.version === replay.version && replay.slug === slug,
        'replay alterou configuração',
      );
      configured = first;
    },
  );
  await check('versão antiga conflita; vendedor e plataforma não configuram catálogo', async () => {
    await expectError(
      unwrap(
        admin.PUT('/api/v1/catalog-settings', {
          params: { header: idem() },
          body: { ...settings, tradeName: 'Mudança concorrente' },
        }),
      ),
      409,
    );
    await expectError(
      unwrap(seller.GET('/api/v1/catalog-settings', { params: { header: h } })),
      403,
    );
    await expectError(unwrap(root.GET('/api/v1/catalog-settings', { params: { header: h } })), 403);
  });
  await check('perfil público anônimo e CORS sem identidade privada', async () => {
    const response = await fetch(`${base}/api/v1/public/catalogs/${slug}`, {
      headers: { Origin: 'http://127.0.0.1:8097' },
    });
    assert(
      response.ok && response.headers.get('access-control-allow-origin') === '*',
      'CORS público incorreto',
    );
    const body = await response.json();
    assert(
      Object.keys(body.data).sort().join(',') ===
        'description,showPrices,slug,tradeName,whatsappNumber',
      'perfil vazou campos privados',
    );
  });
  await check(
    'produtos públicos selecionados, busca/categoria e detalhe sem estoque ou SKU',
    async () => {
      const products = await unwrap(
        publicApi.GET('/api/v1/public/catalogs/{slug}/products', {
          params: { path: { slug }, query: { q: 'café', categoryId: category.id, limit: '1' } },
        }),
      );
      assert(
        products.items.length === 1 && products.items[0]?.id === product.id,
        'seleção pública incorreta',
      );
      const detail = await unwrap(
        publicApi.GET('/api/v1/public/catalogs/{slug}/products/{id}', {
          params: { path: { slug, id: product.id } },
        }),
      );
      assert(
        !('sku' in detail) &&
          !('available' in detail) &&
          !('priceCents' in detail) &&
          detail.unitPriceCents === 1500,
        'produto vazou dados internos',
      );
      await expectError(
        unwrap(
          publicApi.GET('/api/v1/public/catalogs/{slug}/products/{id}', {
            params: { path: { slug, id: hidden.id } },
          }),
        ),
        404,
      );
      const categories = await unwrap(
        publicApi.GET('/api/v1/public/catalogs/{slug}/categories', { params: { path: { slug } } }),
      );
      assert(
        categories.items.some((item) => item.id === category.id),
        'categoria ausente',
      );
    },
  );
  await check('imagem WebP pública somente via API', async () => {
    const image = readFileSync(resolve('assets/icon.png'));
    await unwrap(
      admin.PUT('/api/v1/products/{id}/image', {
        params: {
          header: h,
          path: { id: product.id },
          query: { expectedVersion: String(product.version) },
        },
        body: image as never,
        bodySerializer: (b) => b as BodyInit,
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    const res = await fetch(`${base}/api/v1/public/catalogs/${slug}/products/${product.id}/image`);
    assert(res.ok && res.headers.get('content-type')?.startsWith('image/webp'), 'imagem inválida');
    assert((await res.arrayBuffer()).byteLength > 0, 'imagem vazia');
  });
  let reviewed: Awaited<ReturnType<typeof unwrap<import('../src/api/types').QuotePreview>>>;
  const quote = { lines: [{ productId: product.id, quantity: '0.125' }] };
  await check('preview usa centavos inteiros e arredondamento oficial', async () => {
    reviewed = await unwrap(
      publicApi.POST('/api/v1/public/catalogs/{slug}/quote-preview', {
        params: { path: { slug } },
        body: quote,
      }),
    );
    assert(
      reviewed.totalEstimatedCents === 188 &&
        reviewed.confirmedOrder === false &&
        reviewed.kind === 'quote_request',
      'preview incorreto',
    );
  });
  await check('WhatsApp conserva linhas e revisão, sem criar pedido ou reserva', async () => {
    const before = await unwrap(admin.GET('/api/v1/orders', { params: { header: h } }));
    const stockBefore = await unwrap(
      admin.GET('/api/v1/inventory/{productId}', {
        params: { header: h, path: { productId: product.id } },
      }),
    );
    const result = await unwrap(
      publicApi.POST('/api/v1/public/catalogs/{slug}/whatsapp', {
        params: { path: { slug } },
        body: { ...quote, reviewToken: reviewed.reviewToken },
      }),
    );
    assert(
      result.whatsappUrl.startsWith('https://wa.me/5511999999999?text=') && !result.confirmedOrder,
      'link não revisado',
    );
    const after = await unwrap(admin.GET('/api/v1/orders', { params: { header: h } }));
    const stockAfter = await unwrap(
      admin.GET('/api/v1/inventory/{productId}', {
        params: { header: h, path: { productId: product.id } },
      }),
    );
    assert(
      before.items.length === after.items.length &&
        JSON.stringify(stockBefore) === JSON.stringify(stockAfter),
      'solicitação alterou domínio',
    );
  });
  await check('preços ocultos são null; revisão anterior recebe QUOTE_CHANGED', async () => {
    configured = await unwrap(
      admin.PUT('/api/v1/catalog-settings', {
        params: { header: idem() },
        body: { ...settings, expectedVersion: configured.version!, showPrices: false },
      }),
    );
    await expectError(
      unwrap(
        publicApi.POST('/api/v1/public/catalogs/{slug}/whatsapp', {
          params: { path: { slug } },
          body: { ...quote, reviewToken: reviewed.reviewToken },
        }),
      ),
      409,
      'QUOTE_CHANGED',
    );
    const hiddenQuote = await unwrap(
      publicApi.POST('/api/v1/public/catalogs/{slug}/quote-preview', {
        params: { path: { slug } },
        body: quote,
      }),
    );
    assert(
      hiddenQuote.totalEstimatedCents === null &&
        hiddenQuote.lines.every(
          (line) => line.unitPriceCents === null && line.subtotalCents === null,
        ),
      'preço oculto vazou',
    );
    configured = await unwrap(
      admin.PUT('/api/v1/catalog-settings', {
        params: { header: idem() },
        body: { ...settings, expectedVersion: configured.version! },
      }),
    );
  });
  await check('quantidade inválida e produto privado recusados na prévia', async () => {
    await expectError(
      unwrap(
        publicApi.POST('/api/v1/public/catalogs/{slug}/quote-preview', {
          params: { path: { slug } },
          body: { lines: [{ productId: product.id, quantity: '0.0001' }] },
        }),
      ),
      422,
    );
    await expectError(
      unwrap(
        publicApi.POST('/api/v1/public/catalogs/{slug}/quote-preview', {
          params: { path: { slug } },
          body: { lines: [{ productId: hidden.id, quantity: '1' }] },
        }),
      ),
      404,
    );
  });
  await check(
    'CSV clientes preserva BOM, fórmula neutralizada, filtros e paginação real',
    async () => {
      const file = await exportPage(admin, a.tenantId, {
        resource: 'customers',
        query: { status: 'all', limit: '10', sort: 'name', direction: 'asc' },
      });
      const text = new TextDecoder().decode(file.bytes);
      assert(
        new Uint8Array(file.bytes)[0] === 239 && text.includes("'=SOMA(1;1)"),
        'BOM ou neutralização ausente',
      );
      assert(file.rowCount === 2, 'contagem incorreta');
      const first = await exportPage(admin, a.tenantId, {
        resource: 'customers',
        query: { status: 'all', limit: '1', sort: 'name', direction: 'asc' },
      });
      assert(first.nextCursor, 'cursor ausente');
      const next = await exportPage(admin, a.tenantId, {
        resource: 'customers',
        query: {
          status: 'all',
          limit: '1',
          sort: 'name',
          direction: 'asc',
          cursor: first.nextCursor,
        },
      });
      assert(next.rowCount === 1 && !next.nextCursor, 'continuação incorreta');
      artifacts['customers.csv'] = createHash('sha256')
        .update(new Uint8Array(file.bytes))
        .digest('hex');
    },
  );
  await check('CSV produtos limita seleção pública e não inventa estoque', async () => {
    const file = await exportPage(admin, a.tenantId, {
      resource: 'products',
      query: { catalogVisible: 'true', categoryId: category.id, limit: '10' },
    });
    assert(file.rowCount === 1, 'filtro de produtos não aplicado');
  });
  await check('CSV pedidos respeita estado/cliente e montante comercial', async () => {
    const file = await exportPage(admin, a.tenantId, {
      resource: 'orders',
      query: { status: 'confirmed', customerId: customer.id, limit: '10', direction: 'desc' },
    });
    assert(
      file.rowCount === 1 && new TextDecoder().decode(file.bytes).includes('30,00'),
      'pedido exportado incorreto',
    );
  });
  await check('CSV recebíveis usa vencimento e saldo oficial, distinto de recebido', async () => {
    const file = await exportPage(admin, a.tenantId, {
      resource: 'receivables',
      query: {
        orderId: order.id,
        customerId: customer.id,
        status: 'open',
        from: todayIn('America/Sao_Paulo'),
        to: todayIn('America/Sao_Paulo'),
        limit: '10',
      },
    });
    assert(
      file.rowCount === 1 && new TextDecoder().decode(file.bytes).includes('30,00'),
      'saldo exportado incorreto',
    );
  });
  await check('vendedor e plataforma não exportam; empresa alheia não recebe dados', async () => {
    await expectError(exportPage(seller, a.tenantId, { resource: 'orders', query: {} }), 403);
    await expectError(exportPage(root, a.tenantId, { resource: 'receivables', query: {} }), 403);
    await expectError(
      exportPage(outside, b.tenantId, { resource: 'orders', query: { customerId: customer.id } }),
      404,
    );
  });
  await check('PDF comercial e romaneio são bytes reais com nome seguro e no-store', async () => {
    for (const kind of ['commercial', 'packing'] as const) {
      const file = await orderDocument(admin, a.tenantId, order.id, kind);
      assert(file.bytes.byteLength > 1000 && file.filename.endsWith('.pdf'), 'PDF inválido');
      writeFileSync(resolve(output, `${kind}.pdf`), new Uint8Array(file.bytes));
      artifacts[`${kind}.pdf`] = createHash('sha256')
        .update(new Uint8Array(file.bytes))
        .digest('hex');
    }
    const res = await fetch(`${base}/api/v1/orders/${order.id}/documents/commercial.pdf`, {
      headers: { Authorization: `Bearer ${a.admin.token}`, ...h },
    });
    assert(res.headers.get('cache-control')?.includes('no-store'), 'cache privado incorreto');
    await res.arrayBuffer();
  });
  await check(
    'vendedor baixa PDF próprio da carteira; outra empresa e plataforma não acessam',
    async () => {
      await orderDocument(seller, a.tenantId, order.id, 'commercial');
      await expectError(orderDocument(outside, b.tenantId, order.id, 'packing'), 404);
      await expectError(orderDocument(root, a.tenantId, order.id, 'commercial'), 403);
    },
  );
  await check('transferência de carteira revoga documento do vendedor anterior', async () => {
    const current = await unwrap(
      admin.GET('/api/v1/customers/{id}', { params: { header: h, path: { id: customer.id } } }),
    );
    await unwrap(
      admin.PATCH('/api/v1/customers/{id}/assignment', {
        params: { header: h, path: { id: customer.id } },
        body: { expectedVersion: current.version, assignedTo: null },
      }),
    );
    await expectError(orderDocument(seller, a.tenantId, order.id, 'packing'), 404);
    await orderDocument(admin, a.tenantId, order.id, 'packing');
  });
  writeFileSync(
    resolve(output, 'browser-fixture.json'),
    JSON.stringify({
      email: a.admin.email,
      password: a.admin.password,
      slug,
      orderId: order.id,
      tenantId: a.tenantId,
    }),
  );
  mkdirSync(resolve('docs/evidence'), { recursive: true });
  writeFileSync(
    resolve('docs/evidence/etapa7-e2e.json'),
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        environment: 'local API + Auth/Firestore/Storage emulators',
        results,
        artifacts,
      },
      null,
      2,
    ) + '\n',
  );
  report(['Nenhum envio WhatsApp, produção, alteração do backend ou transferência bancária.']);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'E2E falhou');
  process.exitCode = 1;
});
