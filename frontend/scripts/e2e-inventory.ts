/**
 * E2E do estoque (Etapa 4) contra o backend real e os emuladores locais.
 *
 * Usa o mesmo cliente HTTP do app (`src/api/client.ts`) e as mesmas conversões de quantidade
 * (`src/lib/quantity.ts`). Cria dados sintéticos (@lastro.invalid) só no emulador.
 *
 * Pré-requisitos: emuladores (`npm run emulators`), seed (`npm run seed:local`) e API
 * (`npm run dev`) rodando no backend. Uso:
 *
 *   SEED_PASSWORD=<senha do seed> node ../backend/node_modules/tsx/dist/cli.mjs scripts/e2e-inventory.ts
 */
import { randomUUID } from 'node:crypto';
import { unwrap } from '../src/api/client';
import { fromApiQuantity, toApiQuantity } from '../src/lib/quantity';
import {
  assert,
  check,
  client,
  createTenant,
  createVerifiedUser,
  expectError,
  header,
  report,
  seedPassword,
  signIn,
} from './e2eSupport';

async function main() {
  const root = await signIn('platform.demo@lastro.invalid', seedPassword!);
  const rootApi = client(root.token, null);
  const a = await createTenant(rootApi, 'Distribuidora E2E A');
  const b = await createTenant(rootApi, 'Distribuidora E2E B');
  const t = a.tenantId;
  const admin = client(a.admin.token, t);
  const h = header(t);

  // Vendedor da empresa A.
  const sellerEmail = `vendedor.${randomUUID().slice(0, 8)}@lastro.invalid`;
  const invite = await unwrap(
    admin.POST('/api/v1/users/invitations', {
      params: { header: h },
      body: { email: sellerEmail, role: 'seller' },
    }),
  );
  const sellerUser = await createVerifiedUser(sellerEmail);
  await unwrap(
    client(sellerUser.token, null).POST('/api/v1/users/invitations/accept', {
      body: { token: invite.token },
    }),
  );
  const seller = client(sellerUser.token, t);

  // Produtos: UN com mínimo 10 e KG com mínimo 2,5.
  const un = await unwrap(
    admin.POST('/api/v1/products', {
      params: { header: h },
      body: {
        name: 'Água E2E 500 ml',
        sku: `AGUA-${randomUUID().slice(0, 6)}`,
        categoryId: null,
        unit: 'UN',
        priceCents: 250,
        catalogVisible: false,
        minimumStock: '10',
      },
    }),
  );
  const kg = await unwrap(
    admin.POST('/api/v1/products', {
      params: { header: h },
      body: {
        name: 'Queijo E2E',
        sku: `QJ-${randomUUID().slice(0, 6)}`,
        categoryId: null,
        unit: 'KG',
        priceCents: 4590,
        catalogVisible: false,
        minimumStock: '2.5',
      },
    }),
  );

  await check('saldo inicial: produto novo com zero e abaixo do mínimo', async () => {
    const s = await unwrap(
      admin.GET('/api/v1/inventory/{productId}', {
        params: { header: h, path: { productId: un.id } },
      }),
    );
    assert('physical' in s, 'admin deveria ver a visão completa');
    assert(s.physical === '0' && s.reserved === '0' && s.available === '0', JSON.stringify(s));
    assert(s.minimumStock === '10' && s.suggestedQuantity === '10', JSON.stringify(s));
  });

  const entryKey = randomUUID();
  const entryBody = { productId: un.id, quantity: toApiQuantity(25_000), reason: 'NF E2E 1' };
  let firstMovementId = '';
  await check('entrada com Idempotency-Key soma ao físico', async () => {
    const r = await unwrap(
      admin.POST('/api/v1/inventory/entries', {
        params: { header: { ...h, 'Idempotency-Key': entryKey } },
        body: entryBody,
      }),
    );
    firstMovementId = r.movement.id;
    assert(
      r.movement.type === 'STOCK_ENTRY' && r.movement.quantity === '25',
      JSON.stringify(r.movement),
    );
    assert(
      r.stock.physical === '25' && r.stock.available === '25' && r.stock.version === 1,
      JSON.stringify(r.stock),
    );
  });

  await check('repetir a MESMA chave e corpo devolve o mesmo resultado, sem duplicar', async () => {
    const r = await unwrap(
      admin.POST('/api/v1/inventory/entries', {
        params: { header: { ...h, 'Idempotency-Key': entryKey } },
        body: entryBody,
      }),
    );
    assert(r.movement.id === firstMovementId, 'movimento diferente na repetição');
    const s = await unwrap(
      admin.GET('/api/v1/inventory/{productId}', {
        params: { header: h, path: { productId: un.id } },
      }),
    );
    assert('physical' in s && s.physical === '25', `físico ${JSON.stringify(s)}`);
  });

  await check('mesma chave com outro corpo é recusada (409 CONFLICT)', async () => {
    await expectError(
      unwrap(
        admin.POST('/api/v1/inventory/entries', {
          params: { header: { ...h, 'Idempotency-Key': entryKey } },
          body: { ...entryBody, quantity: '26' },
        }),
      ),
      409,
      'CONFLICT',
    );
  });

  await check('sem Idempotency-Key a entrada é recusada', async () => {
    await expectError(
      unwrap(
        admin.POST('/api/v1/inventory/entries', {
          params: { header: { ...h, 'Idempotency-Key': undefined as unknown as string } },
          body: { ...entryBody, reason: 'Sem chave' },
        }),
      ),
      422,
    );
  });

  await check('UN recusa fração (INVALID_PRECISION)', async () => {
    await expectError(
      unwrap(
        admin.POST('/api/v1/inventory/entries', {
          params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
          body: { productId: un.id, quantity: '1.5', reason: 'Fração' },
        }),
      ),
      422,
      'INVALID_PRECISION',
    );
  });

  await check('KG aceita 3 casas e recusa 4', async () => {
    const r = await unwrap(
      admin.POST('/api/v1/inventory/entries', {
        params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
        body: { productId: kg.id, quantity: toApiQuantity(1_255), reason: 'NF E2E KG' },
      }),
    );
    assert(
      r.stock.physical === '1.255' && fromApiQuantity(r.stock.physical) === 1_255,
      r.stock.physical,
    );
    await expectError(
      unwrap(
        admin.POST('/api/v1/inventory/entries', {
          params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
          body: { productId: kg.id, quantity: '0.0001', reason: 'Quatro casas' },
        }),
      ),
      422,
    );
  });

  await check('ajuste usa a versão do ESTOQUE; versão antiga dá 409 CONFLICT', async () => {
    const s = await unwrap(
      admin.GET('/api/v1/inventory/{productId}', {
        params: { header: h, path: { productId: un.id } },
      }),
    );
    assert('version' in s, 'sem versão');
    const product = await unwrap(
      admin.GET('/api/v1/products/{id}', { params: { header: h, path: { id: un.id } } }),
    );
    assert(
      product.version !== s.version || product.version === 1,
      'versões deveriam ser independentes',
    );
    await expectError(
      unwrap(
        admin.POST('/api/v1/inventory/adjustments', {
          params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
          body: {
            productId: un.id,
            delta: '-1',
            expectedVersion: s.version - 1,
            reason: 'Versão velha',
          },
        }),
      ),
      409,
      'CONFLICT',
    );
    const r = await unwrap(
      admin.POST('/api/v1/inventory/adjustments', {
        params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
        body: {
          productId: un.id,
          delta: toApiQuantity(-3_000),
          expectedVersion: s.version,
          reason: 'Avaria E2E',
        },
      }),
    );
    assert(
      r.movement.type === 'STOCK_ADJUSTMENT_OUT' && r.stock.physical === '22',
      JSON.stringify(r),
    );
  });

  await check('retirar além do disponível dá 409 INSUFFICIENT_STOCK', async () => {
    const s = await unwrap(
      admin.GET('/api/v1/inventory/{productId}', {
        params: { header: h, path: { productId: un.id } },
      }),
    );
    assert('version' in s, 'sem versão');
    await expectError(
      unwrap(
        admin.POST('/api/v1/inventory/adjustments', {
          params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
          body: { productId: un.id, delta: '-23', expectedVersion: s.version, reason: 'Demais' },
        }),
      ),
      409,
      'INSUFFICIENT_STOCK',
    );
  });

  await check('histórico: filtros por produto e tipo, paginação por cursor', async () => {
    const p1 = await unwrap(
      admin.GET('/api/v1/inventory/movements', {
        params: { header: h, query: { productId: un.id, limit: '1', direction: 'desc' } },
      }),
    );
    assert(p1.items.length === 1 && p1.nextCursor, 'primeira página sem cursor');
    assert(p1.items[0]!.type === 'STOCK_ADJUSTMENT_OUT', p1.items[0]!.type);
    const p2 = await unwrap(
      admin.GET('/api/v1/inventory/movements', {
        params: {
          header: h,
          query: { productId: un.id, limit: '1', direction: 'desc', cursor: p1.nextCursor },
        },
      }),
    );
    assert(p2.items[0]?.id === firstMovementId, 'segunda página deveria ser a entrada');
    const entries = await unwrap(
      admin.GET('/api/v1/inventory/movements', {
        params: {
          header: h,
          query: { type: 'STOCK_ENTRY', from: new Date(Date.now() - 86_400_000).toISOString() },
        },
      }),
    );
    assert(
      entries.items.length === 2 && entries.items.every((m) => m.type === 'STOCK_ENTRY'),
      'filtro de tipo',
    );
    assert(
      entries.items.every((m) => m.actorUid === a.admin.uid && m.origin === 'administrative'),
      'responsável/origem',
    );
  });

  await check('reposição lista só quem está abaixo do mínimo, ordenada pela falta', async () => {
    const r = await unwrap(
      admin.GET('/api/v1/inventory/replenishment', {
        params: { header: h, query: { sort: 'shortfall', direction: 'desc' } },
      }),
    );
    // UN: 22 ≥ 10 (fora). KG: 1,255 < 2,5 (falta 1,245).
    assert(r.items.length === 1 && r.items[0]!.productId === kg.id, JSON.stringify(r.items));
    assert(r.items[0]!.suggestedQuantity === '1.245', r.items[0]!.suggestedQuantity);
    const byName = await unwrap(
      admin.GET('/api/v1/inventory/replenishment', {
        params: { header: h, query: { q: 'quei', sort: 'name', direction: 'asc' } },
      }),
    );
    assert(byName.items.length === 1, 'busca por prefixo');
    await expectError(
      unwrap(
        admin.GET('/api/v1/inventory/replenishment', {
          params: { header: h, query: { q: 'quei', sort: 'shortfall', direction: 'desc' } },
        }),
      ),
      422,
      'VALIDATION_ERROR',
    );
  });

  await check('lista de saldos: busca por prefixo e SKU exato', async () => {
    const byName = await unwrap(
      admin.GET('/api/v1/inventory', {
        params: { header: h, query: { q: 'água', sort: 'name', direction: 'asc' } },
      }),
    );
    assert(
      byName.items.length === 1 && byName.items[0]!.productId === un.id,
      JSON.stringify(byName.items),
    );
    const bySku = await unwrap(
      admin.GET('/api/v1/inventory', {
        params: { header: h, query: { sku: kg.sku.toLowerCase() } },
      }),
    );
    assert(bySku.items.length === 1 && bySku.items[0]!.productId === kg.id, 'sku');
  });

  await check('vendedor vê só o disponível', async () => {
    const list = await unwrap(
      seller.GET('/api/v1/inventory', { params: { header: h, query: {} } }),
    );
    assert(list.items.length === 2, `itens ${list.items.length}`);
    for (const item of list.items) {
      assert(
        !('physical' in item) && !('reserved' in item) && !('version' in item),
        JSON.stringify(item),
      );
      assert('available' in item, 'sem disponível');
    }
    const one = await unwrap(
      seller.GET('/api/v1/inventory/{productId}', {
        params: { header: h, path: { productId: un.id } },
      }),
    );
    assert(!('physical' in one) && one.available === '22', JSON.stringify(one));
  });

  await check('vendedor não registra entrada, ajuste, histórico nem reposição (403)', async () => {
    await expectError(
      unwrap(
        seller.POST('/api/v1/inventory/entries', {
          params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
          body: { productId: un.id, quantity: '1', reason: 'Vendedor' },
        }),
      ),
      403,
    );
    await expectError(
      unwrap(
        seller.POST('/api/v1/inventory/adjustments', {
          params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
          body: { productId: un.id, delta: '1', expectedVersion: 0, reason: 'Vendedor' },
        }),
      ),
      403,
    );
    await expectError(
      unwrap(seller.GET('/api/v1/inventory/movements', { params: { header: h, query: {} } })),
      403,
    );
    await expectError(
      unwrap(seller.GET('/api/v1/inventory/replenishment', { params: { header: h, query: {} } })),
      403,
    );
    await expectError(
      unwrap(seller.GET('/api/v1/inventory', { params: { header: h, query: { status: 'all' } } })),
      403,
    );
  });

  await check('Super Admin não lê estoque de empresa', async () => {
    const asRoot = client(root.token, t);
    await expectError(
      unwrap(asRoot.GET('/api/v1/inventory', { params: { header: h, query: {} } })),
      403,
    );
  });

  await check('isolamento: admin da empresa A não lê nem movimenta a empresa B', async () => {
    const cross = client(a.admin.token, b.tenantId);
    await expectError(
      unwrap(cross.GET('/api/v1/inventory', { params: { header: header(b.tenantId), query: {} } })),
      403,
    );
    await expectError(
      unwrap(
        cross.POST('/api/v1/inventory/entries', {
          params: { header: { ...header(b.tenantId), 'Idempotency-Key': randomUUID() } },
          body: { productId: un.id, quantity: '1', reason: 'Cruzado' },
        }),
      ),
      403,
    );
    const bAdmin = client(b.admin.token, b.tenantId);
    const listB = await unwrap(
      bAdmin.GET('/api/v1/inventory', { params: { header: header(b.tenantId), query: {} } }),
    );
    assert(listB.items.length === 0, 'empresa B não deveria ver produtos da A');
    await expectError(
      unwrap(
        bAdmin.GET('/api/v1/inventory/{productId}', {
          params: { header: header(b.tenantId), path: { productId: un.id } },
        }),
      ),
      404,
    );
  });

  await check('reconciliação confirma a cadeia de movimentos', async () => {
    const r = await unwrap(
      admin.GET('/api/v1/inventory/{productId}/reconciliation', {
        params: { header: h, path: { productId: un.id }, query: {} },
      }),
    );
    assert(r.complete && r.consistent && r.physical === '22', JSON.stringify(r));
  });

  report([`Empresa A: ${t} · produtos ${un.id} (UN) e ${kg.id} (KG)`]);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
