import { z } from 'zod';
import { parseQuantityInput, toApiQuantity } from '@/lib/quantity';
import type { PublicProduct, QuoteInput, QuotePreview } from '@/api/types';
export const catalogInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    slug: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    enabled: z.boolean(),
    tradeName: z.string().trim().min(2).max(160),
    description: z.string().trim().max(1000),
    whatsappNumber: z.string().regex(/^[1-9][0-9]{7,14}$/),
    showPrices: z.boolean(),
  })
  .refine(
    (v) => !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(v.tradeName + v.description),
    'Remova caracteres de controle dos textos públicos.',
  );
export type CartLine = Pick<PublicProduct, 'id' | 'name' | 'unit'> & { quantity: string };
export function quoteBody(cart: CartLine[]): QuoteInput {
  if (!cart.length || cart.length > 200)
    throw new Error('Selecione de 1 a 200 produtos distintos.');
  if (new Set(cart.map((line) => line.id)).size !== cart.length)
    throw new Error('Produto repetido.');
  return {
    lines: cart.map((line) => {
      const quantity = parseQuantityInput(line.quantity, line.unit);
      if (quantity === null || quantity <= 0)
        throw new Error(
          `Revise a quantidade de ${line.name}. ${line.unit === 'KG' || line.unit === 'L' ? 'Use até três casas decimais.' : 'Use quantidade inteira.'}`,
        );
      return { productId: line.id, quantity: toApiQuantity(quantity) };
    }),
  };
}
export function publicImageUrl(
  baseUrl: string,
  imagePath: string | null,
  slug: string,
  productId: string,
) {
  if (!imagePath) return undefined;
  const expected = `/api/v1/public/catalogs/${encodeURIComponent(slug)}/products/${encodeURIComponent(productId)}/image`;
  if (imagePath !== expected) return undefined;
  return new URL(imagePath, baseUrl).href;
}
export function safeWhatsappUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'wa.me' ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/[1-9][0-9]{7,14}$/.test(url.pathname)
  )
    throw new Error('Link de WhatsApp inválido. Solicite nova revisão.');
  return url.href;
}

/** Item do orçamento: preço exibido ao visitante e quantidade em milésimos. */
export type QuoteItem = Pick<PublicProduct, 'id' | 'name' | 'unit' | 'unitPriceCents'> & {
  quantityMilli: number;
};
export const MAX_QUOTE_LINES = 200;

export function quoteItemsBody(items: readonly QuoteItem[]): QuoteInput {
  if (!items.length || items.length > MAX_QUOTE_LINES)
    throw new Error(`Selecione de 1 a ${MAX_QUOTE_LINES} produtos.`);
  return {
    lines: items.map((item) => {
      if (!Number.isSafeInteger(item.quantityMilli) || item.quantityMilli <= 0)
        throw new Error(`Revise a quantidade de ${item.name}.`);
      return { productId: item.id, quantity: toApiQuantity(item.quantityMilli) };
    }),
  };
}

/**
 * Divergências entre o que o visitante viu e a conferência do servidor. Preço diferente (ou
 * passou a/deixou de ser exibido) precisa ser mostrado antes de abrir o WhatsApp.
 */
export function quoteChanges(
  items: readonly QuoteItem[],
  preview: Pick<QuotePreview, 'lines'>,
): { id: string; name: string; from: number | null; to: number | null }[] {
  const official = new Map(preview.lines.map((l) => [l.productId, l]));
  return items.flatMap((item) => {
    const line = official.get(item.id);
    if (!line || line.unitPriceCents === item.unitPriceCents) return [];
    return [{ id: item.id, name: line.name, from: item.unitPriceCents, to: line.unitPriceCents }];
  });
}

/** Endereço amigável a partir do nome: minúsculas, sem acento, palavras unidas por hífen. */
export function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/** Aceita "(11) 99999-8888" ou "+55 11 ..."; número nacional sem país recebe 55. */
export function normalizeWhatsapp(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

/** "5511999998888" → "+55 11 99999-8888" (apenas exibição). */
export function formatWhatsapp(digits: string) {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${digits}`;
}
