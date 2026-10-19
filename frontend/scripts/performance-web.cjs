// Synthetic lab observations; these numbers are not field Core Web Vitals.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const stage = process.argv[2];
if (!['before', 'after'].includes(stage)) throw new Error('Use before or after');
const output = path.resolve('../docs/audits/evidence/fase9');
const authenticated = process.argv.includes('--authenticated');
const samples = [];
async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox'],
  });
  try {
    for (const profile of ['desktop', 'mobile'])
      for (let run = 0; run < 3; run++) {
        const context = await browser.newContext({
          viewport:
            profile === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 800 },
        });
        if (authenticated) {
          // Replay the unchanged export against the isolated copy of the demo Auth database.
          await context.route('http://127.0.0.1:9099/**', (route) =>
            route.continue({
              url: route.request().url().replace('127.0.0.1:9099', '127.0.0.1:19099'),
            }),
          );
        }
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile === 'mobile' ? 4 : 1 });
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: profile === 'mobile' ? 150 : 0,
          downloadThroughput: profile === 'mobile' ? 200000 : -1,
          uploadThroughput: profile === 'mobile' ? 93750 : -1,
        });
        const requests = [];
        const pendingApi = new Set();
        let lastApiEnd = 0;
        page.on('request', (request) => {
          if (request.url().includes('/api/v1/')) pendingApi.add(request);
        });
        const complete = (request) => {
          if (request.url().includes('/api/v1/')) {
            pendingApi.delete(request);
            lastApiEnd = performance.now();
          }
        };
        page.on('requestfinished', complete);
        page.on('requestfailed', complete);
        const settleApi = async () => {
          const deadline = performance.now() + 30000;
          do {
            await page.waitForTimeout(100);
            if (performance.now() > deadline)
              throw new Error('API did not settle within 30 seconds');
          } while (pendingApi.size || performance.now() - lastApiEnd < 750);
        };
        page.on('response', (response) => {
          if (response.url().includes('/api/v1/'))
            requests.push({
              path: new URL(response.url()).pathname + new URL(response.url()).search,
              status: response.status(),
            });
        });
        await page.addInitScript(() => {
          window.__lab = { lcp: null, longTasks: [], cls: 0 };
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) window.__lab.lcp = entry.startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) window.__lab.longTasks.push(entry.duration);
          }).observe({ type: 'longtask', buffered: true });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              if (!entry.hadRecentInput) window.__lab.cls += entry.value;
          }).observe({ type: 'layout-shift', buffered: true });
        });
        const start = performance.now();
        await page.goto('http://localhost:8081/entrar', { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor();
        const readyMs = performance.now() - start;
        await page.waitForTimeout(500);
        const metrics = await page.evaluate(() => ({
          ...window.__lab,
          paints: performance
            .getEntriesByType('paint')
            .map((e) => ({ name: e.name, ms: e.startTime })),
          resources: performance.getEntriesByType('resource').map((e) => ({
            name: new URL(e.name).pathname,
            transferSize: e.transferSize,
            decodedBodySize: e.decodedBodySize,
            duration: e.duration,
          })),
          heapBytes: performance.memory?.usedJSHeapSize ?? null,
        }));
        const sample = {
          profile,
          run,
          cache: 'cold',
          cpuRate: profile === 'mobile' ? 4 : 1,
          latencyMs: profile === 'mobile' ? 150 : 0,
          downloadBytesPerSecond: profile === 'mobile' ? 200000 : null,
          readyMs,
          ...metrics,
        };
        if (authenticated) {
          const { parse } = require('../../backend/node_modules/dotenv');
          const credentials = parse(fs.readFileSync('../backend/.env'));
          await page.getByRole('textbox', { name: 'E-mail' }).fill('admin.demo@lastro.invalid');
          await page.locator('input[type="password"]').fill(credentials.LASTRO_DEMO_ADMIN_PASSWORD);
          requests.length = 0;
          const loginStart = performance.now();
          await page.getByRole('button', { name: 'Entrar', exact: true }).click();
          await page.getByText('Pedidos em aberto', { exact: true }).waitFor({ timeout: 30000 });
          sample.loginShellMs = performance.now() - loginStart;
          await settleApi();
          sample.loginDashboardMs = Math.max(sample.loginShellMs, lastApiEnd - loginStart);
          sample.dashboardRequests = [...requests];
          const before = requests.length;
          const navigationStart = performance.now();
          await page.goto('http://localhost:8081/clientes');
          await page.getByLabel('Buscar clientes', { exact: true }).waitFor();
          await settleApi();
          sample.customerPageMs = lastApiEnd - navigationStart;
          sample.customerRequests = requests.slice(before);
          const filterStart = performance.now();
          const filtered = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === '/api/v1/customers' &&
              new URL(response.url()).searchParams.get('q') === 'zzfase9',
          );
          await page.getByLabel('Buscar clientes', { exact: true }).fill('zzfase9');
          await filtered;
          await settleApi();
          sample.customerFilterMs = lastApiEnd - filterStart;
        }
        samples.push(sample);
        console.log(
          JSON.stringify({
            profile,
            run,
            readyMs: Math.round(readyMs),
            lcp: metrics.lcp,
            loginDashboardMs: sample.loginDashboardMs,
          }),
        );
        await context.close();
      }
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, `web-${stage}${authenticated ? '-authenticated' : ''}.json`),
      JSON.stringify({ stage, browser: browser.version(), observations: samples }, null, 2),
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
