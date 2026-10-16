/**
 * E2E de pedidos (Etapa 5) contra o backend real e os emuladores locais, com o cliente HTTP do
 * app. Cobre rascunho, edição com versão, confirmação com reserva, expedição, cancelamento,
 * idempotência (repetição, chave reaproveitada, resposta perdida), concorrência de estoque,
 * permissões, isolamento por empresa, recebimento que exige fluxo financeiro e carrinho de 200
 * produtos.
 *
 *   SEED_PASSWORD=<senha do seed> node ../backend/node_modules/tsx/dist/cli.mjs scripts/e2e-orders.ts
 */
import { randomUUID } from 'node:crypto';
import { unwrap, type ApiClient } from '../src/api/client';
import type { Order } from '../src/api/types';
import { toApiQuantity } from '../src/lib/quantity';
import {
  assert,
  check,
  client,
  createSeller,
  createTenant,
  expectError,
  header,
  report,
  seedPassword,
  signIn,
  e2eAddress,
} from './e2eSupport';

const DUE = '2099-01-10';
const timings: string[] = [];

async function main() {
  const root = await signIn('platform.demo@lastro.invalid', seedPassword);
  const rootApi = client(root.token, null);
  const a = await createTenant(rootApi, 'Distribuidora Pedidos A');
  const b = await createTenant(rootApi, 'Distribuidora Pedidos B');
  const t = a.tenantId;
  const h = header(t);
  const admin = client(a.admin.token, t);
  const sellerUser = await createSeller(admin, t);
  const seller = client(sellerUser.token, t);

  /* ---------- Cadastros e estoque ---------- */
  const product = async (api: ApiClient, name: string, unit: 'UN' | 'KG', priceCents: number) =>
    unwrap(
      api.POST('/api/v1/products', {
        params: { header: h },
        body: {
          name,
          sku: `E2E-${randomUUID().slice(0, 8)}`,
          categoryId: null,
          unit,
          priceCents,
          catalogVisible: false,
          minimumStock: '0',
        },
      }),
    );
  const entry = (productId: string, quantity: string) =>
    unwrap(
      admin.POST('/api/v1/inventory/entries', {
        params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
        body: { productId, quantity, reason: 'Estoque inicial E2E' },
      }),
    );
  const stock = async (productId: string) => {
    const s = await unwrap(
      admin.GET('/api/v1/inventory/{productId}', { params: { header: h, path: { productId } } }),
    );
    assert('physical' in s, 'visão de admin esperada');
    return s;
  };

  const water = await product(admin, 'Água E2E', 'UN', 250);
  const cheese = await product(admin, 'Queijo E2E', 'KG', 4590);
  await entry(water.id, '10');
  await entry(cheese.id, '5.5');

  const mine = await unwrap(
    seller.POST('/api/v1/customers', {
      params: { header: h },
      body: { address: e2eAddress, name: 'Cliente do Vendedor' },
    }),
  );
  const other = await unwrap(
    admin.POST('/api/v1/customers', {
      params: { header: h },
      body: { address: e2eAddress, name: 'Cliente sem carteira' },
    }),
  );

  const command = (
    api: ApiClient,
    kind: 'confirm' | 'dispatch',
    id: string,
    expectedVersion: number,
    key = randomUUID(),
  ) =>
    unwrap(
      api.POST(`/api/v1/orders/{id}/${kind}`, {
        params: { header: { ...h, 'Idempotency-Key': key }, path: { id } },
        body: { expectedVersion },
      }),
    ) as Promise<Order>;
  const cancel = (api: ApiClient, id: string, expectedVersion: number, key = randomUUID()) =>
    unwrap(
      api.POST('/api/v1/orders/{id}/cancel', {
        params: { header: { ...h, 'Idempotency-Key': key }, path: { id } },
        body: { expectedVersion, reason: 'Cancelamento E2E' },
      }),
    );
  const draftFor = (
    api: ApiClient,
    customerId: string,
    lines: { productId: string; quantity: string }[],
  ) =>
    unwrap(
      api.POST('/api/v1/orders', {
        params: { header: h },
        body: { customerId, lines, payment: { type: 'cash', dueDates: [DUE] } },
      }),
    );

  /* ---------- Rascunho ---------- */
  let draft!: Order;
  await check(
    'vendedor cria rascunho para cliente da carteira (UN + KG, preço do servidor)',
    async () => {
      draft = await draftFor(seller, mine.id, [
        { productId: water.id, quantity: '3' },
        { productId: cheese.id, quantity: toApiQuantity(1255) },
      ]);
      assert(draft.status === 'draft' && draft.version === 1, JSON.stringify(draft.status));
      assert(draft.sellerUid === sellerUser.uid, 'responsável deveria ser o vendedor');
      // 3 × 250 + 1,255 × 4590 (5760,45 → 5760) = 6510
      assert(draft.totalCents === 6510, `total ${draft.totalCents}`);
      assert(
        draft.lines[1]!.unitPriceCents === 4590 && draft.lines[1]!.quantity === '1.255',
        'snapshot',
      );
      assert(
        draft.installments.length === 1 && draft.installments[0]!.amountCents === 6510,
        'parcela',
      );
    },
  );

  await check('vendedor não usa cliente fora da carteira nem define responsável', async () => {
    await expectError(draftFor(seller, other.id, []), 404, 'RESOURCE_NOT_FOUND');
    await expectError(
      unwrap(
        seller.POST('/api/v1/orders', {
          params: { header: h },
          body: { customerId: mine.id, sellerUid: sellerUser.uid },
        }),
      ),
      403,
    );
  });

  await check('edição com versão: salva e recusa versão antiga (409 CONFLICT)', async () => {
    const edited = await unwrap(
      seller.PATCH('/api/v1/orders/{id}', {
        params: { header: h, path: { id: draft.id } },
        body: {
          expectedVersion: 1,
          lines: [
            { productId: water.id, quantity: '4' },
            { productId: cheese.id, quantity: '1.255' },
          ],
        },
      }),
    );
    assert(edited.version === 2 && edited.totalCents === 1000 + 5760, `total ${edited.totalCents}`);
    await expectError(
      unwrap(
        seller.PATCH('/api/v1/orders/{id}', {
          params: { header: h, path: { id: draft.id } },
          body: { expectedVersion: 1, notes: 'velho' },
        }),
      ),
      409,
      'CONFLICT',
    );
    draft = edited;
  });

  /* ---------- Confirmação e reserva ---------- */
  const confirmKey = randomUUID();
  let confirmed!: Order;
  await check('confirmação reserva o estoque atomicamente', async () => {
    const started = Date.now();
    confirmed = await command(seller, 'confirm', draft.id, draft.version, confirmKey);
    timings.push(`confirmar 2 itens: ${Date.now() - started} ms`);
    assert(confirmed.status === 'confirmed' && confirmed.version === 3, confirmed.status);
    const w = await stock(water.id);
    const c = await stock(cheese.id);
    assert(w.reserved === '4' && w.available === '6' && w.physical === '10', JSON.stringify(w));
    assert(c.reserved === '1.255' && c.available === '4.245', JSON.stringify(c));
    const moves = await unwrap(
      admin.GET('/api/v1/inventory/movements', {
        params: { header: h, query: { productId: water.id, type: 'STOCK_RESERVATION' } },
      }),
    );
    assert(moves.items.length === 1 && moves.items[0]!.origin === 'order', 'movimento automático');
  });

  await check('repetir a MESMA chave devolve o mesmo resultado, sem reservar de novo', async () => {
    const again = await command(seller, 'confirm', draft.id, draft.version, confirmKey);
    assert(
      again.version === confirmed.version && again.status === 'confirmed',
      'resultado diferente',
    );
    const w = await stock(water.id);
    assert(w.reserved === '4', `reservado ${w.reserved}`);
  });

  await check(
    'mesma chave com outro corpo é recusada; nova chave em pedido confirmado = INVALID_ORDER_STATE',
    async () => {
      await expectError(
        command(seller, 'confirm', draft.id, draft.version + 1, confirmKey),
        409,
        'CONFLICT',
      );
      await expectError(
        command(seller, 'confirm', draft.id, confirmed.version),
        409,
        'INVALID_ORDER_STATE',
      );
    },
  );

  await check('pedido confirmado não aceita edição', async () => {
    await expectError(
      unwrap(
        seller.PATCH('/api/v1/orders/{id}', {
          params: { header: h, path: { id: draft.id } },
          body: { expectedVersion: confirmed.version, notes: 'tarde demais' },
        }),
      ),
      409,
      'CONFLICT',
    );
  });

  await check('estoque insuficiente: nada reservado', async () => {
    const big = await draftFor(admin, mine.id, [{ productId: water.id, quantity: '7' }]);
    await expectError(command(admin, 'confirm', big.id, big.version), 409, 'INSUFFICIENT_STOCK');
    const w = await stock(water.id);
    assert(w.reserved === '4', `reservado ${w.reserved}`);
    await cancel(admin, big.id, big.version);
  });

  await check(
    'concorrência: duas confirmações disputando o mesmo saldo, só uma reserva',
    async () => {
      const x = await draftFor(admin, mine.id, [{ productId: water.id, quantity: '5' }]);
      const y = await draftFor(admin, mine.id, [{ productId: water.id, quantity: '5' }]);
      const settled = await Promise.allSettled([
        command(admin, 'confirm', x.id, x.version),
        command(admin, 'confirm', y.id, y.version),
      ]);
      const ok = settled.filter((s) => s.status === 'fulfilled');
      assert(ok.length === 1, `confirmações aceitas: ${ok.length}`);
      const w = await stock(water.id);
      assert(w.reserved === '9' && w.available === '1', JSON.stringify(w));
      const winner = (ok[0] as PromiseFulfilledResult<Order>).value;
      await cancel(admin, winner.id, winner.version);
      const after = await stock(water.id);
      assert(after.reserved === '4', `liberação ${after.reserved}`);
    },
  );

  await check('produto desativado depois do rascunho: PRODUCT_UNAVAILABLE', async () => {
    const temp = await product(admin, 'Produto temporário E2E', 'UN', 100);
    await entry(temp.id, '5');
    const d = await draftFor(admin, mine.id, [{ productId: temp.id, quantity: '1' }]);
    const p = await unwrap(
      admin.GET('/api/v1/products/{id}', { params: { header: h, path: { id: temp.id } } }),
    );
    await unwrap(
      admin.DELETE('/api/v1/products/{id}', {
        params: { header: h, path: { id: temp.id } },
        body: { expectedVersion: p.version },
      }),
    );
    await expectError(command(admin, 'confirm', d.id, d.version), 409, 'PRODUCT_UNAVAILABLE');
  });

  /* ---------- Expedição ---------- */
  await check('vendedor expede: reserva vira saída física; repetição não duplica', async () => {
    const key = randomUUID();
    const sent = await command(seller, 'dispatch', draft.id, confirmed.version, key);
    assert(sent.status === 'dispatched' && sent.dispatchedAt, sent.status);
    const again = await command(seller, 'dispatch', draft.id, confirmed.version, key);
    assert(again.version === sent.version, 'repetição gerou outra versão');
    const w = await stock(water.id);
    assert(w.physical === '6' && w.reserved === '0' && w.available === '6', JSON.stringify(w));
    const c = await stock(cheese.id);
    assert(c.physical === '4.245' && c.reserved === '0', JSON.stringify(c));
    await expectError(cancel(admin, draft.id, sent.version), 409, 'INVALID_ORDER_STATE');
  });

  /* ---------- Cancelamento ---------- */
  await check(
    'cancelamento: vendedor não cancela; admin cancela rascunho e confirmado',
    async () => {
      const d = await draftFor(seller, mine.id, [{ productId: water.id, quantity: '1' }]);
      await expectError(cancel(seller, d.id, d.version), 403);
      const canceledDraft = await cancel(admin, d.id, d.version);
      assert(canceledDraft.status === 'canceled' && canceledDraft.confirmedAt === null, 'rascunho');
      const c = await draftFor(seller, mine.id, [{ productId: water.id, quantity: '2' }]);
      const cc = await command(seller, 'confirm', c.id, c.version);
      assert((await stock(water.id)).reserved === '2', 'reserva');
      const canceled = await cancel(admin, cc.id, cc.version);
      assert(canceled.status === 'canceled', canceled.status);
      assert((await stock(water.id)).reserved === '0', 'liberação');
    },
  );

  await check('histórico registra criação, edição, confirmação e expedição', async () => {
    const hist = await unwrap(
      seller.GET('/api/v1/orders/{id}/history', {
        params: { header: h, path: { id: draft.id }, query: {} },
      }),
    );
    const types = hist.items.map((e) => e.type).join(',');
    assert(types === 'created,edited,confirmed,dispatched', types);
  });

  /* ---------- Pagamento cadastrado ---------- */
  await check(
    'condição cadastrada: vendedor lista opções e o servidor calcula parcelas',
    async () => {
      const cond = await unwrap(
        admin.POST('/api/v1/payment-conditions', {
          params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
          body: { name: '30/60 E2E', preset: '30_60' },
        }),
      );
      const options = await unwrap(
        seller.GET('/api/v1/orders/payment-options/conditions', {
          params: { header: h, query: {} },
        }),
      );
      assert(
        options.items.some((o) => o.id === cond.id),
        'opção ausente para o vendedor',
      );
      const d = await unwrap(
        seller.POST('/api/v1/orders', {
          params: { header: h },
          body: {
            customerId: mine.id,
            lines: [{ productId: water.id, quantity: '1' }],
            paymentConditionId: cond.id,
            paymentConditionVersion: cond.version,
          },
        }),
      );
      assert(
        d.paymentTerms?.id === cond.id && d.installments.length === 2,
        JSON.stringify(d.installments),
      );
      assert(
        d.installments[0]!.amountCents + d.installments[1]!.amountCents === d.totalCents,
        'soma',
      );
      await expectError(
        unwrap(
          seller.POST('/api/v1/orders', {
            params: { header: h },
            body: {
              customerId: mine.id,
              payment: { type: 'cash', dueDates: [DUE] },
              paymentConditionId: cond.id,
              paymentConditionVersion: cond.version,
            },
          }),
        ),
        422,
      );
    },
  );

  /* ---------- Financeiro ---------- */
  await check(
    'pedido com recebimento: cancelamento exige fluxo financeiro (nada cancelado)',
    async () => {
      const d = await draftFor(admin, mine.id, [{ productId: water.id, quantity: '1' }]);
      const conf = await command(admin, 'confirm', d.id, d.version);
      const state = await unwrap(
        admin.GET('/api/v1/orders/{id}/financial-state', {
          params: { header: h, path: { id: d.id } },
        }),
      );
      assert(
        state.titles.length === 1 && state.titles[0]!.status === 'open',
        JSON.stringify(state.titles),
      );
      const method = await unwrap(
        admin.POST('/api/v1/payment-methods', {
          params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
          body: { name: 'Pix E2E', kind: 'pix' },
        }),
      );
      const title = state.titles[0]!;
      await unwrap(
        admin.POST('/api/v1/orders/{id}/receipts', {
          params: { header: { ...h, 'Idempotency-Key': randomUUID() }, path: { id: d.id } },
          body: {
            expectedOrderVersion: state.orderVersion,
            expectedGuardVersion: state.guardVersion,
            customerId: mine.id,
            methodId: method.id,
            methodVersion: method.version,
            amountCents: 100,
            receivedOn: new Date().toISOString().slice(0, 10),
            allocations: [
              { receivableId: title.id, amountCents: 100, expectedVersion: title.version },
            ],
            reason: 'Recebimento parcial E2E',
          },
        }),
      );
      const current = await unwrap(
        admin.GET('/api/v1/orders/{id}', { params: { header: h, path: { id: d.id } } }),
      );
      await expectError(
        cancel(admin, d.id, current.version),
        409,
        'FINANCIAL_CANCELLATION_REQUIRED',
      );
      const still = await unwrap(
        admin.GET('/api/v1/orders/{id}', { params: { header: h, path: { id: d.id } } }),
      );
      assert(still.status === 'confirmed', still.status);
      const executions = await unwrap(
        admin.GET('/api/v1/financial-executions', {
          params: { header: h, query: { orderId: d.id } },
        }),
      );
      assert(executions.items.length === 0, 'nenhuma execução deveria existir');
      void conf;
    },
  );

  await check('vendedor não lê estado financeiro', async () => {
    await expectError(
      unwrap(
        seller.GET('/api/v1/orders/{id}/financial-state', {
          params: { header: h, path: { id: draft.id } },
        }),
      ),
      403,
    );
  });

  /* ---------- Visibilidade e isolamento ---------- */
  await check('vendedor lista só os próprios pedidos; admin vê todos', async () => {
    const own = await unwrap(
      seller.GET('/api/v1/orders', { params: { header: h, query: { limit: '100' } } }),
    );
    assert(
      own.items.every((o) => o.sellerUid === sellerUser.uid),
      'pedido de outro responsável',
    );
    const all = await unwrap(
      admin.GET('/api/v1/orders', { params: { header: h, query: { limit: '100' } } }),
    );
    assert(
      all.items.some((o) => o.sellerUid === a.admin.uid),
      'admin deveria ver os próprios',
    );
    assert(all.items.length > own.items.length, 'admin deveria ver mais');
    const page1 = await unwrap(
      admin.GET('/api/v1/orders', {
        params: { header: h, query: { limit: '2', status: 'canceled' } },
      }),
    );
    assert(page1.items.every((o) => o.status === 'canceled') && page1.nextCursor, 'filtro/cursor');
  });

  await check('Super Admin e outra empresa não acessam pedidos', async () => {
    await expectError(
      unwrap(client(root.token, t).GET('/api/v1/orders', { params: { header: h, query: {} } })),
      403,
    );
    const cross = client(b.admin.token, b.tenantId);
    await expectError(
      unwrap(
        cross.GET('/api/v1/orders/{id}', {
          params: { header: header(b.tenantId), path: { id: draft.id } },
        }),
      ),
      404,
    );
    await expectError(
      unwrap(
        client(a.admin.token, b.tenantId).GET('/api/v1/orders', {
          params: { header: header(b.tenantId), query: {} },
        }),
      ),
      403,
    );
  });

  /* ---------- Carrinho de 200 produtos ---------- */
  await check(
    'carrinho de 200 produtos: rascunho, confirmação (200 reservas) e expedição',
    async () => {
      const started = Date.now();
      const ids: string[] = [];
      for (let i = 0; i < 200; i += 20) {
        const batch = await Promise.all(
          Array.from({ length: 20 }, (_, j) =>
            product(admin, `Item ${String(i + j).padStart(3, '0')} E2E`, 'UN', 100 + i + j),
          ),
        );
        await Promise.all(batch.map((p) => entry(p.id, '3')));
        ids.push(...batch.map((p) => p.id));
      }
      timings.push(`cadastro + estoque de 200 produtos: ${Date.now() - started} ms`);
      let t0 = Date.now();
      const big = await draftFor(
        seller,
        mine.id,
        ids.map((productId) => ({ productId, quantity: '2' })),
      );
      timings.push(`rascunho com 200 linhas: ${Date.now() - t0} ms`);
      assert(big.lines.length === 200, `linhas ${big.lines.length}`);
      const expected = ids.reduce((acc, _, i) => acc + 2 * (100 + i), 0);
      assert(big.totalCents === expected, `total ${big.totalCents} != ${expected}`);
      t0 = Date.now();
      const conf = await command(seller, 'confirm', big.id, big.version);
      timings.push(`confirmação com 200 reservas: ${Date.now() - t0} ms`);
      const s0 = await stock(ids[0]!);
      const s199 = await stock(ids[199]!);
      assert(s0.reserved === '2' && s199.reserved === '2', 'reservas');
      t0 = Date.now();
      const sent = await command(seller, 'dispatch', big.id, conf.version);
      timings.push(`expedição com 200 saídas: ${Date.now() - t0} ms`);
      assert(sent.status === 'dispatched', sent.status);
      const after = await stock(ids[199]!);
      assert(after.physical === '1' && after.reserved === '0', JSON.stringify(after));
    },
  );

  report([...timings, `Empresa A: ${t}`]);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
