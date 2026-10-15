# Entrega local da Fase E — Financeiro

## Funcionalidades

Condições de pagamento por empresa com presets, pesos e até doze parcelas; formas de pagamento independentes; seletores comerciais autorizados; preview calculado pelo backend; snapshots na confirmação e dias corridos no fuso empresarial, sem ajuste de feriados.

Recebíveis compatíveis com D; recebimentos parciais/integral com alocações explícitas por título de um único pedido; rejeição de excedentes; estornos compensadores; créditos com origem comprovada, aplicação e reversão; cancelamento financeiro com restauração de crédito e destino somente do caixa liquidado; obrigações e confirmações manuais parciais/integral, sem integração bancária.

Devoluções de expedidos com intenção integral/parcial, correção ou cancelamento somente do saldo físico pendente, recebimentos parciais, qualidade por linha, estoque somente após confirmação física de unidades revendáveis e bloqueio desde a intenção até encerrar todas as pendências físicas e financeiras daquele pedido.

Danificados ficam separados do estoque vendável. Resolução exige decisão administrativa por linha; aceita valor integral, parcial ou zero. Limites vêm do preço/desconto confirmado, com arredondamento cumulativo. Redução monetária já decidida não reaparece em retornos posteriores. Abatimento consome dívida aberta, depois restaura crédito às fontes, depois destina caixa a crédito ou obrigação manual.

## Endpoints

Todos abaixo usam `/api/v1`, Bearer e tenant autorizado. Catálogo completo, schemas e permissões estão no [OpenAPI](api/openapi.json).

| Método                     | Recurso                                                                                                 | Resultado                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| GET/POST; GET/PATCH por ID | payment-conditions, payment-methods                                                                     | Cadastros administrativos versionados                              |
| GET                        | orders/payment-options/conditions, orders/payment-options/methods                                       | Seleção comercial autorizada                                       |
| POST                       | orders/{id}/payment-preview                                                                             | Parcelamento calculado sem efeitos                                 |
| POST/PATCH                 | orders, orders/{id}                                                                                     | Condição e forma prevista separadas, com compatibilidade D         |
| GET                        | receivables, receivables/{id}, orders/{id}/financial-state                                              | Títulos e versões financeiras                                      |
| GET; POST                  | payments, payments/{id}; orders/{id}/receipts                                                           | Consulta e recebimento alocado                                     |
| POST                       | payments/{id}/reversals                                                                                 | Estorno parcial/integral auditado                                  |
| GET; POST                  | customers/{id}/credits; orders/{id}/credit-applications                                                 | Origem e aplicação de crédito                                      |
| GET; POST                  | credit-applications, credit-applications/{id}; credit-applications/{id}/reversals                       | Consulta e reversão de aplicação                                   |
| POST                       | orders/{id}/financial-cancellation                                                                      | Cancelamento com efeitos financeiros e de estoque atômicos         |
| GET; POST; GET             | refund-obligations, refund-obligations/{id}; refund-obligations/{id}/confirm; refund-confirmations/{id} | Obrigação e comprovação manual                                     |
| GET                        | orders/{id}/financial-history, orders/{id}/financial-reconciliation                                     | Diário e reconciliação paginados                                   |
| POST; GET; PATCH           | orders/{id}/returns; returns, returns/{id}; returns/{id}                                                | Intenção, consulta e correção pendente                             |
| POST                       | returns/{id}/cancel-pending                                                                             | Cancelamento auditado do saldo físico                              |
| POST/GET; GET              | returns/{id}/receipts; returns/{id}/history                                                             | Recebimento físico e histórico                                     |
| GET                        | returns/{id}/resolution-preview                                                                         | Novo nesta conclusão: limites monetários e versões sem efeitos     |
| POST                       | returns/{id}/resolve                                                                                    | Alterado nesta conclusão: acceptedCents opcional no aceite de dano |

O contrato vigente é OpenAPI 3.1, versão 0.5.1, com 91 operações reais A–E. Nenhum endpoint modifica saldos diretamente, distribui entre pedidos ou chama banco.

## Modelo de Dados

Coleções empresariais E: paymentConditions, paymentMethods, paymentSettingNames, financialTitles, financialOrderStates, payments, creditLots, creditApplications, refundObligations, refundConfirmations, financialEvents, financialOperations, returns, returnEvents, orderReturnLines e returnReceipts.

Receivables, pedidos, expedições, reservas consumidas e operações históricas D permanecem como origem. Projeções E são materializadas sem reescrita histórica. Autoria, tenant e limites são autoridade do backend; documentos monetários e operações auditadas compartilham transação.

Esta conclusão acrescenta `damagedValueReductionCents` opcional nas linhas de returns e em orderReturnLines, também preservado nos eventos imutáveis. A ausência em documento histórico significa zero para cálculo, sem alterar sua prova/hash. Projeção pública informa zero explicitamente. Valor resolvido acumulado = nominal half-up da quantidade elegível − redução administrativa acumulada.

## Validação

**364 testes aprovados, zero falhas:** 132 unitários em nove arquivos e 232 com Firebase Emulators em dezenove arquivos. Regressão completa iniciada em 9/10/2026 às 16:23:05 (America/Sao_Paulo), duração 687,37 s, saída zero. Incrementos anteriores à regressão: 39 testes financeiros emulados e 34 de devolução emulados, todos aprovados. Os 25 novos testes preservam os 339 anteriores; nenhum removido, desabilitado ou reduzido.

TypeScript strict, lint, formatação e build aprovados; OpenAPI e tipos regenerados. Auditorias npm completa/runtime: zero advisories conhecidos. Scanner de segredos: nenhum achado. Emuladores de teste encerrados. Evidências locais em reports/unit-tests.raw.json, reports/emulator-tests.raw.json, reports/phase-e-finance-revalidation.raw.json e reports/phase-e-returns-revalidation.raw.json. Reprodução e detalhes em [validação E](validation-phase-e.md).

## Concorrência e Recuperação

Incrementos passaram nas disputas de crédito versus estorno, intenção versus recebimento/estorno/aplicação de crédito e recebimento físico versus cancelamento pendente. Uma versão tem um vencedor. Mesma chave concorrente produz resposta original e um efeito; mudança de payload é recusada. Múltiplas intenções abertas mantêm bloqueio até a última pendência encerrar.

Falha após staging de recebimento, cancelamento, retorno físico ou resolução não deixa efeitos parciais. Retry com a mesma chave recupera operação. Aceite monetário parcial com falha preserva títulos, fontes, redução cumulativa e bloqueio. Asserções verificam reconciliação financeira e estoque, incluindo 200 produtos. Esses testes não simulam restauração de desastre em produção.

## Limitações

HTTP JSON 64 KiB, documentos 1 MiB e limites transacionais reais do Firestore continuam aplicáveis; recusa é integral. Snapshots grandes não foram normalizados. Muitos lançamentos/fontes podem atingir tamanho, tempo ou contenção. Emulação não comprova índices produtivos, SLO, custo, carga de cem usuários, IAM ou recuperação de desastre.

Sem banco, gateway, fiscal, juros, taxas, perda, fechamento contábil ou distribuição automática. Reclassificação/descarte físico de danificados, correção de físico/resolução concluídos, estorno de restituição já confirmada e mudança de destino consumido exigem contratos compensadores próprios.

## Arquivos e Integração

Documentação vigente: [Fase E](phase-e.md), [proposta aprovada](proposals/dispatched-returns.md), [modelo de dados](architecture/data-model.md), [permissões](architecture/permissions.md), [contrato frontend](api/frontend-contract.md), [OpenAPI](api/openapi.json), [tipos TypeScript](api/generated-types.ts) e [validação](validation.md).

Alterações desta conclusão: src/shared/schemas/returns.ts; src/modules/returns/{calculation,returnService}.ts; src/app/{returnRoutes,routes}.ts; src/modules/auth/openapi.ts; tests/unit/{returns,policy}.test.ts; tests/integration/{returns,financeSettlement}.test.ts; documentação acima, docs/{security,validation-phase-e}.md, README backend e este relatório. Os módulos financeiros E previamente existentes foram revalidados.

Claude deve consumir generated-types.ts e os DTOs do OpenAPI. Dinheiro é inteiro em centavos; quantidade é string decimal. Usar Idempotency-Key UUID por intenção e as versões atuais. Não recalcular parcelamento ou limites de dano no frontend. Após CONFLICT, recarregar e revisar decisão administrativa. Após perda de resposta, repetir chave/payload originais. Constituir refundObligation não significa dinheiro devolvido; registrar confirmação manual somente após devolução efetiva.

Nenhum deploy, commit, push, recurso pago, acesso à produção ou alteração de projeto Atual Pet foi realizado. Trabalho desta conclusão restrito ao backend local do Lastro.
