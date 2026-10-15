import { Pressable, Text } from 'react-native';
import { router, useRouter, type Href } from 'expo-router';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import StockAdjustment from '@/app/(app)/estoque/ajuste';
import StockEntry from '@/app/(app)/estoque/entrada';
import Inventory from '@/app/(app)/estoque/index';
import StockDetail from '@/app/(app)/estoque/[id]';
import Movements from '@/app/(app)/estoque/movimentacoes';
import Replenishment from '@/app/(app)/estoque/reposicao';
import Home from '@/app/(app)/index';
import ProductDetail from '@/app/(app)/produtos/[id]/index';
import { movementRequest } from '@/features/inventory/api';
import { intentLedger } from '@/lib/intent';
import { useSession } from '@/session/SessionContext';
import {
  createFakeApi,
  fail,
  membership,
  ok,
  page,
  product,
  stockAdmin,
  stockAvailability,
  stockMovement,
  type Call,
} from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

let mockSize: 'compact' | 'medium' | 'expanded' = 'compact';
jest.mock('@/theme/useLayoutSize', () => ({
  ...jest.requireActual('@/theme/useLayoutSize'),
  useLayoutSize: () => mockSize,
}));

const overrides = {
  '(app)/estoque/index': Inventory,
  '(app)/estoque/[id]': StockDetail,
  '(app)/estoque/entrada': StockEntry,
  '(app)/estoque/ajuste': StockAdjustment,
  '(app)/estoque/movimentacoes': Movements,
  '(app)/estoque/reposicao': Replenishment,
  '(app)/produtos/[id]/index': ProductDetail,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  mockSize = 'compact';
  intentLedger.reset();
  movementRequest.timeoutMs = 20_000;
});

function world(role: 'administrator' | 'seller' = 'administrator') {
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
    .on('GET', '/api/v1/categories', () => ok(page([])));
  return { gateway, server };
}

const calls = (server: ReturnType<typeof createFakeApi>, method: string, path: string) =>
  server.calls.filter((c) => c.method === method && c.path === path);

/** Resultado de movimentação no formato do contrato. */
const moved = (stock: Record<string, unknown>, movement: Record<string, unknown> = {}) =>
  ok({ movement: stockMovement('m-new', movement), stock }, 201);

async function fillEntry(quantity: string, reason = 'Nota fiscal 123') {
  await fireEvent.changeText(await screen.findByLabelText('Quantidade'), quantity);
  await fireEvent.changeText(screen.getByLabelText('Motivo'), reason);
}

/* ---------------- Saldos ---------------- */

describe('estoque: saldos', () => {
  it('administrador vê físico, reservado, disponível e a situação', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/inventory', () =>
      ok(
        page([
          stockAdmin('p1', { name: 'Água 500 ml' }),
          stockAdmin('p2', {
            name: 'Queijo',
            unit: 'KG',
            physical: '2.5',
            reserved: '0',
            available: '2.5',
            minimumStock: '5',
            suggestedQuantity: '2.5',
          }),
        ]),
      ),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque', overrides });
    expect(await screen.findByText('Água 500 ml')).toBeTruthy();
    expect(screen.getByText('Físico 10 un · Reservado 4 un')).toBeTruthy();
    expect(screen.getByText('6 un')).toBeTruthy();
    expect(screen.getByText('Físico 2,5 kg · Reservado 0 kg')).toBeTruthy();
    expect(screen.getByText('Abaixo do mínimo')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Registrar entrada' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ajustar saldo' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Movimentações' })).toBeTruthy();
    const q = calls(server, 'GET', '/api/v1/inventory')[0]!.query;
    expect(q).toMatchObject({ status: 'active', sort: 'name', direction: 'asc' });
  });

  it('desktop: tabela com colunas de saldo', async () => {
    mockSize = 'expanded';
    const { gateway, server } = world();
    server.on('GET', '/api/v1/inventory', () => ok(page([stockAdmin('p1')])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque', overrides });
    expect(await screen.findByText('Produto p1')).toBeTruthy();
    for (const label of ['Disponível', 'Reservado', 'Físico', 'Mínimo', 'Situação'])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Disponível: 6 un')).toBeTruthy();
    expect(screen.getByLabelText('Reservado: 4 un')).toBeTruthy();
    expect(screen.queryByText('Físico 10 un · Reservado 4 un')).toBeNull();
  });

  it('celular: filtros secundários ficam recolhidos e mostram quantos estão ativos', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/inventory', () => ok(page([stockAdmin('p1')])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque', overrides });
    await screen.findByText('Produto p1');
    expect(screen.queryByRole('radio', { name: 'Inativos' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Filtros' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Todos' }));
    await waitFor(() =>
      expect(calls(server, 'GET', '/api/v1/inventory').at(-1)?.query.status).toBe('all'),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Ocultar filtros' }));
    expect(screen.getByRole('button', { name: 'Filtros (1)' })).toBeTruthy();
  });

  it('busca por SKU envia sku exato; SKU inválido não é enviado', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/inventory', () => ok(page([])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque', overrides });
    await screen.findByText('Nenhum produto com saldo para mostrar');
    await fireEvent.press(screen.getByRole('radio', { name: 'SKU' }));
    await fireEvent.changeText(screen.getByLabelText('Buscar por SKU'), 'AGUA-500');
    await waitFor(() =>
      expect(calls(server, 'GET', '/api/v1/inventory').at(-1)?.query.sku).toBe('AGUA-500'),
    );
    const before = calls(server, 'GET', '/api/v1/inventory').length;
    await fireEvent.changeText(screen.getByLabelText('Buscar por SKU'), 'AGUA 500');
    expect(
      await screen.findByText('Use letras, números, ponto, hífen ou sublinhado.'),
    ).toBeTruthy();
    expect(calls(server, 'GET', '/api/v1/inventory').length).toBe(before);
  });

  it('pagina por cursor com "Carregar mais"', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/inventory', (c) =>
      c.query.cursor === 'c2'
        ? ok(page([stockAdmin('p2', { name: 'Segunda página' })]))
        : ok(page([stockAdmin('p1', { name: 'Primeira página' })], 'c2')),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque', overrides });
    expect(await screen.findByText('Primeira página')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Segunda página')).toBeTruthy();
    expect(screen.getByText('Primeira página')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('carregando, erro com nova tentativa e vazio', async () => {
    const { gateway, server } = world();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let attempt = 0;
    server.on('GET', '/api/v1/inventory', async () => {
      attempt++;
      if (attempt === 1) {
        await gate;
        return fail(403, 'FORBIDDEN');
      }
      return ok(page([]));
    });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque', overrides });
    expect(await screen.findByLabelText('Carregando')).toBeTruthy();
    await act(async () => release());
    expect(await screen.findByText('Não foi possível carregar a lista')).toBeTruthy();
    expect(screen.getByText('Seu perfil não tem acesso a esta ação.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Nenhum produto com saldo para mostrar')).toBeTruthy();
  });
});

/* ---------------- Detalhe e ficha do produto ---------------- */

describe('estoque: produto', () => {
  it('administrador vê saldos, mínimo, versão do estoque e últimas movimentações', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/inventory/p1', () =>
        ok(stockAdmin('p1', { minimumStock: '8', suggestedQuantity: '2', version: 9 })),
      )
      .on('GET', '/api/v1/inventory/movements', () => ok(page([stockMovement('m1')])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque/p1', overrides });
    expect(await screen.findByRole('header', { name: 'Produto p1' })).toBeTruthy();
    expect(screen.getByLabelText('Disponível: 6 un')).toBeTruthy();
    expect(screen.getByLabelText('Reservado: 4 un')).toBeTruthy();
    expect(screen.getByLabelText('Físico: 10 un')).toBeTruthy();
    expect(screen.getByText('Estoque mínimo cadastrado: 8 un')).toBeTruthy();
    expect(screen.getByText('Repor 2 un')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(await screen.findByText('Nota fiscal 1')).toBeTruthy();
    const q = calls(server, 'GET', '/api/v1/inventory/movements')[0]!.query;
    expect(q).toMatchObject({ productId: 'p1', direction: 'desc', limit: '10' });
  });

  it('vendedor vê só o disponível, sem ações nem histórico', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/inventory/p1', () => ok(stockAvailability('p1', '6')));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque/p1', overrides });
    expect(await screen.findByText('Disponível para vender')).toBeTruthy();
    expect(screen.getByText('6 un')).toBeTruthy();
    expect(screen.queryByText('Reservado')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Registrar entrada' })).toBeNull();
    expect(calls(server, 'GET', '/api/v1/inventory/movements')).toHaveLength(0);
  });

  it('ficha do produto mostra o estoque com o cache compartilhado da tela de estoque', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/inventory/p1', () => ok(stockAdmin('p1')))
      .on('GET', '/api/v1/inventory/movements', () => ok(page([])))
      .on('GET', '/api/v1/products/p1', () => ok(product('p1', { version: 42 })));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque/p1', overrides });
    await screen.findByLabelText('Físico: 10 un');
    await act(async () => router.navigate('/produtos/p1'));
    expect(await screen.findByText('Estoque')).toBeTruthy();
    expect(await screen.findByLabelText('Disponível: 6 un')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Registrar entrada' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Movimentações' })).toBeTruthy();
    // Mesmo saldo, uma consulta só.
    expect(calls(server, 'GET', '/api/v1/inventory/p1')).toHaveLength(1);
    // Edição de cadastro preservada; versão do cadastro (42) não vira versão do estoque (3).
    expect(screen.getByRole('link', { name: 'Editar' })).toBeTruthy();
  });

  it('vendedor na ficha do produto vê só o disponível', async () => {
    const { gateway, server } = world('seller');
    server
      .on('GET', '/api/v1/inventory/p1', () => ok(stockAvailability('p1', '3')))
      .on('GET', '/api/v1/products/p1', () => ok(product('p1')));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/p1', overrides });
    expect(await screen.findByText('Disponível para vender')).toBeTruthy();
    expect(screen.getByText('3 un')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Registrar entrada' })).toBeNull();
    expect(screen.queryByText('Reservado')).toBeNull();
  });
});

/* ---------------- Entrada ---------------- */

describe('estoque: entrada', () => {
  function entryWorld(unit = 'UN', stock: Record<string, unknown> = {}) {
    const w = world();
    w.server
      .on('GET', '/api/v1/inventory/p1', () => ok(stockAdmin('p1', { unit, ...stock })))
      .on('GET', '/api/v1/inventory/movements', () => ok(page([])));
    return w;
  }

  it('valida inteiro, revisa o impacto e só mostra sucesso depois da API', async () => {
    const { gateway, server } = entryWorld();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    server.on('POST', '/api/v1/inventory/entries', async () => {
      await gate;
      return moved(stockAdmin('p1', { physical: '15', available: '11', version: 4 }));
    });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque/entrada?produto=p1',
      overrides,
    });
    await fillEntry('1,5');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar entrada' }));
    expect(
      await screen.findByText('Use um número inteiro maior que zero para esta unidade.'),
    ).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Quantidade'), '5');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar entrada' }));
    expect(await screen.findByText('Confirmar entrada?')).toBeTruthy();
    expect(screen.getAllByLabelText('Físico: de 10 un para 15 un').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Disponível: de 6 un para 11 un').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar entrada' }));

    // Aguardando a API: nada de sucesso nem navegação.
    await waitFor(() => expect(calls(server, 'POST', '/api/v1/inventory/entries')).toHaveLength(1));
    expect(screen.getByRole('header', { name: 'Registrar entrada' })).toBeTruthy();

    await act(async () => release());
    expect(await screen.findByRole('header', { name: 'Produto p1' })).toBeTruthy();
    // Saldo devolvido pelo servidor já está no cache: sem nova consulta.
    expect(screen.getByLabelText('Físico: 15 un')).toBeTruthy();

    const post = calls(server, 'POST', '/api/v1/inventory/entries')[0]!;
    expect(post.body).toEqual({ productId: 'p1', quantity: '5', reason: 'Nota fiscal 123' });
    expect(post.headers['idempotency-key']).toMatch(UUID);
    expect(post.headers['x-tenant-id']).toBe('t1');
  });

  it('KG aceita três casas e envia o texto canônico', async () => {
    const { gateway, server } = entryWorld('KG', {
      physical: '1.5',
      reserved: '0',
      available: '1.5',
    });
    let sent: unknown;
    server.on('POST', '/api/v1/inventory/entries', (c) => {
      sent = c.body;
      return moved(
        stockAdmin('p1', { unit: 'KG', physical: '2.755', reserved: '0', available: '2.755' }),
      );
    });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque/entrada?produto=p1',
      overrides,
    });
    await fillEntry('1,255');
    await fireEvent.changeText(screen.getByLabelText('Observação'), 'Lote 7');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar entrada' }));
    expect(
      (await screen.findAllByLabelText('Físico: de 1,5 kg para 2,755 kg')).length,
    ).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar entrada' }));
    await screen.findByRole('header', { name: 'Produto p1' });
    expect(sent).toEqual({
      productId: 'p1',
      quantity: '1.255',
      reason: 'Nota fiscal 123',
      notes: 'Lote 7',
    });
  });

  it('KG recusa quatro casas antes de enviar', async () => {
    const { gateway, server } = entryWorld('KG');
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque/entrada?produto=p1',
      overrides,
    });
    await fillEntry('0,0001');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar entrada' }));
    expect(
      await screen.findByText('Use um número maior que zero com até 3 casas decimais, como 2,5.'),
    ).toBeTruthy();
    expect(calls(server, 'POST', '/api/v1/inventory/entries')).toHaveLength(0);
  });

  it('falha de rede: resultado desconhecido, repetição com a MESMA chave e o mesmo corpo', async () => {
    const { gateway, server } = entryWorld();
    let attempt = 0;
    server.on('POST', '/api/v1/inventory/entries', () => {
      attempt++;
      if (attempt === 1) throw new TypeError('Network request failed');
      return moved(stockAdmin('p1', { physical: '15', available: '11' }));
    });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque/entrada?produto=p1',
      overrides,
    });
    await fillEntry('5');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar entrada' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Registrar entrada' }));

    expect(await screen.findByText('Não sabemos se a entrada foi registrada')).toBeTruthy();
    // Formulário travado: nenhuma intenção nova enquanto o resultado é incerto.
    expect(screen.getByRole('button', { name: 'Revisar entrada' })).toBeDisabled();
    expect(screen.getByLabelText('Quantidade').props.editable).toBe(false);

    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('header', { name: 'Produto p1' })).toBeTruthy();
    const [first, second] = calls(server, 'POST', '/api/v1/inventory/entries') as [Call, Call];
    expect(second.headers['idempotency-key']).toBe(first.headers['idempotency-key']);
    expect(second.body).toEqual(first.body);
  });

  it('timeout também é resultado desconhecido (sem chave nova)', async () => {
    movementRequest.timeoutMs = 50;
    const { gateway, server } = entryWorld();
    server.on('POST', '/api/v1/inventory/entries', () => new Promise(() => {}));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque/entrada?produto=p1',
      overrides,
    });
    await fillEntry('5');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar entrada' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Registrar entrada' }));
    expect(await screen.findByText('Não sabemos se a entrada foi registrada')).toBeTruthy();
  });

  it('erro 5xx é ambíguo; a intenção pendente sobrevive a sair e voltar da tela', async () => {
    const { gateway, server } = entryWorld();
    server.on('POST', '/api/v1/inventory/entries', () => fail(503, 'SERVICE_UNAVAILABLE'));
    server.on('GET', '/api/v1/inventory', () => ok(page([])));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque/entrada?produto=p1',
      overrides,
    });
    await fillEntry('5');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar entrada' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Registrar entrada' }));
    expect(await screen.findByText('Não sabemos se a entrada foi registrada')).toBeTruthy();

    await act(async () => router.navigate('/estoque'));
    await screen.findByText('Nenhum produto com saldo para mostrar');
    await act(async () => router.navigate('/estoque/entrada?produto=p1' as Href));
    expect(await screen.findByText('Não sabemos se a entrada foi registrada')).toBeTruthy();

    // Descartar exige confirmação explícita; depois disso, nova intenção usa chave nova.
    await fireEvent.press(screen.getByRole('button', { name: 'Descartar' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Descartar tentativa' }));
    await waitFor(() =>
      expect(screen.queryByText('Não sabemos se a entrada foi registrada')).toBeNull(),
    );
    server.on('POST', '/api/v1/inventory/entries', () => moved(stockAdmin('p1')));
    await fillEntry('6');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar entrada' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Registrar entrada' }));
    await screen.findByRole('header', { name: 'Produto p1' });
    const [first, second] = calls(server, 'POST', '/api/v1/inventory/entries') as [Call, Call];
    expect(second.headers['idempotency-key']).not.toBe(first.headers['idempotency-key']);
  });

  it('recusa do servidor não grava nada e libera nova intenção com outra chave', async () => {
    const { gateway, server } = entryWorld();
    let attempt = 0;
    server.on('POST', '/api/v1/inventory/entries', () =>
      ++attempt === 1 ? fail(422, 'QUANTITY_LIMIT_EXCEEDED') : moved(stockAdmin('p1')),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque/entrada?produto=p1',
      overrides,
    });
    await fillEntry('5');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar entrada' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Registrar entrada' }));
    expect(await screen.findByText('Entrada não registrada')).toBeTruthy();
    expect(
      screen.getByText('Quantidade acima do limite permitido. Nada foi gravado.'),
    ).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Quantidade'), '4');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar entrada' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Registrar entrada' }));
    await screen.findByRole('header', { name: 'Produto p1' });
    const [first, second] = calls(server, 'POST', '/api/v1/inventory/entries') as [Call, Call];
    expect(second.headers['idempotency-key']).not.toBe(first.headers['idempotency-key']);
  });

  it('sem produto na rota: escolhe pela busca da lista de saldos', async () => {
    const { gateway, server } = entryWorld();
    server.on('GET', '/api/v1/inventory', () => ok(page([stockAdmin('p1')])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque/entrada', overrides });
    await fireEvent.press(await screen.findByRole('button', { name: 'Escolher produto' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Produto p1, SKU-P1' }));
    expect(await screen.findByLabelText('Quantidade')).toBeTruthy();
    expect(screen.getByText('SKU-P1 · unidade UN')).toBeTruthy();
  });
});

/* ---------------- Ajuste ---------------- */

describe('estoque: ajuste', () => {
  async function openAdjust(server: ReturnType<typeof createFakeApi>, gateway: FakeGateway) {
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque/ajuste?produto=p1',
      overrides,
    });
    await screen.findByLabelText('Quantidade');
  }

  it('retirada não pode consumir o reservado', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/inventory/p1', () => ok(stockAdmin('p1')));
    await openAdjust(server, gateway);
    await fireEvent.press(screen.getByRole('radio', { name: 'Retirar do físico' }));
    await fireEvent.changeText(screen.getByLabelText('Quantidade'), '7');
    expect(
      await screen.findByText(
        'Só é possível retirar até 6 un: o restante (4 un) está reservado para pedidos.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revisar ajuste' })).toBeDisabled();
  });

  it('envia delta com sinal e a versão do estoque; conflito recarrega e exige nova revisão', async () => {
    const { gateway, server } = world();
    let version = 3;
    server
      .on('GET', '/api/v1/inventory/p1', () =>
        ok(
          version === 3
            ? stockAdmin('p1')
            : stockAdmin('p1', { physical: '12', available: '8', version }),
        ),
      )
      .on('GET', '/api/v1/inventory/movements', () => ok(page([])))
      .on('POST', '/api/v1/inventory/adjustments', (c) => {
        if ((c.body as { expectedVersion: number }).expectedVersion === 3) {
          version = 4; // outra pessoa movimentou antes
          return fail(409, 'CONFLICT');
        }
        return moved(stockAdmin('p1', { physical: '10', available: '6', version: 5 }), {
          type: 'STOCK_ADJUSTMENT_OUT',
          quantity: '2',
        });
      });
    await openAdjust(server, gateway);
    await fireEvent.press(screen.getByRole('radio', { name: 'Retirar do físico' }));
    await fillEntry('2', 'Contagem do dia 10');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar ajuste' }));
    expect((await screen.findAllByLabelText('Físico: de 10 un para 8 un')).length).toBeGreaterThan(
      0,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar ajuste' }));

    expect(await screen.findByText('O saldo mudou antes da confirmação')).toBeTruthy();
    // Saldo atualizado sozinho; a pessoa revisa de novo.
    expect(await screen.findByLabelText('Físico: 12 un')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar ajuste' }));
    expect((await screen.findAllByLabelText('Físico: de 12 un para 10 un')).length).toBeGreaterThan(
      0,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar ajuste' }));
    await screen.findByRole('header', { name: 'Produto p1' });

    const [first, second] = calls(server, 'POST', '/api/v1/inventory/adjustments') as [Call, Call];
    expect(first.body).toEqual({
      productId: 'p1',
      delta: '-2',
      expectedVersion: 3,
      reason: 'Contagem do dia 10',
    });
    expect((second.body as { expectedVersion: number }).expectedVersion).toBe(4);
    expect(second.headers['idempotency-key']).not.toBe(first.headers['idempotency-key']);
  });

  it('estoque insuficiente no servidor é mostrado sem gravar', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/inventory/p1', () => ok(stockAdmin('p1')))
      .on('POST', '/api/v1/inventory/adjustments', () => fail(409, 'INSUFFICIENT_STOCK'));
    await openAdjust(server, gateway);
    await fireEvent.press(screen.getByRole('radio', { name: 'Retirar do físico' }));
    await fillEntry('6', 'Avaria');
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar ajuste' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Registrar ajuste' }));
    expect(await screen.findByText('Saldo insuficiente')).toBeTruthy();
  });
});

/* ---------------- Permissões ---------------- */

describe('estoque: permissões', () => {
  it.each(['/estoque/entrada', '/estoque/ajuste', '/estoque/movimentacoes', '/estoque/reposicao'])(
    'vendedor não acessa %s nem chama a API administrativa',
    async (url) => {
      const { gateway, server } = world('seller');
      await renderApp({ gateway, fetch: server.fetch, initialUrl: url, overrides });
      expect(await screen.findByText('Você não tem acesso a esta área')).toBeTruthy();
      expect(server.calls.some((c) => c.path.startsWith('/api/v1/inventory'))).toBe(false);
    },
  );

  it('Super Admin sem vínculo não entra no estoque das empresas', async () => {
    const gateway = new FakeGateway({
      initialUser: { uid: 'root', email: 'root@lastro.test', emailVerified: true },
    });
    const server = createFakeApi().on('GET', '/api/v1/me', () =>
      ok({ uid: 'root', email: 'root@lastro.test', platformAdmin: true, memberships: [] }),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque', overrides });
    expect(await screen.findByText('tela:plataforma')).toBeTruthy();
    expect(server.calls.some((c) => c.path.startsWith('/api/v1/inventory'))).toBe(false);
  });
});

/* ---------------- Histórico ---------------- */

describe('estoque: movimentações', () => {
  it('lista com produto, tipo, responsável neutro e origem automática; pagina por cursor', async () => {
    mockSize = 'expanded';
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/inventory/movements', (c) =>
        c.query.cursor === 'c2'
          ? ok(page([stockMovement('m3', { reason: 'Terceira' })]))
          : ok(
              page(
                [
                  stockMovement('m1'),
                  stockMovement('m2', {
                    productId: 'p2',
                    type: 'STOCK_DISPATCH',
                    origin: 'order',
                    actorUid: 'u9abcdef',
                    reason: 'STOCK_DISPATCH',
                    previousPhysical: '10',
                    physical: '8',
                    previousReserved: '4',
                    reserved: '2',
                  }),
                ],
                'c2',
              ),
            ),
      )
      .on('GET', '/api/v1/products/p1', () => ok(product('p1', { name: 'Água 500 ml' })))
      .on('GET', '/api/v1/products/p2', () => ok(product('p2', { name: 'Refrigerante' })));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque/movimentacoes',
      overrides,
    });
    expect(await screen.findByText('Água 500 ml')).toBeTruthy();
    expect(await screen.findByText('Refrigerante')).toBeTruthy();
    expect(screen.getByText('Entrada')).toBeTruthy();
    expect(screen.getByText('Entrada manual')).toBeTruthy();
    expect(screen.getByText('Expedição')).toBeTruthy();
    expect(screen.getByText('Automática (pedido)')).toBeTruthy();
    expect(screen.getByText('+5 un')).toBeTruthy();
    expect(screen.getByText('−2 un')).toBeTruthy();
    expect(screen.getByText('Você')).toBeTruthy();
    expect(screen.getByText('Usuário U9ABCD')).toBeTruthy();
    expect(screen.getByText('Movimentação automática do pedido')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Terceira')).toBeTruthy();
    expect(calls(server, 'GET', '/api/v1/inventory/movements').at(-1)?.query.cursor).toBe('c2');
  });

  it('filtros de produto, tipo, período e ordem vão para a API', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/inventory/movements', () => ok(page([])))
      .on('GET', '/api/v1/inventory/p1', () => ok(stockAdmin('p1')));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/estoque/movimentacoes?produto=p1',
      overrides,
    });
    expect(await screen.findByText('Produto: Produto p1')).toBeTruthy();
    await screen.findByText('Nenhuma movimentação nesses filtros');
    expect(calls(server, 'GET', '/api/v1/inventory/movements')[0]!.query).toMatchObject({
      productId: 'p1',
      direction: 'desc',
    });

    await fireEvent.press(screen.getByLabelText('Tipo: Todos os tipos'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Ajuste negativo' }));
    await fireEvent.press(screen.getByLabelText('Período: Todo o período'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Últimos 7 dias' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Mais antigas' }));
    await waitFor(() => {
      const q = calls(server, 'GET', '/api/v1/inventory/movements').at(-1)!.query;
      expect(q).toMatchObject({ productId: 'p1', type: 'STOCK_ADJUSTMENT_OUT', direction: 'asc' });
      expect(q.from).toMatch(/Z$/);
    });
  });
});

/* ---------------- Reposição ---------------- */

describe('estoque: reposição', () => {
  it('ordena pela maior falta, busca por nome e leva à entrada do produto', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/inventory/replenishment', () =>
      ok(
        page([
          stockAdmin('p1', {
            name: 'Arroz 5 kg',
            available: '2',
            minimumStock: '10',
            suggestedQuantity: '8',
          }),
        ]),
      ),
    );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque/reposicao', overrides });
    expect(await screen.findByText('Arroz 5 kg')).toBeTruthy();
    expect(screen.getByText('Disponível 2 un · mínimo 10 un')).toBeTruthy();
    expect(screen.getByText('8 un')).toBeTruthy();
    expect(calls(server, 'GET', '/api/v1/inventory/replenishment')[0]!.query).toMatchObject({
      status: 'active',
      sort: 'shortfall',
      direction: 'desc',
    });

    await fireEvent.changeText(screen.getByLabelText('Buscar produtos'), 'arr');
    await waitFor(() =>
      expect(calls(server, 'GET', '/api/v1/inventory/replenishment').at(-1)?.query).toMatchObject({
        q: 'arr',
        sort: 'name',
        direction: 'asc',
      }),
    );

    server
      .on('GET', '/api/v1/inventory/p1', () => ok(stockAdmin('p1', { name: 'Arroz 5 kg' })))
      .on('GET', '/api/v1/inventory', () => ok(page([])));
    await fireEvent.press(await screen.findByRole('link', { name: /Arroz 5 kg/ }));
    expect(await screen.findByRole('header', { name: 'Registrar entrada' })).toBeTruthy();
    expect(await screen.findByLabelText('Quantidade')).toBeTruthy();
  });

  it('início do administrador mostra os produtos com maior falta', async () => {
    const { gateway, server } = world();
    server
      .on('GET', '/api/v1/tenants/current', () =>
        ok({
          id: 't1',
          name: 'Distribuidora',
          timezone: 'America/Sao_Paulo',
          status: 'active',
          version: 1,
          createdAt: '2026-10-01T12:00:00.000Z',
          updatedAt: '2026-10-01T12:00:00.000Z',
        }),
      )
      .on('GET', '/api/v1/inventory/replenishment', () =>
        ok(
          page([
            stockAdmin('p1', {
              name: 'Feijão 1 kg',
              available: '1',
              minimumStock: '5',
              suggestedQuantity: '4',
            }),
          ]),
        ),
      );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/',
      overrides: { '(app)/index': Home },
    });
    expect(await screen.findByText('Feijão 1 kg')).toBeTruthy();
    expect(screen.getByText('Faltam 4 un')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver reposição' })).toBeTruthy();
    expect(calls(server, 'GET', '/api/v1/inventory/replenishment')[0]!.query).toMatchObject({
      limit: '5',
      sort: 'shortfall',
      direction: 'desc',
    });
  });

  it('vendedor não consulta reposição no início', async () => {
    const { gateway, server } = world('seller');
    server.on('GET', '/api/v1/tenants/current', () =>
      ok({
        id: 't1',
        name: 'Distribuidora',
        timezone: 'America/Sao_Paulo',
        status: 'active',
        version: 1,
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
      }),
    );
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/',
      overrides: { '(app)/index': Home },
    });
    expect(await screen.findByText('Pedidos recentes')).toBeTruthy();
    expect(screen.queryByText('Abaixo do mínimo')).toBeNull();
    expect(calls(server, 'GET', '/api/v1/inventory/replenishment')).toHaveLength(0);
  });

  it('vazio quando nada está abaixo do mínimo', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/inventory/replenishment', () => ok(page([])));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/estoque/reposicao', overrides });
    expect(await screen.findByText('Nenhum produto abaixo do mínimo')).toBeTruthy();
  });
});

/* ---------------- Troca de empresa ---------------- */

function ChooseTenant() {
  const session = useSession();
  const r = useRouter();
  return (
    <>
      {['t1', 't2'].map((t) => (
        <Pressable
          key={t}
          accessibilityRole="button"
          onPress={() => {
            session.selectTenant(t);
            r.replace('/estoque');
          }}
        >
          <Text>{`usar ${t}`}</Text>
        </Pressable>
      ))}
    </>
  );
}

it('trocar de empresa não mostra saldos da anterior e isola as intenções pendentes', async () => {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  let releaseT2: () => void = () => {};
  const t2Ready = new Promise<void>((r) => (releaseT2 = r));
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [membership('t1'), membership('t2', 'seller')],
      }),
    )
    .on('GET', '/api/v1/categories', () => ok(page([])))
    .on('GET', '/api/v1/inventory', async (c) => {
      if (c.headers['x-tenant-id'] === 't2') {
        await t2Ready;
        return ok(page([{ ...stockAvailability('b1', '9'), name: 'Saldo da Empresa B' }]));
      }
      return ok(page([stockAdmin('a1', { name: 'Saldo da Empresa A' })]));
    });

  await renderApp({
    gateway,
    fetch: server.fetch,
    overrides: { ...overrides, empresas: ChooseTenant },
  });
  await fireEvent.press(await screen.findByText('usar t1'));
  expect(await screen.findByText('Saldo da Empresa A')).toBeTruthy();
  // Intenção pendente na empresa A.
  intentLedger.keyFor('u1:t1:entry:a1', { productId: 'a1', quantity: '1', reason: 'NF 1' });
  intentLedger.markUnknown('u1:t1:entry:a1');

  await act(async () => router.navigate('/empresas'));
  await fireEvent.press(await screen.findByText('usar t2'));
  await waitFor(() => expect(screen.queryByText('Saldo da Empresa A')).toBeNull());
  await act(async () => releaseT2());
  expect(await screen.findByText('Saldo da Empresa B')).toBeTruthy();
  expect(screen.queryByText('Saldo da Empresa A')).toBeNull();
  // Empresa B: perfil vendedor, só disponível.
  expect(screen.queryByRole('link', { name: 'Registrar entrada' })).toBeNull();
  expect(calls(server, 'GET', '/api/v1/inventory').at(-1)?.headers['x-tenant-id']).toBe('t2');
  // A pendência da empresa A não vaza para a B.
  expect(intentLedger.get('u1:t2:entry:a1')).toBeUndefined();
});
