# F02: resolução financeira retomável

## Status e decisão aprovada

**Projeto técnico aprovado em 12/10/2026; implementação e validação estrutural locais concluídas em 13/10/2026. F02 RESOLVIDO.** O usuário aprovou o desenho e as condições adicionais de integridade, compatibilidade, recuperação e validação. Resultados executados e limitações em `../validation-f02.md` e `../f02-delivery.md`: 602 testes únicos aprovados, cancelamento/devolução de 20.000 fontes diretas e oito endpoints opt-in. O corpo abaixo conserva o desenho aprovado para rastreabilidade, não representa aprovação de deploy ou capacidade produtiva.

Objetivo: concluir cancelamento financeiro e resolução de devoluções, inclusive um pedido com 20.000 recebimentos de um centavo, sem uma transação proporcional a todo o histórico. Não há mínimo comercial, teto novo de produtos, exclusão de histórico, saldo inferido ou movimentação bancária.

F01 foi corrigido separadamente e preservado na regressão. F02 concluiu os critérios estruturais locais; 20.000 recebimentos HTTP reais e homologação permanecem pendentes. O orçamento abaixo é referência técnica; as métricas reais e seu escopo limitado constam na validação, não certificam produção.

## 1. Modelo de consistência escolhido

Adotar **planejamento durável, aplicação cercada por bloqueios e publicação financeira única**. Não basta dividir a transação atual em commits e chamar o último commit de conclusão.

1. Congelar a intenção e as versões do pedido/devolução em uma transação pequena.
2. Certificar ou construir uma geração de fontes ativas, em páginas limitadas.
3. Calcular e selar o plano financeiro e suas provas, sem alterar saldos publicados.
4. Aplicar as alterações de fontes em lotes idempotentes, mantendo visibilidade financeira anterior e bloqueando uso conflitante.
5. Publicar, em um único commit pequeno, títulos, estado financeiro, destinação e evento final. O marcador `COMPLETED` desse mesmo commit troca a visão econômica para o resultado final.
6. Limpar apenas metadados de execução por tarefas verificadas, sem excluir histórico/provas/chaves financeiras.

**Ponto de linearização financeiro:** o commit de publicação. Antes dele, nenhum crédito restaurado fica disponível para uso, nenhuma obrigação nova pode ser confirmada como reembolsada e nenhuma resolução aparece como concluída. Depois dele, todos os deltas preparados já estão materializados e verificáveis.

Os documentos canônicos de fontes podem conter valores preparados depois da etapa 4. Por isso, acesso direto a esses campos deixa de ser uma interface válida: um resolvedor central retorna a versão econômica anterior enquanto a execução não estiver publicada. Esse requisito abrange leituras, listas, previews, exportações e todos os escritores. É condição de habilitação, não melhoria opcional.

Alternativa rejeitada: atualizar `financialTitles` em cada lote e expor sucesso parcial como cancelamento/devolução completa. Essa estratégia quebra a semântica atual e permite consumo antecipado de créditos.

### Interface dos módulos

O módulo coordenador de resolução concentra início, avanço, consulta, retomada e abort admissível. Os callers não acessam planos, lotes de prova ou leases diretamente. O módulo de visão econômica concentra leitura efetiva, locks e comprovação de origem para os módulos existentes. O cálculo de um passo recebe dados limitados/checkpoint e retorna deltas; transações e Firestore ficam no adapter persistente. O adapter de estoque conserva a aritmética e os movimentos C existentes.

Não espalhar `if (pendingExecutionId)` por cada handler. A migração adapta callers a essa interface comum e testa a mesma interface usada pelo HTTP. O coordenador deve aceitar dependências de relógio/persistência/autorização para exercitar crashes e fences, sem criar um motor financeiro paralelo ou um repositório genérico novo.

## 2. Dados persistentes propostos

Todas as coleções econômicas permanecem dentro de `tenants/{tenantId}`. IDs derivam de domínio, empresa, execução e chave; nenhum ID fornecido pelo cliente escolhe outro tenant.

As chaves compostas da tabela são nomes conceituais; usar digest de 64 caracteres nos IDs efetivos, não concatenação que ultrapasse `opaqueId`. Campos de ordenação ficam separados e validados.

| Registro                                            | Conteúdo e limite conceitual                                                                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `financialExecutions/{executionId}`                 | Tipo, pedido, devolução opcional, decisão administrativa, ator autorizador, payloadHash, versões iniciais, estado, fase, revision, fencingToken, lease, contadores, checkpoints e resultado final. Nunca contém lista de fontes. |
| `financialExecutionOrderLocks/{orderId}`            | executionId, fencingToken, baselineVersion/headHash, modalidade e revisão. Um dono durável por pedido.                                                                                                                           |
| `financialExecutionLotLocks/{lotId}`                | Dono, fence e versão econômica anterior do lote. Bloqueia uso/restauração concorrente em outros pedidos.                                                                                                                         |
| `financialSourceGenerations/{orderId-generationId}` | Estado de certificação, contagem real e totais por título/tipo. Apenas geração certificada pode ser consultada como índice financeiro ativo.                                                                                     |
| `financialActiveSources/{generation-source-title}`  | orderId, geração, título, tipo, sourceId, lotId opcional, ordem determinística, saldo da alocação, versão e referência de prova. Somente alocações positivas são elegíveis.                                                      |
| `financialExecutionSourcePlans/{execution-source}`  | Deltas agregados por pagamento/aplicação, até as 12 alocações existentes. Mutável apenas durante planejamento; selado antes de aplicar.                                                                                          |
| `financialExecutionLotPlans/{execution-lot}`        | Restauração acumulada daquele lote e prova de origem. Soma por lote em documentos separados; nunca Map de todos os lotes na memória.                                                                                             |
| `financialExecutionStockPlans/{execution-line}`     | Liberação de reserva para cancelamento não expedido, se necessária. Nunca recebe produto fisicamente devolvido outra vez.                                                                                                        |
| `financialProofEntries/{execution-kind-source}`     | Antes/depois, versões, hash da fonte, delta, decisão e posição no fragmento. Imutável após selamento.                                                                                                                            |
| `financialProofChunks/{execution-index}`            | Até um orçamento de entradas/bytes, hashes das entradas, totais locais e posição. Imutável após selamento.                                                                                                                       |
| `financialProofNodes/{hash}`                        | Nós Merkle imutáveis para prova de pertencimento sem ler todos os fragmentos. Domínio/hash inclui tenant e execução.                                                                                                             |
| `financialProofManifests/{executionId}`             | Raiz, quantidade de fragmentos/entradas, totais, hashes dos snapshots anterior/posterior e versão do algoritmo. Imutável na publicação.                                                                                          |
| `financialExecutionSteps/{execution-stepId}`        | PayloadHash, revisão/fase anterior, checkpoint e hashes resultantes, resultado do lote, ator e requestId. Idempotência sem expiração econômica.                                                                                  |
| `financialExecutionEvents/{execution-eventId}`      | Eventos operacionais append-only: criada, planejada, cercada, aplicada, pausada, retomada, abortada e publicada. Não são lançamentos de dinheiro.                                                                                |
| `orderLifecycleStates/{orderId}`                    | Cabeçalho comercial compacto para status/versão terminal, se necessário para publicar cancelamento sem ampliar snapshot próximo de 1 MiB. Compatibilidade descrita abaixo.                                                       |
| `returnResolutionStates/{returnId}`                 | Cabeçalho compacto de status/versão/cabeça efetiva da devolução e referência de prova financeira publicada; não copia todas as linhas/guardas.                                                                                   |

Fontes preparadas recebem `pendingExecutionId`, `pendingProofEntryId` e revisão/fence em uma versão de esquema que os leitores novos entendam. A prova guarda os campos anteriores necessários para a visão econômica, não um snapshot de todo o pedido. Os documentos de origem D e os eventos financeiros v1 não são reescritos.

Cada registro temporário permanece auditável. Não adicionar TTL a ledger, provas ou idempotência financeira. Retenção de gerações técnicas antigas, caso desejada, exige política separada; não faz parte da correção.

## 3. Estados e transições

| Estado         | Significado                                                                                                                        | Próximas transições permitidas                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ACCEPTED`     | Intenção validada, operação durável e pedido bloqueado. Sem alteração econômica.                                                   | `INDEXING`, `PLANNING`, `PAUSED`, `ABORTED`.                                                            |
| `INDEXING`     | Construção/certificação incremental das fontes ativas legadas.                                                                     | `PLANNING`, `PAUSED`, `NEEDS_REVIEW`, `ABORTED`.                                                        |
| `PLANNING`     | Deltas por título/fonte/lote calculados. Sem saldo publicado.                                                                      | `SEALING`, `PAUSED`, `NEEDS_REVIEW`, `ABORTED`.                                                         |
| `SEALING`      | Fontes congeladas e lotes cercados; provas imutáveis e raiz em construção.                                                         | `VALIDATING`, `PAUSED`, `NEEDS_REVIEW`, `ABORTED`.                                                      |
| `VALIDATING`   | Verificação incremental de origem, cobertura, totais, versões e orçamento de publicação.                                           | `READY`, `PAUSED`, `NEEDS_REVIEW`, `ABORTED`.                                                           |
| `READY`        | Plano integral selado e verificado. Ainda sem aplicação de fontes.                                                                 | `APPLYING`, `PAUSED`, `ABORTED`.                                                                        |
| `APPLYING`     | Primeira alteração de fonte ou liberação física aplicada. Intenção agora irreversível neste fluxo.                                 | `FINALIZABLE`, `PAUSED`, `NEEDS_REVIEW`. Nunca `ABORTED`.                                               |
| `FINALIZABLE`  | Todos os lotes aplicados e contadores/hash de aplicação conferem com o plano.                                                      | `COMPLETED`, `PAUSED`, `NEEDS_REVIEW`.                                                                  |
| `PAUSED`       | Falha transitória, perda de autorização ou interrupção explícita. Mantém resumeState/resumePhase e todos os bloqueios necessários. | Estado anterior autorizado; `ABORTED` somente se nenhuma aplicação começou.                             |
| `NEEDS_REVIEW` | Divergência de origem, prova, versão ou integridade. Nenhuma inferência automática de dinheiro.                                    | Retomada somente após revisão auditada que preserve o plano/provas; abortar somente antes de aplicação. |
| `COMPLETED`    | Publicação econômica final feita no mesmo commit do resultado.                                                                     | Terminal; apenas leitura e manutenção de metadados.                                                     |
| `ABORTED`      | Intenção encerrada antes de qualquer aplicação.                                                                                    | Terminal; o fluxo original permanece sem resolução financeira.                                          |

Um erro transitório não é estado terminal `FAILED` que abandona dinheiro. Tentativas, último erro seguro e backoff são metadados. `leaseUntil` não autoriza liberar bloqueio econômico. Um executor substituto adquire novo fence e continua a mesma operação.

Abortar o workflow de uma devolução não cancela a devolução física, não apaga recebimentos e não reduz `activeReturnCount` artificialmente. Os bloqueios originais da devolução continuam conforme pendência física/financeira.

## 4. Checkpoints e progresso verificável

Checkpoints persistidos identificam fase, último ID/chave de ordenação, número de fontes examinadas/elegíveis, fragmentos selados/aplicados, somas por título/tipo e hash acumulado. A posição vem do backend; `advance` não aceita cursor econômico editável pelo cliente.

Cada commit de lote grava, atomicamente, efeitos daquele lote, passo idempotente, evento operacional e próximo checkpoint/revision. Se o processo cair, o registro do passo distingue commit confirmado de tentativa não aplicada. Não atualizar primeiro o cursor e depois as fontes.

Planejamento utiliza registros agregados por fonte, pois um pagamento pode atingir vários títulos. Uma entrada é aplicada uma única vez com todas as suas alocações, não uma vez por título. Acumuladores por lote são documentos limitados, atualizados junto com o checkpoint. Apenas o selamento cria provas imutáveis.

O selamento enumera planos por posição estável, produz fragmentos e constrói a árvore Merkle em etapas. O frontier persistido tem profundidade limitada pelo inteiro seguro de contagem, não pelo tamanho de um array de IDs. A raiz incorpora domínio, tenant, execução, quantidade e posição das folhas; não aceitar árvore ambígua por padding ou ordem.

Uma nova passagem de validação confere sequência/cobertura dos fragmentos, hashes, prova antes/depois e totais contra o snapshot congelado. A aplicação mantém sua própria cadeia de passos e contador de entradas. A publicação compara certificados selados, contagens e somas; não relê todas as fontes no commit final.

Progresso HTTP distingue `examined`, `eligible`, `planned`, `applied` e `published`. Durante indexação, `total`/percentual são nulos se o denominador ainda não foi certificado. `applied == planned` não implica conclusão: falta publicar. Em `NEEDS_REVIEW`, expor código e referência segura, não conteúdo de fontes privadas.

## 5. Ordem financeira e invariantes

Preservar exatamente a ordem existente em `FinancialService.prepareRebate()`:

1. Abater dívida em títulos ordenados por vencimento e número de parcela.
2. Restaurar créditos já aplicados, na ordem determinística atual dos títulos e aplicações.
3. Destinar caixa pago restante a crédito do cliente ou obrigação de reembolso, conforme decisão administrativa.

Para valor aceito `A`:

```text
D = min(A, dívida disponível)
C = min(A - D, crédito aplicado disponível)
P = A - D - C
P deve caber no caixa liquidado comprovado
A = D + C + P
originalDoTítulo = dívida + caixa + crédito + cancelado
```

`cashReceivedCents` permanece histórico bruto, sem redução artificial. A publicação reduz caixa liquidado em `P`, reduz crédito aplicado em `C`, aumenta caixa transferido em `P` e aumenta cancelado em `A`. Cada fonte respeita quantidade/centavos ainda disponíveis. Restaurar crédito não emite outro crédito pelo mesmo valor. Um único lote de destino ou obrigação recebe apenas `P`.

Cancelamento financeiro não expedido resolve integralmente os componentes atuais e libera suas reservas. Expedido continua exigindo devolução própria. Não converter cancelamento em recebimento nem inventar estorno para diminuir o número de fontes.

Devoluções conservam guardas cumulativas por linha: expedido, intenção reservada, fisicamente recebido, recebido vendável/não revendável, quantidade já resolvida e valor aceito acumulado. O plano seleciona somente quantidade elegível efetivamente recebida. Não presume recebimento de todo o saldo da intenção.

Produto não revendável exige aceite administrativo explícito, com valor integral, parcial ou zero dentro do limite atual. Quantidade resolvida e centavos aceitos são dimensões distintas. Valor zero tem plano monetário vazio, mas decisão, prova, evento e publicação obrigatórios; não precisa varrer todos os recebimentos apenas para criar referências vazias.

Recebimento vendável aumenta estoque somente no fluxo físico já existente. O executor financeiro nunca adiciona novamente esse estoque. Danificados permanecem fora do vendável. `COMPLETED` de uma resolução parcial não encerra automaticamente a devolução: pendência física ou financeira ainda mantém o bloqueio original.

Reembolso continua manual: a publicação cria a obrigação pendente. Somente o endpoint separado de confirmação administrativa registra valor efetivamente devolvido. Nenhuma chamada a banco ou PSP.

## 6. Fontes ativas, memória e compartilhamento de lotes

Consultar índice certificado de alocações positivas por pedido, geração, tipo e título, com ordenação equivalente à política atual. Pagamentos zerados/totalmente transferidos deixam de participar das consultas operacionais; permanecem no histórico. Para caixa, preservar a ordem atual de pagamentos e os valores alvo por título, inclusive pagamento multialocado.

Escritores de recebimento, aplicação, estorno e reversão atualizam a projeção no mesmo commit de suas fontes/títulos. O resolvedor verifica versão e prova da fonte: o índice não se torna autoridade autônoma para emitir dinheiro.

Uma geração nova é construída em páginas, sem interferir na geração publicada. Certificar somas por título/tipo contra estado/ledger antes de usar. O plano produz a próxima geração completa, incluindo fontes ativas não afetadas. A publicação troca um ponteiro de geração; não atualiza 20.000 índices no último commit.

Lotes de crédito são compartilhados entre pedidos. Congelar somente o pedido é insuficiente. Restaurações selecionadas são agrupadas por lote e os lotes são cercados em ordem crescente de ID. Operações financeiras normais consultam o bloqueio do lote na mesma transação. Execuções concorrentes usam a mesma ordem de aquisição; nenhuma espera mantendo ciclo de locks. Um conflito antes de cercar todos os lotes pausa/backoff, sem aplicação financeira.

Outros pedidos podem usar um lote antes de seu cerco. A versão do lote é capturada ao adquirir o lock; o plano de restauração usa o saldo global atualizado e prova que `available + applied == issued`. A origem e a quantidade restaurável do pedido congelado não mudam. Divergência verdadeira vai para revisão; não sobrescrever o lote com uma versão antiga.

Depois de aplicar um lote, seu valor econômico anterior permanece visível e seu uso fica bloqueado até publicação. O lock fica logicamente liberado quando a execução dona está `COMPLETED` ou `ABORTED` admissível. Isso permite liberar milhares de lotes com um marcador, não milhares de writes no commit final. Manutenção posterior só altera metadados se executionId/fence ainda corresponderem; nunca desbloqueia outro dono.

Índices novos propostos: fontes por orderId/generation/tipo/título/ordem estável; planos por executionId/tipo/ID; fragmentos por executionId/index; execuções por status/updatedAt e orderId/createdAt; cabeçalhos comerciais por status/createdAt/customerId conforme os filtros existentes. Usar igualdade da geração publicada, nunca cursor que dependa de uma fonte já alterada. Revisar campo a campo e isentar mapas de prova/snapshots de indexação desnecessária; declarar índices na implementação, sem implantá-los nesta rodada. Medir reads/escritas/index entries por fonte e tamanho do backfill, não apenas tempo do worker.

## 7. Visibilidade, cancelamento e estoque

Adicionar um resolvedor econômico único para fontes, lotes, títulos, pedido e devolução. Enquanto há `pendingExecutionId` não publicado, ele devolve valores anteriores comprovados e estado de processamento. Depois da publicação, devolve valores posteriores. Cache de manifestos/provas é limitado por request, nunca uma cache global ilimitada.

Adaptar explicitamente `FinancialBook`, `FinancialReads`, leitores/escritores de pagamento/crédito/reembolso, previews, CSV, PDFs e todos os checks de pedido/devolução. Queries não podem filtrar campos preparados e depois fingir que representam saldo publicado: usar geração ativa ou projeção escalar da visão econômica.

O bloqueio do pedido impede recebimento, estorno, aplicação/reversão de crédito, nova resolução, expedição e cancelamento conflitante. Para estabilizar versões/guardas, também impede alterações físicas/intenção/encerramento desse pedido enquanto a execução está ativa. Essa restrição temporária nova deve ser aprovada junto ao desenho e exposta no frontend. Não altera quanto pode ser devolvido; apenas serializa o fluxo.

Cancelamento não expedido pode ter muitas reservas. Liberá-las em lotes pelo adaptador de estoque, somente depois de tornar a intenção irreversível em `APPLYING`. Cada liberação usa reserva da linha, movimento idempotente e estoque atual, permitindo outros pedidos mudarem o mesmo produto entre lotes. A soma do estoque permanece consistente em cada commit. Não se pode expedir o pedido congelado.

A disponibilidade física liberada pode ser usada por outros pedidos antes da publicação financeira. O pedido original ainda aparece em processamento de cancelamento, não como cancelado financeiramente. Depois da primeira liberação, não existe `abort`; recuperação continua o cancelamento. Essa separação físico/financeiro e a irreversibilidade após aplicação são decisões estruturais explícitas para aprovação.

Um pedido próximo de 1 MiB pode não caber ao ampliar `canceledBy`, timestamps e versões. Não copiar seu snapshot para a operação nem truncar conteúdo. A solução proposta é cabeçalho compacto `orderLifecycleStates`, lido junto ao snapshot, com status/versão/ator terminal. Não é a proposta de fragmentação de snapshots grandes: linhas comerciais e origens D ficam intactas.

Esse cabeçalho exige adaptação de todos os leitores/guardas de pedidos e uma projeção escalar indexada para listas por status, sem depender do status antigo do snapshot. Com writers novos, cabeçalho e pedido normal permanecem coerentes; após cancelamento por execução, cabeçalho terminal prevalece. É ampliação explícita do escopo D/G do desenho F02 e precisa de aprovação. Sem essa adaptação, o projeto não pode prometer completabilidade para documentos no limite técnico.

O mesmo cuidado vale para `ReturnService.finish()`: atualmente ele salva todas as guardas e incorpora snapshots anterior/posterior no evento de devolução. F02 não pode manter esse fan-out no commit de publicação. Preparar os deltas financeiros de cada linha/guarda em lotes com prova e `pendingExecutionId`; o resolvedor de devolução preserva quantidades/valores anteriores até publicação. Um evento de devolução v2 e `returnResolutionStates` publicam apenas hashes, contagens e raiz, deixando as linhas comprovadas nos fragmentos. A view HTTP continua materializando as linhas permitidas, em leitura limitada, sem copiar toda a prova para um documento.

O saldo físico não muda nesses deltas financeiros. Recebimentos/cancelamentos físicos posteriores precisam ler a cabeça/guarda efetiva e entender provas v1/v2. Não reutilizar um writer antigo que valide apenas `event.guards` inline e ignore a raiz v2. Quantidade financeira resolvida, status efetivo, cabeça da devolução e `activeReturnCount` tornam-se visíveis juntos na publicação. Assim, o último commit não depende nem do número de recebimentos financeiros nem do número de guardas devolvidas. Essa adaptação E/G também integra o escopo estrutural a aprovar.

## 8. Idempotência, concorrência e autorização

- **Início:** `Idempotency-Key` UUID + tenant + tipo + alvo determina executionId. Mesma chave/payload retorna mesma execução; chave reutilizada com outro payload retorna conflito. A autorização atual é conferida mesmo em replay.
- **Exclusão por pedido:** criar operação e lock em um único commit. Outra chave não cria outra execução ativa para o mesmo pedido.
- **Passo:** chave idempotente por tentativa lógica, expectedExecutionRevision e fencingToken. Mesmo passo aplicado não aplica deltas novamente. Resposta repetida identifica seu checkpoint; pode incluir status atual, sem fingir que a resposta anterior representa todo o fluxo concluído.
- **Fence:** aquisição de lease incrementa token; cada write compara dono/fence dentro da transação. Executor antigo não pode gravar depois de uma retomada.
- **Pré-condições:** comparar versões/hashes das fontes, baseline financeiro e plano selado. Uma fonte preparada só pode avançar por seu dono. Conflito inesperado após aplicar preserva os bloqueios e exige revisão.
- **Permissões:** financeiro continua exclusivo de administrador da empresa. Start/abort/resume/revisão sensível exigem reautenticação recente. Avanços verificam autorização atual e a intenção administrativa registrada; não autorizam novo payload nem nova decisão financeira.
- **Revogação/suspensão:** parar execução automática quando ator autorizador perde acesso ou empresa fica suspensa. Outro administrador atual, com reauth e auditoria, pode assumir a mesma intenção; não trocar silenciosamente o ator.
- **Superadmin:** sem acesso comercial implícito, sem endpoint de “forçar saldo” ou desbloqueio sem prova.

Vendedor não consulta execução, progresso, lotes, prova ou valores financeiros. Nos módulos comerciais, recebe somente indisponibilidade genérica de ação sobre o pedido; executionId e detalhes financeiros ficam nas views administrativas. O cabeçalho terminal comercial contém apenas os campos comerciais permitidos.

O plano selado não pode mudar disposição, valor aceito ou linhas após aplicação. Antes disso, abortar e criar nova intenção com outra chave, preservando a anterior. Depois disso, qualquer compensação nova exige desenho próprio, não um botão de abort que reverta parcialmente dinheiro.

## 9. Falhas e recuperação

| Falha                                      | Resultado obrigatório                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Antes do commit de início                  | Nenhuma execução/lock; repetir mesma chave.                                                     |
| Depois do início, resposta perdida         | Replay localiza execução aceita, sem duplicar intenção.                                         |
| No meio do planejamento/selamento          | Retomar pelo último passo confirmado; fragmento não selado não é prova final.                   |
| Lote aplicado, resposta perdida            | Registro idempotente prova aplicação; retry não soma novamente.                                 |
| Processo morto/lease expirado              | Novo executor cerca por fence e retoma; nenhum desbloqueio por relógio.                         |
| Falha ao ler origem ou fragmento           | Pausar/revisão; nunca tratar ausência como saldo zero.                                          |
| `APPLYING` interrompido                    | Leituras econômicas anteriores e locks continuam; completar plano original.                     |
| Publicação concorrente ou resposta perdida | Um commit final; replay/status mostra `COMPLETED` com o mesmo resultado.                        |
| Falha de manutenção após publicação        | Resultado continua concluído; uso consulta marcador final. Cleanup não repete dinheiro/estoque. |
| Divergência privilegiada após aplicar      | Revisão auditada; não inventar origem, apagar histórico ou liberar lock por endpoint genérico.  |

A retomada operacional não depende de memória do processo. Na implementação local, `advance` administrativo e runner local limitado podem executar passos. Qualquer worker/scheduler de homologação será decisão de infraestrutura separada; este desenho não cria Cloud Tasks, cron pago ou deploy.

Não é garantia de conclusão quando origem foi corrompida, acessos foram revogados indefinidamente ou serviço nunca volta. A garantia de completabilidade é ausência de teto proporcional ao histórico dentro de um commit/documento, com progresso idempotente e retomável para dados íntegros e serviços disponíveis. Medir tempo/custo antes de anunciar SLA.

## 10. Limites técnicos propostos

| Orçamento                                 | Proposta inicial e reação                                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documento de operação/manifesto/fragmento | Até 256 KiB estimados; fragmentar por bytes antes de escrever. Documento do pedido já existente continua sujeito ao limite original; não é copiado para fragmentos.                                                           |
| Prova individual de fonte                 | Provar limite por esquema; objetivo até 64 KiB. Guardar somente a fonte/valores pertinentes, não seu pedido inteiro. Se um legado exceder o orçamento, usar fragmento próprio/referência verificável, sem rejeição comercial. |
| Lote operacional                          | Até 25 fontes, reduzido dinamicamente por bytes/leituras/writes. Não impor limite de 25 fontes por pedido.                                                                                                                    |
| Commit de lote                            | Meta conservadora até 2 MiB de payload estimado, até 100 writes e 150 leituras planejadas. São orçamentos internos, não supostos limites oficiais.                                                                            |
| Publicação                                | Até 12 títulos, um estado/guarda, um evento, manifesto, execução, marcador comercial/devolução e até um destino. Fontes, lotes e reservas já foram preparados. Não depende de 20.000 IDs ou liberações.                       |
| Tempo por avanço                          | Meta de 5 s; parar admissão de próximo lote aos 3 s. SDK timeout/lease não significam rollback de commit; usar prova do passo para resposta ambígua.                                                                          |
| Lease                                     | Proposta de 30 s com renovação/fence; não muda autorização nem remove locks quando vence.                                                                                                                                     |
| Memória por execução                      | Meta de trabalho incremental até 16 MiB além do snapshot de pedido/documentos pontuais; cache limitado e sem arrays/maps de todas as fontes/lotes. Medir RSS também, pois custo da SDK supera dados brutos.                   |
| Paralelismo                               | Um executor por pedido; poucos executores por instância/empresa, com fila durável e backpressure. Número final depende de medição.                                                                                            |
| API                                       | Reutilizar limite atual de corpo; passos com payload pequeno. Cursores de leitura/prova assinados e limitados, sem expor lista privada de fontes no status.                                                                   |

Firestore possui 1 MiB por documento, 10 MiB por requisição e limite temporal de transação. Os orçamentos precisam incluir metadados, encoding/protobuf e margem, não apenas soma de JSON. Índices/custo também exigem medição fora do emulador. Não usar uma suposição universal de 500 gravações. [Limites oficiais](https://firebase.google.com/docs/firestore/quotas?hl=en).

Quando um lote não cabe, dividir antes da transação e continuar. Não rejeitar recebimento mínimo nem criar teto comercial. Antes de `APPLYING`, provar que publicação, cada fonte e passos físicos cabem no desenho. Falha nessa prova é um bug/legado a revisar, não autorização para abandonar uma operação já parcialmente aplicada.

## 11. HTTP e frontend

Atualização de implementação: as oito rotas opt-in estão presentes no código local, em OpenAPI 0.8.0. O contrato efetivo está em `../api/financial-executions.md`. A matriz final de validação está em `../validation-f02.md`; presença de rota não significa aprovação da carga ou prontidão para publicação.

Manter endpoints atuais e resultados já concluídos. Criar caminhos opt-in, evitando transformar silenciosamente um `200` antigo em `202`:

| Método/caminho proposto                               | Comportamento                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `POST /orders/{id}/financial-cancellation-executions` | Payload compatível de cancelamento + chave; retorna `202` após início durável.                                            |
| `POST /returns/{id}/resolution-executions`            | Payload de resolução/aceite atual + chave; retorna `202`.                                                                 |
| `GET /financial-executions/{id}`                      | Status atual, fases, progresso, bloqueios, revisão e resultado final somente quando publicado.                            |
| `GET /financial-executions`                           | Pendências administrativas paginadas e isoladas por empresa.                                                              |
| `POST /financial-executions/{id}/advance`             | Um orçamento limitado de trabalho; chave/revisão; `202` se pendente, `200` com `completed: true` somente após publicação. |
| `POST /financial-executions/{id}/resume`              | Assunção/retomada auditada com reauth e revisão.                                                                          |
| `POST /financial-executions/{id}/abort`               | Apenas antes de qualquer aplicação. Não encerra devolução física.                                                         |
| `GET /financial-executions/{id}/proof-reconciliation` | Verificação paginada cumulativa de fragmentos/raiz, sem reparar.                                                          |

O envelope mantém `data` e `requestId`. Campos explícitos: `status`, `phase`, `financialCompleted`, `publishedAt`, `revision`, `progress`, `blockedResources` resumidos, `retryAfterSeconds` e `result` nulo antes da conclusão. Não usar `financialResolved` ou `order.status=canceled` para sinalizar mero progresso.

Erros propostos: `FINANCIAL_OPERATION_IN_PROGRESS`, `FINANCIAL_LOT_LOCKED`, `FINANCIAL_RESUMABLE_REQUIRED`, `EXECUTION_CONFLICT`, `EXECUTION_REVIEW_REQUIRED`, `EXECUTION_ABORT_NOT_ALLOWED`. Usar `409`, `422`, `429` e `503` conforme causa, com política documentada; adicionar `202`/`503` ao OpenAPI na rodada F02, não agora.

Endpoints antigos de cancelamento/resolução podem conservar caminho atômico quando o custo completo é comprovadamente pequeno. Se não couber, responder `409 FINANCIAL_RESUMABLE_REQUIRED` antes de qualquer efeito, indicando o novo caminho. Nunca repetir uma tentativa de `413` com efeitos parciais ocultos. Todas as fontes/projeções/locks precisam ser entendidas mesmo pelo caminho rápido; não manter dois modelos econômicos incompatíveis.

Frontend React Native/Expo/Web deve oferecer acompanhamento/retomada, não uma tela de sucesso ao receber `202`. Recarregar status após perda de conexão, logout/relogin ou troca de administrador. A chave do início identifica intenção; a chave de avanço identifica passo, não deve executar o próximo lote quando repetida. Polling GET não movimenta dinheiro. “Reembolso pendente” não significa valor bancário devolvido.

Leituras informativas de estado/histórico continuam disponíveis e identificam a visão publicada anterior com execução pendente. PDFs finais e páginas CSV que incluam um pedido financeiro em execução retornam `409 FINANCIAL_OPERATION_IN_PROGRESS`; não omitir silenciosamente a linha nem exportar campos preparados como dinheiro disponível. Depois da publicação, gerar normalmente. Contrato e frontend devem tratar esse bloqueio sem combinar saldos parciais.

## 12. Eventos, provas e contratos anteriores

Preservar hashes e conteúdo de eventos v1. Novo evento financeiro v2 inclui referências curtas de destino e manifesto, raiz, contagens e hashes do antes/depois. Não concatenar todas as fontes em `references`. O verificador reconhece v1/v2 sem recalcular hashes antigos com campos novos.

Eventos de devolução v2 também referenciam manifestos e provas de linha, em vez de duplicar todas as guardas/snapshots. Snapshots comerciais existentes não são fragmentados nem truncados. Leitores mistos conferem o esquema específico de cada evento e seus hashes originais.

Origem de um crédito emitido continua identificada por evento final e ID de destino. `lotFor()` deixa de depender de lista ilimitada para outras fontes; prova de pertencimento ao fragmento usa entrada, folha e caminho Merkle limitado. Estados de lote/fontes preparados exigem prova da execução e publicação, não apenas `schemaVersion` aceito.

Reconciliação de journal F01 deve preservar seu checkpoint para eventos v1 e versionar o caminho de v2. Verificar a raiz do evento não significa ter percorrido todos os fragmentos. Expor claramente escopo `journal` versus prova completa; resultado completo das fontes exige também a reconciliação dos fragmentos. Cursores ligados a cabeça/formato antigo exigem reinício explícito.

Provas detalhadas são paginadas por endpoint separado. Não acrescentar arrays grandes a views antigas. Publicar OpenAPI/tipos para a versão contratual F02 aprovada, provavelmente 0.8.0. Nenhum endpoint dessa tabela foi adicionado ao 0.7.0 nesta rodada.

## 13. Migração e pedidos já bloqueados

1. **Inventário local/homologação autorizado:** localizar estados por pedido com versões, cabeça, fontes, lotes e devoluções. Somente leitura, sem inferir dinheiro ou acessar produção nesta tarefa.
2. **Release de compatibilidade:** todos os escritores/leitores entendem locks, visão econômica e schemas v1/v2 antes de habilitar execução. Guardas precisam estar em todos os caminhos, inclusive estoque/expedição e leitura de lotes de outro pedido. Proibir tráfego de binários antigos durante workflow ativo.
3. **Backfill paginado:** construir gerações ativas e cabeçalhos comerciais escalarmente. Cada pedido captura cabeça/versão; se writers legítimos mudarem a origem, reiniciar somente sua geração. Em pedido congelado, geração completa fica certificada por contagens/totais. Histórico permanece intacto.
4. **Ativação opt-in:** habilitar novas execuções somente para esquema/capacidade compatíveis. Rollback do binário não pode retornar a código que ignora locks/fontes preparadas. Pausar novos inícios e continuar drenagem por binário compatível.
5. **Casos F02 existentes:** uma rejeição `413` atômica não criou operação econômica; verificar origens, capturar versões atuais e iniciar nova execução. Preservar a decisão original e sua rastreabilidade; não fabricar sucesso anterior.
6. **Devolução já recebida:** validar seus recebimentos/guardas e a decisão administrativa atual, iniciar execução contra a própria devolução. Não exigir novo recebimento, não tentar `cancel-pending` sem saldo físico, não reduzir bloqueio nem estornar artificialmente.
7. **Estado parcialmente resolvido válido:** tratar somente saldo físico/financeiro ainda elegível e demais fontes ativas. Resolução anterior permanece como origem, não é repetida.
8. **Legado sem origem comprovada/inconsistência:** `NEEDS_REVIEW` ou erro de revisão antes de aplicar. A migração não cria crédito nem corrige centavos por diferença.

Idempotências anteriores concluídas conservam respostas anteriores e checks de autorização. A nova executionId é namespace próprio. Uma chave que identifica resolução antiga concluída não passa a iniciar outra resolução. Não aplicar TTL novo às chaves para facilitar a migração.

Ferramentas de migração precisam de dry-run, seleção explícita de projeto demo/ambiente autorizado, checkpoint, relatório de divergências, limites por lote e retomada. Nada dessa migração foi executado agora.

## 14. Matriz adversarial e aceite

**Preservar os 493 testes originais e as regressões F01.** Não diminuir asserções nem substituir testes atômicos por sucesso parcial. Acrescentar testes pelo HTTP com emuladores, unitários de aritmética/prova e falhas em fronteiras de commit.

**Estratégia local revisada por autorização de 12/10/2026:** executar recebimentos reais pela API em volumes de 10, 100 e 500. Construir diretamente no emulador o cenário de 20.000 fontes financeiras válidas, incluindo origens, cadeia de eventos, títulos e projeções coerentes. Nesse cenário, testar cancelamento e devolução, publicação financeira única, integridade dos saldos, idempotência e recuperação após falhas. Não executar 20.000 chamadas HTTP individuais durante o desenvolvimento local. Essa carga permanece pendente de homologação/capacidade e não condiciona o aceite estrutural local; as demais garantias e regressões permanecem obrigatórias.

| Cenário                                                     | Aceite obrigatório                                                                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20.000 recebimentos de R$ 0,01, total R$ 200,00, uma linha  | Cancelamento retomável conclui; dívida/caixa/crédito/destino corretos; nenhum documento/commit cresce com todas as fontes.                                                                            |
| Mesmo histórico, expedição e devolução recebida vendável    | Estoque aumenta uma vez no recebimento; resolução termina por etapas; bloqueio original termina somente quando elegível.                                                                              |
| 10, 100 e 500 recebimentos reais pela API                   | Validar admissão, saldos, fontes ativas, repetição da mesma chave e regressões funcionais. Usar somente emuladores locais. Não substituir recebimentos por escrita direta nesses testes.              |
| 20.000 recebimentos mínimos por API                         | **Pendente de homologação/capacidade. Não executar nesta implementação local nem apresentar como aprovado.** Medir admissão, quotas, latência e capacidade reais somente após autorização específica. |
| 20.000 fontes válidas geradas diretamente no emulador       | Validar schemas, origens, cadeia, contagem e projeções; executar cancelamento, devolução, publicação única, saldos, idempotência e recuperação. Não representa 20.000 chamadas HTTP.                  |
| Muitos recebimentos totalmente estornados                   | Caminho quente usa fontes positivas; história continua consultável; backfill é limitado e retomável.                                                                                                  |
| Muitas aplicações do mesmo lote; muitos lotes distintos     | Restauração por lote exata, sem Map global ou publicação com todos os lotes; uso concorrente não consome valor preparado.                                                                             |
| Pagamento/crédito multialocado, 12 parcelas e parcelas zero | Uma fonte aplicada uma vez; totais e política determinística preservados.                                                                                                                             |
| Dívida + crédito + caixa; devolução parcial                 | Ordem D/C/P preservada, até o último centavo; nenhum valor excedente.                                                                                                                                 |
| Danificado: aceites integral/parcial/zero                   | Aceite administrativo obrigatório; zero não gera obrigação/lote; vendável não aumenta.                                                                                                                |
| 1, 20, 50, 100 e 200 produtos                               | Sem novo teto/mínimo comercial; reservas, movimentos e cabeçalhos efetivos corretos.                                                                                                                  |
| Snapshot perto de 1 MiB, texto UTF-8 e IDs máximos          | Publicação usa projeção compacta e prova limitada; não amplia o snapshot além do teto nem trunca conteúdo.                                                                                            |
| Dois inícios e várias instâncias avançando                  | Um dono; um efeito por passo/fonte; perdedor recebe replay ou conflito seguro.                                                                                                                        |
| Executor antigo após lease vencido                          | Fence rejeita writes obsoletos, inclusive depois de outro administrador assumir.                                                                                                                      |
| Queda antes/depois de cada commit e resposta perdida        | Estado retomável; sem dupla soma, dupla reserva liberada ou dupla emissão.                                                                                                                            |
| Fonte/fragmento ausente, adulterado ou repetido             | Revisão/inconsistência, nunca saldo zero inferido ou `COMPLETED` falso.                                                                                                                               |
| `abort` antes/depois da primeira aplicação                  | Antes: nenhum efeito econômico; depois: rejeição e fluxo ainda retomável.                                                                                                                             |
| Crédito versus estorno/restauração em outros pedidos        | Locks compartilhados impedem uso conflitante e deadlock; não bloquear outra empresa.                                                                                                                  |
| Recebimento versus cancelamento/expedição/intenção          | Guardas nos escritores decidem um único estado; nenhuma operação ignora execução ativa.                                                                                                               |
| Permissão revogada/empresa suspensa/tenant externo          | Pausa ou negação atual; nenhuma continuação privilegiada por cursor/chave antiga.                                                                                                                     |
| Publicação e cleanup concorrentes                           | Um evento final/destino; limpeza antiga não remove lock de novo dono nem altera dinheiro.                                                                                                             |
| OpenAPI/React Native/Expo/Web                               | `202` nunca vira sucesso financeiro; contratos/estados/erros/downloads atualizados e testados.                                                                                                        |

F02 só recebe aceite estrutural local quando os cenários locais obrigatórios comprovarem, além do resultado final, limites observados de bytes, reads/writes por lote, memória e tempo. O teste de 20.000 chamadas HTTP permanece uma pendência explícita de homologação/capacidade. Emuladores não certificam produção: validar o artefato e os limites reais em homologação posteriormente autorizada.

## 15. Sequência de implementação após aprovação

1. Schemas, provas, resolvedor econômico e compatibilidade dos leitores; nenhuma execução habilitada ainda.
2. Guardas globais de pedido/lote, projeções ativas e backfill local certificado; testes de escritores antigos/adaptados.
3. Motor durável de planejamento/selamento/validação e idempotência; falhas ainda sem efeitos econômicos.
4. Aplicação cercada de fontes/lotes/reservas e publicação única; testes de crash/fence/visibilidade.
5. Endpoints opt-in, estados/progresso, frontend contract, exportações/documentos e retomada de pedidos bloqueados.
6. API funcional com 10, 100 e 500 recebimentos; stress estrutural com 20.000 fontes válidas geradas no emulador; matriz adversarial, suíte completa, documentação e relatório de limites. Manter 20.000 chamadas HTTP como pendência de homologação/capacidade.

**Aprovação específica solicitada:** estados/transições acima; visão anterior sob preparação; cerco global de lotes; bloqueio físico temporário durante execução; liberação de reservas após tornar cancelamento irreversível; cabeçalho comercial compacto; guardas/cabeça de devolução com prova fragmentada; publicação única; HTTP opt-in; migração/rollback somente com binário compatível. Não há aprovação solicitada para limite comercial, apagar histórico, alterar saldos por aproximação ou implantar infraestrutura.
