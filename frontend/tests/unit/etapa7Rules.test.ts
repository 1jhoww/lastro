import { buildExportRequest, exportDefaults, nextExportPage } from '@/features/reports/exportRules';
import {
  catalogInputSchema,
  publicImageUrl,
  quoteBody,
  safeWhatsappUrl,
} from '@/features/publicCatalog/rules';
import type { CartLine } from '@/features/publicCatalog/rules';
const settings = {
  expectedVersion: 0,
  slug: 'empresa-teste',
  tradeName: 'Empresa teste',
  description: 'Descrição pública',
  whatsappNumber: '5511999999999',
  showPrices: true,
  enabled: true,
};
describe('CSV: filtros reais e continuação', () => {
  it.each(['customers', 'products', 'orders', 'receivables'] as const)(
    '%s conserva filtros e cursor opaco mesmo após página vazia',
    (resource) => {
      const request = buildExportRequest(resource, {
        ...exportDefaults,
        customerId: 'c1',
        from: '2026-10-01',
        to: '2026-10-31',
        q: resource === 'customers' ? 'ana' : '',
      });
      const next = nextExportPage(request, 'opaque-cursor');
      expect(next.query).toEqual({ ...request.query, cursor: 'opaque-cursor' });
      expect(request.query).not.toHaveProperty('cursor');
    },
  );
  it.each(['0', '11', '100', '1.5', '-1', '01'])('recusa limite de pedidos %s', (limit) =>
    expect(() => buildExportRequest('orders', { ...exportDefaults, limit })).toThrow(),
  );
  it.each([
    { from: '2026-02-30', to: '' },
    { from: '2026-10-31', to: '2026-10-01' },
    { from: '15/10/2026', to: '' },
  ])('recusa período inválido %j', (dates) =>
    expect(() => buildExportRequest('receivables', { ...exportDefaults, ...dates })).toThrow(),
  );
  it('não envia filtros comerciais inexistentes em pedidos', () => {
    expect(
      buildExportRequest('orders', {
        ...exportDefaults,
        q: 'nome',
        assignedTo: 'seller1',
        from: '2026-10-01',
        to: '2026-10-31',
        customerId: 'c1',
      }).query,
    ).toEqual({ limit: '10', direction: 'asc', customerId: 'c1' });
  });
  it('busca exige nome crescente', () =>
    expect(() =>
      buildExportRequest('products', { ...exportDefaults, q: 'arroz', direction: 'desc' }),
    ).toThrow());
  it('permite cem clientes e filtros exclusivos de produtos', () => {
    expect(
      buildExportRequest('customers', { ...exportDefaults, limit: '100', assignedTo: 'unassigned' })
        .query,
    ).toHaveProperty('assignedTo', 'unassigned');
    expect(
      buildExportRequest('products', {
        ...exportDefaults,
        sku: 'SKU-1',
        catalogVisible: 'false',
        categoryId: 'cat1',
      }).query,
    ).toMatchObject({ sku: 'SKU-1', catalogVisible: 'false', categoryId: 'cat1' });
  });
});
describe('catálogo e seleção pública', () => {
  it.each(['abc', 'empresa-123', 'a'.repeat(63)])('aceita slug %s', (slug) =>
    expect(catalogInputSchema.safeParse({ ...settings, slug }).success).toBe(true),
  );
  it.each(['ab', 'Empresa', '1empresa', 'empresa-', 'a--b', 'a'.repeat(64)])(
    'recusa slug %s',
    (slug) => expect(catalogInputSchema.safeParse({ ...settings, slug }).success).toBe(false),
  );
  it.each(['https://wa.me/5511999999999', '+5511999999999', '01199999999', '1234567'])(
    'recusa telefone %s',
    (whatsappNumber) =>
      expect(catalogInputSchema.safeParse({ ...settings, whatsappNumber }).success).toBe(false),
  );
  it('recusa controles em texto público', () =>
    expect(catalogInputSchema.safeParse({ ...settings, description: 'A\u202eB' }).success).toBe(
      false,
    ));
  it.each([
    ['KG', '0,125', '0.125'],
    ['L', '1.500', '1.5'],
    ['UN', '2', '2'],
  ] as const)('normaliza quantidade %s %s sem preços no corpo', (unit, quantity, expected) => {
    expect(quoteBody([{ id: 'p1', name: 'Produto', unit, quantity }])).toEqual({
      lines: [{ productId: 'p1', quantity: expected }],
    });
  });
  it.each([
    ['UN', '1.5'],
    ['KG', '0'],
    ['L', '0.0001'],
    ['CX', '-1'],
    ['PCT', '1e3'],
  ] as const)('recusa quantidade %s %s', (unit, quantity) =>
    expect(() => quoteBody([{ id: 'p1', name: 'Produto', unit, quantity }])).toThrow(),
  );
  it('recusa carrinho vazio, duplicado e acima de duzentos', () => {
    const line: CartLine = { id: 'p1', name: 'Produto', unit: 'UN', quantity: '1' };
    expect(() => quoteBody([])).toThrow();
    expect(() => quoteBody([line, line])).toThrow();
    expect(() =>
      quoteBody(Array.from({ length: 201 }, (_, i) => ({ ...line, id: `p${i}` }))),
    ).toThrow();
  });
  it('imagem usa somente rota pública exata na origem da API', () => {
    expect(
      publicImageUrl(
        'https://api.test',
        '/api/v1/public/catalogs/empresa/products/p1/image',
        'empresa',
        'p1',
      ),
    ).toBe('https://api.test/api/v1/public/catalogs/empresa/products/p1/image');
    expect(
      publicImageUrl('https://api.test', 'https://storage.test/private', 'empresa', 'p1'),
    ).toBeUndefined();
    expect(
      publicImageUrl('https://api.test', '//evil.test/image', 'empresa', 'p1'),
    ).toBeUndefined();
  });
  it.each([
    'javascript:alert(1)',
    'https://wa.me.evil.test/5511999999999',
    'http://wa.me/5511999999999',
    'https://wa.me/1',
    'https://x:secret@wa.me/5511999999999',
  ])('não abre destino externo arbitrário %s', (url) =>
    expect(() => safeWhatsappUrl(url)).toThrow(),
  );
  it('permite link canônico do WhatsApp com mensagem do servidor', () =>
    expect(safeWhatsappUrl('https://wa.me/5511999999999?text=Ol%C3%A1')).toContain(
      'wa.me/5511999999999',
    ));
});
