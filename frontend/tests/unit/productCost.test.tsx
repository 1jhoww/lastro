import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import ProductDetail from '@/app/(app)/produtos/[id]/index';
import EditProduct from '@/app/(app)/produtos/[id]/editar';
import NewProduct from '@/app/(app)/produtos/novo';
import {
  canEditProductCost,
  estimatedMargin,
  formatMargin,
} from '@/features/management/presentation';
import { emptyProductForm, productFormSchema, productToForm } from '@/features/products/form';
import { category, createFakeApi, fail, membership, ok, page, product } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

const overrides = {
  '(app)/produtos/novo': NewProduct,
  '(app)/produtos/[id]/index': ProductDetail,
  '(app)/produtos/[id]/editar': EditProduct,
};

const costs = (overrides_: Record<string, unknown> = {}) => ({
  productId: 'p1',
  priceCents: 1000,
  referenceCostCents: 600,
  averageCostCents: null,
  lastPurchaseCostCents: null,
  costBasis: 'reference',
  unitGrossProfitCents: 400,
  grossMarginBp: 4000,
  version: 3,
  updatedAt: '2026-11-01T12:00:00.000Z',
  ...overrides_,
});

type Access = { role?: 'administrator' | 'seller'; add?: string[]; remove?: string[] };
function world({ role = 'administrator', add = ['costs:read'], remove = [] }: Access = {}) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const base = membership('t1', role);
  const permissions = [...base.permissions, ...add].filter((p) => !remove.includes(p));
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [{ ...base, permissions }],
      }),
    )
    .on('GET', '/api/v1/categories', () => ok(page([category('cat1')])))
    .on('GET', '/api/v1/products/p1', () => ok(product('p1', { priceCents: 1000, version: 2 })));
  return { gateway, server };
}
const costCalls = (server: ReturnType<typeof createFakeApi>, method: string) =>
  server.calls.filter((c) => c.method === method && c.path === '/api/v1/products/p1/costs');
const productPatches = (server: ReturnType<typeof createFakeApi>) =>
  server.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/v1/products/p1');
const render = (w: ReturnType<typeof world>, url: string) =>
  renderApp({ gateway: w.gateway, fetch: w.server.fetch, initialUrl: url, overrides });

describe('cálculo da margem', () => {
  it('confere com o backend', () => {
    expect(estimatedMargin(3500, 1850)).toEqual({
      unitGrossProfitCents: 1650,
      grossMarginBp: 4714,
    });
  });
  it('sem custo não há margem, nem zero enganoso', () => {
    expect(estimatedMargin(3500, null)).toEqual({
      unitGrossProfitCents: null,
      grossMarginBp: null,
    });
  });
  it('custo acima do preço dá margem negativa', () => {
    expect(estimatedMargin(1000, 1500)).toEqual({
      unitGrossProfitCents: -500,
      grossMarginBp: -5000,
    });
    expect(formatMargin(-5000)).toBe('-50,00%');
  });
  it('sem preço há lucro negativo, mas não percentual', () => {
    expect(estimatedMargin(0, 100)).toEqual({ unitGrossProfitCents: -100, grossMarginBp: null });
  });
  it('arredonda em pontos-base', () => {
    expect(estimatedMargin(3000, 1000).grossMarginBp).toBe(6667);
  });
});

describe('regras do campo de custo', () => {
  it('salvar custo exige ver custos e gerir produtos', () => {
    expect(canEditProductCost(['costs:read', 'products:manage'])).toBe(true);
    expect(canEditProductCost(['products:manage'])).toBe(false);
    expect(canEditProductCost(['costs:read'])).toBe(false);
  });
  it('custo é opcional e nunca negativo', () => {
    const form = { ...emptyProductForm, name: 'Água', sku: 'A1' };
    expect(productFormSchema.safeParse(form).success).toBe(true);
    expect(productFormSchema.safeParse({ ...form, referenceCostCents: -1 }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...form, referenceCostCents: 100 }).success).toBe(true);
  });
  it('produto antigo, sem custo, abre em branco', () => {
    expect(productToForm(product('p1') as never).referenceCostCents).toBeNull();
  });
});

describe('cadastro com custo', () => {
  const fill = async () => {
    await fireEvent.changeText(await screen.findByLabelText('Nome do produto'), 'Queijo');
    await fireEvent.changeText(screen.getByLabelText('SKU'), 'qj-01');
    await fireEvent.changeText(screen.getByLabelText('Preço por un'), '1000');
  };
  const created = (w: ReturnType<typeof world>) =>
    w.server.on('POST', '/api/v1/products', () => ok(product('p1', { priceCents: 1000 }), 201));

  it('margem acompanha preço e custo enquanto digita', async () => {
    const w = world();
    await render(w, '/produtos/novo');
    await fill();
    expect(screen.getByText('Margem bruta estimada')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBe(3);
    await fireEvent.changeText(screen.getByLabelText('Custo de referência por un'), '600');
    expect(screen.getByText('40,00%')).toBeTruthy();
    expect(screen.getByText('R$ 4,00')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Preço por un'), '2000');
    expect(screen.getByText('70,00%')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Custo de referência por un'), '3000');
    expect(screen.getByText('O preço está abaixo do custo de referência.')).toBeTruthy();
  });

  it('salva o custo em productCosts, fora do produto', async () => {
    const w = world();
    created(w);
    let sent: unknown;
    w.server
      .on('PATCH', '/api/v1/products/p1/costs', (c) => {
        sent = c.body;
        return ok(costs());
      })
      .on('GET', '/api/v1/products/p1/costs', () => ok(costs()))
      .on('GET', '/api/v1/products/p1/cost-history', () => ok(page([])));
    await render(w, '/produtos/novo');
    await fill();
    await fireEvent.changeText(screen.getByLabelText('Custo de referência por un'), '600');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar produto' }));
    await waitFor(() => expect(sent).toEqual({ expectedVersion: 0, referenceCostCents: 600 }));
    const post = w.server.calls.find((c) => c.method === 'POST');
    expect(post?.body).not.toHaveProperty('referenceCostCents');
  });

  it('sem custo informado, nenhuma chamada de custo', async () => {
    const w = world();
    created(w);
    w.server
      .on('GET', '/api/v1/products/p1/costs', () => ok(costs()))
      .on('GET', '/api/v1/products/p1/cost-history', () => ok(page([])));
    await render(w, '/produtos/novo');
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(await screen.findByRole('header', { name: 'Produto p1' })).toBeTruthy();
    expect(costCalls(w.server, 'PATCH')).toHaveLength(0);
  });

  it('falha no custo não desfaz nem repete o cadastro', async () => {
    const w = world();
    created(w);
    w.server
      .on('PATCH', '/api/v1/products/p1/costs', () => fail(500, 'INTERNAL'))
      .on('GET', '/api/v1/products/p1/costs', () => ok(costs({ referenceCostCents: null })))
      .on('GET', '/api/v1/products/p1/cost-history', () => ok(page([])));
    await render(w, '/produtos/novo');
    await fill();
    await fireEvent.changeText(screen.getByLabelText('Custo de referência por un'), '600');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(await screen.findByRole('header', { name: 'Produto p1' })).toBeTruthy();
    expect(w.server.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('sem custos no plano, o formulário continua como antes', async () => {
    const w = world({ add: [] });
    await render(w, '/produtos/novo');
    await screen.findByLabelText('Nome do produto');
    expect(screen.queryByText('Custo e margem')).toBeNull();
    expect(screen.queryByLabelText('Custo de referência por un')).toBeNull();
  });
});

describe('edição de custo', () => {
  const editing = (cost = costs()) => {
    const w = world();
    w.server
      .on('GET', '/api/v1/products/p1/costs', () => ok(cost))
      .on('GET', '/api/v1/products/p1/cost-history', () => ok(page([])));
    return w;
  };
  const field = () => screen.findByLabelText('Custo de referência por un');
  const save = () => fireEvent.press(screen.getByRole('button', { name: 'Salvar produto' }));

  it('mudar só o custo não toca no produto', async () => {
    const w = editing();
    let sent: unknown;
    w.server.on('PATCH', '/api/v1/products/p1/costs', (c) => {
      sent = c.body;
      return ok(costs({ referenceCostCents: 700, version: 4 }));
    });
    await render(w, '/produtos/p1/editar');
    await fireEvent.changeText(await field(), '700');
    await save();
    await waitFor(() => expect(sent).toEqual({ expectedVersion: 3, referenceCostCents: 700 }));
    expect(productPatches(w.server)).toHaveLength(0);
  });

  it('nada mudou, nada é enviado', async () => {
    const w = editing();
    await render(w, '/produtos/p1/editar');
    await field();
    await save();
    expect(await screen.findByRole('header', { name: 'Produto p1' })).toBeTruthy();
    expect(costCalls(w.server, 'PATCH')).toHaveLength(0);
    expect(productPatches(w.server)).toHaveLength(0);
  });

  it('apagar o campo limpa o custo de referência', async () => {
    const w = editing();
    let sent: unknown;
    w.server.on('PATCH', '/api/v1/products/p1/costs', (c) => {
      sent = c.body;
      return ok(costs({ referenceCostCents: null, version: 4 }));
    });
    await render(w, '/produtos/p1/editar');
    await fireEvent.changeText(await field(), '');
    await save();
    await waitFor(() => expect(sent).toEqual({ expectedVersion: 3, referenceCostCents: null }));
  });

  it('custo médio aparece só para leitura, separado da referência', async () => {
    const w = editing(costs({ averageCostCents: 800, costBasis: 'average' }));
    await render(w, '/produtos/p1/editar');
    await field();
    expect(screen.getByText('Custo médio do estoque')).toBeTruthy();
    expect(screen.getByText('R$ 8,00')).toBeTruthy();
    expect(screen.getByText('20,00%')).toBeTruthy(); // sobre o custo médio
    expect(screen.getByText('40,00%')).toBeTruthy(); // sobre a referência
    expect(screen.queryByLabelText(/Custo médio/)).toBeNull();
  });

  it('se só o custo falhar, salvar de novo reenvia só o custo', async () => {
    const w = editing();
    let attempts = 0;
    w.server
      .on('PATCH', '/api/v1/products/p1', () =>
        ok(product('p1', { name: 'Novo', priceCents: 1000, version: 3 })),
      )
      .on('PATCH', '/api/v1/products/p1/costs', () =>
        ++attempts === 1 ? fail(500, 'INTERNAL') : ok(costs({ version: 4 })),
      );
    await render(w, '/produtos/p1/editar');
    await fireEvent.changeText(await field(), '700');
    await fireEvent.changeText(screen.getByLabelText('Nome do produto'), 'Novo');
    await save();
    expect(await screen.findByText('Não foi possível salvar')).toBeTruthy();
    await save();
    await waitFor(() => expect(attempts).toBe(2));
    expect(productPatches(w.server)).toHaveLength(1);
  });

  it('versão desatualizada pede recarga, sem sobrescrever', async () => {
    const w = editing();
    w.server.on('PATCH', '/api/v1/products/p1/costs', () => fail(409, 'CONFLICT'));
    await render(w, '/produtos/p1/editar');
    await fireEvent.changeText(await field(), '700');
    await save();
    expect(await screen.findByText('Alguém alterou este cadastro')).toBeTruthy();
  });

  it('falha ao ler custos não trava a edição do produto', async () => {
    const w = world();
    w.server.on('GET', '/api/v1/products/p1/costs', () => fail(500, 'INTERNAL'));
    await render(w, '/produtos/p1/editar');
    expect(await screen.findByLabelText('Nome do produto')).toBeTruthy();
    expect(screen.queryByText('Custo e margem')).toBeNull();
  });

  it('sem acesso a custos, a API de custos nem é chamada', async () => {
    const w = world({ add: [] });
    await render(w, '/produtos/p1/editar');
    await screen.findByLabelText('Nome do produto');
    expect(screen.queryByText('Custo e margem')).toBeNull();
    expect(costCalls(w.server, 'GET')).toHaveLength(0);
  });
});

describe('ficha do produto', () => {
  const detail = (w: ReturnType<typeof world>, cost = costs()) => {
    w.server
      .on('GET', '/api/v1/products/p1/costs', () => ok(cost))
      .on('GET', '/api/v1/products/p1/cost-history', () => ok(page([])));
    return render(w, '/produtos/p1');
  };

  it('diferencia custo real e manual e diz de qual vem a margem', async () => {
    await detail(world(), costs({ averageCostCents: 800, costBasis: 'average' }));
    expect(await screen.findByText('Real, das compras recebidas')).toBeTruthy();
    expect(screen.getByText('Informado manualmente')).toBeTruthy();
    expect(screen.getByText('Sobre o custo médio do estoque')).toBeTruthy();
  });

  it('sem custo médio, a margem avisa que vem da referência', async () => {
    await detail(world());
    expect(await screen.findByText('Sobre o custo de referência')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alterar custo' })).toBeTruthy();
  });

  it('quem só vê custos não recebe o botão de alterar', async () => {
    await detail(world({ remove: ['products:manage'] }));
    expect(await screen.findByText('Custo de referência')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Alterar custo' })).toBeNull();
  });

  it('vendedor não vê custos nem dispara a consulta', async () => {
    const w = world({ role: 'seller', add: [] });
    await detail(w);
    expect(await screen.findByRole('header', { name: 'Produto p1' })).toBeTruthy();
    expect(screen.queryByText('Custos e margem')).toBeNull();
    expect(costCalls(w.server, 'GET')).toHaveLength(0);
  });
});
