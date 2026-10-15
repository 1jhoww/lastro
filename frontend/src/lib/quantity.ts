/**
 * Quantidades seguem o contrato da Fase C: texto decimal com ponto, inteiros para UN/CX/PCT e até
 * três casas para KG/L. Internamente o cliente usa milésimos inteiros (escala 1000), como o backend,
 * para nunca somar quantidades em ponto flutuante.
 */

export const QUANTITY_SCALE = 1000;
/** Limite do backend: 1.000.000.000 unidades por saldo/operação. */
export const QUANTITY_MAX_MILLI = 1_000_000_000 * QUANTITY_SCALE;

export type Unit = 'UN' | 'CX' | 'PCT' | 'KG' | 'L';

export const unitLabel: Record<Unit, string> = {
  UN: 'un',
  CX: 'cx',
  PCT: 'pct',
  KG: 'kg',
  L: 'L',
};

export function decimalsFor(unit: Unit): 0 | 3 {
  return unit === 'KG' || unit === 'L' ? 3 : 0;
}

/**
 * Converte digitação do usuário (vírgula ou ponto decimal) em milésimos.
 * Retorna null para texto inválido, precisão excedida ou valor acima do limite.
 */
export function parseQuantityInput(input: string, unit: Unit): number | null {
  const text = input.trim().replace(',', '.');
  const match = /^(\d{1,10})(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) return null;
  const [, int = '0', frac = ''] = match;
  if (frac.length > decimalsFor(unit)) return null;
  const milli = Number(int) * QUANTITY_SCALE + Number(frac.padEnd(3, '0'));
  return milli > QUANTITY_MAX_MILLI ? null : milli;
}

/**
 * Texto canônico da API: ponto decimal, sem zeros finais ("1.25", "10"). Negativos (delta de
 * ajuste de estoque) levam o sinal na frente: "-1.5".
 */
export function toApiQuantity(milli: number): string {
  if (milli < 0) return `-${toApiQuantity(-milli)}`;
  const int = Math.trunc(milli / QUANTITY_SCALE);
  const frac = String(milli % QUANTITY_SCALE)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return frac ? `${int}.${frac}` : String(int);
}

/** Lê o texto canônico da API em milésimos (aceita sinal, como no delta de ajuste). */
export function fromApiQuantity(text: string): number {
  if (text.startsWith('-')) return -fromApiQuantity(text.slice(1));
  const [int = '0', frac = ''] = text.split('.');
  return Number(int) * QUANTITY_SCALE + Number(frac.padEnd(3, '0'));
}

/** Exibição pt-BR: separador de milhar e vírgula decimal ("1.250,5 kg"). */
export function formatQuantity(milli: number, unit?: Unit): string {
  const negative = milli < 0;
  const abs = Math.abs(milli);
  const int = Math.trunc(abs / QUANTITY_SCALE);
  const frac = String(abs % QUANTITY_SCALE)
    .padStart(3, '0')
    .replace(/0+$/, '');
  const grouped = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = `${negative ? '−' : ''}${grouped}${frac ? `,${frac}` : ''}`;
  return unit ? `${body} ${unitLabel[unit]}` : body;
}
