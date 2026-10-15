import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { create } from 'fontkit';
import { AppError } from '../../shared/errors/appError.js';
import { checkReadBudget } from '../../shared/operations/readBudget.js';
import type { Order } from '../../shared/schemas/orders.js';
import { decimalCents, brazilianDate, safeDocumentText } from './csv.js';

export const MAX_PDF_BYTES = 8 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;
export const MAX_RENDER_MS = 10_000;
export interface DocumentSource {
  tenant: { name: string; timezone: string };
  order: Order;
  returned: { lineId: string; received: string }[];
}
const fonts = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));
// Compiled files retain the src/module hierarchy under dist.
// Build copies assets into dist/assets, preserving this module-relative path.
const fontRoot = fonts;
const coverage = create(readFileSync(`${fontRoot}/LiberationSans-Regular.ttf`));
if (!('hasGlyphForCodePoint' in coverage))
  throw new Error('Fonte PDF precisa ser TrueType individual');
const safeText = (value: string) => {
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
const money = (value: number) => `R$ ${decimalCents(value)}`;
const statuses = {
  draft: 'Rascunho',
  confirmed: 'Confirmado',
  dispatched: 'Expedido',
  canceled: 'Cancelado',
};

export class PdfRenderer {
  async render(
    source: DocumentSource,
    kind: 'commercial' | 'packing',
    emittedAt: Date,
  ): Promise<Buffer> {
    const start = performance.now();
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 140, bottom: 64, left: 40, right: 40 },
      autoFirstPage: false,
      compress: true,
      info: {
        Title: kind === 'commercial' ? 'Pedido comercial' : 'Romaneio',
        CreationDate: emittedAt,
        ModDate: emittedAt,
      },
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    const output = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_PDF_BYTES) {
          doc.destroy(new AppError(413, 'DOCUMENT_SIZE_LIMIT', 'Documento excede limite técnico'));
        } else chunks.push(chunk);
      });
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks, bytes)));
    });
    // Attach rejection handling before asynchronous layout yields.
    void output.catch(() => undefined);
    try {
      doc.registerFont('Body', `${fontRoot}/LiberationSans-Regular.ttf`);
      doc.registerFont('Heading', `${fontRoot}/LiberationSans-Bold.ttf`);
      let page = 0,
        y = 140;
      const check = () => {
        checkReadBudget();
        if (performance.now() - start > MAX_RENDER_MS)
          throw new AppError(413, 'DOCUMENT_TIME_LIMIT', 'Documento excede tempo técnico');
        if (doc.destroyed)
          throw new AppError(413, 'DOCUMENT_SIZE_LIMIT', 'Documento excede limite técnico');
      };
      const footer = () => {
        const bottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 20;
        doc.font('Body').fontSize(8).fillColor('#444444');
        const reference = safeText(`Página ${page} | ${source.order.commercialId}`).replace(
          /\s+/g,
          ' ',
        );
        if (doc.widthOfString(reference) > 515)
          throw new AppError(413, 'DOCUMENT_LAYOUT_LIMIT', 'Referência excede largura do rodapé');
        doc.text(reference, 40, 790, {
          width: 515,
          lineBreak: false,
        });
        doc.page.margins.bottom = bottom;
      };
      const newPage = () => {
        check();
        if (page >= MAX_PDF_PAGES)
          throw new AppError(413, 'DOCUMENT_PAGE_LIMIT', 'Documento excede limite de páginas');
        if (page) footer();
        doc.addPage();
        page++;
        doc.font('Heading').fontSize(14).fillColor('#202020');
        const brand = safeText(source.tenant.name).replace(/\s+/g, ' '),
          brandHeight = doc.heightOfString(brand, { width: 515 }),
          titleY = Math.max(74, 32 + brandHeight + 8);
        if (brandHeight > 80)
          throw new AppError(
            413,
            'DOCUMENT_LAYOUT_LIMIT',
            'Identificação excede limite do cabeçalho',
          );
        doc.text(brand, 40, 32, { width: 515 });
        const title =
          kind === 'commercial'
            ? 'Pedido comercial — não é documento fiscal'
            : 'Romaneio - não é documento fiscal ou comprovante de entrega';
        doc.fontSize(11);
        const referenceY = Math.max(105, titleY + doc.heightOfString(title, { width: 515 }) + 8);
        doc.text(title, 40, titleY, { width: 515 });
        doc.font('Body').fontSize(9);
        const reference = safeText(
            `${source.order.commercialId} | ${statuses[source.order.status]}`,
          ).replace(/\s+/g, ' '),
          referenceHeight = doc.heightOfString(reference, { width: 515 });
        if (referenceHeight > 36)
          throw new AppError(413, 'DOCUMENT_LAYOUT_LIMIT', 'Referência excede limite do cabeçalho');
        doc.text(reference, 40, referenceY, { width: 515 });
        const separatorY = Math.max(130, referenceY + referenceHeight + 12);
        doc
          .moveTo(40, separatorY)
          .lineTo(555, separatorY)
          .lineWidth(0.5)
          .strokeColor('#999999')
          .stroke();
        y = separatorY + 10;
      };
      const ensure = (height: number) => {
        check();
        if (height > 630)
          throw new AppError(413, 'DOCUMENT_LAYOUT_LIMIT', 'Texto excede limite de composição');
        if (y + height > 770) newPage();
        if (y + height > 770)
          throw new AppError(413, 'DOCUMENT_LAYOUT_LIMIT', 'Bloco excede área imprimível');
      };
      const text = (value: string, bold = false) => {
        doc
          .font(bold ? 'Heading' : 'Body')
          .fontSize(10)
          .fillColor('#202020');
        const content = safeText(value),
          height = doc.heightOfString(content, { width: 515 }) + 8;
        ensure(height);
        doc
          .font(bold ? 'Heading' : 'Body')
          .fontSize(10)
          .text(content, 40, y, { width: 515 });
        y += height;
      };
      const tableRow = (cells: string[], widths: number[], heading = false) => {
        doc.font(heading ? 'Heading' : 'Body').fontSize(8);
        const cleaned = cells.map(safeText);
        const height = Math.max(
          26,
          ...cleaned.map((cell, i) => doc.heightOfString(cell, { width: widths[i]! - 8 }) + 12),
        );
        ensure(height);
        if (heading) doc.rect(40, y, 515, height).fill('#eeeeee');
        let x = 40;
        cleaned.forEach((cell, i) => {
          doc
            .font(heading ? 'Heading' : 'Body')
            .fontSize(8)
            .fillColor('#202020')
            .text(cell, x + 4, y + 6, { width: widths[i]! - 8 });
          x += widths[i]!;
        });
        doc
          .moveTo(40, y + height)
          .lineTo(555, y + height)
          .lineWidth(0.3)
          .strokeColor('#cccccc')
          .stroke();
        y += height;
      };
      newPage();
      const order = source.order;
      const emission = new Intl.DateTimeFormat('pt-BR', {
        timeZone: source.tenant.timezone,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(emittedAt);
      text(`Emissão: ${emission}`);
      text(`Data do pedido (UTC): ${brazilianDate(order.createdAt)}`);
      if (order.customerName) text(`Cliente: ${order.customerName}`, true);
      if (kind === 'packing')
        text(
          order.status === 'dispatched'
            ? 'Histórico de expedição e devolução física. Não autoriza nova expedição.'
            : order.status === 'canceled'
              ? 'Pedido cancelado. Não autoriza separação ou expedição.'
              : 'Separação do pedido. Expedição ainda não registrada.',
        );
      const widths = kind === 'commercial' ? [185, 46, 70, 70, 70, 74] : [275, 60, 60, 60, 60];
      const headers =
        kind === 'commercial'
          ? ['Produto / SKU', 'Qtd / un.', 'Unitário', 'Subtotal', 'Desconto', 'Total']
          : ['Produto / SKU', 'Solicitada / un.', 'Expedida', 'Devolvida física', 'Conferência'];
      tableRow(headers, widths, true);
      const returned = new Map(source.returned.map((r) => [r.lineId, r.received]));
      for (const [i, line] of order.lines.entries()) {
        check();
        // Repeat table headings when a row moves to a new page.
        doc.font('Body').fontSize(8);
        const name = `${i + 1}. ${line.name}\nSKU: ${line.sku}`;
        const estimated = Math.max(
          46,
          doc.heightOfString(safeText(name), { width: widths[0]! - 8 }) + 12,
        );
        if (y + estimated > 770) {
          newPage();
          tableRow(headers, widths, true);
        }
        tableRow(
          kind === 'commercial'
            ? [
                name,
                `${line.quantity.replace('.', ',')} ${line.unit}`,
                money(line.unitPriceCents),
                money(line.subtotalCents),
                money(line.discountCents),
                money(line.totalCents),
              ]
            : [
                name,
                `${line.quantity.replace('.', ',')} ${line.unit}`,
                order.status === 'dispatched' ? line.quantity.replace('.', ',') : '0',
                (returned.get(line.id) ?? '0').replace('.', ','),
                '[   ]',
              ],
          widths,
        );
        if (i % 20 === 19) await yieldLoop();
      }
      y += 12;
      if (kind === 'commercial') {
        text(`Subtotal: ${money(order.subtotalCents)} | Desconto: ${money(order.discountCents)}`);
        text(`Total do pedido: ${money(order.totalCents)}`, true);
        if (order.discount) text(`Motivo do desconto: ${order.discount.reason}`);
        if (order.paymentTerms) text(`Condição registrada: ${order.paymentTerms.name}`);
        else if (order.payment)
          text(`Condição registrada: ${order.payment.type === 'cash' ? 'À vista' : 'Parcelado'}`);
        if (order.intendedPaymentMethod)
          text(`Forma prevista: ${order.intendedPaymentMethod.name}`);
        for (const installment of order.installments)
          text(
            `Parcela ${installment.number}: ${brazilianDate(installment.dueDate)} - ${money(installment.amountCents)}`,
          );
      }
      if (kind === 'commercial' && order.notes) text(`Observações do pedido: ${order.notes}`);
      if (kind === 'packing') {
        ensure(110);
        text('Observações da conferência: __________________________________________________');
        text('___________________________________________________________________________');
        text('Recebedor / identificação: ____________________________________________________');
        text('Assinatura: ____________________________________ Data: ______________________');
      }
      footer();
      doc.end();
      const result = await output;
      if (performance.now() - start > MAX_RENDER_MS)
        throw new AppError(413, 'DOCUMENT_TIME_LIMIT', 'Documento excede tempo técnico');
      return result;
    } catch (error) {
      doc.destroy();
      throw error;
    }
  }
}
