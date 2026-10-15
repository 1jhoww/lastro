import { createApiClient } from '@/api/client';
import {
  getExecution,
  sendResolution,
  type ResolutionCommand,
} from '@/features/finance/resolutionCommands';
import { criticalRequest, intentLedger, intentScope, PendingIntentError } from '@/lib/intent';
import * as SecureStore from 'expo-secure-store';
import { createFakeApi, fail, ok, page } from '../support/fakeApi';
import { financialResult, financialState } from '../support/financeFixtures';
import { cancellationInput, execution, publishedExecution } from '../support/financeCFixtures';
const scope = intentScope('u1', 't1', 'finance-resolution', 'o1'),
  stepScope = intentScope('u1', 't1', 'finance-step', 'o1');
const start: ResolutionCommand = {
  kind: 'cancel-start',
  orderId: 'o1',
  id: 'o1',
  body: cancellationInput,
};
function world() {
  const server = createFakeApi()
    .on('GET', '/api/v1/financial-executions/exec1', () => ok(execution()))
    .on('GET', '/api/v1/orders/o1/financial-state', () => ok(financialState()))
    .on('GET', '/api/v1/financial-executions', () => ok(page([execution()])));
  const api = createApiClient({
    baseUrl: 'http://api.test',
    tenantId: 't1',
    getIdToken: async () => 'token',
    onSessionExpired: () => {},
    fetch: server.fetch,
  });
  return { api, server };
}
beforeEach(() => {
  intentLedger.reset();
  criticalRequest.timeoutMs = 20000;
});
afterEach(() => {
  criticalRequest.timeoutMs = 20000;
});
it('aceitação 202 conserva início e ID; não libera operação econômica', async () => {
  const { server, api } = world();
  server.on('POST', '/api/v1/orders/o1/financial-cancellation-executions', () =>
    ok(execution(), 202),
  );
  const result = await sendResolution(api, 't1', scope, start);
  expect(result).toMatchObject({ financialCompleted: false, result: null, publishedAt: null });
  expect(intentLedger.get(scope)).toMatchObject({
    unknown: true,
    executionId: 'exec1',
    body: start,
  });
  expect(server.calls[0]?.headers['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/);
  await expect(
    intentLedger.prepare(intentScope('u1', 't1', 'receipt', 'o1'), { amountCents: 1 }),
  ).rejects.toBeInstanceOf(PendingIntentError);
});
it.each([
  {
    kind: 'cancel-atomic',
    id: 'o1',
    path: '/api/v1/orders/o1/financial-cancellation',
    body: cancellationInput,
    result: financialResult,
  },
  {
    kind: 'return-atomic',
    id: 'ret1',
    path: '/api/v1/returns/ret1/resolve',
    body: { ...cancellationInput, expectedVersion: 3 },
    result: { ...financialResult, returnId: 'ret1', returnVersion: 4, status: 'closed' },
  },
  {
    kind: 'return-start',
    id: 'ret1',
    path: '/api/v1/returns/ret1/resolution-executions',
    body: { ...cancellationInput, expectedVersion: 3 },
    result: execution({ kind: 'return_resolution', returnId: 'ret1' }),
  },
  {
    kind: 'advance',
    id: 'exec1',
    path: '/api/v1/financial-executions/exec1/advance',
    body: { expectedRevision: 1, fencingToken: 1 },
    result: execution({ revision: 2 }),
  },
  {
    kind: 'resume',
    id: 'exec1',
    path: '/api/v1/financial-executions/exec1/resume',
    body: { expectedRevision: 1, reason: 'Retomada auditada' },
    result: execution({ revision: 2, fencingToken: 2 }),
  },
  {
    kind: 'abort',
    id: 'exec1',
    path: '/api/v1/financial-executions/exec1/abort',
    body: { expectedRevision: 1, reason: 'Abort auditado' },
    result: execution({ status: 'ABORTED', revision: 2 }),
  },
])(
  'envia contrato real $kind sem novo cálculo financeiro',
  async ({ kind, id, path, body, result }) => {
    const { api, server } = world();
    server.on('POST', path, () =>
      ok(result, 'financialCompleted' in result && result.status !== 'ABORTED' ? 202 : 200),
    );
    const c = { kind, id, orderId: 'o1', body } as ResolutionCommand;
    await sendResolution(
      api,
      't1',
      ['advance', 'resume', 'abort'].includes(kind) ? stepScope : scope,
      c,
    );
    expect(server.calls[0]?.body).toEqual(body);
    expect(server.calls[0]?.headers['x-tenant-id']).toBe('t1');
  },
);
it('reinício após commit perdido consulta GET e repete corpo/chave originais', async () => {
  const { api, server } = world();
  let count = 0;
  server.on('POST', '/api/v1/orders/o1/financial-cancellation-executions', () => {
    if (++count === 1) throw new TypeError('Resposta perdida após commit');
    return ok(execution(), 202);
  });
  await expect(sendResolution(api, 't1', scope, start)).rejects.toThrow();
  const original = intentLedger.get(scope)!.key;
  intentLedger.reset();
  await intentLedger.hydrate('u1', 't1');
  await sendResolution(api, 't1', scope, start);
  expect(server.calls.map((c) => c.method)).toEqual(['POST', 'GET', 'GET', 'POST']);
  expect(server.calls[3]?.headers['idempotency-key']).toBe(original);
  expect(server.calls[3]?.body).toEqual(server.calls[0]?.body);
});
it('passo perdido consulta execução antes de replay; fence/payload não muda', async () => {
  const { api, server } = world();
  let n = 0;
  const c: ResolutionCommand = {
    kind: 'advance',
    id: 'exec1',
    orderId: 'o1',
    body: { expectedRevision: 1, fencingToken: 1 },
  };
  server.on('POST', '/api/v1/financial-executions/exec1/advance', () => {
    if (++n === 1) throw new TypeError('Após commit');
    return ok(execution({ revision: 3 }), 202);
  });
  await expect(sendResolution(api, 't1', stepScope, c)).rejects.toThrow();
  await sendResolution(api, 't1', stepScope, c);
  expect(server.calls.map((c) => c.method)).toEqual(['POST', 'GET', 'POST']);
  expect(server.calls[0]?.headers['idempotency-key']).toBe(
    server.calls[2]?.headers['idempotency-key'],
  );
});
it.each(['EXECUTION_CONFLICT', 'EXECUTION_LEASE_CONFLICT', 'EXECUTION_ABORT_NOT_ALLOWED'])(
  'recusa $code mantém ambiguidade anterior e bloqueia nova intenção',
  async (code) => {
    const { api, server } = world();
    const c: ResolutionCommand = {
      kind: 'advance',
      id: 'exec1',
      orderId: 'o1',
      body: { expectedRevision: 1, fencingToken: 1 },
    };
    server.on('POST', '/api/v1/financial-executions/exec1/advance', () =>
      fail(503, 'REQUEST_OUTCOME_UNKNOWN'),
    );
    await expect(sendResolution(api, 't1', stepScope, c)).rejects.toThrow();
    const key = intentLedger.get(stepScope)!.key;
    server.on('POST', '/api/v1/financial-executions/exec1/advance', () => fail(409, code));
    await expect(sendResolution(api, 't1', stepScope, c)).rejects.toMatchObject({ code });
    expect(intentLedger.get(stepScope)).toMatchObject({ unknown: true, key });
    await expect(
      sendResolution(api, 't1', stepScope, {
        ...c,
        body: { expectedRevision: 2, fencingToken: 2 },
      }),
    ).rejects.toBeInstanceOf(PendingIntentError);
  },
);
it.each([
  {},
  { ...publishedExecution(), publishedAt: null },
  { ...publishedExecution(), result: null },
  { ...execution(), orderId: 'outro' },
])('resposta incompleta conserva checkpoint: %s', async (response) => {
  const { api, server } = world();
  server.on('POST', '/api/v1/orders/o1/financial-cancellation-executions', () => ok(response));
  await expect(sendResolution(api, 't1', scope, start)).rejects.toMatchObject({
    code: 'REQUEST_OUTCOME_UNKNOWN',
  });
  expect(await intentLedger.persistedPending(scope)).toBe(true);
});
it('falha de SecureStore impede POST', async () => {
  const { api, server } = world();
  jest
    .mocked(SecureStore.setItemAsync)
    .mockRejectedValueOnce(new Error('Armazenamento indisponível'));
  await expect(sendResolution(api, 't1', scope, start)).rejects.toThrow(
    'Armazenamento indisponível',
  );
  expect(server.calls).toEqual([]);
});
it('troca de empresa durante preparação impede POST e mantém guarda conservadora', async () => {
  const { api, server } = world();
  await expect(
    sendResolution(api, 't1', scope, start, () => {
      throw new Error('Empresa mudou');
    }),
  ).rejects.toThrow('Empresa mudou');
  expect(server.calls).toEqual([]);
  expect(await intentLedger.persistedPending(scope)).toBe(true);
});
it('timeout e duplo envio não iniciam segundo POST', async () => {
  const { api, server } = world();
  criticalRequest.timeoutMs = 20;
  server.on(
    'POST',
    '/api/v1/orders/o1/financial-cancellation-executions',
    () => new Promise(() => {}),
  );
  const first = sendResolution(api, 't1', scope, start);
  await expect(sendResolution(api, 't1', scope, start)).rejects.toBeInstanceOf(PendingIntentError);
  await expect(first).rejects.toThrow();
  expect(server.calls).toHaveLength(1);
});
it('GET divergente não libera execução nem cria POST', async () => {
  const { api, server } = world();
  server.on('GET', '/api/v1/financial-executions/exec1', () => ok({ ...execution(), id: 'outro' }));
  await expect(getExecution(api, 't1', 'exec1')).rejects.toMatchObject({
    code: 'REQUEST_OUTCOME_UNKNOWN',
  });
  expect(server.calls.map((c) => c.method)).toEqual(['GET']);
});
it('202 com COMPLETED indevido nunca confirma publicação econômica', async () => {
  const { api, server } = world();
  server.on('POST', '/api/v1/orders/o1/financial-cancellation-executions', () =>
    ok(publishedExecution(), 202),
  );
  await expect(sendResolution(api, 't1', scope, start)).rejects.toMatchObject({
    code: 'REQUEST_OUTCOME_UNKNOWN',
  });
  expect(await intentLedger.persistedPending(scope)).toBe(true);
});
it('retomada após avanço incerto consulta GET e preserva passo antigo antes de novo fence', async () => {
  const { api, server } = world();
  const c: ResolutionCommand = {
    kind: 'advance',
    id: 'exec1',
    orderId: 'o1',
    body: { expectedRevision: 1, fencingToken: 1 },
  };
  const original = await intentLedger.prepare(stepScope, c, 'exec1');
  server.on('GET', '/api/v1/financial-executions/exec1', () =>
    ok(execution({ revision: 3, leaseUntil: new Date(0).toISOString() })),
  );
  server.on('POST', '/api/v1/financial-executions/exec1/resume', () =>
    ok(execution({ revision: 4, fencingToken: 2 }), 202),
  );
  await sendResolution(api, 't1', stepScope, {
    kind: 'resume',
    id: 'exec1',
    orderId: 'o1',
    body: { expectedRevision: 3, reason: 'Recuperar avanço interrompido' },
  });
  const archive = intentLedger.list('u1', 't1').find(([s]) => s.includes(':finance-step-history:'));
  expect(archive?.[1]).toMatchObject({ key: original, body: c, unknown: false });
  expect(server.calls.map((c) => c.method)).toEqual(['GET', 'POST']);
  expect(server.calls[1]?.headers['idempotency-key']).not.toBe(original);
});
