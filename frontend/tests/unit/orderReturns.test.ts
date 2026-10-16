import { createApiClient } from '@/api/client';
import { sendReturn, type ReturnCommand } from '@/features/orders/returnCommands';
import { paymentPreview } from '@/features/orders/paymentPreview';
import { intentLedger, intentScope, PendingIntentError } from '@/lib/intent';
import { createFakeApi, fail, ok } from '../support/fakeApi';
import { financialResult } from '../support/financeFixtures';
import type { ConditionOption } from '@/api/types';

const scope = intentScope('u1', 't1', 'return-command', 'o1');
const create: ReturnCommand = {
  kind: 'create',
  id: 'o1',
  orderId: 'o1',
  body: {
    expectedOrderVersion: 3,
    expectedGuardVersion: 2,
    reason: 'Mercadoria devolvida',
    lines: [{ lineId: 'l1', quantity: '2' }],
  },
};
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
const result = () => ({
  ...financialResult,
  orderId: 'o1',
  returnId: 'ret1',
  returnVersion: 1,
  status: 'pending',
});
beforeEach(() => intentLedger.reset());

it('envia solicitação com versões e chave; confirma apenas resposta válida', async () => {
  const { server, api } = world();
  server.on('POST', '/api/v1/orders/o1/returns', (call) => {
    expect(call.body).toEqual(create.body);
    expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    return ok(result());
  });
  expect((await sendReturn(api, 't1', scope, create)).returnId).toBe('ret1');
  expect(intentLedger.get(scope)).toBeUndefined();
});
it('resposta perdida preserva corpo e chave; bloqueia intenção diferente', async () => {
  const { server, api } = world();
  server.on('POST', '/api/v1/orders/o1/returns', () => {
    throw new TypeError('network');
  });
  await expect(sendReturn(api, 't1', scope, create)).rejects.toBeTruthy();
  const key = intentLedger.get(scope)!.key;
  await expect(
    sendReturn(api, 't1', scope, { ...create, body: { ...create.body, reason: 'Outro motivo' } }),
  ).rejects.toBeInstanceOf(PendingIntentError);
  server.on('POST', '/api/v1/orders/o1/returns', (call) => {
    expect(call.headers['idempotency-key']).toBe(key);
    return ok(result());
  });
  await sendReturn(api, 't1', scope, create);
});
it('não libera intenção ambígua após recusa de replay', async () => {
  const { server, api } = world();
  server.on('POST', '/api/v1/orders/o1/returns', () => {
    throw new TypeError('network');
  });
  await expect(sendReturn(api, 't1', scope, create)).rejects.toBeTruthy();
  server.on('POST', '/api/v1/orders/o1/returns', () => fail(409, 'CONFLICT'));
  await expect(sendReturn(api, 't1', scope, create)).rejects.toBeTruthy();
  expect(intentLedger.get(scope)?.unknown).toBe(true);
});
it('resposta de outro pedido é ambígua e não gera sucesso', async () => {
  const { server, api } = world();
  server.on('POST', '/api/v1/orders/o1/returns', () => ok({ ...result(), orderId: 'outro' }));
  await expect(sendReturn(api, 't1', scope, create)).rejects.toBeTruthy();
  expect(intentLedger.get(scope)?.unknown).toBe(true);
});
it('não permite transportar intenção entre empresas', async () => {
  const { server, api } = world();
  await expect(sendReturn(api, 't2', scope, create)).rejects.toBeTruthy();
  expect(server.calls).toHaveLength(0);
});
it('verifica sessão novamente depois da persistência e antes do HTTP', async () => {
  const { server, api } = world();
  await expect(
    sendReturn(api, 't1', scope, create, () => {
      throw new Error('Sessão trocada');
    }),
  ).rejects.toThrow('Sessão trocada');
  expect(server.calls).toHaveLength(0);
});
it('recebimento parcial mantém vendável e danificado separados', async () => {
  const { server, api } = world();
  const receive: ReturnCommand = {
    kind: 'receive',
    id: 'ret1',
    orderId: 'o1',
    body: {
      expectedVersion: 2,
      expectedOrderVersion: 3,
      expectedGuardVersion: 4,
      reason: 'Conferência física',
      lines: [{ lineId: 'l1', sellableQuantity: '0.125', damagedQuantity: '0.5' }],
    },
  };
  server.on('POST', '/api/v1/returns/ret1/receipts', (call) => {
    expect(call.body).toEqual(receive.body);
    return ok({ ...result(), status: 'partially_received' });
  });
  await sendReturn(api, 't1', scope, receive);
  expect(server.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
});
it('prévia usa pesos, maiores restos e calendário sem mover finais de semana', () => {
  const c = {
    id: 'c1',
    name: '30/60',
    version: 1,
    schedule: [
      { offsetDays: 0, weight: 1 },
      { offsetDays: 30, weight: 2 },
    ],
  } as ConditionOption;
  expect(paymentPreview(100, { mode: 'condition', conditionId: 'c1' }, [c], '2026-10-17')).toEqual([
    { date: '2026-10-17', amountCents: 33 },
    { date: '2026-11-16', amountCents: 67 },
  ]);
  expect(
    paymentPreview(
      101,
      { mode: 'manual', type: 'installments', first: '2026-10-17', count: 2, interval: 30 },
      [],
      '2026-10-17',
    ).map((p) => p.amountCents),
  ).toEqual([51, 50]);
});
