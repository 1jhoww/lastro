import { screen, waitFor } from 'expo-router/testing-library';
import CompanySettings from '@/app/(app)/configuracoes/empresa';
import Settings from '@/app/(app)/configuracoes/index';
import PublicRoute from '@/app/catalogo/[slug]';
import { logoVersion } from '@/features/publicCatalog/StorefrontHeader';
import { createFakeApi, membership, ok, page, tenant } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const overrides = {
  '(app)/configuracoes/empresa': CompanySettings,
  '(app)/configuracoes/index': Settings,
  'catalogo/[slug]/index': PublicRoute,
};
const logo = { id: 'l1', contentType: 'image/webp', sizeBytes: 10, width: 900, height: 300 };

/** Company on Essencial: the server already filtered branding and catalog permissions out. */
function essencial(withLogo = false) {
  const admin = membership('t1', 'administrator');
  const m = {
    ...admin,
    permissions: admin.permissions.filter((p) => p !== 'branding:manage' && p !== 'catalog:manage'),
    plan: { code: 'essencial', name: 'Essencial', userLimit: 1, features: [] },
  };
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({ uid: 'u1', email: 'ana@lastro.test', platformAdmin: false, memberships: [m] }),
    )
    .on('GET', '/api/v1/tenants/current', () =>
      ok({ ...tenant('t1', 'Lady Pets Distribuidora'), logo: withLogo ? logo : null }),
    )
    .on('GET', '/api/v1/tenants/current/logo', () => ({ status: 200, body: undefined }));
  return { gateway, server };
}

describe('Plano Essencial: identidade visual', () => {
  it('sem botão de envio, com indicação discreta do Profissional; nome continua editável', async () => {
    const { gateway, server } = essencial();
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/empresa',
      overrides,
    });
    expect(await screen.findByLabelText('Nome da empresa')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Adicionar logotipo' })).toBeNull();
    expect(
      screen.getByText(
        'Logotipo nos pedidos, romaneios e no catálogo: disponível no plano Profissional.',
      ),
    ).toBeTruthy();
  });
  it('logotipo guardado após downgrade: mantido, removível, sem substituição', async () => {
    const { gateway, server } = essencial(true);
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/empresa',
      overrides,
    });
    expect(
      await screen.findByText(
        'Logotipo guardado. Ele volta aos pedidos, romaneios e ao catálogo no plano Profissional.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remover' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Substituir' })).toBeNull();
  });
  it('configurações indicam o catálogo como recurso do Profissional, sem link', async () => {
    const { gateway, server } = essencial();
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/configuracoes', overrides });
    expect(
      await screen.findByText(
        'Vitrine com sua marca e orçamento por WhatsApp. Disponível no plano Profissional.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Catálogo público/ })).toBeNull();
  });
});

describe('Catálogo público: identidade da distribuidora com o Lastro', () => {
  function storefront(profileLogo: object | null) {
    const gateway = new FakeGateway({ initialUser: null });
    const server = createFakeApi()
      .on('GET', '/api/v1/public/catalogs/lady-pets-distribuidora', () =>
        ok({
          slug: 'lady-pets-distribuidora',
          tradeName: 'Lady Pets Distribuidora',
          description: 'Tudo para pet shops',
          whatsappNumber: '5511999999999',
          showPrices: true,
          logo: profileLogo,
        }),
      )
      .on('GET', '/api/v1/public/catalogs/lady-pets-distribuidora/products', () => ok(page([])))
      .on('GET', '/api/v1/public/catalogs/lady-pets-distribuidora/categories', () => ok(page([])))
      .on('GET', '/api/v1/public/catalogs/lady-pets-distribuidora/logo', () => ({
        status: 200,
        body: undefined,
      }));
    return { gateway, server };
  }
  it('com logotipo: busca a versão publicada e mantém a assinatura do Lastro', async () => {
    const { gateway, server } = storefront({
      path: '/api/v1/public/catalogs/lady-pets-distribuidora/logo?v=l1',
      width: 900,
      height: 300,
    });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/catalogo/lady-pets-distribuidora',
      overrides,
    });
    expect(await screen.findByRole('header', { name: 'Lady Pets Distribuidora' })).toBeTruthy();
    expect(screen.getByText('Vitrine digital')).toBeTruthy();
    await waitFor(() =>
      expect(
        server.calls.find((c) => c.path === '/api/v1/public/catalogs/lady-pets-distribuidora/logo')
          ?.query,
      ).toEqual({ v: 'l1' }),
    );
    // Public requests never carry the session or the company header.
    const call = server.calls.find((c) => c.path.endsWith('/logo'))!;
    expect(call.headers.authorization).toBeUndefined();
    expect(call.headers['x-tenant-id']).toBeUndefined();
  });
  it('sem logotipo (ou plano sem identidade visual): só o nome, sem pedir imagem', async () => {
    const { gateway, server } = storefront(null);
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/catalogo/lady-pets-distribuidora',
      overrides,
    });
    expect(await screen.findByRole('header', { name: 'Lady Pets Distribuidora' })).toBeTruthy();
    expect(screen.getByText('Vitrine digital')).toBeTruthy();
    expect(server.calls.some((c) => c.path.endsWith('/logo'))).toBe(false);
  });
  it('só aceita o caminho de logotipo do próprio catálogo', () => {
    expect(logoVersion('a', '/api/v1/public/catalogs/a/logo?v=abc')).toBe('abc');
    expect(logoVersion('a', '/api/v1/public/catalogs/b/logo?v=abc')).toBeUndefined();
    expect(logoVersion('a', 'https://evil.example/logo?v=abc')).toBeUndefined();
    expect(logoVersion('a', '/api/v1/public/catalogs/a/logo?v=../x')).toBeUndefined();
    expect(logoVersion('a', undefined)).toBeUndefined();
  });
});
