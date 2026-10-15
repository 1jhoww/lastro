/**
 * Valores monetários são centavos inteiros, como no backend. Nada aqui calcula preço, desconto
 * ou total autorizado: esses números vêm sempre do servidor. Este módulo só formata e lê digitação.
 */

/** "R$ 1.234,56". Usa o sinal de menos tipográfico para negativos. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents))
    throw new RangeError('Valor monetário deve ser inteiro em centavos');
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100);
  const centavos = String(abs % 100).padStart(2, '0');
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '−' : ''}R$ ${grouped},${centavos}`;
}

/**
 * Campo monetário por deslocamento de dígitos: cada dígito digitado entra pela direita
 * ("1", "12", "123" → R$ 0,01 · R$ 0,12 · R$ 1,23). Evita ambiguidade entre vírgula e ponto.
 */
export function centsFromDigits(input: string, maxCents = 100_000_000): number {
  const digits = input.replace(/\D/g, '').replace(/^0+/, '').slice(0, 12);
  if (!digits) return 0;
  return Math.min(Number(digits), maxCents);
}

/** Pontos base do backend (1000 = 10%) para exibição ("10%", "12,5%"). */
export function formatBasisPoints(bp: number): string {
  const int = Math.trunc(bp / 100);
  const frac = String(bp % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return `${int}${frac ? `,${frac}` : ''}%`;
}
