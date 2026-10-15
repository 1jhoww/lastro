/** Fase C: cliente tipado, contratos do frontend e API/emuladores reais. Sem escrita Firestore direta. */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unwrap, type ApiClient } from '../src/api/client';
import type {
  CancellationInput,
  FinancialExecution,
  FinancialState,
  Order,
} from '../src/api/types';
import {
  cancellationBody,
  returnResolutionBody,
  appendReconciliation,
  executionResponseSchema,
} from '../src/features/finance/resolutionRules';
import { executionDone, executionPublished, todayIn } from '../src/features/orders/rules';
import { canonicalJson } from '../src/lib/intentStorageCore';
import {
  assert,
  check,
  client,
  createSeller,
  createTenant,
  createVerifiedUser,
  expectError,
  header,
  report,
  results,
  seedPassword,
  signIn,
} from './e2eSupport';
const localUrl = new URL(process.env.API_URL ?? 'http://127.0.0.1:3000');
if (localUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(localUrl.hostname))
  throw new Error('E2E C exige API local');
// Fixture respeita 429/Retry-After com a mesma requisição. Não altera limite do backend.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await originalFetch(request.clone());
    if (response.status !== 429) return response;
    const seconds = Math.max(1, Math.min(60, Number(response.headers.get('retry-after')) || 10));
    console.log(`429 local: aguardar ${seconds}s antes da mesma requisição.`);
    await response.arrayBuffer();
    await new Promise((r) => setTimeout(r, seconds * 1000));
  }
  throw new Error('Rate limit permaneceu após espera; E2E interrompido');
};

async function main() {
  const platform = await signIn('platform.demo@lastro.invalid', seedPassword),
    root = client(platform.token, null);
  const a = await createTenant(root, 'Financeiro C sintético'),
    b = await createTenant(root, 'Isolamento C sintético');
  const h = header(a.tenantId),
    outside = client(b.admin.token, b.tenantId);
  let admin = client(a.admin.token, a.tenantId);
  const sellerUser = await createSeller(admin, a.tenantId),
    seller = client(sellerUser.token, a.tenantId);
  // Plano seed tem duas vagas. A segunda conta muda de função pela API autorizada, sem alterar limites ou segurança.
  const secondIdentity = sellerUser,
    second = client(secondIdentity.token, a.tenantId);
  async function secondRole(role: 'administrator' | 'seller') {
    const users = await unwrap(
      admin.GET('/api/v1/users', {
        params: { header: header(a.tenantId), query: { limit: '100' } },
      }),
    );
    const member = users.items.find((u) => u.id === secondIdentity.uid);
    assert(member, 'segundo vínculo ausente');
    await unwrap(
      admin.PATCH('/api/v1/users/{id}/role', {
        params: { header: header(a.tenantId), path: { id: member.id } },
        body: { role, expectedVersion: member.version },
      }),
    );
  }
  const idem = (key = randomUUID()) => ({ ...h, 'Idempotency-Key': key });
  const today = todayIn('America/Sao_Paulo');
  const customer = await unwrap(
    admin.POST('/api/v1/customers', {
      params: { header: h },
      body: { name: 'Cliente C sintético' },
    }),
  );
  const product = await unwrap(
    admin.POST('/api/v1/products', {
      params: { header: h },
      body: {
        name: 'Produto C sintético',
        sku: `FC-${randomUUID().slice(0, 8)}`,
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
      params: { header: idem() },
      body: { productId: product.id, quantity: '100', reason: 'Estoque sintético C' },
    }),
  );
  const method = await unwrap(
    admin.POST('/api/v1/payment-methods', {
      params: { header: idem() },
      body: { name: 'Pix C sintético', kind: 'pix' },
    }),
  );
  const stateOf = (id: string) =>
    unwrap(
      admin.GET('/api/v1/orders/{id}/financial-state', { params: { header: h, path: { id } } }),
    );
  const orderOf = (id: string) =>
    unwrap(admin.GET('/api/v1/orders/{id}', { params: { header: h, path: { id } } }));
  const stock = () =>
    unwrap(
      admin.GET('/api/v1/inventory/{productId}', {
        params: { header: h, path: { productId: product.id } },
      }),
    );
  async function fixture(quantity = '1', payments = 1, cents = 500) {
    let order = await unwrap(
      admin.POST('/api/v1/orders', {
        params: { header: h },
        body: {
          customerId: customer.id,
          lines: [{ productId: product.id, quantity }],
          payment: { type: 'cash', dueDates: [today] },
        },
      }),
    );
    order = await unwrap(
      admin.POST('/api/v1/orders/{id}/confirm', {
        params: { header: idem(), path: { id: order.id } },
        body: { expectedVersion: order.version },
      }),
    );
    for (let i = 0; i < payments; i++) {
      const state = await stateOf(order.id),
        title = state.titles[0]!;
      await unwrap(
        admin.POST('/api/v1/orders/{id}/receipts', {
          params: { header: idem(), path: { id: order.id } },
          body: {
            expectedOrderVersion: state.orderVersion,
            expectedGuardVersion: state.guardVersion,
            customerId: customer.id,
            methodId: method.id,
            methodVersion: method.version,
            amountCents: cents,
            receivedOn: today,
            allocations: [
              { receivableId: title.id, amountCents: cents, expectedVersion: title.version },
            ],
            reason: 'Recebimento sintético C',
          },
        }),
      );
    }
    return { order: await orderOf(order.id), state: await stateOf(order.id) };
  }
  async function getExecution(id: string, api = admin) {
    const e = await unwrap(
      api.GET('/api/v1/financial-executions/{id}', { params: { header: h, path: { id } } }),
    );
    assert(executionResponseSchema.safeParse(e).success, 'view incompleta');
    return e;
  }
  async function start(
    f: { order: Order; state: FinancialState },
    disposition: CancellationInput['disposition'] = 'customer_credit',
    key = randomUUID(),
  ) {
    const body = cancellationBody(f.order, f.state, {
      disposition,
      reason: 'Cancelamento C conferido',
    });
    const response = await admin.POST('/api/v1/orders/{id}/financial-cancellation-executions', {
      params: { header: idem(key), path: { id: f.order.id } },
      body,
    });
    return {
      e: await unwrap(Promise.resolve(response)),
      key,
      body,
      http: response.response.status,
    };
  }
  async function advance(e: FinancialExecution, api = admin, key = randomUUID()) {
    return unwrap(
      api.POST('/api/v1/financial-executions/{id}/advance', {
        params: { header: idem(key), path: { id: e.id } },
        body: { expectedRevision: e.revision, fencingToken: e.fencingToken },
      }),
    );
  }
  async function finish(e: FinancialExecution, api = admin) {
    let current = e;
    for (let step = 0; step < 60 && !executionDone(current); step++) {
      assert(
        !['PAUSED', 'NEEDS_REVIEW'].includes(current.status),
        `revisão inesperada ${current.review?.code}`,
      );
      await advance(current, api);
      current = await getExecution(e.id, api);
    }
    assert(executionPublished(current), 'sem publicação comprovada');
    return current;
  }
  async function cancellationAtomic(disposition: CancellationInput['disposition']) {
    const f = await fixture(),
      key = randomUUID(),
      body = cancellationBody(f.order, f.state, { disposition, reason: 'Cancelamento atômico C' });
    const params = { header: idem(key), path: { id: f.order.id } };
    const result = await unwrap(
      admin.POST('/api/v1/orders/{id}/financial-cancellation', { params, body }),
    );
    return { ...f, params, body, result };
  }
  let atomic!: Awaited<ReturnType<typeof cancellationAtomic>>;
  await check('cancelamento atômico origina somente crédito do caixa recebido', async () => {
    atomic = await cancellationAtomic('customer_credit');
    assert(
      atomic.result.amountCents === 1000 && atomic.result.creditLotId,
      'resultado sem crédito legítimo',
    );
    const lots = await unwrap(
      admin.GET('/api/v1/customers/{id}/credits', {
        params: { header: h, path: { id: customer.id }, query: { limit: '100' } },
      }),
    );
    assert(
      lots.items.find((l) => l.id === atomic.result.creditLotId)?.issuedCents === 500,
      'creditou dívida como dinheiro',
    );
    assert((await orderOf(atomic.order.id)).status === 'canceled', 'pedido não cancelado');
  });
  await check(
    'resposta atômica perdida/replay não duplica crédito ou liberação de reserva',
    async () => {
      const before = await stock();
      const replay = await unwrap(
        admin.POST('/api/v1/orders/{id}/financial-cancellation', {
          params: atomic.params,
          body: atomic.body,
        }),
      );
      assert(replay.operationId === atomic.result.operationId, 'duplicou operação');
      assert(JSON.stringify(await stock()) === JSON.stringify(before), 'replay movimentou estoque');
      const history = await unwrap(
        admin.GET('/api/v1/orders/{id}/financial-history', {
          params: { header: h, path: { id: atomic.order.id }, query: { limit: '100' } },
        }),
      );
      assert(history.items.filter((e) => e.id === replay.eventId).length === 1, 'duplicou evento');
    },
  );
  await check('destino refund cria obrigação pendente, sem pagamento realizado', async () => {
    const f = await cancellationAtomic('refund');
    assert(f.result.refundObligationId, 'obrigação ausente');
    const obligation = await unwrap(
      admin.GET('/api/v1/refund-obligations/{id}', {
        params: { header: h, path: { id: f.result.refundObligationId } },
      }),
    );
    assert(
      obligation.outstandingCents === 500 &&
        obligation.refundedCents === 0 &&
        obligation.status === 'pending',
      'inventou devolução bancária',
    );
  });
  const resumableFixture = await fixture('1', 10, 10);
  const restartBody = cancellationBody(resumableFixture.order, resumableFixture.state, {
    disposition: 'customer_credit',
    reason: 'Reinício C após resposta perdida',
  });
  const childEnv = {
    ...process.env,
    RECOVERY_UID: a.admin.uid,
    RECOVERY_TENANT: a.tenantId,
    RECOVERY_TOKEN: a.admin.token,
    RECOVERY_ORDER: resumableFixture.order.id,
    RECOVERY_BODY: JSON.stringify(restartBody),
  };
  const worker = (mode: string) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          resolve('../backend/node_modules/tsx/dist/cli.mjs'),
          resolve('scripts/finance-c-restart-worker.ts'),
          mode,
        ],
        { cwd: process.cwd(), env: childEnv, encoding: 'utf8', timeout: 30000 },
      ),
    );
  let recovered!: FinancialExecution;
  await check(
    'novo processo recupera intenção após commit perdido sem POST automático',
    async () => {
      const prepared = worker('prepare'),
        read = worker('read');
      assert(
        prepared.key === read.key && read.posts === 0 && read.pending.length === 1,
        'reinício perdeu chave/duplicou POST',
      );
      assert(canonicalJson(read.originalBody) === canonicalJson(restartBody), 'perdeu payload');
      const replay = worker('replay');
      assert(
        replay.key === prepared.key && replay.execution.id === read.pending[0],
        'reinício duplicou execução',
      );
      recovered = replay.execution;
    },
  );
  await check('202 aceita execução e conserva visão financeira publicada anterior', async () => {
    assert(
      !recovered.financialCompleted &&
        recovered.result === null &&
        recovered.publishedAt === null &&
        recovered.blockedResources.order,
      'aceitação virou conclusão',
    );
    const state = await stateOf(recovered.orderId);
    assert(
      state.cashSettledCents === 100 && state.canceledCents === 0,
      'publicou valores preparados',
    );
  });
  await check(
    'outro início e escritores financeiros são bloqueados pelo lock oficial',
    async () => {
      await expectError(
        unwrap(
          admin.POST('/api/v1/orders/{id}/financial-cancellation-executions', {
            params: { header: idem(), path: { id: recovered.orderId } },
            body: restartBody,
          }),
        ),
        409,
      );
      const s = await stateOf(recovered.orderId),
        title = s.titles[0]!;
      await expectError(
        unwrap(
          admin.POST('/api/v1/orders/{id}/receipts', {
            params: { header: idem(), path: { id: recovered.orderId } },
            body: {
              expectedOrderVersion: s.orderVersion,
              expectedGuardVersion: s.guardVersion,
              customerId: customer.id,
              methodId: method.id,
              methodVersion: method.version,
              amountCents: 1,
              receivedOn: today,
              allocations: [
                { receivableId: title.id, amountCents: 1, expectedVersion: title.version },
              ],
              reason: 'Concorrência C',
            },
          }),
        ),
        409,
        'FINANCIAL_OPERATION_IN_PROGRESS',
      );
    },
  );
  const abortFixture = await fixture(),
    abortStart = await start(abortFixture);
  await check(
    'início retorna HTTP 202 real; abort prévio mantém dinheiro e pedido originais',
    async () => {
      assert(abortStart.http === 202, `HTTP ${abortStart.http}`);
      const response = await admin.POST('/api/v1/financial-executions/{id}/abort', {
        params: { header: idem(), path: { id: abortStart.e.id } },
        body: { expectedRevision: abortStart.e.revision, reason: 'Abort antes de aplicação C' },
      });
      const e = await unwrap(Promise.resolve(response));
      assert(
        response.response.status === 200 && e.status === 'ABORTED' && !e.financialCompleted,
        'abort equivale a cancelamento',
      );
      assert(
        (await orderOf(e.orderId)).status === 'confirmed' &&
          (await stateOf(e.orderId)).cashSettledCents === 500,
        'abort alterou economia',
      );
    },
  );
  await check('segunda sessão não avança nem assume lease ativo', async () => {
    await secondRole('administrator');
    await expectError(advance(recovered, second), 409, 'EXECUTION_LEASE_CONFLICT');
    await expectError(
      unwrap(
        second.POST('/api/v1/financial-executions/{id}/resume', {
          params: { header: idem(), path: { id: recovered.id } },
          body: { expectedRevision: recovered.revision, reason: 'Assumir lease ainda ativo' },
        }),
      ),
      409,
      'EXECUTION_LEASE_CONFLICT',
    );
  });
  await check(
    'lease expirado mantém lock; segundo administrador retoma e cerca executor anterior',
    async () => {
      const until = Date.parse(recovered.leaseUntil!);
      const waitMs = Math.max(0, until - Date.now() + 500);
      if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
      const old = await getExecution(recovered.id);
      assert(
        old.blockedResources.order && !(await stateOf(old.orderId)).canceledCents,
        'lease expirado desbloqueou pedido',
      );
      recovered = await unwrap(
        second.POST('/api/v1/financial-executions/{id}/resume', {
          params: { header: idem(), path: { id: old.id } },
          body: {
            expectedRevision: old.revision,
            reason: 'Retomada administrativa C depois do reinício',
          },
        }),
      );
      assert(
        recovered.fencingToken > old.fencingToken && recovered.revision > old.revision,
        'retomada não cercou',
      );
      await expectError(
        advance({ ...recovered, fencingToken: old.fencingToken }, admin),
        409,
        'EXECUTION_LEASE_CONFLICT',
      );
      await expectError(
        advance({ ...recovered, revision: old.revision }, second),
        409,
        'EXECUTION_CONFLICT',
      );
    },
  );
  await check(
    'passo com resposta perdida reusa chave e snapshot sem aplicar duas vezes',
    async () => {
      const original = recovered,
        key = randomUUID();
      const saved = await advance(original, second, key);
      const before = await getExecution(original.id, second),
        replay = await advance(original, second, key),
        after = await getExecution(original.id, second);
      assert(JSON.stringify(saved) === JSON.stringify(replay), 'replay mudou snapshot');
      assert(
        before.revision === after.revision &&
          JSON.stringify(before.progress) === JSON.stringify(after.progress),
        'replay aplicou outro lote',
      );
      recovered = after;
    },
  );
  await check(
    'continuação explícita publica uma única vez e rejeita abort após aplicação',
    async () => {
      let current = recovered,
        abortChecked = false;
      for (let i = 0; i < 60 && !executionDone(current); i++) {
        if (
          (current.progress.applied > 0 || current.progress.releasedReservations > 0) &&
          !abortChecked
        ) {
          await expectError(
            unwrap(
              second.POST('/api/v1/financial-executions/{id}/abort', {
                params: { header: idem(), path: { id: current.id } },
                body: { expectedRevision: current.revision, reason: 'Abort inadmissível C' },
              }),
            ),
            409,
            'EXECUTION_ABORT_NOT_ALLOWED',
          );
          abortChecked = true;
        }
        await advance(current, second);
        current = await getExecution(current.id, second);
      }
      assert(executionPublished(current), 'executor não publicou');
      recovered = current;
      const s = await stateOf(current.orderId);
      assert(
        s.cashSettledCents === 0 && s.canceledCents === 1000 && s.transferredCashCents === 100,
        'saldo final divergente',
      );
      const history = await unwrap(
        admin.GET('/api/v1/orders/{id}/financial-history', {
          params: { header: h, path: { id: current.orderId }, query: { limit: '100' } },
        }),
      );
      assert(
        history.items.filter((e) => e.id === current.result!.eventId).length === 1,
        'publicação duplicada',
      );
      const before = await stock();
      worker('replay');
      assert(
        JSON.stringify(await stock()) === JSON.stringify(before),
        'replay do início movimentou estoque',
      );
    },
  );
  await check('journal paginado só encerra com complete; contagens cumulativas', async () => {
    let cursor: string | undefined,
      previous = null,
      pages = 0;
    do {
      const p = await unwrap(
        admin.GET('/api/v1/orders/{id}/financial-reconciliation', {
          params: {
            header: h,
            path: { id: recovered.orderId },
            query: { limit: '2', ...(cursor ? { cursor } : {}) },
          },
        }),
      );
      previous = appendReconciliation(previous, { ...p, scope: 'journal' });
      cursor = p.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 50);
    assert(
      previous?.complete && previous.consistent && pages > 1,
      'journal incompleto ou divergente',
    );
  });
  await check('provas paginadas acumulam verificação oficial separada do journal', async () => {
    let cursor: string | undefined,
      previous = null,
      pages = 0;
    do {
      const p = await unwrap(
        admin.GET('/api/v1/financial-executions/{id}/proof-reconciliation', {
          params: {
            header: h,
            path: { id: recovered.id },
            query: { limit: '2', ...(cursor ? { cursor } : {}) },
          },
        }),
      );
      previous = appendReconciliation(previous, p);
      cursor = p.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 50);
    assert(
      previous?.complete &&
        previous.consistent &&
        previous.checkedEntries === previous.expectedEntries &&
        pages > 1,
      'provas incompletas',
    );
  });
  await check('cursor assinado de provas não pode mudar ator ou limite', async () => {
    const p = await unwrap(
      admin.GET('/api/v1/financial-executions/{id}/proof-reconciliation', {
        params: { header: h, path: { id: recovered.id }, query: { limit: '2' } },
      }),
    );
    assert(p.nextCursor, 'não paginou');
    await expectError(
      unwrap(
        second.GET('/api/v1/financial-executions/{id}/proof-reconciliation', {
          params: {
            header: h,
            path: { id: recovered.id },
            query: { limit: '2', cursor: p.nextCursor },
          },
        }),
      ),
      422,
    );
    await expectError(
      unwrap(
        admin.GET('/api/v1/financial-executions/{id}/proof-reconciliation', {
          params: {
            header: h,
            path: { id: recovered.id },
            query: { limit: '3', cursor: p.nextCursor },
          },
        }),
      ),
      422,
    );
  });
  await check('vendedor não consulta execução, lista ou provas nem avança', async () => {
    await secondRole('seller');
    await expectError(
      unwrap(seller.GET('/api/v1/financial-executions', { params: { header: h } })),
      403,
    );
    await expectError(
      unwrap(
        seller.GET('/api/v1/financial-executions/{id}', {
          params: { header: h, path: { id: recovered.id } },
        }),
      ),
      403,
    );
    await expectError(
      unwrap(
        seller.GET('/api/v1/financial-executions/{id}/proof-reconciliation', {
          params: { header: h, path: { id: recovered.id } },
        }),
      ),
      403,
    );
    await expectError(advance(recovered, seller), 403);
  });
  await check(
    'Super Admin não tem comércio implícito; tenant externo não encontra execução',
    async () => {
      await expectError(
        unwrap(
          client(platform.token, a.tenantId).GET('/api/v1/financial-executions', {
            params: { header: h },
          }),
        ),
        403,
      );
      await expectError(
        unwrap(
          outside.GET('/api/v1/financial-executions/{id}', {
            params: { header: header(b.tenantId), path: { id: recovered.id } },
          }),
        ),
        404,
      );
    },
  );
  await check('lista administrativa paginada encontra pendentes e terminais oficiais', async () => {
    const p = await unwrap(
      admin.GET('/api/v1/financial-executions', {
        params: { header: h, query: { pending: 'false', limit: '1' } },
      }),
    );
    assert(
      p.items.length === 1 && p.nextCursor && ['COMPLETED', 'ABORTED'].includes(p.items[0]!.status),
      'filtro terminal inválido',
    );
  });
  const returnFixture = await fixture('3', 1, 3000);
  const dispatched = await unwrap(
    admin.POST('/api/v1/orders/{id}/dispatch', {
      params: { header: idem(), path: { id: returnFixture.order.id } },
      body: { expectedVersion: returnFixture.order.version },
    }),
  );
  await check('expedido não aceita cancelamento financeiro', async () => {
    const s = await stateOf(dispatched.id);
    await expectError(
      unwrap(
        admin.POST('/api/v1/orders/{id}/financial-cancellation', {
          params: { header: idem(), path: { id: dispatched.id } },
          body: {
            expectedOrderVersion: s.orderVersion,
            expectedGuardVersion: s.guardVersion,
            disposition: 'refund',
            reason: 'Cancelamento indevido C',
          },
        }),
      ),
      409,
      'RETURN_REQUIRED',
    );
  });
  let s = await stateOf(dispatched.id);
  const intent = await unwrap(
    admin.POST('/api/v1/orders/{id}/returns', {
      params: { header: idem(), path: { id: dispatched.id } },
      body: {
        expectedOrderVersion: s.orderVersion,
        expectedGuardVersion: s.guardVersion,
        lines: [{ lineId: dispatched.lines[0]!.id, quantity: '3' }],
        reason: 'Intenção física C sintética',
      },
    }),
  );
  s = await stateOf(dispatched.id);
  let r = await unwrap(
    admin.GET('/api/v1/returns/{id}', { params: { header: h, path: { id: intent.returnId } } }),
  );
  await unwrap(
    admin.POST('/api/v1/returns/{id}/receipts', {
      params: { header: idem(), path: { id: r.id } },
      body: {
        expectedOrderVersion: s.orderVersion,
        expectedGuardVersion: s.guardVersion,
        expectedVersion: r.version,
        lines: [{ lineId: r.lines[0]!.lineId, sellableQuantity: '1', damagedQuantity: '1' }],
        reason: 'Recebimento físico real C sintético',
      },
    }),
  );
  const beforeResolutionStock = await stock();
  const preview = await unwrap(
    admin.GET('/api/v1/returns/{id}/resolution-preview', {
      params: { header: h, path: { id: r.id } },
    }),
  );
  await check(
    'preview de devolução usa somente recebido oficial e limita dano em centavos',
    async () => {
      r = await unwrap(
        admin.GET('/api/v1/returns/{id}', { params: { header: h, path: { id: r.id } } }),
      );
      assert(
        r.lines[0]?.pending === '1' &&
          preview.lines[0]?.sellableQuantity === '1' &&
          preview.lines[0]?.damagedQuantity === '1' &&
          preview.lines[0]?.damagedLimitCents === 1000,
        'preview inferiu físico',
      );
    },
  );
  await check('dano sem decisão ou acima do limite é recusado', async () => {
    const body = {
      expectedOrderVersion: preview.expectedOrderVersion,
      expectedGuardVersion: preview.expectedGuardVersion,
      expectedVersion: preview.expectedVersion,
      disposition: 'refund' as const,
      reason: 'Dano C sem aceite',
    };
    await expectError(
      unwrap(
        admin.POST('/api/v1/returns/{id}/resolve', {
          params: { header: idem(), path: { id: r.id } },
          body,
        }),
      ),
      422,
    );
    await expectError(
      unwrap(
        admin.POST('/api/v1/returns/{id}/resolve', {
          params: { header: idem(), path: { id: r.id } },
          body: {
            ...body,
            damagedDecisions: [
              { lineId: preview.lines[0]!.lineId, accept: true, acceptedCents: 1001 },
            ],
          },
        }),
      ),
      409,
      'RETURN_VALUE_LIMIT',
    );
  });
  const returnBody = returnResolutionBody(preview, 'refund', 'Aceite parcial de dano C', [
    { lineId: preview.lines[0]!.lineId, accept: true, acceptedCents: 250 },
  ]);
  let returnExecution = await unwrap(
    admin.POST('/api/v1/returns/{id}/resolution-executions', {
      params: { header: idem(), path: { id: r.id } },
      body: returnBody,
    }),
  );
  await check(
    'resolução retomável da devolução publica parcial e mantém pendência física',
    async () => {
      returnExecution = await finish(returnExecution);
      const current = await unwrap(
        admin.GET('/api/v1/returns/{id}', { params: { header: h, path: { id: r.id } } }),
      );
      assert(
        current.lines[0]?.valueResolvedCents === 1250 &&
          current.lines[0]?.damagedValueReductionCents === 750 &&
          current.lines[0]?.pending === '1' &&
          current.status !== 'closed',
        'resolução parcial encerrou físico ou inventou valor',
      );
      const state = await stateOf(dispatched.id);
      assert(
        state.activeReturnCount === 1 && state.canceledCents === 1250,
        'bloqueio físico indevidamente liberado',
      );
      assert(
        JSON.stringify(await stock()) === JSON.stringify(beforeResolutionStock),
        'executor recebeu estoque novamente',
      );
    },
  );
  await check('obrigação da devolução não representa transferência bancária', async () => {
    assert(returnExecution.result?.refundObligationId, 'obrigação ausente');
    const obligation = await unwrap(
      admin.GET('/api/v1/refund-obligations/{id}', {
        params: { header: h, path: { id: returnExecution.result.refundObligationId } },
      }),
    );
    assert(
      obligation.originalCents === 1250 &&
        obligation.outstandingCents === 1250 &&
        obligation.refundedCents === 0,
      'reembolso foi simulado',
    );
  });
  await check(
    'histórico por ID identifica sequência e resolução publicada apenas uma vez',
    async () => {
      const history = await unwrap(
        admin.GET('/api/v1/returns/{id}/history', {
          params: { header: h, path: { id: r.id }, query: { limit: '100' } },
        }),
      );
      assert(
        history.items.filter((e) => e.type === 'resolved').length === 1 &&
          history.items.every((e) => e.sequence > 0),
        'histórico duplicado/incompleto',
      );
    },
  );
  // 101 fontes reais demonstram seleção técnica; nunca executar cenário de 20.000 nesta fase.
  const freshAdmin = await signIn(a.admin.email, a.admin.password);
  admin = client(freshAdmin.token, a.tenantId);
  const large = await fixture('1', 101, 1);
  await check('101 recebimentos reais exigem retomável sem efeito atômico parcial', async () => {
    const body = cancellationBody(large.order, large.state, {
      disposition: 'customer_credit',
      reason: 'Histórico representativo C',
    });
    await expectError(
      unwrap(
        admin.POST('/api/v1/orders/{id}/financial-cancellation', {
          params: { header: idem(), path: { id: large.order.id } },
          body,
        }),
      ),
      409,
      'FINANCIAL_RESUMABLE_REQUIRED',
    );
    assert((await stateOf(large.order.id)).cashSettledCents === 101, 'recusa teve efeito');
    const began = await start(large);
    const end = await finish(began.e);
    assert(
      end.result?.creditLotId && (await stateOf(large.order.id)).transferredCashCents === 101,
      'histórico não completou',
    );
  });
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    'docs/evidence/finance-c-e2e.json',
    JSON.stringify(
      {
        phase: 'C',
        api: 'OpenAPI 0.8.1',
        environment: 'Auth/Firestore/Storage Emulator demo local',
        cases: results,
        passed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        representativeRealReceipts: [10, 101],
        processRestart:
          'Três processos Node distintos; adapter de fragmentos do frontend com KV de disco de teste; leitura GET sem POST e replay original.',
        limitations: [
          'Não é teste de Keychain/Keystore físico.',
          'Não executa 20.000 fontes, produção, deploy ou banco.',
        ],
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
