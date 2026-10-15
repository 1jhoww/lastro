import { z } from 'zod';
import type { Product, ProductCreate, ProductUnit, ProductUpdate } from '@/api/types';
import {
  formatQuantity,
  fromApiQuantity,
  parseQuantityInput,
  toApiQuantity,
  type Unit,
} from '@/lib/quantity';

export const units: { value: ProductUnit; label: string; description: string }[] = [
  { value: 'UN', label: 'Unidade (UN)', description: 'Quantidades inteiras' },
  { value: 'CX', label: 'Caixa (CX)', description: 'Quantidades inteiras' },
  { value: 'PCT', label: 'Pacote (PCT)', description: 'Quantidades inteiras' },
  { value: 'KG', label: 'Quilo (KG)', description: 'Até 3 casas decimais' },
  { value: 'L', label: 'Litro (L)', description: 'Até 3 casas decimais' },
];

/** Mesmas regras do backend para SKU: letras, números, ponto, hífen e sublinhado. */
const skuPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const productFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Informe o nome com pelo menos 2 caracteres.')
      .max(160, 'Use até 160 caracteres.'),
    sku: z
      .string()
      .trim()
      .min(1, 'Informe o SKU.')
      .max(64, 'Use até 64 caracteres.')
      .regex(skuPattern, 'Use letras, números, ponto, hífen ou sublinhado, sem espaços.'),
    description: z.string().trim().max(2000, 'Use até 2000 caracteres.'),
    categoryId: z.string().nullable(),
    unit: z.enum(['UN', 'CX', 'PCT', 'KG', 'L']),
    priceCents: z
      .number()
      .int()
      .min(0, 'Preço não pode ser negativo.')
      .max(100_000_000, 'Preço acima do limite (R$ 1.000.000,00).'),
    catalogVisible: z.boolean(),
    /** Texto como o usuário digita ("1,5"); validado contra a unidade abaixo. */
    minimumStock: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.minimumStock && parseQuantityInput(v.minimumStock, v.unit as Unit) === null)
      ctx.addIssue({
        code: 'custom',
        path: ['minimumStock'],
        message:
          v.unit === 'KG' || v.unit === 'L'
            ? 'Use um número com até 3 casas decimais, como 2,5.'
            : 'Use um número inteiro para esta unidade.',
      });
  });

export type ProductFormValues = z.infer<typeof productFormSchema>;

export const emptyProductForm: ProductFormValues = {
  name: '',
  sku: '',
  description: '',
  categoryId: null,
  unit: 'UN',
  priceCents: 0,
  catalogVisible: false,
  minimumStock: '',
};

export function productToForm(p: Product): ProductFormValues {
  const min = fromApiQuantity(p.minimumStock);
  return {
    name: p.name,
    sku: p.sku,
    description: p.description,
    categoryId: p.categoryId,
    unit: p.unit,
    priceCents: p.priceCents,
    catalogVisible: p.catalogVisible,
    minimumStock: min ? formatQuantity(min).replace(/\./g, '') : '',
  };
}

const minimum = (v: ProductFormValues) =>
  toApiQuantity(v.minimumStock ? (parseQuantityInput(v.minimumStock, v.unit as Unit) ?? 0) : 0);

export function formToCreate(v: ProductFormValues): ProductCreate {
  return {
    name: v.name.trim(),
    sku: v.sku.trim(),
    ...(v.description.trim() ? { description: v.description.trim() } : {}),
    categoryId: v.categoryId,
    unit: v.unit,
    priceCents: v.priceCents,
    catalogVisible: v.catalogVisible,
    minimumStock: minimum(v),
  };
}

/** Só envia o que mudou: evita UNIT_LOCKED ou reserva de SKU quando nada foi alterado. */
export function formToUpdate(v: ProductFormValues, p: Product): ProductUpdate {
  const next = formToCreate(v);
  const body: ProductUpdate = { expectedVersion: p.version };
  if (next.name !== p.name) body.name = next.name;
  if (next.sku.toUpperCase() !== p.sku) body.sku = next.sku;
  if ((next.description ?? '') !== p.description) body.description = next.description ?? '';
  if (next.categoryId !== p.categoryId) body.categoryId = next.categoryId;
  if (next.unit !== p.unit) body.unit = next.unit;
  if (next.priceCents !== p.priceCents) body.priceCents = next.priceCents;
  if (next.catalogVisible !== p.catalogVisible) body.catalogVisible = next.catalogVisible;
  if (next.minimumStock !== p.minimumStock) body.minimumStock = next.minimumStock;
  return body;
}
