/** Fase B via cliente do frontend e API real local. Cancelamentos atômicos preparam fontes legítimas no emulador. Nenhum executor F02 é iniciado. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { unwrap } from '../src/api/client';
import { ApiError } from '../src/api/errors';
import type {
  CreditApplication,
  CreditLot,
  FinancialResult,
  Order,
  Payment,
  RefundObligation,
} from '../src/api/types';
import {
  buildEconomicCommand,
  emptyEconomicValues,
  discountBody,
} from '../src/features/finance/administrationRules';
import type { EconomicCommand } from '../src/features/finance/commands';
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
  throw new Error('E2E B exige API local de emuladores');
async function main() {
  const platform = await signIn('platform.demo@lastro.invalid', seedPassword);
  const root = client(platform.token, null);
  const a = await createTenant(root, 'Financeiro B A sintético');
  const b = await createTenant(root, 'Financeiro B B sintético');
  const h = header(a.tenantId);
  const admin = client(a.admin.token, a.tenantId);
  const other = client(b.admin.token, b.tenantId);
  const sellerUser = await createSeller(admin, a.tenantId);
  const seller = client(sellerUser.token, a.tenantId);
  const idempotent = () => ({ ...h, 'Idempotency-Key': randomUUID() });
  const today = todayIn('America/Sao_Paulo');
  const customer = await unwrap(
    admin.POST('/api/v1/customers', {
      params: { header: h },
      body: { address: e2eAddress, name: 'Cliente financeiro B sintético' },
    }),
  );
  const product = await unwrap(
    admin.POST('/api/v1/products', {
      params: { header: h },
      body: {
        name: 'Produto B sintético',
        sku: `FB-${randomUUID().slice(0, 8)}`,
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
      params: { header: idempotent() },
      body: { productId: product.id, quantity: '20', reason: 'Estoque sintético para B' },
    }),
  );
  const methodKey = randomUUID();
  const methodBody = { name: 'Pix B sintético', kind: 'pix' as const };
  let method = await unwrap(
    admin.POST('/api/v1/payment-methods', {
      params: { header: { ...h, 'Idempotency-Key': methodKey } },
      body: methodBody,
    }),
  );
  let condition = await unwrap(
    admin.POST('/api/v1/payment-conditions', {
      params: { header: idempotent() },
      body: { name: '30 e 60 B', preset: '30_60' },
    }),
  );
  await check('presets e forma recebem versões e status oficiais', async () => {
    assert(
      method.status === 'active' &&
        method.version === 1 &&
        condition.schedule[0]?.offsetDays === 30 &&
        condition.schedule[1]?.offsetDays === 60,
      'cadastro divergente',
    );
  });
  await check('criação de forma é idempotente com resposta original', async () => {
    const replay = await unwrap(
      admin.POST('/api/v1/payment-methods', {
        params: { header: { ...h, 'Idempotency-Key': methodKey } },
        body: methodBody,
      }),
    );
    assert(replay.id === method.id && replay.version === 1, 'duplicou forma');
    await expectError(
      unwrap(
        admin.POST('/api/v1/payment-methods', {
          params: { header: { ...h, 'Idempotency-Key': methodKey } },
          body: { name: 'Corpo alterado', kind: 'cash' },
        }),
      ),
      409,
    );
  });
  await check('condição personalizada aceita doze parcelas e pesos', async () => {
    const c = await unwrap(
      admin.POST('/api/v1/payment-conditions', {
        params: { header: idempotent() },
        body: {
          name: 'Doze parcelas B',
          schedule: Array.from({ length: 12 }, (_, i) => ({ offsetDays: i * 30, weight: i + 1 })),
        },
      }),
    );
    assert(c.schedule.length === 12 && c.schedule[11]?.weight === 12, 'perdeu prazo/peso');
  });
  await check('prazos fora de ordem e pesos inválidos são recusados', async () => {
    await expectError(
      unwrap(
        admin.POST('/api/v1/payment-conditions', {
          params: { header: idempotent() },
          body: {
            name: 'Inválida B',
            schedule: [
              { offsetDays: 30, weight: 1 },
              { offsetDays: 0, weight: 0 },
            ],
          },
        }),
      ),
      422,
    );
  });
  let draft = await unwrap(
    admin.POST('/api/v1/orders', {
      params: { header: h },
      body: {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: '2' }],
        paymentConditionId: condition.id,
        paymentConditionVersion: condition.version,
        intendedPaymentMethodId: method.id,
        intendedPaymentMethodVersion: method.version,
      },
    }),
  );
  await check('preview comercial usa condição e método ativos sem liquidar', async () => {
    const preview = await unwrap(
      admin.POST('/api/v1/orders/{id}/payment-preview', {
        params: { header: h, path: { id: draft.id } },
        body: {
          expectedVersion: draft.version,
          paymentConditionId: condition.id,
          paymentConditionVersion: condition.version,
          intendedPaymentMethodId: method.id,
          intendedPaymentMethodVersion: method.version,
        },
      }),
    );
    assert(preview.installments.length === 2, 'preview sem parcelas');
  });
  await check('desconto administrativo aprova somente rascunho e registra snapshot', async () => {
    draft = await unwrap(
      admin.PATCH('/api/v1/orders/{id}', {
        params: { header: h, path: { id: draft.id } },
        body: discountBody(draft.version, {
          type: 'fixed',
          value: 100,
          reason: 'Aprovação B sintética',
        }),
      }),
    );
    assert(
      draft.discount?.approvedBy === a.admin.uid &&
        draft.discount.approvedVersion === draft.version &&
        draft.discountCents === 100 &&
        draft.totalCents === 1900,
      'aprovação/snapshot divergente',
    );
  });
  let target = await unwrap(
    admin.POST('/api/v1/orders/{id}/confirm', {
      params: { header: idempotent(), path: { id: draft.id } },
      body: { expectedVersion: draft.version },
    }),
  );
  const originalTerms = JSON.stringify(target.paymentTerms);
  const originalMethod = JSON.stringify(target.intendedPaymentMethod);
  const originalDiscount = JSON.stringify(target.discount);
  await check('desativação de cadastro preserva snapshots confirmados', async () => {
    condition = await unwrap(
      admin.PATCH('/api/v1/payment-conditions/{id}', {
        params: { header: idempotent(), path: { id: condition.id } },
        body: {
          expectedVersion: condition.version,
          name: 'Condição alterada B',
          status: 'inactive',
          schedule: [{ offsetDays: 90, weight: 1 }],
        },
      }),
    );
    method = await unwrap(
      admin.PATCH('/api/v1/payment-methods/{id}', {
        params: { header: idempotent(), path: { id: method.id } },
        body: { expectedVersion: method.version, name: 'Pix B alterado', status: 'inactive' },
      }),
    );
    target = await unwrap(
      admin.GET('/api/v1/orders/{id}', { params: { header: h, path: { id: target.id } } }),
    );
    assert(
      JSON.stringify(target.paymentTerms) === originalTerms &&
        JSON.stringify(target.intendedPaymentMethod) === originalMethod &&
        JSON.stringify(target.discount) === originalDiscount,
      'snapshot histórico alterado',
    );
  });
  await check('versão antiga de cadastro recebe conflito', async () => {
    await expectError(
      unwrap(
        admin.PATCH('/api/v1/payment-methods/{id}', {
          params: { header: idempotent(), path: { id: method.id } },
          body: { expectedVersion: 1, status: 'active' },
        }),
      ),
      409,
      'CONFLICT',
    );
  });
  await check('opções ativas deixam de listar condições e formas desativadas', async () => {
    const conditions = await unwrap(
      admin.GET('/api/v1/orders/payment-options/conditions', { params: { header: h } }),
    );
    const methods = await unwrap(
      admin.GET('/api/v1/orders/payment-options/methods', { params: { header: h } }),
    );
    assert(
      !conditions.items.some((c) => c.id === condition.id) &&
        !methods.items.some((m) => m.id === method.id),
      'cadastro inativo ofertado',
    );
  });
  await check('reativação e GET individual conservam versão oficial', async () => {
    condition = await unwrap(
      admin.PATCH('/api/v1/payment-conditions/{id}', {
        params: { header: idempotent(), path: { id: condition.id } },
        body: { expectedVersion: condition.version, status: 'active' },
      }),
    );
    method = await unwrap(
      admin.PATCH('/api/v1/payment-methods/{id}', {
        params: { header: idempotent(), path: { id: method.id } },
        body: { expectedVersion: method.version, status: 'active' },
      }),
    );
    const c = await unwrap(
      admin.GET('/api/v1/payment-conditions/{id}', {
        params: { header: h, path: { id: condition.id } },
      }),
    );
    const m = await unwrap(
      admin.GET('/api/v1/payment-methods/{id}', { params: { header: h, path: { id: method.id } } }),
    );
    assert(
      c.status === 'active' && m.status === 'active' && m.version === 3,
      'reativação divergente',
    );
  });
  await check('desconto em confirmado é recusado sem alterar snapshot', async () => {
    await expectError(
      unwrap(
        admin.PATCH('/api/v1/orders/{id}', {
          params: { header: h, path: { id: target.id } },
          body: discountBody(target.version, {
            type: 'fixed',
            value: 200,
            reason: 'Tentativa inválida B',
          }),
        }),
      ),
      409,
    );
  });
  const state = (id: string) =>
    unwrap(
      admin.GET('/api/v1/orders/{id}/financial-state', { params: { header: h, path: { id } } }),
    );
  const lots = async () =>
    (
      await unwrap(
        admin.GET('/api/v1/customers/{id}/credits', {
          params: { header: h, path: { id: customer.id }, query: { limit: '100' } },
        }),
      )
    ).items;
  const receipt = async (order: Order, amountCents: number) => {
    const s = await state(order.id);
    const title = s.titles[0]!;
    return unwrap(
      admin.POST('/api/v1/orders/{id}/receipts', {
        params: { header: idempotent(), path: { id: order.id } },
        body: {
          expectedOrderVersion: s.orderVersion,
          expectedGuardVersion: s.guardVersion,
          customerId: customer.id,
          methodId: method.id,
          methodVersion: method.version,
          amountCents,
          receivedOn: today,
          allocations: [{ receivableId: title.id, expectedVersion: title.version, amountCents }],
          reason: 'Recebimento sintético para fontes B',
        },
      }),
    );
  };
  async function paidSource(disposition: 'customer_credit' | 'refund', amount: number) {
    const draft = await unwrap(
      admin.POST('/api/v1/orders', {
        params: { header: h },
        body: {
          customerId: customer.id,
          lines: [{ productId: product.id, quantity: '1' }],
          payment: { type: 'cash', dueDates: ['2099-01-10'] },
        },
      }),
    );
    const order = await unwrap(
      admin.POST('/api/v1/orders/{id}/confirm', {
        params: { header: idempotent(), path: { id: draft.id } },
        body: { expectedVersion: draft.version },
      }),
    );
    await receipt(order, amount);
    const s = await state(order.id);
    const resolution = await unwrap(
      admin.POST('/api/v1/orders/{id}/financial-cancellation', {
        params: { header: idempotent(), path: { id: order.id } },
        body: {
          expectedOrderVersion: s.orderVersion,
          expectedGuardVersion: s.guardVersion,
          disposition,
          reason: 'Origem legítima sintética para testes B',
        },
      }),
    );
    return { order, resolution };
  }
  const origin = await paidSource('customer_credit', 1000);
  await paidSource('customer_credit', 500);
  const refundOrigin = await paidSource('refund', 600);
  const targetState = () => state(target.id);
  const appRecord = (id: string) =>
    unwrap(admin.GET('/api/v1/credit-applications/{id}', { params: { header: h, path: { id } } }));
  const paymentRecord = (id: string) =>
    unwrap(admin.GET('/api/v1/payments/{id}', { params: { header: h, path: { id } } }));
  const refundRecord = () =>
    unwrap(
      admin.GET('/api/v1/refund-obligations/{id}', {
        params: { header: h, path: { id: refundOrigin.resolution.refundObligationId! } },
      }),
    );
  const send = (c: EconomicCommand, key = randomUUID()): Promise<FinancialResult> => {
    const params = { header: { ...h, 'Idempotency-Key': key }, path: { id: c.id } };
    switch (c.kind) {
      case 'apply-credit':
        return unwrap(
          admin.POST('/api/v1/orders/{id}/credit-applications', { params, body: c.body }),
        );
      case 'reverse-credit':
        return unwrap(
          admin.POST('/api/v1/credit-applications/{id}/reversals', { params, body: c.body }),
        );
      case 'reverse-payment':
        return unwrap(admin.POST('/api/v1/payments/{id}/reversals', { params, body: c.body }));
      case 'confirm-refund':
        return unwrap(
          admin.POST('/api/v1/refund-obligations/{id}/confirm', { params, body: c.body }),
        );
    }
  };
  const values = {
    ...emptyEconomicValues,
    amountCents: 200,
    reason: 'Conferência B sintética',
    titleId: (await targetState()).titles[0]!.id,
    sourceId: origin.resolution.creditLotId!,
  };
  const sources = {
    lots: await lots(),
    payments: [] as Payment[],
    applications: [] as CreditApplication[],
    refunds: [] as RefundObligation[],
    methods: [method],
  };
  let appId = '';
  const applyKey = randomUUID();
  const apply = buildEconomicCommand('apply-credit', values, await targetState(), sources);
  await check('fontes legítimas mostram origem e paginação sem total fictício', async () => {
    const first = await unwrap(
      admin.GET('/api/v1/customers/{id}/credits', {
        params: { header: h, path: { id: customer.id }, query: { limit: '1' } },
      }),
    );
    assert(first.items.length === 1 && first.nextCursor, 'fontes sem paginação');
    const second = await unwrap(
      admin.GET('/api/v1/customers/{id}/credits', {
        params: {
          header: h,
          path: { id: customer.id },
          query: { limit: '1', cursor: first.nextCursor },
        },
      }),
    );
    assert(
      second.items.length === 1 &&
        first.items[0]!.id !== second.items[0]!.id &&
        second.items[0]!.origin === 'order_cancellation',
      'origem/paginação divergente',
    );
  });
  await check('aplicação parcial usa payload do formulário e reduz saldo da fonte', async () => {
    const r = await send(apply, applyKey);
    appId = r.resourceId!;
    assert(
      (await lots()).find((l) => l.id === values.sourceId)?.availableCents === 800 &&
        (await targetState()).creditSettledCents === 200,
      'aplicação divergente',
    );
  });
  await check('resposta perdida após commit recupera aplicação original sem duplicar', async () => {
    const replay = await send(apply, applyKey);
    assert(
      replay.resourceId === appId && (await targetState()).creditSettledCents === 200,
      'duplicou aplicação',
    );
  });
  await check('crédito insuficiente é recusado pelo servidor', async () => {
    const c = buildEconomicCommand(
      'apply-credit',
      { ...values, amountCents: 100 },
      await targetState(),
      { ...sources, lots: await lots() },
    );
    assert(c.kind === 'apply-credit', 'tipo inesperado');
    const amount = (await lots()).find((l) => l.id === values.sourceId)!.availableCents + 1;
    await expectError(
      send({
        ...c,
        body: {
          ...c.body,
          amountCents: amount,
          allocations: c.body.allocations.map((a) => ({ ...a, amountCents: amount })),
        },
      }),
      409,
      'CREDIT_LIMIT',
    );
  });
  await check('estorno parcial de crédito restaura fonte original', async () => {
    const c = buildEconomicCommand(
      'reverse-credit',
      { ...values, sourceId: appId, amountCents: 100 },
      await targetState(),
      { ...sources, lots: await lots(), applications: [await appRecord(appId)] },
    );
    const key = randomUUID();
    await send(c, key);
    await send(c, key);
    assert(
      (await lots()).find((l) => l.id === values.sourceId)?.availableCents === 900 &&
        (await appRecord(appId)).reversedCents === 100 &&
        (await targetState()).creditSettledCents === 100,
      'restauração duplicada ou incorreta',
    );
  });
  await check(
    'histórico de aplicações preserva original, estornado e referência da fonte',
    async () => {
      const list = await unwrap(
        admin.GET('/api/v1/credit-applications', {
          params: { header: h, query: { customerId: customer.id, orderId: target.id, limit: '1' } },
        }),
      );
      assert(
        list.items[0]?.amountCents === 200 &&
          list.items[0]?.reversedCents === 100 &&
          list.items[0]?.creditLotId === values.sourceId,
        'histórico alterado',
      );
    },
  );
  const received = await receipt(target, 300);
  const paymentId = received.resourceId!;
  let reversal!: EconomicCommand;
  const reversalKey = randomUUID();
  await check('estorno de dinheiro usa saldo reversível e atualiza recebível', async () => {
    const before = await targetState();
    reversal = buildEconomicCommand(
      'reverse-payment',
      { ...values, sourceId: paymentId, amountCents: 100 },
      before,
      { ...sources, payments: [await paymentRecord(paymentId)] },
    );
    await send(reversal, reversalKey);
    const after = await targetState();
    assert(
      after.cashReceivedCents === 200 &&
        after.titles[0]!.outstandingCents === before.titles[0]!.outstandingCents + 100,
      'estorno de caixa divergente',
    );
  });
  await check('replay de estorno não repete restituição de saldo', async () => {
    await send(reversal, reversalKey);
    assert(
      (await paymentRecord(paymentId)).reversedCents === 100 &&
        (await targetState()).cashReceivedCents === 200,
      'estorno duplicado',
    );
  });
  await check('estorno superior ao remanescente é recusado', async () => {
    const c = buildEconomicCommand(
      'reverse-payment',
      { ...values, sourceId: paymentId, amountCents: 100 },
      await targetState(),
      { ...sources, payments: [await paymentRecord(paymentId)] },
    );
    assert(c.kind === 'reverse-payment', 'tipo inesperado');
    await expectError(
      send({
        ...c,
        body: {
          ...c.body,
          amountCents: 201,
          allocations: c.body.allocations.map((a) => ({ ...a, amountCents: 201 })),
        },
      }),
      409,
      'REVERSAL_LIMIT',
    );
  });
  let obligation = await refundRecord();
  let refundCommand!: EconomicCommand;
  const refundKey = randomUUID();
  let confirmationId = '';
  await check('obrigação pendente não significa dinheiro devolvido', async () => {
    assert(
      obligation.originalCents === 600 &&
        obligation.outstandingCents === 600 &&
        obligation.refundedCents === 0 &&
        obligation.status === 'pending',
      'obrigação simulou transferência',
    );
  });
  await check(
    'confirmação manual registra comprovante e quita parcialmente obrigação',
    async () => {
      refundCommand = buildEconomicCommand(
        'confirm-refund',
        {
          ...emptyEconomicValues,
          sourceId: obligation.id,
          amountCents: 200,
          reason: 'Comprovante sintético de teste B',
          methodId: method.id,
          date: today,
          reference: 'B-PROVA-SINTETICA',
          transferConfirmed: true,
        },
        await state(refundOrigin.order.id),
        { ...sources, refunds: [obligation] },
      );
      const r = await send(refundCommand, refundKey);
      confirmationId = r.operationId;
      obligation = await refundRecord();
      const proof = await unwrap(
        admin.GET('/api/v1/refund-confirmations/{id}', {
          params: { header: h, path: { id: confirmationId } },
        }),
      );
      assert(
        obligation.outstandingCents === 400 &&
          obligation.refundedCents === 200 &&
          proof.reference === 'B-PROVA-SINTETICA' &&
          proof.amountCents === 200,
        'confirmação/prova divergente',
      );
    },
  );
  await check('replay de confirmação não registra segundo reembolso', async () => {
    const r = await send(refundCommand, refundKey);
    assert(
      r.operationId === confirmationId && (await refundRecord()).refundedCents === 200,
      'reembolso duplicado',
    );
  });
  await check('reembolso superior à obrigação é recusado', async () => {
    const c = buildEconomicCommand(
      'confirm-refund',
      {
        ...emptyEconomicValues,
        sourceId: obligation.id,
        amountCents: 100,
        reason: 'Prova sintética B',
        methodId: method.id,
        date: today,
        reference: 'PROVA',
        transferConfirmed: true,
      },
      await state(refundOrigin.order.id),
      { ...sources, refunds: [obligation] },
    );
    assert(c.kind === 'confirm-refund', 'tipo inesperado');
    await expectError(send({ ...c, body: { ...c.body, amountCents: 401 } }), 409, 'REFUND_LIMIT');
  });
  await check('listagem de obrigações respeita cliente e pedido', async () => {
    const list = await unwrap(
      admin.GET('/api/v1/refund-obligations', {
        params: {
          header: h,
          query: { customerId: customer.id, orderId: refundOrigin.order.id, limit: '1' },
        },
      }),
    );
    assert(
      list.items[0]?.id === obligation.id && list.items[0]?.status === 'partially_refunded',
      'filtro divergente',
    );
  });
  await check('confirmação integral encerra obrigação manual com saldo zero', async () => {
    const current = await refundRecord();
    const c = buildEconomicCommand(
      'confirm-refund',
      {
        ...emptyEconomicValues,
        sourceId: current.id,
        amountCents: current.outstandingCents,
        reason: 'Quitação sintética B',
        methodId: method.id,
        date: today,
        reference: 'B-PROVA-FINAL',
        transferConfirmed: true,
      },
      await state(refundOrigin.order.id),
      { ...sources, refunds: [current] },
    );
    await send(c);
    const after = await refundRecord();
    assert(
      after.status === 'confirmed' && after.outstandingCents === 0 && after.refundedCents === 600,
      'obrigação não encerrou corretamente',
    );
  });
  await check('versões antigas em nova aplicação são recusadas', async () => {
    await expectError(send(apply), 409, 'CONFLICT');
  });
  await check(
    'vendedor não aplica, estorna, confirma reembolso nem configura cadastros',
    async () => {
      assert(
        apply.kind === 'apply-credit' &&
          reversal.kind === 'reverse-payment' &&
          refundCommand.kind === 'confirm-refund',
        'comandos inesperados',
      );
      await expectError(
        unwrap(
          seller.POST('/api/v1/orders/{id}/credit-applications', {
            params: { header: idempotent(), path: { id: target.id } },
            body: apply.body,
          }),
        ),
        403,
      );
      await expectError(
        unwrap(
          seller.POST('/api/v1/payments/{id}/reversals', {
            params: { header: idempotent(), path: { id: paymentId } },
            body: reversal.body,
          }),
        ),
        403,
      );
      await expectError(
        unwrap(
          seller.POST('/api/v1/refund-obligations/{id}/confirm', {
            params: { header: idempotent(), path: { id: obligation.id } },
            body: refundCommand.body,
          }),
        ),
        403,
      );
      await expectError(
        unwrap(
          seller.POST('/api/v1/payment-methods', {
            params: { header: idempotent() },
            body: { name: 'Negada', kind: 'cash' },
          }),
        ),
        403,
      );
    },
  );
  await check('Super Admin sem vínculo não consulta créditos comerciais', async () => {
    await expectError(
      unwrap(
        client(platform.token, a.tenantId).GET('/api/v1/customers/{id}/credits', {
          params: { header: h, path: { id: customer.id } },
        }),
      ),
      403,
    );
  });
  await check('outro tenant não acessa pagamento, aplicação ou obrigação', async () => {
    const oh = header(b.tenantId);
    await expectError(
      unwrap(
        other.GET('/api/v1/payments/{id}', { params: { header: oh, path: { id: paymentId } } }),
      ),
      404,
    );
    await expectError(
      unwrap(
        other.GET('/api/v1/credit-applications/{id}', {
          params: { header: oh, path: { id: appId } },
        }),
      ),
      404,
    );
    await expectError(
      unwrap(
        other.GET('/api/v1/refund-obligations/{id}', {
          params: { header: oh, path: { id: obligation.id } },
        }),
      ),
      404,
    );
  });
  await check('concorrência entre aplicações usa guarda e aplica apenas uma', async () => {
    const c = buildEconomicCommand(
      'apply-credit',
      { ...values, amountCents: 100 },
      await targetState(),
      { ...sources, lots: await lots() },
    );
    const attempts = await Promise.allSettled([send(c), send(c)]);
    const loser = attempts.find((r) => r.status === 'rejected');
    assert(
      attempts.filter((r) => r.status === 'fulfilled').length === 1 &&
        loser?.status === 'rejected' &&
        loser.reason instanceof ApiError &&
        loser.reason.code === 'CONFLICT',
      'concorrência sem proteção',
    );
    assert((await targetState()).creditSettledCents === 200, 'concorrência duplicou aplicação');
  });
  await check('estorno em pedido cancelado não reabre dívida', async () => {
    const originPayments = await unwrap(
      admin.GET('/api/v1/payments', { params: { header: h, query: { orderId: origin.order.id } } }),
    );
    const p = originPayments.items[0]!;
    const s = await state(origin.order.id);
    await expectError(
      unwrap(
        admin.POST('/api/v1/payments/{id}/reversals', {
          params: { header: idempotent(), path: { id: p.id } },
          body: {
            expectedOrderVersion: s.orderVersion,
            expectedGuardVersion: s.guardVersion,
            expectedVersion: p.version,
            amountCents: 1,
            allocations: [
              {
                receivableId: s.titles[0]!.id,
                expectedVersion: s.titles[0]!.version,
                amountCents: 1,
              },
            ],
            reason: 'Estado inválido sintético B',
          },
        }),
      ),
      409,
    );
  });
  await check('journal registra operações B e mantém reconciliação consistente', async () => {
    const history = await unwrap(
      admin.GET('/api/v1/orders/{id}/financial-history', {
        params: { header: h, path: { id: target.id }, query: { limit: '100' } },
      }),
    );
    assert(
      history.items.some((e) => e.type === 'credit_application') &&
        history.items.some((e) => e.type === 'credit_reversal') &&
        history.items.some((e) => e.type === 'payment_reversal'),
      'eventos B ausentes',
    );
    const r = await unwrap(
      admin.GET('/api/v1/orders/{id}/financial-reconciliation', {
        params: { header: h, path: { id: target.id }, query: { limit: '100' } },
      }),
    );
    assert(r.complete && r.consistent, 'journal inconsistente');
  });
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    'docs/evidence/finance-b-e2e.json',
    JSON.stringify(
      {
        phase: 'B',
        executedAt: new Date().toISOString(),
        environment: 'demo-lastro-phase-a / loopback',
        mode: 'HTTP do cliente do frontend + backend real e emuladores; sem navegador ou dispositivo',
        fixtures:
          'Créditos/obrigações originados por cancelamento atômico pequeno via API. Nenhuma execução F02. Comprovantes financeiros sintéticos, sem transferência bancária.',
        results,
      },
      null,
      2,
    ) + '\n',
  );
  report([
    'Somente dados sintéticos locais. Resposta perdida simulada por descarte da resposta após commit; falhas de fetch/timeout estão nos testes do transporte.',
  ]);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
