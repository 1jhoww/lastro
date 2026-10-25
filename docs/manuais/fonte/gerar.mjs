#!/usr/bin/env node
/**
 * Gera os manuais do Lastro em PDF, um por módulo.
 *
 * Fonte: docs/manuais/fonte/modulos/*.md (Markdown simplificado, ver README.md)
 * Saída: docs/manuais/lastro-manual-<slug>.pdf
 *
 * Uso:
 *   node docs/manuais/fonte/gerar.mjs            # todos os módulos
 *   node docs/manuais/fonte/gerar.mjs pedidos    # só os slugs informados
 *   node docs/manuais/fonte/gerar.mjs --html     # também grava o HTML intermediário em fonte/.html/
 *
 * Requisitos: Node 22+, Google Chrome ou Microsoft Edge instalado (ou LASTRO_CHROME apontando
 * para o executável) e as dependências do backend instaladas (usa pdfjs-dist para numerar o
 * índice). O PDF é impresso duas vezes: a primeira descobre em que página cada seção caiu e a
 * segunda escreve esses números no índice.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const outDir = resolve(here, '..');
const fontsDir = join(repo, 'frontend/assets/fonts');
const imagesDir = join(here, 'capturas');
const pdfjsPath = join(repo, 'backend/node_modules/pdfjs-dist/legacy/build/pdf.mjs');

const args = process.argv.slice(2);
const keepHtml = args.includes('--html');
const only = args.filter((a) => !a.startsWith('--'));

// ---------------------------------------------------------------------------------------------
// Markdown simplificado
// ---------------------------------------------------------------------------------------------

const escape = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const marks = { sim: 'Sim', nao: 'Não', lib: 'Se liberado', pad: 'Padrão' };

/** Marcação dentro do texto: [[Botão]], ((Selo|tom)), {sim}, **negrito**, *itálico*. */
function inline(text) {
  let s = escape(text);
  s = s.replace(/`(.+?)`/g, '<code>$1</code>');
  s = s.replace(/\[\[(.+?)\]\]/g, '<span class="ui">$1</span>');
  s = s.replace(/ › /g, '<span class="sep">›</span>');
  s = s.replace(/\(\((.+?)(?:\|(\w+))?\)\)/g, (_, t, tom) => `<span class="selo ${tom ?? ''}">${t}</span>`);
  s = s.replace(/\{(sim|nao|lib|pad)(?::(.+?))?\}/g, (_, k, t) => `<span class="${k}">${t ?? marks[k]}</span>`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>');
  return s;
}

const icons = {
  dica: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  atencao: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  irreversivel: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  perfil: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  nota: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
};
const defaultTitles = {
  dica: 'Dica',
  atencao: 'Atenção',
  irreversivel: 'Não pode ser desfeito',
  perfil: 'Quem pode fazer',
  nota: 'Para saber',
};
const icon = (kind) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[kind] ?? icons.nota}</svg>`;

function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!match) throw new Error('Manual sem cabeçalho (---)');
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, body: source.slice(match[0].length) };
}

/** Converte o corpo em HTML e devolve também os títulos numerados para o índice. */
function renderBody(body, state) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isBlank = (l) => l.trim() === '';

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    // Caixa de destaque: :::tipo Título opcional ... :::
    const box = /^:::(\w+)\s*(.*)$/.exec(line);
    if (box) {
      const inner = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ':::') inner.push(lines[i++]);
      i++;
      const kind = box[1];
      // :::lado — texto à esquerda e capturas (linhas de figura) em coluna à direita.
      if (kind === 'lado') {
        const isFig = (l) => /^!\[/.test(l);
        const text = renderBody(inner.filter((l) => !isFig(l)).join('\n'), state);
        const figs = renderBody(inner.filter(isFig).join('\n\n'), state);
        out.push(`<div class="lado"><div class="texto">${text}</div><div class="coluna">${figs}</div></div>`);
        continue;
      }
      const title = box[2] || defaultTitles[kind] || '';
      out.push(
        `<div class="caixa ${kind}"><p class="titulo-caixa">${icon(kind)}${inline(title)}</p>${renderBody(inner.join('\n'), state)}</div>`,
      );
      continue;
    }

    const heading = /^(#{2,4})\s+(.+?)(?:\s+\{(.+)\})?$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const cls = heading[3] ?? '';
      if (level === 2) {
        state.h2++;
        state.h3 = 0;
        const id = `s${state.h2}`;
        state.toc.push({ level, id, number: String(state.h2), text });
        out.push(
          `<h2 id="${id}" class="${cls}"><span class="num">${state.h2}</span>${inline(text)}${state.marker(id)}</h2>`,
        );
      } else if (level === 3) {
        state.h3++;
        const id = `s${state.h2}-${state.h3}`;
        state.toc.push({ level, id, number: `${state.h2}.${state.h3}`, text });
        out.push(`<h3 id="${id}" class="${cls}">${inline(text)}${state.marker(id)}</h3>`);
      } else out.push(`<h4>${inline(text)}</h4>`);
      i++;
      continue;
    }

    if (line.trim() === '---quebra---') {
      out.push('<div style="break-after: page"></div>');
      i++;
      continue;
    }

    // Figura: ![legenda](arquivo.png "h=90 estreita")
    const fig = /^!\[(.*?)\]\((.+?)(?:\s+"(.*)")?\)\s*$/.exec(line);
    if (fig) {
      const [, caption, file, opts = ''] = fig;
      const path = join(imagesDir, file);
      if (!existsSync(path)) throw new Error(`Imagem não encontrada: ${file}`);
      const height = /h=(\d+)/.exec(opts)?.[1];
      const classes = opts.split(/\s+/).filter((o) => o && !o.includes('='));
      state.figures++;
      const style = height ? ` style="height:${height}mm"` : '';
      out.push(
        `<figure class="${classes.join(' ')}"><div class="moldura"><img src="${pathToFileURL(path).href}"${style} alt="${escape(caption)}"></div><figcaption><b>Figura ${state.figures}.</b> ${inline(caption)}</figcaption></figure>`,
      );
      i++;
      continue;
    }

    // Passos numerados (com continuação recuada e sublistas)
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\d+\.\s/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^\d+\.\s/.test(lines[i])) items.push([lines[i].replace(/^\d+\.\s+/, '')]);
        else items.at(-1).push(lines[i].trim());
        i++;
      }
      const li = items.map((parts) => {
        const text = [];
        const sub = [];
        for (const p of parts) (p.startsWith('- ') ? sub : text).push(p.replace(/^- /, ''));
        const ul = sub.length ? `<ul>${sub.map((s) => `<li>${inline(s)}</li>`).join('')}</ul>` : '';
        return `<li>${inline(text.join(' '))}${ul}</li>`;
      });
      out.push(`<ol class="passos">${li.join('')}</ol>`);
      continue;
    }

    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && (/^- /.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^- /.test(lines[i])) items.push(lines[i].slice(2));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }

    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      // "\|" dentro da célula é um caractere, não uma divisão de coluna.
      const cells = (r) =>
        r
          .trim()
          .replace(/^\||\|$/g, '')
          .split(/(?<!\\)\|/)
          .map((c) => c.trim().replaceAll('\\|', '|'));
      const head = cells(rows[0]);
      const align = cells(rows[1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'centro' : ''));
      const th = head.map((c, k) => `<th class="${align[k]}">${inline(c)}</th>`).join('');
      const tb = rows
        .slice(2)
        .map((r) => `<tr>${cells(r).map((c, k) => `<td class="${align[k]}">${inline(c)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`);
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^(#{2,4}\s|:::|!\[|\d+\.\s|- |\|)/.test(lines[i])
    )
      para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Página completa
// ---------------------------------------------------------------------------------------------

const SYMBOL_PATH =
  'M14 4h14a14 14 0 0 1 14 14v40a4 4 0 0 0 4 4h40a14 14 0 0 1 14 14v6a14 14 0 0 1-14 14H14A14 14 0 0 1 0 82V18A14 14 0 0 1 14 4z';
const symbol = (ink, square, opacity = 1) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><path fill="${ink}" opacity="${opacity}" d="${SYMBOL_PATH}"/><rect x="54" y="4" width="42" height="42" rx="10" fill="${square}" opacity="${opacity}"/></svg>`;

function renderManual(source, pages) {
  const { meta, body } = parseFrontmatter(source);
  const state = {
    h2: 0,
    h3: 0,
    figures: 0,
    toc: [],
    // Na primeira impressão, cada título leva um código invisível para achar sua página.
    marker: (id) => (pages ? '' : `<span class="marcador">MKR${id.replace('-', 'X')}MKR</span>`),
  };
  const content = renderBody(body, state);
  const css = readFileSync(join(here, 'estilo.css'), 'utf8')
    .replaceAll('__FONTS__', pathToFileURL(fontsDir).href)
    .replaceAll('__MODULO__', meta.modulo.replaceAll("'", "\\'"));

  const publico = (meta.publico ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<span>${escape(p)}</span>`)
    .join('');

  const toc = state.toc
    .map(
      (t) =>
        `<li class="n${t.level - 1}"><a href="#${t.id}">${t.level === 2 ? `<span class="num">${t.number}</span>` : ''}<span class="titulo">${inline(t.text)}</span><span class="pagina">${pages?.[t.id] ?? '00'}</span></a></li>`,
    )
    .join('');

  const perfis =
    meta.administrador || meta.vendedor
      ? `<div class="resumo-perfis">
          <div><h4>Administrador</h4><p>${inline(meta.administrador ?? '')}</p></div>
          <div><h4>Vendedor</h4><p>${inline(meta.vendedor ?? '')}</p></div>
        </div>`
      : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Lastro · Manual do usuário · ${escape(meta.titulo)}</title>
<meta name="author" content="Hepta Studios">
<meta name="description" content="${escape(meta.subtitulo ?? '')}">
<style>${css}</style>
</head>
<body>
<section class="capa">
  <div class="marca">${symbol('#F6F3ED', '#F3B800')}<span class="wordmark">lastro<span class="ponto"></span></span></div>
  <div class="rotulo">Manual do usuário</div>
  <h1>${inline(meta.titulo)}</h1>
  <div class="subtitulo">${inline(meta.subtitulo ?? '')}</div>
  ${publico ? `<div class="publico">${publico}</div>` : ''}
  <div class="simbolo-fundo">${symbol('#2A2A2A', '#F3B800')}</div>
  <div class="rodape">
    <div class="slogan">Uma base sólida para o seu negócio.</div>
    <div class="hepta">by hepta</div>
    <div class="versao">${escape(meta.versao ?? 'Versão beta · outubro de 2026')}. As telas mostradas usam dados fictícios de demonstração.</div>
  </div>
</section>
<section class="indice${state.toc.length > 16 ? ' compacta' : ''}">
  <h2 class="titulo-indice">Neste manual</h2>
  <p class="intro">${inline(meta.resumo ?? '')}</p>
  <ol>${toc}</ol>
  ${perfis}
</section>
<main>
${content}
<p class="fim">Este manual descreve o Lastro na versão beta de outubro de 2026. Nomes de botões e mensagens aparecem como na tela; se algo estiver diferente no seu acesso, o seu perfil ou o plano contratado pode não incluir a função. Dúvidas: fale com o administrador da sua empresa ou com o suporte do Lastro.</p>
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------------------------
// Impressão
// ---------------------------------------------------------------------------------------------

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

function print(chrome, htmlPath, pdfPath, profile) {
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--allow-file-access-from-files',
      `--user-data-dir=${profile}`,
      '--no-pdf-header-footer',
      '--generate-pdf-document-outline',
      '--virtual-time-budget=8000',
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: 'pipe' },
  );
  if (!existsSync(pdfPath)) throw new Error(`Chrome não gerou ${pdfPath}`);
}

async function sectionPages(pdfPath) {
  const { getDocument } = await import(pathToFileURL(pdfjsPath).href);
  const doc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), verbosity: 0 }).promise;
  const pages = {};
  for (let n = 1; n <= doc.numPages; n++) {
    const text = (await (await doc.getPage(n)).getTextContent()).items.map((x) => x.str).join('');
    for (const m of text.matchAll(/MKR(s[\dX]+)MKR/g)) pages[m[1].replace('X', '-')] ??= n;
  }
  return { pages, count: doc.numPages };
}

const sources = readdirSync(join(here, 'modulos'))
  .filter((f) => f.endsWith('.md'))
  .sort();
const chrome = findChrome();
const work = mkdtempSync(join(tmpdir(), 'lastro-manuais-'));
const profile = join(work, 'perfil-chrome');
mkdirSync(profile);
if (keepHtml) mkdirSync(join(here, '.html'), { recursive: true });

try {
  for (const file of sources) {
    const source = readFileSync(join(here, 'modulos', file), 'utf8');
    const { meta } = parseFrontmatter(source);
    if (only.length && !only.includes(meta.slug)) continue;
    const out = join(outDir, `lastro-manual-${meta.slug}.pdf`);

    const draftHtml = join(work, `${meta.slug}-1.html`);
    const draftPdf = join(work, `${meta.slug}-1.pdf`);
    writeFileSync(draftHtml, renderManual(source, null));
    print(chrome, draftHtml, draftPdf, profile);
    const { pages, count } = await sectionPages(draftPdf);

    const finalHtml = join(work, `${meta.slug}.html`);
    const html = renderManual(source, pages);
    writeFileSync(finalHtml, html);
    print(chrome, finalHtml, out, profile);
    if (keepHtml) writeFileSync(join(here, '.html', `${meta.slug}.html`), html);
    const check = await sectionPages(out);
    if (check.count !== count) console.warn(`  aviso: ${meta.slug} mudou de ${count} para ${check.count} páginas`);
    console.log(`${meta.slug}: ${check.count} páginas -> ${out}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
