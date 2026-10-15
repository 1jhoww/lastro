# Correção consolidada F03–F07 — 13/10/2026

## Estado da validação

**BACKEND APTO PARA HOMOLOGAÇÃO LOCAL.** F03, F05 e F07 resolvidos localmente; F04 e F06 parciais por configuração/validação externa. Foram executados **636 testes únicos, todos aprovados**, incluindo **36 novos**, com zero falhas, pendências ou todo. A base de 602 permanece: 600 testes anteriores passaram novamente e dois cenários estruturais dispensados conservam a aprovação histórica F02. O conjunto validado soma **638 identidades únicas**, distinguindo claramente as duas evidências históricas. Isso não autoriza deploy nem declara prontidão produtiva.

Escopo exclusivo: `C:\Users\Administrador\Desktop\Lastro\backend`. Sem deploy, commit, push, recursos pagos, acesso à produção ou alterações no frontend/outros projetos. A auditoria A–G, `validation-f02.md`, contratos/tipos, módulos e testes existentes foram consultados. F02 não foi reimplementado; ledger, provas, idempotências financeiras, executor, leases, checkpoints e publicação permanecem preservados.

## Diagnóstico e correções

| Achado | Correção local                                                                                                                                                                                                                                            | Dependência externa                                                                                                                                    | Veredito final    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| F03    | Limitação privada barata antes de JSON; cache curto/single-flight de readiness; RPC pendente conserva vaga; IPv6 normalizado; trust por hops recusado e allowlist explícita de peers                                                                      | Validar ingress, headers sanitizados, HTTPS, cadência de probes e controle volumétrico Cloud Run                                                       | RESOLVIDO (local) |
| F04    | TTL Timestamp declarado somente para `rateLimits`; replay administrativo expira logicamente em 30 dias e conserva chave; leitura ISO legada e conversor demo com dry-run/cursor; limpeza de imagens com jobs, referências, permissão e claim transacional | Ativar TTL, migração produtiva supervisionada, inventário de órfãos antigos, IAM/agenda/custo; uploads interrompidos exigem recuperação supervisionada | PARCIAL           |
| F05    | Recebimento, resposta e orçamento operacional separados; duas vagas PDF/CSV e quatro vagas de listas; consultas de pedidos projetadas e snapshots sequenciais; cache financeiro de quatro origens; orçamento acumulado de bytes e paginação               | Homologar memória/custo/latência/SDK Linux e limites de implantação; RPC já enviada não é fisicamente cancelada                                        | RESOLVIDO (local) |
| F06    | Node 22.23.3 LTS/OpenSSL 3.5.8; engines restrito, pin, verificação no build/servidor; artefato com fontes/licença, hashes e smoke PDF/Sharp; Dockerfile com versão explícita                                                                              | Docker/Linux não disponível; imagem e ambiente Cloud Run/Firebase real não foram executados                                                            | PARCIAL           |
| F07    | Gerador separa `io: input`/`output`; defaults materializados obrigatórios; schemas dos transforms SKU/UF/CEP; OpenAPI/tipos regenerados e verificação de sincronização                                                                                    | Integração do consumidor dos tipos e homologação externa                                                                                               | RESOLVIDO (local) |

Detalhes e comandos: [operação F03–F07](../operations-f03-f07.md). A declaração local de TTL não significa política ativa. Retenção das chaves administrativas é permanente contra replay; não existe TTL administrativo/financeiro. Imagens em upload não são excluídas só por idade. Janitor/infraestrutura não foram simulados como ativos.

### Reprodução e regressões

Antes da correção, testes na aplicação Express real demonstraram 400 no terceiro JSON inválido com cota 2, oito leituras para oito probes concorrentes e semântica de entrada nas respostas. Evidência: `reports/f03-f07-before.raw.json`. A execução válida desse recorte registrou três falhas específicas e dois testes aprovados. Falhas iniciais de TEMP/sockets do sandbox foram ambientais e não contaram como prova da correção.

F03 testa JSON inválido sequencial/concorrente, corpo excessivo, requests válidos, IPs distintos, spoofing de headers, IPv6, cardinalidade, janela, cache positivo/negativo, falha/recuperação e SDK lento. Cotas distribuídas e controles anteriores permanecem na suíte.

F04 testa Timestamp/ISO, expiração lógica, ausência de reaplicação, retenção das chaves, configuração TTL restrita, referências de imagem, grace period, upload ainda em andamento, confirmação de commit perdida, permissão empresarial e falha retomável de Storage. Ledger/provas/auditorias/idempotências financeiras não receberam limpeza.

F05 testa cota mantida após timeout/cancelamento, interrupção de passos posteriores, byte budget, orçamento aninhado, PDF com leitura inicial lenta e reentrada posterior, snapshots sequenciais, página de 40 pedidos grandes, paginação menor e resposta financeira tardia com replay que conserva um pagamento e 500 centavos. O código não anuncia ausência de commit quando perde resposta.

F06 testa runtime aceito/recusado, cópia isolada de `dist`, geração de PDF sem assets de desenvolvimento e falha por fonte ausente. F07 verifica todos os envelopes JSON contra saída Zod, entrada/saída de `weight`, resposta HTTP real e tipo gerado obrigatoriamente numérico em TypeScript strict.

## Validação integrada

| Verificação                                              | Resultado final                                                                                        | Evidência                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Unitários completos                                      | 252 aprovados, 20 arquivos, 5,13 s                                                                     | reports/f03-f07-unit.raw.json                                      |
| Regressão emulada completa, exceto dois ensaios grandes  | 383 aprovados, 37 arquivos, 1.590,74 s, saída zero                                                     | reports/f03-f07-emulator.raw.json                                  |
| Conversão administrativa adicionada após início da suíte | 1 aprovado, 12,08 s, saída zero; dry-run, 100 registros/página, cursor, precondição, retenção e replay | reports/f03-f07-migration.raw.json                                 |
| União desta rodada                                       | 636 únicos aprovados, 36 novos, 0 falhas/pendentes/todo                                                | reports/f03-f07-validation.raw.json                                |
| Preservação F02                                          | 600 anteriores repetidos + 2 ensaios grandes historicamente aprovados; nenhuma identidade ausente      | reports/f03-f07-validation.raw.json e relatórios F02               |
| PDFs/CSV em emuladores                                   | 21 PDF + 18 CSV aprovados na suíte final                                                               | reports/f03-f07-emulator.raw.json                                  |
| TypeScript strict                                        | Aprovado após testes/scripts finais, saída zero                                                        | tsc --noEmit                                                       |
| Lint                                                     | Aprovado, saída zero                                                                                   | eslint .                                                           |
| Build/artefato e wrapper PowerShell                      | Aprovados em Node 22.23.3 Windows, saída zero                                                          | npm run build; scripts/npm.ps1 run build                           |
| Formatação                                               | Aprovada, saída zero; conferência repetida após este relatório                                         | prettier --check .                                                 |
| OpenAPI/tipos                                            | Sincronizados, 0.8.1, 114 operações; tipos de resposta materializados conferidos em strict             | scripts/check-openapi.ts                                           |
| Vulnerabilidades runtime e árvore completa               | 0; ambas auditorias com saída zero                                                                     | reports/f03-f07-audit-runtime.raw.json; f03-f07-audit-all.raw.json |
| Dependências                                             | Árvore sem erros; nenhuma versão de pacote alterada                                                    | reports/f03-f07-dependencies.raw.json                              |
| Firestore/TTL                                            | 134 índices/82 campos validados pelo validador local Firebase CLI; nenhuma chamada remota              | reports/f03-f07-firestore-config.raw.json                          |
| Inicialização compilada                                  | live/ready 200 em porta local dinâmica; processo encerrado                                             | reports/f03-f07-server-smoke.raw.json                              |
| Scanner local de segredos                                | Sem achados, saída zero                                                                                | scripts/check-secrets.mjs                                          |
| PDF renderizado                                          | Todas as páginas dos cinco arquivos, A4/bounds/nonblank; amostras visualmente conferidas               | reports/document-pdf-validation.raw.json                           |

Nenhum teste anterior foi removido/desabilitado. A identidade da base preservada é arquivo + nome completo: 227 unitários e 375 emulados únicos, total 602. O script `scripts/summarize-f03-f07.mjs` confirmou essa união, ausência de regressões omitidas e 36 testes novos, sem somar recortes sobrepostos. Teste CLI de migração foi acrescentado após a descoberta inicial de arquivos da regressão completa, executado separadamente no mesmo código de produção e unido por identidade. Nenhum teste foi removido ou teve asserções reduzidas; a única expectativa legada ajustada foi a versão declarada de OpenAPI 0.8.0 para 0.8.1.

Os dois testes de 20.000 fontes continuam no arquivo original e na execução padrão do launcher. A rodada usa `--without-capacity`, permitido pelo pedido: não houve alteração no executor/selagem/publicação/limites financeiros. Os novos budgets só são ativados por leituras/documentos/listagens; comandos financeiros recebem somente deadline de resposta e conservam commit/replay. A regressão final aprovou integração F02, recuperação, locks, fencing, provas, fonte/backfill, publicação, concorrência e compatibilidade. A aprovação histórica dos dois cenários vem de F02; não é uma nova execução em Node 22.23.3.

### PDFs e exportações

A regressão final aprovou 21 testes HTTP de PDF e 18 de CSV. PDF comercial com 200 produtos: 30 páginas e 88.604 bytes; romaneio: 21 páginas e 73.768 bytes. Romaneio de 200 produtos expedidos após retorno físico parcial/dano também passou. Unitários preservam 1/20/50/100/200 produtos em ambas as modalidades, glifos, determinismo, limites e falhas sem arquivo parcial. Validador renderizou os cinco arquivos integralmente e verificou área imprimível, conteúdo não vazio e A4; páginas amostradas foram inspecionadas visualmente sem sobreposição/corte.

CSV preserva páginas, BOM/CRLF, fórmulas neutralizadas, filtros/cursor, permissões, isolamento, revalidação, limite de bytes, falha, concorrência e ausência de efeitos financeiros/comerciais. PDF/CSV compartilham duas vagas; tentativas após timeout não abrem novas RPCs enquanto trabalho antigo não terminar.

Ensaio final de memória: 40 snapshots válidos de 659.818 bytes; página `limit=100` parou após 26 leituras e respondeu `READ_MEMORY_LIMIT`. `limit=2` e continuação pelo cursor passaram sem truncar as 1.800 linhas de cada pedido. Heap amostrado aumentou 33.811.880 bytes; RSS amostrado passou de 395.464.704 para 414.552.064 bytes. Esses valores incluem runtime/fixture, não são pico isolado nem garantem memória/capacidade em Cloud Run. Evidência: `reports/f03-f07-memory.raw.json`.

## Contratos, runtime e infraestrutura

- OpenAPI: 0.8.0 → **0.8.1**, 114 operações e os oito endpoints financeiros preservados. Tipos regenerados; respostas exigem defaults já materializados. JSON financeiro real não foi reformatado.
- Backend package: 0.1.0; dependências permanecem nas versões do lockfile. Apenas engines da raiz mudaram para `>=22.23.3 <23`; `npm audit` não equivale a auditoria do runtime.
- Runtime executado: Windows x64, Node **22.23.3**, OpenSSL **3.5.8**. Binário oficial e SHA-256 conferido; Node global **22.16.0** não foi alterado. [Release oficial](https://nodejs.org/en/blog/release/v22.23.3), [suporte LTS](https://nodejs.org/en/about/previous-releases).
- Firestore: **134 índices compostos, 82 configurações de campo, uma declaração TTL**, somente `rateLimits.expiresAt`. A política continua não implantada. Índices comerciais/financeiros existentes não foram removidos.
- Ferramentas: npm CLI **10.9.2**, Firebase CLI **15.33.0**, Temurin/OpenJDK **21.0.7+6**, Firestore Emulator **1.22.0**, Storage Rules Runtime **1.1.3**. SHA-256 do lockfile final: `801b34f7fe1cea0be902a9a6d065b79e23c65ce06c4df1fc4874eef188d256b2`. SHA-256 do Node portátil Windows: `9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e`.
- Sharp **0.35.5**, libvips **8.18.7**, Firebase Admin **14.5.0**: build/import e fluxos locais aprovados; validação nativa Linux pendente. Fontes Liberation Sans regular/bold e licença OFL estão em `dist/assets`, com manifesto SHA-256.
- Cloud Run/Firebase: ingress/TLS/headers, IAM, secrets, limites de instâncias/concurrency/memória, cadência de probes, TTL/migração/agenda, backups e restauração exigem revisão/implantação externa autorizada. Nenhum desses serviços foi alterado. [TTL oficial](https://firebase.google.com/docs/firestore/ttl), [timeout Cloud Run](https://docs.cloud.google.com/run/docs/configuring/request-timeout).

## Arquivos modificados/criados

Código: `src/app/{app,routes,server,documentRoutes,readiness}.ts`; `src/config/{env,runtime}.ts`; `src/infrastructure/repositories/foundationRepository.ts`; `src/middlewares/{rateLimit,errorHandler,ingressLimit,processingDeadline}.ts`; `src/modules/auth/openapi.ts`; `src/modules/documents/{documentService,exportService,pdfRenderer}.ts`; `src/modules/orders/orderService.ts`; `src/modules/finance/financialReads.ts`; `src/modules/platformAdmin/platformService.ts`; `src/modules/products/imageService.ts`; `src/shared/operations/readBudget.ts`; `src/shared/schemas/{models,commercial}.ts`.

Configuração/scripts: `package.json`, `package-lock.json`, `firestore.indexes.json`, `.env.example`, `.node-version`, `.npmrc`, `Dockerfile`, `.dockerignore`, `eslint.config.js`; `scripts/{check-runtime.ts,package-assets.mjs,check-artifact.mjs,check-openapi.ts,migrate-admin-expiry.ts,summarize-f03-f07.mjs,smoke-server.mjs,emulators.mjs,npm.ps1}`.

Testes: `tests/unit/{config,documents,httpProtection,openapiOutput,readBudget,artifact}.test.ts`; `tests/integration/{remediation,readMemory,adminExpiryMigration}.test.ts`.

Documentação/contratos: `README.md`, `docs/security.md`, `docs/operations-f03-f07.md`, `docs/api/{frontend-contract.md,openapi.json,generated-types.ts}`, `docs/audits/{remediation-plan-f03-f07.md,remediation-f03-f07-2026-10-13.md}`. Artefatos derivados em `dist/`, evidências em `reports/` e runtime/cache em `.cache/` pertencem somente ao backend local.

## Riscos residuais e veredito geral

Validação local concluída. F04 permanece PARCIAL porque TTL, migração produtiva e rotina de órfãos/IAM/agendamento não estão ativos. F06 permanece PARCIAL porque Docker/Linux e ambiente Cloud Run/Firebase real não foram executados, embora runtime Windows corrigido e artefato local estejam aprovados. Configurações de produção não estão ativas. SDK pendente pode reduzir capacidade até terminar; byte budget não é RSS garantido. Limites são por instância e não comprovam SLO, carga distribuída, custo ou segurança de ingress. Registros administrativos anti-replay e jobs conservados exigem governança de retenção; upload interrompido/órfão antigo exige recuperação supervisionada. Runtime Linux/Cloud Run continua sem execução nesta máquina.

**BACKEND APTO PARA HOMOLOGAÇÃO LOCAL**, com F04/F06 parciais e pendências externas explícitas. Não existe bloqueante local identificado após esta regressão. Exposição externa/produção exige concluir o gate de infraestrutura e validar artefato Linux, capacidade/custo e políticas de retenção. Isso não é autorização de deploy. Emuladores e servidor de smoke foram encerrados; portas locais 8080/9099/9199/4400/4500/9150 estavam sem listeners ao concluir.
