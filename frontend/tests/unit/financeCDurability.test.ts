import * as SecureStore from 'expo-secure-store';
import { createIntentLedger, intentScope, PendingIntentError } from '@/lib/intent';
import { canonicalJson, createChunkedIntentStore, readIntentRows } from '@/lib/intentStorageCore';
import { newIdempotencyKey as randomUUID } from '@/lib/idempotency';
import { intentStore } from '@/lib/intentStorage';
const scope = intentScope('u1', 't1', 'finance-resolution', 'o1');
const body = {
  kind: 'cancel-start',
  id: 'o1',
  orderId: 'o1',
  body: {
    reason: 'Motivo registrado',
    expectedOrderVersion: 3,
    expectedGuardVersion: 5,
    disposition: 'refund',
  },
};
function world() {
  const values = new Map<string, string>();
  const kv = {
    get: jest.fn(async (k: string) => values.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      values.set(k, v);
    }),
    remove: jest.fn(async (k: string) => {
      values.delete(k);
    }),
  };
  const store = createChunkedIntentStore(kv, randomUUID);
  return { values, kv, store, ledger: createIntentLedger(store) };
}
it('novo processo lógico recupera chave e corpo canônico sem gerar operação', async () => {
  const { kv, ledger } = world();
  const key = await ledger.prepare(scope, body);
  const restarted = createIntentLedger(createChunkedIntentStore(kv, randomUUID));
  await restarted.hydrate('u1', 't1');
  expect(restarted.get(scope)).toMatchObject({ key, unknown: true, body });
  expect(await restarted.prepare(scope, body)).toBe(key);
});
it('logout/login e outra empresa ou conta não apagam intenção antiga', async () => {
  const { store, ledger } = world();
  const key = await ledger.prepare(scope, body);
  ledger.reset();
  await ledger.hydrate('u1', 't2');
  await ledger.hydrate('u2', 't1');
  expect(ledger.list('u1', 't2')).toEqual([]);
  expect(ledger.list('u2', 't1')).toEqual([]);
  const relogin = createIntentLedger(store);
  await relogin.hydrate('u1', 't1');
  expect(relogin.get(scope)?.key).toBe(key);
});
it('corpos aninhados independem da ordem de propriedades', async () => {
  const { ledger } = world();
  const key = await ledger.prepare(scope, body);
  expect(
    await ledger.prepare(scope, {
      body: {
        disposition: 'refund',
        expectedGuardVersion: 5,
        expectedOrderVersion: 3,
        reason: 'Motivo registrado',
      },
      orderId: 'o1',
      id: 'o1',
      kind: 'cancel-start',
    }),
  ).toBe(key);
});
it('gravação recusada ou silenciosamente perdida impede preparação', async () => {
  const { kv, ledger } = world();
  kv.set.mockImplementation(async () => {});
  await expect(ledger.prepare(scope, body)).rejects.toThrow('Escrita local não confirmada');
  expect(ledger.get(scope)).toBeUndefined();
});
it('gravação interrompida preserva snapshot anterior', async () => {
  const { kv, ledger, store } = world();
  const key = await ledger.prepare(scope, body);
  kv.set.mockRejectedValueOnce(new Error('Disco cheio'));
  await expect(
    ledger.prepare(intentScope('u1', 't1', 'receipt', 'o2'), { amountCents: 1 }),
  ).rejects.toThrow('Disco cheio');
  const recovered = createIntentLedger(store);
  await recovered.hydrate('u1', 't1');
  expect(recovered.get(scope)?.key).toBe(key);
});
it('snapshot incompleto bloqueia recuperação sem apagar intenção', async () => {
  const { values, ledger, store } = world();
  await ledger.prepare(scope, body);
  const chunk = [...values.keys()].find((k) => !k.endsWith('_head'))!;
  values.delete(chunk);
  await expect(createIntentLedger(store).hydrate('u1', 't1')).rejects.toThrow(
    'Checkpoint local incompleto',
  );
});
it('créditos, baixas e resolução compartilham bloqueio por pedido', async () => {
  const { ledger } = world();
  await ledger.prepare(scope, body);
  await expect(
    ledger.prepare(intentScope('u1', 't1', 'receipt', 'o1'), { amountCents: 1 }),
  ).rejects.toBeInstanceOf(PendingIntentError);
  await expect(
    ledger.prepare(intentScope('u1', 't1', 'finance-command', 'o1'), { kind: 'reverse-payment' }),
  ).rejects.toBeInstanceOf(PendingIntentError);
  await expect(ledger.prepare(scope, { ...body, kind: 'cancel-atomic' })).rejects.toBeInstanceOf(
    PendingIntentError,
  );
});
it('aceitação mantém início; avanço admite somente mesma execução', async () => {
  const { ledger, store } = world();
  await ledger.prepare(scope, body);
  await ledger.accepted(scope, 'exec1', 2, 1);
  const step = intentScope('u1', 't1', 'finance-step', 'o1');
  await expect(ledger.prepare(step, { kind: 'advance' }, 'outro')).rejects.toBeInstanceOf(
    PendingIntentError,
  );
  await ledger.prepare(step, { kind: 'advance' }, 'exec1');
  expect((await store.read('u1:t1')).find((r) => r.scope === scope)).toMatchObject({
    executionId: 'exec1',
    status: 'accepted',
    revision: 2,
    fencingToken: 1,
  });
  await ledger.finishExecution('u1', 't1', 'exec1');
  expect(await store.read('u1:t1')).toEqual([]);
});
it('duas instâncias concorrentes reutilizam chave ou recusam outro corpo', async () => {
  const { ledger, store } = world(),
    second = createIntentLedger(store);
  const [a, b] = await Promise.all([ledger.prepare(scope, body), second.prepare(scope, body)]);
  expect(a).toBe(b);
  await expect(second.prepare(scope, { ...body, id: 'outro' })).rejects.toBeInstanceOf(
    PendingIntentError,
  );
});
it('registro não contém token/senha; alteração de corpo é detectada', async () => {
  const { ledger, store } = world();
  await ledger.prepare(scope, body);
  const rows = await store.read('u1:t1');
  expect(rows[0]).not.toHaveProperty('token');
  expect(rows[0]).not.toHaveProperty('password');
  const corrupted = JSON.parse(canonicalJson(rows));
  corrupted[0].body.body.reason = 'Alterado';
  expect(() => readIntentRows(JSON.stringify(corrupted), 'u1:t1')).toThrow(
    'Registro durável divergente',
  );
});
it('recusa conclusiva mantém mesma chave em memória para reauth; ambiguidade persiste em disco', async () => {
  const { ledger, store } = world();
  const key = await ledger.prepare(scope, body);
  await ledger.reject(scope);
  expect(await store.read('u1:t1')).toEqual([]);
  expect(await ledger.prepare(scope, body)).toBe(key);
  ledger.markUnknown(scope);
  expect(await ledger.persistedPending(scope)).toBe(true);
});
it('adapter nativo grava fragmentos abaixo de 2048 bytes e sem autenticação biométrica', async () => {
  const ledger = createIntentLedger(intentStore);
  await ledger.prepare(scope, { ...body, text: '漢'.repeat(1500) });
  const calls = jest.mocked(SecureStore.setItemAsync).mock.calls;
  expect(calls.length).toBeGreaterThan(5);
  for (const [, v, options] of calls) {
    expect(unescape(encodeURIComponent(v)).length).toBeLessThan(2048);
    expect(options).toMatchObject({ keychainAccessible: 'device-only' });
    expect(options).not.toHaveProperty('requireAuthentication');
  }
});
it('hidratação financeira preserva intenção de estoque/comercial anterior em memória', async () => {
  const { ledger } = world();
  const inventory = intentScope('u1', 't1', 'entry', 'prod1'),
    key = ledger.keyFor(inventory, { quantity: '2' });
  ledger.markUnknown(inventory);
  await ledger.prepare(scope, body);
  await ledger.hydrate('u1', 't1');
  expect(ledger.get(inventory)).toMatchObject({ key, unknown: true, body: { quantity: '2' } });
});
