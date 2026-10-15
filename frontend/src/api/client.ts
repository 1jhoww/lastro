import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { ApiError, retryAfterSeconds } from './errors';
import { defaultFetch } from './defaultFetch';

export type { paths };

export type ApiClientDeps = {
  baseUrl: string;
  /** ID Token atual do provedor. `force` pede um novo, ignorando o cache. */
  getIdToken: (force?: boolean) => Promise<string | null>;
  /**
   * Empresa à qual este cliente está preso. Candidata, nunca prova de autorização: o servidor
   * revalida o vínculo a cada chamada. null = cliente de identidade/plataforma.
   */
  tenantId: string | null;
  /** Token recusado mesmo depois de renovado: a sessão acabou. */
  onSessionExpired: () => void;
  fetch?: typeof globalThis.fetch;
  /** Confere identidade/sessão depois de aguardar token e antes de enviar bytes. */
  beforeSend?: (request: Request) => void;
};

/**
 * Cliente tipado pelos `paths` gerados do contrato OpenAPI do backend: caminhos, parâmetros e
 * corpos que não existem no contrato não compilam.
 *
 * Cada cliente fica preso a uma empresa. Trocar de empresa cria outro cliente, então uma
 * resposta atrasada nunca é enviada ou gravada com o cabeçalho da empresa errada.
 *
 * Renovação: o Firebase já renova o ID Token antes de expirar. Se mesmo assim a API responder
 * 401 (token revogado, relógio adiantado), o cliente pede um token novo e repete UMA vez. Um
 * segundo 401 encerra a sessão.
 */
export function createApiClient(deps: ApiClientDeps) {
  const baseFetch = deps.fetch ?? defaultFetch;

  const send = async (request: Request, force: boolean) => {
    const token = await deps.getIdToken(force);
    deps.beforeSend?.(request);
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    if (deps.tenantId) request.headers.set('X-Tenant-Id', deps.tenantId);
    else request.headers.delete('X-Tenant-Id');
    return baseFetch(request);
  };

  const authedFetch = async (input: Request): Promise<Response> => {
    const retry = input.clone();
    const first = await send(input, false);
    if (first.status !== 401) return first;

    let fresh: string | null;
    try {
      fresh = await deps.getIdToken(true);
    } catch (e) {
      // Falha de rede ao renovar não é sessão expirada: devolve a resposta original.
      if (isNetwork(e)) return first;
      deps.onSessionExpired();
      return first;
    }
    if (!fresh) {
      deps.onSessionExpired();
      return first;
    }
    const second = await send(retry, false);
    if (second.status === 401) deps.onSessionExpired();
    return second;
  };

  return createClient<paths>({ baseUrl: deps.baseUrl, fetch: authedFetch });
}

const isNetwork = (e: unknown) =>
  !!e && typeof e === 'object' && 'code' in e && e.code === 'auth/network-request-failed';

export type ApiClient = ReturnType<typeof createApiClient>;

type ErrorBody = {
  error?: { code?: string; message?: string; status?: number; requestId?: string };
};

/**
 * Desembrulha `{ data }` ou lança ApiError com código estável. Uso:
 * `const me = await unwrap(api.GET('/api/v1/me'))`.
 */
export async function unwrap<T>(
  call: Promise<{ data?: { data: T }; error?: unknown; response: Response }>,
): Promise<T> {
  let result: Awaited<typeof call>;
  try {
    result = await call;
  } catch (e) {
    throw new ApiError(0, 'NETWORK_ERROR', e instanceof Error ? e.message : 'Falha de rede');
  }
  if (result.data !== undefined) return result.data.data;
  const body = (result.error ?? {}) as ErrorBody;
  throw new ApiError(
    result.response.status,
    body.error?.code ?? 'UNKNOWN_ERROR',
    body.error?.message ?? `HTTP ${result.response.status}`,
    body.error?.requestId,
    retryAfterSeconds(result.response),
  );
}
