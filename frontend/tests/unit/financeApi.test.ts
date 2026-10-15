import { createApiClient } from '@/api/client';
import { sendReceipt } from '@/features/finance/api';
import { criticalRequest, intentLedger, intentScope, PendingIntentError } from '@/lib/intent';
import { createFakeApi, fail, ok } from '../support/fakeApi';
import { financialResult, receiptBody } from '../support/financeFixtures';

const scope = intentScope('u1', 't1', 'receipt', 'o1');
function world() {
  const server = createFakeApi();
  const api = createApiClient({
    baseUrl: 'http://api.test',
    tenantId: 't1',
    getIdToken: async () => 'token',
    onSessionExpired: () => {},
    fetch: server.fetch,
  });
  return { server, api };
}
beforeEach(() => {
  intentLedger.reset();
  criticalRequest.timeoutMs = 20_000;
});
afterEach(() => {
  criticalRequest.timeoutMs = 20_000;
});

describe('financeiro: baixa idempotente', () => {
  it.each([
    null,
    {},
    { ...financialResult, orderId: 'outro' },
    { ...financialResult, amountCents: 999 },
  ])('resposta 200 incompleta ou divergente preserva intenção: %s', async (response) => {
    const { api, server } = world();
    server.on('POST', '/api/v1/orders/o1/receipts', () => ok(response));
    await expect(sendReceipt(api, 't1', 'o1', scope, receiptBody)).rejects.toMatchObject({
      code: 'REQUEST_OUTCOME_UNKNOWN',
    });
    expect(intentLedger.get(scope)).toMatchObject({ unknown: true, body: receiptBody });
    expect(server.calls).toHaveLength(1);
  });
  it('envia UUID, empresa e corpo contratual; limpa intenção confirmada', async () => {
    const { api, server } = world();
    server.on('POST', '/api/v1/orders/o1/receipts', () => ok(financialResult));
    expect(await sendReceipt(api, 't1', 'o1', scope, receiptBody)).toEqual(financialResult);
    expect(server.calls[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(server.calls[0]?.headers['x-tenant-id']).toBe('t1');
    expect(server.calls[0]?.body).toEqual(receiptBody);
    expect(intentLedger.get(scope)).toBeUndefined();
  });
  it('resposta perdida preserva corpo e chave; repetição confirma mesmo resultado', async () => {
    const { api, server } = world();
    let attempts = 0;
    server.on('POST', '/api/v1/orders/o1/receipts', () => {
      if (++attempts === 1) throw new TypeError('Resposta perdida após commit');
      return ok(financialResult);
    });
    await expect(sendReceipt(api, 't1', 'o1', scope, receiptBody)).rejects.toThrow();
    expect(intentLedger.get(scope)).toMatchObject({ body: receiptBody, unknown: true });
    await expect(sendReceipt(api, 't1', 'o1', scope, receiptBody)).resolves.toEqual(
      financialResult,
    );
    expect(server.calls[0]?.headers['idempotency-key']).toBe(
      server.calls[1]?.headers['idempotency-key'],
    );
    expect(server.calls[0]?.body).toEqual(server.calls[1]?.body);
  });
  it('timeout mantém chave; nenhum retry automático', async () => {
    const { api, server } = world();
    criticalRequest.timeoutMs = 20;
    server.on('POST', '/api/v1/orders/o1/receipts', () => new Promise(() => {}));
    await expect(sendReceipt(api, 't1', 'o1', scope, receiptBody)).rejects.toThrow();
    expect(server.calls).toHaveLength(1);
    expect(intentLedger.get(scope)?.unknown).toBe(true);
  });
  it('503 REQUEST_OUTCOME_UNKNOWN não permite nova baixa com payload diferente', async () => {
    const { api, server } = world();
    server.on('POST', '/api/v1/orders/o1/receipts', () => fail(503, 'REQUEST_OUTCOME_UNKNOWN'));
    await expect(sendReceipt(api, 't1', 'o1', scope, receiptBody)).rejects.toThrow();
    await expect(
      sendReceipt(api, 't1', 'o1', scope, { ...receiptBody, amountCents: 900 }),
    ).rejects.toBeInstanceOf(PendingIntentError);
    expect(server.calls).toHaveLength(1);
  });
  it('conflito de versão permite nova revisão explícita', async () => {
    const { api, server } = world();
    server.on('POST', '/api/v1/orders/o1/receipts', () => fail(409, 'CONFLICT'));
    await expect(sendReceipt(api, 't1', 'o1', scope, receiptBody)).rejects.toThrow();
    expect(intentLedger.get(scope)?.unknown).toBe(false);
    const originalKey = intentLedger.get(scope)?.key;
    server.on('POST', '/api/v1/orders/o1/receipts', () => ok(financialResult));
    await sendReceipt(api, 't1', 'o1', scope, { ...receiptBody, expectedGuardVersion: 8 });
    expect(server.calls[1]?.headers['idempotency-key']).not.toBe(originalKey);
  });
  it('barra dois envios simultâneos do mesmo pedido', async () => {
    const { api, server } = world();
    let finish!: (value: ReturnType<typeof ok>) => void;
    server.on(
      'POST',
      '/api/v1/orders/o1/receipts',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = sendReceipt(api, 't1', 'o1', scope, receiptBody);
    await expect(sendReceipt(api, 't1', 'o1', scope, receiptBody)).rejects.toBeInstanceOf(
      PendingIntentError,
    );
    // Aguarda apenas até o fetch falso ter recebido o corpo.
    for (let i = 0; i < 20 && !finish; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    finish(ok(financialResult));
    await first;
    expect(server.calls).toHaveLength(1);
  });
  it('intenção ambígua isolada por usuário e empresa', async () => {
    const { api, server } = world();
    server.on('POST', '/api/v1/orders/o1/receipts', () => fail(503, 'REQUEST_OUTCOME_UNKNOWN'));
    await expect(sendReceipt(api, 't1', 'o1', scope, receiptBody)).rejects.toThrow();
    expect(intentLedger.get(intentScope('u1', 't2', 'receipt', 'o1'))).toBeUndefined();
    expect(intentLedger.get(intentScope('u2', 't1', 'receipt', 'o1'))).toBeUndefined();
  });
});
