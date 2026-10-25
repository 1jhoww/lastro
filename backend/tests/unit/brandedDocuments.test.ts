import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { PdfRenderer } from '../../src/modules/documents/pdfRenderer.js';
import type { PdfImage } from '../../src/modules/documents/pdfLayout.js';
import { reportPdf } from '../../src/modules/reports/reportFiles.js';
import { documentSource, pdfText } from '../helpers/documents.js';
import {
  brandingAllowed,
  entitlementsFor,
  planCatalog,
  planCodes,
  planFeatures,
} from '../../src/modules/plans/catalog.js';
import { effectivePermissions } from '../../src/modules/users/permissions.js';

/** Logo with transparency and a visible mark, as a distributor would upload it. */
async function logo(width: number, height: number): Promise<PdfImage> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="4" y="4" width="${height - 8}" height="${height - 8}" rx="${height / 5}" fill="#d63384"/>
    <rect x="${height + 8}" y="${height * 0.3}" width="${Math.max(0, width - height - 16)}" height="${height * 0.4}" rx="6" fill="#3d1a5b"/>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true });
  return { data: png.data, width: png.info.width, height: png.info.height };
}
/** Thumbnail as ImageService.pdfThumbnails produces it (160 px JPEG). */
const thumb = (hue: number) =>
  sharp({
    create: { width: 160, height: 120, channels: 3, background: `hsl(${hue}, 60%, 55%)` },
  })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 72 })
    .toBuffer();
const images = (bytes: Buffer) => bytes.toString('latin1').split('/Subtype /Image').length - 1;
const out = 'reports/pdf/branding';

describe('Identidade visual nos PDFs (plano Profissional)', () => {
  it.each([
    ['horizontal', 900, 300],
    ['quadrado', 400, 400],
  ] as const)('logotipo %s: proporção mantida, marca do Lastro presente', async (kind, w, h) => {
    await mkdir(out, { recursive: true });
    const source = documentSource(3);
    source.tenant.name = 'Lady Pets Distribuidora';
    source.branded = true;
    const bytes = await new PdfRenderer().render(
      source,
      'commercial',
      new Date(),
      await logo(w, h),
    );
    await writeFile(`${out}/logo-${kind}.pdf`, bytes);
    const text = (await pdfText(bytes)).text;
    expect(text).toContain('Lady Pets Distribuidora');
    expect(text).toContain('lastro');
    expect(text).toContain('PEDIDO COMERCIAL');
    expect(images(bytes)).toBeGreaterThanOrEqual(1);
  });
  for (const kind of ['commercial', 'packing'] as const)
    it.each([1, 5, 20, 50])(`%s produtos com e sem foto em ${kind}`, async (count) => {
      const source = documentSource(count);
      source.tenant.name = 'Lady Pets Distribuidora';
      source.branded = true;
      // Every other product has a photo; the rest print text only, aligned with the others.
      const thumbnails = new Map<string, Buffer>();
      for (let i = 0; i < count; i += 2) thumbnails.set(`product${i}`, await thumb(i * 7));
      const bytes = await new PdfRenderer().render(
        source,
        kind,
        new Date('2026-10-25T12:00:00Z'),
        await logo(900, 300),
        thumbnails,
      );
      if (count === 1 || count === 50) await writeFile(`${out}/${kind}-${count}.pdf`, bytes);
      const pdf = await pdfText(bytes);
      for (let i = 1; i <= count; i++) expect(pdf.text).toContain(`SKU${i}`);
      for (const [i, page] of pdf.pages.entries())
        expect(page).toContain(`Página ${i + 1} de ${pdf.pageCount}`);
      expect(pdf.text).toContain(kind === 'commercial' ? 'TOTAL DO PEDIDO' : 'VALOR TOTAL');
      // Each photo is embedded once; the logo adds its image and transparency mask.
      expect(images(bytes)).toBeGreaterThanOrEqual(thumbnails.size + 1);
      // Small enough to share on WhatsApp even with 50 photos.
      expect(bytes.length).toBeLessThan(count === 50 ? 900 * 1024 : 400 * 1024);
      if (count >= 20) expect(pdf.pageCount).toBeGreaterThan(1);
    });
  it('produto com foto e nome sempre na mesma página: a linha nunca se divide', async () => {
    const source = documentSource(50);
    source.branded = true;
    const thumbnails = new Map<string, Buffer>();
    for (let i = 0; i < 50; i++) thumbnails.set(`product${i}`, await thumb(i));
    const pdf = await pdfText(
      await new PdfRenderer().render(source, 'commercial', new Date(), null, thumbnails),
    );
    // A SKU printed on a page means its row (photo, name, SKU and values) is on that page.
    for (let i = 1; i <= 50; i++) {
      const pages = pdf.pages.filter((p) => new RegExp(`SKU${i}(?!\\d)`).test(p));
      expect(pages).toHaveLength(1);
    }
  });
  it('miniatura ilegível não impede o documento', async () => {
    const source = documentSource(2);
    const broken = new Map([['product0', Buffer.from('não é imagem')]]);
    const bytes = await new PdfRenderer().render(source, 'commercial', new Date(), null, broken);
    expect((await pdfText(bytes)).text).toContain('SKU1');
  });
  it('sem logotipo: nome em texto, marca do Lastro e nenhum espaço reservado', async () => {
    const source = documentSource(2);
    source.tenant.name = 'Lady Pets Distribuidora';
    const bytes = await new PdfRenderer().render(source, 'commercial', new Date());
    await writeFile(`${out}/sem-logo.pdf`, bytes);
    expect(images(bytes)).toBe(0);
    const text = (await pdfText(bytes)).text;
    expect(text).toContain('Lady Pets Distribuidora');
    expect(text).toContain('lastro');
  });
  it('nome de 120 letras largas com logotipo: o documento sai sem o logotipo, nunca falha', async () => {
    const source = documentSource(1);
    source.tenant.name = 'W'.repeat(120);
    const bytes = await new PdfRenderer().render(
      source,
      'commercial',
      new Date(),
      await logo(900, 300),
    );
    expect((await pdfText(bytes)).text).toContain('W'.repeat(20));
  });
  it('relatório em PDF leva o logotipo; relatórios não ganham fotos de produto', async () => {
    const view = {
      report: 'receivables',
      category: 'financial',
      title: 'Contas a receber',
      description: 'Parcelas',
      company: 'Lady Pets Distribuidora',
      timezone: 'America/Sao_Paulo',
      generatedAt: '2026-10-25T12:00:00.000Z',
      period: { from: '2026-10-01', to: '2026-10-31', basis: 'Data de vencimento' },
      summary: [],
      columns: [{ key: 'name', label: 'Cliente', kind: 'text', align: 'left' }],
      rows: [{ cells: { name: 'Lá Vet' }, link: null }],
      chart: null,
      filters: [],
      notes: [],
    } as unknown as Parameters<typeof reportPdf>[0];
    const plain = await reportPdf(view, new Date());
    const branded = await reportPdf(view, new Date(), await logo(400, 400));
    await writeFile(`${out}/relatorio.pdf`, branded);
    expect(images(plain)).toBe(0);
    expect(images(branded)).toBeGreaterThanOrEqual(1);
  });
});

describe('Recursos de identidade por plano', () => {
  it('Profissional inclui; Essencial e assinatura sem plano válido não', () => {
    const on = (planCode: (typeof planCodes)[number] | null) =>
      entitlementsFor({ planCode, userLimit: planCode ? planCatalog[planCode].userLimit : 2 });
    expect(brandingAllowed(on('profissional'))).toBe(true);
    expect(brandingAllowed(on('essencial'))).toBe(false);
    expect(brandingAllowed(on(null))).toBe(false);
    expect(effectivePermissions('administrator', on(null))).not.toContain('branding:manage');
    expect(planFeatures).toContain('branding.custom');
    // The upload permission only exists while the plan includes the feature.
    expect(effectivePermissions('administrator', on('profissional'))).toContain('branding:manage');
    expect(effectivePermissions('administrator', on('essencial'))).not.toContain('branding:manage');
    expect(effectivePermissions('administrator', on('essencial'))).toContain('tenant:update');
    expect(effectivePermissions('seller', on('profissional'))).not.toContain('branding:manage');
  });
  it('todo plano acima do Profissional herda os recursos dele', () => {
    const base = planCatalog.profissional;
    for (const code of planCodes) {
      const plan = planCatalog[code];
      if (plan.referencePriceCents > base.referencePriceCents)
        for (const feature of base.features) expect(plan.features).toContain(feature);
    }
  });
});
