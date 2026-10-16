/**
 * Fase 1 do Financeiro (reformulação de UX) contra API real local e emuladores demo.
 * Valida as regras que a nova interface assume: leitura integral do painel, observação padrão
 * do recebimento aceita pelo contrato, recusas de excesso/data futura, idempotência do
 * recebimento e integração das condições cadastradas com o editor de pedidos.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { unwrap } from '../src/api/client';
import type { FinancialState, Receivable } from '../src/api/types';
import { receivedInMonth, summarizeTitles } from '../src/features/finance/overview';
import { previewAmounts } from '../src/features/finance/schedulePreview';
import { defaultReceiptNote } from '../src/features/finance/receiptNote';
import { toReceiptBody } from '../src/features/finance/rules';
import { addDays } from '../src/lib/calendar';
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

const localUrl = new URL(process.env.API_URL ?? 'http://127.0.0.1:3000');
if (localUrl.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(localUrl.hostname))
  throw new Error('E2E da Fase 1 exige API local de emuladores');

async function main() {
  const platform = await signIn('platform.demo@lastro.invalid', seedPassword);
  const root = client(platform.token, null);
  const a = await createTenant(root, 'Financeiro Fase 1 sintético');
  const h = header(a.tenantId);
  const admin = client(a.admin.token, a.tenantId);
  const sellerUser = await createSeller(admin, a.tenantId);
  const seller = client(sellerUser.token, a.tenantId);
  const key = () => ({ ...h, 'Idempotency-Key': randomUUID() });
  const today = todayIn('America/Sao_Paulo');
  const customer = await unwrap(
    admin.POST('/api/v1/customers', {
      params: { header: h },
      body: { address: e2eAddress, name: 'Cliente Fase 1' },
    }),
  );
  const product = await unwrap(
    admin.POST('/api/v1/products', {
      params: { header: h },
      body: {
        name: 'Produto Fase 1',
        sku: `F1-${randomUUID().slice(0, 8)}`,
        unit: 'UN',
        priceCents: 7191,
        categoryId: null,
        catalogVisible: false,
        minimumStock: '0',
      },
    }),
  );
  await unwrap(
    admin.POST('/api/v1/inventory/entries', {
      params: { header: key() },
      body: { productId: product.id, quantity: '50', reason: 'Estoque sintético Fase 1' },
    }),
  );
  const pix = await unwrap(
    admin.POST('/api/v1/payment-methods', {
      params: { header: key() },
      body: { name: 'Pix', kind: 'pix' },
    }),
  );

  // Condição personalizada como a nova tela envia (entrada + 28 dias, proporção 1:2).
  const condition = await unwrap(
    admin.POST('/api/v1/payment-conditions', {
      params: { header: key() },
      body: {
        name: 'Entrada + 28',
        description: '',
        schedule: [
          { offsetDays: 0, weight: 1 },
          { offsetDays: 28, weight: 2 },
        ],
      },
    }),
  );
  await check(
    'condição cadastrada aparece nas opções do editor de pedidos (admin e vendedor)',
    async () => {
      for (const api of [admin, seller]) {
        const options = await unwrap(
          api.GET('/api/v1/orders/payment-options/conditions', {
            params: { header: h, query: { limit: '100' } },
          }),
        );
        assert(
          options.items.some((c) => c.id === condition.id),
          'condição ausente das opções de pedido',
        );
      }
    },
  );
  let order = await unwrap(
    admin.POST('/api/v1/orders', {
      params: { header: h },
      body: {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: '3' }],
        paymentConditionId: condition.id,
        paymentConditionVersion: condition.version,
      },
    }),
  );
  order = await unwrap(
    admin.POST('/api/v1/orders/{id}/confirm', {
      params: { header: key(), path: { id: order.id } },
      body: { expectedVersion: order.version },
    }),
  );
  const state = async () =>
    unwrap(
      admin.GET('/api/v1/orders/{id}/financial-state', {
        params: { header: h, path: { id: order.id } },
      }),
    );
  await check('prévia da tela coincide com parcelas e vencimentos oficiais', async () => {
    const s = await state();
    const expected = previewAmounts(order.totalCents, [1, 2]);
    assert(
      JSON.stringify(s.titles.map((t) => t.originalCents)) === JSON.stringify(expected),
      `valores ${s.titles.map((t) => t.originalCents)} ≠ prévia ${expected}`,
    );
    assert(
      s.titles[0]!.dueDate === today && s.titles[1]!.dueDate === addDays(today, 28),
      'vencimentos divergentes da prévia',
    );
  });
  const receipt = (s: FinancialState, title: Receivable, cents: number, receivedOn = today) =>
    toReceiptBody(
      {
        amountCents: cents,
        methodId: pix.id,
        receivedOn,
        reference: '',
        reason: defaultReceiptNote(title.installmentNumber),
      },
      s,
      title.id,
      pix,
    );
  await check('valor acima do saldo é recusado na montagem e pelo servidor', async () => {
    const s = await state();
    const t = s.titles[0]!;
    let local = false;
    try {
      receipt(s, t, t.outstandingCents + 1);
    } catch {
      local = true;
    }
    assert(local, 'montagem local aceitou excesso');
    const body = {
      ...receipt(s, t, t.outstandingCents),
      amountCents: t.outstandingCents + 1,
      allocations: [
        { receivableId: t.id, amountCents: t.outstandingCents + 1, expectedVersion: t.version },
      ],
    };
    await expectError(
      unwrap(
        admin.POST('/api/v1/orders/{id}/receipts', {
          params: { header: key(), path: { id: order.id } },
          body,
        }),
      ),
      409,
      'EXCESS_PAYMENT',
    );
  });
  await check('data futura é recusada pelo servidor', async () => {
    const s = await state();
    await expectError(
      unwrap(
        admin.POST('/api/v1/orders/{id}/receipts', {
          params: { header: key(), path: { id: order.id } },
          body: receipt(s, s.titles[0]!, 100, addDays(today, 1)),
        }),
      ),
      422,
      'INVALID_PAYMENT_DATE',
    );
  });
  await check('recebimento parcial com observação padrão é aceito e é idempotente', async () => {
    const s = await state();
    const t = s.titles[0]!;
    const body = receipt(s, t, 1000);
    const k = randomUUID();
    const first = await unwrap(
      admin.POST('/api/v1/orders/{id}/receipts', {
        params: { header: { ...h, 'Idempotency-Key': k }, path: { id: order.id } },
        body,
      }),
    );
    const replay = await unwrap(
      admin.POST('/api/v1/orders/{id}/receipts', {
        params: { header: { ...h, 'Idempotency-Key': k }, path: { id: order.id } },
        body,
      }),
    );
    assert(first.operationId === replay.operationId, 'replay criou outro recebimento');
    const after = await state();
    assert(
      after.titles[0]!.outstandingCents === t.outstandingCents - 1000 &&
        after.titles[0]!.status === 'partially_paid',
      'saldo parcial divergente',
    );
  });
  await check('quitação integral zera saldo e marca título como quitado', async () => {
    const s = await state();
    const t = s.titles[0]!;
    await unwrap(
      admin.POST('/api/v1/orders/{id}/receipts', {
        params: { header: key(), path: { id: order.id } },
        body: receipt(s, t, t.outstandingCents),
      }),
    );
    const after = await state();
    assert(
      after.titles[0]!.status === 'paid' && after.titles[0]!.outstandingCents === 0,
      'não quitou',
    );
  });
  await check('painel: leitura integral soma o mesmo que os títulos oficiais', async () => {
    const titles = await unwrap(
      admin.GET('/api/v1/receivables', { params: { header: h, query: { limit: '100' } } }),
    );
    const payments = await unwrap(
      admin.GET('/api/v1/payments', { params: { header: h, query: { limit: '100' } } }),
    );
    assert(!titles.nextCursor && !payments.nextCursor, 'fixture deveria caber em uma página');
    const s = summarizeTitles({ items: titles.items, complete: true }, today);
    const official = (await state()).titles.reduce((acc, t) => acc + t.outstandingCents, 0);
    assert(s.open?.cents === official, `em aberto ${s.open?.cents} ≠ oficial ${official}`);
    const received = receivedInMonth({ items: payments.items, complete: true }, today);
    const s2 = await state();
    assert(received?.cents === s2.cashReceivedCents, 'recebido no mês divergente do caixa');
  });
  await check(
    'condição desativada some das opções de pedido sem afetar pedido confirmado',
    async () => {
      const updated = await unwrap(
        admin.PATCH('/api/v1/payment-conditions/{id}', {
          params: { header: key(), path: { id: condition.id } },
          body: { expectedVersion: condition.version, status: 'inactive' },
        }),
      );
      assert(updated.status === 'inactive', 'não desativou');
      const options = await unwrap(
        admin.GET('/api/v1/orders/payment-options/conditions', {
          params: { header: h, query: { limit: '100' } },
        }),
      );
      assert(!options.items.some((c) => c.id === condition.id), 'inativa ainda oferecida');
      const confirmed = await unwrap(
        admin.GET('/api/v1/orders/{id}', { params: { header: h, path: { id: order.id } } }),
      );
      assert(confirmed.paymentTerms?.id === condition.id, 'snapshot do pedido alterado');
    },
  );
  await check('nome repetido de forma é recusado (validação de duplicidade)', async () => {
    await expectError(
      unwrap(
        admin.POST('/api/v1/payment-methods', {
          params: { header: key() },
          body: { name: ' pix ', kind: 'pix' },
        }),
      ),
      409,
      'DUPLICATE_PAYMENT_SETTING',
    );
  });
  await check('vendedor não lê títulos nem recebimentos', async () => {
    await expectError(
      unwrap(seller.GET('/api/v1/receivables', { params: { header: h, query: { limit: '25' } } })),
      403,
    );
    await expectError(
      unwrap(seller.GET('/api/v1/payments', { params: { header: h, query: { limit: '25' } } })),
      403,
    );
  });
  report();
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    'docs/evidence/finance-phase1-e2e.json',
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        api: 'local emulators (demo project)',
        results: results.map(({ name, ok, detail }) => ({
          name,
          ok,
          ...(detail ? { detail } : {}),
        })),
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
