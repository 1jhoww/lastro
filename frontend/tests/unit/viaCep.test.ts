import { lookupPostalCode } from '@/features/customers/viaCep';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const respond = (status: number, body: unknown) =>
  jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('ViaCEP', () => {
  it('normaliza o endereço encontrado e não consulta o mesmo CEP de novo', async () => {
    const fetchMock = respond(200, {
      cep: '01310-100',
      logradouro: ' Avenida Paulista ',
      bairro: 'Bela Vista',
      localidade: 'São Paulo',
      uf: 'sp',
    });
    globalThis.fetch = fetchMock;
    const signal = new AbortController().signal;
    const first = await lookupPostalCode('01310100', signal);
    expect(first).toEqual({
      kind: 'found',
      address: {
        street: 'Avenida Paulista',
        district: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      },
    });
    await lookupPostalCode('01310100', signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock as jest.Mock).mock.calls[0][0]).toBe(
      'https://viacep.com.br/ws/01310100/json/',
    );
  });

  it('CEP inexistente ("erro": true ou 400) vira não encontrado', async () => {
    globalThis.fetch = respond(200, { erro: true });
    expect(await lookupPostalCode('99999999', new AbortController().signal)).toEqual({
      kind: 'notFound',
    });
    globalThis.fetch = respond(400, {});
    expect(await lookupPostalCode('99999998', new AbortController().signal)).toEqual({
      kind: 'notFound',
    });
  });

  it('serviço fora do ar ou falha de rede libera preenchimento manual, sem guardar no cache', async () => {
    globalThis.fetch = respond(503, {});
    expect(await lookupPostalCode('20040002', new AbortController().signal)).toEqual({
      kind: 'unavailable',
    });
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(await lookupPostalCode('20040002', new AbortController().signal)).toEqual({
      kind: 'unavailable',
    });
    // Indisponibilidade não é memorizada: quando o serviço volta, a consulta acontece.
    globalThis.fetch = respond(200, {
      logradouro: 'Avenida Rio Branco',
      bairro: 'Centro',
      localidade: 'Rio de Janeiro',
      uf: 'RJ',
    });
    expect((await lookupPostalCode('20040002', new AbortController().signal)).kind).toBe('found');
  });

  it('consulta cancelada não vira resultado', async () => {
    globalThis.fetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = lookupPostalCode('30130010', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
