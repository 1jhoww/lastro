import type { Customer, CustomerAddress } from '@/api/types';
import { formatDocument, formatPhone, formatPostalCode } from '@/lib/document';

/**
 * Apresentação do cadastro de cliente reutilizada por clientes, pedidos e financeiro. Leitura
 * tolerante: clientes antigos podem ter endereço parcial ou nenhum.
 */

type Address = CustomerAddress | null | undefined;

/** "São Paulo/SP", ou só a parte que existir. */
export function cityState(address: Address): string {
  if (!address) return '';
  return [address.city, address.state].filter(Boolean).join('/');
}

/** Endereço em uma linha: "Av. Paulista, 1000, Sala 2, Bela Vista, São Paulo/SP, 01310-100". */
export function addressLine(address: Address): string {
  if (!address) return '';
  return [
    [address.street, address.number].filter(Boolean).join(', '),
    address.complement,
    address.district,
    cityState(address),
    formatPostalCode(address.postalCode),
  ]
    .filter(Boolean)
    .join(', ');
}

/** Mesmo critério do backend para gravar: tudo menos o complemento. */
export function addressComplete(address: Address): boolean {
  return Boolean(
    address?.postalCode &&
    address.street &&
    address.number &&
    address.district &&
    address.city &&
    address.state,
  );
}

/** Linha secundária de um cliente em listas e seletores: fantasia, documento e cidade. */
export function customerSubtitle(
  c: Pick<Customer, 'tradeName' | 'document' | 'address' | 'phone'>,
): string {
  return (
    [c.tradeName, formatDocument(c.document), cityState(c.address)].filter(Boolean).join(' · ') ||
    formatPhone(c.phone)
  );
}
