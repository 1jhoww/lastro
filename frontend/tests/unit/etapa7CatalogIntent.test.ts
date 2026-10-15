import { createApiClient } from '@/api/client';
import { configureCatalog } from '@/features/publicCatalog/api';
import { intentLedger, intentScope, PendingIntentError } from '@/lib/intent';
const body = {
  expectedVersion: 0,
  slug: 'empresa-teste',
  enabled: true,
  tradeName: 'Empresa teste',
  description: '',
  whatsappNumber: '5511999999999',
  showPrices: true,
};
const result = {
  ...body,
  version: 1,
  createdAt: '2026-10-15T12:00:00.000Z',
  updatedAt: '2026-10-15T12:00:00.000Z',
  createdBy: 'u1',
  updatedBy: 'u1',
};
const scope = intentScope('u1', 't1', 'catalog-setting', 'catalog');
beforeEach(() => intentLedger.reset());
it('perda de resposta conserva chave e corpo após hidratação e não permite edição da intenção', async () => {
  const calls: { key: string | null; body: unknown }[] = [];
  let lost = true;
  const api = createApiClient({
    baseUrl: 'http://api.test',
    tenantId: 't1',
    getIdToken: async () => 'token',
    onSessionExpired: jest.fn(),
    fetch: async (input) => {
      const req = input as Request;
      calls.push({ key: req.headers.get('Idempotency-Key'), body: await req.json() });
      if (lost) {
        lost = false;
        throw new TypeError('Network request failed');
      }
      return new Response(JSON.stringify({ data: result }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  await expect(configureCatalog(api, 't1', scope, body, () => {})).rejects.toThrow();
  expect(intentLedger.get(scope)?.unknown).toBe(true);
  await intentLedger.hydrate('u1', 't1');
  await expect(
    configureCatalog(api, 't1', scope, { ...body, showPrices: false }, () => {}),
  ).rejects.toBeInstanceOf(PendingIntentError);
  await configureCatalog(api, 't1', scope, body, () => {});
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(intentLedger.get(scope)).toBeUndefined();
});
it('sessão trocada após persistência impede HTTP e preserva intenção preparada', async () => {
  const fetch = jest.fn();
  const api = createApiClient({
    baseUrl: 'http://api.test',
    tenantId: 't1',
    getIdToken: async () => 'token',
    onSessionExpired: jest.fn(),
    fetch,
  });
  await expect(
    configureCatalog(api, 't1', scope, body, () => {
      throw new Error('Sessão mudou');
    }),
  ).rejects.toThrow('Sessão mudou');
  expect(fetch).not.toHaveBeenCalled();
});
it('empresa e usuário têm escopos separados', () => {
  expect(intentScope('u1', 't1', 'catalog-setting', 'catalog')).not.toBe(
    intentScope('u2', 't1', 'catalog-setting', 'catalog'),
  );
  expect(scope).not.toBe(intentScope('u1', 't2', 'catalog-setting', 'catalog'));
});
