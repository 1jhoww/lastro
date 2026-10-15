import { describe, it, expect } from 'vitest';
import {
  catalogConfigure,
  catalogSlug,
  quoteInput,
  quoteSummary,
} from '../../src/shared/schemas/catalog.js';
import {
  quoteReviewToken,
  quoteMessage,
  whatsappLink,
  messageText,
} from '../../src/modules/catalog/quoteCalculation.js';
import { catalogConfig } from '../helpers/catalog.js';
import { encodePublicCursor, decodePublicCursor } from '../../src/modules/catalog/publicCursor.js';
const summary = (hidden = false) =>
  quoteSummary.parse({
    catalog: {
      slug: 'lastro-a',
      tradeName: 'Distribuidora Teste',
      description: '',
      whatsappNumber: '5511999990000',
      showPrices: !hidden,
    },
    lines: [
      {
        productId: 'product-1',
        name: 'Produto',
        unit: 'KG',
        quantity: '0.125',
        unitPriceCents: hidden ? null : 2050,
        subtotalCents: hidden ? null : 256,
      },
    ],
    currency: 'BRL',
    totalEstimatedCents: hidden ? null : 256,
    kind: 'quote_request',
    confirmedOrder: false,
  });
describe('Catálogo e orçamento público F', () => {
  it('cursor público cifra candidato privado e vincula filtro/empresa sem ampliar acesso', () => {
    const id = 'private-category-id',
      cursor = encodePublicCursor('unit-secret', 'scope-a', id);
    expect(Buffer.from(cursor, 'base64url').toString()).not.toContain(id);
    expect(decodePublicCursor('unit-secret', 'scope-a', cursor)).toBe(id);
    expect(() => decodePublicCursor('unit-secret', 'scope-b', cursor)).toThrow();
    expect(() => decodePublicCursor('other-secret', 'scope-a', cursor)).toThrow();
    expect(() => decodePublicCursor('unit-secret', 'scope-a', cursor + 'x')).toThrow();
  });
  it.each(['UPPER', '../tenant', 'a--b', 'ab', '-lastro', 'lastro-', 'lastro.com', 'a'.repeat(64)])(
    'rejeita slug perigoso ou inválido %s',
    (value) => expect(catalogSlug.safeParse(value).success).toBe(false),
  );
  it('configuração strict rejeita URLs e dados internos', () => {
    expect(
      catalogConfigure.safeParse(catalogConfig({ whatsappNumber: 'https://evil.invalid' })).success,
    ).toBe(false);
    expect(catalogConfigure.safeParse({ ...catalogConfig(), tenantId: 'foreign' }).success).toBe(
      false,
    );
    expect(
      catalogConfigure.safeParse(catalogConfig({ tradeName: 'Empresa\nPreço grátis' })).success,
    ).toBe(false);
  });
  it.each(['+5511999990000', '05511999990000', '5511?text=forged', '123'])(
    'rejeita destino WhatsApp inválido %s',
    (whatsappNumber) =>
      expect(catalogConfigure.safeParse(catalogConfig({ whatsappNumber })).success).toBe(false),
  );
  it('rejeita preços externos, duplicatas e mais de 200 produtos sem gerar resumo', () => {
    expect(
      quoteInput.safeParse({ lines: [{ productId: 'p', quantity: '1', unitPriceCents: 1 }] })
        .success,
    ).toBe(false);
    expect(
      quoteInput.safeParse({
        lines: [
          { productId: 'p', quantity: '1' },
          { productId: 'p', quantity: '2' },
        ],
      }).success,
    ).toBe(false);
    expect(
      quoteInput.safeParse({
        lines: Array.from({ length: 201 }, (_, i) => ({ productId: `p-${i}`, quantity: '1' })),
      }).success,
    ).toBe(false);
  });
  it('mensagem preserva decimal, centavos e identifica solicitação não confirmada', () => {
    const message = quoteMessage(summary());
    expect(message).toContain('0.125 KG');
    expect(message).toContain('R$ 20,50');
    expect(message).toContain('Total estimado: R$ 2,56');
    expect(message).toContain('Não é pedido confirmado');
  });
  it('mensagem com preço oculto não revela unitário, subtotal ou total', () => {
    const message = quoteMessage(summary(true));
    expect(message).not.toMatch(/R\$|Unitário|Total estimado|256|2050/);
    expect(message).toContain('0.125 KG');
  });
  it('link oficial codifica mensagem sem permitir mudança de domínio ou parâmetro', () => {
    const message = 'Produto &text=forjado #pedido + ação',
      link = new URL(whatsappLink('5511999990000', message));
    expect(link.origin).toBe('https://wa.me');
    expect(link.pathname).toBe('/5511999990000');
    expect([...link.searchParams.keys()]).toEqual(['text']);
    expect(link.searchParams.get('text')).toBe(message);
  });
  it('remove controle, formatação e links inseridos nos nomes da mensagem', () => {
    const value = messageText('Produto\n*PAGO* https://evil.invalid/x wa.me/123 evil.com\u202e');
    expect(value).not.toMatch(/https:|wa\.me|evil\.com|\n|\*|\u202e/);
  });
  it('prova de revisão vincula empresa, quantidade, preço e opções públicas', () => {
    const a = summary(),
      token = quoteReviewToken('unit-secret', 'tenant-a', a);
    expect(token).not.toBe(quoteReviewToken('unit-secret', 'tenant-b', a));
    expect(token).not.toBe(
      quoteReviewToken('unit-secret', 'tenant-a', { ...a, totalEstimatedCents: 257 }),
    );
    expect(token).not.toBe(
      quoteReviewToken('unit-secret', 'tenant-a', {
        ...a,
        catalog: { ...a.catalog, whatsappNumber: '5511888880000' },
      }),
    );
  });
  it('recusa mensagem acima do limite técnico sem gerar URL truncada', () =>
    expect(() => whatsappLink('5511999990000', 'a'.repeat(16001))).toThrow());
});
