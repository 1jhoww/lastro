import { createApiClient, unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import { createFakeApi, fail, ok } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';

const meData = { uid: 'u1', email: 'ana@lastro.test', platformAdmin: false, memberships: [] };

function setup(tenantId: string | null = null) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const server = createFakeApi();
  const onSessionExpired = jest.fn();
  const api = createApiClient({
    baseUrl: 'http://api.test',
    getIdToken: (f) => gateway.getIdToken(f),
    tenantId,
    onSessionExpired,
    fetch: server.fetch,
  });
  return { gateway, server, api, onSessionExpired };
}

describe('cliente HTTP', () => {
  it('envia o ID Token e não envia empresa nas rotas de identidade', async () => {
    const { server, api } = setup(null);
    server.on('GET', '/api/v1/me', () => ok(meData));
    await expect(unwrap(api.GET('/api/v1/me'))).resolves.toEqual(meData);
    expect(server.calls[0]?.headers.authorization).toBe('Bearer token-u1-v1');
    expect(server.calls[0]?.headers['x-tenant-id']).toBeUndefined();
  });

  it('cliente preso à empresa sempre envia o próprio X-Tenant-Id', async () => {
    const { server, api } = setup('empresa-a');
    server.on('GET', '/api/v1/tenants/current', () => ok({ id: 'empresa-a' }));
    // Mesmo que a tela passe outro id, o cliente da empresa A só fala com a empresa A.
    await unwrap(
      api.GET('/api/v1/tenants/current', { params: { header: { 'X-Tenant-Id': 'empresa-b' } } }),
    );
    expect(server.calls[0]?.headers['x-tenant-id']).toBe('empresa-a');
  });

  it('renova o token após 401 e repete uma vez', async () => {
    const { server, api, onSessionExpired } = setup();
    server.on('GET', '/api/v1/me', (c) =>
      c.headers.authorization === 'Bearer token-u1-v1' ? fail(401, 'UNAUTHORIZED') : ok(meData),
    );
    await expect(unwrap(api.GET('/api/v1/me'))).resolves.toEqual(meData);
    expect(server.calls.map((c) => c.headers.authorization)).toEqual([
      'Bearer token-u1-v1',
      'Bearer token-u1-v2',
    ]);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('segundo 401 encerra a sessão', async () => {
    const { server, api, onSessionExpired } = setup();
    server.on('GET', '/api/v1/me', () => fail(401, 'UNAUTHORIZED'));
    await expect(unwrap(api.GET('/api/v1/me'))).rejects.toMatchObject({ kind: 'session' });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('token revogado no provedor encerra a sessão', async () => {
    const { server, api, gateway, onSessionExpired } = setup();
    gateway.failRefresh = 'auth/user-token-expired';
    server.on('GET', '/api/v1/me', () => fail(401, 'UNAUTHORIZED'));
    await expect(unwrap(api.GET('/api/v1/me'))).rejects.toBeInstanceOf(ApiError);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('falha de rede ao renovar não derruba a sessão', async () => {
    const { server, api, gateway, onSessionExpired } = setup();
    gateway.failRefresh = 'auth/network-request-failed';
    server.on('GET', '/api/v1/me', () => fail(401, 'UNAUTHORIZED'));
    await expect(unwrap(api.GET('/api/v1/me'))).rejects.toBeInstanceOf(ApiError);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('servidor fora do ar vira erro de rede', async () => {
    const { api } = setup();
    await expect(unwrap(api.GET('/api/v1/me'))).rejects.toMatchObject({ kind: 'network' });
  });

  it('erro do backend preserva código estável', async () => {
    const { server, api } = setup('t1');
    server.on('GET', '/api/v1/tenants/current', () => fail(403, 'SUBSCRIPTION_SUSPENDED'));
    await expect(
      unwrap(api.GET('/api/v1/tenants/current', { params: { header: { 'X-Tenant-Id': 't1' } } })),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_SUSPENDED', kind: 'subscription' });
  });
});
