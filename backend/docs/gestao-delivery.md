# Lastro Gestão: implantação

As regras estão na [ADR 0011](adr/0011-lastro-gestao.md). A sequência de publicação, com critérios de aceite e reversão, está no [checklist de produção](gestao-production-checklist.md). A análise dos índices está na [auditoria](../../docs/audits/indices-gestao-2026-11-04.md).

## Dados

O Firestore não tem migração de esquema e nenhuma foi executada. Todas as alterações são aditivas:

| Coleção da empresa        | Conteúdo                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `customers`               | Campos novos `relationships`, `contactName`, `isSupplier`; ausentes valem como cliente |
| `productCosts`            | Custo de referência, médio e último por produto                                        |
| `productCostEvents`       | Histórico de custos                                                                    |
| `orderCostSnapshots`      | Custo das linhas no momento da venda                                                   |
| `purchases`               | Pedidos de compra                                                                      |
| `purchaseCounters`        | Último número de compra                                                                |
| `purchaseEvents`          | Histórico da compra                                                                    |
| `purchaseReceipts`        | Recebimentos                                                                           |
| `purchaseClosures`        | Encerramentos de saldo pendente, um por compra                                         |
| `payables`                | Títulos a pagar                                                                        |
| `payablePayments`         | Pagamentos e estornos                                                                  |
| `supplierCredits`         | Créditos e valores a recuperar                                                         |
| `supplierCreditMovements` | Usos, devoluções e estornos de crédito                                                 |
| `expenseCategories`       | Categorias de despesa                                                                  |
| `recurringExpenses`       | Despesas recorrentes                                                                   |
| `financeSettings`         | Saldo de caixa informado                                                               |

`inventoryMovements` passa a aceitar os tipos `STOCK_PURCHASE_ENTRY` e `STOCK_PURCHASE_REVERSAL` e a origem `purchase`. Nada é apagado nem reescrito, e `firestore.rules` continua negando acesso direto.

## Índices

`scripts/management-indexes.mjs` gera as entradas do Gestão em `firestore.indexes.json`, a partir do que os esquemas de lista aceitam. Combinação nova de filtros exige alterar o esquema, o gerador e `tests/unit/managementIndexes.test.ts`.

## Job de recorrências

`dist/src/jobs/recurringExpenses.js` percorre as assinaturas cujo plano inclui `finance.payables`.

- **Idempotência:** o id do título vem da recorrência e da data, conferido dentro da transação. Repetir, ou rodar em paralelo, não duplica.
- **Isolamento:** cada empresa e cada recorrência falham sozinhas. Assinatura suspensa ou cancelada é ignorada, sem apagar nada.
- **Falhas:** o processo termina com código 1 se algo falhou. Uma nova execução só emite o que faltou.
- **Logs:** uma linha JSON por evento, com `severity`. Eventos: `recurring.generation.started`, `company_completed`, `company_failed`, `recurrence_failed` e `completed`, todos com o prefixo `recurring.generation.`.
- **Simulação:** `--dry-run` conta o que seria emitido e não grava nada.

Sem o job, títulos recorrentes só são gerados ao criar, alterar ou retomar a recorrência e pelo botão "Gerar títulos agora".

## Verificador de reversão

`dist/src/jobs/gestaoRollbackCheck.js` lê o banco e diz se a API anterior ainda consegue abri-lo. Não grava nada e não expõe conteúdo. O uso está na [estratégia de recuperação](../../ops/prepublication/gestao-recuperacao.md).

## Testes de estresse

Resultado de 05/11/2026, em emulador local:

| Arquivo                      | Resultado                                                          |
| ---------------------------- | ------------------------------------------------------------------ |
| `concurrentPerformance`      | 5 de 5                                                             |
| `performance`                | 6 de 6                                                             |
| `financialReceiptVolumes`    | 3 de 3                                                             |
| `financialExecutionCapacity` | 2 de 2: `cancellation` passou em 59 min; `return` passou em 56 min |

A primeira rodada de `financialExecutionCapacity` terminou em 1 de 2, porque `return` atingiu o limite de 1 h por caso na verificação final, sem falhar em nenhuma asserção. A repetição com limite de 2 h por caso concluiu os dois casos, com 20.001 provas conferidas e publicação única em `return`. Cada caso leva perto de 1 h nesta máquina, então o limite padrão ainda pode interromper uma rodada. O estresse não cobre compras nem contas a pagar.

### Como repetir com limite maior

O limite e o caso agora são configuráveis, sem editar o teste:

```powershell
$env:FINANCIAL_CAPACITY_CASE='return'; $env:FINANCIAL_CAPACITY_TIMEOUT_MS='7200000'; npm run test:integration -- tests/integration/financialExecutionCapacity.test.ts
```

- Rode em horário sem outros processos, com os emuladores livres. Cada caso leva cerca de uma hora.
- O critério de aceite é o caso passar inteiro, com a prova fragmentada conferida.
- Uma rodada periódica pode usar um disparo manual no GitHub Actions, com `timeout-minutes: 180`, separado do CI comum. Máquinas hospedadas limitam cada tarefa a 6 horas.
- Se o tempo crescer entre versões, o relatório de capacidade do teste mostra leituras e escritas por fase, o que aponta onde investigar.
