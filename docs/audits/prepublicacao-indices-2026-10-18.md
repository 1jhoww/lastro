# Lastro — índices pendentes para aprovação

Inspeção somente de leitura em 18/10/2026, projeto `lastro-hml`, banco `(default)`. **Nenhum comando de alteração foi executado.**

## Inventário

São 150 definições compostas locais; 134 correspondem a índices remotos `READY` e 16 estão ausentes. Das 87 configurações de campo, 82 correspondem e cinco isenções faltam. TTL de `rateLimits.expiresAt` está `ACTIVE`. A comparação verifica grupo, escopo, ordem, arrays e `__name__` explícito ou implícito.

O [inventário completo](evidence/prepublicacao/firestore-index-comparison.json) registra individualmente as 150 definições e 87 campos. A leitura remota não executa as consultas nem valida seus custos.

## Dezesseis índices compostos

Todos usam escopo `COLLECTION`. Os identificadores abaixo preservam a posição no arquivo local; não são IDs remotos.

| Posição local | Grupo          | Campos na ordem declarada                                      | Finalidade                                                            | Construtor                  |
| ------------: | -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------- |
|           135 | auditLogs      | resourceId ASC, occurredAt DESC                                | Histórico de auditoria por recurso de cobrança                        | BillingService              |
|           136 | billingCharges | status ASC, dueDate ASC, `__name__` ASC                        | Listagem de cobranças com filtros e ordenação de vencimento indicados | BillingService              |
|           137 | billingCharges | tenantId ASC, dueDate ASC, `__name__` ASC                      | Listagem de cobranças com filtros e ordenação de vencimento indicados | BillingService              |
|           138 | billingCharges | tenantId ASC, status ASC, dueDate ASC, `__name__` ASC          | Listagem de cobranças com filtros e ordenação de vencimento indicados | BillingService              |
|           139 | billingCharges | status ASC, dueDate DESC, `__name__` DESC                      | Listagem de cobranças com filtros e ordenação de vencimento indicados | BillingService              |
|           140 | billingCharges | tenantId ASC, dueDate DESC, `__name__` DESC                    | Listagem de cobranças com filtros e ordenação de vencimento indicados | BillingService              |
|           141 | billingCharges | tenantId ASC, status ASC, dueDate DESC, `__name__` DESC        | Listagem de cobranças com filtros e ordenação de vencimento indicados | BillingService              |
|           142 | billingCharges | status ASC, paidAt ASC                                         | Recebidos no período por estado de pagamento                          | BillingService              |
|           143 | visits         | customerId ASC, visitDate DESC                                 | Histórico de visitas com os filtros indicados, mais recentes primeiro | VisitService                |
|           144 | visits         | responsibleUid ASC, visitDate DESC                             | Histórico de visitas com os filtros indicados, mais recentes primeiro | VisitService                |
|           145 | visits         | customerId ASC, responsibleUid ASC, visitDate DESC             | Histórico de visitas com os filtros indicados, mais recentes primeiro | VisitService                |
|           146 | visits         | source ASC, visitDate DESC                                     | Histórico de visitas com os filtros indicados, mais recentes primeiro | VisitService                |
|           147 | visits         | customerId ASC, source ASC, visitDate DESC                     | Histórico de visitas com os filtros indicados, mais recentes primeiro | VisitService                |
|           148 | visits         | responsibleUid ASC, source ASC, visitDate DESC                 | Histórico de visitas com os filtros indicados, mais recentes primeiro | VisitService                |
|           149 | visits         | customerId ASC, responsibleUid ASC, source ASC, visitDate DESC | Histórico de visitas com os filtros indicados, mais recentes primeiro | VisitService                |
|           150 | orders         | customerId ASC, confirmedAt DESC                               | Histórico de compras por cliente usado na recompra                    | VisitService.customerOrders |

`BillingService` fica em `backend/src/modules/billing/billingService.ts`; `VisitService`, em `backend/src/modules/visits/visitService.ts`. `customerOrders` filtra `customerId` e ordena `confirmedAt DESC`. A descrição textual `ASC` no relatório anterior de índices da Fase 9 era imprecisa; o JSON, a consulta atual e os comandos preparados usam `DESC`.

## Cinco isenções de campo

| Grupo      | Campo        | Finalidade                                                                                 |
| ---------- | ------------ | ------------------------------------------------------------------------------------------ |
| visits     | notes        | Evitar índices automáticos em texto/snapshot não usado pelas consultas estáticas auditadas |
| visits     | customerName | Evitar índices automáticos em texto/snapshot não usado pelas consultas estáticas auditadas |
| visits     | payloadHash  | Evitar índices automáticos em texto/snapshot não usado pelas consultas estáticas auditadas |
| deliveries | notes        | Evitar índices automáticos em texto/snapshot não usado pelas consultas estáticas auditadas |
| deliveries | receivedBy   | Evitar índices automáticos em texto/snapshot não usado pelas consultas estáticas auditadas |

As isenções são divergências de configuração e custo, não índices compostos ausentes. A inspeção estática não aprova consultas futuras ou externas. Preservar todo o restante de `fieldOverrides`, inclusive TTL, provas e histórico.

## Comandos, autorização e riscos

Os [21 comandos exatos](evidence/prepublicacao/indices-para-aprovacao.txt) contêm 16 criações e cinco alterações de campos, sempre com `--project=lastro-hml --database="(default)"`. São proposta para aprovação; não constituem um script de deploy executado. A01 e A02 são autorizações separadas.

Riscos: construção pode demorar, falhar por quota e ocupar armazenamento; novos índices aumentam armazenamento e trabalho de escrita. Isenções removem índices automáticos desses campos e podem afetar um consumidor não identificado. O preenchimento retroativo alcança o dataset existente mesmo sem o operador consultar seus documentos. Não remover índices existentes, não implantar todo o arquivo indiscriminadamente e não alterar TTL. Guardar snapshot anterior e IDs das operações, sem excluir dados.

O orçamento, a quota regional/projeto e a janela devem ser confirmados antes da execução. A criação é assíncrona: resposta de comando aceita não significa `READY`. [Documentação oficial](https://firebase.google.com/docs/firestore/query-data/indexing).

## Verificação depois de autorização

1. Registrar os metadados anteriores e o diff exato aprovado. Confirmar novamente projeto e banco.
2. Executar somente os comandos aprovados; parar se o recurso já existir com definição divergente ou houver erro. Não apagar/recriar para contornar divergência.
3. Consultar metadados até todos os compostos correspondentes ficarem `READY`. Se houver falha, registrar a operação e interromper a promoção; não esperar indefinidamente ou ocultar erro.
4. Comparar as 150 definições e 87 campos novamente. Exigir zero ausências/divergências e TTL de rate limits ainda ativo.
5. Com fixtures sintéticas e testes remotos autorizados separadamente, abrir auditoria de cobrança; listar cobranças por estado, empresa, combinação e vencimento ASC/DESC; conferir recebidos por `paidAt`; listar visitas com cada combinação de cliente/responsável/origem; consultar recompra/histórico por cliente.
6. Comparar filtros, ordenação, cursor, primeira/última página e acesso do vendedor/empresa B. Exigir ausência de `FAILED_PRECONDITION` por índice e resultados corretos, não apenas HTTP 200 em dataset vazio.
7. Registrar request IDs e métricas seguras. Se uma consulta precisar de definição não prevista, interromper e preparar novo diff para autorização. Não seguir automaticamente links de criação retornados pelo Firestore.

Comandos de leitura para conferência:

```powershell
gcloud firestore indexes composite list --project=lastro-hml --database="(default)" --format=json
gcloud firestore indexes fields list --project=lastro-hml --database="(default)" --format=json
```

Esses comandos inspecionam metadados. A validação funcional privada altera contadores de rate limit e exige contas/fixtures; por isso não foi executada nesta inspeção. Produção exige inventário e autorização próprios.
