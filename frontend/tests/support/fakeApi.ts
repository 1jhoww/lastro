/**
 * Backend falso no nível do fetch: responde no formato real do contrato ({ data, requestId } ou
 * { error: { code, message, status, requestId } }) e registra cada chamada com seus cabeçalhos.
 */
export type Call = {
  method: string;
  path: string;
  /** Parâmetros da query string. */
  query: Record<string, string>;
  headers: Record<string, string>;
  /** JSON já decodificado; undefined para corpo vazio ou binário. */
  body: unknown;
  /** Tamanho do corpo em bytes (útil para uploads binários). */
  bodyBytes: number;
};
type Handler = (
  call: Call,
) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

const requestId = '00000000-0000-4000-8000-000000000000';

export const ok = (data: unknown, status = 200) => ({ status, body: { data, requestId } });
export const fail = (status: number, code: string, message = code) => ({
  status,
  body: { error: { code, message, status, requestId } },
});

export function createFakeApi() {
  const calls: Call[] = [];
  const routes = new Map<string, Handler>();

  const fetchImpl = async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const bytes = new Uint8Array(await req.arrayBuffer());
    const json = (headers['content-type'] ?? '').includes('json');
    const text = json ? new TextDecoder().decode(bytes) : '';
    const call: Call = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      body: text ? JSON.parse(text) : undefined,
      bodyBytes: bytes.byteLength,
    };
    calls.push(call);
    const handler = routes.get(`${req.method} ${url.pathname}`);
    if (!handler) throw new TypeError('Network request failed');
    // Respeita o AbortSignal como o fetch real: abortar (timeout) rejeita a chamada.
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const res = await new Promise<{ status: number; body?: unknown }>((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort);
      Promise.resolve(handler(call)).then(resolve, reject);
    });
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    calls,
    fetch: fetchImpl as typeof globalThis.fetch,
    on(method: string, path: string, handler: Handler) {
      routes.set(`${method} ${path}`, handler);
      return this;
    },
  };
}

/** Mesmas listas de backend/src/modules/users/permissions.ts. */
const seller = [
  'tenant:read',
  'products:read',
  'inventory:available:read',
  'customers:own:manage',
  'orders:own:create',
  'orders:own:confirm',
  'orders:own:read',
  'orders:own:dispatch',
  'orders:payment-options:read',
  'documents:own:read',
];
const administrator = [
  ...seller,
  'tenant:update',
  'users:manage',
  'customers:all:manage',
  'products:manage',
  'prices:manage',
  'discounts:apply',
  'inventory:manage',
  'orders:all:manage',
  'orders:dispatch',
  'reports:read',
  'receivables:read',
  'payments:manage',
  'payment-settings:manage',
  'payments:reverse',
  'financial-cancellation:manage',
  'refunds:manage',
  'returns:manage',
  'catalog:manage',
];

export const membership = (
  tenantId: string,
  role: 'administrator' | 'seller' = 'administrator',
  access: 'allowed' | 'suspended' | 'canceled' | 'provisioning' = 'allowed',
) => ({
  tenantId,
  role,
  access,
  permissions: access !== 'allowed' ? [] : role === 'administrator' ? administrator : seller,
  // Legacy contract: every existing capability, as before the official plans.
  plan: {
    code: null,
    name: null,
    userLimit: 2,
    features: ['users.invite', 'catalog.public', 'commercial.sellers'] as (
      'users.invite' | 'catalog.public' | 'commercial.sellers'
    )[],
  },
});

export const tenant = (id: string, name: string) => ({
  id,
  name,
  timezone: 'America/Sao_Paulo',
  status: 'active',
  version: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
});

const meta = {
  version: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  createdBy: 'u1',
  updatedBy: 'u1',
};

export const customer = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Cliente ${id}`,
  tradeName: null,
  document: null,
  email: null,
  phone: null,
  address: null,
  notes: null,
  assignedTo: null,
  status: 'active',
  ...meta,
  ...overrides,
});

export const product = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Produto ${id}`,
  description: '',
  sku: `SKU-${id.toUpperCase()}`,
  categoryId: null,
  unit: 'UN',
  quantityPrecision: 0,
  priceCents: 1990,
  catalogVisible: false,
  minimumStock: '0',
  image: null,
  status: 'active',
  ...meta,
  ...overrides,
});

export const category = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Categoria ${id}`,
  description: '',
  status: 'active',
  ...meta,
  ...overrides,
});

export const page = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });

/** Saldo na visão do administrador (`stockAdminView`). */
export const stockAdmin = (productId: string, overrides: Record<string, unknown> = {}) => ({
  productId,
  name: `Produto ${productId}`,
  sku: `SKU-${productId.toUpperCase()}`,
  unit: 'UN',
  status: 'active',
  physical: '10',
  reserved: '4',
  available: '6',
  minimumStock: '0',
  suggestedQuantity: '0',
  version: 3,
  lastMovementAt: '2026-10-10T12:00:00.000Z',
  ...overrides,
});

/** Saldo na visão do vendedor (`availabilityView`). */
export const stockAvailability = (productId: string, available = '6', unit = 'UN') => ({
  productId,
  name: `Produto ${productId}`,
  sku: `SKU-${productId.toUpperCase()}`,
  unit,
  available,
});

export const stockMovement = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  productId: 'p1',
  type: 'STOCK_ENTRY',
  unit: 'UN',
  sequence: 1,
  origin: 'administrative',
  originReference: '00000000-0000-4000-8000-000000000001',
  actorUid: 'u1',
  reason: 'Nota fiscal 1',
  notes: null,
  occurredAt: '2026-10-10T12:00:00.000Z',
  requestId,
  operationId: 'a'.repeat(64),
  quantity: '5',
  previousPhysical: '5',
  physical: '10',
  previousReserved: '4',
  reserved: '4',
  ...overrides,
});

/** Linha de pedido (snapshot do servidor). */
export const orderLine = (
  productId: string,
  quantity = '1',
  unitPriceCents = 1000,
  overrides: Record<string, unknown> = {},
) => {
  const milli = Math.round(Number(quantity) * 1000);
  const subtotal = Math.floor((unitPriceCents * milli + 500) / 1000);
  return {
    id: `line-${productId}`,
    productId,
    name: `Produto ${productId}`,
    sku: `SKU-${productId.toUpperCase()}`,
    description: '',
    unit: 'UN',
    quantity,
    unitPriceCents,
    subtotalCents: subtotal,
    discountCents: 0,
    totalCents: subtotal,
    ...overrides,
  };
};

/** Pedido (`orderView`); totais derivados das linhas, como o servidor faz. */
export const order = (id: string, overrides: Record<string, unknown> = {}) => {
  const lines = (overrides.lines as { subtotalCents: number }[] | undefined) ?? [];
  const total = lines.reduce((a, l) => a + l.subtotalCents, 0);
  return {
    id,
    commercialId: `PED-${id.toUpperCase()}-0000-4000-8000-000000000000`,
    customerId: 'c1',
    customerName: 'Mercado Central',
    sellerUid: 'u1',
    status: 'draft',
    lines,
    subtotalCents: total,
    discountCents: 0,
    totalCents: total,
    discount: null,
    payment: null,
    installments: [],
    notes: '',
    version: 1,
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
    createdBy: 'u1',
    updatedBy: 'u1',
    confirmedAt: null,
    confirmedBy: null,
    dispatchedAt: null,
    dispatchedBy: null,
    canceledAt: null,
    canceledBy: null,
    dispatchReference: null,
    ...overrides,
  };
};

export const orderEvent = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  orderId: 'o1',
  version: 1,
  type: 'created',
  previousStatus: null,
  status: 'draft',
  occurredAt: '2026-10-10T12:00:00.000Z',
  actorUid: 'u1',
  reason: null,
  requestId,
  operationId: null,
  ...overrides,
});
