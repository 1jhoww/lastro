import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';
const listener = createServer();
await new Promise((resolve, reject) => {
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', resolve);
});
const address = listener.address();
if (!address || typeof address === 'string') throw new Error('Porta local indisponível');
const port = address.port;
await new Promise((resolve) => listener.close(resolve));
const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(port),
  FIREBASE_MODE: 'emulator',
  FIREBASE_PROJECT_ID: 'demo-lastro-tests',
  STORAGE_BUCKET: 'demo-lastro-tests.appspot.com',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  TRUST_PROXY_HOPS: '0',
  TRUST_PROXY_ADDRESSES: '',
};
delete env.FIREBASE_TOKEN;
delete env.GOOGLE_APPLICATION_CREDENTIALS;
let output = '';
const child = spawn(process.execPath, ['dist/src/app/server.js'], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
});
const stopped = new Promise((resolve) => child.once('exit', resolve));
try {
  const deadline = Date.now() + 15_000;
  let live;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      live = await fetch(`http://127.0.0.1:${port}/health/live`, {
        signal: AbortSignal.timeout(1000),
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (live?.status !== 200) throw new Error('Servidor compilado não iniciou');
  const ready = await fetch(`http://127.0.0.1:${port}/health/ready`, {
    signal: AbortSignal.timeout(2000),
  });
  if (ready.status !== 200) throw new Error('Dependência emulada não está pronta');
  const result = {
    live: live.status,
    ready: ready.status,
    port,
    node: process.versions.node,
    compiledStartup: output.includes('server.started'),
    mode: 'emulator',
    project: 'demo-lastro-tests',
  };
  await writeFile('reports/f03-f07-server-smoke.raw.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  child.kill('SIGTERM');
  await stopped;
}
