# F02: implementação e validação local concluídas

## Status

Implementação aprovada em 12/10/2026, conforme `proposals/financial-resumable-resolution.md` e as condições adicionais do usuário. Este registro preserva checkpoints históricos e contém a conclusão local de 13/10/2026.

**F02 RESOLVIDO no escopo estrutural local: 602 testes únicos aprovados, zero falhas finais, pendentes ou `todo`.** Executor e oito endpoints opt-in implementados e validados. Cancelamento e devolução de 20.000 fontes válidas passaram com publicação única e recuperação. As seções iniciais preservam checkpoints preparatórios, não o status vigente. Resultado agregado e limitações constam na seção "Conclusão local" e em `f02-delivery.md`. Isso não aprova capacidade ou implantação produtivas.

## Etapa 1: schemas, provas e leitores

- Provas de pertencimento Merkle vinculadas a empresa, execução, posição e quantidade, sem padding ambíguo e com caminho limitado a 53 hashes.
- Entradas financeiras por pagamento, aplicação, lote e guarda de linha de devolução. As entradas conservam origens, versões e os componentes permitidos de cada transição.
- Resolvedor econômico central integrado ao repositório. Fontes preparadas retornam os valores anteriores até existir publicação verificável.
- Publicação exige execução concluída, manifesto íntegro, evento v2 íntegro e vínculos consistentes. `COMPLETED` isolado não disponibiliza valores.
- Cache por transação, limitado a 64 registros e 2 MiB de JSON estimado. Isso não mede overhead da SDK nem certifica RSS em produção.
- Schemas financeiros e de devolução v2. Eventos v1 não foram regravados nem tiveram seu algoritmo de hash alterado.
- Cabeçalhos compactos de pedido e devolução reconhecidos pelos leitores. A projeção escalar de status do pedido mantém os filtros anteriores; o cabeçalho restitui versão e campos comerciais terminais.
- Devolução v2 materializa suas linhas a partir das provas publicadas. Um recebimento físico posterior usa essas quantidades e pode produzir evento v1 sem perder a resolução anterior.
- Checkpoint de reconciliação com domínio de assinatura v2. Cursor v1 autenticado exige reinício explícito quando o diário passa a misto.

### Evidências executadas

1. Suíte unitária: **221 testes aprovados**, em 15 arquivos. A última execução de 12/10/2026 registrou 4,67 s. A base anterior tinha 193 testes unitários. Esta execução não representa a suíte completa com emuladores.
2. `financialEconomicView`, `financeReceipts` e `financialReconciliation`: **34 testes aprovados** em emuladores locais, 159,04 s.
3. `financialReturnCompatibility`, `financialEconomicView` e `returns`: **38 testes aprovados** em emuladores locais, 223,75 s.
4. O teste legado de 200 produtos registrou 2.503 ms no recebimento físico e 2.314 ms na resolução atômica. Esses números não medem o executor retomável nem capacidade produtiva.
5. TypeScript e lint aprovados após as adaptações dos leitores. A validação integral será repetida após as etapas seguintes.

Os grupos de integração se sobrepõem. Não somar 34 e 38 para anunciar uma quantidade total de testes únicos. Nenhum dos 523 testes anteriores foi removido ou teve suas asserções reduzidas.

As publicações v2 dos testes de compatibilidade são **fixtures locais**, construídas com schemas, hashes e transação de publicação. Elas não demonstram execução do motor, recuperação do motor ou 20.000 operações reais pela API.

## Etapa 2: índices ativos e bloqueios

Os escritores de recebimentos, estornos, aplicações de crédito, reversões e liquidações atômicas atualizam as fontes positivas junto com o ledger. Uma alocação zerada sai somente da projeção; pagamentos, aplicações, eventos e idempotências permanecem preservados. Um pedido legado sem projeção não ganha um certificado por inferência: exige backfill antes do uso pelo futuro executor.

Os bloqueios de pedido e lote validam proprietário e empresa. Lease expirado não libera recursos. Replay já concluído revalida autorização e retorna a resposta anterior sem duplicar efeitos. Ainda não existe executor habilitado para criar esses bloqueios por endpoints.

### Carga HTTP local executada

Em 12/10/2026, `financialReceiptVolumes`, `financialSourceIndex` e `financialExecutionLocks` aprovaram **13 testes em três arquivos**, 278,19 s. Relatório preservado em `reports/f02-local-volumes.raw.json`. Asserções validam conservação da cadeia financeira, origens, contagens, ledger, projeção certificada, rejeição de excedente e repetição da chave sem nova movimentação.

| Recebimentos reais de um centavo | Tempo observado do cenário de recebimentos e suas verificações | Fontes semeadas |
| -------------------------------- | -------------------------------------------------------------- | --------------- |
| 10                               | 3.829 ms                                                       | 0               |
| 100                              | 29.852 ms                                                      | 0               |
| 500                              | 146.332 ms                                                     | 0               |

Cada cenário adicionou um replay HTTP e uma tentativa excedente rejeitada. Os tempos não incluem preparação completa da fixture nem certificam produção. Estes testes não aprovam cancelamento ou devolução de 20.000 fontes; a matriz estrutural depende das próximas etapas do executor.

Um teste novo de índices falhou anteriormente por contar apenas três idempotências financeiras: a preparação também cria duas configurações de pagamento. O teste foi corrigido para preservar e comparar os registros iniciais, além dos três novos, sem remover a asserção de histórico. A execução acima passou com essa verificação.

### Backfill interno

`SourceBackfill` oferece início e avanço internos autorizados, sem rota HTTP e sem habilitar uma execução financeira. O estado persistido em `financialSourceGenerations`, com `kind: build`, guarda revisão, empresa/pedido/cliente, baseline financeiro, até doze títulos, cursores, hashes de fronteira, contagens e somas. As fases são `journal`, `cash`, `credit`, `validating` e `complete`; esta conclusão certifica um índice, **não um cancelamento, devolução ou publicação financeira**.

- Diário: até vinte eventos por passo, consultando primeiro 21 cabeçalhos escalares. Eventos v1 potencialmente grandes são lidos um a um, com sequência real, continuidade dos snapshots, hashes e fronteira anterior conferidos.
- Fontes: até dez pagamentos ou três aplicações por página, com redução do prefixo caso as alocações positivas ultrapassem 72 escritas. As origens, alocações originais, versões, hashes, lotes e idempotências são conferidas; fontes estornadas continuam no histórico e na contagem examinada.
- Validação: até dez linhas da geração inativa por passo. Conferir ID determinístico, escopo, fonte atual, origem, saldo, lote, contagem e totais antes da troca do ponteiro.
- Cada avanço relê estado, guarda, títulos e cabeçalho escalar do pedido. Escrita financeira concorrente exige uma nova geração com `FINANCIAL_SOURCE_GENERATION_STALE`; não mesclar checkpoints anteriores.
- Checkpoint, linhas, idempotência e auditoria do avanço ficam na mesma transação. Replay revalida permissão. Revisão decide avanços concorrentes; nenhum saldo, fonte, lote, reserva ou evento econômico é modificado pelo backfill.
- Novos documentos têm orçamento de 256 KiB de JSON estimado. A interrupção de novos itens após três segundos é cooperativa: não certifica limite rígido de duração da SDK ou do commit.

A validação usa consultas paginadas, não uma agregação transacional que bloqueie todas as fontes. Não representa snapshot global contra reescrita administrativa direta de documentos já lidos. Escritores legítimos atualizam a guarda/diário; o futuro planejador deverá conferir novamente as linhas e a contagem certificada antes de usar a geração.

Em 12/10/2026, backfill, índices, recebimentos, liquidações e bloqueios aprovaram **39 testes em cinco arquivos**, 199,82 s: `reports/f02-backfill-regression.raw.json`. Inclui cancelamento legado de 200 produtos, 933 ms observados no emulador. Os grupos anteriores se sobrepõem; não somar essas quantidades para anunciar uma suíte completa.

### Gerador de fontes

`tests/helpers/financialSourceSeed.ts` prepara fontes diretamente no emulador, sem qualquer chamada HTTP de recebimento. O gerador inclui pagamento, evento v1, idempotência, auditoria e linha ativa para cada fonte; conserva centavos, cadeia, versões, baseline e certificado final. Valida cada schema e envia até 100 escritas por lote, com orçamento de 2 MiB de JSON estimado. Recusa projeto real, hosts não locais e bucket diferente de `demo-lastro-tests.appspot.com`.

O gerador não é uma migração nem um escritor de produção. Sua preparação pode atravessar vários commits da fixture; isso **não prova** publicação única ou recuperação do executor financeiro. As métricas de bytes e memória amostrada descrevem a preparação da fixture, não o motor. O teste inicial usa 25 fontes e verifica estado/reconciliação pela API, auditorias e estorno real de uma fonte semeada.

Backfill e gerador aprovaram **9 testes em dois arquivos**, 74,26 s na última execução, com contagem real de fontes, detecção de fonte totalmente estornada ausente, compatibilidade com cancelamento atômico após certificação e estorno de uma fonte semeada. Relatório final desse incremento: `reports/f02-source-final-checkpoint.raw.json`. Esse resultado é um recorte incremental, não a suíte completa.

Os recortes desta rodada cobriram **44 testes de integração únicos**: volumes HTTP (3), índices (2), bloqueios (8), backfill (8), gerador (1), recebimentos legados (11) e liquidações legadas (11). Os 523 testes anteriores permanecem preservados; a suíte completa com emuladores ainda precisa ser repetida na entrega final F02.

TypeScript, lint, formatação e build passaram após este incremento. OpenAPI e tipos foram regenerados para os leitores efetivamente presentes: versão **0.7.0**, **106 operações**, **nenhuma rota de executor**. Esses contratos não oferecem início, avanço, retomada ou sucesso financeiro via `202` nesta etapa.

**A matriz obrigatória de 20.000 fontes continua pendente das etapas do executor.** Ainda não aprovar cancelamento, devolução, publicação financeira única ou recuperação estrutural nesse volume. Somente 20.000 chamadas HTTP foram transferidas para homologação/capacidade; o cenário semeado permanece obrigatório localmente.

## Etapas do checkpoint preparatório: histórico

2. Bloqueios econômicos e físicos, projeções de fontes ativas e backfill certificado.
3. Planejamento, selamento, validação, checkpoints duráveis e idempotência dos passos.
4. Aplicação limitada de fontes, lotes e reservas; publicação única; crash/fencing/visibilidade.
5. Endpoints opt-in, contratos HTTP, PDFs, CSVs, retomada e recuperação auditada.
6. Matriz adversarial local: recebimentos reais pela API em volumes de 10, 100 e 500; 20.000 fontes financeiras válidas geradas diretamente no emulador. No cenário gerado, validar cancelamento, devolução, publicação única, saldos, idempotência e recuperação após falhas. Medir bytes, reads, writes, transações, tempo, heap e RSS.

## Estratégia de carga autorizada em 12/10/2026

Os testes locais de 10, 100 e 500 recebimentos devem atravessar os endpoints reais. A fixture de 20.000 fontes deve conservar schemas, origens, cadeia de eventos, contagens e ledger, sem enviar 20.000 recebimentos individuais pela API. Ela comprova apenas a capacidade estrutural observada no emulador quando o executor e sua matriz forem efetivamente aprovados.

**20.000 chamadas HTTP reais: pendentes de homologação/capacidade; não executadas e não aprovadas.** Essa pendência não reduz as exigências de cancelamento, devolução, publicação única, integridade, idempotência, recuperação, concorrência ou regressões locais. Não reduzir asserções, apagar histórico ou alterar saldos para montar um cenário que apenas pareça válido.

Não publicar OpenAPI 0.8.0 ou anunciar contratos de execução disponíveis antes de implementar e validar esses endpoints. A regeneração intermediária de tipos deve descrever apenas o código efetivamente presente.

## Executor local: rodada de conclusão

O código agora contém coordenador durável, planejamento e selamento limitados, árvore Merkle incremental, validação, aplicação cercada, reservas parciais e publicação única. O último commit publica títulos, estado, guarda, manifesto, evento financeiro v2, destino e cabeçalhos compactos. Devoluções recebem também evento v2 no mesmo commit. Não há cópia de todas as fontes ou guardas nesse commit.

Cada avanço valida autorização, revisão, lease, fence e dono do bloqueio. Root/checkpoint, efeitos, tentativa idempotente e evento operacional são gravados atomicamente. Retomada administrativa exige reautenticação; incrementa fence sem alterar intenção nem provas seladas. Prova original ausente pode ser reconstruída do backup selado, verificando pertencimento e fonte antes/depois. Corpo alterado ou backup ausente conserva revisão e bloqueio; não recebe dinheiro inferido.

As oito rotas opt-in existem localmente. OpenAPI 0.8.0 contém 114 operações. Tipos foram regenerados. Contrato: `api/financial-executions.md`. POST distingue 202 pendente e 200 terminal; GET continua informativo. O caminho atômico anterior conserva resultado/HTTP e recusa históricos maiores com `FINANCIAL_RESUMABLE_REQUIRED` antes de carregá-los.

225 testes unitários passaram no checkpoint intermediário. O recorte funcional inicial aprovou seis testes de recuperação, fencing, concorrência, isolamento, reconciliação cumulativa, danos parciais e aceite zero, em 158,28 s. Relatório preservado: `reports/f02-executor-functional.raw.json`. Um cancelamento HTTP adicional passou separadamente. Esses resultados são recortes, não a regressão integral final.

A primeira execução estrutural de 20.000 fontes foi interrompida durante planejamento para eliminar leituras pontuais sequenciais desnecessárias. Ela não foi aprovada. A otimização usa `getAll` com cache de snapshots limitado ao lote e à mesma transação. Não muda saldos, esquema de publicação, limites, checkpoints ou idempotência. Orçamentos continuam 150 documentos lidos, 100 writes, 2 MiB estimados com margem, documento novo de 256 KiB e prova de 64 KiB.

Neste checkpoint intermediário, os testes finais de 20.000 fontes e a regressão integral ainda estavam em execução/preparação. Não inferir aprovação daqueles cenários apenas a partir desse checkpoint; os resultados executados aparecem abaixo.

### Evidências adversariais anteriores ao resultado integral

A suíte unitária final desta implementação aprovou **227 testes em 16 arquivos**, sem falhas, pendentes ou `todo`: `reports/f02-unit-final.raw.json`. O recorte adversarial aprovou **13 testes em quatro arquivos**, em 138,99 s: `reports/f02-executor-adversarial.raw.json`. Esses recortes não devem ser somados aos testes repetidos na suíte integral.

As verificações exercitam origem adulterada na idempotência do recebimento, avanço concorrente com a mesma chave, lease expirado, fence antigo, troca de administrador autorizado, revogação do administrador original, isolamento empresarial, permissões de vendedor, abort antes/depois de efeitos, recuperação do corpo exato de prova ausente e recusa de sobrescrever prova alterada. Reconciliação de provas conserva falha cumulativa e detecta lacuna. Devoluções incluem dano com aceite parcial e aceite financeiro zero.

O teste de compatibilidade v1/v2 apresentou um falso positivo preexistente: escolhia o último item do histórico de devolução, ordenado por ID, e presumia que seria o evento de maior sequência. IDs aleatórios permitiam aprovação ocasional. A reprodução local está em `reports/f02-compatibility-reproduction.raw.json`. O teste agora identifica o evento publicado pelo ID e exige tipo, versão, sequência, contagem integral e todas as sequências esperadas. A ordenação e o cursor HTTP não mudaram; nenhuma asserção financeira foi removida.

TypeScript, lint, build e formatação passaram novamente em 13/10/2026. A regeneração de OpenAPI e tipos manteve os mesmos hashes dos arquivos entregues: versão 0.8.0, 114 operações. Isso comprova sincronização com o gerador atual, não resolve a divergência de esquemas de saída registrada separadamente em F07.

### Matriz estrutural de 20.000 fontes: dois cenários aprovados

Em 13/10/2026, o cancelamento completo de **20.000 fontes válidas de um centavo semeadas diretamente** passou. O gerador não chamou a API de recebimentos. Após aplicação parcial, o teste apagou deliberadamente uma entrada original de prova, exigiu `NEEDS_REVIEW` e retomou pelo backup selado. A execução publicou uma única vez. O teste conferiu independentemente todas as 20.000 provas originais/backups, hashes e pertencimentos Merkle, além dos 20.000 pagamentos com exatamente um centavo transferido cada.

Resultado: dívida e caixa liquidado zerados, recebimentos históricos de 20.000 centavos preservados, transferência total de 20.000 centavos, um crédito de 20.000 centavos, reserva zerada e estoque físico de uma unidade. A geração ativa certificada terminou vazia e vinculada ao estado publicado. Evento financeiro contém no máximo quatro referências; nenhum array de 20.000 fontes foi publicado.

A devolução de outras **20.000 fontes válidas** também passou. O pedido foi expedido e uma unidade vendável foi recebida fisicamente pela API antes do executor. O teste expirou o lease após aplicação parcial, reautenticou, retomou com novo fence e concluiu sem duplicar efeitos. Conferiu todas as 20.001 provas (20.000 pagamentos e uma linha de devolução), todos os pagamentos e uma publicação financeira. A devolução terminou encerrada, com um único recebimento físico e estoque vendável de uma unidade. Dívida, caixa, transferência e crédito fecharam nos mesmos valores do cancelamento. Não houve movimentação bancária automática.

| Medida observada                                 |                   Cancelamento |                      Devolução |
| ------------------------------------------------ | -----------------------------: | -----------------------------: |
| Tempo total do cenário, incluindo verificações   |                   3.414.395 ms |                   3.297.697 ms |
| Preparação direta da fixture                     |      14.623 ms / 1.001 commits |      14.017 ms / 1.001 commits |
| Commits das fases instrumentadas                 |                          6.268 |                          5.479 |
| Documentos retornados / writes instrumentados    |              560.893 / 191.355 |              490.792 / 187.412 |
| Maior lote: documentos lidos / writes            |                       150 / 80 |                       150 / 80 |
| Maior payload estimado, com margem               |                  457.996 bytes |                  462.268 bytes |
| Maior documento JSON estimado                    |                    4.394 bytes |                    4.659 bytes |
| Maior delta de heap amostrado / RSS amostrado    | 15.638.552 / 396.759.040 bytes | 15.621.512 / 381.222.912 bytes |
| Provas / pagamentos conferidos independentemente |                20.000 / 20.000 |                20.001 / 20.000 |
| Publicações financeiras                          |                              1 |                              1 |

Evidência persistida após todas as asserções: `reports/f02-capacity.raw.json`, conclusões `2026-10-13T03:38:47.976Z` e `2026-10-13T04:33:50.989Z`. Os dois testes estruturais passaram na suíte integral, que também concluiu com saída zero. Testes funcionais separados verificam requests duplicados/concomitantes; a matriz grande comprova ausência de duplicação na retomada pela conferência individual dos valores e publicação única. Não representa carga concorrente de 20.000 requests.

As contagens instrumentadas incluem somente commits de fase confirmados. Excluem tentativas abortadas por divisão do lote, retries internos da SDK, preflight, autenticação, consultas HTTP auxiliares e preparação da fixture; não representam leituras faturadas ou total de RPCs. O medidor verifica leituras após o retorno da SDK: uma tentativa abortada pode ler mais de 150 documentos antes de dividir, sem persistir efeitos. O máximo de 150 observado corresponde aos commits instrumentados confirmados. Bytes incluem estimativa JSON com margem, não protobuf nem índices. Heap/RSS pertencem ao processo Node, não ao JVM, e não isolam a memória de uma execução. O tempo longo e as centenas de milhares de operações exigem medição real de capacidade/custo em homologação; o emulador não aprova latência, SLO ou custo produtivos.

Ambiente local observado: Windows, Node `v22.16.0`, Temurin/OpenJDK `21.0.7+6`, Firestore Emulator `1.22.0`, Storage Rules Runtime `1.1.3`, Firebase CLI `15.33.0` do lockfile. SHA-256 de `package-lock.json`: `974726F5FBDF47226EC832F5A7AF29632FE853D0D4EDFE9AADDE4A3A067B81C3`. Essas versões registram o teste, não aprovam o runtime ou artefato produtivo; F06 permanece pendente. Nenhuma dependência foi atualizada.

## Conclusão local

| Execução                                                         | Resultado                                        | Evidência                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Unitários completos, 16 arquivos                                 | 227 aprovados, 5,19 s                            | `reports/f02-unit-final.raw.json`                              |
| Regressão integral emulada, 36 arquivos                          | 374 aprovados, 8.313,22 s, saída zero            | `reports/f02-emulator-final.raw.json`                          |
| Devoluções adicionais, mesmo arquivo e código de produção        | 4 aprovados, 40,62 s, saída zero                 | `reports/f02-partial-returns-final.raw.json`                   |
| Integrações únicas, sem contar novamente três testes sobrepostos | 375 aprovadas                                    | União por arquivo + nome completo dos dois relatórios emulados |
| Total único vigente                                              | **602 aprovados, 0 falhas, 0 pendentes, 0 todo** | 227 unitários + 375 emulados únicos                            |

O teste novo de dois recebimentos físicos e duas resoluções parciais foi acrescentado depois que o arquivo já havia sido carregado pela regressão integral. Por isso ele foi executado no recorte final, sem repetir os dois cenários grandes ou as cargas HTTP de 10/100/500. A implementação de produção não mudou depois da regressão integral. A primeira execução do teste adicional falhou por esperar `awaiting_receipt`, que nem integra o enum aprovado: uma unidade recebida com outra pendente exige `partially_received`. Evidência preservada: `reports/f02-partial-return-expectation.raw.json`. A correção mudou a expectativa para a regra existente e acrescentou verificações de solicitado, recebido, pendente, vendável e resolvido financeiro. Ambas as resoluções, os dois créditos (20 e 100 centavos), o estoque de duas unidades e o encerramento cumulativo passaram.

A comparação de identidades dos testes confirmou presença e aprovação de todos os **184 unitários e 309 emulados da base A-G (493)**. Também preservou os **330 emulados de F01**. Nenhum teste foi removido ou desabilitado para aprovar a entrega. Os recortes incrementais anteriores não foram somados ao total único.

Concorrência e recuperação: mesma chave simultânea, chaves/revisões conflitantes, executor antigo após novo fence, administrador revogado/substituído, locks de lotes compartilhados entre duas execuções reais, prova ausente reconstruída do corpo selado, prova adulterada sem overwrite, abort antes/depois de efeitos e falhas/replays legados passaram. Fontes multialocadas em 12 títulos transferem/restauram uma única vez. Cancelamento de 200 produtos com 12 títulos e backfill vazio libera 200 reservas sem crédito inventado. PDF/CSV recusam execução ativa; leitores mantêm a visão financeira anterior. Dano com aceite parcial/zero e resolução física/financeira parcial sucessiva passaram.

TypeScript, lint, formatação, build e scanner local de segredos foram aprovados. OpenAPI/tipos regenerados sem alteração de hash: 0.8.0, 114 operações, oito rotas opt-in. F07 de esquemas de saída permanece registrado; sincronização com o gerador não significa correção desse achado.

Emuladores encerrados após cada execução final. A consulta local de listeners confirmou ausência nas portas 8080, 9099, 9199, 4400, 4500 e 9150. Nenhuma sessão necessária de testes ficou em execução.

**Veredito: F02 RESOLVIDO. Integração local do frontend pronta com ressalvas documentadas; homologação externa/produção não aprovadas.** Permanecem 20.000 recebimentos HTTP reais, capacidade/custo, backpressure global, limites efetivos de SDK/Firestore, índices implantados, runtime Linux, IAM/TLS, backups/retenção e F03-F07. Não há worker automático; cliente/admin avança e retoma. Provas ou fontes irrecuperavelmente adulteradas exigem revisão/restauração controlada, nunca ajuste arbitrário de saldo.

## Restrições mantidas

Somente backend local do Lastro. Nenhum deploy, commit, push, acesso a produção, recurso pago ou mudança em outro projeto. Históricos, provas e idempotências financeiras permanecem preservados. F03–F07 permanecem fora desta implementação.
