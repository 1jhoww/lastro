/**
 * Apoio aos E2E contra o backend real e os emuladores locais: login no Auth Emulator, o mesmo
 * cliente HTTP do app (`src/api/client.ts`), empresa sintética (@lastro.invalid) e verificações.
 */
import { randomUUID } from 'node:crypto';
import { createApiClient, unwrap, type ApiClient } from '../src/api/client';
import { ApiError } from '../src/api/errors';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const AUTH = 'http://127.0.0.1:9099';
const PROJECT = 'demo-lastro-phase-a';
export const seedPassword = process.env.SEED_PASSWORD ?? '';
if (!seedPassword) throw new Error('Defina SEED_PASSWORD com a senha mostrada pelo seed');

export const results: { name: string; ok: boolean; detail?: string }[] = [];
export async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
export async function expectError(promise: Promise<unknown>, status: number, code?: string) {
  try {
    await promise;
  } catch (e) {
    assert(e instanceof ApiError, `esperava ApiError, veio ${String(e)}`);
    assert(e.status === status, `status ${e.status} (${e.code}), esperado ${status}`);
    if (code) assert(e.code === code, `código ${e.code}, esperado ${code}`);
    return e;
  }
  throw new Error(`esperava erro ${status}${code ? ` ${code}` : ''}, veio sucesso`);
}

/** Imprime o resultado e define o código de saída. */
export function report(extra: string[] = []) {
  const failed = results.filter((r) => !r.ok);
  for (const r of results)
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  console.log(`\n${results.length - failed.length}/${results.length} verificações aprovadas`);
  for (const line of extra) console.log(line);
  if (failed.length) process.exitCode = 1;
}

/* ---------- Auth emulator ---------- */

async function authCall(path: string, body: unknown, owner = false) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=fake-key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(owner ? { Authorization: 'Bearer owner' } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`auth ${path}: ${JSON.stringify(json)}`);
  return json;
}
export async function signIn(email: string, password: string) {
  const r = await authCall('accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true,
  });
  return { uid: String(r.localId), token: String(r.idToken) };
}
export async function createVerifiedUser(email: string) {
  const password = randomUUID();
  const r = await authCall('accounts:signUp', { email, password, returnSecureToken: true });
  await authCall(
    `projects/${PROJECT}/accounts:update`,
    { localId: r.localId, emailVerified: true },
    true,
  );
  return { ...(await signIn(email, password)), email, password };
}

export function client(token: string, tenantId: string | null): ApiClient {
  return createApiClient({
    baseUrl: API,
    getIdToken: async () => token,
    tenantId,
    onSessionExpired: () => {
      throw new Error('sessão expirada');
    },
  });
}
export const header = (tenantId: string) => ({ 'X-Tenant-Id': tenantId });

/** Empresa sintética com administrador (dono do convite) já aceito. */
export async function createTenant(root: ApiClient, name: string) {
  const plans = await unwrap(root.GET('/api/v1/admin/plans', {}));
  const plan = plans.items.find((p) => p.status === 'active');
  assert(plan, 'nenhum plano ativo no seed');
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = `admin.${suffix}@lastro.invalid`;
  const created = await unwrap(
    root.POST('/api/v1/admin/tenants', {
      params: { header: { 'Idempotency-Key': randomUUID() } },
      body: { name, planId: plan.id, ownerEmail },
    }),
  );
  const owner = await createVerifiedUser(ownerEmail);
  await unwrap(
    client(owner.token, null).POST('/api/v1/users/invitations/accept', {
      body: { token: created.ownerInvitation.token },
    }),
  );
  return { tenantId: created.tenant.id, admin: owner };
}

/** Vendedor convidado pelo administrador e já aceito. */
export async function createSeller(admin: ApiClient, tenantId: string) {
  const email = `vendedor.${randomUUID().slice(0, 8)}@lastro.invalid`;
  const invite = await unwrap(
    admin.POST('/api/v1/users/invitations', {
      params: { header: header(tenantId) },
      body: { email, role: 'seller' },
    }),
  );
  const user = await createVerifiedUser(email);
  await unwrap(
    client(user.token, null).POST('/api/v1/users/invitations/accept', {
      body: { token: invite.token },
    }),
  );
  return user;
}

/** Endereço completo: obrigatório ao cadastrar cliente pela API. */
export const e2eAddress = {
  postalCode: '01310100',
  street: 'Avenida Paulista',
  number: 'S/N',
  district: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
};
