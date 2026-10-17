import type { ReportView } from '@/api/types';
import { formatIsoDate } from '@/lib/calendar';
import { formatCents } from '@/lib/money';
import { formatQuantity, fromApiQuantity } from '@/lib/quantity';

export type ValueKind = ReportView['columns'][number]['kind'];

/** "16/10/2026 14:05" no fuso da empresa, como no PDF e no CSV. */
function dateTimeIn(iso: string, timezone: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(d)
    .replace(',', '');
}

/** Valor de célula ou indicador no padrão brasileiro. */
export function formatReportValue(
  kind: ValueKind,
  value: string | number | null | undefined,
  timezone: string,
): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (kind) {
    case 'money':
      return formatCents(Number(value));
    case 'count':
      return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    case 'percent':
      return `${String(value).replace('.', ',')}%`;
    case 'quantity':
      return formatQuantity(fromApiQuantity(String(value)));
    case 'date':
      return formatIsoDate(String(value));
    case 'datetime':
      return dateTimeIn(String(value), timezone);
    default:
      return String(value);
  }
}

export const periodLabel = (view: ReportView) =>
  view.period
    ? `${formatIsoDate(view.period.from)} a ${formatIsoDate(view.period.to)}`
    : 'Posição atual';
