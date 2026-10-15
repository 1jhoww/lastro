import { z } from 'zod';
import { parseQuantityInput, toApiQuantity } from '@/lib/quantity';
import type { PublicProduct, QuoteInput } from '@/api/types';
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
