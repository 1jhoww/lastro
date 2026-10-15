# F02: contrato de execucoes financeiras

Contrato opt-in de OpenAPI 0.8.0. As rotas financeiras atomicas anteriores mantem HTTP 200 e seus resultados. Historicos com mais de 100 pagamentos ou aplicacoes devem usar a rota retomavel: a rota atomica retorna `409 FINANCIAL_RESUMABLE_REQUIRED` antes de carregar o historico. Isso e selecao tecnica do executor, nao limite comercial ou perda de historico.

Todas as rotas exigem Firebase ID Token e `X-Tenant-Id`, autorizacao administrativa atual e vinculo ativo. Todo POST exige UUID `Idempotency-Key`. Inicio, retomada e abort exigem autenticacao recente de ate cinco minutos.

| Metodo | Rota relativa a `/api/v1`                         | Entrada                                               |
| ------ | ------------------------------------------------- | ----------------------------------------------------- |
| POST   | `/orders/{id}/financial-cancellation-executions`  | `cancellationInput` existente                         |
| POST   | `/returns/{id}/resolution-executions`             | `returnResolve` existente, incluindo decisoes de dano |
| GET    | `/financial-executions/{id}`                      | Sem corpo                                             |
| GET    | `/financial-executions`                           | `limit`, `cursor`, `status`, `orderId`, `pending`     |
| POST   | `/financial-executions/{id}/advance`              | `expectedRevision`, `fencingToken`                    |
| POST   | `/financial-executions/{id}/resume`               | `expectedRevision`, `reason`                          |
| POST   | `/financial-executions/{id}/abort`                | `expectedRevision`, `reason`                          |
| GET    | `/financial-executions/{id}/proof-reconciliation` | `limit`, `cursor`                                     |

## Integracao React Native, Expo e Web

1. Inicie a operacao e persista ID e chave de idempotencia. Reenvie a mesma chave e corpo se perder a resposta.
2. Exiba status, fase e progresso. `total=null` significa denominador ainda nao certificado. Nunca considere `applied==total` como conclusao.
3. Avance explicitamente com revisao e fence recebidos. Cada chamada confirma ate cinco lotes limitados, com parada cooperativa de aproximadamente tres segundos entre lotes. Um lote/transacao pode demorar mais por rede ou retries.
4. Reutilize a mesma chave de passo quando perder a resposta. Chaves novas precisam da revisao atual. Passos confirmados retornam seu snapshot original; consulte GET para estado mais recente.
5. Em `EXECUTION_CONFLICT`, consulte GET. Em `EXECUTION_LEASE_CONFLICT`, reautentique e retome. A retomada incrementa fence; descarte executor antigo.
6. Em `PAUSED` ou `NEEDS_REVIEW`, nao siga avancando automaticamente. Mostre referencia segura e solicite retomada administrativa auditada. Prova ausente pode ser reconstruida somente a partir do corpo selado verificavel. Prova alterada, backup ausente ou saldo divergente nao recebe saldo inventado.
7. Somente `financialCompleted=true`, `status=COMPLETED`, resultado e `publishedAt` significam conclusao financeira. POST retorna 202 durante processamento, 200 para COMPLETED ou ABORTED. GET retorna 200 informativo mesmo quando pendente.
8. Nao ofereca abort depois de `applicationStartedAt` interno: use estado/progresso e aceite que servidor rejeita `409 EXECUTION_ABORT_NOT_ALLOWED`. Abort nunca cancela recebimento fisico ou intencao de devolucao.

Nao ha worker agendado, deploy, banco ou PSP automatico. Fechar aplicativo nao conclui nem abandona operacao. Novo administrador autorizado pode assumir lease expirado ou execucao pausada; lease ativo de outro administrador impede tomada concorrente.

`progress` contem contadores tecnicos, nao valores monetarios. `planned`, `sealed`, `validated`, `applied` e `total` contam entradas de prova, nao recebimentos ou produtos. Pagamento multialocado gera uma entrada agregada; lotes e linhas de devolucao podem acrescentar entradas. `releasedReservations` conta linhas de reserva, nao unidades fisicas. Durante recuperacao limitada, revisao pode avancar sem alterar esses contadores; continue consultando estado, fase e revisao, sem inferir conclusao ou porcentagem monetaria. Checkpoints detalhados permanecem privados no backend.

`blockedResources` descreve a execucao, nao todos os bloqueios comerciais do pedido. `sharedLots` informa lotes planejados relacionados enquanto pendente, nao uma listagem dos locks adquiridos. Execucao terminal pode informar `order=false` e a intencao de devolucao ainda bloquear mutacoes por saldo fisico pendente. Consulte o estado atual do pedido/devolucao e respeite os erros do servidor.

Pedido e lotes cercados permanecem bloqueados mesmo apos lease expirar. Antes da publicacao, leitores financeiros devolvem saldos anteriores comprovados. PDF/CSV relacionados a pedido em execucao recusam download conflitante. Produtos fisicamente devolvidos nao recebem nova entrada pelo executor. Reservas de cancelamento podem ser liberadas em lotes antes da publicacao; nao cabe abort depois da primeira liberacao.

Devolucao parcialmente resolvida pode manter saldo fisico pendente apos COMPLETED da execucao. O bloqueio da intencao original continua. Reembolso permanece obrigacao manual, confirmada pelo endpoint financeiro existente.

O historico de devolucao conserva paginacao por ID, nao por sequencia cronologica. Nao presuma que o ultimo item seja o evento mais recente. Identifique eventos por `id` e `sequence`; consulte GET `/returns/{id}` para o estado atual materializado. O historico financeiro do pedido usa sequencia e ID, conforme contrato anterior.

## Provas e limites

Reconcilicao de provas tem escopo `proofs`, nao substitui F01 do journal. Cursor assinado vincula tenant, ator, execucao, raiz, quantidade e limite. Falha acumulada nunca volta a true. Pagina ausente ou entrada alterada produz `consistent=false`; cursor editado ou reutilizado em outro escopo e rejeitado.

Lotes adaptam quantidade para manter ate 150 documentos lidos, 100 writes, 2 MiB de payload estimado com margem e 256 KiB JSON por documento novo. Prova individual tem teto tecnico de 64 KiB. Esses limites nao representam medicao de protobuf, index entries, latencia, quota ou desempenho em producao.

O limite de leituras descreve commits instrumentados confirmados. A SDK retorna os documentos antes da verificacao do medidor; tentativas abortadas e divididas podem ler mais, sem aplicar efeitos. Metricas persistidas nao incluem essas tentativas nem retries da SDK. Nao use esses contadores como orcamento faturavel ou garantia de quota produtiva.

OpenAPI e `generated-types.ts` sao fontes de tipos HTTP. Nunca acesse documentos Firestore preparados diretamente pelo frontend. Resultados operacionais nao expõem corpos privados de provas.

## Homologacao pendente

20.000 recebimentos HTTP reais, latencia/custo produtivos, quotas Firestore, indices implantados, Cloud Run e comportamento sob falhas de rede reais permanecem pendentes. Fixtures diretas com 20.000 fontes nao equivalem a aprovacao dessas capacidades.
