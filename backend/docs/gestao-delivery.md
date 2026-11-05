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

| Arquivo                      | Resultado                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `concurrentPerformance`      | 5 de 5                                                                               |
| `performance`                | 6 de 6                                                                               |
| `financialReceiptVolumes`    | 3 de 3                                                                               |
| `financialExecutionCapacity` | 1 de 2: `cancellation` passou em 58 min; `return` estourou o limite de 1 h por caso  |

`return` não falhou em nenhuma asserção. Aplicou as 20.001 fontes e estava na verificação final quando o limite interrompeu o caso, então a conferência final desse caso não foi comprovada nesta máquina. O código de `finance/resolution` não mudou nesta entrega, e o estresse não cobre compras nem contas a pagar.

### Risco residual

Fica em aberto a conferência final de uma devolução financeira com 20 mil fontes num mesmo pedido. Em outras palavras, um pedido com esse volume extremo poderia concluir a aplicação e encontrar um problema só na verificação final. O risco é baixo: os mesmos caminhos passaram no caso `cancellation`, e os testes de execução financeira com volumes normais passam. Vale o aceite explícito enquanto a comprovação não for repetida. Compras e contas a pagar não dependem desse cenário.

### Como validar sem o limite de uma hora

O limite e o caso agora são configuráveis, sem editar o teste:

```powershell
$env:FINANCIAL_CAPACITY_CASE='return'; $env:FINANCIAL_CAPACITY_TIMEOUT_MS='7200000'; npm run test:integration -- tests/integration/financialExecutionCapacity.test.ts
```

- Rode em horário sem outros processos, com os emuladores livres. A rodada leva pouco mais de uma hora.
- O critério de aceite é o caso passar inteiro, com a prova fragmentada conferida.
- Uma rodada periódica pode usar um disparo manual no GitHub Actions, com `timeout-minutes: 180`, separado do CI comum. Máquinas hospedadas limitam cada tarefa a 6 horas.
- Se o tempo crescer entre versões, o relatório de capacidade do teste mostra leituras e escritas por fase, o que aponta onde investigar.
