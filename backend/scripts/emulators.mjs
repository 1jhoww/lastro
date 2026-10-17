import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { setInterval, clearInterval, setTimeout } from 'node:timers';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve, delimiter, dirname, join } from 'node:path';
const [action, ...rest] = process.argv.slice(2);
const actions = ['start', 'test', 'stop', 'export', 'restore', 'status'];
if (!actions.includes(action)) throw new Error(`Use ${actions.join(', ')}`);

// Local development state. Everything lives under the ignored .local directory.
const DEV_PROJECT = 'demo-lastro-phase-a';
const DATA_DIR = resolve('.local/emulator-data');
const BACKUP_DIR = resolve('.local/emulator-backups');
const STATE_FILE = resolve('.local/emulators.json');
const STOP_FLAG = resolve('.local/emulators.stopping');
const METADATA = 'firebase-export-metadata.json';
const HUB = 'http://127.0.0.1:4400';
const STARTUP_BACKUPS_KEPT = 10;
const hasExport = (dir) => existsSync(join(dir, METADATA));
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const backupName = (suffix) => `${stamp()}-${suffix}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function hubInfo() {
  try {
    const response = await fetch(`${HUB}/`, { signal: AbortSignal.timeout(2000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
const portOpen = (port) =>
  new Promise((done) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => done(socket.end() && true));
    socket.once('error', () => done(false));
  });
function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}
/** Running development hub, only when this launcher started it for the demo project. */
async function devHub() {
  const [hub, state] = [await hubInfo(), readState()];
  if (!hub) return null;
  if (!state || state.projectId !== DEV_PROJECT || state.pid !== hub.pid)
    throw new Error(
      'Há emuladores em execução que não foram iniciados por "npm run emulators" (ex.: suíte de integração). Nada foi exportado.',
    );
  return hub;
}
async function exportTo(path, initiatedBy) {
  const response = await fetch(`${HUB}/_admin/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, initiatedBy }),
  });
  if (!response.ok)
    throw new Error(`Exportação falhou (${response.status}): ${await response.text()}`);
}
function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((name) => hasExport(join(BACKUP_DIR, name)))
    .sort();
}

if (action === 'stop') {
  if (!(await devHub())) {
    console.log('Emuladores de desenvolvimento não estão em execução.');
    process.exit(0);
  }
  const { pid } = readState();
  console.log(`Salvando dados em ${DATA_DIR}...`);
  await exportTo(DATA_DIR, 'stop');
  writeFileSync(STOP_FLAG, String(pid));
  // The export above is the durable copy. The Java emulators outlive their CLI, so the whole
  // process tree ends together.
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  else process.kill(pid);
  for (let i = 0; i < 40 && ((await hubInfo()) || (await portOpen(8080))); i++) await sleep(250);
  console.log('Emuladores encerrados com os dados salvos.');
  process.exit(0);
}
if (action === 'export') {
  if (!(await devHub())) throw new Error('Inicie os emuladores com "npm run emulators" antes.');
  const label = rest[0] ? `manual-${rest[0].replace(/[^A-Za-z0-9_-]/g, '')}` : 'manual';
  const target = join(BACKUP_DIR, backupName(label));
  await exportTo(DATA_DIR, 'manual');
  mkdirSync(BACKUP_DIR, { recursive: true });
  cpSync(DATA_DIR, target, { recursive: true });
  console.log(`Dados salvos em ${DATA_DIR}\nBackup: ${target}`);
  process.exit(0);
}
if (action === 'restore') {
  const backups = listBackups();
  if (!rest[0]) {
    console.log(
      backups.length
        ? `Backups disponíveis:\n${backups.map((b) => `  ${b}`).join('\n')}\nUse: npm run emulators:restore -- <nome>`
        : 'Nenhum backup encontrado.',
    );
    process.exit(0);
  }
  if (await hubInfo()) throw new Error('Encerre os emuladores ("npm run emulators:stop") antes.');
  if (!backups.includes(rest[0])) throw new Error(`Backup "${rest[0]}" não encontrado.`);
  mkdirSync(BACKUP_DIR, { recursive: true });
  if (existsSync(DATA_DIR)) {
    // The replaced data is kept as a backup, never deleted.
    const previous = join(BACKUP_DIR, backupName('antes-restauracao'));
    renameSync(DATA_DIR, previous);
    console.log(`Dados atuais preservados em ${previous}`);
  }
  cpSync(join(BACKUP_DIR, rest[0]), DATA_DIR, { recursive: true });
  console.log(`Backup ${rest[0]} restaurado. Inicie com "npm run emulators".`);
  process.exit(0);
}
if (action === 'status') {
  const { localStatus } = await import('./local-status.mjs');
  process.exitCode = await localStatus({ DATA_DIR, BACKUP_DIR, hubInfo, readState, listBackups });
  process.exit();
}

const withoutCapacity = rest.includes('--without-capacity');
const filters = rest.filter((value) => value !== '--without-capacity');
if (action === 'start' && rest.length) throw new Error('start não aceita argumentos');
if (
  filters.some(
    (value) =>
      !/^tests\/(?:integration|security|concurrency)\/[A-Za-z0-9_.-]+\.test\.ts$/.test(value),
  )
)
  throw new Error('Filtros devem ser caminhos locais de testes emulados');
const env = {
  ...process.env,
  CI: 'true',
  FIREBASE_CLI_DISABLE_TELEMETRY: 'true',
  FIREBASE_EMULATORS_PATH: resolve('.cache/emulators'),
  XDG_CONFIG_HOME: resolve('.cache/firebase-config'),
  FIREBASE_MODE: 'emulator',
  FIREBASE_PROJECT_ID: action === 'test' ? 'demo-lastro-tests' : DEV_PROJECT,
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  STORAGE_BUCKET:
    action === 'test' ? 'demo-lastro-tests.appspot.com' : `${DEV_PROJECT}.appspot.com`,
  ...(action === 'test' ? { NODE_ENV: 'test', RATE_LIMIT_MAX: '1000' } : {}),
};
mkdirSync(env.FIREBASE_EMULATORS_PATH, { recursive: true });
mkdirSync('.local', { recursive: true });
if (
  process.platform === 'win32' &&
  !env.JAVA_HOME &&
  existsSync('C:/Program Files/Java/jdk-21/bin/java.exe')
)
  env.JAVA_HOME = 'C:/Program Files/Java/jdk-21';
const originalPath = process.env.PATH ?? process.env.Path ?? '';
delete env.Path;
env.PATH = [
  env.JAVA_HOME ? resolve(env.JAVA_HOME, 'bin') : '',
  dirname(process.execPath),
  originalPath,
]
  .filter(Boolean)
  .join(delimiter);
if (process.platform === 'win32')
  env.JAVA_TOOL_OPTIONS =
    `${env.JAVA_TOOL_OPTIONS ?? ''} "-Djdk.net.unixdomain.tmpdir=${resolve('.local')}"`.trim();
delete env.FIREBASE_TOKEN;
delete env.GOOGLE_APPLICATION_CREDENTIALS;
const args = [
  'node_modules/firebase-tools/lib/bin/firebase.js',
  '--project',
  env.FIREBASE_PROJECT_ID,
  action === 'test' ? 'emulators:exec' : 'emulators:start',
  '--only',
  'auth,firestore,storage',
];
if (action === 'test')
  args.push(
    `node node_modules/vitest/vitest.mjs run --project emulator --reporter=default --reporter=json --outputFile=reports/emulator-tests.raw.json ${withoutCapacity ? '--exclude tests/integration/financialExecutionCapacity.test.ts' : ''} ${filters.join(' ')}`,
  );
if (action === 'start') {
  // Development data survives restarts: restored on start, saved on clean exit and periodically.
  // Tests never use this directory; their project is cleared before each case.
  if (hasExport(DATA_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    cpSync(DATA_DIR, join(BACKUP_DIR, backupName('inicio')), { recursive: true });
    // Only automatic startup copies rotate; manual backups are never removed.
    const startups = listBackups().filter((name) => name.endsWith('-inicio'));
    for (const old of startups.slice(0, -STARTUP_BACKUPS_KEPT))
      rmSync(join(BACKUP_DIR, old), { recursive: true });
    args.push('--import', DATA_DIR);
    console.log(`[lastro] Restaurando dados de ${DATA_DIR}`);
  } else if (existsSync(DATA_DIR) && readdirSync(DATA_DIR).length)
    throw new Error(
      `${DATA_DIR} existe sem exportação válida. Restaure um backup ("npm run emulators:restore") ou mova a pasta.`,
    );
  else console.log('[lastro] Primeira execução: iniciando sem dados salvos.');
  args.push('--export-on-exit', DATA_DIR);
  rmSync(STOP_FLAG, { force: true });
}
mkdirSync('reports', { recursive: true });
const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
child.on('error', () => {
  console.error('Não foi possível iniciar os emuladores');
  process.exitCode = 1;
});
let autosave;
if (action === 'start') {
  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      pid: child.pid,
      projectId: DEV_PROJECT,
      dataDir: DATA_DIR,
      startedAt: new Date(),
    }),
  );
  // Ctrl+C reaches the Firebase CLI directly. This launcher must outlive it: on Windows its exit
  // would terminate the CLI before --export-on-exit finishes writing.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'])
    process.on(signal, () => clearInterval(autosave));
  const minutes = Number(process.env.EMULATOR_AUTOSAVE_MINUTES ?? 5);
  if (minutes > 0) {
    let saving = false;
    autosave = setInterval(async () => {
      if (saving || (await hubInfo())?.pid !== child.pid) return;
      saving = true;
      try {
        await exportTo(DATA_DIR, 'autosave');
      } catch (error) {
        console.error(`[lastro] Autosave falhou: ${error.message}`);
      } finally {
        saving = false;
      }
    }, minutes * 60_000);
  }
}
child.on('exit', (code) => {
  clearInterval(autosave);
  if (action === 'start') {
    rmSync(STATE_FILE, { force: true });
    if (existsSync(STOP_FLAG)) {
      rmSync(STOP_FLAG, { force: true });
      console.log(`[lastro] Emuladores encerrados; dados salvos em ${DATA_DIR}`);
      process.exitCode = 0;
      return;
    }
    if (hasExport(DATA_DIR))
      console.log(
        `[lastro] Dados salvos em ${DATA_DIR} (última gravação: ${statSync(join(DATA_DIR, METADATA)).mtime.toLocaleString('pt-BR')})`,
      );
  }
  process.exitCode = code ?? 1;
});
