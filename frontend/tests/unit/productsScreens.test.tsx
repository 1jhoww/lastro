import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import * as ImagePicker from 'expo-image-picker';
import Categories from '@/app/(app)/produtos/categorias';
import ProductDetail from '@/app/(app)/produtos/[id]/index';
import EditProduct from '@/app/(app)/produtos/[id]/editar';
import Products from '@/app/(app)/produtos/index';
import NewProduct from '@/app/(app)/produtos/novo';
import { category, createFakeApi, fail, membership, ok, page, product } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
const pick = ImagePicker.launchImageLibraryAsync as jest.Mock;

const overrides = {
  '(app)/produtos/index': Products,
  '(app)/produtos/novo': NewProduct,
  '(app)/produtos/categorias': Categories,
  '(app)/produtos/[id]/index': ProductDetail,
  '(app)/produtos/[id]/editar': EditProduct,
};

function world(role: 'administrator' | 'seller') {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [membership('t1', role)],
      }),
    )
    .on('GET', '/api/v1/categories', () =>
      ok(
        page([
          category('cat1', { name: 'Bebidas' }),
          category('cat2', { name: 'Antiga', status: 'inactive' }),
        ]),
      ),
    );
  return { gateway, server };
}

const productCalls = (server: ReturnType<typeof createFakeApi>) =>
  server.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/products');

describe('produtos: lista e permissões', () => {
  it('administrador vê preço, categoria e ações de cadastro', async () => {
    const { gateway, server } = world('administrator');
    server.on('GET', '/api/v1/products', () =>
      ok(page([product('p1', { name: 'Água 500 ml', priceCents: 250, categoryId: 'cat1' })])),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos', overrides });
    expect(await screen.findByText('Água 500 ml')).toBeTruthy();
    expect(screen.getByText('R$ 2,50')).toBeTruthy();
    expect(await screen.findByText('SKU-P1 · Bebidas')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Novo produto' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Categorias' })).toBeTruthy();
  });

  it('vendedor só consulta: sem cadastro, sem filtro de situação, só ativos', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/products', () => ok(page([product('p1')])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos', overrides });
    expect(await screen.findByText('Produto p1')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Novo produto' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Inativos' })).toBeNull();
    expect(productCalls(server)[0]?.query.status).toBe('active');
  });

  it('vendedor não acessa o cadastro nem a edição', async () => {
    const { gateway, server } = world('seller');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/novo', overrides });
    expect(await screen.findByText('Você não tem acesso a esta área')).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('vendedor não vê editar, desativar nem enviar imagem no detalhe', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/products/p1', () => ok(product('p1')));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/p1', overrides });
    await screen.findByRole('header', { name: 'Produto p1' });
    expect(screen.queryByRole('link', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desativar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adicionar imagem' })).toBeNull();
    expect(screen.queryByText('Estoque mínimo')).toBeNull();
  });

  it('filtro de categoria envia categoryId', async () => {
    const { gateway, server } = world('administrator');
    server.on('GET', '/api/v1/products', () => ok(page([])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos', overrides });
    await screen.findByText('Nenhum produto cadastrado');
    await fireEvent.press(screen.getByLabelText('Categoria: Todas as categorias'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Bebidas' }));
    await waitFor(() => expect(productCalls(server).at(-1)?.query.categoryId).toBe('cat1'));
  });
});

describe('produtos: cadastro', () => {
  async function fillBasics() {
    await fireEvent.changeText(await screen.findByLabelText('Nome do produto'), 'Queijo minas');
    await fireEvent.changeText(screen.getByLabelText('SKU'), 'qj-01');
  }

  it('KG aceita mínimo com 3 casas; preço vai em centavos', async () => {
    const { gateway, server } = world('administrator');
    let sent: unknown;
    server
      .on('POST', '/api/v1/products', (c) => {
        sent = c.body;
        return ok(product('p9', { name: 'Queijo minas' }), 201);
      })
      .on('GET', '/api/v1/products/p9', () => ok(product('p9', { name: 'Queijo minas' })));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/novo', overrides });
    await fillBasics();
    await fireEvent.press(screen.getByLabelText('Unidade de venda: Unidade (UN)'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Quilo (KG)' }));
    await fireEvent.changeText(screen.getByLabelText('Preço por kg'), '4590');
    await fireEvent.changeText(screen.getByLabelText('Estoque mínimo'), '1,25');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(await screen.findByRole('header', { name: 'Queijo minas' })).toBeTruthy();
    expect(sent).toEqual({
      name: 'Queijo minas',
      sku: 'qj-01',
      categoryId: null,
      unit: 'KG',
      priceCents: 4590,
      catalogVisible: false,
      minimumStock: '1.25',
    });
  });

  it('unidade inteira recusa mínimo fracionado antes de enviar', async () => {
    const { gateway, server } = world('administrator');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/novo', overrides });
    await fillBasics();
    await fireEvent.changeText(screen.getByLabelText('Estoque mínimo'), '1,5');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(await screen.findByText('Use um número inteiro para esta unidade.')).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('seletor de categoria não oferece categorias inativas', async () => {
    const { gateway, server } = world('administrator');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/novo', overrides });
    await fireEvent.press(await screen.findByLabelText('Categoria: Sem categoria'));
    expect(await screen.findByRole('radio', { name: 'Bebidas' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Antiga/ })).toBeNull();
  });

  it('SKU duplicado volta para o campo', async () => {
    const { gateway, server } = world('administrator');
    server.on('POST', '/api/v1/products', () => fail(409, 'DUPLICATE_SKU'));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/novo', overrides });
    await fillBasics();
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(
      await screen.findByText('Já existe um produto com este SKU nesta empresa.'),
    ).toBeTruthy();
  });

  it('unidade travada pelo estoque aparece no campo unidade', async () => {
    const { gateway, server } = world('administrator');
    server
      .on('GET', '/api/v1/products/p1', () => ok(product('p1', { name: 'Arroz' })))
      .on('PATCH', '/api/v1/products/p1', (c) => {
        expect(c.body).toEqual({ expectedVersion: 1, unit: 'CX' });
        return fail(409, 'UNIT_LOCKED');
      });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/p1/editar', overrides });
    await fireEvent.press(await screen.findByLabelText('Unidade de venda: Unidade (UN)'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Caixa (CX)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(
      await screen.findByText(
        'A unidade não pode mudar: o produto já tem movimentação de estoque.',
      ),
    ).toBeTruthy();
  });
});

describe('produtos: imagem', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    pick.mockReset();
  });

  it('envia os bytes com Content-Type e versão esperada', async () => {
    const { gateway, server } = world('administrator');
    let current = product('p1', { version: 3 });
    server
      .on('GET', '/api/v1/products/p1', () => ok(current))
      .on('GET', '/api/v1/products/p1/image', () => ({ status: 200, body: undefined }))
      .on('PUT', '/api/v1/products/p1/image', (c) => {
        expect(c.headers['content-type']).toBe('image/png');
        expect(c.query).toEqual({ expectedVersion: '3' });
        expect(c.bodyBytes).toBe(1234);
        current = product('p1', {
          version: 4,
          image: { id: 'img1', contentType: 'image/webp', sizeBytes: 900, width: 400, height: 300 },
        });
        return ok(current);
      });
    pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///foto.png', mimeType: 'image/png', fileSize: 1234 }],
    });
    globalThis.fetch = jest.fn(async () => ({
      blob: async () => new Blob([new Uint8Array(1234)], { type: 'image/png' }),
    })) as never;
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/p1', overrides });
    await fireEvent.press(await screen.findByRole('button', { name: 'Adicionar imagem' }));
    expect(await screen.findByRole('button', { name: 'Substituir' })).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'PUT')).toBe(true);
  });

  it('arquivo acima de 5 MB é recusado sem chamar a API', async () => {
    const { gateway, server } = world('administrator');
    server.on('GET', '/api/v1/products/p1', () => ok(product('p1')));
    pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///grande.jpg', mimeType: 'image/jpeg', fileSize: 6 * 1024 * 1024 }],
    });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/p1', overrides });
    await fireEvent.press(await screen.findByRole('button', { name: 'Adicionar imagem' }));
    expect(await screen.findByText('A imagem tem mais de 5 MB. Escolha uma menor.')).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('imagem recusada pelo servidor mostra o motivo', async () => {
    const { gateway, server } = world('administrator');
    server
      .on('GET', '/api/v1/products/p1', () => ok(product('p1')))
      .on('PUT', '/api/v1/products/p1/image', () => fail(422, 'INVALID_IMAGE'));
    pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///x.jpg', mimeType: 'image/jpeg', fileSize: 10 }],
    });
    globalThis.fetch = jest.fn(async () => ({
      blob: async () => new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
    })) as never;
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/p1', overrides });
    await fireEvent.press(await screen.findByRole('button', { name: 'Adicionar imagem' }));
    expect(await screen.findByText(/A imagem não foi aceita/)).toBeTruthy();
  });
});

describe('categorias', () => {
  it('cria pela caixa de diálogo', async () => {
    const { gateway, server } = world('administrator');
    let sent: unknown;
    server.on('POST', '/api/v1/categories', (c) => {
      sent = c.body;
      return ok(category('cat3', { name: 'Laticínios' }), 201);
    });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/produtos/categorias',
      overrides,
    });
    await screen.findByText('Bebidas');
    await fireEvent.press(screen.getByRole('button', { name: 'Nova categoria' }));
    await fireEvent.changeText(await screen.findByLabelText('Nome'), 'Laticínios');
    await fireEvent.press(screen.getByRole('button', { name: 'Criar categoria' }));
    await waitFor(() => expect(sent).toEqual({ name: 'Laticínios' }));
  });

  it('desativa com confirmação explicando que produtos mantêm a categoria', async () => {
    const { gateway, server } = world('administrator');
    let sent: unknown;
    server.on('DELETE', '/api/v1/categories/cat1', (c) => {
      sent = c.body;
      return ok(category('cat1', { status: 'inactive', version: 2 }));
    });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/produtos/categorias',
      overrides,
    });
    await screen.findByText('Bebidas');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Desativar' })[0]!);
    expect(screen.getByText(/continuam com a categoria/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Desativar categoria' }));
    await waitFor(() => expect(sent).toEqual({ expectedVersion: 1 }));
  });

  it('vendedor não acessa categorias', async () => {
    const { gateway, server } = world('seller');
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/produtos/categorias',
      overrides,
    });
    expect(await screen.findByText('Você não tem acesso a esta área')).toBeTruthy();
  });
});
