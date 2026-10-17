/**
 * Local demo seed: fixed demo accounts, the "Distribuidora Demo Lastro" company and a coherent
 * commercial, stock and financial history. Emulator only.
 *
 * - Passwords come only from LASTRO_DEMO_*_PASSWORD (ignored backend/.env) and are never printed.
 * - Every business record goes through the real HTTP API (in-process app, real ID Tokens from the
 *   Auth Emulator), so domain validations, permissions and invariants apply unchanged.
 * - History is dated in the past by running the app with a shifted clock, the same technique as
 *   the integration tests; that is what produces overdue titles without impossible states.
 * - Idempotent: each record is found by a stable domain key (e-mail, SKU, CPF/CNPJ, name, order
 *   notes tag, payment reference) before creation. Existing data is never changed or removed.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { deleteApp } from 'firebase-admin/app';
import { loadConfig } from '../src/config/env.js';
import { createFirebase } from '../src/infrastructure/firebase/client.js';
import { createApp } from '../src/app/app.js';
import { FoundationRepository } from '../src/infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../src/modules/auth/accessService.js';
import { PlatformService } from '../src/modules/platformAdmin/platformService.js';
import { recordAudit } from '../src/shared/audit/audit.js';
import { createTenantInput } from '../src/shared/schemas/http.js';
import { billingDate } from '../src/modules/billing/calendar.js';
import { companyDate } from '../src/modules/orders/calculation.js';
import { validDocument } from '../src/modules/customers/documents.js';
import type { Actor } from '../src/shared/types/context.js';

const DEMO_PROJECT = 'demo-lastro-phase-a';
const TENANT_NAME = 'Distribuidora Demo Lastro';
const DAY = 86_400_000;
/** The company is created this many days before the seed's "today", so its history fits. */
const HISTORY_DAYS = 90;
const syncPasswords = process.argv.includes('--sync-passwords');

// ---------------------------------------------------------------------------------------------
// Safety: demo project, local emulators started by "npm run emulators", no real credentials.
// ---------------------------------------------------------------------------------------------
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_TOKEN;
const config = loadConfig();
if (
  config.mode !== 'emulator' ||
  config.projectId !== DEMO_PROJECT ||
  config.nodeEnv === 'production'
)
  throw new Error(`Seed permitido somente no projeto ${DEMO_PROJECT} com emuladores locais`);
const localHost = /^(127\.0\.0\.1|localhost):\d{2,5}$/;
for (const name of [
  'FIREBASE_AUTH_EMULATOR_HOST',
  'FIRESTORE_EMULATOR_HOST',
  'FIREBASE_STORAGE_EMULATOR_HOST',
])
  if (!localHost.test(process.env[name] ?? ''))
    throw new Error(`${name} deve apontar para localhost`);
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
async function requireEmulators() {
  const ok = async (url: string) => {
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
    } catch {
      return false;
    }
  };
  if (
    !(await ok(`http://${process.env.FIRESTORE_EMULATOR_HOST}/`)) ||
    !(await ok(`http://${authHost}/emulator/v1/projects/${DEMO_PROJECT}/config`))
  )
    throw new Error('Auth/Firestore Emulator indisponíveis. Inicie com "npm run emulators".');
  // Seeded data must land in the persisted development emulators, never in the test suite's.
  let state: { pid?: number; projectId?: string } = {};
  try {
    state = JSON.parse(readFileSync('.local/emulators.json', 'utf8'));
  } catch {
    /* checked below */
  }
  const hub = (await (await fetch('http://127.0.0.1:4400/')).json()) as { pid?: number };
  if (state.projectId !== DEMO_PROJECT || state.pid !== hub.pid)
    throw new Error('Os emuladores em execução não foram iniciados por "npm run emulators".');
}

// ---------------------------------------------------------------------------------------------
// Demo accounts.
// ---------------------------------------------------------------------------------------------
const accounts = {
  platform: {
    uid: 'local-platform-admin',
    email: 'platform.demo@lastro.invalid',
    name: 'Paula Plataforma',
    env: 'LASTRO_DEMO_PLATFORM_PASSWORD',
  },
  admin: {
    uid: 'demo-admin',
    email: 'admin.demo@lastro.invalid',
    name: 'Ana Administradora',
    env: 'LASTRO_DEMO_ADMIN_PASSWORD',
  },
  seller: {
    uid: 'demo-seller',
    email: 'vendedor.demo@lastro.invalid',
    name: 'Bruno Vendedor',
    env: 'LASTRO_DEMO_SELLER_PASSWORD',
  },
} as const;
type AccountKey = keyof typeof accounts;
interface User {
  uid: string;
  email: string;
  token: string;
}
function passwords(): Record<AccountKey, string> {
  const missing = Object.values(accounts).filter((a) => !process.env[a.env]);
  const weak = Object.values(accounts).filter(
    (a) => process.env[a.env] && process.env[a.env]!.length < 12,
  );
  if (missing.length || weak.length) {
    console.error(
      [
        'Senhas das contas demo não configuradas.',
        '',
        'Adicione ao arquivo backend/.env (ignorado pelo Git) uma senha própria, com 12+ caracteres, para cada conta:',
        ...Object.values(accounts).map((a) => `  ${a.env}=<senha de ${a.email}>`),
        '',
        missing.length ? `Ausentes: ${missing.map((a) => a.env).join(', ')}` : '',
        weak.length ? `Curtas demais: ${weak.map((a) => a.env).join(', ')}` : '',
        'Nada foi criado.',
      ]
        .filter((l, i, all) => l || all[i - 1])
        .join('\n'),
    );
    process.exit(1);
  }
  return Object.fromEntries(
    Object.entries(accounts).map(([key, a]) => [key, process.env[a.env]!]),
  ) as Record<AccountKey, string>;
}
async function signIn(email: string, password: string): Promise<string | null> {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { idToken?: string; error?: { message?: string } };
  if (response.ok && body.idToken) return body.idToken;
  if (/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/.test(body.error?.message ?? '')) return null;
  throw new Error(`Login local de ${email} falhou: ${body.error?.message ?? response.status}`);
}

// ---------------------------------------------------------------------------------------------
// Demo data. Fictitious companies and people; documents are only mathematically valid.
// ---------------------------------------------------------------------------------------------
function withCheckDigits(base: string, format: (d: string) => string) {
  for (let i = 0; i < 100; i++) {
    const candidate = base + String(i).padStart(2, '0');
    if (validDocument(candidate)) return format(candidate);
  }
  throw new Error('Documento sintético inválido');
}
const cnpj = (base: string) =>
  withCheckDigits(
    base,
    (d) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`,
  );
const cpf = (base: string) =>
  withCheckDigits(base, (d) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`);

const categories = [
  { name: 'Bebidas', description: 'Águas, refrigerantes, sucos e café.' },
  { name: 'Mercearia', description: 'Grãos, óleos, açúcar e frios.' },
  { name: 'Limpeza', description: 'Produtos de limpeza para comércio e cozinha industrial.' },
];
// prettier-ignore
const products = [
  { sku: 'BEB-001', name: 'Água mineral sem gás 500 ml (caixa com 12)', unit: 'CX', priceCents: 2390, minimumStock: '20', category: 'Bebidas' },
  { sku: 'BEB-002', name: 'Refrigerante cola 2 L (fardo com 6)', unit: 'PCT', priceCents: 4590, minimumStock: '15', category: 'Bebidas' },
  { sku: 'BEB-003', name: 'Suco de uva integral 1 L', unit: 'UN', priceCents: 1290, minimumStock: '24', category: 'Bebidas' },
  { sku: 'BEB-004', name: 'Café torrado e moído 500 g', unit: 'UN', priceCents: 1890, minimumStock: '30', category: 'Bebidas' },
  { sku: 'MER-001', name: 'Arroz branco tipo 1 5 kg', unit: 'PCT', priceCents: 2790, minimumStock: '20', category: 'Mercearia' },
  { sku: 'MER-002', name: 'Feijão carioca 1 kg', unit: 'PCT', priceCents: 849, minimumStock: '40', category: 'Mercearia' },
  { sku: 'MER-003', name: 'Açúcar refinado 1 kg', unit: 'PCT', priceCents: 529, minimumStock: '40', category: 'Mercearia' },
  { sku: 'MER-004', name: 'Óleo de soja 900 ml', unit: 'UN', priceCents: 799, minimumStock: '36', category: 'Mercearia' },
  { sku: 'MER-005', name: 'Queijo muçarela fatiado', unit: 'KG', priceCents: 3990, minimumStock: '10', category: 'Mercearia' },
  { sku: 'LIM-001', name: 'Detergente neutro 500 ml (caixa com 24)', unit: 'CX', priceCents: 4990, minimumStock: '25', category: 'Limpeza' },
  { sku: 'LIM-002', name: 'Desinfetante lavanda 2 L', unit: 'UN', priceCents: 1190, minimumStock: '12', category: 'Limpeza' },
] as const;
type Sku = (typeof products)[number]['sku'];
const sp = (
  street: string,
  number: string,
  district: string,
  postalCode: string,
  city = 'São Paulo',
) => ({
  street,
  number,
  district,
  city,
  state: 'SP',
  postalCode,
});
// prettier-ignore
const customers = [
  { ref: 'C01', seller: false, name: 'Mercado Bom Preço Ltda', tradeName: 'Mercado Bom Preço', document: cnpj('112223330001'), phone: '(11) 2601-4410', email: 'compras@bompreco.example', address: sp('Rua da Mooca', '1820', 'Mooca', '03103-002') },
  { ref: 'C02', seller: false, name: 'Padaria Pão Dourado Ltda', tradeName: 'Pão Dourado', document: cnpj('223334440001'), phone: '(11) 4432-1180', email: 'financeiro@paodourado.example', address: sp('Avenida Industrial', '455', 'Jardim', '09080-510', 'Santo André') },
  { ref: 'C03', seller: false, name: 'Restaurante Sabor Caseiro Ltda', tradeName: 'Sabor Caseiro', document: cnpj('334445550001'), phone: '(11) 3031-7720', email: null, address: sp('Rua dos Pinheiros', '930', 'Pinheiros', '05422-001') },
  { ref: 'C04', seller: false, name: 'Empório Vila Nova Comércio de Alimentos Ltda', tradeName: 'Empório Vila Nova', document: cnpj('445556660001'), phone: '(11) 2408-3355', email: null, address: sp('Avenida Paulo Faccini', '1200', 'Macedo', '07111-000', 'Guarulhos') },
  { ref: 'C05', seller: false, name: 'Lanchonete Ponto Certo Ltda', tradeName: 'Ponto Certo', document: cnpj('556667770001'), phone: '(11) 98450-2231', email: null, address: sp('Rua Augusta', '2101', 'Cerqueira César', '01413-000') },
  { ref: 'C06', seller: true, name: 'Minimercado Família Souza Ltda', tradeName: 'Família Souza', document: cnpj('667778880001'), phone: '(11) 3685-9010', email: 'souza@familiasouza.example', address: sp('Rua Antônio Agú', '310', 'Centro', '06013-000', 'Osasco') },
  { ref: 'C07', seller: true, name: 'Cantina Bella Itália Ltda', tradeName: 'Bella Itália', document: cnpj('778889990001'), phone: '(11) 3289-4471', email: null, address: sp('Rua Treze de Maio', '742', 'Bela Vista', '01327-000') },
  { ref: 'C08', seller: true, name: 'Hotel Recanto Verde Ltda', tradeName: 'Recanto Verde', document: cnpj('889990010001'), phone: '(19) 3254-8800', email: 'suprimentos@recantoverde.example', address: sp('Avenida Norte-Sul', '1550', 'Cambuí', '13025-320', 'Campinas') },
  { ref: 'C09', seller: false, name: 'Maria Aparecida Lima', tradeName: 'Buffet Dona Maria', document: cpf('390533447'), phone: '(11) 97733-1020', email: null, address: sp('Rua Cuevas', '88', 'Lapa', '05074-030') },
] as const;
type CustomerRef = (typeof customers)[number]['ref'];
const methods = [
  { name: 'Pix', kind: 'pix' },
  { name: 'Boleto bancário', kind: 'boleto' },
  { name: 'Dinheiro', kind: 'cash' },
  { name: 'Transferência bancária', kind: 'transfer' },
] as const;
type MethodName = (typeof methods)[number]['name'];
const conditions = [
  { name: 'À vista', preset: 'cash', description: 'Pagamento na entrega.' },
  { name: '30 dias', preset: 'net30', description: 'Parcela única em 30 dias.' },
  { name: '30/60 dias', preset: '30_60', description: 'Duas parcelas: 30 e 60 dias.' },
  { name: '30/60/90 dias', preset: '30_60_90', description: 'Três parcelas: 30, 60 e 90 dias.' },
] as const;
type ConditionName = (typeof conditions)[number]['name'];

/** History in days relative to the seed's "today" (0). Applied in chronological order. */
type Step =
  | {
      day: number;
      kind: 'entry';
      ref: string;
      sku: Sku;
      quantity: string;
      reason: string;
      notes: string;
    }
  | {
      day: number;
      kind: 'adjust';
      ref: string;
      sku: Sku;
      delta: string;
      reason: string;
      notes: string;
    }
  | {
      day: number;
      kind: 'order';
      ref: string;
      by: 'admin' | 'seller';
      customer: CustomerRef;
      lines: [Sku, string][];
      condition: ConditionName;
      method: MethodName;
      notes: string;
      discount?: { type: 'fixed' | 'percentage'; value: number; reason: string };
    }
  | { day: number; kind: 'confirm' | 'dispatch'; ref: string }
  | { day: number; kind: 'cancel'; ref: string; reason: string }
  | {
      day: number;
      kind: 'receipt';
      ref: string;
      receipt: string;
      installment: number;
      portion: number;
      method: MethodName;
    };
// prettier-ignore
const initialStock: [Sku, string][] = [
  ['BEB-001', '120'], ['BEB-002', '80'], ['BEB-003', '150'], ['BEB-004', '200'],
  ['MER-001', '100'], ['MER-002', '300'], ['MER-003', '300'], ['MER-004', '240'],
  ['MER-005', '45.5'], ['LIM-001', '40'], ['LIM-002', '30'],
];
// prettier-ignore
const history: Step[] = [
  ...initialStock.map(([sku, quantity], i): Step => ({
    day: -88, kind: 'entry', ref: `E${String(i + 1).padStart(2, '0')}`, sku, quantity,
    reason: 'Estoque inicial', notes: `Carga inicial de estoque · NF 10${i + 21}`,
  })),
  { day: -80, kind: 'order', ref: 'D01', by: 'admin', customer: 'C01', lines: [['BEB-001', '10'], ['MER-001', '15'], ['MER-003', '30']], condition: '30/60 dias', method: 'Boleto bancário', notes: 'Entrega pela doca lateral, até 10h.' },
  { day: -80, kind: 'confirm', ref: 'D01' },
  { day: -79, kind: 'dispatch', ref: 'D01' },
  { day: -72, kind: 'order', ref: 'D02', by: 'seller', customer: 'C06', lines: [['BEB-002', '12'], ['MER-002', '40'], ['MER-004', '24']], condition: '30 dias', method: 'Pix', notes: 'Cliente pediu nota com CNPJ da matriz.' },
  { day: -72, kind: 'confirm', ref: 'D02' },
  { day: -71, kind: 'dispatch', ref: 'D02' },
  { day: -60, kind: 'order', ref: 'D03', by: 'admin', customer: 'C02', lines: [['MER-005', '12.75'], ['BEB-004', '20'], ['MER-003', '20']], condition: '30/60/90 dias', method: 'Boleto bancário', notes: 'Pedido mensal da padaria.', discount: { type: 'percentage', value: 500, reason: 'Cliente recorrente' } },
  { day: -60, kind: 'confirm', ref: 'D03' },
  { day: -59, kind: 'dispatch', ref: 'D03' },
  { day: -50, kind: 'receipt', ref: 'D01', receipt: 'R1', installment: 1, portion: 1, method: 'Boleto bancário' },
  { day: -48, kind: 'order', ref: 'D04', by: 'seller', customer: 'C07', lines: [['BEB-003', '24'], ['MER-001', '10'], ['LIM-001', '6']], condition: '30 dias', method: 'Boleto bancário', notes: 'Entregar após as 15h (cozinha fechada pela manhã).' },
  { day: -48, kind: 'confirm', ref: 'D04' },
  { day: -47, kind: 'dispatch', ref: 'D04' },
  { day: -40, kind: 'adjust', ref: 'A01', sku: 'MER-002', delta: '-6', reason: 'Avaria no armazenamento', notes: 'Embalagens rasgadas encontradas na conferência.' },
  { day: -40, kind: 'adjust', ref: 'A02', sku: 'LIM-002', delta: '-2', reason: 'Inventário mensal', notes: 'Diferença na contagem física.' },
  { day: -40, kind: 'receipt', ref: 'D02', receipt: 'R1', installment: 1, portion: 0.5, method: 'Pix' },
  { day: -35, kind: 'order', ref: 'D05', by: 'admin', customer: 'C03', lines: [['MER-005', '8.25'], ['MER-004', '12'], ['BEB-004', '10']], condition: 'À vista', method: 'Pix', notes: 'Pagamento via Pix na entrega.' },
  { day: -35, kind: 'confirm', ref: 'D05' },
  { day: -35, kind: 'dispatch', ref: 'D05' },
  { day: -35, kind: 'receipt', ref: 'D05', receipt: 'R1', installment: 1, portion: 1, method: 'Pix' },
  { day: -30, kind: 'order', ref: 'D06', by: 'admin', customer: 'C04', lines: [['BEB-002', '5']], condition: '30 dias', method: 'Boleto bancário', notes: 'Orçamento enviado por telefone.' },
  { day: -29, kind: 'receipt', ref: 'D03', receipt: 'R1', installment: 1, portion: 1, method: 'Boleto bancário' },
  { day: -29, kind: 'cancel', ref: 'D06', reason: 'Cliente desistiu da compra' },
  { day: -25, kind: 'entry', ref: 'E12', sku: 'BEB-001', quantity: '60', reason: 'Reposição de fornecedor', notes: 'NF 10433 · Fornecedor Águas da Serra' },
  { day: -25, kind: 'entry', ref: 'E13', sku: 'MER-001', quantity: '40', reason: 'Reposição de fornecedor', notes: 'NF 10434 · Cerealista Paulista' },
  { day: -22, kind: 'order', ref: 'D07', by: 'seller', customer: 'C08', lines: [['LIM-001', '10'], ['LIM-002', '12'], ['BEB-001', '20']], condition: '30/60 dias', method: 'Transferência bancária', notes: 'Recebimento no almoxarifado do hotel.' },
  { day: -22, kind: 'confirm', ref: 'D07' },
  { day: -21, kind: 'dispatch', ref: 'D07' },
  { day: -20, kind: 'receipt', ref: 'D01', receipt: 'R2', installment: 2, portion: 1, method: 'Boleto bancário' },
  { day: -12, kind: 'order', ref: 'D08', by: 'admin', customer: 'C09', lines: [['BEB-003', '18'], ['MER-003', '10']], condition: 'À vista', method: 'Dinheiro', notes: 'Retirada no balcão.' },
  { day: -12, kind: 'confirm', ref: 'D08' },
  { day: -12, kind: 'dispatch', ref: 'D08' },
  { day: -12, kind: 'receipt', ref: 'D08', receipt: 'R1', installment: 1, portion: 1, method: 'Dinheiro' },
  { day: -10, kind: 'receipt', ref: 'D07', receipt: 'R1', installment: 1, portion: 0.4, method: 'Transferência bancária' },
  { day: -6, kind: 'order', ref: 'D09', by: 'admin', customer: 'C05', lines: [['MER-002', '30'], ['MER-004', '20'], ['BEB-002', '10']], condition: '30 dias', method: 'Boleto bancário', notes: 'Aguardando agenda de entrega do cliente.' },
  { day: -6, kind: 'confirm', ref: 'D09' },
  { day: -3, kind: 'order', ref: 'D10', by: 'seller', customer: 'C06', lines: [['BEB-001', '15'], ['LIM-002', '8']], condition: '30 dias', method: 'Pix', notes: 'Reposição semanal.' },
  { day: -3, kind: 'confirm', ref: 'D10' },
  { day: -1, kind: 'order', ref: 'D11', by: 'admin', customer: 'C01', lines: [['MER-001', '20'], ['BEB-004', '15']], condition: '30/60 dias', method: 'Boleto bancário', notes: 'Proposta de volume; aguardando aprovação do comprador.', discount: { type: 'fixed', value: 5000, reason: 'Negociação de volume' } },
  { day: 0, kind: 'order', ref: 'D12', by: 'seller', customer: 'C07', lines: [['BEB-003', '12']], condition: '30 dias', method: 'Boleto bancário', notes: 'Rascunho a confirmar com o cliente.' },
];
const tag = (ref: string) => `[demo:${ref}]`;
const tagged = (text: string, ref: string) => `${text} ${tag(ref)}`;

// ---------------------------------------------------------------------------------------------
// Runtime.
// ---------------------------------------------------------------------------------------------
await requireEmulators().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
const secrets = passwords();
const firebase = createFirebase(config);
const repo = new FoundationRepository(firebase.db);
let offset = 0;
let shifted = false;
const clock = () => new Date(Date.now() + offset);
let anchor = Date.now();
/** Moves the app clock to `day` relative to the seed's today, never backwards. */
function at(day: number) {
  const now = Date.now();
  const target = anchor + day * DAY;
  const next = shifted ? Math.max(target, now + offset + 1000) : target;
  offset = next - now;
  shifted = true;
}
const app = createApp({ ...config, nodeEnv: 'test', rateLimitMax: 10_000 }, firebase, clock);
const server = await new Promise<ReturnType<typeof app.listen>>((done) => {
  const s = app.listen(0, '127.0.0.1', () => done(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
const summary = { created: [] as string[], kept: 0, warnings: [] as string[] };
const created = (what: string) => {
  summary.created.push(what);
  console.log(`  + ${what}`);
};
let tenantId = '';
async function api<T = unknown>(
  user: User,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  options: { body?: unknown; key?: boolean } = {},
): Promise<T> {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${user.token}`,
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.key ? { 'Idempotency-Key': randomUUID() } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : null,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok)
    throw new Error(
      `${method} ${path.split('?')[0]}: ${response.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`.trim(),
    );
  return json?.data as T;
}
async function all<T = unknown>(user: User, path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const page: { items: T[]; nextCursor: string | null } = await api(
      user,
      'GET',
      `${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function ensureAccount(key: AccountKey): Promise<User> {
  const a = accounts[key];
  const password = secrets[key];
  let user = await firebase.auth.getUserByEmail(a.email).catch((error: { code?: string }) => {
    if (error.code === 'auth/user-not-found') return null;
    throw error;
  });
  if (!user) {
    user = await firebase.auth.createUser({
      uid: a.uid,
      email: a.email,
      emailVerified: true,
      password,
      displayName: a.name,
    });
    created(`conta ${a.email}`);
  } else {
    if (user.disabled) throw new Error(`Conta ${a.email} está desativada; nada foi alterado.`);
    // Only fills what is missing; an existing name is kept.
    if (!user.emailVerified || !user.displayName)
      await firebase.auth.updateUser(user.uid, {
        ...(!user.emailVerified ? { emailVerified: true } : {}),
        ...(!user.displayName ? { displayName: a.name } : {}),
      });
    summary.kept++;
  }
  let token = await signIn(a.email, password);
  if (!token) {
    if (!syncPasswords)
      throw new Error(
        `A senha atual de ${a.email} no emulador difere de ${a.env}. Para aplicar a senha do .env (somente no emulador): npm run seed:local -- --sync-passwords`,
      );
    await firebase.auth.updateUser(user.uid, { password });
    token = await signIn(a.email, password);
    if (!token) throw new Error(`Falha ao sincronizar a senha de ${a.email}`);
    console.log(`  ~ senha de ${a.email} sincronizada com ${a.env}`);
  }
  return { uid: user.uid, email: a.email, token };
}
async function actorOf(user: User): Promise<Actor> {
  const token = await firebase.auth.verifyIdToken(user.token, true);
  return {
    uid: token.uid,
    email: token.email ?? null,
    emailVerified: token.email_verified ?? false,
    authTime: token.auth_time,
    requestId: randomUUID(),
  };
}
async function ensurePlatformAdmin(user: User) {
  const [identity, admin] = await Promise.all([
    firebase.db.doc(`identities/${user.uid}`).get(),
    firebase.db.doc(`platformAdmins/${user.uid}`).get(),
  ]);
  if (identity.exists && admin.exists) {
    if (identity.get('status') !== 'active' || admin.get('status') !== 'active')
      summary.warnings.push('Super Admin demo existe, mas não está ativo; nada foi alterado.');
    return;
  }
  // Bootstrap of the first platform administrator, as the previous local seed did.
  const now = clock().toISOString();
  await firebase.db.runTransaction(async (tx) => {
    if (!identity.exists)
      tx.create(repo.global('identities', user.uid), {
        uid: user.uid,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
    if (!admin.exists)
      tx.create(repo.global('platformAdmins', user.uid), {
        uid: user.uid,
        status: 'active',
        createdAt: now,
        schemaVersion: 1,
      });
    recordAudit(repo, tx, await actorOf(user), null, 'platform.bootstrap.local', user.uid, now, {});
  });
  created('Super Admin da plataforma');
}

async function ensureTenant(platform: User, admin: User, seller: User) {
  const found = await firebase.db
    .collection('tenants')
    .where('name', '==', TENANT_NAME)
    .limit(2)
    .get();
  if (found.size > 1)
    throw new Error(`Há mais de uma empresa "${TENANT_NAME}"; resolva manualmente.`);
  if (found.size === 1) {
    const tenant = found.docs[0]!;
    tenantId = tenant.id;
    // The seed's "today" is fixed by the company's creation, so reruns keep the same dates.
    anchor = Date.parse(tenant.get('createdAt')) + HISTORY_DAYS * DAY;
    const membership = await firebase.db.doc(`tenants/${tenantId}/memberships/${admin.uid}`).get();
    if (!membership.exists || membership.get('status') !== 'active')
      throw new Error(
        `"${TENANT_NAME}" existe, mas ${admin.email} não é membro ativo; nada foi alterado.`,
      );
    summary.kept++;
  } else {
    at(-HISTORY_DAYS - 1);
    await ensurePlatformAdmin(platform);
    at(-HISTORY_DAYS);
    // Same service as POST /admin/tenants. The HTTP layer's 5-minute re-authentication check
    // compares the token's real login time with the app clock, so it cannot apply to a
    // back-dated clock; the service still requires an active Super Admin.
    const platformService = new PlatformService(repo, new AccessService(repo), config, clock);
    const result = await platformService.createTenant(
      await actorOf(platform),
      createTenantInput.parse({
        name: TENANT_NAME,
        ownerEmail: admin.email,
        planCode: 'profissional',
        billingDay: 10,
        billingStartsOn: billingDate(clock()),
        commercialNotes: 'Empresa de demonstração do ambiente local.',
      }),
      randomUUID(),
    );
    tenantId = result.tenant.id;
    created(`empresa ${TENANT_NAME}`);
    await api(admin, 'POST', '/users/invitations/accept', {
      body: { token: result.ownerInvitation.token },
    });
    created(`vínculo administrador ${admin.email}`);
  }
  await ensurePlatformAdmin(platform);
  const sellerMembership = await firebase.db
    .doc(`tenants/${tenantId}/memberships/${seller.uid}`)
    .get();
  if (sellerMembership.exists) summary.kept++;
  else {
    at(-HISTORY_DAYS + 1);
    const invitation = await api<{ token: string }>(admin, 'POST', '/users/invitations', {
      body: { email: seller.email, role: 'seller' },
    });
    await api(seller, 'POST', '/users/invitations/accept', { body: { token: invitation.token } });
    created(`vínculo vendedor ${seller.email}`);
  }
}

interface Setting {
  id: string;
  name: string;
  version: number;
}
async function ensureCatalog(admin: User, seller: User) {
  at(-HISTORY_DAYS + 1);
  const existingCategories = await all<{ id: string; name: string }>(
    admin,
    '/categories?status=all',
  );
  const categoryIds = new Map(existingCategories.map((c) => [c.name, c.id]));
  for (const category of categories) {
    if (categoryIds.has(category.name)) {
      summary.kept++;
      continue;
    }
    const result = await api<{ id: string }>(admin, 'POST', '/categories', { body: category });
    categoryIds.set(category.name, result.id);
    created(`categoria ${category.name}`);
  }
  const existingMethods = await all<Setting>(admin, '/payment-methods?status=all');
  const methodByName = new Map(existingMethods.map((m) => [m.name, m]));
  for (const method of methods) {
    if (methodByName.has(method.name)) {
      summary.kept++;
      continue;
    }
    methodByName.set(
      method.name,
      await api<Setting>(admin, 'POST', '/payment-methods', { body: method, key: true }),
    );
    created(`forma de pagamento ${method.name}`);
  }
  const existingConditions = await all<Setting>(admin, '/payment-conditions?status=all');
  const conditionByName = new Map(existingConditions.map((c) => [c.name, c]));
  for (const condition of conditions) {
    if (conditionByName.has(condition.name)) {
      summary.kept++;
      continue;
    }
    conditionByName.set(
      condition.name,
      await api<Setting>(admin, 'POST', '/payment-conditions', { body: condition, key: true }),
    );
    created(`condição de pagamento ${condition.name}`);
  }
  const productIds = new Map<Sku, string>();
  for (const { category, ...product } of products) {
    const page = await api<{ items: { id: string }[] }>(
      admin,
      'GET',
      `/products?status=all&sku=${encodeURIComponent(product.sku)}`,
    );
    if (page.items[0]) {
      productIds.set(product.sku, page.items[0].id);
      summary.kept++;
      continue;
    }
    const result = await api<{ id: string }>(admin, 'POST', '/products', {
      body: { ...product, categoryId: categoryIds.get(category) ?? null, catalogVisible: true },
    });
    productIds.set(product.sku, result.id);
    created(`produto ${product.sku}`);
  }
  const customerIds = new Map<CustomerRef, string>();
  for (const { ref, seller: assigned, ...customer } of customers) {
    const page = await api<{ items: { id: string }[] }>(
      admin,
      'GET',
      `/customers?status=all&document=${encodeURIComponent(customer.document)}`,
    );
    if (page.items[0]) {
      customerIds.set(ref, page.items[0].id);
      summary.kept++;
      continue;
    }
    const result = await api<{ id: string }>(admin, 'POST', '/customers', {
      body: { ...customer, assignedTo: assigned ? seller.uid : null },
    });
    customerIds.set(ref, result.id);
    created(`cliente ${customer.tradeName}`);
  }
  return { productIds, customerIds, methodByName, conditionByName };
}

interface Order {
  id: string;
  version: number;
  status: 'draft' | 'confirmed' | 'dispatched' | 'canceled';
  customerId: string;
  notes?: string | null;
}
async function applyHistory(
  users: Record<'admin' | 'seller', User>,
  refs: Awaited<ReturnType<typeof ensureCatalog>>,
) {
  const { admin } = users;
  const orders = new Map<string, Order>();
  for (const order of await all<Order>(admin, '/orders')) {
    const match = /\[demo:(D\d+)\]/.exec(order.notes ?? '');
    if (match) orders.set(match[1]!, order);
  }
  const movementTags = new Set<string>();
  for (const productId of refs.productIds.values())
    for (const movement of await all<{ notes?: string | null }>(
      admin,
      `/inventory/movements?productId=${productId}`,
    ))
      for (const match of (movement.notes ?? '').matchAll(/\[demo:([EA]\d+)\]/g))
        movementTags.add(match[1]!);
  const creators = new Map<string, User>();
  for (const step of history) if (step.kind === 'order') creators.set(step.ref, users[step.by]);
  const reload = async (ref: string) => {
    const order = await api<Order>(admin, 'GET', `/orders/${orders.get(ref)!.id}`);
    orders.set(ref, order);
    return order;
  };
  const steps = [...history].sort((a, b) => a.day - b.day);
  for (const step of steps) {
    const label = `${step.ref}${step.kind === 'receipt' ? `-${step.receipt}` : ''} (${step.kind})`;
    try {
      if (step.kind === 'entry' || step.kind === 'adjust') {
        if (movementTags.has(step.ref)) {
          summary.kept++;
          continue;
        }
        at(step.day);
        const productId = refs.productIds.get(step.sku)!;
        const notes = tagged(step.notes, step.ref);
        if (step.kind === 'entry')
          await api(admin, 'POST', '/inventory/entries', {
            body: { productId, quantity: step.quantity, reason: step.reason, notes },
            key: true,
          });
        else {
          const stock = await api<{ version: number }>(admin, 'GET', `/inventory/${productId}`);
          await api(admin, 'POST', '/inventory/adjustments', {
            body: {
              productId,
              delta: step.delta,
              expectedVersion: stock.version,
              reason: step.reason,
              notes,
            },
            key: true,
          });
        }
        created(
          `${step.kind === 'entry' ? 'entrada' : 'ajuste'} de estoque ${step.ref} ${step.sku}`,
        );
        continue;
      }
      if (step.kind === 'order') {
        if (orders.has(step.ref)) {
          summary.kept++;
          continue;
        }
        at(step.day);
        const condition = refs.conditionByName.get(step.condition)!;
        const method = refs.methodByName.get(step.method)!;
        const order = await api<Order>(users[step.by], 'POST', '/orders', {
          body: {
            customerId: refs.customerIds.get(step.customer)!,
            lines: step.lines.map(([sku, quantity]) => ({
              productId: refs.productIds.get(sku)!,
              quantity,
            })),
            paymentConditionId: condition.id,
            paymentConditionVersion: condition.version,
            intendedPaymentMethodId: method.id,
            intendedPaymentMethodVersion: method.version,
            notes: tagged(step.notes, step.ref),
            ...(step.discount ? { discount: step.discount } : {}),
          },
        });
        orders.set(step.ref, order);
        created(`pedido ${step.ref}`);
        continue;
      }
      if (!orders.has(step.ref)) {
        summary.warnings.push(`${label}: pedido ${step.ref} inexistente; passo ignorado`);
        continue;
      }
      if (step.kind === 'receipt') {
        const order = await reload(step.ref);
        const reference = `demo:${step.ref}-${step.receipt}`;
        const payments = await all<{ reference: string }>(admin, `/payments?orderId=${order.id}`);
        if (payments.some((p) => p.reference === reference)) {
          summary.kept++;
          continue;
        }
        if (order.status !== 'confirmed' && order.status !== 'dispatched') {
          summary.warnings.push(`${label}: pedido em ${order.status}; recebimento não registrado`);
          continue;
        }
        at(step.day);
        const titles = await all<{
          id: string;
          installmentNumber: number;
          outstandingCents: number;
          version: number;
        }>(admin, `/receivables?orderId=${order.id}`);
        const title = titles.find((t) => t.installmentNumber === step.installment);
        const amount = title ? Math.round(title.outstandingCents * step.portion) : 0;
        if (!title || amount <= 0) {
          summary.warnings.push(
            `${label}: parcela ${step.installment} sem saldo; recebimento não registrado`,
          );
          continue;
        }
        const state = await api<{ guardVersion: number }>(
          admin,
          'GET',
          `/orders/${order.id}/financial-state`,
        );
        const method = refs.methodByName.get(step.method)!;
        await api(admin, 'POST', `/orders/${order.id}/receipts`, {
          key: true,
          body: {
            expectedOrderVersion: order.version,
            expectedGuardVersion: state.guardVersion,
            customerId: order.customerId,
            methodId: method.id,
            methodVersion: method.version,
            amountCents: amount,
            receivedOn: companyDate(clock(), 'America/Sao_Paulo'),
            allocations: [
              { receivableId: title.id, amountCents: amount, expectedVersion: title.version },
            ],
            reference,
            reason: step.portion < 1 ? 'Pagamento parcial do cliente' : 'Pagamento da parcela',
          },
        });
        created(`recebimento ${step.ref}-${step.receipt}`);
        continue;
      }
      const order = await reload(step.ref);
      const from = { confirm: 'draft', dispatch: 'confirmed', cancel: 'draft' }[step.kind];
      if (order.status !== from) {
        const done = {
          confirm: ['confirmed', 'dispatched'],
          dispatch: ['dispatched'],
          cancel: ['canceled'],
        }[step.kind];
        if (done.includes(order.status)) summary.kept++;
        else summary.warnings.push(`${label}: pedido em ${order.status}; passo ignorado`);
        continue;
      }
      at(step.day);
      const actor = step.kind === 'cancel' ? admin : creators.get(step.ref)!;
      orders.set(
        step.ref,
        await api<Order>(actor, 'POST', `/orders/${order.id}/${step.kind}`, {
          key: true,
          body: {
            expectedVersion: order.version,
            ...(step.kind === 'cancel' ? { reason: step.reason } : {}),
          },
        }),
      );
      created(
        `pedido ${step.ref} ${{ confirm: 'confirmado', dispatch: 'expedido', cancel: 'cancelado' }[step.kind]}`,
      );
    } catch (error) {
      summary.warnings.push(`${label}: ${(error as Error).message}`);
    }
  }
}

try {
  console.log(`Seed local (${DEMO_PROJECT})`);
  const platform = await ensureAccount('platform');
  const admin = await ensureAccount('admin');
  const seller = await ensureAccount('seller');
  await ensureTenant(platform, admin, seller);
  const refs = await ensureCatalog(admin, seller);
  await applyHistory({ admin, seller }, refs);
  console.log(
    [
      '',
      summary.created.length
        ? `${summary.created.length} registro(s) criado(s).`
        : 'Nada a criar: dados demo já completos.',
      `${summary.kept} registro(s) existente(s) preservado(s).`,
      ...summary.warnings.map((w) => `[aviso] ${w}`),
      '',
      `Contas: ${Object.values(accounts)
        .map((a) => a.email)
        .join(', ')} (senhas em backend/.env).`,
      `Empresa: ${TENANT_NAME} (${tenantId}).`,
    ].join('\n'),
  );
  if (summary.warnings.length) process.exitCode = 1;
} catch (error) {
  console.error(`Seed interrompido: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await new Promise((done) => server.close(done));
  await firebase.db.terminate();
  await deleteApp(firebase.app);
}
