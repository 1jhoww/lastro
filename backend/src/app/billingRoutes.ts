import type { Route } from './routes.js';
import * as s from '../shared/schemas/billing.js';
import { idParams } from '../shared/schemas/http.js';

/** Manual billing administered by the Super Admin. No payment gateway is involved. */
export const billingRoutes: Route[] = [
  {
    method: 'get',
    path: '/admin/charges',
    operationId: 'listCharges',
    scope: 'platform',
    query: s.chargeListQuery,
    output: s.chargePage,
    description:
      'Cobranças por situação (vencidas, próximas do vencimento, em aberto, pagas, canceladas) e empresa.',
  },
  {
    method: 'post',
    path: '/admin/charges',
    operationId: 'createCharge',
    scope: 'platform',
    body: s.createChargeInput,
    output: s.chargeView,
    status: 201,
    description: 'Cobrança manual de uma competência; nunca duplica a mesma competência.',
  },
  {
    method: 'post',
    path: '/admin/charges/generate',
    operationId: 'generateCharges',
    scope: 'platform',
    output: s.generationResult,
    description: 'Executa agora a geração idempotente feita diariamente pelo agendador.',
  },
  {
    method: 'post',
    path: '/admin/charges/:id/pay',
    operationId: 'payCharge',
    scope: 'platform',
    params: idParams,
    body: s.payChargeInput,
    output: s.chargeView,
  },
  {
    method: 'post',
    path: '/admin/charges/:id/correct',
    operationId: 'correctCharge',
    scope: 'platform',
    params: idParams,
    body: s.correctChargeInput,
    output: s.chargeView,
    description: 'Correção auditada, inclusive estorno do registro de pagamento.',
  },
  {
    method: 'post',
    path: '/admin/charges/:id/cancel',
    operationId: 'cancelCharge',
    scope: 'platform',
    params: idParams,
    body: s.cancelChargeInput,
    output: s.chargeView,
  },
  {
    method: 'get',
    path: '/admin/charges/:id/history',
    operationId: 'getChargeHistory',
    scope: 'platform',
    params: idParams,
    output: s.chargeHistoryView,
  },
];
