#!/usr/bin/env node
/**
 * Gera a apresentação do Lastro em PDF paisagem (A4 deitado).
 *
 * Fonte: docs/manuais/fonte/apresentacao.html
 * Saída: docs/manuais/lastro-apresentacao.pdf
 *
 * Uso: node docs/manuais/fonte/gerar-apresentacao.mjs
 *
 * No HTML, `__FONTS__` aponta para frontend/assets/fonts e `{{img:arquivo.png}}` para uma
 * captura de docs/manuais/fonte/capturas. Requer Chrome ou Edge (ou LASTRO_CHROME).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const fontsDir = join(repo, 'frontend/assets/fonts');
const imagesDir = join(here, 'capturas');
const out = resolve(here, '..', 'lastro-apresentacao.pdf');

function findChrome() {
  const candidates = [
    process.env.LASTRO_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('Chrome/Edge não encontrado. Defina LASTRO_CHROME.');
  return found;
}

const html = readFileSync(join(here, 'apresentacao.html'), 'utf8')
  .replaceAll('__FONTS__', pathToFileURL(fontsDir).href)
  .replace(/\{\{img:([\w.-]+)\}\}/g, (_, file) => {
    const path = join(imagesDir, file);
    if (!existsSync(path)) throw new Error(`Imagem não encontrada: ${file}`);
    return pathToFileURL(path).href;
  });

const work = mkdtempSync(join(tmpdir(), 'lastro-apresentacao-'));
try {
  const page = join(work, 'apresentacao.html');
  const profile = join(work, 'perfil-chrome');
  mkdirSync(profile);
  writeFileSync(page, html);
  execFileSync(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--allow-file-access-from-files',
      `--user-data-dir=${profile}`,
      '--no-pdf-header-footer',
      '--virtual-time-budget=8000',
      `--print-to-pdf=${out}`,
      pathToFileURL(page).href,
    ],
    { stdio: 'pipe' },
  );
  console.log(`apresentação -> ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
