import type { Payment, Receivable } from '@/api/types';
import { addDays, firstOfMonth } from '@/lib/calendar';

/**
 * Indicadores do painel. A API não tem agregados financeiros: a tela lê todas as páginas de
 * títulos (ordem por vencimento) e de recebimentos até um limite técnico. Um indicador só é
 * apresentado quando a leitura cobre todo o seu escopo; caso contrário, fica indisponível.
 */
export const OVERVIEW_PAGE_SIZE = 100;
export const OVERVIEW_MAX_PAGES = 10;

export type Amount = { cents: number; count: number };
export type TitleScan = { items: Receivable[]; complete: boolean };
export type PaymentScan = { items: Payment[]; complete: boolean };

/**
 * Títulos chegam ordenados por vencimento. Se a leitura parou, todos os títulos com
 * vencimento anterior ao último lido já foram vistos (empates no mesmo dia podem faltar).
 */
export function coveredBefore(scan: TitleScan): string | null {
  if (scan.complete) return '9999-12-31';
  return scan.items.at(-1)?.dueDate ?? null;
}

const sum = (items: Receivable[]): Amount => ({
  cents: items.reduce((a, t) => a + t.outstandingCents, 0),
  count: items.length,
});

export function summarizeTitles(scan: TitleScan, today: string, soonDays = 7) {
  const open = scan.items.filter((t) => t.outstandingCents > 0);
  const limit = coveredBefore(scan);
  const soonEnd = addDays(today, soonDays);
  return {
    open: scan.complete ? sum(open) : null,
    overdue:
      limit && limit > addDays(today, -1) ? sum(open.filter((t) => t.dueDate < today)) : null,
    dueToday: limit && limit > today ? sum(open.filter((t) => t.dueDate === today)) : null,
    dueSoon:
      limit && limit > soonEnd
        ? sum(open.filter((t) => t.dueDate >= today && t.dueDate <= soonEnd))
        : null,
  };
}

/**
 * Recebido no mês: dinheiro registrado com data no mês corrente, descontado o que já foi
 * estornado. Valor destinado a crédito/reembolso continua sendo dinheiro recebido.
 */
export function receivedInMonth(scan: PaymentScan, today: string): Amount | null {
  if (!scan.complete) return null;
  const from = firstOfMonth(today);
  const items = scan.items.filter((p) => p.receivedOn >= from && p.receivedOn <= today);
  return {
    cents: items.reduce((a, p) => a + p.amountCents - p.reversedCents, 0),
    count: items.length,
  };
}

/** Vencidos primeiro (mais antigos), depois hoje e próximos vencimentos. */
export function upcomingTitles(scan: TitleScan, limit = 8): Receivable[] {
  return scan.items.filter((t) => t.outstandingCents > 0).slice(0, limit);
}

export function recentPayments(scan: PaymentScan, limit = 5): Payment[] {
  return [...scan.items]
    .sort((a, b) =>
      a.receivedOn === b.receivedOn
        ? b.recordedAt.localeCompare(a.recordedAt)
        : b.receivedOn.localeCompare(a.receivedOn),
    )
    .slice(0, limit);
}
