import { z } from 'zod';
import type { Route } from './routes.js';
import { idParams } from '../shared/schemas/http.js';
import * as s from '../shared/schemas/documents.js';

export const documentRoutes: Route[] = [
  {
    method: 'get',
    path: '/orders/:id/documents/commercial.pdf',
    operationId: 'downloadCommercialOrder',
    scope: 'tenant',
    permission: 'documents:own:read',
    params: idParams,
    output: z.string(),
    binaryOutput: true,
    downloadType: 'application/pdf',
    description:
      'Pedido comercial histórico; não fiscal. Até 8 MiB/100 páginas/10 segundos de renderização; orçamento total de 30 segundos para leitura/renderização/revalidação. PDFs e CSV compartilham duas operações simultâneas por instância, inclusive RPC ainda pendente após timeout. Carteira e autorização atuais; mudanças durante geração retornam 409. Até 30 downloads de documentos/exportações por usuário/hora.',
  },
  {
    method: 'get',
    path: '/orders/:id/documents/packing.pdf',
    operationId: 'downloadPackingOrder',
    scope: 'tenant',
    permission: 'documents:own:read',
    params: idParams,
    output: z.string(),
    binaryOutput: true,
    downloadType: 'application/pdf',
    description:
      'Romaneio de entrega A4: comprovante de recebimento não fiscal com produtos, quantidades expedidas (expedição é sempre integral), valor de cada linha, valor total e campos para assinatura manual. Somente pedidos confirmados ou expedidos (409 DOCUMENT_UNAVAILABLE). Gerar ou assinar não altera o status do pedido. Mesmos limites e autorização do PDF comercial.',
  },
  ...(
    [
      ['customers', 'exportCustomers', s.customerExportQuery],
      ['products', 'exportProducts', s.productExportQuery],
      ['orders', 'exportOrders', s.orderExportQuery],
      ['receivables', 'exportReceivables', s.receivableExportQuery],
    ] as const
  ).map(([resource, operationId, query]): Route => ({
    method: 'get',
    path: `/exports/${resource}.csv`,
    operationId,
    scope: 'tenant',
    permission: 'reports:read',
    query,
    output: z.string(),
    binaryOutput: true,
    downloadType: 'text/csv',
    description: `CSV administrativo UTF-8/BOM; delimitador ;, CRLF, datas DD/MM/AAAA (pedido: UTC), centavos formatados com vírgula. Uma página por download; continuar X-Next-Cursor até ausência, inclusive página vazia. Máximo 1 MiB, 100 registros (pedidos/recebíveis: 10); PDFs e CSV compartilham duas operações simultâneas/instância. Prazo total de 30 segundos inclui leituras e revalidação; SDK pendente conserva cota. Orçamento de leitura: 32 MiB de JSON acumulado com margem 2x; READ_MEMORY_LIMIT exige reduzir limit. Até 30 downloads/usuário/hora. Filtros e defaults do leitor correspondente. ${resource === 'receivables' ? 'Também exige receivables:read; saldo vem da projeção financeira validada.' : ''}`,
  })),
];
