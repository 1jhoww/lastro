/** Casos complementares reais: dano zero/rejeitado, fontes de crédito restauradas e concorrência de início. */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { unwrap } from '../src/api/client';
import { cancellationBody, returnResolutionBody } from '../src/features/finance/resolutionRules';
import { executionPublished, todayIn } from '../src/features/orders/rules';
import {
  assert,
  check,
  client,
  createTenant,
  header,
  expectError,
  report,
  results,
  seedPassword,
  signIn,
} from './e2eSupport';
const url = new URL(process.env.API_URL ?? 'http://127.0.0.1:3000');
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))
  throw new Error('Exige API local');
async function main() {
  const platform = await signIn('platform.demo@lastro.invalid', seedPassword),
    root = client(platform.token, null);
  const a = await createTenant(root, 'Complemento C sintético'),
    api = client(a.admin.token, a.tenantId),
    h = header(a.tenantId);
  const ih = (key = randomUUID()) => ({ ...h, 'Idempotency-Key': key });
  const customer = await unwrap(
    api.POST('/api/v1/customers', {
      params: { header: h },
      body: { name: 'Cliente complemento C' },
    }),
  );
  const product = await unwrap(
    api.POST('/api/v1/products', {
      params: { header: h },
      body: {
        name: 'Produto complemento C',
        sku: randomUUID(),
        unit: 'UN',
        priceCents: 1000,
        categoryId: null,
        catalogVisible: false,
        minimumStock: '0',
      },
    }),
  );
  const method = await unwrap(
    api.POST('/api/v1/payment-methods', {
      params: { header: ih() },
      body: { name: 'Pix complemento C', kind: 'pix' },
    }),
  );
  await unwrap(
    api.POST('/api/v1/inventory/entries', {
      params: { header: ih() },
      body: { productId: product.id, quantity: '20', reason: 'Estoque C complementar' },
    }),
  );
  const state = (id: string) =>
    unwrap(api.GET('/api/v1/orders/{id}/financial-state', { params: { header: h, path: { id } } }));
  const stock = () =>
    unwrap(
      api.GET('/api/v1/inventory/{productId}', {
        params: { header: h, path: { productId: product.id } },
      }),
    );
  async function fixture(cash: number) {
    let order = await unwrap(
      api.POST('/api/v1/orders', {
        params: { header: h },
        body: {
          customerId: customer.id,
          lines: [{ productId: product.id, quantity: '1' }],
          payment: { type: 'cash', dueDates: [todayIn('America/Sao_Paulo')] },
        },
      }),
    );
    order = await unwrap(
      api.POST('/api/v1/orders/{id}/confirm', {
        params: { header: ih(), path: { id: order.id } },
        body: { expectedVersion: order.version },
      }),
    );
    if (cash) {
      const s = await state(order.id),
        t = s.titles[0]!;
      await unwrap(
        api.POST('/api/v1/orders/{id}/receipts', {
          params: { header: ih(), path: { id: order.id } },
          body: {
            expectedOrderVersion: s.orderVersion,
            expectedGuardVersion: s.guardVersion,
            customerId: customer.id,
            methodId: method.id,
            methodVersion: method.version,
            amountCents: cash,
            receivedOn: todayIn('America/Sao_Paulo'),
            allocations: [{ receivableId: t.id, expectedVersion: t.version, amountCents: cash }],
            reason: 'Recebimento C complementar',
          },
        }),
      );
    }
    return order;
  }
  for (const accept of [true, false])
    await check(
      accept
        ? 'resolução atômica de dano com aceite zero não cria dinheiro'
        : 'dano rejeitado encerra avaliação sem crédito, reembolso ou estoque vendável',
      async () => {
        const order = await fixture(1000);
        const dispatched = await unwrap(
          api.POST('/api/v1/orders/{id}/dispatch', {
            params: { header: ih(), path: { id: order.id } },
            body: { expectedVersion: order.version },
          }),
        );
        let s = await state(order.id);
        const created = await unwrap(
          api.POST('/api/v1/orders/{id}/returns', {
            params: { header: ih(), path: { id: order.id } },
            body: {
              expectedOrderVersion: s.orderVersion,
              expectedGuardVersion: s.guardVersion,
              lines: [{ lineId: dispatched.lines[0]!.id, quantity: '1' }],
              reason: 'Intenção de dano C complementar',
            },
          }),
        );
        let r = await unwrap(
          api.GET('/api/v1/returns/{id}', {
            params: { header: h, path: { id: created.returnId } },
          }),
        );
        s = await state(order.id);
        await unwrap(
          api.POST('/api/v1/returns/{id}/receipts', {
            params: { header: ih(), path: { id: r.id } },
            body: {
              expectedOrderVersion: s.orderVersion,
              expectedGuardVersion: s.guardVersion,
              expectedVersion: r.version,
              lines: [{ lineId: r.lines[0]!.lineId, damagedQuantity: '1' }],
              reason: 'Dano efetivamente recebido C',
            },
          }),
        );
        const before = await stock(),
          preview = await unwrap(
            api.GET('/api/v1/returns/{id}/resolution-preview', {
              params: { header: h, path: { id: r.id } },
            }),
          );
        const body = returnResolutionBody(preview, 'refund', 'Decisão explícita de dano C', [
            { lineId: preview.lines[0]!.lineId, accept, acceptedCents: 0 },
          ]),
          key = randomUUID();
        const result = await unwrap(
          api.POST('/api/v1/returns/{id}/resolve', {
            params: { header: ih(key), path: { id: r.id } },
            body,
          }),
        );
        const replay = await unwrap(
          api.POST('/api/v1/returns/{id}/resolve', {
            params: { header: ih(key), path: { id: r.id } },
            body,
          }),
        );
        assert(
          result.amountCents === 0 &&
            result.creditLotId === null &&
            result.refundObligationId === null &&
            result.operationId === replay.operationId,
          'zero criou destino/duplicou',
        );
        r = await unwrap(
          api.GET('/api/v1/returns/{id}', { params: { header: h, path: { id: r.id } } }),
        );
        assert(
          r.status === 'closed' &&
            (accept ? r.lines[0]?.acceptedDamaged === '1' : r.lines[0]?.rejectedDamaged === '1'),
          'avaliação não encerrada',
        );
        assert(
          JSON.stringify(await stock()) === JSON.stringify(before),
          'resolução repetiu entrada física',
        );
      },
    );
  const originOrder = await fixture(500),
    originState = await state(originOrder.id);
  const origin = await unwrap(
    api.POST('/api/v1/orders/{id}/financial-cancellation', {
      params: { header: ih(), path: { id: originOrder.id } },
      body: cancellationBody(originOrder, originState, {
        disposition: 'customer_credit',
        reason: 'Origem legítima C para restauração',
      }),
    }),
  );
  assert(origin.creditLotId, 'fonte ausente');
  const target = await fixture(250);
  let s = await state(target.id);
  const lots = await unwrap(
    api.GET('/api/v1/customers/{id}/credits', { params: { header: h, path: { id: customer.id } } }),
  );
  const source = lots.items.find((l) => l.id === origin.creditLotId)!;
  const applied = await unwrap(
    api.POST('/api/v1/orders/{id}/credit-applications', {
      params: { header: ih(), path: { id: target.id } },
      body: {
        expectedOrderVersion: s.orderVersion,
        expectedGuardVersion: s.guardVersion,
        customerId: customer.id,
        creditLotId: source.id,
        expectedLotVersion: source.version,
        amountCents: 250,
        allocations: [
          {
            receivableId: s.titles[0]!.id,
            expectedVersion: s.titles[0]!.version,
            amountCents: 250,
          },
        ],
        reason: 'Aplicação legítima C',
      },
    }),
  );
  s = await state(target.id);
  const body = cancellationBody(target, s, {
      disposition: 'refund',
      reason: 'Resolver dívida, crédito e caixa C',
    }),
    key = randomUUID();
  let e!: Awaited<ReturnType<typeof getExecution>>;
  function getExecution(id: string) {
    return unwrap(
      api.GET('/api/v1/financial-executions/{id}', { params: { header: h, path: { id } } }),
    );
  }
  await check('inícios concorrentes com mesma chave produzem mesma execução', async () => {
    const call = () =>
      unwrap(
        api.POST('/api/v1/orders/{id}/financial-cancellation-executions', {
          params: { header: ih(key), path: { id: target.id } },
          body,
        }),
      );
    const [a, b] = await Promise.all([call(), call()]);
    assert(a.id === b.id && !a.financialCompleted && !b.financialCompleted, 'duplicou início');
    e = a;
  });
  await check('mesma chave com destino diferente é recusada sem trocar decisão', async () => {
    await expectError(
      unwrap(
        api.POST('/api/v1/orders/{id}/financial-cancellation-executions', {
          params: { header: ih(key), path: { id: target.id } },
          body: { ...body, disposition: 'customer_credit' },
        }),
      ),
      409,
    );
  });
  await check('publicação retomável restaura fonte original e destina somente caixa', async () => {
    for (let step = 0; step < 60 && !executionPublished(e); step++) {
      await unwrap(
        api.POST('/api/v1/financial-executions/{id}/advance', {
          params: { header: ih(), path: { id: e.id } },
          body: { expectedRevision: e.revision, fencingToken: e.fencingToken },
        }),
      );
      e = await getExecution(e.id);
    }
    assert(executionPublished(e) && e.result?.refundObligationId, 'não publicou destino');
    const currentLots = await unwrap(
      api.GET('/api/v1/customers/{id}/credits', {
        params: { header: h, path: { id: customer.id } },
      }),
    );
    assert(
      currentLots.items.find((l) => l.id === source.id)?.availableCents === 500,
      'fonte não foi restaurada',
    );
    const application = await unwrap(
      api.GET('/api/v1/credit-applications/{id}', {
        params: { header: h, path: { id: applied.resourceId! } },
      }),
    );
    assert(
      application.restoredByCancellationCents === 250 &&
        application.allocations.every((a) => a.remainingCents === 0),
      'restauração duplicada ou origem incorreta',
    );
    const refund = await unwrap(
      api.GET('/api/v1/refund-obligations/{id}', {
        params: { header: h, path: { id: e.result.refundObligationId } },
      }),
    );
    assert(
      refund.originalCents === 250 && refund.refundedCents === 0,
      'creditou dívida/fonte restaurada como novo caixa',
    );
    const final = await state(target.id);
    assert(
      final.canceledCents === 1000 &&
        final.cashReceivedCents === 250 &&
        final.transferredCashCents === 250 &&
        final.creditSettledCents === 0,
      'conservação divergente',
    );
  });
  await check('versão antiga de cancelamento atômico é recusada sem efeitos', async () => {
    const o = await fixture(10),
      current = await state(o.id),
      wanted = cancellationBody(o, current, { disposition: 'refund', reason: 'Versão antiga C' });
    await expectError(
      unwrap(
        api.POST('/api/v1/orders/{id}/financial-cancellation', {
          params: { header: ih(), path: { id: o.id } },
          body: { ...wanted, expectedGuardVersion: wanted.expectedGuardVersion + 1 },
        }),
      ),
      409,
    );
    assert(
      (await state(o.id)).cashSettledCents === 10 && (await state(o.id)).canceledCents === 0,
      'recusa alterou saldo',
    );
  });
  writeFileSync(
    'docs/evidence/finance-c-e2e-additional.json',
    JSON.stringify(
      {
        environment: 'API real + emuladores demo locais',
        cases: results,
        passed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      },
      null,
      2,
    ) + '\n',
  );
  report();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
