/** Adapter IndexedDB real em Edge headless: reload, encerramento/reabertura do browser e duas conexões.
 * Não é teste de dispositivo nativo nem automação completa da interface comercial.
 */
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const esbuild = require('../../backend/node_modules/esbuild');
const browserPath =
  process.env.FINANCE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = resolve('.local/finance/c-edge-profile');
const port = 9339,
  sitePort = 9340;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function main() {
  mkdirSync(profile, { recursive: true });
  const bundle = await esbuild.build({
    entryPoints: ['src/lib/webIntentStore.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'LastroIntentStorage',
    platform: 'browser',
  });
  const html = `<html><body><h1>Lastro: validação local de IndexedDB</h1><script>${bundle.outputFiles[0].text}</script></body></html>`;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
  await new Promise((r) => server.listen(sitePort, '127.0.0.1', r));
  let browser, socket;
  let sequence = 0;
  const pending = new Map();
  async function connect() {
    browser = spawn(
      browserPath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${sitePort}`,
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      await delay(100);
      try {
        const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        target = tabs.find((t) => t.type === 'page' && t.url.includes(`:${sitePort}`));
      } catch {}
    }
    if (!target) throw new Error('Edge headless não disponibilizou página local');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, reject) => {
      socket.onopen = r;
      socket.onerror = reject;
    });
    socket.onmessage = (event) => {
      const data = JSON.parse(String(event.data));
      if (data.id) {
        const job = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) job?.reject(new Error(data.error.message));
        else job?.resolve(data.result);
      }
    };
    await waitReady();
  }
  function cdp(method, params = {}) {
    return new Promise((resolveJob, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve: resolveJob, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    return result.result.value;
  }
  async function waitReady() {
    for (let i = 0; i < 50; i++) {
      if (await evaluate('typeof LastroIntentStorage !== "undefined"')) return;
      await delay(100);
    }
    throw new Error('Adapter web não carregou');
  }
  async function shutdown() {
    const child = browser;
    const exited = new Promise((r) => child.once('exit', r));
    const requestId = ++sequence;
    socket.send(JSON.stringify({ id: requestId, method: 'Browser.close', params: {} }));
    await Promise.race([
      exited,
      delay(10000).then(() => {
        if (child.exitCode === null) child.kill();
      }),
    ]);
    socket.close();
  }
  try {
    await connect();
    const saved = await evaluate(`(async()=>{
      const s = LastroIntentStorage.createWebIntentStore();
      const body = {kind:'cancel-start',id:'order-web',orderId:'order-web',body:{disposition:'refund',expectedOrderVersion:3,expectedGuardVersion:5,reason:'Teste local de reinício'}};
      const canonical = v => Array.isArray(v) ? '['+v.map(canonical).join(',')+']' : v && typeof v === 'object' ? '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}' : JSON.stringify(v);
      const key=crypto.randomUUID();
      const row={scope:'web-user:web-tenant:finance-resolution:order-web',uid:'web-user',tenantId:'web-tenant',kind:'finance-resolution',resourceId:'order-web',intentId:key,key,fingerprint:canonical(body),body,status:'prepared',executionId:null,revision:null,fencingToken:null};
      await s.change('web-user:web-tenant',()=>[row]);return row;
    })()`);
    await cdp('Page.reload');
    await delay(250);
    await waitReady();
    const reload = await evaluate(
      "LastroIntentStorage.createWebIntentStore().read('web-user:web-tenant')",
    );
    if (reload[0]?.key !== saved.key || reload[0]?.fingerprint !== saved.fingerprint)
      throw new Error('Reload perdeu chave ou corpo');
    results.push({ name: 'Reload recupera chave e corpo no IndexedDB real', ok: true });
    const oldPid = browser.pid;
    await shutdown();
    await connect();
    const restart = await evaluate(
      "LastroIntentStorage.createWebIntentStore().read('web-user:web-tenant')",
    );
    if (oldPid === browser.pid || restart[0]?.key !== saved.key)
      throw new Error('Browser não reiniciou ou perdeu intenção');
    results.push({
      name: 'Novo processo Edge recupera intenção sem memória JavaScript anterior',
      ok: true,
    });
    const isolation = await evaluate(
      "Promise.all([LastroIntentStorage.createWebIntentStore().read('web-user:other-tenant'),LastroIntentStorage.createWebIntentStore().read('other-user:web-tenant')])",
    );
    if (isolation.some((rows) => rows.length))
      throw new Error('Isolamento de usuário/tenant falhou');
    results.push({ name: 'Outra conta ou empresa não lê partição anterior', ok: true });
    // Dois adapters/conexões reais exercitam serialização readwrite. Não substitui segurança do backend.
    const parallel = await evaluate(`(async()=>{
      const a=LastroIntentStorage.createWebIntentStore(),b=LastroIntentStorage.createWebIntentStore();
      const key=${JSON.stringify(saved.key)};
      await Promise.all([a.change('web-user:web-tenant',rows=>rows.map(r=>({...r,revision:1}))),b.change('web-user:web-tenant',rows=>rows.map(r=>({...r,fencingToken:2})))]);
      return a.read('web-user:web-tenant');
    })()`);
    if (
      parallel[0]?.revision !== 1 ||
      parallel[0]?.fencingToken !== 2 ||
      parallel[0]?.key !== saved.key
    )
      throw new Error('Transações perderam atualização');
    results.push({ name: 'Conexões concorrentes não perdem atualização nem chave', ok: true });
    const rejected = await evaluate(
      `(async()=>{try{await LastroIntentStorage.createWebIntentStore().change('web-user:web-tenant',rows=>[{...rows[0],body:{alterado:true}}]);return false;}catch{return true;}})()`,
    );
    if (!rejected) throw new Error('Payload divergente foi aceito');
    results.push({ name: 'Transação inválida aborta e preserva snapshot anterior', ok: true });
    const after = await evaluate(
      "LastroIntentStorage.createWebIntentStore().read('web-user:web-tenant')",
    );
    if (after[0]?.key !== saved.key || after[0]?.body.kind !== 'cancel-start')
      throw new Error('Abort corrompeu checkpoint');
  } finally {
    if (browser?.exitCode === null) await shutdown();
    server.close();
  }
  writeFileSync(
    'docs/evidence/finance-c-web-storage.json',
    JSON.stringify(
      {
        environment: 'Edge headless local com IndexedDB real',
        cases: results,
        passed: results.length,
        limitations: [
          'Harness do adapter real, não E2E completo da UI.',
          'Não valida Keychain/Keystore em dispositivo físico.',
          'Profile de teste isolado em .local/finance.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`${results.length}/${results.length} verificações web aprovadas.`);
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
