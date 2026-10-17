import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = [
  'LiberationSans-Regular.ttf',
  'LiberationSans-Bold.ttf',
  'LICENSE_LIBERATION',
  'Inter-SemiBold.ttf',
  'LICENSE_INTER',
];
await mkdir('dist/assets/fonts', { recursive: true });
const manifest = {};
for (const file of files) {
  const bytes = await readFile(`assets/fonts/${file}`);
  await cp(`assets/fonts/${file}`, `dist/assets/fonts/${file}`);
  manifest[`fonts/${file}`] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile('dist/assets/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
