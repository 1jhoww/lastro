import { AppError } from '../../shared/errors/appError.js';
import type { ReportValueKind, ReportView } from '../../shared/schemas/reports.js';
import { csvCell } from '../documents/csv.js';
import {
  BrandedPdf,
  LEFT,
  WIDTH,
  brQuantity,
  brl,
  calendarDate,
  oneLine,
  type Cell,
  type Column,
} from '../documents/pdfLayout.js';

export const MAX_REPORT_CSV_BYTES = 8 * 1024 * 1024;
export const MAX_REPORT_PDF_ROWS = 3000;

const dateTime = (instant: string, timezone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(instant));

/** Brazilian notation for one cell; CSV keeps numbers free of currency and grouping symbols. */
export function formatValue(
  kind: ReportValueKind,
  value: string | number | null | undefined,
  timezone: string,
  target: 'csv' | 'pdf',
): string {
  if (value === null || value === undefined || value === '') return '';
  switch (kind) {
    case 'money': {
      const cents = Number(value);
      if (target === 'pdf') return brl(cents);
      const abs = Math.abs(cents);
      return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
    }
    case 'percent':
      return `${String(value).replace('.', ',')}${target === 'pdf' ? '%' : ''}`;
    case 'quantity':
      return target === 'pdf' ? brQuantity(String(value)) : String(value).replace('.', ',');
    case 'count':
      return target === 'pdf'
        ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
        : String(value);
    case 'date':
      return calendarDate(String(value));
    case 'datetime':
      return dateTime(String(value), timezone);
    default:
      return String(value);
  }
}
export const periodText = (view: ReportView) =>
  view.period
    ? `${calendarDate(view.period.from)} a ${calendarDate(view.period.to)} (${view.period.basis.toLowerCase()})`
    : 'Posição atual';

const slug = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'empresa';
/** "vendas-por-periodo_distribuidora-sao-jose_2026-10-01_a_2026-10-16.csv" (ASCII only). */
export function reportFilename(view: ReportView, extension: 'csv' | 'pdf') {
  const when = view.period
    ? `${view.period.from}_a_${view.period.to}`
    : view.generatedAt.slice(0, 10);
  return `${slug(view.title)}_${slug(view.company)}_${when}.${extension}`;
}

/** Spreadsheet CSV: identification lines, a blank line, then the full table. */
export function reportCsv(view: ReportView): Buffer {
  const lines: string[][] = [
    ['Empresa', view.company],
    ['Relatório', view.title],
    ['Período', periodText(view)],
    ...view.filters.map((f) => [f.label, f.value]),
    ['Gerado em', dateTime(view.generatedAt, view.timezone)],
    [],
    view.columns.map((c) => c.label),
    ...view.rows.map((r) =>
      view.columns.map((c) => formatValue(c.kind, r.cells[c.key], view.timezone, 'csv')),
    ),
  ];
  const chunks = [Buffer.from('﻿', 'utf8')];
  let size = chunks[0]!.length;
  for (const line of lines) {
    const chunk = Buffer.from(`${line.map(csvCell).join(';')}\r\n`, 'utf8');
    size += chunk.length;
    if (size > MAX_REPORT_CSV_BYTES)
      throw new AppError(413, 'EXPORT_SIZE_LIMIT', 'Exportação excede limite técnico');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

const weight: Record<ReportValueKind, number> = {
  text: 3,
  money: 1.55,
  date: 1.3,
  datetime: 1.65,
  count: 1.05,
  quantity: 1.3,
  percent: 1.05,
};
const minimum: Record<ReportValueKind, number> = {
  text: 60,
  money: 64,
  date: 54,
  datetime: 74,
  count: 34,
  quantity: 48,
  percent: 40,
};
/**
 * Every heading fits on one line (words never split) and figures keep a readable minimum; the
 * remaining width goes to the descriptive columns.
 */
function columnWidths(pdf: BrandedPdf, view: ReportView): Column[] {
  pdf.doc.font('Heading').fontSize(7);
  const floor = view.columns.map((c) =>
    Math.max(
      minimum[c.kind],
      ...c.label
        .toUpperCase()
        .split(' ')
        .map((word) => pdf.doc.widthOfString(word, { characterSpacing: 0.5 }) + 14),
    ),
  );
  const weights = view.columns.map((c, i) =>
    c.kind === 'text' && i === 0 ? 3.6 : c.key === 'unit' || c.key === 'sku' ? 1.1 : weight[c.kind],
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w, i) => Math.max(floor[i]!, Math.floor((w / total) * WIDTH)));
  // Give back any overflow from the widest flexible (text) columns, never below their floor.
  let excess = widths.reduce((a, b) => a + b, 0) - WIDTH;
  while (excess > 0) {
    const index = widths
      .map((w, i) => ({ i, room: w - floor[i]! }))
      .filter((x) => x.room > 0)
      .sort((a, b) => b.room - a.room)[0]?.i;
    if (index === undefined) break;
    const take = Math.min(excess, widths[index]! - floor[index]!);
    widths[index]! -= take;
    excess -= take;
  }
  widths[0]! += WIDTH - widths.reduce((a, b) => a + b, 0);
  return view.columns.map((c, i) => ({ label: c.label, width: widths[i]!, align: c.align }));
}

/** A4 report with the same identity as the order documents. */
export async function reportPdf(view: ReportView, emittedAt: Date): Promise<Buffer> {
  if (view.rows.length > MAX_REPORT_PDF_ROWS)
    throw new AppError(
      413,
      'DOCUMENT_PAGE_LIMIT',
      `PDF limitado a ${MAX_REPORT_PDF_ROWS} linhas; exporte em CSV ou reduza o período`,
    );
  const pdf = new BrandedPdf(
    {
      company: view.company,
      title: `RELATÓRIO · ${view.title.toUpperCase()}`,
      subtitle: periodText(view),
      reference: view.title,
    },
    'Relatório gerado pelo Lastro.',
    { title: `${view.title} — ${view.company}`, createdAt: emittedAt },
  );
  try {
    pdf.newPage();
    const context = [
      ...view.filters.map((f) => `${f.label}: ${oneLine(f.value)}`),
      `Gerado em ${dateTime(view.generatedAt, view.timezone)}`,
    ].join(' · ');
    pdf.paragraph(context, { size: 8, color: '#5E5E5E', gap: 12 });
    // Summary as a compact grid of figures, four per line.
    const perLine = 4,
      cellWidth = WIDTH / perLine;
    for (let i = 0; i < view.summary.length; i += perLine) {
      pdf.ensure(46);
      const top = pdf.y;
      view.summary.slice(i, i + perLine).forEach((item, j) => {
        const x = LEFT + j * cellWidth;
        pdf.label(item.label.toUpperCase(), x, top, cellWidth - 10);
        pdf.write(formatValue(item.kind, item.value, view.timezone, 'pdf'), x, top + 12, cellWidth - 10, {
          size: 11.5,
          bold: true,
          color: item.tone === 'danger' ? '#9F1D1D' : '#111111',
        });
        if (item.caption)
          pdf.write(oneLine(item.caption), x, top + 28, cellWidth - 10, { size: 7.5, color: '#5E5E5E' });
      });
      pdf.y = top + 46;
    }
    pdf.y += 6;
    if (view.rows.length) {
      const columns = columnWidths(pdf, view);
      const rows: Cell[][] = view.rows.map((r) =>
        view.columns.map((c, i) => ({
          text: oneLine(formatValue(c.kind, r.cells[c.key], view.timezone, 'pdf')) || '—',
          bold: i === 0 && c.kind === 'text',
        })),
      );
      await pdf.table(columns, rows, 0, view.columns.length > 6 ? 7.5 : 8.5);
    } else pdf.paragraph('Nenhum registro encontrado para os filtros informados.', { color: '#5E5E5E' });
    if (view.notes.length) {
      pdf.y += 10;
      for (const note of view.notes) pdf.paragraph(note, { size: 7.5, color: '#5E5E5E', gap: 2 });
    }
    return await pdf.finish();
  } catch (error) {
    pdf.destroy();
    throw error;
  }
}
