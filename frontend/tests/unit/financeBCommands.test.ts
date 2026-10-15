import { createApiClient } from '@/api/client';
import { sendFinanceCommand, type FinanceCommand } from '@/features/finance/commands';
import { buildEconomicCommand, emptyEconomicValues } from '@/features/finance/administrationRules';
import { criticalRequest, intentLedger, intentScope, PendingIntentError } from '@/lib/intent';
import { createFakeApi, fail, ok } from '../support/fakeApi';
import { financialResult, financialState, method } from '../support/financeFixtures';
import {
  application,
  condition,
  lot,
  payment,
  refund,
  settingMethod,
} from '../support/financeBFixtures';
const scope = intentScope('u1', 't1', 'finance-command', 'o1');
const sources = {
  lots: [lot()],
  applications: [application()],
  payments: [payment()],
  refunds: [refund()],
  methods: [method],
};
const economic = (kind: 'apply-credit' | 'reverse-payment' | 'reverse-credit' | 'confirm-refund') =>
  buildEconomicCommand(
    kind,
    {
      ...emptyEconomicValues,
      amountCents: 200,
      reason: 'Conferência financeira',
      sourceId:
        kind === 'apply-credit'
          ? 'l1'
          : kind === 'reverse-payment'
            ? 'p1'
            : kind === 'reverse-credit'
              ? 'a1'
              : 'f1',
      titleId: 'r1',
      methodId: 'm1',
      date: '2026-10-13',
      reference: 'comprovante',
      transferConfirmed: true,
    },
    financialState(),
    sources,
  );
function world() {
  const server = createFakeApi();
  return {
    server,
    api: createApiClient({
      baseUrl: 'http://api.test',
      tenantId: 't1',
      getIdToken: async () => 'token',
      onSessionExpired: () => {},
      fetch: server.fetch,
    }),
  };
}
beforeEach(() => {
  intentLedger.reset();
  criticalRequest.timeoutMs = 20_000;
});
afterEach(() => {
  criticalRequest.timeoutMs = 20_000;
});
describe('financeiro B: transporte e idempotência', () => {
  it('impede dois envios simultâneos do mesmo pedido', async () => {
    const { server, api } = world();
    let finish!: (value: ReturnType<typeof ok>) => void;
    server.on(
      'POST',
      '/api/v1/orders/o1/credit-applications',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = sendFinanceCommand(api, 't1', scope, economic('apply-credit'));
    await expect(
      sendFinanceCommand(api, 't1', scope, economic('apply-credit')),
    ).rejects.toBeInstanceOf(PendingIntentError);
    for (let i = 0; i < 20 && !finish; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    finish(ok({ ...financialResult, amountCents: 200 }));
    await first;
    expect(server.calls).toHaveLength(1);
  });
  it.each([
    [
      economic('apply-credit'),
      'POST',
      '/api/v1/orders/o1/credit-applications',
      { ...financialResult, amountCents: 200 },
    ],
    [
      economic('reverse-payment'),
      'POST',
      '/api/v1/payments/p1/reversals',
      { ...financialResult, amountCents: 200 },
    ],
    [
      economic('reverse-credit'),
      'POST',
      '/api/v1/credit-applications/a1/reversals',
      { ...financialResult, amountCents: 200 },
    ],
    [
      economic('confirm-refund'),
      'POST',
      '/api/v1/refund-obligations/f1/confirm',
      { ...financialResult, amountCents: 200 },
    ],
    [
      { kind: 'create-condition', body: { name: 'Prazo 30 e 60', preset: '30_60' } },
      'POST',
      '/api/v1/payment-conditions',
      condition(),
    ],
    [
      { kind: 'update-condition', id: 'cond1', body: { expectedVersion: 1, status: 'inactive' } },
      'PATCH',
      '/api/v1/payment-conditions/cond1',
      condition({ status: 'inactive', version: 2 }),
    ],
    [
      { kind: 'create-method', body: { name: 'Pix conferido', kind: 'pix' } },
      'POST',
      '/api/v1/payment-methods',
      settingMethod(),
    ],
    [
      { kind: 'update-method', id: 'm1', body: { expectedVersion: 5, status: 'inactive' } },
      'PATCH',
      '/api/v1/payment-methods/m1',
      settingMethod({ status: 'inactive', version: 6 }),
    ],
  ] as const)('envia rota contratual e UUID: %s', async (input, verb, path, result) => {
    const { server, api } = world();
    server.on(verb, path, () => ok(result));
    await sendFinanceCommand(api, 't1', scope, input as FinanceCommand);
    expect(server.calls[0]?.body).toEqual(input.body);
    expect(server.calls[0]?.headers['x-tenant-id']).toBe('t1');
    expect(server.calls[0]?.headers['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/);
    expect(intentLedger.get(scope)).toBeUndefined();
  });
  it('perda de resposta recupera mesma chave e corpo sem nova intenção', async () => {
    const { server, api } = world();
    let attempts = 0;
    const c = economic('reverse-payment');
    server.on('POST', '/api/v1/payments/p1/reversals', () => {
      if (++attempts === 1) throw new TypeError('Resposta perdida');
      return ok({ ...financialResult, amountCents: 200 });
    });
    await expect(sendFinanceCommand(api, 't1', scope, c)).rejects.toThrow();
    expect(intentLedger.get(scope)).toMatchObject({ unknown: true, body: c });
    await sendFinanceCommand(api, 't1', scope, c);
    expect(server.calls[0]?.headers['idempotency-key']).toBe(
      server.calls[1]?.headers['idempotency-key'],
    );
    expect(server.calls[0]?.body).toEqual(server.calls[1]?.body);
  });
  it('recusa de reautenticação na recuperação não libera nova intenção', async () => {
    const { server, api } = world();
    const c = economic('confirm-refund');
    server.on('POST', '/api/v1/refund-obligations/f1/confirm', () =>
      fail(503, 'REQUEST_OUTCOME_UNKNOWN'),
    );
    await expect(sendFinanceCommand(api, 't1', scope, c)).rejects.toThrow();
    server.on('POST', '/api/v1/refund-obligations/f1/confirm', () =>
      fail(403, 'REAUTHENTICATION_REQUIRED'),
    );
    await expect(sendFinanceCommand(api, 't1', scope, c)).rejects.toThrow();
    expect(intentLedger.get(scope)?.unknown).toBe(true);
    await expect(
      sendFinanceCommand(api, 't1', scope, economic('apply-credit')),
    ).rejects.toBeInstanceOf(PendingIntentError);
    expect(server.calls).toHaveLength(2);
  });
  it('timeout não repete sozinho e mantém intenção', async () => {
    const { server, api } = world();
    criticalRequest.timeoutMs = 20;
    server.on('POST', '/api/v1/orders/o1/credit-applications', () => new Promise(() => {}));
    await expect(sendFinanceCommand(api, 't1', scope, economic('apply-credit'))).rejects.toThrow();
    expect(server.calls).toHaveLength(1);
    expect(intentLedger.get(scope)?.unknown).toBe(true);
  });
  it.each([
    'CREDIT_LIMIT',
    'REVERSAL_LIMIT',
    'CONFLICT',
    'INVALID_ORDER_STATE',
    'RETURN_FINANCIAL_BLOCK',
  ])('rejeição explícita preserva saldos e permite nova revisão: %s', async (code) => {
    const { server, api } = world();
    server.on('POST', '/api/v1/orders/o1/credit-applications', () => fail(409, code));
    await expect(
      sendFinanceCommand(api, 't1', scope, economic('apply-credit')),
    ).rejects.toMatchObject({ code });
    expect(intentLedger.get(scope)?.unknown).toBe(false);
  });
  it.each([
    null,
    {},
    { ...financialResult, amountCents: 999 },
    { ...financialResult, orderId: 'foreign' },
  ])('resposta incompleta não confirma operação: %s', async (result) => {
    const { server, api } = world();
    server.on('POST', '/api/v1/orders/o1/credit-applications', () => ok(result));
    await expect(
      sendFinanceCommand(api, 't1', scope, economic('apply-credit')),
    ).rejects.toMatchObject({ code: 'REQUEST_OUTCOME_UNKNOWN' });
    expect(intentLedger.get(scope)?.unknown).toBe(true);
  });
  it('cadastro ambíguo impede criar segunda forma ao trocar payload', async () => {
    const { server, api } = world();
    const c: FinanceCommand = { kind: 'create-method', body: { name: 'Pix', kind: 'pix' } };
    server.on('POST', '/api/v1/payment-methods', () => fail(503, 'REQUEST_OUTCOME_UNKNOWN'));
    await expect(sendFinanceCommand(api, 't1', scope, c)).rejects.toThrow();
    await expect(
      sendFinanceCommand(api, 't1', scope, { ...c, body: { name: 'Outro', kind: 'cash' } }),
    ).rejects.toBeInstanceOf(PendingIntentError);
    expect(server.calls).toHaveLength(1);
  });
});
