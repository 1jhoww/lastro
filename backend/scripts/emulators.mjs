import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, delimiter, dirname } from 'node:path';
const action = process.argv[2];
const withoutCapacity = process.argv.slice(3).includes('--without-capacity');
const filters = process.argv.slice(3).filter((value) => value !== '--without-capacity');
if (
  filters.some(
    (value) =>
      !/^tests\/(?:integration|security|concurrency)\/[A-Za-z0-9_.-]+\.test\.ts$/.test(value),
  )
)
  throw new Error('Filtros devem ser caminhos locais de testes emulados');
if (!['start', 'test'].includes(action)) throw new Error('Use start ou test');
const env = {
  ...process.env,
  CI: 'true',
  FIREBASE_CLI_DISABLE_TELEMETRY: 'true',
  FIREBASE_EMULATORS_PATH: resolve('.cache/emulators'),
  XDG_CONFIG_HOME: resolve('.cache/firebase-config'),
  FIREBASE_MODE: 'emulator',
  FIREBASE_PROJECT_ID: action === 'test' ? 'demo-lastro-tests' : 'demo-lastro-phase-a',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  STORAGE_BUCKET:
    action === 'test' ? 'demo-lastro-tests.appspot.com' : 'demo-lastro-phase-a.appspot.com',
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
mkdirSync('reports', { recursive: true });
const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
child.on('error', () => {
  console.error('Não foi possível iniciar os emuladores');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
