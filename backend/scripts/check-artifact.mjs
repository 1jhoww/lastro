import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = resolve(process.argv[2] ?? 'dist');
const manifest = JSON.parse(await readFile(resolve(root, 'assets/manifest.json'), 'utf8'));
for (const file of [
  'fonts/LiberationSans-Regular.ttf',
  'fonts/LiberationSans-Bold.ttf',
  'fonts/LICENSE_LIBERATION',
]) {
  const bytes = await readFile(resolve(root, 'assets', file));
  if (manifest[file] !== createHash('sha256').update(bytes).digest('hex'))
    throw new Error(`Asset ausente ou corrompido: ${file}`);
}
const { assertRuntime } = await import(pathToFileURL(resolve(root, 'src/config/runtime.js')).href);
assertRuntime();
await import(pathToFileURL(resolve(root, 'src/app/app.js')).href);
const { PdfRenderer } = await import(
  pathToFileURL(resolve(root, 'src/modules/documents/pdfRenderer.js')).href
);
const source = {
  tenant: { name: 'Artefato São José', timezone: 'America/Sao_Paulo' },
  order: {
    commercialId: 'PED-SMOKE',
    status: 'draft',
    createdAt: '2026-10-13T12:00:00Z',
    customerName: 'Márcia Ação',
    lines: [],
    installments: [],
    notes: '',
    subtotalCents: 0,
    discountCents: 0,
    totalCents: 0,
    payment: null,
  },
  returned: [],
};
for (const kind of ['commercial', 'packing']) {
  const bytes = await new PdfRenderer().render(source, kind, new Date('2026-10-13T12:00:00Z'));
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF compilado inválido');
}
const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } })
  .webp()
  .toBuffer();
if ((await sharp(image).metadata()).format !== 'webp') throw new Error('Sharp inválido');
console.log(
  JSON.stringify({
    artifact: root,
    node: process.versions.node,
    openssl: process.versions.openssl,
    sharp: sharp.versions,
    assets: Object.keys(manifest),
    pdf: ['commercial', 'packing'],
  }),
);
