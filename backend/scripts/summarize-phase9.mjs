import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
const dir = '../docs/audits/evidence/fase9';
const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.ceil(sorted.length * p) - 1];
  return {
    n: sorted.length,
    min: sorted[0],
    median: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1),
  };
}
const before = read('backend-before.json').records;
const after = read('backend-after.json').records;
const webBefore = read('web-before-authenticated.json').observations;
const webAfter = read('web-after-authenticated.json').observations;
const apiBefore = read('api-before.json').records;
const apiAfter = read('api-after.json').records;
const group = (records, name) => records.filter((r) => r.name.startsWith(name + '-'));
const backend = {};
for (const prefix of [
  'confirm-1',
  'confirm-20',
  'confirm-50',
  'confirm-100',
  'confirm-200',
  'replay-200',
  'dispatch-200',
  'list-500',
  'filter-500',
  'report-500',
]) {
  backend[prefix] = {
    before: stats(group(before, prefix).map((r) => r.ms)),
    after: stats(group(after, prefix).map((r) => r.ms)),
  };
}
const apis = {};
for (const endpoint of new Set(apiBefore.map((r) => r.endpoint)))
  apis[endpoint] = {
    before: stats(apiBefore.filter((r) => r.endpoint === endpoint).map((r) => r.ms)),
    after: stats(apiAfter.filter((r) => r.endpoint === endpoint).map((r) => r.ms)),
    errorsBefore: apiBefore.filter((r) => r.endpoint === endpoint && r.status !== 200).length,
    errorsAfter: apiAfter.filter((r) => r.endpoint === endpoint && r.status !== 200).length,
  };
const web = {};
for (const profile of ['desktop', 'mobile']) {
  web[profile] = {};
  for (const key of [
    'readyMs',
    'lcp',
    'loginDashboardMs',
    'customerPageMs',
    'customerFilterMs',
    'heapBytes',
  ]) {
    web[profile][key] = {
      before: stats(webBefore.filter((r) => r.profile === profile).map((r) => r[key])),
      after: stats(webAfter.filter((r) => r.profile === profile).map((r) => r[key])),
    };
  }
  web[profile].dashboardResponses = {
    before: webBefore.filter((r) => r.profile === profile).map((r) => r.dashboardRequests.length),
    after: webAfter.filter((r) => r.profile === profile).map((r) => r.dashboardRequests.length),
  };
}
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)],
  );
}
const bundles = {};
for (const [stage, path] of [
  ['before', '../frontend/.local/phase9-baseline-web'],
  ['after', '../frontend/.local/phase9-cancel-web'],
]) {
  const list = files(path);
  const js = list.filter((p) => p.endsWith('.js'));
  const fonts = list.filter((p) => /\.(ttf|woff2)$/.test(p));
  bundles[stage] = {
    jsBytes: js.reduce((n, p) => n + statSync(p).size, 0),
    jsGzipBytes: js.reduce((n, p) => n + gzipSync(readFileSync(p)).length, 0),
    fontCount: fonts.length,
    fontBytes: fonts.reduce((n, p) => n + statSync(p).size, 0),
    totalBytes: list.reduce((n, p) => n + statSync(p).size, 0),
  };
}
const summary = {
  backend,
  apis,
  web,
  bundles,
  memory: {
    before: Math.max(...before.map((r) => r.memoryAfter?.rss ?? r.memory?.rss ?? 0)),
    after: Math.max(...after.map((r) => r.memoryAfter?.rss ?? r.memory?.rss ?? 0)),
    description:
      'Maximum RSS sampled after benchmark operations; not a continuous process peak or leak proof.',
  },
  pdf500: {
    before: before.find((r) => r.name === 'report-pdf-500'),
    after: after.find((r) => r.name === 'report-pdf-500'),
  },
  csv500: {
    before: before.find((r) => r.name === 'report-csv-500'),
    after: after.find((r) => r.name === 'report-csv-500'),
  },
};
writeFileSync(join(dir, 'measurement-summary.json'), JSON.stringify(summary, null, 2));
const n = (value) => Math.round(value);
let md =
  '# Fase 9 — resumo das medições locais\n\nTempos em milissegundos. Ensaios de três amostras mostram mediana e intervalo; p95 é apresentado somente nas APIs com 100 amostras por endpoint.\n\n## Pedidos e relatórios\n\n| Cenário | N antes/depois | Mediana antes | Mediana depois | Intervalo antes | Intervalo depois |\n| --- | --- | ---: | ---: | --- | --- |\n';
for (const [name, x] of Object.entries(backend))
  md += `| ${name} | ${x.before.n}/${x.after.n} | ${n(x.before.median)} | ${n(x.after.median)} | ${n(x.before.min)}–${n(x.before.max)} | ${n(x.after.min)}–${n(x.after.max)} |\n`;
md +=
  '\n## APIs: 100 amostras por endpoint e versão\n\n| Endpoint | Mediana antes/depois | p95 antes/depois | Erros antes/depois |\n| --- | --- | --- | --- |\n';
for (const [name, x] of Object.entries(apis))
  md += `| ${name} | ${n(x.before.median)}/${n(x.after.median)} | ${n(x.before.p95)}/${n(x.after.p95)} | ${x.errorsBefore}/${x.errorsAfter} |\n`;
md +=
  '\n## Navegador\n\n| Perfil/métrica | Mediana antes/depois | Intervalo antes | Intervalo depois |\n| --- | --- | --- | --- |\n';
for (const [profile, values] of Object.entries(web))
  for (const [key, x] of Object.entries(values))
    if (key !== 'dashboardResponses' && key !== 'heapBytes')
      md += `| ${profile}: ${key} | ${n(x.before.median)}/${n(x.after.median)} | ${n(x.before.min)}–${n(x.before.max)} | ${n(x.after.min)}–${n(x.after.max)} |\n`;
md +=
  '\nFontes, tamanhos, respostas do Dashboard, RSS amostrado e arquivos de relatório estão no [resumo JSON](measurement-summary.json). Heap de `performance.memory` é apenas observação de navegador, sem isolamento suficiente para afirmar ganho de memória.\n';
writeFileSync(join(dir, 'measurement-summary.md'), md);
console.log(
  JSON.stringify({
    bundles,
    receivables: apis['/receivables?limit=50'],
    web: web.mobile.readyMs,
    memory: summary.memory,
  }),
);
