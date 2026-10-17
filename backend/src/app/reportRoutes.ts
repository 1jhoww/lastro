import { z } from 'zod';
import type { Route } from './routes.js';
import * as s from '../shared/schemas/reports.js';

const scope =
  'Somente dados da empresa autenticada; exige reports:read (administrador). Relatórios financeiros também exigem receivables:read e os de estoque inventory:manage. Vendas = pedidos confirmados ou expedidos pela data de confirmação; cancelados nunca entram. Recebimentos vêm apenas de recebimentos registrados. Período padrão: mês corrente, máximo de um ano; consultas acima dos limites técnicos retornam 422 REPORT_TOO_LARGE.';
export const reportRoutes: Route[] = [
  {
    method: 'get',
    path: '/reports/:report',
    operationId: 'getReport',
    scope: 'tenant',
    permission: 'reports:read',
    params: s.reportParams,
    query: s.reportQuery,
    output: s.reportView,
    description: `Relatório completo (todas as linhas) com resumo, colunas tipadas e observações. ${scope}`,
  },
  {
    method: 'get',
    path: '/reports/:report/export.csv',
    operationId: 'exportReportCsv',
    scope: 'tenant',
    permission: 'reports:read',
    params: s.reportParams,
    query: s.reportQuery,
    output: z.string(),
    binaryOutput: true,
    downloadType: 'text/csv',
    description: `CSV UTF-8/BOM com ;, identificação da empresa, período e filtros nas primeiras linhas, seguidos de todas as linhas do relatório. Valores com vírgula decimal, datas DD/MM/AAAA. Até 8 MiB. ${scope}`,
  },
  {
    method: 'get',
    path: '/reports/:report/export.pdf',
    operationId: 'exportReportPdf',
    scope: 'tenant',
    permission: 'reports:read',
    params: s.reportParams,
    query: s.reportQuery,
    output: z.string(),
    binaryOutput: true,
    downloadType: 'application/pdf',
    description: `PDF A4 com a identidade do Lastro, empresa, período, filtros, resumo e todas as linhas (até 3000; acima disso use CSV). ${scope}`,
  },
];
