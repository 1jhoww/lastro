import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const records = [];
await mkdir('reports/pdf', { recursive: true });
for (const name of [
  'commercial-200',
  'packing-200',
  'commercial-accents',
  'packing-accents',
  'commercial-long-brand',
]) {
  const bytes = await readFile(`reports/pdf/${name}.pdf`);
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  const canvas = createCanvas(1, 1);
  let texts = 0;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1.25 });
      if (
        Math.abs(viewport.width / 1.25 - 595.28) > 0.1 ||
        Math.abs(viewport.height / 1.25 - 841.89) > 0.1
      )
        throw new Error(`${name}: página ${n} não é A4`);
      const content = await page.getTextContent();
      const items = content.items.filter((i) => 'str' in i && i.str.trim());
      texts += items.length;
      for (const item of items) {
        const [, , , , x, y] = item.transform;
        if (x < 39 || x + item.width > 556 || y < 30 || y > 813)
          throw new Error(`${name}: texto fora da área imprimível na página ${n}`);
      }
      if (!items.some((i) => i.str.includes(`Página ${n}`)))
        throw new Error(`${name}: rodapé ausente`);
      if (
        !items.some(
          (i) => i.str.includes('Empresa A') || i.str.includes('Distribuidora São José'),
        ) &&
        !(
          name === 'commercial-long-brand' &&
          items
            .filter((i) => /^W+$/.test(i.str))
            .map((i) => i.str)
            .join('') === 'W'.repeat(120)
        )
      )
        throw new Error(`${name}: empresa ausente na página ${n}`);
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 200 && pixels[i + 1] < 200 && pixels[i + 2] < 200) ink++;
      if (ink < 1000) throw new Error(`${name}: página ${n} vazia`);
      if ([1, Math.ceil(pdf.numPages / 2), pdf.numPages].includes(n))
        await writeFile(`reports/pdf/${name}-qa-${n}.png`, canvas.toBuffer('image/png'));
      page.cleanup();
    }
    records.push({
      name,
      bytes: bytes.length,
      pages: pdf.numPages,
      textItems: texts,
      allPagesRendered: true,
      printableBounds: true,
      nonblank: true,
    });
  } finally {
    await task.destroy();
  }
}
await writeFile('reports/document-pdf-validation.raw.json', JSON.stringify(records, null, 2));
console.log(JSON.stringify(records));
