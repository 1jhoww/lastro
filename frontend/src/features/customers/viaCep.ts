/**
 * Consulta de CEP no ViaCEP (serviço público, sem chave). Só sugere logradouro, bairro, cidade e
 * UF para o formulário; nada aqui é autoridade: a pessoa pode editar tudo e o backend valida o
 * endereço completo. Número e complemento nunca vêm daqui.
 */

export type PostalCodeAddress = {
  street: string;
  district: string;
  city: string;
  state: string;
};

export type PostalCodeResult =
  { kind: 'found'; address: PostalCodeAddress } | { kind: 'notFound' } | { kind: 'unavailable' };

const TIMEOUT_MS = 6000;

/** Respostas já obtidas nesta sessão: o mesmo CEP não é consultado duas vezes. */
const cache = new Map<string, PostalCodeResult>();

/** `cep` com 8 dígitos. Cancelamento via `signal` lança AbortError para o chamador ignorar. */
export async function lookupPostalCode(
  cep: string,
  signal: AbortSignal,
): Promise<PostalCodeResult> {
  const cached = cache.get(cep);
  if (cached) return cached;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const abort = () => timeout.abort();
  signal.addEventListener('abort', abort);
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: timeout.signal });
    if (res.status === 400) return remember(cep, { kind: 'notFound' });
    if (!res.ok) return { kind: 'unavailable' };
    const body = (await res.json()) as Record<string, unknown>;
    if (body.erro) return remember(cep, { kind: 'notFound' });
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return remember(cep, {
      kind: 'found',
      address: {
        street: text(body.logradouro),
        district: text(body.bairro),
        city: text(body.localidade),
        state: text(body.uf).toUpperCase(),
      },
    });
  } catch (e) {
    if (signal.aborted) throw e;
    // Rede fora, tempo esgotado ou bloqueio: a pessoa preenche à mão.
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function remember(cep: string, result: PostalCodeResult): PostalCodeResult {
  cache.set(cep, result);
  return result;
}
