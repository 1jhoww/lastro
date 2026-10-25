/**
 * Chaves do TanStack Query. Todo dado de empresa começa com ['tenant', tenantId]: trocar de
 * empresa remove o prefixo ['tenant'] inteiro, e nenhuma tela pode ler dados de outra empresa
 * por engano porque o id faz parte da chave.
 */
export const queryKeys = {
  me: (uid: string) => ['me', uid] as const,
  tenantRoot: ['tenant'] as const,
  tenant: (tenantId: string) => ['tenant', tenantId] as const,
  tenantCurrent: (tenantId: string) => ['tenant', tenantId, 'current'] as const,
  report: (tenantId: string, id: string, query: object) =>
    ['tenant', tenantId, 'reports', id, query] as const,
  /** Nome de cada empresa na tela de escolha (só leitura de tenants/current). */
  tenantSummary: (tenantId: string) => ['tenant', tenantId, 'summary'] as const,
  /** Bytes do logotipo: a chave inclui o id do logotipo, então trocar o arquivo troca a chave. */
  tenantLogo: (tenantId: string, logoId: string) => ['tenant', tenantId, 'logo', logoId] as const,
  users: (tenantId: string) => ['tenant', tenantId, 'users'] as const,
  customers: (tenantId: string) => ['tenant', tenantId, 'customers'] as const,
  customerList: (tenantId: string, filters: object) =>
    ['tenant', tenantId, 'customers', 'list', filters] as const,
  customer: (tenantId: string, id: string) =>
    ['tenant', tenantId, 'customers', 'detail', id] as const,
  products: (tenantId: string) => ['tenant', tenantId, 'products'] as const,
  productList: (tenantId: string, filters: object) =>
    ['tenant', tenantId, 'products', 'list', filters] as const,
  product: (tenantId: string, id: string) =>
    ['tenant', tenantId, 'products', 'detail', id] as const,
  /** Bytes da imagem: a chave inclui o id da imagem, então trocar a foto troca a chave. */
  productImage: (tenantId: string, productId: string, imageId: string) =>
    ['tenant', tenantId, 'products', 'image', productId, imageId] as const,
  categories: (tenantId: string) => ['tenant', tenantId, 'categories'] as const,
  categoryList: (tenantId: string, filters: object) =>
    ['tenant', tenantId, 'categories', 'list', filters] as const,
  /** Todas as categorias (para seletores e nomes nas listas). */
  categoryLookup: (tenantId: string) => ['tenant', tenantId, 'categories', 'lookup'] as const,
  /**
   * Estoque. O saldo de um produto tem chave própria, compartilhada pela ficha do produto e pela
   * tela de estoque: a versão do estoque nunca se mistura com a versão do cadastro.
   */
  inventory: (tenantId: string) => ['tenant', tenantId, 'inventory'] as const,
  inventoryList: (tenantId: string, filters: object) =>
    ['tenant', tenantId, 'inventory', 'list', filters] as const,
  inventoryItem: (tenantId: string, productId: string) =>
    ['tenant', tenantId, 'inventory', 'item', productId] as const,
  movements: (tenantId: string, filters: object) =>
    ['tenant', tenantId, 'inventory', 'movements', filters] as const,
  replenishment: (tenantId: string, filters: object) =>
    ['tenant', tenantId, 'inventory', 'replenishment', filters] as const,
  /** Pedidos: lista, ficha, histórico e dados financeiros do pedido (só leitura). */
  orders: (tenantId: string) => ['tenant', tenantId, 'orders'] as const,
  orderList: (tenantId: string, filters: object) =>
    ['tenant', tenantId, 'orders', 'list', filters] as const,
  order: (tenantId: string, id: string) => ['tenant', tenantId, 'orders', 'detail', id] as const,
  orderHistory: (tenantId: string, id: string) =>
    ['tenant', tenantId, 'orders', 'history', id] as const,
  orderFinance: (tenantId: string, id: string) =>
    ['tenant', tenantId, 'orders', 'finance', id] as const,
  paymentOptions: (tenantId: string, kind: 'conditions' | 'methods') =>
    ['tenant', tenantId, 'payment-options', kind] as const,
  /** Entrega confirmada do pedido (registro separado; não muda o pedido). */
  orderDelivery: (tenantId: string, id: string) =>
    ['tenant', tenantId, 'orders', 'delivery', id] as const,
  /** Visitas, histórico do cliente e recompra: tudo sob o mesmo prefixo para invalidar junto. */
  visits: (tenantId: string) => ['tenant', tenantId, 'visits'] as const,
  visitList: (tenantId: string, filters: object) =>
    ['tenant', tenantId, 'visits', 'list', filters] as const,
  repurchase: (tenantId: string, filters: object) =>
    ['tenant', tenantId, 'visits', 'repurchase', filters] as const,
  customerRepurchase: (tenantId: string, id: string) =>
    ['tenant', tenantId, 'visits', 'customer-repurchase', id] as const,
  customerTimeline: (tenantId: string, id: string, limit: number) =>
    ['tenant', tenantId, 'visits', 'timeline', id, limit] as const,
  platformRoot: ['platform'] as const,
  finance: (tenantId: string) => ['tenant', tenantId, 'finance'] as const,
  receivables: (tenantId: string, filters: object) =>
    ['tenant', tenantId, 'finance', 'receivables', filters] as const,
  receivable: (tenantId: string, id: string) =>
    ['tenant', tenantId, 'finance', 'receivable', id] as const,
  dueDateChanges: (tenantId: string, receivableId: string) =>
    ['tenant', tenantId, 'finance', 'receivable', receivableId, 'due-date-changes'] as const,
  payments: (tenantId: string, orderId: string) =>
    ['tenant', tenantId, 'finance', 'payments', orderId] as const,
  financialHistory: (tenantId: string, orderId: string) =>
    ['tenant', tenantId, 'finance', 'history', orderId] as const,
  platform: (uid: string, ...rest: string[]) => ['platform', uid, ...rest] as const,
};
