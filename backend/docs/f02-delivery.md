# Entrega F02: resolucao financeira retomavel

## Status

**F02 RESOLVIDO no escopo estrutural local, em 13/10/2026.** Implementacao, regressao integral, testes adversariais e cancelamento/devolucao de 20.000 fontes validas aprovados. Integracao local do frontend pronta com ressalvas; homologacao externa e producao nao aprovadas. Evidencias completas em `validation-f02.md`.

## Funcionalidades efetivas

- Inicio duravel de cancelamento e resolucao de devolucao, com intencao imutavel, contexto empresarial, baseline financeiro e bloqueio por pedido.
- Backfill retomavel para geracoes legadas sem certificacao, cercado pelo dono, revisao, lease e fence da execucao.
- Planejamento limitado de fontes positivas por titulo, agregacao por pagamento/aplicacao e por lote compartilhado, sem arrays de todo o historico.
- Selamento de entradas imutaveis, backup do corpo exato e construcao Merkle incremental com frontier limitado.
- Validacao de fontes, origens, idempotencias, versoes, contagens, totais, hashes e pertencimento antes da aplicacao.
- Aplicacao transacional em lotes, mantendo visao financeira anterior e impedindo consumo dos valores preparados.
- Liberacao limitada de reservas de cancelamento. Resolucao de devolucao nunca repete recebimento fisico ou acrescenta danificado ao estoque vendavel.
- Publicacao unica de estado, titulos, guarda, manifesto, evento v2, credito ou obrigacao manual e cabecalhos comerciais/devolucao.
- Retomada administrativa com reautenticacao e novo fence. Lease expirado nao libera dinheiro, pedido ou lote.
- Recuperacao de entrada ausente exclusivamente pelo corpo selado verificavel. Corpo alterado nao recebe overwrite; saldo divergente permanece em revisao.
- Abort somente antes da primeira aplicacao irreversivel; nao desfaz recebimento nem encerra intencao fisica.
- Replay autorizado de inicio/passos; resultado terminal nao cria nova publicacao. Reconcilicao de provas paginada e cumulativa.
- Leitores centrais entendem fontes preparadas, eventos v1/v2 e cabecalhos compactos. PDF/CSV recusam pedido conflitante; CSV revalida bloqueio antes da entrega.

## Testes e recuperacao

**602 testes unicos aprovados, zero falhas finais, pendentes ou todo:** 227 unitarios e 375 emulados unicos. Regressao integral: 374 testes em 36 arquivos, 8.313,22 s, saida zero. Recorte adicional: quatro testes de devolucao, 40,62 s; tres se sobrepoem e somente um aumenta o total. Nenhuma implementacao de producao mudou depois da regressao integral.

Os 493 testes A-G anteriores (184 unitarios e 309 emulados) e os 330 emulados de F01 permanecem presentes e aprovados, conforme comparacao de arquivo/nome completo. Relatorios: `reports/f02-unit-final.raw.json`, `f02-emulator-final.raw.json` e `f02-partial-returns-final.raw.json`.

Concorrencia/replay/fences, administrador revogado/substituido, isolamento, locks de lotes compartilhados, abort admissivel, prova ausente recuperada e prova alterada sem overwrite passaram. Fontes multialocadas em 12 titulos nao duplicam transferencia/restauracao. Cancelamento de 200 produtos libera reservas sem alterar saldo artificialmente. Duas resolucoes de 100 centavos apos dois recebimentos parciais preservam bloqueio fisico intermediario, emitem creditos de 20 e 100 centavos e fecham estoque, titulo e linha cumulativa. Dano parcial e aceite zero passaram.

Dois erros de expectativas em testes foram documentados, corrigidos sem mudar comportamento produtivo e revalidados: ultimo item de historico por ID nao significa maior sequencia; estado fisico parcial e `partially_received`, nao `awaiting_receipt`. Reproducoes negativas permanecem nos relatorios, sem serem apresentadas como aprovacoes finais.

### 20.000 fontes por cenario

As duas fixtures geraram pagamentos, eventos v1, idempotencias, auditorias e indice certificado diretamente no demo local. **Zero chamadas HTTP de recebimento nessas fixtures.** O executor foi acionado e avancado pelas rotas HTTP reais.

| Cenario                        | Provas conferidas | Commits de fase | Documentos retornados |  Writes | Tempo total com verificacoes |
| ------------------------------ | ----------------: | --------------: | --------------------: | ------: | ---------------------------: |
| Cancelamento                   |            20.000 |           6.268 |               560.893 | 191.355 |                 3.414.395 ms |
| Devolucao recebida fisicamente |            20.001 |           5.479 |               490.792 | 187.412 |                 3.297.697 ms |

Cada cenario terminou com uma publicacao financeira, um credito de 20.000 centavos, divida/caixa liquidado zerados e recebimentos historicos de 20.000 centavos preservados. Todos os 20.000 pagamentos transferiram exatamente um centavo; geracao ativa certificada terminou vazia. Cancelamento recuperou entrada original ausente apos aplicacao parcial. Devolucao retomou lease expirado com novo fence; manteve exatamente um recebimento fisico, uma unidade vendavel e encerramento da intencao.

Maximos por commit instrumentado confirmado: 150 documentos lidos, 80 writes, 462.268 bytes estimados com margem e 4.659 bytes JSON por documento. Heap delta amostrado: ate 15.638.552 bytes; RSS do processo amostrado: ate 396.759.040 bytes nas fases. A preparacao direta levou 14.623/14.017 ms, 1.001 commits cada, medida separadamente. Dados completos: `reports/f02-capacity.raw.json`. Esses valores nao incluem todas as tentativas, reads auxiliares ou retries, e nao certificam custo, memoria de JVM, pico isolado ou desempenho produtivos.

TypeScript, lint, formatacao, build e scanner local de segredos aprovados. OpenAPI/tipos regenerados sem divergencia de hash, 0.8.0/114 operacoes. Scanner de assinaturas: zero findings. Auditoria npm anterior permanece historica; nao houve mudanca de dependencias nem nova afirmacao de seguranca de runtime.

## Endpoints e frontend

Oito endpoints opt-in constam em [contrato financeiro](api/financial-executions.md), OpenAPI 0.8.0 e `api/generated-types.ts`. A API tem 114 operacoes. O envelope continua `data`/`requestId`.

O frontend deve persistir ID e chave do inicio, distinguir 202 de conclusao, avancar explicitamente, tratar revisao/fence e reautenticar para retomada. `financialCompleted=true` e `publishedAt` sao obrigatorios para sucesso financeiro. Devolucao fisicamente pendente conserva o bloqueio original mesmo apos COMPLETED de uma resolucao parcial. Reembolso nunca significa transferencia bancaria automatica.

O caminho atomico antigo continua 200 quando pequeno. Mais de 100 pagamentos/aplicacoes exige caminho retomavel antes de carregar historico: `409 FINANCIAL_RESUMABLE_REQUIRED`. Nao ha novo limite comercial de quantidade, parcelas, recebimentos minimos ou valor.

## Dados e arquivos

Registros privados novos/ativados: `financialExecutions`, `financialExecutionPlans`, locks de pedido/lote, geracoes/fontes ativas, planos por fonte/lote/reserva, entradas/chunks/nos/manifestos de prova, passos/eventos operacionais e cabecalhos `orderLifecycleStates`/`returnResolutionStates`.

Fontes preparadas usam `pendingExecutionId`, `pendingProofEntryId` e `pendingFence`. O fence selado identifica prova; o fence atual cerca executor. Eles nao precisam ser iguais depois da retomada. Eventos financeiros/devolucoes v2 guardam hashes e referencias curtas. Conteudo e algoritmo v1 permanecem preservados.

Nucleos: `src/modules/finance/resolution/executionService.ts`, `executionPhases.ts`, `executionPublication.ts`, `executionModel.ts`, `batchReads.ts`, `budget.ts`, `proofStorage.ts`, `economicView.ts` e componentes anteriores de indice/backfill/locks/provas.

Integracoes: schemas, repositores centrais, `financialService.ts`, `financialReads.ts`, adaptador de estoque, `orderService.ts`, `exportService.ts`, `app/routes.ts`, `app/executionRoutes.ts`, gerador OpenAPI e `firestore.indexes.json`. Nenhum indice foi implantado.

Documentacao: proposta F02, `validation-f02.md`, `validation.md`, `phase-e.md`, contrato frontend, contrato de execucoes e arquivos gerados OpenAPI/tipos. Testes novos exercitam HTTP, recuperacao, devolucoes, reservas/leitores, fontes multialocadas, lotes compartilhados e capacidade semeada.

## Medicoes e limites

Os lotes usam ate 25 itens, reduzidos dinamicamente, 150 documentos lidos, 100 writes, payload estimado de 2 MiB com margem, documentos novos de ate 256 KiB JSON e prova individual de ate 64 KiB. A leitura pontual em `getAll` usa cache apenas do lote e da mesma transacao. O cache economico mantem limite independente de 64 registros/2 MiB estimados.

As metricas do plano contam commits de fase confirmados, documentos efetivamente retornados ao executor nesses commits e writes dessas fases. Nao representam faturamento Firestore ou total de RPCs. Excluem tentativas abortadas por divisao do lote, retries internos da SDK, autenticacao/middleware, preflight de leitura, consultas HTTP auxiliares e transacoes delegadas de backfill. O medidor verifica leituras depois do retorno da SDK: uma tentativa abortada pode ler mais de 150 documentos antes da divisao, sem persistir efeitos. O teto observado de 150 refere-se aos commits instrumentados confirmados, nao a todas as leituras tentadas. Preparacao da fixture e medida separadamente. Queries vazias podem custar leitura em producao mesmo retornando zero documentos.

Bytes sao estimativas JSON com margem, nao bytes protobuf/index entries. Heap e RSS sao amostras do processo Node, nao picos isolados de cada execucao ou memoria do JVM/emulador. O prazo entre lotes e cooperativo; SDK/retry/commit nao tem cancelamento duro de tres segundos. Esses dados nao certificam desempenho, seguranca, SLO ou custo produtivos.

Nao ha TTL de ledger/provas/idempotencia, limpeza de historico, fila paga, cron ou worker automatico. Cliente/admin deve continuar o workflow. Retencao tecnica, backpressure/SLO produtivos, runtime Linux, IAM, indices implantados e F03-F07 continuam no gate de homologacao.

20.000 recebimentos HTTP reais permanecem pendentes de homologacao/capacidade, nao executados nem aprovados. As fixtures de 20.000 fontes validas testam estrutura, cancelamento, devolucao, saldos, provas e recuperacao local; nao substituem essa homologacao.

## Restricoes

Somente backend local Lastro. Sem deploy, commit, push, acesso a producao, recursos pagos, frontend ou outros projetos. Proposta de snapshots comerciais grandes nao implementada. Nenhum historico financeiro foi apagado ou saldo ajustado artificialmente.
