import { z } from 'zod';
import type { Customer, CustomerCreate, CustomerUpdate } from '@/api/types';
import { formatDocument, formatPostalCode, normalizeDocument, validDocument } from '@/lib/document';

/**
 * Campos do formulário de cliente como texto, com as mesmas regras do backend
 * (shared/schemas/commercial.ts). Só o nome é obrigatório; CPF/CNPJ, contato e endereço são
 * opcionais.
 */
const optionalText = (max: number, message: string) => z.string().trim().max(max, message);

export const customerFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Informe o nome com pelo menos 2 caracteres.')
    .max(160, 'Use até 160 caracteres.'),
  tradeName: optionalText(160, 'Use até 160 caracteres.'),
  document: z
    .string()
    .trim()
    .max(32, 'Documento longo demais.')
    .refine((v) => !v || validDocument(v), 'CPF ou CNPJ inválido. Confira os dígitos.'),
  email: z
    .string()
    .trim()
    .max(254, 'E-mail longo demais.')
    .refine((v) => !v || z.email().safeParse(v).success, 'E-mail inválido.'),
  phone: z
    .string()
    .trim()
    .max(32, 'Telefone longo demais.')
    .refine(
      (v) =>
        !v || (/^\+?[0-9()\s.-]+$/.test(v) && /^\+?\d{8,15}$/.test(v.replace(/[()\s.-]/g, ''))),
      'Telefone inválido. Use DDD e número, como (11) 98765-4321.',
    ),
  street: optionalText(160, 'Use até 160 caracteres.'),
  number: optionalText(20, 'Use até 20 caracteres.'),
  complement: optionalText(100, 'Use até 100 caracteres.'),
  district: optionalText(100, 'Use até 100 caracteres.'),
  city: optionalText(100, 'Use até 100 caracteres.'),
  state: z
    .string()
    .trim()
    .refine((v) => !v || /^[A-Za-z]{2}$/.test(v), 'Use a sigla com 2 letras, como SP.'),
  postalCode: z
    .string()
    .trim()
    .refine((v) => !v || /^\d{5}-?\d{3}$/.test(v), 'CEP inválido. Use 8 dígitos, como 01310-100.'),
  notes: optionalText(2000, 'Use até 2000 caracteres.'),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const emptyCustomerForm: CustomerFormValues = {
  name: '',
  tradeName: '',
  document: '',
  email: '',
  phone: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  postalCode: '',
  notes: '',
};

export function customerToForm(c: Customer): CustomerFormValues {
  const a = c.address ?? {};
  return {
    name: c.name,
    tradeName: c.tradeName ?? '',
    document: formatDocument(c.document),
    email: c.email ?? '',
    phone: c.phone ?? '',
    street: a.street ?? '',
    number: a.number ?? '',
    complement: a.complement ?? '',
    district: a.district ?? '',
    city: a.city ?? '',
    state: a.state ?? '',
    postalCode: formatPostalCode(a.postalCode),
    notes: c.notes ?? '',
  };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

function address(v: CustomerFormValues) {
  const parts = {
    street: v.street.trim() || undefined,
    number: v.number.trim() || undefined,
    complement: v.complement.trim() || undefined,
    district: v.district.trim() || undefined,
    city: v.city.trim() || undefined,
    state: v.state.trim() ? v.state.trim().toUpperCase() : undefined,
    postalCode: v.postalCode.trim() ? v.postalCode.replace(/\D/g, '') : undefined,
  };
  const filled = Object.fromEntries(Object.entries(parts).filter(([, x]) => x !== undefined));
  return Object.keys(filled).length ? filled : null;
}

/** Corpo de criação: campos vazios são omitidos. O responsável é decidido pelo servidor. */
export function formToCreate(v: CustomerFormValues): CustomerCreate {
  const body: CustomerCreate = { name: v.name.trim() };
  if (v.tradeName.trim()) body.tradeName = v.tradeName.trim();
  if (v.document.trim()) body.document = normalizeDocument(v.document);
  if (v.email.trim()) body.email = v.email.trim();
  if (v.phone.trim()) body.phone = v.phone.trim();
  const addr = address(v);
  if (addr) body.address = addr;
  if (v.notes.trim()) body.notes = v.notes.trim();
  return body;
}

/** Corpo de edição: campos vazios viram null para limpar o valor salvo. Sem status/responsável. */
export function formToUpdate(v: CustomerFormValues, expectedVersion: number): CustomerUpdate {
  return {
    expectedVersion,
    name: v.name.trim(),
    tradeName: orNull(v.tradeName),
    document: v.document.trim() ? normalizeDocument(v.document) : null,
    email: orNull(v.email),
    phone: orNull(v.phone),
    address: address(v),
    notes: orNull(v.notes),
  };
}
