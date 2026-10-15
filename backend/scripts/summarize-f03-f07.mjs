import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const read = async (file) => JSON.parse(await readFile(`reports/${file}`, 'utf8'));
const identities = (report) => {
  const records = new Map();
  for (const suite of report.testResults) {
    const file = suite.name.replaceAll('\\', '/').split('/tests/').at(-1);
    for (const test of suite.assertionResults)
      records.set(`${file} :: ${test.fullName}`, test.status);
  }
  return records;
};
const baseline = new Map();
for (const file of [
  'f02-unit-final.raw.json',
  'f02-emulator-final.raw.json',
  'f02-partial-returns-final.raw.json',
])
  for (const [id, status] of identities(await read(file))) {
    if (status !== 'passed') throw new Error(`Base não aprovada: ${id}`);
    baseline.set(id, status);
  }
if (baseline.size !== 602) throw new Error(`Base esperada 602; encontrada ${baseline.size}`);
const current = new Map();
const executions = {};
for (const file of [
  'f03-f07-unit.raw.json',
  'f03-f07-emulator.raw.json',
  'f03-f07-migration.raw.json',
]) {
  const report = await read(file);
  if (!report.success || report.numFailedTests || report.numPendingTests || report.numTodoTests)
    throw new Error(`Execução incompleta: ${file}`);
  executions[file] = {
    passed: report.numPassedTests,
    elapsedMs: Math.max(...report.testResults.map((s) => s.endTime)) - report.startTime,
  };
  for (const [id, status] of identities(report)) {
    if (status !== 'passed') throw new Error(`Teste não aprovado: ${id}`);
    current.set(id, status);
  }
}
const structural = [...baseline.keys()].filter((id) =>
  id.startsWith('integration/financialExecutionCapacity.test.ts ::'),
);
if (structural.length !== 2) throw new Error('Esperados dois ensaios estruturais preservados');
await readFile('tests/integration/financialExecutionCapacity.test.ts');
const missing = [...baseline.keys()].filter((id) => !current.has(id) && !structural.includes(id));
if (missing.length) throw new Error(`Regressões da base ausentes: ${missing.join(', ')}`);
const newTests = [...current.keys()].filter((id) => !baseline.has(id));
const lockfileSha256 = createHash('sha256')
  .update(await readFile('package-lock.json'))
  .digest('hex');
const result = {
  baseline: baseline.size,
  rerunPassed: current.size,
  baselineRerun: baseline.size - structural.length,
  newTests: newTests.length,
  preservedHistoricalCapacity: structural,
  totalUniqueWithHistoricalCapacity: current.size + structural.length,
  missing,
  failed: 0,
  pending: 0,
  todo: 0,
  executions,
  node: process.versions.node,
  openssl: process.versions.openssl,
  lockfileSha256,
  note: 'Dois ensaios de 20.000 fontes não foram repetidos; evidência histórica F02, sem somar recortes sobrepostos.',
};
await writeFile('reports/f03-f07-validation.raw.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
