# Validação local — revisão da Fase D e preparação E

Execuções em 8/10/2026, Windows, Node.js 22.16.0, Java 21.0.7, TypeScript 5.9.3, Firebase CLI 15.33.0. Auth/Firestore/Storage Emulator, projeto demo-lastro-tests e dados sintéticos. Sem deploy, commit, push, produção, dependências novas ou alteração da Atual Pet. E foi somente planejada. Históricos: [A](validation-phase-a.md), [B](validation-phase-b.md), [C](validation-phase-c.md), [D anterior — 223 casos](validation-phase-d.md).

## Resultado da retomada

| Verificação | Resultado                                   |
| ----------- | ------------------------------------------- |
| Unitários   | 96 aprovados, zero falhas                   |
| Emuladores  | 159 aprovados, zero falhas, 14 arquivos     |
| Total       | **255 aprovados, zero falhas**              |
| Regressão   | 223 casos anteriores preservados + 32 novos |

Suíte emulada final iniciada às 23:14:03, duração 462,05 segundos. Saída 0 e todos os emuladores de teste encerrados ao concluir.

Mantidos os 223 casos anteriores, sem exclusão/desabilitação. A asserção unitária que recusava onze linhas agora aceita onze distintas; duplicatas continuam recusadas. O cenário histórico de dez linhas mantém asserções, com título atualizado. Uma anotação TypeScript de fixture de cliente completo foi ajustada à nova saída nullable. Mais 32 casos: 14 unitários, 15 integração e 3 concorrência.

TypeScript strict, ESLint, build e Prettier passaram. OpenAPI 3.1 regenerado, versão 0.4.1 e 51 operações; tipos regenerados com openapi-typescript. Descrições explicam refinamentos que JSON Schema não expressa: quantidade positiva, unidade, produtos distintos, estado/total/estoque/condição. Nenhuma rota E publicada no contrato executável.

npm audit completo/runtime: zero advisories conhecidos, saída 0; scanner de segredos findings=[]. Nenhum audit fix, instalação ou override novo. Isso não equivale a pentest, ASVS completo ou ausência de vulnerabilidade desconhecida.

## O que foi removido e preservado

- Teto comercial de dez linhas removido na entrada e na saída, sem novo teto por quantidade de produtos. Schema aceita também mil linhas compactas; **mil linhas não foram confirmadas em integração**.
- Sem pedido mínimo monetário ou quantidade comercial mínima por produto. Uma unidade e 0.001 KG são válidos conforme precisão; confirmação exige total positivo. R$0,01 e R$5,00 passaram. Dinheiro zero, desconto integral e arredondamento a zero não confirmam.
- Rascunhos podem omitir cliente/linhas/condição e posteriormente ser completados; fields null/arrays vazios são permitidos. Nenhum efeito de estoque/financeiro antes da confirmação.
- Quantidade zero/negativa, precisão incompatível, produto repetido, preço/total/tenant/saldo/ator externos continuam inválidos. Limites numéricos/monetários, doze parcelas, segurança HTTP e limites Firestore permanecem.
- Snapshots/preços/descontos/parcelas/recebíveis, autorização atual, idempotência/auditoria e um commit transacional foram preservados. Lookup de linha do adaptador passou de busca repetida para Map.

## Capacidade efetivamente exercitada

Uma linha: integração com uma unidade/1 centavo e uma unidade/500 centavos, além de 0.001 KG/1 centavo. Confirmações 20/50/100/200: nomes 160 caracteres ASCII, descrições 2000 ASCII, notas 1000, desconto aprovado 12,5%, doze parcelas. Para cada tamanho: confirmar, repetir chave, conferir parcelas/recebíveis, expedir, confirmar segundo pedido e cancelar, reconciliar **todos os produtos**. Físico final=1, reservado=0, cinco movimentos por produto. O caso anterior de dez produtos continua aprovado.

| Produtos | Confirmação ms | Replay ms | Expedição ms | Cancelamento ms | Pedido bytes | Operação bytes (máximo) | Escritas | Leituras lógicas |
| -------- | -------------- | --------- | ------------ | --------------- | ------------ | ----------------------- | -------- | ---------------- |
| 20       | 276            | 159       | 222          | 268             | 53918        | 54227                   | 77       | 104              |
| 50       | 342            | 144       | 283          | 312             | 127358       | 127667                  | 167      | 224              |
| 100      | 411            | 172       | 355          | 401             | 249758       | 250067                  | 317      | 424              |
| 200      | 796            | 164       | 600          | 619             | 494558       | 494867                  | 617      | 824              |

Tempos são uma amostra HTTP local por ação, com preparação de fixtures fora do cronômetro; não são p95/p99, benchmark de cem usuários ou SLA. Bytes usam fórmula oficial de armazenamento, não JSON/protobuf/índices. Leitura/escrita são contagens lógicas por análise do código, não faturamento: 3N+P+5 escritas e até 4N+P+12 leituras com desconto aprovado. Para 200/P12: 617/824. Retries aumentam trabalho/custo.

## Integridade e concorrência

- Insuficiência na última das 200 linhas deixa pedido draft, nenhum recebível/reserva/operação e nenhum reservado, sem confirmar as demais.
- Falha sintética após staging de 200 linhas/auditoria não deixa escrita parcial; retirar falha e repetir a mesma chave confirma integralmente.
- Duas confirmações de 200 produtos pela última unidade: uma resposta 200 e outra 409, 200 reservas e doze recebíveis do único vencedor. Tempo conjunto 4558 ms.
- Duas requisições simultâneas com mesma chave de 200 linhas: ambas 200 e resultado idêntico, somente 200 reservas/doze recebíveis; 400 movimentos incluem 200 entradas e 200 reservas, sem duplicação. Tempo conjunto 4807 ms.
- Expedição versus cancelamento de 200 produtos: um 200/um 409; todos os saldos e recebíveis seguem o estado vencedor, sem intercalação parcial.
- Regressões incluem rollback de expedição/cancelamento, parcelas alteradas/ausentes, bloqueio de cancelamento com pagamentos, isolamento entre empresas, carteira/perfil/assinatura alterados antes do commit, autorização atual no replay e corrupção sanitizada.

## Limites técnicos e risco residual

Documento Firestore: 1 MiB. Pré-validação avalia order e snapshot de orderOperations antes de qualquer escrita. Teste com 200 descrições de 2000 caracteres UTF-8 de três bytes retorna 413 ORDER_TECHNICAL_LIMIT e nenhuma criação de pedido/reserva/recebível/operação. Não foi reduzido/truncado snapshot nem dividido commit. JSON permanece 64 KiB; excedê-lo também gera recusa segura, sem substituir por teto comercial de linhas.

Requisição Firestore: 10 MiB; transação 270 s/60 s ociosa e prazo de lock documentado. Número publicado 500 refere-se a transformações de campo por documento, não a um teto comercial geral de escritas; estas operações não fazem transformações de campo. Serviço mantém commit atômico e rejeita operações tecnicamente excedentes. O handler sanitiza erros conhecidos de tamanho; demais falhas ficam seguras, sem sucesso parcial.

[Quotas oficiais](https://firebase.google.com/docs/firestore/quotas), [transações](https://firebase.google.com/docs/firestore/manage-data/transactions), [tamanho](https://firebase.google.com/docs/firestore/storage-size). O emulador não reproduz todos os limites, índices e locks de produção: [limitações oficiais](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production). Bytes reais de commit/índices, contenção/retries/produtos muito disputados, carga de 100 usuários, custo para 10/50/100 empresas, SLO/autoscaling/backup-restauração produtivos continuam pendentes em ambiente aprovado. As isenções de índice D existem declaradas; não foram implantadas.

Para ultrapassar o documento agregado, há [proposta de linhas imutáveis por versão](proposals/large-order-snapshots.md), com publicação íntegra, paginação, compatibilidade e reconstrução de replay. **Mudança estrutural não executada e depende de aprovação.** Mesmo essa alternativa precisa respeitar bytes totais/prazo do commit; não promete capacidade infinita.

## Falhas de preparo diagnosticadas

A execução anterior interrompida terminou com seis falhas: rate limit do preparo extensivo e limpeza de fixture depois de disputa. A primeira retomada validou todos os quinze casos novos de integração, mas 27 casos falharam **antes das asserções**, na limpeza clearData por Transaction lock timeout do emulador. O relatório dessa tentativa foi preservado em reports/emulator-tests-before-cleanup-retry.raw.json.

O preparo dos dois arquivos de capacidade usa rateLimitMax=10000 apenas no app sintético da fixture; demais testes/configuração real mantêm seus limites e provas de 429. A limpeza local aguarda confirmação do DELETE e retenta somente resposta conhecida de lock (409/500), com deadline de 90 segundos; hookTimeout=120 segundos. Não retenta comandos da aplicação nem asserções; erro diferente/persistente ainda falha. Na execução final, uma limpeza exigiu vinte retries conhecidos (aproximadamente sessenta segundos até liberar locks), depois confirmou sucesso e o caso de rollback/retry passou. Ajuste baseado no log de clearData e na limitação oficial do emulador. Casos não foram mascarados/desabilitados.

Mensagem Storage “Picked up JAVA_TOOL_OPTIONS” continua informativa; as provas reais de Rules/upload privado passaram. Logs não serviram de justificativa para ignorar falhas.

## Arquivos desta revisão

- src/shared/schemas/orders.ts; src/modules/orders/orderService.ts; src/modules/orders/technicalSize.ts.
- src/modules/inventory/orderStockAdapter.ts; src/middlewares/errorHandler.ts; src/modules/auth/openapi.ts.
- tests/helpers/fixture.ts; tests/helpers/largeOrders.ts; vitest.config.ts.
- tests/unit/orders.test.ts; tests/unit/orderSizing.test.ts; tests/integration/orders.test.ts; tests/integration/orderCapacity.test.ts; tests/concurrency/orderCapacity.test.ts; tests/security/orders.test.ts.
- docs/api/openapi.json; docs/api/generated-types.ts; docs/api/frontend-contract.md.
- docs/phase-d.md; docs/phase-e.md; docs/validation.md; docs/validation-phase-d.md; docs/proposals/large-order-snapshots.md.
- docs/adr/0007-pedidos-reservas-e-recebiveis.md; docs/architecture/foundation.md; docs/architecture/data-model.md; docs/security.md; backend/README.md; CONTEXT.md na raiz.

Relatórios brutos em reports/ são ignorados. Package/lockfile/Rules/índices/infraestrutura não mudaram nesta revisão.

## Ambiente local e reprodução

Os emuladores de desenvolvimento demo-lastro-phase-a estavam ocupando as portas. Dados Auth/Firestore/Storage foram exportados em backend/.local/pre-phase-d-validation antes de encerrar somente os processos identificados do Lastro. Após a suíte, os emuladores existentes foram restaurados com importação desse snapshot, sem seed destrutivo nem alteração de configuração; o CLI confirmou All emulators ready. API local existente: GET /openapi.json retornou OpenAPI 3.1.0/versão 0.4.1 e GET /health/ready retornou status ok. Processos de API já existentes não foram encerrados. Snapshot/logs locais são ignorados no .gitignore; não substituem backup/restauração produtivos.

Na pasta backend, usar pwsh -File scripts/npm.ps1 run com test; test:integration; typecheck; lint; format:check; build; openapi; types:api; audit:secrets. Npm global está quebrado, wrapper usa npm-cli junto ao Node. JDK 21 em JAVA_HOME. Suíte recusa projeto real/host remoto/bucket diferente e roda sequencialmente com um worker. Audit usa registro público, cache .cache/npm, sem alteração de pacotes.

Fase E: [plano detalhado](phase-e.md), contratos propostos, condições/formas por empresa, permissões, diário/invariantes, recebimentos parciais/estornos/créditos/cancelamentos, migração, riscos, critérios de teste e decisões pendentes. Nenhuma implementação E, integração bancária ou devolução física adicionada.
