import type { BadgeTone } from '@/ui';
import type { RepurchaseStatus, VisitKind, VisitSource } from '@/api/types';
import { formatIsoDate } from '@/lib/calendar';

/** Entrega automática nunca aparece como visita presencial de vendedor. */
export const kindLabel: Record<VisitKind, string> = {
  in_person: 'Visita presencial',
  remote: 'Contato remoto',
  delivery: 'Entrega confirmada',
};

export const sourceCopy: Record<VisitSource, { label: string; tone: BadgeTone }> = {
  manual: { label: 'Manual', tone: 'accent' },
  automatic: { label: 'Automático', tone: 'neutral' },
};

export const repurchaseCopy: Record<
  RepurchaseStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  overdue: {
    label: 'Estimativa vencida',
    tone: 'warning',
    description: 'A data estimada de recompra já passou.',
  },
  on_track: {
    label: 'Dentro do intervalo',
    tone: 'success',
    description: 'Ainda dentro da frequência habitual de compra.',
  },
  insufficient_history: {
    label: 'Sem histórico suficiente',
    tone: 'neutral',
    description: 'Poucas compras confirmadas para estimar a recompra.',
  },
};

export function formatDay(value: string | null | undefined, empty = '—') {
  return value ? formatIsoDate(value) || empty : empty;
}

export function frequencyLabel(days: number | null) {
  if (days === null) return '—';
  return days === 1 ? 'A cada 1 dia' : `A cada ${days} dias`;
}

/** "vencida há 5 dias", "em 3 dias", "hoje". */
export function estimateDistance(daysFromEstimate: number | null) {
  if (daysFromEstimate === null) return null;
  if (daysFromEstimate === 0) return 'hoje';
  const n = Math.abs(daysFromEstimate);
  const unit = n === 1 ? 'dia' : 'dias';
  return daysFromEstimate > 0 ? `vencida há ${n} ${unit}` : `em ${n} ${unit}`;
}

/** Rótulo de pessoa: "Você", o nome do servidor ou um código neutro. */
export function personLabel(uid: string | null, name: string | null, me: string | undefined) {
  if (uid === null) return 'Sem responsável';
  if (uid === me) return 'Você';
  return name ?? `Usuário ${uid.slice(0, 6).toUpperCase()}`;
}
