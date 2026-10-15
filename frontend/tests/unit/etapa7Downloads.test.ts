import { createApiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { exportPage, orderDocument } from '@/features/files/api';
import { readDownload, safeFilename } from '@/features/files/contracts';
import { fileLease, resetPrivateFiles, trackPrivateFile } from '@/features/files/fileEpoch';
const csv = '\ufeff"nome";"valor"\r\n"linha\ncom quebra";"1,50"\r\n';
const response = (body: string, mime: string, headers: Record<string, string> = {}) =>
  new Response(new TextEncoder().encode(body), { headers: { 'Content-Type': mime, ...headers } });
function client(fetch: (request: Request) => Promise<Response>) {
  return createApiClient({
    baseUrl: 'http://api.test',
    tenantId: 't1',
    getIdToken: async () => 'token-test',
    onSessionExpired: jest.fn(),
    fetch: fetch as typeof globalThis.fetch,
  });
}
it('PDF mantém bytes, nome seguro, autenticação e no-store', async () => {
  const fetch = jest.fn(async (request: Request) => {
    expect(request.headers.get('Authorization')).toBe('Bearer token-test');
    expect(request.headers.get('X-Tenant-Id')).toBe('t1');
    expect(request.cache).toBe('no-store');
    return response('%PDF-1.7\nbytes', 'application/pdf', {
      'Content-Disposition': 'attachment; filename="pedido-original.pdf"',
    });
  });
  const result = await orderDocument(client(fetch), 't1', 'o1', 'commercial');
  expect(result.filename).toBe('pedido-original.pdf');
  expect(new TextDecoder().decode(result.bytes)).toBe('%PDF-1.7\nbytes');
});
it('romaneio usa endpoint real separado', async () => {
  const fetch = jest.fn(async (_request: Request) => response('%PDF-1.7', 'application/pdf'));
  await orderDocument(client(fetch), 't1', 'o1', 'packing');
  expect(fetch.mock.calls[0]?.[0].url).toBe(
    'http://api.test/api/v1/orders/o1/documents/packing.pdf',
  );
});
it.each([403, 404, 409, 413, 422, 429, 503])('erro JSON %s nunca vira arquivo', async (status) => {
  const fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({ error: { code: 'DOCUMENT_CHANGED', message: 'Pedido mudou' } }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  await expect(orderDocument(client(fetch), 't1', 'o1', 'commercial')).rejects.toMatchObject({
    status,
    code: 'DOCUMENT_CHANGED',
  });
});
it('CSV preserva BOM, quebra em célula, apóstrofos e cursor em página vazia', async () => {
  const fetch = jest.fn(async () =>
    response(csv, 'text/csv; charset=utf-8', {
      'X-Export-Row-Count': '0',
      'X-Next-Cursor': 'cursor-cifrado',
      'Content-Disposition': 'attachment; filename="clientes.csv"',
    }),
  );
  const result = await exportPage(client(fetch), 't1', {
    resource: 'customers',
    query: { q: 'an', limit: '10', sort: 'name', direction: 'asc' },
  });
  expect(new Uint8Array(result.bytes).slice(0, 3)).toEqual(new Uint8Array([239, 187, 191]));
  expect(result.bytes.byteLength).toBe(new TextEncoder().encode(csv).byteLength);
  expect(result.rowCount).toBe(0);
  expect(result.nextCursor).toBe('cursor-cifrado');
});
it.each([
  ['%PDF-x', 'application/json', 'application/pdf'],
  ['erro', 'application/pdf', 'application/pdf'],
  ['nome\r\n', 'text/csv', 'text/csv'],
] as const)('recusa corpo/mídia incompatíveis', async (body, mime, wanted) => {
  await expect(readDownload(response(body, mime), wanted)).rejects.toBeInstanceOf(ApiError);
});
it('recusa tamanho excedido antes de ler corpo', async () => {
  const file = response('%PDF-1.7', 'application/pdf', {
    'Content-Length': String(8 * 1024 * 1024 + 1),
  });
  const read = jest.spyOn(file, 'arrayBuffer');
  await expect(readDownload(file, 'application/pdf')).rejects.toMatchObject({ status: 413 });
  expect(read).not.toHaveBeenCalled();
});
it.each(['../../documento.pdf', 'secret.exe', 'name with spaces.pdf', '\\host\\arquivo.pdf'])(
  'neutraliza nome inseguro %s',
  (name) => expect(safeFilename(`attachment; filename="${name}"`, 'pdf')).toBe('lastro.pdf'),
);
it('falha de rede não cria arquivo ou repete download automaticamente', async () => {
  const fetch = jest.fn(async () => {
    throw new TypeError('Network request failed');
  });
  await expect(orderDocument(client(fetch), 't1', 'o1', 'commercial')).rejects.toThrow(
    'Network request failed',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('troca de empresa/usuário invalida resposta atrasada e revoga arquivos registrados', () => {
  const check = fileLease(),
    clean = jest.fn();
  trackPrivateFile(clean);
  resetPrivateFiles();
  expect(check).toThrow('Sessão ou empresa mudou');
  expect(clean).toHaveBeenCalledTimes(1);
  expect(fileLease()).not.toThrow();
});
