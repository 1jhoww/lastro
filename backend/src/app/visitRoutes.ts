import type { Route } from './routes.js';
import * as s from '../shared/schemas/visits.js';
import { idParams } from '../shared/schemas/http.js';
export const visitRoutes: Route[] = [
  {
    method: 'get',
    path: '/visits',
    operationId: 'listVisits',
    scope: 'tenant',
    permission: 'visits:own:manage',
    query: s.visitQuery,
    output: s.visitsPage,
    description:
      'Visitas manuais e registros automáticos de entrega, mais recentes primeiro. Vendedor vê só clientes da carteira atual, qualquer que seja o autor. Uma página pode vir com menos itens que o limite e ainda ter cursor.',
  },
  {
    method: 'post',
    path: '/visits',
    operationId: 'createVisit',
    scope: 'tenant',
    permission: 'visits:own:manage',
    body: s.visitCreate,
    output: s.visitView,
    status: 201,
    idempotent: true,
    description:
      'Registra visita ou contato manual. Não cria pedido, movimentação de estoque nem recebível. Vendedor registra só para si e para clientes da própria carteira.',
  },
  {
    method: 'get',
    path: '/repurchase',
    operationId: 'listRepurchase',
    scope: 'tenant',
    permission: 'visits:own:manage',
    query: s.repurchaseQuery,
    output: s.repurchasePage,
    description:
      'Estimativa de recompra dos clientes ativos do escopo: mediana dos intervalos entre compras confirmadas no último ano (mínimo de 3 dias de compra). Estimativa, não garantia.',
  },
  {
    method: 'get',
    path: '/customers/:id/repurchase',
    operationId: 'getCustomerRepurchase',
    scope: 'tenant',
    permission: 'visits:own:manage',
    params: idParams,
    output: s.customerRepurchaseView,
    description:
      'Última compra (pedido confirmado), última entrega confirmada e estimativa de recompra de um cliente.',
  },
  {
    method: 'get',
    path: '/customers/:id/timeline',
    operationId: 'getCustomerTimeline',
    scope: 'tenant',
    permission: 'visits:own:manage',
    params: idParams,
    query: s.timelineQuery,
    output: s.customerTimelineView,
    description:
      'Histórico do cliente: visitas manuais, entregas confirmadas e compras confirmadas, mais recentes primeiro.',
  },
  {
    method: 'get',
    path: '/orders/:id/delivery',
    operationId: 'getOrderDelivery',
    scope: 'tenant',
    permission: 'orders:own:read',
    params: idParams,
    output: s.orderDeliveryView,
  },
  {
    method: 'post',
    path: '/orders/:id/delivery',
    operationId: 'confirmOrderDelivery',
    scope: 'tenant',
    permission: 'orders:own:deliver',
    params: idParams,
    body: s.deliveryInput,
    output: s.deliveryView,
    description:
      'Confirma a entrega efetiva de um pedido expedido (uma por pedido; expedição é integral). Gera o registro automático de entrega. Repetir com os mesmos dados devolve a mesma entrega; dados diferentes: 409 DELIVERY_ALREADY_CONFIRMED. Não altera pedido, estoque nem financeiro.',
  },
];
