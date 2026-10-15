import { Pressable, Text } from 'react-native';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { router, type Href } from 'expo-router';
import Reports from '@/app/(app)/relatorios';
import OrderReport from '@/app/(app)/relatorios/pedidos';
import ExportScreen from '@/app/(app)/relatorios/exportacoes';
import CatalogSettings from '@/app/(app)/configuracoes/catalogo';
import PublicRoute from '@/app/catalogo/[slug]';
import { useSession } from '@/session/SessionContext';
import { intentLedger, intentScope } from '@/lib/intent';
import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { FakeGateway } from '../support/fakeGateway';
import { createFakeApi, fail, membership, ok, order, page } from '../support/fakeApi';
import { renderApp } from '../support/renderApp';
const profile = {
  slug: 'teste',
  tradeName: 'Loja pública',
  description: 'Catálogo de teste',
  whatsappNumber: '5511999999999',
  showPrices: true,
};
const item = {
  id: 'p1',
  name: 'Café público',
  description: 'Somente informação pública',
  unit: 'KG',
  quantityPrecision: 3,
  category: null,
  unitPriceCents: 1500,
  imagePath: null,
};
const preview = {
  catalog: profile,
  lines: [
    {
      productId: 'p1',
      name: 'Café vigente',
      unit: 'KG',
      quantity: '0.125',
      unitPriceCents: 1500,
      subtotalCents: 188,
    },
  ],
  currency: 'BRL',
  totalEstimatedCents: 188,
  kind: 'quote_request',
  confirmedOrder: false,
  reviewToken: 'a'.repeat(64),
};
const overrides = {
  '(app)/relatorios/index': Reports,
  '(app)/relatorios/pedidos': OrderReport,
  '(app)/relatorios/exportacoes': ExportScreen,
  '(app)/configuracoes/catalogo': CatalogSettings,
  'catalogo/[slug]/index': PublicRoute,
};
function world(
  role: 'administrator' | 'seller' = 'administrator',
  platformAdmin = false,
  signedIn = true,
) {
  const gateway = new FakeGateway({
    initialUser: signedIn ? { uid: 'u1', email: 'user@lastro.test', emailVerified: true } : null,
  });
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'user@lastro.test',
        platformAdmin,
        memberships: [membership('t1', role)],
      }),
    )
    .on('GET', '/api/v1/orders', () =>
      ok(page([order('o1', { totalCents: 12345, status: 'confirmed' })])),
    )
    .on('GET', '/api/v1/catalog-settings', () => ok({ catalog: null }))
    .on('GET', '/api/v1/public/catalogs/teste', () => ok(profile))
    .on('GET', '/api/v1/public/catalogs/teste/products', () => ok(page([item])))
    .on('GET', '/api/v1/public/catalogs/teste/products/p1', () => ok(item))
    .on('GET', '/api/v1/public/catalogs/teste/categories', () => ok(page([])))
    .on('POST', '/api/v1/public/catalogs/teste/quote-preview', () => ok(preview));
  return { gateway, server };
}
beforeEach(() => intentLedger.reset());
it('configuração pendente de catálogo não vira alerta de intenção financeira', async () => {
  const { gateway, server } = world();
  await intentLedger.prepare(intentScope('u1', 't1', 'catalog-setting', 'catalog'), {
    expectedVersion: 0,
    slug: 'catalogo-pendente',
  });
  function FinanceProbe() {
    return (
      <FinanceAccess>
        <Text>Financeiro preservado</Text>
      </FinanceAccess>
    );
  }
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/relatorios',
    overrides: { ...overrides, '(app)/relatorios/index': FinanceProbe },
  });
  await screen.findByText('Financeiro preservado');
  expect(screen.queryByText('Intenções financeiras recuperadas')).toBeNull();
});
it.each([
  '/relatorios',
  '/relatorios/pedidos',
  '/relatorios/exportacoes',
  '/configuracoes/catalogo',
])('vendedor não acessa rota administrativa %s', async (initialUrl) => {
  const { gateway, server } = world('seller');
  await renderApp({ gateway, fetch: server.fetch, initialUrl, overrides });
  await screen.findByText(/acesso/i);
  expect(server.calls.filter((call) => call.path !== '/api/v1/me')).toHaveLength(0);
});
it('Super Admin não herda acesso comercial mesmo com permissões presentes', async () => {
  const { gateway, server } = world('administrator', true);
  await renderApp({ gateway, fetch: server.fetch, initialUrl: '/relatorios/pedidos', overrides });
  await screen.findByText(/acesso/i);
  expect(server.calls.some((call) => call.path === '/api/v1/orders')).toBe(false);
});
it('relatório distingue valor comercial de recebimento e usa somente filtros reais', async () => {
  const { gateway, server } = world();
  await renderApp({ gateway, fetch: server.fetch, initialUrl: '/relatorios/pedidos', overrides });
  await screen.findByText(/123,45/);
  await screen.findByText(/1 registros carregados/);
  await fireEvent.changeText(screen.getByLabelText('ID do cliente (opcional)'), 'c2');
  await fireEvent.press(screen.getByRole('button', { name: 'Aplicar cliente' }));
  await waitFor(() =>
    expect(
      server.calls.some((call) => call.path === '/api/v1/orders' && call.query.customerId === 'c2'),
    ).toBe(true),
  );
  expect(screen.getByText(/não representa faturamento ou dinheiro recebido/)).toBeTruthy();
});
it('página vazia com cursor mantém continuação sem inventar total', async () => {
  const { gateway, server } = world();
  server.on('GET', '/api/v1/orders', (call) =>
    ok(page(call.query.cursor ? [order('o2')] : [], call.query.cursor ? null : 'cursor-vazio')),
  );
  await renderApp({ gateway, fetch: server.fetch, initialUrl: '/relatorios/pedidos', overrides });
  await fireEvent.press(await screen.findByRole('button', { name: 'Carregar mais' }));
  await screen.findByText('PED-O2-0000-4000-8000-000000000000');
  expect(server.calls.filter((call) => call.path === '/api/v1/orders')[1]?.query).toMatchObject({
    cursor: 'cursor-vazio',
    direction: 'desc',
    limit: '10',
  });
});
it('visitante abre catálogo sem login e sem cabeçalhos privados', async () => {
  const { gateway, server } = world('administrator', false, false);
  await renderApp({ gateway, fetch: server.fetch, initialUrl: '/catalogo/teste', overrides });
  await screen.findByText('Café público');
  for (const call of server.calls.filter((call) => call.path.includes('/public/'))) {
    expect(call.headers.authorization).toBeUndefined();
    expect(call.headers['x-tenant-id']).toBeUndefined();
  }
  expect(server.calls.some((call) => call.path === '/api/v1/me')).toBe(false);
});
it('prévia usa linhas e quantidades canônicas; preços vêm do servidor', async () => {
  const { gateway, server } = world();
  await renderApp({ gateway, fetch: server.fetch, initialUrl: '/catalogo/teste', overrides });
  await fireEvent.press(await screen.findByRole('button', { name: 'Selecionar Café público' }));
  await fireEvent.changeText(screen.getByLabelText('Quantidade de Café público'), '0,125');
  await fireEvent.press(screen.getByRole('button', { name: 'Revisar orçamento no servidor' }));
  await screen.findByText('Total estimado: R$ 1,88');
  expect(server.calls.find((call) => call.path.endsWith('/quote-preview'))?.body).toEqual({
    lines: [{ productId: 'p1', quantity: '0.125' }],
  });
  expect(server.calls.some((call) => call.path === '/api/v1/orders')).toBe(false);
  await fireEvent.changeText(screen.getByLabelText('Quantidade de Café público'), '2');
  expect(screen.queryByText('Total estimado: R$ 1,88')).toBeNull();
});
it('QUOTE_CHANGED invalida resumo e exige nova revisão; não abre link antigo', async () => {
  const { gateway, server } = world();
  server.on('POST', '/api/v1/public/catalogs/teste/whatsapp', () => fail(409, 'QUOTE_CHANGED'));
  await renderApp({ gateway, fetch: server.fetch, initialUrl: '/catalogo/teste', overrides });
  await fireEvent.press(await screen.findByRole('button', { name: 'Selecionar Café público' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Revisar orçamento no servidor' }));
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Preparar mensagem para WhatsApp' }),
  );
  await screen.findByText('Orçamento mudou. Faça nova revisão antes de continuar.');
  expect(screen.queryByText('Revisão do orçamento')).toBeNull();
  expect(server.calls.find((call) => call.path.endsWith('/whatsapp'))?.body).toEqual({
    lines: [{ productId: 'p1', quantity: '1' }],
    reviewToken: 'a'.repeat(64),
  });
});
it('preços ocultos não são reconstruídos no carrinho ou revisão', async () => {
  const { gateway, server } = world();
  server.on('GET', '/api/v1/public/catalogs/teste', () => ok({ ...profile, showPrices: false }));
  server.on('GET', '/api/v1/public/catalogs/teste/products', () =>
    ok(page([{ ...item, unitPriceCents: null }])),
  );
  server.on('POST', '/api/v1/public/catalogs/teste/quote-preview', () =>
    ok({
      ...preview,
      totalEstimatedCents: null,
      lines: preview.lines.map((line) => ({ ...line, unitPriceCents: null, subtotalCents: null })),
    }),
  );
  await renderApp({ gateway, fetch: server.fetch, initialUrl: '/catalogo/teste', overrides });
  await screen.findByText('Preço sob consulta');
  await fireEvent.press(screen.getByRole('button', { name: 'Selecionar Café público' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Revisar orçamento no servidor' }));
  await screen.findByText('Total sob consulta');
  expect(screen.queryByText(/R\$/)).toBeNull();
});
it('troca de empresa desmonta filtros e consulta privada anterior', async () => {
  const { gateway, server } = world();
  server.on('GET', '/api/v1/me', () =>
    ok({
      uid: 'u1',
      email: 'user@lastro.test',
      platformAdmin: false,
      memberships: [membership('t1'), membership('t2')],
    }),
  );
  function Choose() {
    const session = useSession();
    return (
      <Pressable
        onPress={() => {
          session.selectTenant('t1');
          router.replace('/relatorios/pedidos' as Href);
        }}
      >
        <Text>Escolher A</Text>
      </Pressable>
    );
  }
  function Switcher() {
    const session = useSession();
    return (
      <>
        <Pressable onPress={() => session.selectTenant('t2')}>
          <Text>Trocar B</Text>
        </Pressable>
        <OrderReport />
      </>
    );
  }
  await renderApp({
    gateway,
    fetch: server.fetch,
    initialUrl: '/relatorios/pedidos',
    overrides: { ...overrides, empresas: Choose, '(app)/relatorios/pedidos': Switcher },
  });
  await fireEvent.press(await screen.findByText('Escolher A'));
  await screen.findByText(/123,45/);
  await fireEvent.changeText(screen.getByLabelText('ID do cliente (opcional)'), 'cliente-A');
  await fireEvent.press(screen.getByRole('button', { name: 'Aplicar cliente' }));
  await fireEvent.press(screen.getByText('Trocar B'));
  await waitFor(() =>
    expect(
      server.calls.some(
        (call) => call.path === '/api/v1/orders' && call.headers['x-tenant-id'] === 't2',
      ),
    ).toBe(true),
  );
  expect(screen.getByLabelText('ID do cliente (opcional)').props.value).toBe('');
  expect(
    server.calls
      .filter((call) => call.headers['x-tenant-id'] === 't2')
      .every((call) => call.query.customerId !== 'cliente-A'),
  ).toBe(true);
});
