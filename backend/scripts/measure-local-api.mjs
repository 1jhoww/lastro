import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parse } from 'dotenv';
const credentials = parse(readFileSync('.env'));
const base = 'http://127.0.0.1:3000/api/v1';
const records = [];
const authStart = performance.now();
const auth = await fetch(
  'http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin.demo@lastro.invalid',
      password: credentials.LASTRO_DEMO_ADMIN_PASSWORD,
      returnSecureToken: true,
    }),
  },
);
const login = await auth.json();
if (!auth.ok || !login.idToken) throw new Error(`Demo Auth failed: ${auth.status}`);
const authMs = performance.now() - authStart;
const authorization = `Bearer ${login.idToken}`;
const meResponse = await fetch(base + '/me', { headers: { authorization } });
const me = await meResponse.json();
const tenant = me.data?.memberships.find((m) => m.access === 'allowed')?.tenantId;
if (!tenant) throw new Error('Demo account has no allowed company');
const headers = { authorization, 'X-Tenant-Id': tenant };
async function sample(endpoint, window) {
  const start = performance.now();
  const response = await fetch(base + endpoint, { headers, signal: AbortSignal.timeout(30000) });
  const bytes = await response.arrayBuffer();
  records.push({
    endpoint,
    window,
    status: response.status,
    ms: performance.now() - start,
    bytes: bytes.byteLength,
    requestId: response.headers.get('x-request-id'),
  });
}
const endpoints = [
  '/tenants/current',
  '/customers?limit=50',
  '/customers?limit=50&q=mer',
  '/products?limit=50',
  '/products?limit=50&q=ar',
  '/orders?limit=50',
  '/orders?limit=50&status=confirmed',
  '/inventory?limit=50',
  '/inventory/replenishment?limit=50',
  '/receivables?limit=50',
  '/payments?limit=50',
  '/visits?limit=50',
  '/reports/orders-status',
  '/reports/sales-period',
];
for (let window = 0; window < 3; window++) {
  for (const endpoint of endpoints)
    for (let i = 0; i < (window === 2 ? 34 : 33); i++) await sample(endpoint, window);
  console.log(`Completed local API window ${window + 1}`);
}
const output = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  environment: 'Local API, isolated imported demo data, loopback; unchanged read endpoints',
  authMs,
  records,
};
mkdirSync('../docs/audits/evidence/fase9', { recursive: true });
writeFileSync('../docs/audits/evidence/fase9/api-current.json', JSON.stringify(output, null, 2));
const errors = records.filter((r) => r.status !== 200);
console.log(
  JSON.stringify({
    samples: records.length,
    errors: errors.map((r) => ({ endpoint: r.endpoint, status: r.status })),
  }),
);
if (errors.length) process.exitCode = 1;
