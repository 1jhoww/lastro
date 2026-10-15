import { ApiError, classify, toApiError } from '@/api/errors';

describe('classificação de erros da API', () => {
  it.each([
    [401, 'UNAUTHORIZED', 'session'],
    [403, 'SUBSCRIPTION_SUSPENDED', 'subscription'],
    [403, 'SUBSCRIPTION_INACTIVE', 'subscription'],
    [403, 'TENANT_ACCESS_DENIED', 'forbidden'],
    [404, 'RESOURCE_NOT_FOUND', 'notFound'],
    [409, 'CONFLICT', 'conflict'],
    [409, 'INSUFFICIENT_STOCK', 'conflict'],
    [422, 'INVALID_DUE_DATE', 'validation'],
    [429, 'RATE_LIMITED', 'rateLimited'],
    [500, 'INTERNAL_ERROR', 'server'],
    [0, 'NETWORK_ERROR', 'network'],
  ])('%i %s → %s', (status, code, kind) => {
    expect(classify(status, code)).toBe(kind);
  });

  it('usa mensagem por código e cai na mensagem da categoria', () => {
    expect(new ApiError(409, 'INSUFFICIENT_STOCK', 'x').userMessage).toMatch(/insuficiente/);
    expect(new ApiError(409, 'ALGO_NOVO', 'x').userMessage).toMatch(/mudaram/);
  });

  it('converte falha de rede em ApiError', () => {
    expect(toApiError(new TypeError('Failed to fetch')).kind).toBe('network');
  });
});
