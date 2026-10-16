# Lastro — preservação do Financeiro e diagnóstico de performance

Data local: 15/10/2026, America/Sao_Paulo. Coletas UTC atravessam 16/10.

## Resultado

O Financeiro aprovado foi preservado no commit `86a1b6617871f1042758e26598300624fbf62976`, enviado para `origin/codex/preserve-finance-phase1`. A branch `main` continua em `bbf0ee5aa9e97857af1a9138e00c19f87753a3b7`. A homologação aprovada continua no deploy `dpl_9TnwTJpa1rEjgY4wchBNKxbNAQST`, READY, com alias `lastro-hml.vercel.app`.

**A meta sub-1 segundo não foi atingida nem certificada.** Há lentidão real em instâncias já inicializadas. Um teste novo reproduziu degradação antes da autenticação: respostas 401 passam de p95 79 ms em sequência para 1.513 ms com seis requisições simultâneas. Logs da aplicação confirmam que quase todo esse atraso ocorre no servidor. A transação do limitador por IP é a principal causa candidata desse comportamento, com evidência forte; falta decomposição por etapa para quantificar sua contribuição nos endpoints autenticados.

Nenhuma regra de negócio, infraestrutura, índice, esquema, dado comercial ou código backend foi alterado. Nenhuma operação financeira foi executada na homologação. As sondagens GET atravessaram o limitador existente, que atualiza seus contadores operacionais. Fase 2 — Pedidos não foi iniciada.

## 1. Git inicial, preservação e publicação

- `main`, alinhada a `origin/main`; índice vazio; 34 arquivos rastreados modificados, todos no frontend.
- 20 novos arquivos do Financeiro: telas, componentes, regras de apresentação, calendário, atualização de cache, testes, script E2E e documentação/evidência anterior.
- Arquivos adicionais de outra frente: `.github/workflows/ci.yml`, `docs/audits/arquitetura-2026-10-15.md`, `graphify-out/`.
- Nenhum diff no backend. Nenhuma mudança de contratos ou dependências.
- Inspecionados status, diff, diff staged, histórico, branches e remoto. Diff inicial guardado localmente em `frontend/.local/audit-initial.patch`.
- Divergência de proprietário no Git contornada com `git -c safe.directory=...` apenas por comando; configuração global não alterada.
- Commit financeiro contém 54 arquivos, 7.257 adições e 2.105 remoções. Inclui navegação mobile, textos, diálogo de pagamento, condições, painel e aplicação de resposta confirmada ao cache.
- O ajuste compartilhado em `orders/CustomerPicker.tsx` permite buscar clientes inativos no Financeiro; não inicia reformulação de Pedidos.
- CI e auditoria arquitetural preexistentes foram preservados sem commit. O workflow não foi plenamente validado e não foi misturado à entrega aprovada.
- GraphiFy, caches, builds, `.local`, `.env`, tokens, chaves e logs brutos não foram adicionados.
- Scanner por assinaturas em 342 arquivos frontend elegíveis: zero achados. Scanner existente do backend: zero achados. `git diff --check`: aprovado. Isso é verificação por padrões, não prova matemática de inexistência de qualquer segredo.

A API Vercel confirmou integração GitHub `1jhoww/lastro`, `productionBranch=main`. O deploy aprovado foi feito com `gitDirty=1`, portanto o SHA antigo no deploy não representa sozinho seu conteúdo. Push em main poderia trocar essa versão. Foi usada branch de preservação, conforme autorizado no pedido.

O primeiro push criou preview `dpl_GDWodyMVwYRjRAAMyoZgopPY8cSy`, confirmado READY, em `lastro-6zd2ahakn-jhow-s-projects3.vercel.app`. Nenhuma promoção foi feita. A configuração de produção permaneceu intacta. O alias aprovado respondeu HTTP 200 após o push.

## 2. Validação executada

| Verificação | Resultado |
|---|---|
| Frontend `npm run typecheck` | Passou |
| Frontend `npm run lint` | Passou |
| Frontend `npm test -- --runInBand` | 40 suítes, 554 testes aprovados; 97,8 s |
| Frontend `npm run export:web -- --output-dir .local/performance-audit-build` | Passou; bundle JS de aproximadamente 2,9 MB sem compressão |
| Segredos por assinaturas e whitespace | Passaram nos escopos descritos |
| Integração `financeReceipts.test.ts`, `paymentSettings.test.ts` | Tentada, não validada: portas padrão ocupadas; configuração isolada recusada pela guarda do fixture |

Jest precisou executar fora do sandbox por erro EPERM em `realpath`. Os testes emitiram avisos de chave React duplicada `r1` no cenário simulado de paginação; não houve falha. A causa e o alcance desse aviso precisam de revisão antes de tratar a suíte como totalmente silenciosa.

Os emuladores existentes nas portas 9099/8080/9199 não foram interrompidos. Foram tentados emuladores isolados em 19099/18080/19199, com Java 21 e diretório temporário explícito. Eles iniciaram, mas o fixture exige exatamente as portas originais e recusou a execução. Resultado: 2 suítes falharam no setup, 21 testes não executados. A guarda não foi relaxada. Os processos criados para essa tentativa foram encerrados pelo próprio runner.

A evidência E2E preservada em `frontend/docs/evidence/finance-phase1-e2e.json` é anterior, de 16/10/2026 00:28:58 UTC. Não foi apresentada como nova execução.

Node local: 22.16.0. Frontend admite essa versão; backend exige >=22.23.3 <23. Não houve alteração de runtime. CI preexistente fixa 22.23.3 e permanece fora dos commits.

Ambiente: `.env.example` aponta exclusivamente para emuladores; schema frontend exige URL, projeto e chave pública. Build local carregou `.env.local`/`.env` e não foi publicado. Valores sensíveis não foram impressos. Metadados das variáveis remotas Vercel não foram inspecionados: revisão automática bloqueou esse escopo, fora da autorização específica para Git/deploys. Logo, build local não certifica configuração do preview.

## 3. GraphiFy e arquitetura atual

Consultados `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.json`, `graphify-out/manifest.json`, auditoria arquitetural preexistente, `CONTEXT.md`, ADR 0008 e documentação Financeiro Fase 1.

Grafo: 3.634 nós, 15.488 arestas, 110 comunidades, base `bbf0ee5`. Foram conferidas relações de `SessionProvider → createApiClient/unwrap`, `apiRateLimit → FoundationRepository`, `FinancialReads`, `PaymentSettingsService` e `ReadGate`.

O manifest não inclui `frontend/src/features/finance/cacheUpdates.ts`. O grafo antecede a otimização final; não foi usado para afirmar que as invalidações antigas continuam iguais. No código atual, recebimento aplica resposta confirmada ao cache e marca Financeiro/Pedidos stale, recarregando consultas relacionadas. A resposta não espera todos os refetches.

Pedidos, estoque e Financeiro compartilham garantias atômicas e projeção econômica. `EconomicView` preserva publicação financeira consistente. Removê-lo, desativar provas ou afrouxar auditoria não são propostas de performance.

## 4. Infraestrutura e métricas existentes

Consulta somente leitura, conta já autenticada com acesso ao projeto correto:

- Cloud Run `lastro-api-hml`, revisão `lastro-api-hml-00002-gd9`, São Paulo.
- 1 vCPU, 1 GiB RAM, concorrência 40, máximo 2 instâncias, mínimo não configurado (padrão zero), startup CPU boost ativo.
- Firestore Native em `southamerica-east1`, concorrência `PESSIMISTIC`.
- Índices compostos consultados retornaram READY; não há evidência de índice em construção nessa coleta. READY não comprova eficiência de cada query.
- Seis inicializações nos logs; do evento de início à sonda TCP pronta: 2.226–4.869 ms. Isso não é p95 de requisição fria nem tempo completo de inicialização de todas as dependências.
- Cloud Monitoring: até duas instâncias ativas; média da distribuição de máximos de concorrência chegou a 40, o limite configurado.
- CPU: 132 pontos não vazios, médias por intervalo entre 0,22% e 15,81%. Memória: 131 pontos, médias entre 6,50% e 22,42%.
- Essas médias não excluem picos curtos. Não sustentam aumentar CPU/RAM como primeira solução. Há evidência de ocupação por requisições em espera.

### Latências retrospectivas recalculadas nesta auditoria

Origem: logs HTTP reais Cloud Run, 15/10 19:15:07 a 22:48:07 no fuso local (22:15:07–01:48:07 UTC). 2.505 entradas HTTP recuperadas; 1.349 após excluir OPTIONS. Tabela abaixo usa somente respostas 2xx e requisições iniciadas pelo menos 60 segundos após sonda pronta da mesma instância.

Esse filtro é **aproximação de instância aquecida**. Não garante caches aquecidos, ausência de pausa de CPU ou rede uniforme. Tráfego é observacional, de versões frontend e cenários misturados, não benchmark controlado novo. Os números foram recalculados dos logs, não copiados do relatório anterior. p95 usa nearest-rank; amostras pequenas têm alta incerteza.

| Endpoint | n | p50 ms | p90 ms | p95 ms |
|---|---:|---:|---:|---:|
| GET payment-methods | 29 | 2.457 | 7.174 | 7.973 |
| GET receivables | 74 | 3.028 | 5.232 | 6.941 |
| GET receivables/:id | 58 | 3.365 | 7.851 | 8.881 |
| GET orders/:id/financial-state | 67 | 1.864 | 5.090 | 6.786 |
| GET payments | 48 | 2.517 | 6.382 | 6.942 |
| GET orders | 131 | 1.631 | 3.619 | 4.935 |
| GET customers | 49 | 1.205 | 4.643 | 7.417 |
| GET products | 30 | 1.271 | 4.478 | 6.035 |
| GET inventory | 17 | 1.819 | 7.743 | 11.872 |
| POST orders/:id/receipts | 5 | 2.036 | 2.285 | 2.285 |
| POST orders/:id/confirm | 5 | 663 | 2.306 | 2.306 |

As escritas da tabela já existiam nos logs. A auditoria não as repetiu. Não houve acesso a contas reais.

### Medição nova, controlada, sem autenticação

15/10/2026 22:54:12–22:54:19 aproximadamente, rede local do operador, sem throttling artificial, Node 22.16 fetch, conexões reutilizadas. 57 GETs no total; primeiras chamadas separadas. Endpoints protegidos receberam zero credenciais e retornaram 401. Três ondas de seis chamadas simultâneas, após 12 sequenciais. Não é teste de carga sustentada nem mede o handler financeiro.

| Cenário | n | p50 ms | p90 ms | p95 ms |
|---|---:|---:|---:|---:|
| health/live, sequência, 200 | 12 | 16 | 18 | 85 |
| health/ready, sequência, 200 | 12 | 15 | 20 | 20 |
| payment-methods, sequência, 401 | 12 | 66 | 76 | 79 |
| payment-methods, seis simultâneas, 401 | 18 | 858 | 1.494 | 1.513 |

57/57 respostas correlacionadas por `X-Request-Id` com logs de aplicação. Nos 401 sequenciais, duração interna 31–65 ms; nas ondas paralelas, 32–1.492 ms. A maior resposta levou 1.513 ms no cliente e 1.492 ms no Express. Rede externa não explica esse atraso. A primeira chamada health/live levou 270 ms; não foi classificada como cold start por falta de evento correspondente.

`health/ready` usa cache de prontidão: seus tempos não são medição isolada de Firestore. Não interpretar a diferença entre health e API como custo puro do banco.

## 5. Diagnóstico: fatos e hipóteses

### Confirmado por medição

1. Leituras autenticadas lentas persistem após inicialização da instância. Cold start não explica tudo.
2. Rajadas de seis requisições já degradam o caminho anterior à autenticação, mesmo sem executar tenant ou handler.
3. O atraso dessa sondagem está no servidor, confirmado por requestId; não na renderização ou no trecho cliente–Cloud Run.
4. Instâncias chegaram ao limite de concorrência, enquanto médias de CPU e memória ficaram baixas.

### Confirmado no código; contribuição temporal ainda a medir

- `middlewares/rateLimit.ts`: toda requisição privada executa transação read-modify-write em `rateLimits/hash(ip, minuto)`, antes de `authentication`. Chamadas do mesmo IP disputam documento único. No emulador, essa implementação é substituída por limitador em memória: performance local anterior não exercitou o mesmo gargalo.
- `authentication.ts`: `verifyIdToken(token, true)` verifica revogação; depois lê identidade. `AccessService.tenant` relê identidade junto com tenant/vínculo e então lê assinatura. A segunda leitura tem semântica transacional; não pode ser removida cegamente.
- `paymentSettingsService.list`: transação somente leitura para autorização consistente e query paginada. Não passa por `FinancialReads.titlePage` nem pelo `ReadGate(4)` de recebíveis. Portanto, a fila desse gate não é explicação direta para `/payment-methods`.
- `financialReads.ts`: páginas percorrem títulos em sequência; cabeçalho lê pedido, guard e estado sequencialmente; evento depende do estado. Cache de cabeçalhos retém apenas quatro pedidos. Cliente e status são filtrados depois das leituras, podendo consumir páginas sem resultados úteis.
- `useFinanceOverview`: duas varreduras paralelas, mas até dez páginas sequenciais de 100 registros em cada uma. O painel espera conclusão das duas. Até 20 requisições para indicadores; backend ainda inspeciona títulos individualmente.
- `ReadGate(4)` rejeita excesso com 429, não mantém fila. Retry cliente pode aumentar duração percebida. Não remover orçamento de memória/tempo para ganhar velocidade.
- `CustomerPicker` monta hook de busca mesmo invisível. Hooks de clientes/produtos não propagam AbortSignal ao GET. Debounce de busca de 300 ms consome 60% da meta de 500 ms antes da rede.

### Frontend por módulo

| Módulo | Fluxo atual e risco a validar |
|---|---|
| Início | Duas consultas de pedidos, reposição, tenant e FinanceGlance; carga simultânea legítima, mas amplifica contenção compartilhada |
| Pedidos | Listas por cursor e opções de pagamento; invalidações amplas nas mutações; preservar regras, não reformular nesta execução |
| Financeiro | Painel varre páginas; cache pós-pagamento melhorado, mas telas na pilha continuam observadoras |
| Contas a receber | Filtros locais podem buscar até dez páginas; detalhe faz várias leituras do mesmo pedido |
| Clientes | Página de 50, debounce 300 ms; cancelamento de fetch não propagado no hook |
| Produtos | Mesmo padrão de listagem/busca; não há prova de renderização como causa dominante |
| Estoque | Listas paginadas, consultas agregadas e por item; invalidação deve considerar apenas dados afetados |

TanStack usa staleTime 30 s, refetch por foco da janela e até duas repetições transitórias. Não é polling contínuo. Skeleton rápido não certifica chegada de dados úteis. Bundle local tem aproximadamente 2,9 MB e exporta 18 arquivos Inter; layout usa quatro pesos e aguarda fontes. Assets exportados não significam todos baixados pelo navegador. Transferência, parsing e renderização precisam de trace antes de alterações.

### Hipóteses pendentes e experimentos

1. **Limitador é causa dominante das rajadas:** instrumentar transação e tentativas; comparar algoritmo alternativo com mesma proteção, em staging isolado. Predição: cauda cai principalmente em concorrência 6/12, sem mudar auth/handlers.
2. **Auth e tenant dominam custo fixo das leituras simples:** spans de revogação, identidade, vínculo e assinatura. Predição: aparecem custos repetidos semelhantes em métodos, clientes e produtos. Não desativar revogação.
3. **Recebíveis crescem com pedidos distintos:** medir páginas com 1/10/25/100 títulos e quantidade de pedidos distintos. Predição: tempo cresce com RPCs sequenciais e rotatividade do cache de quatro pedidos.
4. **Rajadas de telas ocultas amplificam contenção:** trace painel → lista → detalhe → pagamento. Predição: consultas de rotas sem foco aparecem após invalidação/foco. Reduzir só consultas redundantes, preservando atualização ao voltar.
5. **Cold start explica primeiras chamadas, não cauda aquecida:** correlacionar request start com início/ready da mesma instância; comparar min=0 e min=1 após corrigir amplificação.

## 6. Plano priorizado

Ganhos abaixo são hipóteses de engenharia, não resultados prometidos. Cada etapa exige comparação sob condições equivalentes.

| Prioridade / camada | Evidência e alteração proposta | Ganho esperado | Risco / efeito colateral | Custo | Testes necessários |
|---|---|---|---|---|---|
| P0 — observabilidade backend | Duração total existe, spans não. Medir rate limit, auth, tenant, Firestore, serialização, tentativas, ReadGate e event loop, sem dados pessoais | Quantificar causalidade; sem ganho direto | Volume de logs e overhead | Pequeno, limitado por amostragem | Redação de segredos, overhead, correlação requestId |
| P1 — frontend: consultas desnecessárias | Desabilitar pickers fechados, consultas sem foco e carregamento fora da área visível; propagar AbortSignal | Menos rajadas e RPCs; medir redução por jornada | Dados stale ao retornar se foco não for tratado | Tendência de redução de leituras | Abrir/fechar, voltar, trocar tenant, navegação rápida |
| P1 — backend: limitador | Documento compartilhado por IP/minuto e 401 paralelo lento. Comparar limitador distribuído apropriado ou reservas atômicas limitadas de quota | Principal candidato a remover segundos da cauda em rajadas | Não aceitar multiplicação de quota entre instâncias, spoofing de IP, fail-open ou negação a usuários NAT | Modelo Firestore otimizado pode reduzir RPCs; Redis/edge adicionam serviço e custo, cotar antes | Concorrência entre instâncias, janela, NAT, IP confiável, falha de serviço, 429/Retry-After |
| P2 — backend: leituras sequenciais | Prefetch getAll dos documentos independentes dentro do mesmo snapshot; cache por transação e página com limite explícito | Reduzir rodadas de rede; ms reais dependem de volume | Memória, orçamento de leitura, consistência econômica | Leituras iguais ou menores; sem recurso fixo | Integridade, overlay F02, legado, snapshots, limite de memória |
| P3 — reutilização frontend | Usar resposta de estado para dados já presentes; reutilizar chaves corretas e cache por tenant; manter confirmação oficial | Menos endpoints repetidos por pedido | Não usar versão velha para novo comando; idempotência de reaplicação de cache | Redução de leituras | Resposta perdida, repetição, concorrência, troca de tenant |
| P4 — refetch frontend | Refinar invalidações de pedidos/estoque e separar dados lentos de configurações estáveis | Menos tráfego e filas; manter saldo <200 ms após resposta | Informação antiga em tela montada | Redução de tráfego | Cenário de seis consultas atuais, voltar à lista, edição externa |
| P5 — Firestore/API | Filtros e índices eficazes; projeção agregada consistente para painel, com atualização atômica ou versão verificável | Evitar scan de até 1.000 registros por indicador | Write amplification e consistência de totais; contrato novo só após aprovação | Armazenamento/índices e escritas adicionais versus leituras evitadas | Comparação com diário, reconstrução, F02, grandes volumes e paginação |
| P6 — auth/tenant | Otimizar acesso no mesmo snapshot e deduplicar apenas onde semântica permite; preservar revogação e reautorização | Reduzir custo fixo comprovado por spans | Cache global pode atrasar revogação e violar isolamento; não usar | Menos RPCs quando seguro | Revogação, identidade desativada, assinatura, vínculo, tenants A/B |
| P7 — Cloud Run | A/B concorrência 8/16/40 depois das mudanças anteriores; medir latência, instâncias e erros | Evitar saturação por espera; não supor CPU como causa | Menor concorrência pode gerar instâncias, fila externa e custo; max=2 limita escala | Pode subir ou cair; medir instance-seconds | Carga limitada, 429/503, CPU, memória e p95 |
| P8 — Cloud Run min=1 | Evitar scale-to-zero; só depois de medir custo/benefício | Reduzir penalidade inicial de aproximadamente 2–5 s observada na inicialização | Não elimina escala adicional, reinícios, contenção ou RPCs lentos | Estimativa abaixo | Frio/aquecido separados, custo real, nenhuma promessa sub-1s |

Não remover transações de leitura consistentes apenas porque são transações. Não aumentar ReadGate sem teste de memória. Não mudar Firestore para optimistic como tentativa cega. Não desativar auditoria, idempotência, validação financeira ou isolamento.

## 7. Custo de min instances = 1

Configuração atual: 1 vCPU e 1 GiB, cobrança por requisição. Para 30 dias completamente ociosos, são 2.592.000 segundos. A tabela pública consultada mostra, na seleção padrão, CPU ociosa US$0,0000025/vCPU-s e RAM US$0,0000025/GiB-s: referência aritmética de US$12,96/mês antes de descontos/franquia.

**Reserva orçamentária preliminar: US$13–20/mês de piso ocioso por instância.** Não é cotação confirmada de São Paulo: a página varia por região e a tarifa regional precisa ser confirmada no calculador/SKU antes da alteração. Tráfego ativo, logs, Firestore, rede e impostos são adicionais; franquia compartilhada pode reduzir o total. Não converter para reais usando câmbio presumido. Manter 512 MiB poderia reduzir memória faturada, mas a configuração atual é 1 GiB e não foi recomendado reduzi-la sem teste.

Alternativa CPU sempre alocada cobra vida inteira em outra tarifa e tende a custar mais em baixa utilização; não é necessária para apenas manter uma instância pronta. Min=1 não resolve o hotspot por IP e não garante p95 inferior a 1 segundo.

Fontes oficiais: [Cloud Run pricing](https://cloud.google.com/run/pricing), [minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances), [contenção Firestore](https://firebase.google.com/docs/firestore/transaction-data-contention), [verificação de revogação](https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.baseauth).

## 8. Critérios de aceitação da próxima rodada

Usar tenant sintético autorizado, datasets versionados pequenos e representativos, rede/device declarados e pelo menos 100 amostras por leitura/jornada, distribuídas em três janelas. Escritas devem usar fixtures independentes e idempotentes, somente após autorização para criar esses dados. Reportar também erros e timeouts, não apenas sucessos.

| Operação | Meta p95 |
|---|---:|
| Navegação com cache | <200 ms |
| Listagens comuns | <800 ms |
| Busca de cliente/produto, incluindo debounce | <500 ms |
| Pagamento / confirmação comum de pedido | <1.000 ms |
| Atualização visual após resposta | <200 ms adicionais |
| Leitura simples API | Preferencialmente <500 ms |

Separar tempo de token no cliente, rede/preflight, fila Cloud Run, handler, Firestore e render após resposta. Correlacionar navegador e servidor por requestId. Medir cache frio/quente e instância fria/aquecida separadamente. Usar spans internos para identificar RPCs; requestLog atual mede total Express, não autenticação ou banco individualmente.

Navegação autenticada, dados úteis, renderização e atualização visual não foram medidos nesta execução. Não havia credencial de teste fornecida; nenhum token de usuário foi fabricado ou extraído. A evidência real disponível é servidor retrospectivo e sondagem nova sem autenticação. Para completar aceite end-to-end, disponibilizar sessão sintética autorizada.

## 9. Autorizações e próximo passo

1. Autorizar P0 e experimento P1 do limitador em ambiente isolado, mantendo as mesmas garantias. Diagnóstico apresentado; nenhuma correção backend foi aplicada.
2. Liberar janela dos emuladores padrão ou aprovar ajuste futuro do harness para portas configuráveis; não modificar contratos para testes passarem.
3. Fornecer sessão/tenant sintético autorizado para traces e leituras autenticadas. Não usar contas reais.
4. Autorizar consulta dos metadados das variáveis Vercel, caso desejada. Aprovação anterior cobriu apenas integração Git e deploys.
5. Só considerar promoção para main após integração completa, ambiente preview verificado e aceite. Min=1, recursos, índices e banco exigem autorização específica posterior.

## Fechamento Git/deploy

O commit de documentação desta auditoria será identificado no relatório final da execução. A branch de preservação é o destino remoto; main permanece no SHA inicial. Evidências brutas locais ficam em `frontend/.local/audit-*`; resumo sanitizado versionado acompanha este relatório. CI, auditoria arquitetural preexistente e GraphiFy permanecem preservados na árvore local, sem inclusão automática.
