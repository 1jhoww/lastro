import { AppError } from '../../shared/errors/appError.js';

export const MAX_CSV_BYTES = 1024 * 1024;
export const safeDocumentText = (value: string) =>
  value
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{Cc}/gu, (character) =>
      [9, 10, 13].includes(character.codePointAt(0)!) ? character : '',
    );
export function csvCell(value: string | number | null | undefined) {
  let text = safeDocumentText(String(value ?? ''));
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function csvBytes(headers: string[], rows: (string | number | null | undefined)[][]) {
  const chunks = [Buffer.from(`\uFEFF${headers.map(csvCell).join(';')}\r\n`, 'utf8')];
  let size = chunks[0]!.length;
  for (const row of rows) {
    const chunk = Buffer.from(`${row.map(csvCell).join(';')}\r\n`, 'utf8');
    size += chunk.length;
    if (size > MAX_CSV_BYTES)
      throw new AppError(413, 'EXPORT_SIZE_LIMIT', 'Exportação excede limite técnico');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
export const decimalCents = (cents: number) =>
  `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
export const brazilianDate = (date: string) => date.slice(0, 10).split('-').reverse().join('/');
