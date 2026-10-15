# Validação local — Fases A e B

Execução em 8 de outubro de 2026, Windows, Node.js 22.16.0, Java 21.0.7, TypeScript 5.9.3, Firebase CLI 15.33.0 e sharp 0.35.5. Somente dados sintéticos e Auth/Firestore/Storage Emulator. Nenhum banco produtivo, deploy, commit, push ou recurso de nuvem. O [relatório histórico da Fase A](validation-phase-a.md) foi preservado.

## Resultados reais

| Verificação                     | Resultado                                    |
| ------------------------------- | -------------------------------------------- |
| Vitest unitário                 | 35 testes aprovados, zero falhas             |
| Vitest + Supertest + emuladores | 67 testes aprovados, zero falhas             |
| Testes da fundação preservados  | 47 existentes continuam aprovados            |
| Testes acrescentados nesta fase | 55 (incluindo guardas de configuração)       |
| Total final                     | **102 aprovados, zero falhas**               |
| TypeScript strict               | Aprovado, saída 0                            |
| ESLint                          | Aprovado, saída 0                            |
| Build compilado                 | Aprovado, saída 0                            |
| OpenAPI 3.1                     | Exportado com 36 operações reais             |
| Tipos TypeScript de API         | Gerados com openapi-typescript               |
| npm audit completo e runtime    | Zero vulnerabilidades conhecidas reportadas  |
| Verificação local de segredos   | Zero ocorrências nas assinaturas verificadas |

Relatórios locais: reports/unit-tests.raw.json, emulator-tests.raw.json, dependency-audit.raw.json e runtime-audit.raw.json. São ignorados pelo Git; relatórios brutos/logs de emulação não devem ser publicados. A suíte emulada final levou 97,41 segundos; tempo de suíte não comprova benchmark/SLO ou capacidade produtiva.

Prettier format:check também passou com saída 0 após as atualizações de documentação.

## Verificação do processo compilado

A entrada dist/src/app/server.js iniciou em loopback, modo emulator. GET /health/live e /health/ready retornaram 200; /docs/ retornou 200 com HTML Swagger UI e CSP; /openapi.json retornou 200, OpenAPI 3.1.0 e 36 operações. GET sem token em /api/v1/customers, /products e /categories retornou 401 padronizado. Não houve verificação visual/interativa do Swagger.

Bootstrap local criou somente operador fictício e plano configurável; reexecutar preservou a identidade existente. Senha temporária foi omitida da saída de verificação. A API e os emuladores temporários foram encerrados; nova sessão deve executar seed novamente, sem exportação de credenciais de desenvolvimento.

## Composição da suíte final

| Arquivo                              | Testes |
| ------------------------------------ | ------ |
| tests/unit/config.test.ts            | 5      |
| tests/unit/policy.test.ts            | 11     |
| tests/unit/commercial.test.ts        | 19     |
| tests/integration/foundation.test.ts | 18     |
| tests/integration/commercial.test.ts | 16     |
| tests/security/access.test.ts        | 12     |
| tests/security/commercial.test.ts    | 12     |
| tests/concurrency/admission.test.ts  | 3      |
| tests/concurrency/commercial.test.ts | 6      |

## Evidências funcionais e de segurança

- Fundação: identidade/token/vínculo, convites, último administrador, capacidade, assinatura, plataforma separada, idempotência, versionamento e auditoria. Nenhum teste foi removido.
- Clientes: cadastro normalizado com contato/endereço parcial e sem documento; CPF/CNPJ numérico/alfanumérico e DV inválido; duplicidade local/mesmo documento em outro tenant; edição, inativação/reativação, reserva de inativo, troca de documento conflitante com rollback; paginação, prefixo sem acentos, filtros e ordenação.
- Carteiras: administrador vê todos, vendedor cria no próprio UID e consulta/edita somente seus clientes; transferência auditada altera acesso; responsável externo/inativo/admin/sem vínculo é rejeitado; vendedor não transfere, desativa ou forja filtros.
- Produtos/categorias: SKU normalizado/duplicado/igual em outro tenant; preço negativo/fracionário rejeitado, alteração administrativa auditada, vendedor sem escrita; inativação/reativação, filtros/paginação; categoria externa/inativa sem novas vinculações, referências existentes preservadas; troca para SKU ocupado não muda preço nem reserva.
- Segurança: acesso A→B por IDs/contexto, mass assignment/tenantId/autoria, query/cursor abusivos ou de outro contexto, plataforma sem vínculo empresarial, ausência de token, assinatura suspensa/cancelada em todos os grupos novos.
- Imagens: upload real no Storage Emulator, recodificação/leitura/remover associação; MIME forjado, SVG, URL, conteúdo corrompido/vazio, bytes/pixels excessivos e compressão HTTP rejeitados; acesso cruzado, escrita de vendedor e leitura Firebase direta negados; sem download token público; suspensão e limite compartilhado por ator testados.
- Concorrência: mesma reserva de CPF/SKU, transferências da mesma versão, transferência contra edição de vendedor, preços concorrentes e uploads simultâneos. Uma decisão válida prevalece; perdedor não sobrescreve nem cria segunda associação. As três corridas de admissão da Fase A continuam aprovadas.

Uma execução inicial revelou indeterminação de 401/403 no teste antigo de mudança de email dentro do mesmo segundo de emissão do token. Foi adicionado intervalo de 1,1 segundo antes da troca, preservando a expectativa original 401 e a verificação de email atual. As execuções posteriores passaram, sem afrouxar autorização ou remover teste.

## Reproduzir e limites

Instalação/comandos no [README](../README.md). Java 21 e Node LTS; portas locais 8080/9099/9199 livres. npm test executa unidade; npm run test:integration inicia/encerra seus emuladores em demo-lastro-tests. Fixtures recusam projeto real, host remoto e bucket diferente do demo. O runtime público de regras do Storage 1.1.3 teve SHA-256 verificado contra metadados do CLI: 0cd52db6f6271d62078f805220706377c849220b73bd68aa27078d977df9c900.

No Windows, launcher usa diretório local com caminho completo para sockets Java e não herda tokens/ADC de produção. O Storage CLI pode imprimir um aviso rotulado como erro ao receber a linha informativa Picked up JAVA_TOOL_OPTIONS da JVM; o runtime iniciou e os testes reais de Rules retornaram 403. Isso não autoriza ignorar outras falhas de inicialização.

Não houve pentest, certificação ASVS completa, certificados Auth produtivos, IAM real ou validação produtiva de índices. Zero advisories npm não significa ausência de vulnerabilidades do produto; a detecção de segredos é limitada a assinaturas locais. Contenção, custo dos 76 índices comerciais, carga para 100 usuários e memória de uploads não foram medidos em produção.

Retenção/limpeza de imagens, backups/restauração, MFA, TLS/ingress, IAM/segredos, observabilidade/SLOs, autoscaling e custos dependem de etapa aprovada. Busca é prefixada; POST de cliente sem documento não é idempotente; Storage/Firestore usam compensação, sem transação conjunta. Estoque, pedidos, financeiro, catálogo público e frontend não foram implementados nem testados. Consulte [riscos](security.md) e [Fase C](phase-c.md).
