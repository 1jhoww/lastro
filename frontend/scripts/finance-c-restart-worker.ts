/** Processo novo para testar recuperação sem memória React. KV de teste usa disco local, não simula Keychain. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApiClient, unwrap } from '../src/api/client';
import type { CancellationInput } from '../src/api/types';
import {
  canonicalJson,
  createChunkedIntentStore,
  type DurableIntent,
} from '../src/lib/intentStorageCore';

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname))
  throw new Error('Worker exige API local');
const uid = process.env.RECOVERY_UID!,
  tenantId = process.env.RECOVERY_TENANT!,
  owner = `${uid}:${tenantId}`;
const directory = resolve('.local/finance/c-process-storage');
mkdirSync(directory, { recursive: true });
const kv = {
  async get(key: string) {
    try {
      return readFileSync(join(directory, key), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  async set(key: string, value: string) {
    writeFileSync(join(directory, key), value, 'utf8');
  },
  async remove() {
    /* Fragmentos inertes ficam restritos à evidência local ignorada. */
  },
};
const store = createChunkedIntentStore(kv, randomUUID);
const api = createApiClient({
  baseUrl: apiUrl,
  tenantId,
  getIdToken: async () => process.env.RECOVERY_TOKEN!,
  onSessionExpired: () => {},
});
async function main() {
  const mode = process.argv[2];
  if (mode === 'prepare') {
    const body = JSON.parse(process.env.RECOVERY_BODY!);
    const key = randomUUID(),
      resourceId = process.env.RECOVERY_ORDER!,
      scope = `${owner}:finance-resolution:${resourceId}`;
    const record: DurableIntent = {
      scope,
      uid,
      tenantId,
      kind: 'finance-resolution',
      resourceId,
      intentId: key,
      key,
      fingerprint: canonicalJson(body),
      body,
      status: 'prepared',
      executionId: null,
      revision: null,
      fencingToken: null,
    };
    await store.change(owner, (rows) => {
      if (rows.some((r) => r.scope === scope)) throw new Error('Intenção já existe');
      return [...rows, record];
    });
    // Commit HTTP confirmado, mas resposta é descartada. Nenhum executionId entra na persistência.
    await unwrap(
      api.POST('/api/v1/orders/{id}/financial-cancellation-executions', {
        params: {
          header: { 'X-Tenant-Id': tenantId, 'Idempotency-Key': key },
          path: { id: resourceId },
        },
        body,
      }),
    );
    console.log(JSON.stringify({ key, responseDiscarded: true }));
  } else {
    const rows = await store.read(owner),
      row = rows.find((r) => r.resourceId === process.env.RECOVERY_ORDER);
    if (!row) throw new Error('Intenção não recuperada');
    const pending = await unwrap(
      api.GET('/api/v1/financial-executions', {
        params: {
          header: { 'X-Tenant-Id': tenantId },
          query: { orderId: row.resourceId, pending: 'true', limit: '25' },
        },
      }),
    );
    if (mode === 'read') {
      console.log(
        JSON.stringify({
          key: row.key,
          pending: pending.items.map((e) => e.id),
          posts: 0,
          originalBody: row.body,
        }),
      );
      return;
    }
    const official = await unwrap(
      api.POST('/api/v1/orders/{id}/financial-cancellation-executions', {
        params: {
          header: { 'X-Tenant-Id': tenantId, 'Idempotency-Key': row.key },
          path: { id: row.resourceId },
        },
        body: row.body as CancellationInput,
      }),
    );
    console.log(JSON.stringify({ key: row.key, execution: official }));
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
