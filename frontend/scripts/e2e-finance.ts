/** Fase A: cliente HTTP do frontend + backend real, somente emuladores locais. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { unwrap } from '../src/api/client';
import { ApiError } from '../src/api/errors';
import { toReceiptBody } from '../src/features/finance/rules';
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
} from './e2eSupport';

const url = new URL(process.env.API_URL ?? 'http://127.0.0.1:3000');
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))
  throw new Error('E2E financeiro permitido somente em API local de emuladores');

async function main() {
  const platform = await signIn('platform.demo@lastro.invalid', seedPassword);
  const root = client(platform.token, null);
  const a = await createTenant(root, 'Financeiro A sintético');
  const b = await createTenant(root, 'Financeiro B sintético');
  const admin = client(a.admin.token, a.tenantId);
  const h = header(a.tenantId);
  const sellerUser = await createSeller(admin, a.tenantId);
  const seller = client(sellerUser.token, a.tenantId);
  const foreign = client(b.admin.token, b.tenantId);
  const otherHeader = header(b.tenantId);
  const customer = await unwrap(
    admin.POST('/api/v1/customers', {
      params: { header: h },
      body: { name: 'Cliente E2E financeiro' },
    }),
  );
  const product = await unwrap(
    admin.POST('/api/v1/products', {
      params: { header: h },
      body: {
        name: 'Item E2E financeiro',
        sku: `F-${randomUUID().slice(0, 8)}`,
        unit: 'UN',
        priceCents: 1000,
        categoryId: null,
        catalogVisible: false,
        minimumStock: '0',
      },
    }),
  );
  await unwrap(
    admin.POST('/api/v1/inventory/entries', {
      params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
      body: { productId: product.id, quantity: '10', reason: 'Estoque sintético E2E financeiro' },
    }),
  );
  const method = await unwrap(
    admin.POST('/api/v1/payment-methods', {
      params: { header: { ...h, 'Idempotency-Key': randomUUID() } },
      body: { name: 'Pix E2E', kind: 'pix' },
    }),
  );
  const draft = await unwrap(
    admin.POST('/api/v1/orders', {
      params: { header: h },
      body: {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: '2' }],
        payment: { type: 'installments', dueDates: ['2099-01-10', '2099-02-10'] },
      },
    }),
  );
  const order = await unwrap(
    admin.POST('/api/v1/orders/{id}/confirm', {
      params: { header: { ...h, 'Idempotency-Key': randomUUID() }, path: { id: draft.id } },
      body: { expectedVersion: draft.version },
    }),
  );
  const path = { id: order.id };
  const state = () =>
    unwrap(admin.GET('/api/v1/orders/{id}/financial-state', { params: { header: h, path } }));
  const initial = await state();
  const firstTitle = initial.titles[0]!;
  const secondTitle = initial.titles[1]!;
  const receipt = (body: ReturnType<typeof toReceiptBody>, key = randomUUID()) =>
    unwrap(
      admin.POST('/api/v1/orders/{id}/receipts', {
        params: { header: { ...h, 'Idempotency-Key': key }, path },
        body,
      }),
    );
  const values = {
    amountCents: 250,
    methodId: method.id,
    receivedOn: '2026-10-13',
    reference: 'comprovante-sintético',
    reason: 'Recebimento sintético conferido',
  };
  const partialBody = toReceiptBody(values, initial, firstTitle.id, method);
  const partialKey = randomUUID();
  let firstPaymentId = '';
  let originalOperationId = '';
  await check('parcelas oficiais nascem na confirmação (2 × 1000 centavos)', async () => {
    assert(
      initial.titles.length === 2 &&
        initial.titles.every((t) => t.originalCents === 1000 && t.outstandingCents === 1000),
      'parcelas divergentes',
    );
  });
  await check('baixa parcial usa corpo produzido pelo formulário', async () => {
    const r = await receipt(partialBody, partialKey);
    firstPaymentId = r.resourceId!;
    originalOperationId = r.operationId;
    assert(r.amountCents === 250, 'valor parcial divergente');
    const s = await state();
    assert(
      s.titles[0]?.cashCents === 250 &&
        s.titles[0]?.outstandingCents === 750 &&
        s.titles[0]?.status === 'partially_paid',
      'saldo parcial divergente',
    );
  });
  await check(
    'resposta perdida simulada após commit: mesma chave recupera operação sem duplicar',
    async () => {
      const replay = await receipt(partialBody, partialKey);
      assert(replay.operationId === originalOperationId, 'replay mudou operação');
      assert((await state()).cashReceivedCents === 250, 'recebimento duplicado');
    },
  );
  await check('mesma chave com corpo diferente é recusada', async () => {
    await expectError(receipt({ ...partialBody, reference: 'alterada' }, partialKey), 409);
  });
  await check('versões antigas recusam nova intenção', async () => {
    await expectError(receipt(partialBody), 409, 'CONFLICT');
  });
  await check('pagamento detalhado conserva forma efetiva e alocação', async () => {
    const p = await unwrap(
      admin.GET('/api/v1/payments/{id}', { params: { header: h, path: { id: firstPaymentId } } }),
    );
    assert(
      p.amountCents === 250 &&
        p.method.id === method.id &&
        p.allocations[0]?.receivableId === firstTitle.id,
      'pagamento detalhado divergente',
    );
  });
  await check('baixa total do remanescente quita parcela sem alterar segunda', async () => {
    const s = await state();
    await receipt(toReceiptBody({ ...values, amountCents: 750 }, s, firstTitle.id, method));
    const after = await state();
    assert(
      after.titles[0]?.status === 'paid' && after.titles[0]?.outstandingCents === 0,
      'primeira parcela não quitou',
    );
    assert(after.titles[1]?.outstandingCents === 1000, 'segunda parcela alterada');
  });
  await check('listagem suporta situação, cliente, pedido e período', async () => {
    const p = await unwrap(
      admin.GET('/api/v1/receivables', {
        params: {
          header: h,
          query: {
            limit: '1',
            status: 'paid',
            customerId: customer.id,
            orderId: order.id,
            from: '2099-01-10',
            to: '2099-02-10',
          },
        },
      }),
    );
    assert(p.items.length === 1 && p.items[0]?.id === firstTitle.id, 'filtros divergentes');
  });
  await check('página vazia filtrada conserva cursor para próximo título', async () => {
    const p = await unwrap(
      admin.GET('/api/v1/receivables', {
        params: { header: h, query: { limit: '1', status: 'open', orderId: order.id } },
      }),
    );
    assert(p.items.length === 0 && p.nextCursor, 'página vazia deveria conservar cursor');
    const next = await unwrap(
      admin.GET('/api/v1/receivables', {
        params: {
          header: h,
          query: { limit: '1', status: 'open', orderId: order.id, cursor: p.nextCursor },
        },
      }),
    );
    assert(next.items[0]?.id === secondTitle.id, 'continuação não encontrou parcela aberta');
  });
  await check('histórico de recebimentos pagina sem inventar total', async () => {
    const first = await unwrap(
      admin.GET('/api/v1/payments', {
        params: { header: h, query: { orderId: order.id, limit: '1' } },
      }),
    );
    assert(first.items.length === 1 && first.nextCursor, 'primeira página sem cursor');
    const next = await unwrap(
      admin.GET('/api/v1/payments', {
        params: { header: h, query: { orderId: order.id, limit: '1', cursor: first.nextCursor } },
      }),
    );
    assert(
      next.items.length === 1 && next.items[0]?.id !== first.items[0]?.id,
      'paginação duplicou pagamento',
    );
  });
  await check('histórico financeiro usa sequência e paginação oficiais', async () => {
    const first = await unwrap(
      admin.GET('/api/v1/orders/{id}/financial-history', {
        params: { header: h, path, query: { limit: '1' } },
      }),
    );
    assert(first.items[0]?.type === 'receipt' && first.nextCursor, 'evento financeiro ausente');
    const next = await unwrap(
      admin.GET('/api/v1/orders/{id}/financial-history', {
        params: { header: h, path, query: { limit: '1', cursor: first.nextCursor } },
      }),
    );
    assert(next.items[0]!.sequence > first.items[0]!.sequence, 'ordem de sequência divergente');
  });
  await check('vendedor não consulta nem registra financeiro', async () => {
    await expectError(unwrap(seller.GET('/api/v1/receivables', { params: { header: h } })), 403);
    await expectError(
      unwrap(
        seller.POST('/api/v1/orders/{id}/receipts', {
          params: { header: { ...h, 'Idempotency-Key': randomUUID() }, path },
          body: partialBody,
        }),
      ),
      403,
    );
  });
  await check('Super Admin Hepta sem vínculo não consulta tenant comercial', async () => {
    await expectError(
      unwrap(
        client(platform.token, a.tenantId).GET('/api/v1/receivables', { params: { header: h } }),
      ),
      403,
    );
  });
  await check('outra empresa não acessa título nem pagamento', async () => {
    await expectError(
      unwrap(
        foreign.GET('/api/v1/receivables/{id}', {
          params: { header: otherHeader, path: { id: firstTitle.id } },
        }),
      ),
      404,
    );
    await expectError(
      unwrap(
        foreign.GET('/api/v1/payments/{id}', {
          params: { header: otherHeader, path: { id: firstPaymentId } },
        }),
      ),
      404,
    );
    const list = await unwrap(
      foreign.GET('/api/v1/receivables', { params: { header: otherHeader } }),
    );
    assert(list.items.length === 0, 'empresa estrangeira recebeu títulos');
  });
  await check('recebimentos concorrentes com mesmas versões: apenas um aplica', async () => {
    const s = await state();
    const body = toReceiptBody({ ...values, amountCents: 100 }, s, secondTitle.id, method);
    const attempts = await Promise.allSettled([receipt(body), receipt(body)]);
    assert(
      attempts.filter((r) => r.status === 'fulfilled').length === 1,
      'concorrência aplicou duas baixas',
    );
    const loser = attempts.find((r) => r.status === 'rejected');
    assert(
      loser?.status === 'rejected' &&
        loser.reason instanceof ApiError &&
        loser.reason.status === 409 &&
        loser.reason.code === 'CONFLICT',
      'tentativa concorrente deve retornar CONFLICT',
    );
    assert((await state()).cashReceivedCents === 1100, 'saldo concorrente divergente');
  });
  await check('reconciliação paginada só conclui com complete=true', async () => {
    let cursor: string | undefined;
    let done = false;
    let checked = 0;
    for (let i = 0; i < 20; i++) {
      const r = await unwrap(
        admin.GET('/api/v1/orders/{id}/financial-reconciliation', {
          params: { header: h, path, query: { limit: '1', ...(cursor ? { cursor } : {}) } },
        }),
      );
      assert(r.consistent && r.checkedEvents >= checked, 'reconciliação inconsistente');
      checked = r.checkedEvents;
      if (r.complete) {
        assert(!r.nextCursor, 'concluiu com cursor');
        done = true;
        break;
      }
      assert(r.nextCursor, 'reconciliação incompleta sem cursor');
      cursor = r.nextCursor;
    }
    assert(done && checked === 3, `eventos reconciliados ${checked}`);
  });
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    'docs/evidence/finance-a-e2e.json',
    JSON.stringify(
      {
        phase: 'A',
        executedAt: new Date().toISOString(),
        environment: 'demo-lastro-phase-a / loopback',
        mode: 'HTTP do frontend + backend real, sem navegador ou aparelho físico',
        results,
      },
      null,
      2,
    ) + '\n',
  );
  report([
    'Dados sintéticos somente em emuladores; resposta perdida simulada pelo descarte da resposta após commit.',
  ]);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
