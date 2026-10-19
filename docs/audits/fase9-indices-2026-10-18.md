# Lastro — Fase 9: índices de homologação

Consulta somente de leitura atualizada em 18/10/2026 às 19:20:47, America/Sao_Paulo (22:20:47 UTC), projeto `lastro-hml`, banco `(default)`.
Nenhum índice, TTL ou configuração remota foi alterado.

## Resultado

- Repositório: 150 índices compostos e 87 configurações de campo.
- Homologação: 134 compostos, todos `READY`; 16 definições locais estão ausentes.
- Configurações de campo: 82 correspondem, cinco isenções estão ausentes.
- O TTL declarado de `rateLimits.expiresAt` está `ACTIVE`.
- A comparação considera coleção, escopo, sequência de campos, ordenação, arrays e `__name__` explícito ou implícito.
- O inventário completo, com posição no arquivo local e estado remoto de cada definição, está em [firestore-indexes.json](evidence/fase9/firestore-indexes.json).

## Consultas consumidoras

As combinações exatas de filtros e ordenação são os campos de cada entrada do inventário. Esta tabela associa todas as coleções declaradas aos construtores das consultas. A associação é estática; não representa medição de utilização ou de custo remoto.

| Coleção/grupo                 | Consulta e fonte                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| financialActiveSources        | Fontes ativas por pedido, geração, tipo e título; `backend/src/modules/finance/resolution/sourceIndex.ts` e `executionPhases.ts`                                 |
| financialExecutionSourcePlans | Fontes planejadas por execução e posição; `finance/resolution/executionPhases.ts`                                                                                |
| financialExecutionLotPlans    | Lotes por execução e posição; `finance/resolution/executionPhases.ts`                                                                                            |
| financialExecutionStockPlans  | Estoque planejado por execução e posição; `finance/resolution/executionPhases.ts`                                                                                |
| financialProofEntries         | Provas por execução/posição; `finance/resolution/proofStorage.ts` e `proofs.ts`                                                                                  |
| financialProofChunks          | Fragmentos de prova por execução/posição; `finance/resolution/proofStorage.ts` e `proofs.ts`                                                                     |
| financialExecutions           | Execuções por pedido/estado; `finance/resolution/executionService.ts` e `financialReads.ts`                                                                      |
| returnEvents                  | Eventos por devolução, versão de schema e sequência; `infrastructure/repositories/foundationRepository.ts` e `finance/resolution/economicView.ts`                |
| invitations                   | Convites por estado/email/vencimento; `modules/users/userService.ts` e `capacity.ts`                                                                             |
| memberships                   | Vínculos por estado/papel; `modules/users/userService.ts` e `capacity.ts`                                                                                        |
| customers                     | Lista e carteira por responsável, estado, nome e documento; `modules/customers/customerService.ts` e `infrastructure/repositories/commercialRepository.ts`       |
| products                      | Lista/busca por estado, categoria, nome, SKU e preço; `modules/products/productService.ts` e `commercialRepository.ts`                                           |
| categories                    | Categorias por estado/nome; `modules/categories/categoryService.ts` e `commercialRepository.ts`                                                                  |
| inventory                     | Reposição/saldos por estado e ordenação; `modules/inventory/inventoryService.ts`                                                                                 |
| inventoryMovements            | Histórico e relatórios por produto, tipo, data e sequência; `modules/inventory/inventoryService.ts` e `modules/reports/reportService.ts`                         |
| orders                        | Lista por estado, cliente, responsável e datas; `modules/orders/orderService.ts`; recompra em `modules/visits/visitService.ts`; relatórios em `reportService.ts` |
| orderEvents                   | Eventos por pedido e data; `modules/orders/orderService.ts`                                                                                                      |
| paymentConditions             | Condições por estado/nome; `modules/finance/paymentSettingsService.ts`                                                                                           |
| paymentMethods                | Formas por estado/nome; `modules/finance/paymentSettingsService.ts`                                                                                              |
| receivables                   | Títulos por cliente, pedido, estado e vencimento; `modules/finance/financialReads.ts` e `modules/reports/reportService.ts`                                       |
| financialEvents               | Reconciliação por pedido/seqüência; `modules/finance/financialReads.ts` e `financialBook.ts`                                                                     |
| creditApplications            | Aplicações por pedido, lote e data; `modules/finance/financialReads.ts` e `financialCommands.ts`                                                                 |
| payments                      | Recebimentos por pedido, cliente e data; `modules/finance/financialReads.ts` e `modules/reports/reportService.ts`                                                |
| refundObligations             | Devoluções financeiras por pedido, cliente, estado e data; `modules/finance/financialReads.ts`                                                                   |
| creditLots                    | Crédito por cliente, estado e data; `modules/finance/financialReads.ts`                                                                                          |
| auditLogs                     | Auditoria de recurso por `resourceId` e `occurredAt DESC`; `modules/billing/billingService.ts`                                                                   |
| billingCharges                | Cobranças por empresa, estado, vencimento e `paidAt`; `modules/billing/billingService.ts`                                                                        |
| visits                        | Histórico por cliente, responsável, origem e data; `modules/visits/visitService.ts`                                                                              |

Os caminhos abreviados acima partem de `backend/src/`. O inventário preserva todas as 150 combinações; nenhuma definição foi excluída como redundante.

## Pendências e impacto

| Ausência                                                                        | Quantidade | Fluxo afetado                              |
| ------------------------------------------------------------------------------- | ---------: | ------------------------------------------ |
| auditLogs: resourceId ASC, occurredAt DESC                                      |          1 | Histórico de auditoria da cobrança         |
| billingCharges: filtros por empresa/estado e vencimento ASC/DESC, estado/paidAt |          7 | Listagens e filtros do painel de cobranças |
| visits: combinações de cliente, responsável e origem, visitDate DESC            |          7 | Histórico e filtros de visitas             |
| orders: customerId ASC, confirmedAt ASC                                         |          1 | Histórico de compras usado na recompra     |
| visits: notes, customerName, payloadHash sem índices de campo                   |          3 | Isenções de indexação e custo de escrita   |
| deliveries: notes, receivedBy sem índices de campo                              |          2 | Isenções de indexação e custo de escrita   |

Os 16 índices faltantes são risco funcional real de publicação. As cinco isenções faltantes são divergência de configuração e custo; não equivalem à falta de um índice de consulta.

## Comandos para aprovação

Os 16 comandos `gcloud firestore indexes composite create` e cinco comandos de isenção estão em [pending-index-commands.txt](evidence/fase9/pending-index-commands.txt). Os argumentos foram conferidos na ajuda da CLI instalada. **Não executados.**

Inspeção usada:

```powershell
gcloud firestore indexes composite list --project=lastro-hml --database="(default)" --format=json
gcloud firestore indexes fields list --project=lastro-hml --database="(default)" --format=json
```

Após aprovação e criação, é necessário aguardar `READY`, repetir a comparação e executar as consultas reais em homologação. Metadados `READY` não comprovam que todas as combinações de consulta do produto foram executadas remotamente.

O [Firestore Emulator não valida índices compostos](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production). Consulte também a [documentação oficial de índices](https://firebase.google.com/docs/firestore/query-data/indexing).
