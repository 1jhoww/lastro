import { createApiClient } from '@/api/client';
import { SessionTransportGuard } from '@/session/transportGuard';
const post = () => new Request('http://api.test/financial', { method: 'POST' });
it('espera de token não permite enviar POST com contexto de outra empresa', async () => {
  const guard = new SessionTransportGuard();
  guard.changeUser('u1');
  let release!: (v: string) => void;
  const token = new Promise<string>((r) => {
      release = r;
    }),
    fetch = jest.fn();
  const api = createApiClient({
    baseUrl: 'http://api.test',
    tenantId: 't1',
    getIdToken: () => token,
    onSessionExpired: () => {},
    fetch,
    beforeSend: guard.capture('u1', 't1'),
  });
  const request = api.POST('/api/v1/orders/{id}/financial-cancellation', {
    params: {
      header: { 'X-Tenant-Id': 't1', 'Idempotency-Key': '00000000-0000-4000-8000-000000000001' },
      path: { id: 'o1' },
    },
    body: {
      expectedOrderVersion: 1,
      expectedGuardVersion: 1,
      disposition: 'refund',
      reason: 'Operação revisada',
    },
  });
  guard.changeUser('u2');
  release('token-u2');
  await expect(request).rejects.toMatchObject({ code: 'TENANT_ACCESS_DENIED' });
  expect(fetch).not.toHaveBeenCalled();
});
it('troca de empresa bloqueia writer antigo; novo cliente usa novo contexto', () => {
  const guard = new SessionTransportGuard();
  guard.changeUser('u1');
  const old = guard.capture('u1', 't1');
  guard.changeTenant();
  expect(() => old(post())).toThrow('Identidade ou empresa mudou');
  expect(() => guard.capture('u1', 't2')(post())).not.toThrow();
});
it('logout/login do mesmo UID também cerca transporte anterior', () => {
  const guard = new SessionTransportGuard();
  guard.changeUser('u1');
  const old = guard.capture('u1', 't1');
  guard.changeUser(null);
  guard.changeUser('u1');
  expect(() => old(post())).toThrow('Identidade ou empresa mudou');
  expect(() => guard.capture('u1', 't1')(post())).not.toThrow();
});
