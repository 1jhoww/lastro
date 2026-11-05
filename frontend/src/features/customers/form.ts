import { z } from 'zod';
import type { Customer, CustomerCreate, CustomerUpdate } from '@/api/types';
import {
  NO_NUMBER,
  brazilianStates,
  formatDocument,
  formatPhone,
  formatPostalCode,
  isNoNumber,
  normalizeDocument,
  validDocument,
} from '@/lib/document';

/**
 * Campos do formulário de cliente como texto, com as mesmas regras do backend
 * (shared/schemas/commercial.ts). Obrigatórios: nome e endereço (menos o complemento). CPF/CNPJ
 * e contato continuam opcionais. Cliente antigo sem endereço completo pode ser consultado
 * normalmente; só precisa completar o endereço ao ser editado.
 */
const optionalText = (max: number, message: string) => z.string().trim().max(max, message);
const requiredText = (max: number, empty: string) =>
  z.string().trim().min(1, empty).max(max, `Use até ${max} caracteres.`);

export const customerFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Informe o nome com pelo menos 2 caracteres.')
      .max(160, 'Use até 160 caracteres.'),
    tradeName: optionalText(160, 'Use até 160 caracteres.'),
    contactName: optionalText(160, 'Use até 160 caracteres.'),
    isCustomer: z.boolean(),
    isSupplier: z.boolean(),
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
    postalCode: z
      .string()
      .trim()
      .min(1, 'Informe o CEP.')
      .refine((v) => /^\d{5}-?\d{3}$/.test(v), 'CEP incompleto. Use 8 dígitos, como 01310-100.'),
    street: requiredText(160, 'Informe o logradouro.'),
    number: optionalText(20, 'Use até 20 caracteres.'),
    noNumber: z.boolean(),
    complement: optionalText(100, 'Use até 100 caracteres.'),
    district: requiredText(100, 'Informe o bairro.'),
    city: requiredText(100, 'Informe a cidade.'),
    state: z
      .string()
      .refine(
        (v) => (brazilianStates as readonly string[]).includes(v.trim().toUpperCase()),
        'Escolha a UF.',
      ),
    notes: optionalText(2000, 'Use até 2000 caracteres.'),
  })
  .superRefine((v, ctx) => {
    if (!v.isCustomer && !v.isSupplier)
      ctx.addIssue({
        code: 'custom',
        path: ['isCustomer'],
        message: 'Marque cliente, fornecedor ou os dois.',
      });
    if (!v.noNumber && !v.number.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['number'],
        message: 'Informe o número ou marque "Sem número".',
      });
  });

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const emptyCustomerForm: CustomerFormValues = {
  name: '',
  tradeName: '',
  contactName: '',
  isCustomer: true,
  isSupplier: false,
  document: '',
  email: '',
  phone: '',
  postalCode: '',
  street: '',
  number: '',
  noNumber: false,
  complement: '',
  district: '',
  city: '',
  state: '',
  notes: '',
};

export function customerToForm(c: Customer): CustomerFormValues {
  const a = c.address ?? {};
  const noNumber = isNoNumber(a.number);
  return {
    name: c.name,
    tradeName: c.tradeName ?? '',
    contactName: c.contactName ?? '',
    isCustomer: c.relationships.includes('customer'),
    isSupplier: c.relationships.includes('supplier'),
    document: formatDocument(c.document),
    email: c.email ?? '',
    phone: formatPhone(c.phone),
    postalCode: formatPostalCode(a.postalCode),
    street: a.street ?? '',
    number: noNumber ? '' : (a.number ?? ''),
    noNumber,
    complement: a.complement ?? '',
    district: a.district ?? '',
    city: a.city ?? '',
    state: a.state ?? '',
    notes: c.notes ?? '',
  };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);
const relationshipsOf = (v: CustomerFormValues): ('customer' | 'supplier')[] => [
  ...(v.isCustomer ? (['customer'] as const) : []),
  ...(v.isSupplier ? (['supplier'] as const) : []),
];
/** O padrão do servidor é cliente: só viaja quando há fornecedor na decisão. */
const relationshipChange = (v: CustomerFormValues, previous?: readonly string[]) => {
  const next = relationshipsOf(v);
  const same = previous
    ? next.length === previous.length && next.every((r) => previous.includes(r))
    : next.length === 1 && next[0] === 'customer';
  return same ? {} : { relationships: next };
};

/** Endereço completo, como o contrato exige ao gravar. */
function address(v: CustomerFormValues): CustomerCreate['address'] {
  return {
    postalCode: v.postalCode.replace(/\D/g, ''),
    street: v.street.trim(),
    number: v.noNumber ? NO_NUMBER : v.number.trim(),
    ...(v.complement.trim() ? { complement: v.complement.trim() } : {}),
    district: v.district.trim(),
    city: v.city.trim(),
    state: v.state.trim().toUpperCase(),
  };
}

/** Corpo de criação: campos opcionais vazios são omitidos. O responsável é decidido pelo servidor. */
export function formToCreate(v: CustomerFormValues): CustomerCreate {
  const body: CustomerCreate = { name: v.name.trim(), address: address(v) };
  if (v.tradeName.trim()) body.tradeName = v.tradeName.trim();
  if (v.contactName.trim()) body.contactName = v.contactName.trim();
  Object.assign(body, relationshipChange(v));
  if (v.document.trim()) body.document = normalizeDocument(v.document);
  if (v.email.trim()) body.email = v.email.trim();
  if (v.phone.trim()) body.phone = v.phone.trim();
  if (v.notes.trim()) body.notes = v.notes.trim();
  return body;
}

/** Corpo de edição: opcionais vazios viram null para limpar o valor salvo. Sem status/responsável. */
export function formToUpdate(
  v: CustomerFormValues,
  expectedVersion: number,
  relationships: readonly string[] = ['customer'],
): CustomerUpdate {
  return {
    expectedVersion,
    name: v.name.trim(),
    tradeName: orNull(v.tradeName),
    contactName: orNull(v.contactName),
    ...relationshipChange(v, relationships),
    document: v.document.trim() ? normalizeDocument(v.document) : null,
    email: orNull(v.email),
    phone: orNull(v.phone),
    address: address(v),
    notes: orNull(v.notes),
  };
}
