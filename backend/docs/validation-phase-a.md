# Validação local — Fase A

Execução em 8 de outubro de 2026, Windows, Node.js 22.16.0, Java 21.0.7, TypeScript 5.9.3 e Firebase CLI 15.33.0. Exclusivamente dados sintéticos e Firebase Emulator Suite. Este relatório registra a validação da fundação; não aprova publicação nem comprova os módulos comerciais ou a capacidade produtiva.

## Resultados executados

| Verificação                                             | Resultado                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| TypeScript strict — `npm run typecheck`                 | Aprovado, código de saída 0                                             |
| Vitest unitário — `npm test`                            | 14 testes aprovados, zero falhas                                        |
| Firebase Emulator Suite — `npm run test:integration`    | 33 testes aprovados, zero falhas                                        |
| Integração da fundação                                  | 18 testes dentro da suíte emulada                                       |
| Segurança e isolamento                                  | 12 testes dentro da suíte emulada                                       |
| Concorrência                                            | 3 testes dentro da suíte emulada                                        |
| ESLint — `npm run lint`                                 | Aprovado, código de saída 0                                             |
| Prettier — `npm run format:check`                       | Aprovado, código de saída 0                                             |
| Build — `npm run build`                                 | Aprovado, código de saída 0; entrada compilada `dist/src/app/server.js` |
| Exportação OpenAPI 3.1 — `npm run openapi`              | Aprovada; 17 operações implementadas                                    |
| Tipos do contrato — `npm run types:api`                 | Gerados com openapi-typescript                                          |
| `npm audit`, grafo completo                             | Zero vulnerabilidades conhecidas reportadas                             |
| `npm audit --omit=dev`, runtime                         | Zero vulnerabilidades conhecidas reportadas                             |
| Verificação local de segredos — `npm run audit:secrets` | Zero ocorrências nas assinaturas verificadas                            |

Total: **47 testes aprovados**. O Vitest grava os relatórios JSON locais em `reports/unit-tests.raw.json` e `reports/emulator-tests.raw.json`; os audits usados nesta entrega estão em `reports/dependency-audit.raw.json` e `reports/runtime-audit.raw.json`. Esses arquivos brutos são ignorados pelo Git e não devem ser publicados como logs. A suíte emulada final levou aproximadamente 42 segundos; esse tempo não é benchmark ou SLO.

## Cobertura que sustenta a entrega

- Autenticação ausente, inválida, expirada, audiência/emissor divergentes, usuário global desativado e revogação de sessão. A validação criptográfica contra certificados reais não é exercitada pelo Auth Emulator.
- Empresa A tentando acessar B por header ou UID; vínculo inexistente; campos de tenant/permissão/plataforma proibidos; administrador empresarial tentando rotas de plataforma; Super Admin sem vínculo tentando dados empresariais; vendedor tentando promoção.
- Primeiro administrador por convite verificado; segundo administrador ou vendedor; terceiro usuário bloqueado; reserva, expiração e revogação de convite; consumo único; email atual verificado consultado no Firebase, inclusive quando o token carrega email anterior.
- Mudanças de perfil e desativação efetivas com token já emitido; proteção do último administrador; capacidade verificada na reativação; auditoria e versões esperadas.
- Assinaturas active/past_due/suspended/canceled, reativação e política central de catálogo. O catálogo não foi implementado; sua política foi testada em unidade. Condições especiais usam exemplos sintéticos, sem cadastro ou definição comercial da Daiane.
- Planos versionados preservando contratos existentes, idempotência de criação, rejeição de replay com carga divergente, recuperação do convite inicial, paginação e cursores vinculados ao contexto.
- Corridas: dois convites para a última vaga, duas aceitações do mesmo convite e dois administradores tentando se desativar. Os resultados preservaram capacidade, vínculo único e pelo menos um administrador ativo.
- Entradas inválidas, JSON acima de 64 KiB, CORS, erros sanitizados e falha de schema persistido; cliente Firestore direto bloqueado pelas regras; contador HTTP compartilhado entre duas instâncias lógicas usando o mesmo Firestore emulado.

## Verificação do processo HTTP e bootstrap

A API compilada foi iniciada em `127.0.0.1:3000` com emuladores do projeto `demo-lastro-phase-a`. As verificações HTTP retornaram:

| Requisição                 | Resultado observado                  |
| -------------------------- | ------------------------------------ |
| `GET /health/live`         | 200                                  |
| `GET /health/ready`        | 200, Firestore acessível             |
| `GET /docs/`               | 200, HTML Swagger UI e CSP presentes |
| `GET /openapi.json`        | 200, OpenAPI 3.1.0 com 17 operações  |
| `GET /api/v1/me` sem token | 401 com erro padronizado e requestId |

O bootstrap local criou somente o operador fictício e o plano configurável. Sua reexecução preservou a identidade existente. A senha temporária não foi incluída no relatório. A interface Swagger foi verificada por HTTP; não houve avaliação visual ou teste interativo no navegador.

Os processos usados nesta verificação foram encerrados e as portas locais ficaram livres. O seed deve ser executado novamente ao iniciar uma sessão nova de emuladores; não há exportação de credenciais ou banco de desenvolvimento nessa validação.

## Reproduzir

Siga a instalação e os comandos no [README](../README.md). A suíte de integração inicia seus próprios emuladores em `demo-lastro-tests`; pare a sessão de desenvolvimento primeiro. Ela recusa projeto real, hosts remotos e execução contra produção.

No ambiente desta entrega, o comando global `npm` estava quebrado. As verificações usaram o CLI que acompanha Node.js; o wrapper `scripts/npm.ps1` oferece o mesmo caminho sem alterar a instalação global. O launcher usa Java 21 e um diretório temporário local com caminho completo para evitar a falha de sockets do Java no TEMP abreviado do Windows.

## Limites e critérios ainda pendentes

Zero achados no npm audit representa a base de advisories consultada nesta execução. Não equivale a ausência de vulnerabilidades no produto. A detecção local de segredos é limitada; não houve scanner externo dedicado, pentest, certificação ASVS completa ou execução contra autenticação produtiva.

Ainda exigem etapa aprovada: IAM, TLS/ingress/proxy, Secret Manager e rotação, MFA/recuperação do operador, retenção/TTL e proteção independente de auditoria, validação de índices produtivos, backups e restauração, monitoramento, SLOs, testes de carga para 100 usuários, autoscaling e custos para 10/50/100 empresas. Cloud Armor e App Check precisam de avaliação de risco, compatibilidade e custo antes de eventual adoção.

Pedidos, estoque, pagamentos, catálogo, relatórios e documentos não existem nesta fase. Portanto não há evidência de consistência financeira/estoque, desempenho desses fluxos ou capacidade medida em produção. Consulte [riscos e controles](security.md) e [preparação da Fase B](phase-b.md).
