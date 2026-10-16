# Etapa 6 — Financeiro e Contas a Receber

## Checkpoint

**Fase 1 (reformulação de UX do Financeiro):** painel, navegação, contas a receber, registro de
pagamento, condições e formas, créditos, estornos, reembolsos e operações avançadas foram
reformulados sem mudar contratos nem garantias. Consulte [finance-phase1.md](finance-phase1.md).

**Continuidade posterior:** a Etapa 7 integra relatórios disponíveis, PDFs, quatro CSVs e catálogo
público. Consulte [etapa-7-relatorio-final.md](etapa-7-relatorio-final.md) para o checkpoint atual,
evidências, matriz do MVP e pendências de homologação. Os resultados e instruções abaixo permanecem
como histórico da Etapa 6; o executor da Fase C não foi reimplementado na Etapa 7.

Fases A, B e C implementadas e validadas localmente. Fase C encerrou com **433/433 testes**,
**30/30 verificações HTTP reais locais**, **5/5 verificações de IndexedDB em Edge headless**,
TypeScript strict, lint, Prettier, Expo Doctor 21/21 e bundles web/Android/iOS.
Baseline obrigatório executado antes de alterar código: **354/354** testes aprovados.
A entrega atual está na seção **Fase C**, abaixo; seções A/B e instruções antigas conservam
o histórico. Limitações de intenções somente em memória descritas nas fases anteriores foram
superadas para comandos financeiros por C. Não refazer A/B nem os cenários de 20.000 fontes.

Evidências anteriores da Fase B: [E2E](evidence/finance-b-e2e.json) e
[validação consolidada](evidence/finance-b-validation.json).

Somente arquivos do frontend foram alterados. Backend existente foi lido e executado localmente.
Não houve commit, push, deploy, acesso à produção, recurso pago ou execução dos cenários de
20.000 fontes.

## Funcionalidades da Fase A

- `/financeiro`: títulos paginados por cursor, inclusive página vazia com continuação. Filtros
  contratuais de situação, cliente, pedido e período inclusivo de vencimento. Não há total agregado.
- `/financeiro/[id]`: parcela, vencimento, original, recebido em dinheiro, liquidado por crédito,
  cancelado e saldo oficiais. Todas as parcelas do pedido têm links próprios.
- Baixa parcial ou total na parcela escolhida. React Hook Form e Zod validam digitação; centavos
  permanecem inteiros. O servidor valida versões, saldos, método, estado e autorização.
- Revisão mostra cliente, parcela, valor, forma efetiva, data, motivo e referência antes do POST.
- Histórico paginado dos recebimentos e eventos do pedido. Recebimentos mostram forma histórica,
  estornos, valores destinados e alocações/remanescentes. Não são apagados nem reinterpretados.
- Links entre resumo financeiro do pedido, lista filtrada, parcela e pedido.
- Indicador de vencimento usa calendário da empresa, sem inventar novo estado de título.
- Carregamento, erro com recarga, vazio e resultado ambíguo. Estado financeiro pode ser atualizado
  explicitamente; execuções e devoluções pendentes bloqueiam nova baixa.
- `receivables:read` exige administrador comercial. Vendedor e Super Admin Hepta não montam
  consultas financeiras. `payments:manage` é verificado também no hook de mutação.
- Formulários remountam na troca de usuário/empresa. Chaves de cache incluem tenant; consultas
  financeiras recebem AbortSignal. Requisições usam cliente preso ao tenant.
- `intent.ts` preserva corpo e chave por usuário/empresa/pedido após timeout, rede ou 5xx.
  Repetição é explícita, com o mesmo corpo/chave. Não há descarte de baixa ambígua na interface.
  Duas chamadas simultâneas no mesmo escopo são recusadas antes do segundo POST.
- Resumo herdado de pedidos foi endurecido: publicação financeira exige `financialCompleted`,
  `status=COMPLETED`, `publishedAt` e `result`. `ABORTED` é terminal sem sucesso financeiro.

## Endpoints usados na interface

Todos relativos a `/api/v1`, com Bearer e `X-Tenant-Id`; POST usa UUID `Idempotency-Key`.

| Método | Endpoint                          | Uso                                          |
| ------ | --------------------------------- | -------------------------------------------- |
| GET    | `/receivables`                    | Lista e filtros                              |
| GET    | `/receivables/{id}`               | Parcela                                      |
| GET    | `/orders/{id}/financial-state`    | Versões, títulos e saldos oficiais           |
| POST   | `/orders/{id}/receipts`           | Baixa parcial ou total                       |
| GET    | `/payments`                       | Histórico paginado do pedido                 |
| GET    | `/orders/{id}/financial-history`  | Eventos paginados                            |
| GET    | `/financial-executions`           | Consulta de pendências, sem início ou avanço |
| GET    | `/orders/payment-options/methods` | Formas ativas, hook existente                |
| GET    | `/tenants/current`                | Fuso da empresa, hook existente              |
| GET    | `/customers`                      | Seletor de cliente existente                 |

E2E também usa `/payments/{id}` e `/orders/{id}/financial-reconciliation`, além dos endpoints
existentes de preparação de identidades, empresas, carteira, produto, estoque, método e pedido.
Reconciliação ainda não tem tela nesta fase.

## Validação da Fase A (histórico)

- Testes da Fase A: 41/41 aprovados na regressão final, incluindo respostas 200 incompletas ou divergentes.
- Suíte completa: 23/23 suítes e 293/293 testes aprovados; 252 anteriores preservados, mais 41 financeiros.
- E2E HTTP do cliente do frontend com backend real e Auth/Firestore/Storage Emulator: 16/16.
  Evidência: [finance-a-e2e.json](evidence/finance-a-e2e.json).
- E2E valida parcelas, baixas parcial e total, versões antigas, replay, payload diferente,
  concorrência, métodos/alocações, filtros, página vazia com cursor, históricos, vendedor,
  Super Admin, isolamento por tenant e reconciliação cumulativa paginada.
- “Resposta perdida” no E2E significa descartar a resposta depois do commit e recuperar a mesma
  operação. Timeout e falha de fetch são exercitados separadamente nos testes de transporte.
- A evidência E2E não é automação de navegador, teste de aparelho físico ou teste nativo.
- `npm ci --no-audit --no-fund`: aprovado com Node 24.19.0, sem alterar dependências ou lockfile.
  O runtime padrão Node 22.16.0 também instalou, mas apresentou avisos de engine do Firebase 13.
  Node 24 removeu esses avisos. Permanece aviso herdado de peer entre React 19.2.3 e
  `test-renderer/react-reconciler` que pede React 19.3; não houve mudança de dependência nesta fase.
- TypeScript strict (`tsc --noEmit`), lint Expo e Prettier de todo frontend: aprovados.
- Expo Doctor: 21/21 verificações aprovadas, sem problemas detectados.
- `expo export --platform all`: aprovado para web, Android e iOS. Web 2,6 MB, Hermes iOS
  4,5 MB e Android 4,8 MB; artefatos em `.local/finance/export`, ignorados pelo Git.
  São bundles locais, não APK/AAB ou aplicativo iOS assinado. Não houve execução em dispositivo.
- Evidência consolidada: [finance-a-validation.json](evidence/finance-a-validation.json).
- Falhas finais: nenhuma nos checks executados. Falhas iniciais de sincronização dos testes
  de tela e EPERM de Jest foram corrigidas/contornadas antes do aceite da Fase A.
- API e emuladores iniciados nesta sessão foram encerrados após o E2E. Credencial sintética
  temporária foi apagada; logs técnicos ficaram somente em `.local/finance`, ignorado.

## Limitações e estado do executor

Fase A aceita uma parcela por baixa. Uma baixa pode quitar ou receber parte dessa parcela;
receber várias parcelas exige operações distintas, revisadas individualmente. A API aceita até
12 alocações, mas nenhum rateio ou regra de negócio foi criado no frontend.

Intenções de recebimento vivem no registro existente em memória: sobrevivem à navegação e à
troca de empresa, separadas por escopo, mas não ao encerramento completo do processo/reload.
Antes de repetir após reiniciar o aplicativo, conferir recebimentos oficiais. A persistência
durável, obrigatória para o executor na Fase C, ainda deve ser implementada e validada.

Execuções existentes aparecem como pendentes e bloqueiam novas baixas. Não há início, avanço,
resume, abort, lease/fencing, recuperação durável ou tela de reconciliação do executor. Não há
worker assumido. Não há resolução física ou financeira de devolução na interface nova.

Créditos, estornos, configuração administrativa, reembolso manual e desconto de rascunho
foram concluídos na Fase B descrita abaixo. Cancelamento financeiro e resolução retomável
na interface aguardam C. Não afirmar aprovação do executor com base nos testes A/B.

## Arquivos alterados na Fase A (histórico)

- `.gitignore`, `.prettierignore`: ignoram `.local` de execução, bundles e credenciais sintéticas.
- `src/api/types.ts`, `src/api/queryKeys.ts`: aliases gerados e caches financeiros por tenant.
- `src/lib/intent.ts`: escopo `receipt`, sem mudar retenção existente.
- `src/features/catalog/useCursorList.ts`: propaga AbortSignal às consultas que o utilizam.
- `src/navigation/destinations.ts`: financeiro deixa de aparecer como “em breve”.
- `src/app/(app)/financeiro/index.tsx`, `src/app/(app)/financeiro/[id].tsx`: rotas protegidas.
- `src/features/finance/{api.ts,rules.ts,FinanceAccess.tsx,ReceivablesScreen.tsx,
ReceivableScreen.tsx,ReceiptForm.tsx}`: Fase A.
- `src/features/orders/{OrderFinancePanel.tsx,rules.ts}`: link e confirmação estrita de publicação.
- `tests/support/financeFixtures.ts`, `tests/unit/finance{Rules,Api,Screens}.test.*`:
  regressões financeiras. `tests/unit/orderRules.test.ts`: fortalece teste existente de publicação.
- `scripts/e2e-finance.ts`, `docs/evidence/finance-a-{e2e,validation}.json`: E2E local e evidências sem credenciais.
- `docs/architecture.md`, `docs/finance-progress.md`: estado atual e retomada.

O checkout já tinha alterações anteriores e grande parte do frontend ainda não rastreada pelo
Git. Essa lista histórica descreve somente os arquivos tocados na Fase A.

## Funcionalidades da Fase B

- `/financeiro/creditos`: seleção de cliente, fontes paginadas, saldo disponível/emitido/aplicado,
  origem por cancelamento ou devolução e histórico de aplicações. Nunca soma páginas incompletas.
- `/financeiro/pedidos/[id]`: aplica crédito legítimo na parcela escolhida, estorna dinheiro ou
  aplicação de crédito parcial/integralmente dentro da alocação ainda reversível e registra
  reembolso manual. Mostra pagamentos, aplicações, lotes e obrigações paginados, com links
  ao pedido comercial e aos títulos/históricos da Fase A.
- Detalhes de pagamento, aplicação e obrigação são relidos após selecionar a origem. Todas
  as versões vêm de consultas oficiais: pedido, guarda, título, fonte e pagamento/aplicação/
  obrigação. Estorno não apaga registro; `remainingCents` limita a alocação escolhida.
- `/financeiro/configuracoes`: lista por situação, cria condição por preset ou 1..12 prazos/pesos,
  edita e ativa/desativa condições e formas com `expectedVersion`. Pesos são inteiros positivos;
  dias não negativos e ordenados. Não calcula rateio, calendário final ou juros no cliente.
- Caches das opções de pedidos são invalidados após cadastro, sem alterar snapshots de pedidos
  confirmados ou formas históricas dos recebimentos. Cadastro novo começa ativo; desativação
  ocorre por PATCH autorizado.
- `/financeiro/reembolsos`: obrigações por cliente/pedido, valores pendentes e já confirmados,
  origem e estado. Registro manual exige checkbox de dinheiro já devolvido externamente,
  forma efetiva, data, referência e justificativa. Comprovante oficial é consultado após sucesso.
  Nenhuma tela ou endpoint integrado transfere dinheiro ao cliente.
- Desconto administrativo usa `PATCH /orders/{id}` somente no rascunho: valor fixo em centavos
  ou percentual em pontos base, justificativa, versão e revisão antes de aprovar/remover.
  Backend registra aprovação, distribuição e snapshots. Confirmados mostram desconto histórico
  em leitura. Qualquer edição posterior do rascunho exige nova aprovação pelo contrato.
- Estornos e confirmação manual de reembolso exigem senha recente. Reutiliza `ReauthGate`,
  com descrição financeira opcional; plataforma mantém comportamento anterior. O hook verifica
  janela de 270 segundos e permissão novamente, inclusive antes do envio após espera assíncrona.
  `REAUTHENTICATION_REQUIRED` devolvido pelo backend pede senha sem repetir comando automaticamente.
- `FinanceAccess` restringe administrador comercial e remonta conteúdo por ator/tenant. Super
  Admin Hepta e vendedor não montam consultas novas. Mutações B verificam permissões específicas:
  `payments:manage`, `payments:reverse`, `refunds:manage`, `payment-settings:manage`; desconto
  exige `discounts:apply`. API continua sendo autoridade final de cada operação.
- Um escopo econômico por usuário/empresa/pedido inclui tipo, rota e corpo da intenção. Timeout,
  falha de fetch, 5xx ou resposta incompleta mantêm chave/payload. Duplo envio concorrente é
  recusado localmente; concorrência distribuída é decidida pelas guardas do backend.
- Recusa durante recuperação de intenção previamente ambígua não apaga essa ambiguidade, inclusive
  403 de reautenticação. Replay confirmado atualiza caches; resposta histórica não vira saldo atual.
- Intenção pendente da Fase A bloqueia nova operação B; intenção B desconhecida também bloqueia
  nova baixa A. Pendências oficiais do executor bloqueiam operações B, sem iniciar ou avançar C.
- Estado de carregamento/erro/vazio, recarga e paginação são preservados. Conflitos, crédito
  insuficiente, limites de estorno/reembolso e cadastros alterados mostram orientação específica.

## Endpoints integrados na Fase B

Todos relativos a `/api/v1`; autenticação e tenant seguem cliente existente. POST/PATCH dos
cadastros e comandos financeiros usam UUID `Idempotency-Key`. PATCH de pedido é a exceção
contratual, sem suporte a essa chave.

| Método    | Endpoint                                          | Uso                                      |
| --------- | ------------------------------------------------- | ---------------------------------------- |
| GET       | `/customers/{id}/credits`                         | Fontes legítimas do cliente              |
| GET       | `/credit-applications`                            | Histórico por cliente/pedido             |
| GET       | `/credit-applications/{id}`                       | Aplicação e alocações oficiais           |
| POST      | `/orders/{id}/credit-applications`                | Aplicar fonte legítima na parcela        |
| POST      | `/credit-applications/{id}/reversals`             | Restituir crédito à fonte original       |
| GET       | `/payments`, `/payments/{id}`                     | Recebimentos e alocações reversíveis     |
| POST      | `/payments/{id}/reversals`                        | Estorno auditado de dinheiro recebido    |
| GET       | `/refund-obligations`, `/refund-obligations/{id}` | Obrigações e saldo pendente              |
| POST      | `/refund-obligations/{id}/confirm`                | Registrar reembolso externo comprovado   |
| GET       | `/refund-confirmations/{id}`                      | Comprovante pelo ID da operação          |
| GET/POST  | `/payment-conditions`                             | Lista/criação de condições               |
| PATCH     | `/payment-conditions/{id}`                        | Editar/ativar/desativar com versão       |
| GET/POST  | `/payment-methods`                                | Lista/criação de formas                  |
| PATCH     | `/payment-methods/{id}`                           | Editar/ativar/desativar com versão       |
| GET/PATCH | `/orders/{id}`                                    | Estado e desconto autorizado do rascunho |
| GET       | `/orders/{id}/financial-state`                    | Guarda, versões, parcelas e saldos       |
| GET       | `/financial-executions`                           | Só consulta das pendências existentes    |
| GET       | `/orders/payment-options/methods`                 | Formas efetivas ativas, hook reutilizado |

Seletores de cliente, empresa e demais leituras A permanecem reutilizados. E2E também lê
`/payment-conditions/{id}`, `/payment-methods/{id}`, opções/preview de pedidos e journal/
reconciliação. Cancelamento financeiro atômico pequeno é usado **somente como fixture E2E**
para originar créditos e obrigações legítimos, pela API. Não foi adicionado cancelamento à
interface nem enviado POST a qualquer endpoint de execução F02.

## Validação da Fase B

- 26/26 suítes e **354/354 testes aprovados**: 293 anteriores preservados, 61 novos de B.
  Testes dirigidos B também passaram isoladamente. Nenhum teste foi removido ou desabilitado.
- **E2E local 33/33** com API real e Auth/Firestore/Storage Emulator, usando construtores de
  payload do frontend e cliente HTTP tipado. Evidência sem credenciais em
  [finance-b-e2e.json](evidence/finance-b-e2e.json).
- Cobre criação/edição/ativação/desativação, presets e doze pesos, preview, aprovação de
  desconto, snapshots históricos, fonte legítima paginada, aplicação/estorno de crédito,
  estorno de dinheiro, valores excessivos recusados, versão antiga, replay, concorrência,
  comprovante manual parcial e integral, estado inválido, vendedor, Super Admin e tenant externo.
- Perda de resposta E2E é simulada descartando resposta após commit. Timeout, falha de fetch,
  recuperação com mesma chave e recusa durante replay têm testes próprios no transporte.
- TypeScript strict, lint Expo e Prettier do frontend: aprovados, sem erros ou avisos finais de lint.
- Expo Doctor: **21/21** verificações aprovadas.
- Export local de **web, Android e iOS** aprovado: `.local/finance/export-b`. Web 2,7 MB,
  Hermes iOS 4,6 MB e Android 4,9 MB. São bundles, não APK/AAB ou app iOS assinado.
- Não houve teste em dispositivo físico, emulador Android/iOS ou automação de navegador.
- API e emuladores desta execução foram encerrados. Credencial temporária do seed foi apagada;
  logs técnicos e bundles permanecem apenas em `.local/finance`, ignorado pelo Git.
- Não foram adicionadas dependências nem alterados `package.json`, lockfile ou backend nesta fase.
  Runtime de validação: Node 24.19.0; API usa runtime existente compatível do backend.
- Falhas iniciais: sincronização de consulta no teste de reembolso, `watch()` incompatível com
  compilador React e escrita de ref durante render. Foram corrigidas antes da regressão completa.
  Falhas finais nos checks executados: nenhuma.
- Validação consolidada e hashes dos bundles:
  [finance-b-validation.json](evidence/finance-b-validation.json).

## Limitações e contratos que permanecem

- Créditos não podem ser criados livremente, transferidos entre clientes ou usados acima do
  saldo oficial. Não há endpoint de edição manual do saldo ou de resolução genérica do lote.
  Aplicação/estorno usam operações reais da API e origem comprovada.
- Uma parcela por operação na interface A/B. Histórico e cadastros são paginados sem total
  agregado. Seletores ativos reutilizam o hook de pedidos existente, que busca até dez páginas
  de 100 opções; esse limite anterior do seletor não é limite comercial do backend.
- Recibo, fonte restaurada e obrigação são registros diferentes. `transferredCents` e
  `restoredByCancellationCents` não significam dinheiro bancário devolvido.
- Reembolso não faz transferência nem comprova operação bancária automaticamente. Data não
  pode ser futura no fuso da empresa; backend confere forma ativa, versões e referência.
- Não há contrato para estornar reembolso manual já confirmado, apagar recebimento, editar
  origem financeira, alterar destino consumido ou reparar prova/saldo. Esses atalhos não
  aparecem na interface. Desconto financeiro, juros, multas, PSP e banco continuam fora da API.
- PATCH de desconto não é idempotente por chave. `intent.ts` conserva intenção local, mas a
  chave não é enviada ao endpoint. Após resposta perdida, consulta GET verifica aprovação por
  ator/versão/valores. Se versão original ainda aparece, a pessoa pode repetir somente payload
  e `expectedVersion` originais, que impedem duplo efeito. Versão divergente sem prova não
  libera nova aprovação; consultar histórico do pedido.
- Todas as intenções A/B permanecem em memória, separadas por usuário/tenant/recurso. Não
  sobrevivem a reload ou encerramento completo do processo. Persistência durável e recuperação
  do executor continuam trabalho obrigatório de C; `kvStorage` não é prova de escrita durável.
- A Fase C permanece não iniciada: sem início/advance/resume/abort, lease/fencing, publicação
  retomável, retorno físico ou resolução financeira de devolução nova na interface.

## Arquivos alterados na Fase B

- `src/features/finance/administrationApi.ts`, `administrationRules.ts`, `commands.ts`:
  consultas, permissões, contratos de entrada e transporte idempotente dos oito comandos B.
- `src/features/finance/{CommandConfirmation,EconomicForm,CreditsScreen,RefundsScreen,
SettingsScreen,DiscountPanel,OrderAdministrationScreen,FinanceNav}.tsx`: telas e formulários B.
- `src/app/(app)/financeiro/{creditos,reembolsos,configuracoes}.tsx` e
  `src/app/(app)/financeiro/pedidos/[id].tsx`: rotas protegidas.
- `src/features/finance/{FinanceAccess,ReceivablesScreen,ReceivableScreen,ReceiptForm}.tsx`:
  guard configurável, navegação, link de administração e bloqueio por intenção B pendente.
- `src/app/(app)/pedidos/[id]/index.tsx`: link administrativo, também para desconto de rascunho.
- `src/features/platform/ReauthGate.tsx`: descrição opcional financeira, padrão da plataforma mantido.
- `src/api/{types,errors}.ts`: aliases gerados e mensagens dos códigos reais financeiros.
- `src/lib/intent.ts`, `src/navigation/destinations.ts`: novos escopos e permissões B.
- `tests/support/financeBFixtures.ts`, `tests/unit/finance{BRules,BCommands,BScreens}.test.*`:
  61 testes novos. Nenhum arquivo de teste anterior foi alterado.
- `scripts/e2e-finance-b.ts`, `docs/evidence/finance-b-{e2e,validation}.json`: E2E e evidências.
- `docs/finance-progress.md`, `docs/architecture.md`: checkpoint e navegação atualizados.

O checkout continua com alterações de etapas anteriores e arquivos não rastreados. A lista
acima delimita B; nenhum commit foi criado.

## Como iniciar a Fase C (instruções históricas já executadas)

1. Começar de A/B já validadas: preservar **354 testes**, E2E B 33/33 e evidências históricas.
   Ler este checkpoint, `src/features/finance/{commands,administrationApi}.ts` e `intent.ts`.
   Não repetir investigação de créditos, estornos ou cadastros.
2. Ler integralmente `backend/docs/api/financial-executions.md`,
   `backend/docs/proposals/financial-resumable-resolution.md`, schemas de execuções/devoluções
   e contratos do preview de devolução relevante. Contrato continua OpenAPI 0.8.1/114 operações.
   B não substitui essa leitura obrigatória e não iniciou F02.
3. Implementar cancelamento atômico e opt-in retomável só pelos endpoints existentes. Após
   `FINANCIAL_RESUMABLE_REQUIRED`, não repetir atômico às cegas; recuperar estado oficial e
   revisar início opt-in. Resolução de devolução usa recebido físico oficial já existente.
4. Criar armazenamento durável explícito para executionId, ator, tenant, pedido/devolução,
   intenção inicial e passo, chave e corpo, revisão/fence e último estado confirmado. Persistir
   antes do POST; falha de gravação deve bloquear envio. `kvStorage` silencia falhas e não
   atende sozinho a essa garantia. Não armazenar senha ou token junto ao checkpoint.
5. Não reutilizar escopo B com um tipo desconhecido: `commands.ts` e a recuperação de B têm
   união concreta de comandos. Integrar bloqueio por pedido entre A, B e C, sem duas resoluções
   concorrentes. Preservar intenções antigas do ator/tenant na troca, sem exibi-las em outra sessão.
6. Reutilizar descrição financeira do `ReauthGate`, verificar permissão/sessão/empresa antes
   de enviar após espera, e reautenticar conforme contrato. Renovação de token não renova `auth_time`.
7. HTTP **202 é aceitação**. Reutilizar `executionPublished`/`executionDone` de pedidos:
   sucesso financeiro exige `financialCompleted=true`, `status=COMPLETED`, `publishedAt` e
   resultado. `ABORTED` não é sucesso financeiro. Contadores de prova não são centavos ou percentuais.
8. GET recupera estado após resposta perdida/fechamento. Passo ambíguo conserva chave/corpo;
   avanço usa revisão/fence oficiais e ação explícita. Não há worker automático. Lease expirado
   não libera pedido/lote. PAUSED/NEEDS_REVIEW exigem retomada administrativa auditada.
9. Reconciliação `journal` e `proofs` é paginada, cumulativa e distinta. Somente `complete=true`
   encerra verificação; falha acumulada não volta a consistente. Reiniciar sem cursor em
   conflito/restart autorizado, preservando ator, tenant, limite e escopo da consulta.
10. Nunca simular recebimento físico, alteração direta de saldo/prova ou transferência bancária.
    Publicação financeira pode deixar bloqueio físico da intenção de devolução. Ler pedido e
    devolução materializados para decidir quais ações comerciais continuam bloqueadas.
11. Se contrato inconsistente afetar integridade, interromper só operação afetada e documentar
    evidência; não improvisar compensação. Testar 202/publicação, novo processo, resposta perdida,
    concorrência, lease/fence, reauth, permissões, tenant e reconciliação paginada.
12. Ao finalizar C, executar instalação, suíte completa, TypeScript/lint/Prettier, Doctor e
    exports das três plataformas. Não executar 20.000 fontes do backend, deploy ou produção.
    Etapa 7 permanece aguardando definição; documentos/downloads bancários ou fiscais não foram inventados.

Comandos abaixo executam em `frontend`, usando Node 24.19.0 quando disponível. Jest exige
execução local fora do sandbox neste Windows por EPERM de `realpath`. E2E usa Java 21 em
`C:/Program Files/Eclipse Adoptium/jdk-21.0.7.6-hotspot`, emuladores demo e backend existente,
sem alteração de código. `SEED_PASSWORD` vem do seed local; nunca copiar credenciais para evidências.

```powershell
node node_modules/jest/bin/jest.js --runInBand
npm run typecheck
npm run lint
node node_modules/prettier/bin/prettier.cjs --check .
node ../backend/node_modules/tsx/dist/cli.mjs scripts/e2e-finance-b.ts
npx expo-doctor
npx expo export --platform all --output-dir .local/finance/export-b
```

## Fase C — entrega atual

Etapa 6 concluída no escopo local autorizado. Baseline 354/354 foi executado antes de alterar
código. Foram preservados os 354 testes e acrescentados 79, totalizando 433/433 em 31 suítes.
Não há worker, processamento em segundo plano ou chamada financeira automática na inicialização.
Etapa 7 não foi iniciada.

### Telas e fluxos

- `/financeiro/pedidos/[id]`: cancelamento financeiro de confirmado não expedido, por caminho
  atômico ou início retomável opt-in. Revisão mostra cliente, total oficial, caixa/crédito,
  parcelas, versões, destino, justificativa e efeito sobre reservas. `customer_credit` destina
  somente caixa legítimo; `refund` cria obrigação manual. Backend decide abatimento, restauração
  de fontes, valores e estoque. Pedido expedido exige devolução própria.
- Recusa `FINANCIAL_RESUMABLE_REQUIRED` orienta atualizar estado e revisar caminho retomável.
  Não há troca automática de rota nem repetição atômica com outra chave.
- `/financeiro/execucoes`: pendentes, terminais ou todas, filtro por pedido e paginação oficial.
  Mostra intenções locais do ator/empresa e links para recuperar a operação original.
- `/financeiro/execucoes/[id]`: status, fase, revisão, fence, datas, lease, intervalo indicado,
  contadores técnicos, bloqueio do pedido, lotes relacionados e referência segura de revisão.
  Total não certificado aparece como tal; não há percentuais monetários inferidos.
- Continuar é ação explícita, revisada por passo. `202` significa aceitação/processamento.
  Transporte recusa divergência entre HTTP e estado. Publicação exige simultaneamente
  `status=COMPLETED`, `financialCompleted=true`, `publishedAt` e `result` do pedido correto.
  `ABORTED` nunca aparece como sucesso financeiro. Replay devolve snapshot anterior; GET traz
  estado atual antes do próximo passo.
- Retomada administrativa conserva decisão original e exige motivo/senha recente. Novo fence
  vem do servidor. Lease expirado mantém locks. `PAUSED`/`NEEDS_REVIEW` não avançam sozinhos.
- Abort tem confirmação própria e oferta conservadora nos estados anteriores à aplicação,
  incluindo READY, sem aplicações/liberações observadas. `applicationStartedAt` é privado:
  servidor decide admissibilidade final e pode recusar `EXECUTION_ABORT_NOT_ALLOWED`.
  Retomada de estado pausado permite reavaliar estado oficial antes de oferecer abort.
- Avanço interrompido pode ter sido parcialmente confirmado antes de perder lease. Retomada
  explícita consulta GET e arquiva chave/corpo desse passo no checkpoint, sem apagá-los ou
  simular abort. Só então envia resume auditado com nova chave, revisão oficial e o mesmo
  executionId. Registro de acompanhamento mantém bloqueio local até terminal comprovado.
- `/financeiro/devolucoes` e `/financeiro/devolucoes/[id]`: materializado, preview e histórico de
  devoluções existentes. Resolve apenas recebido físico elegível. Dano exige decisão explícita:
  limite integral, valor parcial inteiro, aceite com zero ou rejeição. Limites e versões vêm
  do preview validado, sem calcular rateio no cliente. Atômico e opt-in F02 usam mesmos contratos.
- Resolução não repete entrada física. Devolução parcialmente resolvida pode continuar com
  saldo físico pendente e `activeReturnCount` positivo mesmo depois de publicação financeira.
  Histórico usa ID para paginação; sequência identifica eventos, não a posição da última linha.
- Journal e provas têm painéis separados, cursores oficiais e contagens cumulativas. Falha
  acumulada nunca volta a consistente. Página incompleta nunca certifica conclusão. Cursor
  conflitante exige reinício explícito; reload reinicia consulta inteira, sem retomar cursor
  antigo de outro ator/escopo. Resultado é verificação oficial do servidor, não criptografia
  independente feita no aparelho.
- Pedidos têm link direto ao acompanhamento. Recebimentos e operações B respeitam intenção C
  pendente. Ações comerciais respeitam pendência oficial e local do pedido; servidor continua
  decidindo locks e bloqueios físicos. Publicação invalida prefixo inteiro do tenant, incluindo
  estoque, pedidos, títulos, créditos, aplicações, pagamentos, históricos e reembolsos.
- Início mostra primeira página de pendências para administrador, sem contar saldo ou total
  global. Recuperação da sessão roda em leitura; falha financeira não desmonta cadastros e
  telas comerciais. Rotas financeiras aguardam hidratação/conferência antes de montar formulários.

### Persistência real e recuperação

`src/lib/intent.ts` continua sendo a ledger única. Comandos financeiros A/B/C, cadastros
financeiros e aprovação de desconto agora usam `prepare`/`finish` assíncronos. `prepare`
confirma armazenamento antes do HTTP. Falha, quota, escrita silenciosamente perdida ou
checkpoint incompleto impedem envio; não há fallback financeiro para memória ou `kvStorage`.
Comandos comerciais/estoque anteriores mantêm API síncrona existente em memória, e a hidratação
financeira não apaga suas intenções. Não foram reimplementados nessa etapa.

Cada registro guarda uid, tenantId, tipo, recurso, intentId, chave, corpo canônico recursivo,
status de recuperação e executionId quando conhecido. Execuções guardam última revisão,
fence e status oficial observado. Registro `prepared` é tratado conservadoramente como
possivelmente enviado após restart. Não se grava token, senha, e-mail ou cadastro pessoal junto
à intenção. Referência/motivo necessários pertencem ao próprio payload original do contrato.

- **Android/iOS:** `expo-secure-store` 57.0.4 já instalado. Dados protegidos pelo Keychain/Keystore,
  com `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, sem depender de alteração biométrica para ler checkpoint.
  Payload é dividido em fragmentos de 256 caracteres; teste com UTF-8 verifica valores abaixo
  de 2048 bytes. Cada fragmento é relido. Ponteiro de geração só muda depois de todos serem
  confirmados; geração antiga só é limpa depois da confirmação do novo snapshot. Falha entre
  etapas preserva geração anterior ou mantém novo checkpoint preparado, sem permitir POST.
  Serialização por partição protege operações concorrentes dentro do aplicativo.
- **Web:** IndexedDB, banco `lastro-critical-intents-v1`, object store `owners`, partição
  uid/tenant. Read-modify-write ocorre numa transação `readwrite`, inclusive entre conexões/abas.
  Somente `oncomplete` confirma escrita. Não usa localStorage e não promete proteção equivalente
  ao Keychain contra scripts da mesma origem. Erros/abort de transação bloqueiam novos comandos.
- **Fonte de verdade:** backend. Persistência local auxilia replay e recuperação; nunca decide
  saldo, prova, lease ou desbloqueio econômico. Inicialização/sessão/tela faz GET, não POST.
  Chave/corpo antigos reaparecem somente para mesma conta/empresa. Logout não remove checkpoint.
  Outra conta/tenant não lê nem reutiliza essa partição.
- **Sessão:** guarda do transporte verifica identidade depois de aguardar token. Troca de
  usuário, logout/login do mesmo UID ou troca de empresa cerca writers antigos antes do fetch.
  Consultas possuem AbortSignal e callbacks ignoram contexto desmontado. Resultado tardio de
  desconto não popula cache de outra sessão. Intenção antiga permanece no contexto original.
- **Limites locais:** limpeza manual do navegador, remoção/reinstalação do app, perda do
  aparelho, quota ou invalidação do armazenamento podem impedir recuperação local. Não se
  recria a chave perdida para fingir replay. Conferir execução, estado e histórico oficiais.
  Intenções perdidas antes da adoção de C não podem ser reconstruídas do registro antigo em memória.

Referência usada antes de implementar adapter nativo: [SecureStore SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/).
Expo alerta sobre payload grande e sobre não usar armazenamento local como fonte única de dados
críticos. Aqui a decisão econômica e suas provas continuam no backend.

### Endpoints integrados em C

Relativos a `/api/v1`. Todas as leituras têm Bearer e tenant. Todo POST abaixo usa UUID
`Idempotency-Key`; nenhuma rota ou transição foi inventada. Contrato vigente: 0.8.1/114 operações.

| Método | Endpoint                                          | Integração                                     |
| ------ | ------------------------------------------------- | ---------------------------------------------- |
| POST   | `/orders/{id}/financial-cancellation`             | Cancelamento atômico                           |
| POST   | `/orders/{id}/financial-cancellation-executions`  | Início opt-in F02                              |
| GET    | `/financial-executions`                           | Lista, filtros, recuperação e pendências       |
| GET    | `/financial-executions/{id}`                      | Estado atual, revisão/fence e publicação       |
| POST   | `/financial-executions/{id}/advance`              | Um passo limitado e explícito                  |
| POST   | `/financial-executions/{id}/resume`               | Retomada auditada/reautenticada                |
| POST   | `/financial-executions/{id}/abort`                | Abort admissível pelo servidor                 |
| GET    | `/financial-executions/{id}/proof-reconciliation` | Provas cumulativas paginadas                   |
| GET    | `/orders/{id}/financial-reconciliation`           | Journal cumulativo paginado                    |
| GET    | `/returns`, `/returns/{id}`                       | Lista e estado físico/financeiro materializado |
| GET    | `/returns/{id}/resolution-preview`                | Quantidades, limites e versões oficiais        |
| GET    | `/returns/{id}/history`                           | Eventos por ID, identificados pela sequência   |
| POST   | `/returns/{id}/resolve`                           | Resolução atômica do recebido existente        |
| POST   | `/returns/{id}/resolution-executions`             | Resolução retomável do recebido existente      |

Leituras A/B permanecem reutilizadas: estado financeiro, pedido, títulos, recebimentos, fontes,
aplicações, obrigações, condições e métodos. E2E prepara devolução pela API real com
`POST /orders/{id}/returns` e `POST /returns/{id}/receipts`, somente em fixtures sintéticas locais.
Esses comandos físicos não foram adicionados à interface C.

### Permissões e limitações do backend

Administrador comercial com permissão específica: cancelamento usa
`financial-cancellation:manage`; resolução usa `returns:manage`; advance/resume/abort usam
`payments:manage`; leituras/reconciliação exigem `receivables:read`. Start/resolve/cancel/resume/
abort exigem autenticação recente. Refresh de token não renova auth_time. Vendedor e Super
Admin Hepta não montam rotas financeiras nem ganham autorização comercial implícita.

Não há worker agendado, operação bancária, PSP, reparo de saldo/prova, desconto em confirmado,
reversão de reembolso manual ou cancelamento direto de expedido. Reembolso continua obrigação
manual até confirmação externa pela Fase B. `sharedLots` não enumera todos os locks adquiridos.
Lease não elimina bloqueio, e COMPLETED não elimina automaticamente pendência física de devolução.

Não havia tela de intenção/recebimento físico no frontend. Essa dependência permanece explícita:
C entrega resolução financeira dos registros recebidos existentes, sem simular recebimento nem
inventar módulos físicos. Etapa 7 deve definir UI física separada caso seja parte de seu escopo.

Maior que 100 fontes exige retomável pela seleção técnica do backend. Não é teto comercial.
Homologação de latência, custo, quotas, índices implantados e 20.000 HTTP reais permanece pendente.
Não foi encontrada incompatibilidade contratual que exigisse bloquear uma operação C disponível.

### Validação C

- Baseline antes de codificar: 26 suítes, 354/354. Final: **31 suítes, 433/433**, zero falhas ou
  testes desabilitados; **79 novos**. Cobre restart lógico, escrita interrompida/corrompida,
  chave/corpo canônico, logout/login, conta/empresa, concorrência de ledger, 202/200/publicação,
  perda de resposta, fencing/revisão/lease, retomada com passo preservado, abort, danos/preview,
  paginação cumulativa, permissões e transporte durante troca de identidade.
- **E2E HTTP 24/24**: API real com Auth/Firestore/Storage Emulator demo. Inclui 10 e 101
  recebimentos reais representativos, caminho atômico recusado antes de efeitos em 101 fontes,
  completabilidade F02, concorrência de sessões, lease expirado, novo fence, abort antes/depois
  da aplicação, replay de passo, publicação/evento únicos, reconciliação paginada, devolução
  parcialmente recebida e obrigação ainda não paga.
- **E2E complementar 6/6**: dano com aceite zero/rejeição, resolução atômica idempotente,
  dois inícios simultâneos com mesma chave, payload divergente recusado, dívida/crédito/caixa
  preservados com restauração à fonte legítima original, e versão antiga sem efeitos.
- **Restart de processo**: worker separado prepara checkpoint no adapter de fragmentos do
  frontend com KV de disco de teste, envia start e descarta resposta após commit. Segundo
  processo lê mesma chave/corpo e consulta GET sem POST. Terceiro faz replay explícito e encontra
  mesmo executionId. Não é Keychain/Keystore físico nem apenas remount React.
- **Web 5/5**: adapter IndexedDB real em Edge headless e perfil isolado. Valida reload, fechar
  browser e abrir processo novo, mesma chave/corpo, partições de conta/empresa, transações
  concorrentes e abort de escrita inválida preservando snapshot. É harness de armazenamento
  real, não automação completa da interface comercial. Não houve aparelho ou emulador nativo.
- `npm ci --no-audit --no-fund`: aprovado, 1165 pacotes, sem alteração de dependências/lockfile.
  Aviso herdado de peer de test-renderer permanece documentado em A/B; não houve upgrade para
  esconder aviso. `package.json` mudou somente exclusão do diretório `.local` na coleta Jest.
- TypeScript strict, lint sem erros/avisos, Prettier do frontend: aprovados. Expo Doctor: **21/21**.
  ESLint/Jest excluem artefatos ignorados em `.local`; nenhuma regra de aplicação/teste foi removida.
- `expo export --platform all`: web **2,7 MB**, Hermes iOS **4,7 MB** e Android **5,0 MB**,
  em `.local/finance/export-c`. Compilação/bundles locais, não APK/AAB ou iOS assinado. Não houve
  teste em aparelho físico, emulador Android/iOS, deploy, produção ou recurso pago.
- Falhas de desenvolvimento corrigidas: preservação da chave após reauth recusada, campos
  ausentes nas fixtures históricas, isolamento do transporte compatível com compilador React,
  versão de fixture de usuário e códigos reais de devolução. E2E respeita 429/Retry-After sem
  relaxar limite, plano ou autorização do backend. Final: nenhuma falha nos checks executados.

Evidências sem credenciais: [HTTP](evidence/finance-c-e2e.json),
[complemento HTTP](evidence/finance-c-e2e-additional.json),
[IndexedDB](evidence/finance-c-web-storage.json) e
[validação/hashes](evidence/finance-c-validation.json).

### Arquivos alterados em C

- `src/lib/intent.ts`, `intentStorageCore.ts`, `intentStorage.ts`, `webIntentStore.ts`: ledger,
  partições, armazenamento estrito, checkpoints, recuperação e preservação de passo anterior.
- `src/features/finance/resolutionRules.ts`, `resolutionCommands.ts`, `resolutionApi.ts`:
  contratos, preview, transporte idempotente, status/publicação e hooks do executor/devoluções.
- `src/features/finance/{ResolutionForm,ResolutionConfirmation,ExecutionScreen,ExecutionsScreen,
ReturnsScreen,ReconciliationPanel,FinancialRecovery,FinanceGlance}.tsx`: fluxos e telas C.
- `src/app/(app)/financeiro/execucoes/{index,[id]}.tsx`,
  `src/app/(app)/financeiro/devolucoes/{index,[id]}.tsx`: quatro rotas protegidas.
- `src/features/finance/{api,commands,administrationApi}.ts`,
  `{FinanceAccess,FinanceNav,OrderAdministrationScreen,ReceiptForm,EconomicForm,DiscountPanel}.tsx`:
  reuse A/B, persistência antes do envio, cache e bloqueios compartilhados.
- `src/api/{client,types,errors}.ts`, `src/session/{SessionContext,transportGuard}.ts*`:
  aliases, mensagens e guarda depois da espera de token.
- `src/features/orders/{api,OrderActions,OrderFinancePanel}.ts*`, `src/app/(app)/{_layout,index}.tsx`:
  integração, cache tardio protegido, inicialização e pendências administrativas.
- `tests/support/financeCFixtures.ts`, cinco `tests/unit/financeC*.test.*`, `tests/setup.ts`:
  79 testes e mock de armazenamento nativo que conserva bytes. Testes anteriores não foram removidos.
- `scripts/{e2e-finance-c,e2e-finance-c-additional,finance-c-restart-worker}.ts`,
  `scripts/e2e-finance-c-web.cjs`, `scripts/e2eSupport.ts`: fixtures/validações locais e credenciais
  sintéticas somente em memória/ambiente do processo; nunca na evidência ou checkpoint.
- `package.json`, `eslint.config.js`, `.gitignore`: exclusão de artefatos/logs locais;
  `docs/finance-progress.md`, `docs/architecture.md`, quatro evidências C.

Backend não foi editado. Checkout contém alterações de etapas anteriores e muitos arquivos
não rastreados; a lista acima delimita C e não representa diff limpo desde um commit. Logs,
perfil de teste e bundles ficam em `.local/finance`. API/emuladores locais foram encerrados e
credencial temporária do seed foi apagada depois da validação.

### Retomada e Etapa 7

1. Não refazer Etapa 6 ou F02. Preservar 433 testes e evidências A/B/C. Começar com leitura deste
   checkpoint e validação do baseline. Etapa 7 precisa de definição funcional própria.
2. Se houver intenção financeira pendente, entrar com mesmo UID/empresa. Abrir execução ou
   pedido indicado. Consultar GET oficial antes de revisão/replay; não limpar storage nem gerar
   chave nova para uma resposta perdida.
3. Para continuar F02, usar revision/fence atuais e ação explícita. Para assumir lease/revisão,
   pedir senha/motivo e enviar resume na mesma execução. Passo incerto anterior fica preservado.
   Não adicionar worker/scheduler como continuação implícita desta entrega.
4. Reconciliar journal e provas separadamente, com mesmo ator/tenant/recurso/limite e cursores
   oficiais. Depois de conflito ou restart, reiniciar consulta inteira. Exigir complete antes
   de qualquer rótulo de verificação completa.
5. Conferir estado materializado da devolução depois de COMPLETED. Se há saldo físico pendente,
   definir e integrar fluxo físico real em escopo futuro; nunca liberar bloqueio ou lançar
   estoque pela resolução financeira.
6. Testes reais de Keychain/Keystore após encerramento/reabertura, signed builds e homologação
   de capacidade/latência/quota ficam para autorização e ambiente próprios. Bundles exportados
   nesta entrega não aprovam esses itens. Não fazer deploy, commit/push ou produção por inferência.

Comandos C (frontend; Node 24.19.0, API local/Java 21 conforme histórico):

```powershell
npm ci --no-audit --no-fund
node node_modules/jest/bin/jest.js --runInBand
npm run typecheck
npm run lint
node node_modules/prettier/bin/prettier.cjs --check .
node ../backend/node_modules/tsx/dist/cli.mjs scripts/e2e-finance-c.ts
node ../backend/node_modules/tsx/dist/cli.mjs scripts/e2e-finance-c-additional.ts
node scripts/e2e-finance-c-web.cjs
npx expo-doctor
npx expo export --platform all --output-dir .local/finance/export-c
```

E2E exige API/emuladores demo já iniciados e SEED_PASSWORD efêmera do seed local. Nunca copiar
essa credencial para documentação. Harness web exige Edge local (ou FINANCE_BROWSER explícito),
portas 9339/9340 livres e perfil isolado em `.local`; nenhum perfil pessoal é acessado.
