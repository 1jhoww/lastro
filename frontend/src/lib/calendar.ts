/**
 * Datas de calendário (AAAA-MM-DD, sem hora nem fuso), como a API representa vencimentos e
 * recebimentos. A tela mostra e aceita DD/MM/AAAA; o valor enviado continua AAAA-MM-DD.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** "2026-10-15" → "15/10/2026". Texto inválido volta vazio. */
export function formatIsoDate(value: string): string {
  if (!isIsoDate(value)) return '';
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

/** Aceita "15/10/2026" (ou AAAA-MM-DD já completo); null se incompleto ou inexistente. */
export function parseBrDate(text: string): string | null {
  const t = text.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : t;
  return isIsoDate(iso) ? iso : null;
}

/** Máscara de digitação: insere as barras enquanto a pessoa digita só os números. */
export function maskBrDate(text: string): string {
  if (ISO.test(text.trim())) return formatIsoDate(text.trim()) || text.trim();
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function addDays(value: string, days: number): string {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dias corridos de `from` até `to` (negativo quando `to` é anterior). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function firstOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export const monthNames = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** "outubro de 2026" para o mês de uma data AAAA-MM-DD. */
export function monthLabel(value: string): string {
  return `${monthNames[Number(value.slice(5, 7)) - 1]} de ${value.slice(0, 4)}`;
}

/** Semanas (domingo a sábado) do mês de `value`; dias de outros meses são null. */
export function monthGrid(value: string): (string | null)[][] {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++)
    cells.push(new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(value: string, delta: number): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7)) - 1 + delta;
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}
