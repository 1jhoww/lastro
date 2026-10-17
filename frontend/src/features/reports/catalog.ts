import type { PlanFeature, ReportId, ReportQuery } from '@/api/types';

export type ReportCategory = 'commercial' | 'financial' | 'inventory';
export type ReportFilter = 'period' | 'status' | 'customer' | 'product' | 'seller' | 'movement';

export type ReportEntry = {
  id: ReportId;
  category: ReportCategory;
  title: string;
  /** Rótulo curto para a escolha do relatório. */
  short: string;
  filters: ReportFilter[];
  statuses?: { value: NonNullable<ReportQuery['status']>; label: string }[];
  /** Recurso do plano exigido (o servidor também confere). */
  feature?: PlanFeature;
};

export const categories: { value: ReportCategory; label: string; permission?: string }[] = [
  { value: 'commercial', label: 'Comercial' },
  { value: 'financial', label: 'Financeiro', permission: 'receivables:read' },
  { value: 'inventory', label: 'Estoque', permission: 'inventory:manage' },
];

const stockStatuses = [
  { value: 'active' as const, label: 'Produtos ativos' },
  { value: 'inactive' as const, label: 'Produtos inativos' },
  { value: 'all' as const, label: 'Todos os produtos' },
];

/** Mesmos relatórios e filtros que GET /reports/{report} aceita. */
export const reports: ReportEntry[] = [
  {
    id: 'sales-period',
    category: 'commercial',
    title: 'Vendas por período',
    short: 'Vendas por período',
    filters: ['period', 'customer', 'product', 'seller'],
  },
  {
    id: 'orders-status',
    category: 'commercial',
    title: 'Pedidos por status',
    short: 'Pedidos por status',
    filters: ['period', 'status', 'customer', 'seller'],
    statuses: [
      { value: 'draft', label: 'Rascunho' },
      { value: 'confirmed', label: 'Confirmado' },
      { value: 'dispatched', label: 'Expedido' },
      { value: 'canceled', label: 'Cancelado' },
    ],
  },
  {
    id: 'sales-customers',
    category: 'commercial',
    title: 'Vendas por cliente',
    short: 'Por cliente',
    filters: ['period', 'seller'],
  },
  {
    id: 'sales-products',
    category: 'commercial',
    title: 'Vendas por produto',
    short: 'Por produto',
    filters: ['period', 'customer', 'product', 'seller'],
  },
  {
    id: 'sales-sellers',
    category: 'commercial',
    title: 'Desempenho por vendedor',
    short: 'Por vendedor',
    filters: ['period'],
    feature: 'commercial.sellers',
  },
  {
    id: 'receivables',
    category: 'financial',
    title: 'Contas a receber',
    short: 'Contas a receber',
    filters: ['period', 'status', 'customer'],
    statuses: [
      { value: 'open', label: 'Com saldo em aberto' },
      { value: 'partially_paid', label: 'Parcialmente pagas' },
      { value: 'paid', label: 'Pagas' },
      { value: 'canceled', label: 'Canceladas' },
    ],
  },
  {
    id: 'overdue',
    category: 'financial',
    title: 'Títulos vencidos',
    short: 'Vencidos',
    filters: ['period', 'customer'],
  },
  {
    id: 'upcoming',
    category: 'financial',
    title: 'Títulos a vencer',
    short: 'A vencer',
    filters: ['period', 'customer'],
  },
  {
    id: 'receipts',
    category: 'financial',
    title: 'Recebimentos por período',
    short: 'Recebimentos',
    filters: ['period', 'customer'],
  },
  {
    id: 'delinquency',
    category: 'financial',
    title: 'Inadimplência por cliente',
    short: 'Inadimplência',
    filters: ['period'],
  },
  {
    id: 'stock-position',
    category: 'inventory',
    title: 'Posição de estoque',
    short: 'Posição atual',
    filters: ['status', 'product'],
    statuses: stockStatuses,
  },
  {
    id: 'stock-low',
    category: 'inventory',
    title: 'Estoque baixo',
    short: 'Estoque baixo',
    filters: ['status'],
    statuses: stockStatuses,
  },
  {
    id: 'stock-empty',
    category: 'inventory',
    title: 'Sem estoque',
    short: 'Sem estoque',
    filters: ['status'],
    statuses: stockStatuses,
  },
  {
    id: 'stock-movements',
    category: 'inventory',
    title: 'Movimentações de estoque',
    short: 'Movimentações',
    filters: ['period', 'product', 'movement'],
  },
];

export const movementOptions: { value: NonNullable<ReportQuery['movement']>; label: string }[] = [
  { value: 'entries', label: 'Entradas' },
  { value: 'exits', label: 'Saídas' },
  { value: 'adjustments', label: 'Ajustes' },
  { value: 'reservations', label: 'Reservas' },
];

export const reportById = (id: string | undefined) => reports.find((r) => r.id === id);
