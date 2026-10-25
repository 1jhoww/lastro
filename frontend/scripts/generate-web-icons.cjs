#!/usr/bin/env node
/**
 * Gera os ícones de navegador da versão web a partir do símbolo do Lastro.
 *
 * Fonte: o mesmo traçado de src/brand/Symbol.tsx (e dos manuais em PDF). Ao receber o SVG
 * oficial do símbolo (docs/brand.md), troque SYMBOL_PATH/SYMBOL_SQUARE e rode de novo.
 *
 * Saída em public/ (copiada para dist/ pelo `expo export`):
 *   favicon.svg           símbolo; o "L" fica bege quando o navegador está no modo escuro
 *   favicon.ico           16, 32 e 48 px, símbolo em carvão (navegadores sem SVG)
 *   apple-touch-icon.png  180 px, símbolo sobre fundo carvão (ícone de app do brand kit)
 * e assets/favicon.png (48 px), referenciado por app.json para o servidor de desenvolvimento.
 *
 * Uso: node scripts/generate-web-icons.cjs
 * Requer o sharp instalado no backend (backend/node_modules/sharp).
 */
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const sharp = require(join(__dirname, '../../backend/node_modules/sharp'));

const CARVAO = '#111111';
const BEGE = '#F6F3ED';
const AMARELO = '#F3B800';
const SYMBOL_PATH =
  'M14 4h14a14 14 0 0 1 14 14v40a4 4 0 0 0 4 4h40a14 14 0 0 1 14 14v6a14 14 0 0 1-14 14H14A14 14 0 0 1 0 82V18A14 14 0 0 1 14 4z';
const SYMBOL_SQUARE = '<rect x="54" y="4" width="42" height="42" rx="10"';

const root = join(__dirname, '..');
const publicDir = join(root, 'public');

const symbolSvg = (ink) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="${ink}" d="${SYMBOL_PATH}"/>${SYMBOL_SQUARE} fill="${AMARELO}"/></svg>`;

const adaptiveSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <style>.l{fill:${CARVAO}}@media (prefers-color-scheme:dark){.l{fill:${BEGE}}}</style>
  <path class="l" d="${SYMBOL_PATH}"/>
  ${SYMBOL_SQUARE} fill="${AMARELO}"/>
</svg>
`;

// Ícone de app: símbolo bege sobre carvão, com margem; o iOS arredonda os cantos sozinho.
const appIconSvg = (pad) => {
  const scale = (100 - 2 * pad) / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${CARVAO}"/><g transform="translate(${pad} ${pad}) scale(${scale})"><path fill="${BEGE}" d="${SYMBOL_PATH}"/>${SYMBOL_SQUARE} fill="${AMARELO}"/></g></svg>`;
};

const png = (svg, size) =>
  sharp(Buffer.from(svg), { density: 1200 }).resize(size, size).png().toBuffer();

/** ICO com imagens PNG embutidas (aceito por todos os navegadores atuais). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

(async () => {
  const symbol = symbolSvg(CARVAO);
  writeFileSync(join(publicDir, 'favicon.svg'), adaptiveSvg);
  const sizes = [16, 32, 48];
  const images = await Promise.all(
    sizes.map(async (size) => ({ size, data: await png(symbol, size) })),
  );
  writeFileSync(join(publicDir, 'favicon.ico'), ico(images));
  writeFileSync(join(publicDir, 'apple-touch-icon.png'), await png(appIconSvg(18), 180));
  writeFileSync(join(root, 'assets/favicon.png'), images.at(-1).data);
  console.log('Ícones gerados em public/ e assets/favicon.png');
})();
