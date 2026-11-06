import { Text } from 'react-native';
import { fireEvent, screen } from 'expo-router/testing-library';
import FinanceLayout from '@/app/(app)/financeiro/_layout';
import { FinanceNav, financeSections, sectionOf } from '@/features/finance/FinanceNav';
import { createFakeApi, membership, ok } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

let mockWidth = 1440;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 900, scale: 1, fontScale: 1 }),
}));

const Section = () => (
  <>
    <FinanceNav />
    <Text>conteúdo da seção</Text>
  </>
);
const overrides = {
  '(app)/financeiro/_layout': FinanceLayout,
  '(app)/financeiro/index': Section,
  '(app)/financeiro/pagar/index': Section,
  '(app)/financeiro/recorrentes': Section,
};

const receivables = ['tenant:read', 'receivables:read', 'payment-settings:manage', 'reports:read'];
const gestao = [
  ...receivables,
  'payables:read',
  'recurring:read',
  'financial-dashboard:read',
  'financial-reports:read',
  'supplier-credits:read',
];

function world(permissions: string[], role: 'administrator' | 'seller' = 'administrator') {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const server = createFakeApi().on('GET', '/api/v1/me', () =>
    ok({
      uid: 'u1',
      email: 'ana@lastro.test',
      platformAdmin: false,
      memberships: [{ ...membership('t1', role), permissions }],
    }),
  );
  return { gateway, server };
}
const open = async (permissions: string[], url = '/financeiro', role?: 'seller') => {
  const { gateway, server } = world(permissions, role);
  await renderApp({ gateway, fetch: server.fetch, initialUrl: url, overrides });
  await screen.findByText('conteúdo da seção');
};
const session = (permissions: string[], role = 'administrator') => ({
  role,
  isPlatformAdmin: false,
  permissions,
});
const labels = (permissions: string[], role?: string) =>
  financeSections(session(permissions, role)).map((i) => i.label);

beforeEach(() => {
  mockWidth = 1440;
});

describe('seções do Financeiro', () => {
  it('Gestão: seções principais primeiro, complementares depois', () => {
    expect(labels(gestao)).toEqual([
      'Visão geral',
      'Painel de gestão',
      'Contas a receber',
      'Contas a pagar',
      'Despesas recorrentes',
      'Relatórios',
      'Créditos de fornecedores',
      'Créditos',
      'Reembolsos',
      'Histórico e operações',
      'Condições e formas',
    ]);
  });
  it('plano sem Gestão não vê contas a pagar, recorrentes nem painel', () => {
    const visible = labels(receivables);
    for (const hidden of [
      'Contas a pagar',
      'Despesas recorrentes',
      'Painel de gestão',
      'Créditos de fornecedores',
    ])
      expect(visible).not.toContain(hidden);
    expect(visible).toContain('Contas a receber');
  });
  it('plano personalizado com contas a pagar sem recorrências não vê recorrências', () => {
    const visible = labels([...receivables, 'payables:read']);
    expect(visible).toContain('Contas a pagar');
    expect(visible).not.toContain('Despesas recorrentes');
  });
  it('vendedor autorizado vê só o que recebeu, sem relatórios nem contas a receber', () => {
    expect(labels(['payables:read', 'reports:read'], 'seller')).toEqual(['Contas a pagar']);
  });
  it('relatórios exigem acesso a relatórios e a uma categoria financeira', () => {
    expect(labels(['receivables:read'])).not.toContain('Relatórios');
    expect(labels(['reports:read'])).not.toContain('Relatórios');
    expect(labels(['reports:read', 'financial-reports:read'])).toEqual(['Relatórios']);
  });
  it('administrador da plataforma não recebe as seções da empresa', () => {
    expect(financeSections({ ...session(receivables), isPlatformAdmin: true })).toEqual([]);
  });
  it('rotas internas marcam a seção certa', () => {
    expect(sectionOf('/financeiro')).toBe('overview');
    expect(sectionOf('/financeiro/relatorios')).toBe('reports');
    expect(sectionOf('/financeiro/pagar/abc')).toBe('payables');
    expect(sectionOf('/financeiro/execucoes/abc')).toBe('operations');
  });
});

describe('navegação responsiva do Financeiro', () => {
  it('desktop largo: coluna lateral, sem seletor', async () => {
    await open(gestao);
    expect(screen.getByRole('link', { name: 'Contas a pagar' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Relatórios' })).toBeTruthy();
    expect(screen.getByText('Mais opções')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Trocar seção/ })).toBeNull();
  });

  it('a coluna marca a seção atual e leva às demais', async () => {
    await open(gestao, '/financeiro/pagar');
    expect(screen.getByRole('link', { name: 'Contas a pagar', selected: true })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Visão geral', selected: false })).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'Despesas recorrentes' }));
    expect(await screen.findByRole('link', { name: 'Despesas recorrentes', selected: true }));
  });

  it('a coluna esconde o que está fora do plano', async () => {
    await open(receivables);
    expect(screen.getByRole('link', { name: 'Contas a receber' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Contas a pagar' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Despesas recorrentes' })).toBeNull();
  });

  it.each([
    ['notebook pequeno', 1359],
    ['tablet', 900],
    ['celular', 390],
  ])('%s: seletor compacto no lugar da coluna', async (_, width) => {
    mockWidth = width;
    await open(gestao, '/financeiro/pagar');
    expect(screen.queryByRole('link', { name: 'Contas a receber' })).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Seção do financeiro: Contas a pagar. Trocar seção' }),
    );
    expect(await screen.findByRole('link', { name: 'Contas a receber' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Relatórios' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Condições e formas' })).toBeTruthy();
  });

  it('celular: o seletor também esconde o que está fora do plano', async () => {
    mockWidth = 390;
    await open(receivables);
    await fireEvent.press(screen.getByRole('button', { name: /Trocar seção/ }));
    expect(await screen.findByRole('link', { name: 'Contas a receber' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Contas a pagar' })).toBeNull();
  });
});
