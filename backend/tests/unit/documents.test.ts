import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PdfRenderer,
  RECEIPT_DECLARATION,
  formatDocument,
  formatPhone,
} from '../../src/modules/documents/pdfRenderer.js';
import { brl } from '../../src/modules/documents/pdfLayout.js';
import {
  csvCell,
  csvBytes,
  decimalCents,
  brazilianDate,
  MAX_CSV_BYTES,
} from '../../src/modules/documents/csv.js';
import { documentSource, pdfText } from '../helpers/documents.js';
import { orderExportQuery } from '../../src/shared/schemas/documents.js';
import { openApiDocument } from '../../src/modules/auth/openapi.js';
import PDFDocument from 'pdfkit';
import { MAX_PDF_BYTES } from '../../src/modules/documents/pdfRenderer.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
afterEach(() => vi.restoreAllMocks());
describe('Documentos G: conteúdo e composição real de PDF', () => {
  for (const kind of ['commercial', 'packing'] as const)
    it.each([1, 20, 50, 100, 200])('%s produtos em ' + kind, async (count) => {
      const source = documentSource(count);
      const bytes = await new PdfRenderer().render(source, kind, new Date('2026-10-09T12:00:00Z'));
      const pdf = await pdfText(bytes);
      if (count === 1) {
        await mkdir('reports/pdf', { recursive: true });
        await writeFile(`reports/pdf/${kind}-accents.pdf`, bytes);
      }
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(bytes.length).toBeLessThan(8 * 1024 * 1024);
      expect(pdf.text).toContain('Distribuidora São José');
      expect(pdf.text).toContain('Márcia Açúcar & Ação');
      for (let i = 1; i <= count; i++) expect(pdf.text).toContain(`SKU${i}`);
      for (const [i, page] of pdf.pages.entries()) {
        expect(page).toContain(`Página ${i + 1}`);
        expect(page).toContain('PED-000001');
        expect(page).toContain('Distribuidora São José');
        expect(page).toContain(kind === 'commercial' ? 'PEDIDO COMERCIAL' : 'ROMANEIO DE ENTREGA');
        expect(page).toContain(`Página ${i + 1} de ${pdf.pageCount}`);
      }
      expect(pdf.pages[0]).toContain('CPF 123.456.789-09');
      expect(pdf.pages[0]).toContain('Data do pedido');
      expect(pdf.text).not.toContain('Emissão');
      if (count >= 20) expect(pdf.pageCount).toBeGreaterThan(1);
      if (kind === 'commercial') {
        expect(pdf.text).toContain('Documento não fiscal');
        expect(pdf.text).toContain(
          'Documento comercial gerado pelo Lastro. Não possui valor fiscal.',
        );
        expect(pdf.text).toContain('09/11/2026');
        expect(pdf.text).toContain('Observação histórica');
        expect(pdf.text).toContain('TOTAL DO PEDIDO');
        expect(pdf.text).toContain(brl(source.order.totalCents));
        expect(pdf.text).not.toContain('Assinatura');
      } else {
        expect(pdf.text).toContain('Comprovante de recebimento');
        expect(pdf.text).toContain('VALOR TOTAL');
        expect(pdf.text).toContain(brl(source.order.totalCents));
        expect(pdf.text).toContain(RECEIPT_DECLARATION);
        expect(pdf.text).toContain('Nome do recebedor');
        expect(pdf.text).toContain('Data do recebimento');
        expect(pdf.text).toContain('Assinatura do recebedor');
        expect(pdf.text).toContain('Gerado pelo Lastro — Documento não fiscal.');
        for (const removed of ['Solicitada', 'Expedida', 'Devolvida', 'Conferência', 'Parcela'])
          expect(pdf.text).not.toContain(removed);
        expect(pdf.text).not.toContain('Observação histórica');
        // The signature block never sits alone: the last products move with it.
        expect(pdf.pages.at(-1)).toContain(`SKU${count}`);
      }
    });
  it('recusa caractere sem glifo sem substituir informação por quadrado vazio', async () => {
    const source = documentSource();
    source.order.customerName = 'Cliente \u{1F680}';
    await expect(new PdfRenderer().render(source, 'commercial', new Date())).rejects.toMatchObject({
      code: 'DOCUMENT_UNSUPPORTED_TEXT',
      status: 422,
    });
  });
  it('mantém cabeçalho empresarial de 120 letras largas acima do título e normaliza whitespace', async () => {
    const source = documentSource();
    source.tenant.name = 'W'.repeat(120);
    source.order.customerName = 'Cliente São\tJosé\r\nAção';
    const bytes = await new PdfRenderer().render(source, 'commercial', new Date());
    await writeFile('reports/pdf/commercial-long-brand.pdf', bytes);
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
    const pdf = await task.promise;
    try {
      const content = await (await pdf.getPage(1)).getTextContent();
      const items = content.items.filter((i) => 'str' in i);
      const brand = items.filter((i) => /^W+$/.test(i.str));
      const title = items.find((i) => i.str.includes('PEDIDO COMERCIAL'))!;
      expect(brand.map((i) => i.str).join('')).toBe(source.tenant.name);
      expect(Math.min(...brand.map((i) => i.transform[5]!))).toBeGreaterThan(
        title.transform[5]! + 8,
      );
      expect(items.map((i) => i.str).join(' ')).toContain('Cliente São José');
    } finally {
      await task.destroy();
    }
  });
  it('trata HTML/URL/sintaxe PDF do cadastro como texto, sem scripts ou links executáveis', async () => {
    const source = documentSource();
    source.order.customerName = '<script>ação</script> https://example.invalid /OpenAction';
    const bytes = await new PdfRenderer().render(source, 'commercial', new Date());
    expect((await pdfText(bytes)).text).toContain(source.order.customerName);
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
    const pdf = await task.promise;
    try {
      expect(await pdf.getJSActions()).toBeNull();
      for (let i = 1; i <= pdf.numPages; i++)
        expect(await (await pdf.getPage(i)).getAnnotations()).toEqual([]);
    } finally {
      await task.destroy();
    }
  });
  it('mantém conteúdo comercial determinístico entre emissões', async () => {
    const renderer = new PdfRenderer(),
      source = documentSource();
    const a = await pdfText(
      await renderer.render(source, 'commercial', new Date('2026-10-09T12:00:00Z')),
    );
    const b = await pdfText(
      await renderer.render(source, 'commercial', new Date('2026-10-10T12:00:00Z')),
    );
    expect(a.text).toBe(b.text);
  });
  it.each(['draft', 'canceled'] as const)('recusa romaneio de pedido %s', async (status) => {
    const source = documentSource();
    source.order.status = status;
    await expect(new PdfRenderer().render(source, 'packing', new Date())).rejects.toMatchObject({
      code: 'DOCUMENT_UNAVAILABLE',
      status: 409,
    });
  });
  it('mostra desconto de forma que o total feche e omite dados inexistentes', async () => {
    const source = documentSource(2);
    source.order.discountCents = 500;
    source.order.totalCents = source.order.subtotalCents - 500;
    source.order.lines[0]!.discountCents = 500;
    source.order.lines[0]!.totalCents = 2000;
    source.customer = null;
    const pdf = await pdfText(await new PdfRenderer().render(source, 'commercial', new Date()));
    expect(pdf.text).toContain('Subtotal dos produtos');
    expect(pdf.text).toContain(`- ${brl(500)}`);
    expect(pdf.text).toContain(brl(4500));
    expect(pdf.text).not.toContain('CPF');
    expect(pdf.text).not.toContain('ENDEREÇO');
  });
  it('formata documento, telefone e moeda no padrão brasileiro', () => {
    expect(formatDocument('12345678909')).toBe('123.456.789-09');
    expect(formatDocument('12345678000195')).toBe('12.345.678/0001-95');
    expect(formatPhone('+5511987654321')).toBe('(11) 98765-4321');
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444');
    expect(brl(123456789)).toBe('R$ 1.234.567,89');
    expect(brl(5)).toBe('R$ 0,05');
  });
  it('rejeita limite de tempo sem PDF parcial', async () => {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      time += 11_000;
      return time;
    });
    await expect(
      new PdfRenderer().render(documentSource(), 'commercial', new Date()),
    ).rejects.toMatchObject({ code: 'DOCUMENT_TIME_LIMIT', status: 413 });
  });
  it('rejeita excesso de páginas sem truncar produtos', async () => {
    const source = documentSource(200);
    source.order.lines = Array.from({ length: 10_000 }, (_, i) => ({
      ...source.order.lines[0]!,
      id: `line${i}`,
    }));
    await expect(new PdfRenderer().render(source, 'commercial', new Date())).rejects.toMatchObject({
      code: 'DOCUMENT_PAGE_LIMIT',
      status: 413,
    });
  });
  it('rejeita stream maior que 8 MiB sem entregar bytes parciais', async () => {
    const push = PDFDocument.prototype.push;
    let injected = false;
    vi.spyOn(PDFDocument.prototype, 'push').mockImplementation(function (
      this: PDFKit.PDFDocument,
      chunk,
      encoding,
    ) {
      if (Buffer.isBuffer(chunk) && !injected) {
        injected = true;
        return push.call(this, Buffer.alloc(MAX_PDF_BYTES + 1), encoding);
      }
      return push.call(this, chunk, encoding);
    });
    await expect(
      new PdfRenderer().render(documentSource(), 'commercial', new Date()),
    ).rejects.toMatchObject({ status: 413, code: 'DOCUMENT_SIZE_LIMIT' });
  });
});
describe('CSV G', () => {
  it.each(['=HYPERLINK("url")', '+SUM(1)', '-1+1', '@SUM(1)', '  =1+1', '\t=1+1', '\r=1', '\n@A'])(
    'neutraliza fórmula %j',
    (value) => expect(csvCell(value)).toMatch(/^"'/),
  );
  it('preserva acentos, delimitadores, aspas e linha com BOM/CRLF', () => {
    const bytes = csvBytes(['Nome'], [['Ação; "São José"\nsegunda linha']]);
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
    expect(bytes.toString()).toContain('"Ação; ""São José""\nsegunda linha"\r\n');
  });
  it('não modifica texto neutro e remove controles não imprimíveis', () => {
    expect(csvCell('São\0 José')).toBe('"São José"');
    expect(csvCell('\u200b=1+1')).toBe('"\'=1+1"');
  });
  it('usa centavos inteiros e data sem mudança de fuso', () => {
    expect(decimalCents(100001)).toBe('1000,01');
    expect(brazilianDate('2026-10-09')).toBe('09/10/2026');
  });
  it('rejeita CSV acima de 1 MiB sem saída parcial', () =>
    expect(() => csvBytes(['nome'], [['x'.repeat(MAX_CSV_BYTES)]])).toThrow('limite técnico'));
  it('limita pedidos por página sem impor limite comercial', () => {
    expect(orderExportQuery.safeParse({ limit: '10' }).success).toBe(true);
    expect(orderExportQuery.safeParse({ limit: '11' }).success).toBe(false);
  });
  it('publica seis downloads privados com mídias e paginação', () => {
    const api = openApiDocument();
    expect(api.info.version).toBe('0.9.0');
    const json = JSON.stringify(api);
    expect(json).toContain('application/pdf');
    expect(json).toContain('text/csv');
    expect(json).toContain('X-Next-Cursor');
    expect(Object.values(api.paths).reduce((n, p) => n + Object.keys(p).length, 0)).toBe(146);
  });
});
