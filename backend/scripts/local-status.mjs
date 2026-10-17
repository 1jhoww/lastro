// Read-only readiness report for the local development environment. Never prints secret values.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parse } from 'dotenv';

const PROJECT = 'demo-lastro-phase-a';
const DEMO_EMAILS = [
  'platform.demo@lastro.invalid',
  'admin.demo@lastro.invalid',
  'vendedor.demo@lastro.invalid',
];
const PASSWORD_VARS = [
  'LASTRO_DEMO_PLATFORM_PASSWORD',
  'LASTRO_DEMO_ADMIN_PASSWORD',
  'LASTRO_DEMO_SELLER_PASSWORD',
];
const readEnv = (path) => (existsSync(path) ? parse(readFileSync(path)) : null);
const reachable = async (url, init) => {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(2000) });
    return response.ok ? response : null;
  } catch {
    return null;
  }
};

export async function localStatus({ DATA_DIR, BACKUP_DIR, hubInfo, readState, listBackups }) {
  let failures = 0;
  const line = (ok, text, hint) => {
    if (ok === false) failures++;
    console.log(`${ok === true ? '[ok]  ' : ok === false ? '[erro]' : '[info]'} ${text}`);
    if (ok === false && hint) console.log(`       ${hint}`);
  };
  console.log('Ambiente local do Lastro\n');

  const required = readFileSync('.node-version', 'utf8').trim();
  line(
    process.versions.node === required,
    `Node ${process.versions.node} (exigido ${required})`,
    'Use scripts/npm.ps1, que escolhe o runtime local em .cache/runtime.',
  );
  let java = false;
  try {
    const javaHome = process.env.JAVA_HOME ?? 'C:/Program Files/Java/jdk-21';
    const candidate = existsSync(join(javaHome, 'bin', 'java.exe'))
      ? join(javaHome, 'bin', 'java.exe')
      : 'java';
    execFileSync(candidate, ['-version'], { stdio: 'ignore' });
    java = true;
  } catch {
    /* reported below */
  }
  line(java, 'Java disponível para o Firestore Emulator', 'Instale o JDK 21.');

  const env = readEnv('.env');
  line(Boolean(env), 'backend/.env presente', 'Copy-Item .env.example .env');
  if (env) {
    line(
      (env.FIREBASE_MODE ?? 'emulator') === 'emulator' &&
        (env.FIREBASE_PROJECT_ID ?? PROJECT) === PROJECT,
      `backend/.env aponta para emuladores do projeto ${PROJECT}`,
      'Use FIREBASE_MODE=emulator e FIREBASE_PROJECT_ID=demo-lastro-phase-a.',
    );
    const missing = PASSWORD_VARS.filter((name) => !(env[name] ?? process.env[name]));
    line(
      missing.length === 0,
      'Senhas das contas demo configuradas (valores não exibidos)',
      `Defina em backend/.env: ${missing.join(', ')}`,
    );
  }
  const front = readEnv(resolve('../frontend/.env'));
  line(
    Boolean(front) &&
      front.EXPO_PUBLIC_FIREBASE_PROJECT_ID === PROJECT &&
      /^http:\/\/(127\.0\.0\.1|localhost):9099$/.test(
        front.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_URL ?? '',
      ),
    'frontend/.env usa o Auth Emulator do projeto demo',
    'No frontend: Copy-Item .env.example .env',
  );

  const metadata = join(DATA_DIR, 'firebase-export-metadata.json');
  if (existsSync(metadata))
    line(
      true,
      `Dados persistidos em ${DATA_DIR} (gravados em ${statSync(metadata).mtime.toLocaleString('pt-BR')})`,
    );
  else line(null, `Ainda não há dados persistidos em ${DATA_DIR}`);
  line(null, `${listBackups().length} backup(s) em ${BACKUP_DIR}`);

  const hub = await hubInfo();
  const state = readState();
  const running = Boolean(hub && state?.pid === hub.pid && state.projectId === PROJECT);
  line(running, 'Emuladores de desenvolvimento em execução', 'npm run emulators');
  if (hub && !running)
    line(
      false,
      'Há emuladores nas portas que não foram iniciados por "npm run emulators" (testes ou outra sessão)',
      'Encerre-os antes de iniciar o ambiente de desenvolvimento.',
    );
  if (running) {
    const lookup = await reachable(
      `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: DEMO_EMAILS }),
      },
    );
    const found = new Set(((lookup && (await lookup.json()).users) ?? []).map((u) => u.email));
    const absent = DEMO_EMAILS.filter((email) => !found.has(email));
    line(absent.length === 0, 'Contas demo existem no Auth Emulator', 'npm run seed:local');
    const query = await reachable(
      `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'tenants' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'name' },
                op: 'EQUAL',
                value: { stringValue: 'Distribuidora Demo Lastro' },
              },
            },
            limit: 1,
          },
        }),
      },
    );
    const tenant = query && (await query.json()).some((row) => row.document);
    line(
      Boolean(tenant),
      'Distribuidora Demo Lastro existe no Firestore Emulator',
      'npm run seed:local',
    );
  }
  line(
    Boolean(await reachable('http://127.0.0.1:3000/health/live')),
    'API em http://127.0.0.1:3000',
    'npm run dev',
  );
  line(
    null,
    `Frontend web: ${(await reachable('http://localhost:8081')) ? 'em execução em http://localhost:8081' : 'parado (no frontend: npm run web)'}`,
  );
  console.log(failures ? `\n${failures} pendência(s).` : '\nAmbiente pronto.');
  return failures ? 1 : 0;
}
