/**
 * CPF/CNPJ no mesmo formato do backend (modules/customers/documents.ts): validação matemática,
 * sem consulta à Receita. CNPJ aceita o formato alfanumérico. O servidor revalida e normaliza;
 * aqui só antecipamos o erro para quem está digitando.
 */

export function normalizeDocument(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[.\-/\s]/g, '');
}

export function validDocument(input: string): boolean {
  const value = normalizeDocument(input);
  if (/^(.)\1+$/.test(value)) return false;
  if (/^\d{11}$/.test(value)) {
    const digits = [...value].map(Number);
    const check = (length: number) => {
      const remainder =
        (digits.slice(0, length).reduce((sum, n, i) => sum + n * (length + 1 - i), 0) * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return check(9) === digits[9] && check(10) === digits[10];
  }
  if (!/^[A-Z0-9]{12}\d{2}$/.test(value)) return false;
  const check = (base: string) => {
    const sum = [...base]
      .reverse()
      .reduce((total, c, i) => total + (c.charCodeAt(0) - 48) * (2 + (i % 8)), 0);
    const remainder = sum % 11;
    return remainder < 2 ? '0' : String(11 - remainder);
  };
  const first = check(value.slice(0, 12));
  return value.slice(12) === first + check(value.slice(0, 12) + first);
}

/** Exibição: 123.456.789-09 ou 12.345.678/0001-95 (também alfanumérico). */
export function formatDocument(value: string | null | undefined): string {
  if (!value) return '';
  const v = normalizeDocument(value);
  if (/^\d{11}$/.test(v)) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (/^[A-Z0-9]{12}\d{2}$/.test(v))
    return v.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
  return v;
}

export function documentKind(value: string | null | undefined): 'CPF' | 'CNPJ' | null {
  if (!value) return null;
  return normalizeDocument(value).length === 11 ? 'CPF' : 'CNPJ';
}

/** Telefone como o backend guarda (só dígitos, + opcional) para exibição legível. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '';
  const d = value.replace(/\D/g, '');
  if (!value.startsWith('+') && d.length === 11)
    return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (!value.startsWith('+') && d.length === 10)
    return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return value;
}

export function formatPostalCode(value: string | null | undefined): string {
  if (!value) return '';
  return /^\d{8}$/.test(value) ? `${value.slice(0, 5)}-${value.slice(5)}` : value;
}

/** Valor gravado quando o endereço não tem número (alternativa explícita no formulário). */
export const NO_NUMBER = 'S/N';

export const isNoNumber = (value: string | null | undefined) =>
  /^s\/?n$/i.test((value ?? '').trim());

/** Máscara de digitação do CEP: "01310100" → "01310-100". */
export function maskPostalCode(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/**
 * Máscara de digitação do telefone brasileiro: "(11) 98765-4321" ou "(11) 3456-7890".
 * Número internacional (começa com +) fica como digitado.
 */
export function maskPhone(input: string): string {
  if (input.trimStart().startsWith('+')) return input;
  const d = input.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  const split = rest.length > 8 ? 5 : 4;
  return rest.length > split
    ? `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`
    : `(${ddd}) ${rest}`;
}

/** Siglas das unidades federativas, em ordem alfabética. */
export const brazilianStates = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
] as const;
