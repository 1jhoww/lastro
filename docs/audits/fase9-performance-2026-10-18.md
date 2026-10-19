# Lastro — Fase 9: performance, capacidade e publicação

Execução local concluída em 18/10/2026, America/Sao_Paulo. **Otimizações validadas localmente, com 494/494 testes na regressão consolidada e 20/20 no ensaio dedicado de capacidade. Publicação permanece pendente.** Nenhum commit, push, deploy, implantação de índice ou alteração de produção foi realizado.

## 1. Ambiente, método e limites da evidência

A Fase 8 foi lida antes das alterações. A base Git é `4051f03`, com mudanças locais anteriores da Fase 7/8 e de `graphify-out` preservadas. As alterações desta fase não incluem novos módulos comerciais, preços ou regras de plano.

- Windows x64; AMD Ryzen 7 5700X3D, 16 processadores lógicos; 34.265.612.288 bytes de RAM.
- Node 22.23.3, OpenSSL 3.5.8, Java Temurin 21.0.7; Firebase CLI e bibliotecas instaladas pelo projeto.
- Integração: `demo-lastro-tests`, Auth `127.0.0.1:9099`, Firestore `:8080`, Storage `:9199`.
- Navegador e API: cópia importada de `demo-lastro-phase-a` em Auth `:19099`, Firestore `:18080`, Storage `:19199`, API `:3000`; export web em `localhost:8081`.
- A exportação persistente original em `backend/.local/emulator-data` não foi substituída. A cópia de desenvolvimento exporta em diretório novo, `backend/.local/phase9-development-data`.
- Os dois emuladores compartilham a máquina. O ensaio financeiro de 20.000 fontes continuou durante as medições menores. As medições são de laboratório com essa carga de fundo, sem isolamento de CPU; não são SLOs nem provas de capacidade do Firestore real.

Backend: chamadas HTTP Supertest com Auth e Firestore reais emulados; três repetições por tamanho de pedido, cinco por listagem/relatório de 500 pedidos. Medição com `performance.now()`, consumo amostrado com `process.memoryUsage()`. A instrumentação conta chamadas SDK `Transaction.get/getAll` e documentos que passaram por `readSnapshot`; não mede RPCs internos, tentativas de rede ou cobrança Google.

APIs: 100 chamadas por endpoint e versão, divididas em três janelas de 33, 33 e 34 amostras. São 1.400 leituras antes e 1.400 depois, com conta demo e dados importados controlados. Os endpoints de leitura mantiveram a mesma base de dados; E2E criou outras empresas sintéticas.

O login REST no Auth Emulator teve uma amostra de 41,4 ms antes e 41,2 ms depois. Essas duas observações não sustentam percentil ou ganho de autenticação. O tempo da jornada completa no navegador é apresentado separadamente.

Web: Chrome 155.0.8059.80 headless, export de produção, gzip local, cache desabilitado, três contextos novos por perfil. Desktop: 1280×800, CPU normal, sem limitação de rede. Mobile simulado: 390×844, CPU 4×, 150 ms de latência, 200.000 bytes/s de download e 93.750 bytes/s de upload. Não é um aparelho físico.

O carregamento mede da navegação até o botão Entrar visível; LCP vem de `PerformanceObserver`. O Dashboard tem medidas separadas para a estrutura visível e para o fim das leituras. O roteiro aguarda 750 ms sem API pendente para detectar conclusão, mas registra o instante da última conclusão, sem somar essa espera artificial. Filtragem inclui o debounce real e a resposta. A comparação autenticada remapeia somente o Auth local `:9099` para a cópia `:19099`, igualmente nas duas versões.

Não há CrUX ou RUM de usuários reais nesta evidência. Não foram executados testes de carga remotos. Latências emuladas não comprovam desempenho produtivo, revogação remota de tokens ou custo de Firestore.

As [tabelas completas](evidence/fase9/measurement-summary.md) e o [resumo estruturado](evidence/fase9/measurement-summary.json) incluem intervalos, tamanhos e amostras. Dados brutos estão no mesmo diretório.

## 2. Métricas iniciais e comparação

| Medida                                          |                Antes |                 Depois | Interpretação                                                                  |
| ----------------------------------------------- | -------------------: | ---------------------: | ------------------------------------------------------------------------------ |
| Pedido com 1 produto, confirmação, mediana de 3 |               305 ms |                 332 ms | Amostra pequena; sem ganho comprovado para pedidos pequenos                    |
| 20 produtos, confirmação                        |               345 ms |                 352 ms | Sem ganho comprovado                                                           |
| 50 produtos, confirmação                        |               403 ms |                 405 ms | Sem ganho comprovado                                                           |
| 100 produtos, confirmação                       |               465 ms |                 424 ms | Redução observada de 8,8%                                                      |
| 200 produtos, confirmação                       |               745 ms |                 619 ms | Redução observada de 16,9%                                                     |
| Chamadas SDK na confirmação de 200 produtos     |            826 `get` | 626 `get` + 2 `getAll` | 24,0% menos chamadas; 829 validações de documentos nas duas versões            |
| Recebíveis, mediana de 100                      |               970 ms |                 718 ms | Redução observada de 25,9%                                                     |
| Recebíveis, p95 de 100                          |             1.065 ms |                 755 ms | Redução observada de 29,1%; zero erros nas duas rodadas                        |
| Login disponível, mobile simulado               |             8.912 ms |               7.988 ms | Medianas de três navegações autenticadas independentes; redução de 10,4%       |
| LCP, mobile simulado                            |             8.836 ms |               7.872 ms | Laboratório; ainda alto para rede limitada                                     |
| Login até dados do Dashboard, desktop           |             1.381 ms |                 735 ms | Redução observada de 46,8%                                                     |
| Login até dados do Dashboard, mobile simulado   |             1.887 ms |               1.697 ms | Redução observada de 10,1%                                                     |
| Respostas úteis do Dashboard                    |                14–16 |  10 em todos os perfis | Sem respostas concluídas duplicadas de pedidos/reposição na amostra final      |
| JavaScript web, sem compressão                  |      3.094.666 bytes |        3.087.184 bytes | Queda de 0,24%; JS inicial continua grande                                     |
| JavaScript web, gzip                            |        745.019 bytes |          743.390 bytes | Queda de 0,22%                                                                 |
| Fontes empacotadas web                          | 18 / 6.217.596 bytes |      4 / 467.404 bytes | Mesma família e mesmos quatro pesos usados pelo app                            |
| Export web completo                             |      9.348.337 bytes |        3.596.101 bytes | Redução de 61,5%; tamanho em disco, não transferência inicial; inclui licenças |

Os intervalos completos são essenciais para interpretar variações de poucos milissegundos. Não se atribui ganho causal a endpoints não alterados só porque uma amostra ficou menor. A instrumentação de pedidos demonstra a redução de chamadas independentemente da oscilação de latência. Não houve medição de leituras faturadas remotas.

As fontes realmente transferidas no login já eram quatro antes da mudança. A remoção das outras 14 reduz o pacote; a conversão dessas quatro para WOFF2 reduz a transferência inicial. Os 2.926 glifos, cmap e métricas horizontais de cada peso foram conferidos durante a conversão, sem subsetting. As quatro famílias foram confirmadas como `loaded` no Chrome. Android continua com os quatro TTF originais.

## 3. Gargalos e mudanças implementadas

### Leituras de produtos nos pedidos

O servidor buscava cada produto individualmente na criação/edição e na confirmação. `FoundationRepository.readMany` agora busca no máximo 100 referências por chamada, no mesmo snapshot transacional. Deduplica somente referências dessa invocação e devolve resultados na ordem de entrada. Não mantém cache entre transações.

Cada documento continua passando por `readSnapshot`, schema e orçamento de leitura. `OrderService` preserva validação de ID, empresa, estado e unidade. Estoque, aprovação de desconto, recebíveis, auditoria e idempotência não foram alterados.

Efeito colateral: até 100 snapshots são recebidos juntos. Produtos têm tamanho limitado pelo schema; a leitura continua sujeita ao orçamento. Os novos testes cobrem fronteira do lote, ordem, repetição, ausência, schema inválido, orçamento de memória, atualização entre transações, empresa divergente e produto inativo.

### Cabeçalho financeiro

`FinancialReads.header` lia pedido, guard e estado financeiro em três etapas sequenciais. Essas três leituras independentes agora usam `Promise.all` na mesma transação. A leitura do evento continua dependente do estado, e todas as verificações financeiras permanecem em `inspect`.

Não houve aumento do cache de quatro cabeçalhos, do ReadGate ou dos limites de memória. Não foi removida verificação de diário, prova, origem, legado ou permissão. O ganho está documentado nas 100 amostras por versão de recebíveis. O custo lógico de documentos não foi reduzido por essa mudança.

### Cancelamento de consultas abandonadas

O hook de paginação recebia `AbortSignal`, mas as consultas de lista de pedidos e reposição não encaminhavam o sinal ao cliente HTTP. Durante desmontagens da navegação inicial, respostas antigas continuavam chegando e novas consultas começavam.

As duas consultas agora encaminham o sinal. A amostra final teve dez respostas úteis por abertura do Dashboard, sem duplicatas concluídas desses endpoints. Testes atravessam hook, React Query e cliente HTTP real, verificando cancelamento ao desmontar e ausência de dados tardios no cache. Chaves por empresa, tempos de cache e invalidação após escrita permanecem iguais.

Há um tradeoff observado: isolando somente essa última mudança, o Dashboard mobile variou de mediana 1.494 para 1.697 ms, enquanto as respostas concluídas caíram de 14 para dez. Desktop caiu de 1.290 para 735 ms. A comparação integral da fase ainda melhorou nos dois perfis. Não se promete redução de latência em toda desmontagem; a mudança evita trabalho abandonado e mantém cancelamento correto.

### Fontes e experimento descartado

Imports diretos dos quatro pesos substituem o barrel de 18 fontes. `fonts.web.ts` usa WOFF2 completo, e `fonts.ts` conserva os TTF nativos. Metro reconhece `woff2` como asset. Licenças, hashes e conversor reproduzível estão em `frontend/assets/fonts/` e `frontend/scripts/compress-web-fonts.py`; `frontend/public/font-licenses/` também inclui as licenças no export web. Não há dependência nova no aplicativo.

Foi ensaiada divisão assíncrona de rotas web. A mediana desktop passou de aproximadamente 299 para 1.039 ms, sem redução útil no mobile. A configuração foi revertida; [evidência do experimento](evidence/fase9/web-discarded-async.json). Não foram adicionadas memoização de componentes, virtualização ou abstrações de tela sem medição.

## 4. Listagens, relatórios, PDFs e memória

O dataset maior contém 500 pedidos válidos pelo schema, com 20 linhas cada. São fixtures estruturais de relatório, não 500 ciclos financeiros completos criados via HTTP.

- Lista de 50 pedidos: mediana 1.582 → 1.615 ms; filtro por estado: 1.597 → 1.594 ms. Nenhum ganho comprovado nesses caminhos.
- Relatório de 500 pedidos: mediana 655 → 645 ms; limites e linhas preservados.
- CSV completo: 674 → 697 ms, 70.237 bytes. PDF completo: 969 → 975 ms, 126.957 bytes na versão posterior. Uma amostra por versão não permite p95 ou afirmar ganho de geração.
- O relatório preserva limite de volume, autorização, orçamento e snapshot consistente. Não foi introduzido cache que possa apresentar valores financeiros desatualizados.
- Maior RSS amostrado nos benchmarks: 521.900.032 bytes antes e 482.742.272 depois. São amostras após operações, não pico contínuo nem prova de redução de memória. GC e aquecimento não foram controlados.
- A listagem acima do orçamento continua explicitamente recusada, sem truncamento silencioso, e oferece continuação por cursor menor nos testes de memória existentes.

Inspeção identificou custo remanescente de leitura das projeções econômicas em listas de pedidos e recebíveis. Essas verificações asseguram publicação financeira consistente. Não foram removidas. O limitador distribuído por IP do ambiente real também continua sendo hipótese de contenção herdada da auditoria anterior; o modo emulador usa limitador em memória e não valida esse gargalo remoto.

## 5. Capacidade e concorrência

Pedidos de 1, 20, 50, 100 e 200 produtos foram medidos com três confirmações, replays e expedições por tamanho. Totais, 12 parcelas, reservas e saldos finais foram conferidos. Repetição de confirmação retorna o mesmo resultado sem novos efeitos.

Ensaio de 500 pedidos: oito leituras simultâneas entre dois usuários e duas empresas retornaram quatro HTTP 200 e quatro HTTP 429. `ReadGate(4)` manteve o limite de admissão; não é corrupção de dados nem oito sucessos. Respostas da outra empresa ficaram vazias. O tempo total observado está nos registros brutos.

| Concorrência medida                                  | Resultado                                         | Tempo da corrida |
| ---------------------------------------------------- | ------------------------------------------------- | ---------------: |
| 2 entradas no mesmo produto                          | 2 HTTP 201; saldo reconciliado                    |            66 ms |
| 4 entradas                                           | 4 HTTP 201; saldo reconciliado                    |         3.652 ms |
| 8 entradas                                           | 8 HTTP 201; saldo reconciliado                    |         3.605 ms |
| 16 entradas                                          | 16 HTTP 201; saldo reconciliado                   |         3.776 ms |
| Recebimentos com versões concorrentes, três corridas | Um 200 e um 409 por corrida; somente um efeito    |   3.188–3.483 ms |
| Mesmo recebimento/chave, três corridas               | Dois 200 idênticos por corrida; somente um efeito |  3.425–10.652 ms |

Os tempos da tabela são da execução consolidada final. Os tempos altos sob contenção incluem retries transacionais. Nenhuma meta subsegundo foi declarada para essas corridas. Cada requisição, código e latência está em [concurrency.json](evidence/fase9/concurrency.json). Esses testes passaram 5/5.

**Ensaios F02 de 20.000 fontes:** cancelamento e devolução aprovados nesta execução. O fixture gera fontes/eventos/provas válidos diretamente no emulador; não representa 20.000 recebimentos HTTP. Resultados antigos de 13/10 não contam como evidência desta fase.

Cancelamento: 3.379.508 ms (56min19s), 20.000 provas e 20.000 pagamentos conferidos independentemente, exatamente uma publicação e uma reserva liberada. Recuperou uma prova ausente por retomada. O medidor registrou 6.276 commits, 561.169 leituras e 191.395 escritas; máximos por etapa de 150 leituras e 80 escritas, com RSS máximo amostrado de 425.091.072 bytes. [Evidência nova de cancelamento](evidence/fase9/financial-cancellation.json).

Devolução: 3.202.836 ms (53min23s), 20.001 provas e 20.000 pagamentos conferidos independentemente, exatamente uma publicação, um recebimento físico e devolução encerrada. A retomada após lease expirado preservou o resultado. O saldo final foi uma unidade física e nenhuma reservada. O medidor registrou 5.470 commits, 490.537 leituras e 187.367 escritas; máximos por etapa de 150 leituras e 80 escritas, com RSS máximo amostrado de 444.997.632 bytes. [Evidência dos dois ensaios](evidence/fase9/financial-capacity.json), concluídos às 13:35:48 e 14:29:16 no horário de São Paulo.

O ensaio dedicado terminou com 20/20 testes em três arquivos e duração de 6.756,28 segundos. Inclui pedidos de até 200 linhas com 12 parcelas, replay, expedição, cancelamento, limites e corridas concorrentes. [Resultado integral](evidence/fase9/capacity-suite.json) e [medidas de pedidos](evidence/fase9/order-capacity.json). Parte dos testes de pedidos também integra a regressão consolidada; os totais não representam 514 casos distintos.

Esses ensaios começaram antes das otimizações de leitura. O executor financeiro não foi alterado nesta fase. A nova leitura paralela e as leituras agrupadas são verificadas separadamente pelos benchmarks e pela regressão final carregada depois das alterações.

Campos `confirmLogicalReads` e `confirmWrites` do helper antigo de capacidade são fórmulas de orçamento, não contadores de faturamento. Para chamadas medidas, usar `calls` dos benchmarks desta fase. No medidor F02, leituras/escritas são instrumentadas pelo wrapper transacional; `estimatedBytes` é estimativa conservadora de admissão, não bytes de rede ou memória real.

## 6. Firestore remoto

O [relatório de índices](fase9-indices-2026-10-18.md) associa todas as coleções declaradas aos construtores das consultas e registra as 150 definições individualmente.

Consulta remota atualizada às 19:20:47 de 18/10/2026, horário de São Paulo. Homologação tem 134 compostos `READY`; faltam 16: auditoria (1), cobranças (7), visitas (7) e histórico de recompra em pedidos (1). Das 87 configurações de campo, 82 correspondem e cinco isenções estão ausentes. TTL `rateLimits.expiresAt` está `ACTIVE`.

[Comandos exatos preparados](evidence/fase9/pending-index-commands.txt): 16 criações de compostos e cinco isenções. Não executados. A criação exige autorização, espera por `READY` e validação das consultas em homologação real. O emulador não comprova cobertura de índices.

## 7. Acessibilidade

Chrome verificou ordem de Tab no login, dois erros obrigatórios, campos dos formulários, modal de nome, nome inválido, foco restrito ao modal, Escape e retorno ao disparador. Formulários inspecionados não tiveram overflow horizontal a 390 px. Quatro fontes WOFF2 ficaram carregadas. [Dados](evidence/fase9/accessibility-web.json) e [modal](evidence/fase9/name-dialog-390.png).

`adb devices -l` não encontrou Android conectado. Teclado virtual, TalkBack e execução do app nativo permanecem **não validados**. O [roteiro de aceite](fase9-acessibilidade-2026-10-18.md) organiza aparelhos, formulários, modal, foco e critérios. Não há declaração de conformidade WCAG completa.

## 8. Regressão e contratos

| Verificação                                         | Estado                                                         |
| --------------------------------------------------- | -------------------------------------------------------------- |
| Backend unitários finais                            | 24 suítes, 320/320                                             |
| Frontend unitários finais                           | 50 suítes, 616/616                                             |
| Benchmarks antes/depois                             | 6/6 por versão                                                 |
| Leitura agrupada, validação, isolamento e orçamento | 4/4                                                            |
| Concorrência medida de estoque/financeiro           | 5/5                                                            |
| E2E estoque                                         | 17/17                                                          |
| E2E pedidos                                         | 19/19; inclui 200 produtos                                     |
| Backend build e artefato                            | Aprovados                                                      |
| Frontend export web e Android                       | Aprovados; Android não executado em dispositivo                |
| Typecheck e lint dos dois projetos                  | Aprovados com as alterações finais de código                   |
| OpenAPI                                             | Sincronizado; SHA-256 dos contratos frontend/backend idênticos |
| Scanner por assinaturas, backend/frontend           | Zero achados nos escopos do scanner                            |
| `git diff --check`                                  | Exit 0; avisos LF/CRLF                                         |
| Capacidade dedicada, incluindo os dois ensaios F02  | 3 arquivos, 20/20; 6.756,28 s                                  |
| Integração consolidada final                        | 51 arquivos, 494/494; 1.956,07 s; zero falhas                  |

As guardas dos fixtures continuam recusando projeto real e portas inesperadas. Benchmarks adicionais usam tenants novos, sem limpar o ensaio paralelo. Os dados persistentes anteriores não foram apagados. `AUTH_EMULATOR_URL` nos E2E aceita somente loopback nas portas 9099/19099.

A regressão integral terminou às 15:04:39 de 18/10/2026, depois dos ensaios longos e com todas as alterações finais de código carregadas. Cobriu financeiro, estoque, isolamento por empresa, permissões de vendedor, limites de planos, idempotência, provas, relatórios, visitas, cobranças e contratos. [Resultado consolidado](evidence/fase9/final-integration.json). O comando `--without-capacity` exclui somente o arquivo financeiro de 20.000 fontes, já executado separadamente; os testes de capacidade de pedidos permanecem na regressão.

Os processos temporários de API, export web e emuladores foram encerrados. As portas locais usadas na auditoria estavam livres ao fechamento. A exportação original conserva metadados de 02:29:35; a cópia de desenvolvimento foi exportada separadamente às 13:24:21.

## 9. Riscos restantes

1. Dezesseis índices remotos ausentes impedem afirmar prontidão dos fluxos correspondentes.
2. Cinco isenções de índice de campo divergem do repositório e ainda exigem aprovação para aplicação.
3. LCP mobile de aproximadamente oito segundos e JS inicial de 3,09 MB continuam altos; fonte menor não resolve todo o carregamento.
4. Listagens estruturais de 500 pedidos continuam perto de 1,6 segundo; contenção financeira teve corrida de 10,65 segundos no emulador.
5. Não há ensaio de carga em Firestore/Cloud Run de homologação real, métricas de faturamento, RUM ou garantia de cold start.
6. TalkBack, teclado virtual e app nativo executado permanecem pendentes; expiração real/renovação no navegador também continua pendência herdada da Fase 8.
7. TLS, IAM, backups e disponibilidade remota não foram certificados por estes testes locais.

## 10. Parecer e reprodução

**Fase 9 concluída localmente, com ganhos medidos e regressão aprovada. Sistema ainda não está pronto para publicação.** Os dois ensaios de 20.000 fontes passaram, sem perda de consistência ou duplicação de efeitos. Permanecem os índices remotos ausentes, a validação de TalkBack/teclado virtual/app nativo e as verificações remotas e de sessão herdadas da Fase 8. LCP mobile e contenção continuam riscos de desempenho documentados. Nenhuma publicação foi feita; aplicação dos comandos de índices, commit, push e deploy dependem de autorização posterior.

Roteiros versionados:

```powershell
# Backend; somente quando as portas padrão de testes estiverem livres
node scripts/emulators.mjs test tests/integration/performance.test.ts
node scripts/emulators.mjs test tests/integration/concurrentPerformance.test.ts
node scripts/emulators.mjs test tests/integration/batchedProducts.test.ts
node scripts/emulators.mjs test tests/integration/financialExecutionCapacity.test.ts
node scripts/emulators.mjs test --without-capacity

# Comparação dos snapshots de metadados remotos, sem implantação
node scripts/audit-firestore-indexes.mjs
node scripts/summarize-phase9.mjs

# Frontend; usar export local servido em :8081 e a cópia Auth em :19099
node scripts/performance-serve.cjs .local/phase9-cancel-web
node scripts/performance-web.cjs after --authenticated
node scripts/audit-phase9-accessibility.cjs
```

O roteiro web requer Playwright disponível no runtime local; os comandos não instalam dependências no aplicativo. A medição de APIs usa `backend/scripts/measure-local-api.mjs` e os destinos loopback fixos. Nenhuma etapa de reprodução autoriza commit, push, deploy, migração destrutiva ou implantação de índices.
