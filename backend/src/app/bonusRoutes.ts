import { z } from 'zod';
import type { Route } from './routes.js';
import * as s from '../shared/schemas/bonuses.js';
import { idParams } from '../shared/schemas/http.js';

const scope =
  'Administrador vê a empresa inteira; vendedor com bonuses:grant vê só as bonificações sob sua responsabilidade, de clientes da carteira atual.';
export const bonusRoutes: Route[] = [
  {
    method: 'get',
    path: '/bonuses',
    operationId: 'listBonuses',
    scope: 'tenant',
    permission: 'bonuses:grant',
    query: s.bonusQuery,
    output: s.bonusesPage,
    description: `Histórico de bonificações vinculadas e avulsas, pela data de confirmação ou de registro, mais recentes primeiro. Rascunhos não aparecem. ${scope} Uma página pode vir com menos itens que o limite e ainda ter cursor.`,
  },
  {
    method: 'post',
    path: '/bonuses',
    operationId: 'createBonus',
    scope: 'tenant',
    permission: 'bonuses:grant',
    body: s.bonusCreate,
    output: s.bonusView,
    status: 201,
    idempotent: true,
    description:
      'Registra bonificação avulsa: a saída de estoque acontece nesta chamada, no mesmo commit. Não cria pedido, recebível nem faturamento. Estoque insuficiente recusa o lançamento inteiro. Vendedor registra só para si e para clientes da própria carteira.',
  },
  {
    method: 'get',
    path: '/bonuses/:id',
    operationId: 'getBonus',
    scope: 'tenant',
    permission: 'bonuses:grant',
    params: idParams,
    output: s.bonusDetailView,
    description: `Detalhe, histórico e, somente com costs:read, custo congelado na origem e líquido de retornos vendáveis. ${scope}`,
  },
  {
    method: 'post',
    path: '/bonuses/:id/returns',
    operationId: 'returnBonus',
    scope: 'tenant',
    permission: 'returns:manage',
    params: idParams,
    body: s.bonusReturnInput,
    output: s.bonusView,
    idempotent: true,
    description:
      'Retorno parcial ou total de bonificação que já saiu do estoque. Vendável volta ao físico sem alterar o custo médio; danificado fica registrado e não movimenta estoque. Sem efeito financeiro. Somente administrador.',
  },
  {
    method: 'get',
    path: '/bonuses/:id/receipt.pdf',
    operationId: 'downloadBonusReceipt',
    scope: 'tenant',
    permission: 'bonuses:grant',
    params: idParams,
    output: z.string(),
    binaryOutput: true,
    downloadType: 'application/pdf',
    description: `Comprovante não fiscal com produtos, quantidades e "Sem cobrança", sem valores. Mesmos limites dos PDFs de pedido; rascunho retorna 409 DOCUMENT_UNAVAILABLE. ${scope}`,
  },
];
