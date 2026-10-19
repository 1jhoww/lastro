const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { parse } = require('../../backend/node_modules/dotenv');
const output = path.resolve('../docs/audits/evidence/fase9');
const credentials = parse(fs.readFileSync('../backend/.env'));
async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox'],
  });
  const results = {
    browser: browser.version(),
    conditions: 'Chrome desktop, 390 CSS px; no native keyboard or TalkBack',
    observations: [],
  };
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('http://127.0.0.1:9099/**', (route) =>
      route.continue({ url: route.request().url().replace('127.0.0.1:9099', '127.0.0.1:19099') }),
    );
    const page = await context.newPage();
    await page.goto('http://localhost:8081/entrar');
    await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor();
    const focus = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      focus.push(
        await page.evaluate(() => ({
          tag: document.activeElement.tagName,
          name:
            document.activeElement.getAttribute('aria-label') || document.activeElement.textContent,
          type: document.activeElement.getAttribute('type'),
        })),
      );
    }
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const errors = await page.locator('input[aria-invalid="true"]').count();
    results.observations.push({
      check: 'login-focus-and-required-fields',
      focus,
      invalidFields: errors,
      passed: errors === 2,
    });
    await page.getByRole('textbox', { name: 'E-mail' }).fill('admin.demo@lastro.invalid');
    await page.locator('input[type="password"]').fill(credentials.LASTRO_DEMO_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL('http://localhost:8081/');
    for (const route of ['/clientes/novo', '/pedidos/novo', '/meu-perfil']) {
      await page.goto('http://localhost:8081' + route);
      await page.waitForLoadState('networkidle');
      const fields = await page
        .locator('input')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            type: node.type,
            label: node.getAttribute('aria-label'),
            labelledby: node.getAttribute('aria-labelledby'),
            inputmode: node.getAttribute('inputmode'),
          })),
        );
      const buttons = await page.getByRole('button').allTextContents();
      results.observations.push({
        check: 'rendered-form',
        route,
        fields,
        buttons,
        overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      });
    }
    const edit = page.getByRole('button', { name: 'Editar nome', exact: true });
    await edit.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Seu nome', exact: true });
    await dialog.waitFor();
    await page.waitForTimeout(500);
    await page.getByRole('textbox', { name: 'Nome e sobrenome' }).fill('A');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    const invalidName = await page
      .getByRole('textbox', { name: 'Nome e sobrenome' })
      .getAttribute('aria-invalid');
    const modalFocus = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      modalFocus.push(
        await page.evaluate(() => ({
          name:
            document.activeElement.getAttribute('aria-label') || document.activeElement.textContent,
          hiddenAncestor: !!document.activeElement.closest('[aria-hidden="true"]'),
        })),
      );
    }
    await page.screenshot({ path: path.join(output, 'name-dialog-390.png') });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    results.observations.push({
      check: 'name-modal',
      invalidName,
      modalFocus,
      escapeCloses: true,
      focusReturnsToEdit: await edit.evaluate((node) => node === document.activeElement),
    });
    const fontNames = await page.evaluate(() =>
      [...document.fonts].map((font) => ({ family: font.family, status: font.status })),
    );
    results.observations.push({ check: 'woff2-fonts-loaded', fonts: fontNames });
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'accessibility-web.json'), JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
