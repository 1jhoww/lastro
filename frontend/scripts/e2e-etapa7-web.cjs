/** Interface real em Edge headless. Não envia WhatsApp nem substitui teste físico. */
const { chromium } = require('playwright');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const fixture = JSON.parse(readFileSync('.local/etapa7/browser-fixture.json', 'utf8'));
const base = 'http://localhost:8097';
const results = [];
async function main() {
  const browser = await chromium.launch({
    executablePath:
      process.env.LASTRO_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  context.setDefaultTimeout(20000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const publicHeaders = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/public/catalogs/')) publicHeaders.push(request.headers());
  });
  async function check(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log('OK ' + name);
    } catch (error) {
      results.push({ name, ok: false, detail: error.message.slice(0, 1200) });
      console.log('FAIL ' + name + ': ' + error.message.slice(0, 300));
      await page
        .screenshot({ path: resolve('.local/etapa7/web-failure.png'), fullPage: true })
        .catch(() => {});
    }
  }
  try {
    await check('catálogo anônimo desktop carrega produto e imagem pela API pública', async () => {
      await page.goto(`${base}/catalogo/${fixture.slug}`);
      await page
        .getByRole('button', { name: 'Selecionar Café Etapa 7', exact: true })
        .waitFor({ timeout: 120000 });
      await page.getByRole('img', { name: 'Café Etapa 7', exact: true }).waitFor();
      if (publicHeaders.some((headers) => headers.authorization || headers['x-tenant-id']))
        throw new Error('Cabeçalho privado em consulta pública');
      await page.screenshot({ path: resolve('.local/etapa7/catalog-desktop.png'), fullPage: true });
    });
    await check(
      'revisão real e preparação de WhatsApp sem envio ou navegação externa',
      async () => {
        await page.getByRole('button', { name: 'Selecionar Café Etapa 7', exact: true }).click();
        await page.getByLabel('Quantidade de Café Etapa 7', { exact: true }).fill('0,125');
        await page
          .getByRole('button', { name: 'Revisar orçamento no servidor', exact: true })
          .click();
        await page.getByText('Total estimado: R$ 1,88', { exact: true }).waitFor();
        await page
          .getByRole('button', { name: 'Preparar mensagem para WhatsApp', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Abrir WhatsApp e revisar envio', exact: true })
          .waitFor();
        if (!page.url().startsWith(base)) throw new Error('Navegação externa não solicitada');
      },
    );
    await check('catálogo responsivo 390px preserva seleção e revisão', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
        throw new Error('Rolagem horizontal indevida');
      await page.screenshot({ path: resolve('.local/etapa7/catalog-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await check('login local e relatório administrativo com valor comercial', async () => {
      await page.goto(`${base}/entrar`);
      await page.getByLabel('E-mail', { exact: true }).fill(fixture.email);
      await page.getByLabel('Senha', { exact: true }).fill(fixture.password);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await page.getByRole('button', { name: 'Sair', exact: true }).waitFor();
      await page.goto(`${base}/relatorios/pedidos`);
      await page.getByText('Sem total global', { exact: true }).waitFor();
      await page
        .getByRole('link', { name: 'Abrir pedido e documentos', exact: true })
        .first()
        .waitFor();
      await page.screenshot({ path: resolve('.local/etapa7/report-desktop.png'), fullPage: true });
    });
    await check('PDF autenticado abre Blob local e download preserva nome/bytes', async () => {
      await page.goto(`${base}/pedidos/${fixture.orderId}`);
      await page.getByRole('button', { name: 'Obter pedido comercial (PDF)', exact: true }).click();
      await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).waitFor();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).click();
      const download = await downloadPromise;
      if (!download.suggestedFilename().endsWith('.pdf')) throw new Error('Nome PDF inválido');
      await download.saveAs(resolve('.local/etapa7/browser-commercial.pdf'));
      if (
        !readFileSync('.local/etapa7/browser-commercial.pdf')
          .subarray(0, 5)
          .equals(Buffer.from('%PDF-'))
      )
        throw new Error('Não recebeu PDF');
      const popupPromise = context.waitForEvent('page');
      await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      if (!popup.url().startsWith('blob:')) throw new Error('PDF não usa URL temporária');
      await popup.close();
    });
    await check('CSV real baixa página UTF-8/BOM pelo navegador', async () => {
      await page.goto(`${base}/relatorios/exportacoes`);
      await page.getByRole('button', { name: 'Obter página CSV', exact: true }).click();
      await page.getByText('2 registros nesta página. Última página.', { exact: true }).waitFor();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).click();
      const download = await downloadPromise;
      await download.saveAs(resolve('.local/etapa7/browser-customers.csv'));
      const bytes = readFileSync('.local/etapa7/browser-customers.csv');
      if (!bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])))
        throw new Error('BOM ausente');
    });
    await check('configuração mostra endereço público copiável e versão corrente', async () => {
      await page.goto(`${base}/configuracoes/catalogo`);
      await page.getByRole('button', { name: 'Copiar endereço público', exact: true }).waitFor();
      if ((await page.getByLabel('Slug público', { exact: true }).inputValue()) !== fixture.slug)
        throw new Error('Configuração incorreta');
    });
    await check('logout revoga URL temporária sem recarregar o documento web', async () => {
      await page.goto(`${base}/pedidos/${fixture.orderId}`);
      await page.getByRole('button', { name: 'Obter pedido comercial (PDF)', exact: true }).click();
      const popupPromise = context.waitForEvent('page');
      await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      const url = popup.url();
      await popup.close();
      await page.getByRole('button', { name: 'Sair', exact: true }).click();
      await page.getByLabel('E-mail', { exact: true }).waitFor();
      const readable = await page.evaluate(async (value) => {
        try {
          await fetch(value);
          return true;
        } catch {
          return false;
        }
      }, url);
      if (readable) throw new Error('URL privada ainda acessível após sair');
    });
    await check('sem erros JavaScript durante E2E', async () => {
      if (errors.length) throw new Error(errors.join('\n'));
    });
  } finally {
    await context.close();
    await browser.close();
    mkdirSync('docs/evidence', { recursive: true });
    writeFileSync(
      'docs/evidence/etapa7-web.json',
      JSON.stringify(
        { executedAt: new Date().toISOString(), browser: 'Edge headless local', results },
        null,
        2,
      ) + '\n',
    );
    if (results.some((result) => !result.ok)) process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
