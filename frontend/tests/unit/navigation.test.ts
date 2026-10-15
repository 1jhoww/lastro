import { isActive } from '@/layout/isActive';
import { canCreateOrder, visibleDestinations } from '@/navigation/destinations';

const seller = [
  'tenant:read',
  'products:read',
  'inventory:available:read',
  'customers:own:manage',
  'orders:own:create',
  'orders:own:confirm',
  'orders:own:read',
  'orders:own:dispatch',
  'documents:own:read',
];

describe('navegação por permissão', () => {
  it('vendedor vê estoque (só disponível), mas não financeiro', () => {
    const keys = visibleDestinations(seller).map((d) => d.key);
    expect(keys).toEqual(['inicio', 'pedidos', 'clientes', 'produtos', 'estoque', 'configuracoes']);
    expect(canCreateOrder(seller)).toBe(true);
  });

  it('sem permissão de estoque, o menu de estoque some', () => {
    const keys = visibleDestinations(seller.filter((p) => p !== 'inventory:available:read')).map(
      (d) => d.key,
    );
    expect(keys).not.toContain('estoque');
  });

  it('sem permissões, nada aparece', () => {
    expect(visibleDestinations([])).toEqual([]);
    expect(canCreateOrder([])).toBe(false);
  });

  it('rota ativa considera subrotas, mas não a raiz', () => {
    expect(isActive('/pedidos/novo', '/pedidos')).toBe(true);
    expect(isActive('/pedidosx', '/pedidos')).toBe(false);
    expect(isActive('/pedidos', '/')).toBe(false);
    expect(isActive('/', '/')).toBe(true);
  });
});
