import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { create } from 'fontkit';
import { AppError } from '../../shared/errors/appError.js';
import { checkReadBudget } from '../../shared/operations/readBudget.js';
import { safeDocumentText } from './csv.js';

export const MAX_PDF_BYTES = 8 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;
export const MAX_RENDER_MS = 10_000;

const fonts = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));
// Compiled files retain the src/module hierarchy under dist.
// Build copies assets into dist/assets, preserving this module-relative path.
export const fontRoot = fonts;
const coverage = create(readFileSync(`${fontRoot}/LiberationSans-Regular.ttf`));
if (!('hasGlyphForCodePoint' in coverage))
  throw new Error('Fonte PDF precisa ser TrueType individual');

/** Business text drawn in the document; refuses characters the font cannot draw. */
export const safeText = (value: string) => {
  const text = safeDocumentText(value).replace(/\r\n?/g, '\n').replaceAll('\t', ' ');
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (![9, 10, 13].includes(code) && !coverage.hasGlyphForCodePoint(code))
      throw new AppError(
        422,
        'DOCUMENT_UNSUPPORTED_TEXT',
        'Texto contém caractere sem glifo na fonte do documento',
      );
  }
  return text;
};
export const oneLine = (value: string) => safeText(value).replace(/\s+/g, ' ').trim();

/** "R$ 1.234,56" — Brazilian grouping, integer cents only. */
export const brl = (cents: number) => {
  const sign = cents < 0 ? '- ' : '';
  const abs = Math.abs(cents);
  const reais = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
};
/** API quantity text ("1234.5") in Brazilian notation ("1.234,5"). */
export const brQuantity = (value: string) => {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
};
/** DD/MM/AAAA of an instant in the company timezone. */
export const localDate = (instant: string, timezone: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short' }).format(
    new Date(instant),
  );
/** Order number as shown on every screen ("PED-1A2B3C4D"). */
export const orderNumber = (commercialId: string) => commercialId.slice(0, 12);
/** DD/MM/AAAA of a calendar date (AAAA-MM-DD), without timezone shifts. */
export const calendarDate = (date: string) => date.slice(0, 10).split('-').reverse().join('/');

const INK = '#111111';
const MUTED = '#5E5E5E';
const FAINT = '#8A8A8A';
const RULE = '#D9D9D9';
const HAIRLINE = '#E6E6E6';
export const YELLOW = '#F3B800';
/** Lastro symbol, same outline as frontend/src/brand/Symbol.tsx (100×100 viewBox). */
const SYMBOL =
  'M14 4h14a14 14 0 0 1 14 14v40a4 4 0 0 0 4 4h40a14 14 0 0 1 14 14v6a14 14 0 0 1-14 14H14A14 14 0 0 1 0 82V18A14 14 0 0 1 14 4z';

export const LEFT = 40;
export const WIDTH = 515;
export const RIGHT = LEFT + WIDTH;
const CONTENT_BOTTOM = 782;
const FOOTER_Y = 806;

export interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right';
}
export interface Cell {
  text: string;
  /** Secondary line in smaller grey type (e.g. SKU). */
  sub?: string;
  bold?: boolean;
  /** Thumbnail (JPEG/PNG) drawn before the text; only meaningful in the first column. */
  image?: Buffer;
}
/**
 * Box for the company logo on the first page, in points. Square logos end up 44 × 44, wide ones
 * up to 140 × 44; the proportions are never changed.
 */
const LOGO_MAX_WIDTH = 140;
const LOGO_MAX_HEIGHT = 44;
/** PNG/JPEG bytes with their pixel size (PDFKit's typings do not expose image metadata). */
export interface PdfImage {
  data: Buffer;
  width: number;
  height: number;
}
/** Product thumbnail side in tables: 15 mm. */
export const THUMBNAIL = 42.5;
export interface BrandedHeader {
  /** Company that issues the document: the protagonist of the page. */
  company: string;
  /** Document kind in capitals, e.g. "PEDIDO COMERCIAL". */
  title: string;
  /** Discreet qualifier under the title. */
  subtitle: string;
  /** Short reference repeated on continuation pages and in the footer (e.g. order number). */
  reference: string;
  /** Company logo, beside the company name on the first page; omitted when absent. */
  logo?: PdfImage | null;
}

/**
 * A4 document with the Lastro identity: black on white, company name first (with the company's
 * own logo beside it when it has one), the Lastro logo small in the top right corner, yellow
 * only in details. Pages, headers and footers are drawn here so every generated document
 * paginates, repeats table headings and numbers pages alike.
 */
export class BrandedPdf {
  readonly doc: PDFKit.PDFDocument;
  y = 0;
  private page = 0;
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private readonly output: Promise<Buffer>;
  private readonly start = performance.now();
  private repeatHeading: (() => void) | null = null;

  constructor(
    private readonly header: BrandedHeader,
    private readonly footer: string,
    info: { title: string; createdAt: Date },
  ) {
    this.doc = new PDFDocument({
      size: 'A4',
      margins: { top: 30, bottom: 20, left: LEFT, right: 595.28 - RIGHT },
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
      info: {
        Title: info.title,
        Creator: 'Lastro',
        CreationDate: info.createdAt,
        ModDate: info.createdAt,
      },
    });
    this.output = new Promise<Buffer>((resolve, reject) => {
      this.doc.on('data', (chunk: Buffer) => {
        this.bytes += chunk.length;
        if (this.bytes > MAX_PDF_BYTES)
          this.doc.destroy(
            new AppError(413, 'DOCUMENT_SIZE_LIMIT', 'Documento excede limite técnico'),
          );
        else this.chunks.push(chunk);
      });
      this.doc.on('error', reject);
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks, this.bytes)));
    });
    // Attach rejection handling before asynchronous layout yields.
    void this.output.catch(() => undefined);
    this.doc.registerFont('Body', `${fontRoot}/LiberationSans-Regular.ttf`);
    this.doc.registerFont('Heading', `${fontRoot}/LiberationSans-Bold.ttf`);
    this.doc.registerFont('Brand', `${fontRoot}/Inter-SemiBold.ttf`);
  }

  check() {
    checkReadBudget();
    if (performance.now() - this.start > MAX_RENDER_MS)
      throw new AppError(413, 'DOCUMENT_TIME_LIMIT', 'Documento excede tempo técnico');
    if (this.doc.destroyed)
      throw new AppError(413, 'DOCUMENT_SIZE_LIMIT', 'Documento excede limite técnico');
  }

  /** Size of the company logo inside its box, proportions unchanged. */
  private logoSize(image: PdfImage) {
    const scale = Math.min(LOGO_MAX_WIDTH / image.width, LOGO_MAX_HEIGHT / image.height);
    return { width: image.width * scale, height: image.height * scale };
  }
  /** Draws the company logo at the top left, centred on the box height; false if unreadable. */
  private companyLogo(image: PdfImage): boolean {
    try {
      const { width, height } = this.logoSize(image);
      this.doc.image(image.data, LEFT, 30 + (LOGO_MAX_HEIGHT - height) / 2, { width, height });
      return true;
    } catch {
      return false;
    }
  }
  /** Largest company-name size that fits the header column, or null when none does. */
  private nameSize(company: string, width: number) {
    const sizes = [14, 12, 10.5];
    const doc = this.doc;
    const fits = (s: number, limit: number) =>
      doc.font('Heading').fontSize(s).heightOfString(company, { width }) <= limit;
    return sizes.find((s) => fits(s, 60)) ?? (fits(10.5, 80) ? 10.5 : null);
  }

  /** Lastro horizontal lockup (symbol + "lastro." wordmark), right-aligned at `right`. */
  private logo(right: number, top: number, size: number) {
    const doc = this.doc;
    const fontSize = size * 0.8;
    const spacing = -fontSize * 0.045;
    doc.font('Brand').fontSize(fontSize);
    const word = doc.widthOfString('lastro', { characterSpacing: spacing });
    const dot = fontSize * 0.2;
    const gap = size * 0.3;
    const x = right - (size + gap + word + dot * 1.4);
    doc.save();
    doc.translate(x, top).scale(size / 100);
    doc.path(SYMBOL).fill(INK);
    doc.roundedRect(54, 4, 42, 42, 10).fill(YELLOW);
    doc.restore();
    const baseline = top + size * 0.96;
    doc
      .font('Brand')
      .fontSize(fontSize)
      .fillColor(INK)
      .text('lastro', x + size + gap, baseline - fontSize * 0.97, {
        lineBreak: false,
        characterSpacing: spacing,
      });
    doc.circle(x + size + gap + word + dot * 0.9, baseline - dot / 2, dot / 2).fill(YELLOW);
  }

  newPage() {
    this.check();
    if (this.page >= MAX_PDF_PAGES)
      throw new AppError(413, 'DOCUMENT_PAGE_LIMIT', 'Documento excede limite de páginas');
    const doc = this.doc;
    doc.addPage();
    this.page++;
    const company = oneLine(this.header.company);
    if (this.page === 1) {
      // The company's logo sits on the left and the text column moves beside it; the Lastro
      // lockup steps back to a smaller size, so the seller's brand leads and the platform still
      // signs the document. A name too long for the narrower column keeps the full width and
      // goes without the logo rather than failing.
      const logo = this.header.logo ? this.logoSize(this.header.logo) : null;
      const offset = logo ? logo.width + 14 : 0;
      const branded =
        logo !== null &&
        this.nameSize(company, 390 - offset) !== null &&
        this.companyLogo(this.header.logo!);
      const brand = branded ? { width: offset, height: LOGO_MAX_HEIGHT } : { width: 0, height: 0 };
      this.logo(RIGHT, 34, branded ? 14 : 18);
      const left = LEFT + brand.width;
      const width = 390 - brand.width;
      // Long company names step down in size instead of pushing the content off the page.
      const size = this.nameSize(company, width);
      if (size === null)
        throw new AppError(
          413,
          'DOCUMENT_LAYOUT_LIMIT',
          'Identificação excede limite do cabeçalho',
        );
      doc.font('Heading').fontSize(size);
      const height = doc.heightOfString(company, { width });
      doc.fillColor(INK).text(company, left, 32, { width });
      let y = 32 + height + 7;
      doc
        .font('Heading')
        .fontSize(10)
        .fillColor(INK)
        .text(this.header.title, left, y, { width, characterSpacing: 0.9 });
      y += 15;
      doc.font('Body').fontSize(8).fillColor(MUTED).text(this.header.subtitle, left, y, {
        width,
      });
      y += 15;
      doc.rect(left, y, 26, 2.5).fill(YELLOW);
      y = Math.max(y + 12, brand.height ? 30 + brand.height + 10 : 0);
      this.rule(y, RULE, 0.6);
      this.y = y + 16;
    } else {
      this.logo(RIGHT, 28, 13);
      doc.font('Heading').fontSize(9);
      const height = doc.heightOfString(company, { width: 390 });
      doc.fillColor(INK).text(company, LEFT, 28, { width: 390 });
      const y = 28 + Math.min(height, 60) + 3;
      doc
        .font('Body')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(`${this.header.title} · ${oneLine(this.header.reference)}`, LEFT, y, {
          width: 390,
          characterSpacing: 0.3,
        });
      this.rule(y + 14, RULE, 0.6);
      this.y = y + 26;
      this.repeatHeading?.();
    }
  }

  rule(y: number, color = HAIRLINE, width = 0.4, from = LEFT, to = RIGHT) {
    this.doc.moveTo(from, y).lineTo(to, y).lineWidth(width).strokeColor(color).stroke();
  }

  /** Breaks the page when `height` does not fit; returns whether it did. */
  ensure(height: number) {
    this.check();
    if (height > CONTENT_BOTTOM - 120)
      throw new AppError(413, 'DOCUMENT_LAYOUT_LIMIT', 'Texto excede limite de composição');
    if (this.y + height <= CONTENT_BOTTOM) return false;
    this.newPage();
    return true;
  }
  fits(height: number) {
    return this.y + height <= CONTENT_BOTTOM;
  }

  /** Small capital label used for section titles ("CLIENTE", "PEDIDO"). */
  label(text: string, x = LEFT, y = this.y, width = WIDTH) {
    this.doc
      .font('Heading')
      .fontSize(7)
      .fillColor(FAINT)
      .text(text, x, y, { width, characterSpacing: 0.7 });
    return 12;
  }
  textHeight(text: string, width: number, size = 9, bold = false) {
    return this.doc
      .font(bold ? 'Heading' : 'Body')
      .fontSize(size)
      .heightOfString(safeText(text), { width });
  }
  /** Draws text at an absolute position and returns its height. */
  write(
    text: string,
    x: number,
    y: number,
    width: number,
    options: {
      size?: number;
      bold?: boolean | undefined;
      color?: string;
      align?: 'left' | 'right';
    } = {},
  ) {
    const content = safeText(text);
    const size = options.size ?? 9;
    this.doc
      .font(options.bold ? 'Heading' : 'Body')
      .fontSize(size)
      .fillColor(options.color ?? INK);
    const height = this.doc.heightOfString(content, { width });
    this.doc.text(content, x, y, { width, align: options.align ?? 'left' });
    return height;
  }
  /** Flowing paragraph at the cursor, breaking the page as needed. */
  paragraph(
    text: string,
    options: { size?: number; bold?: boolean | undefined; color?: string; gap?: number } = {},
  ) {
    const height = this.textHeight(text, WIDTH, options.size ?? 9, options.bold);
    this.ensure(height + (options.gap ?? 4));
    this.write(text, LEFT, this.y, WIDTH, options);
    this.y += height + (options.gap ?? 4);
  }

  private cellHeight(cell: Cell, width: number, size: number) {
    let height = this.textHeight(cell.text, width, size, cell.bold);
    if (cell.sub) height += 2 + this.textHeight(cell.sub, width, 7.5);
    return height + 14;
  }
  private headingRow(columns: Column[]) {
    const doc = this.doc;
    let x = LEFT;
    for (const column of columns) {
      doc
        .font('Heading')
        .fontSize(7)
        .fillColor(MUTED)
        .text(column.label.toUpperCase(), x + 5, this.y + 6, {
          width: column.width - 10,
          align: column.align ?? 'left',
          characterSpacing: 0.5,
        });
      x += column.width;
    }
    this.y += 20;
    this.rule(this.y, INK, 0.7);
  }

  /**
   * Table with headings repeated on every page it spans. `tail` is the height of the block that
   * follows the table (totals, signature): the last rows move together with it so that block is
   * never left alone on an otherwise empty page.
   */
  async table(columns: Column[], rows: Cell[][], tail = 0, size = 9) {
    if (Math.abs(columns.reduce((sum, c) => sum + c.width, 0) - WIDTH) > 0.5)
      throw new AppError(500, 'INTERNAL_ERROR', 'Colunas não ocupam a largura do documento');
    // Any thumbnail moves the first column's text right on every row, so names stay aligned;
    // rows without a photo keep their normal height and show no placeholder.
    const indent = rows.some((row) => row[0]?.image) ? THUMBNAIL + 8 : 0;
    const heights = rows.map((row) =>
      Math.max(
        ...row.map((cell, i) =>
          this.cellHeight(cell, columns[i]!.width - 10 - (i === 0 ? indent : 0), size),
        ),
        row[0]?.image ? THUMBNAIL + 10 : 0,
      ),
    );
    const keep = Math.min(2, rows.length);
    const groupStart = rows.length - keep;
    const groupHeight = heights.slice(groupStart).reduce((a, b) => a + b, 0);
    this.ensure(20 + (heights[0] ?? 0));
    this.headingRow(columns);
    this.repeatHeading = () => this.headingRow(columns);
    try {
      for (const [index, row] of rows.entries()) {
        this.check();
        const height = heights[index]!;
        if (height > CONTENT_BOTTOM - 160)
          throw new AppError(413, 'DOCUMENT_LAYOUT_LIMIT', 'Linha excede área imprimível');
        const keepTail =
          index === groupStart &&
          !this.fits(groupHeight + tail) &&
          groupHeight + tail <= CONTENT_BOTTOM - 140;
        if (keepTail || !this.fits(height)) this.newPage();
        let x = LEFT;
        for (const [i, cell] of row.entries()) {
          const column = columns[i]!;
          const shift = i === 0 ? indent : 0;
          const width = column.width - 10 - shift;
          const align = column.align ?? 'left';
          if (i === 0 && cell.image) this.thumbnail(cell.image, x + 5, this.y + 5);
          const used = this.write(cell.text, x + 5 + shift, this.y + 7, width, {
            size,
            bold: cell.bold,
            align,
          });
          if (cell.sub)
            this.write(cell.sub, x + 5 + shift, this.y + 9 + used, width, {
              size: 7.5,
              color: FAINT,
              align,
            });
          x += column.width;
        }
        this.y += height;
        this.rule(this.y);
        if (index % 20 === 19) await yieldLoop();
      }
    } finally {
      this.repeatHeading = null;
    }
  }

  /** Product photo fitted (proportions kept) and centred in its 15 mm square; skipped if unreadable. */
  private thumbnail(image: Buffer, x: number, y: number) {
    try {
      this.doc.image(image, x, y, {
        fit: [THUMBNAIL, THUMBNAIL],
        align: 'center',
        valign: 'center',
      });
      // Hairline square: photos on white backgrounds still read as one tidy column.
      this.doc.lineWidth(0.4).strokeColor(HAIRLINE).rect(x, y, THUMBNAIL, THUMBNAIL).stroke();
    } catch {
      // A damaged thumbnail never blocks the document: the line keeps its text.
    }
  }

  /** Label/value pairs right-aligned under a table (subtotal, discount, total). */
  totals(rows: { label: string; value: string; strong?: boolean }[], x = 315) {
    const width = RIGHT - x;
    for (const row of rows) {
      const size = row.strong ? 11 : 9;
      const height = row.strong ? 26 : 17;
      if (row.strong) {
        this.rule(this.y + 2, INK, 0.7, x, RIGHT);
        this.doc.rect(x, this.y + 8, 2.5, 12).fill(YELLOW);
      }
      const top = this.y + (row.strong ? 9 : 3);
      this.write(row.label, x + (row.strong ? 9 : 0), top, width * 0.55, {
        size: row.strong ? 9.5 : 8.5,
        bold: row.strong,
        color: row.strong ? INK : MUTED,
      });
      this.write(row.value, x + width * 0.4, top - (row.strong ? 1 : 0), width * 0.6, {
        size,
        bold: row.strong,
        align: 'right',
      });
      this.y += height;
    }
  }

  async finish(): Promise<Buffer> {
    const doc = this.doc;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.check();
      doc.switchToPage(i);
      this.rule(FOOTER_Y - 7, HAIRLINE, 0.4);
      doc
        .font('Body')
        .fontSize(7)
        .fillColor(FAINT)
        .text(this.footer, LEFT, FOOTER_Y, { width: 340, lineBreak: false });
      // The reference itself is in every page header; the footer keeps only the page count.
      doc.text(`Página ${i - range.start + 1} de ${range.count}`, RIGHT - 150, FOOTER_Y, {
        width: 150,
        align: 'right',
        lineBreak: false,
      });
    }
    doc.end();
    const result = await this.output;
    if (performance.now() - this.start > MAX_RENDER_MS)
      throw new AppError(413, 'DOCUMENT_TIME_LIMIT', 'Documento excede tempo técnico');
    return result;
  }
  destroy() {
    this.doc.destroy();
  }
}
