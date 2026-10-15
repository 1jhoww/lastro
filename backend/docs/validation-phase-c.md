# Validação local — Fases A, B e C

Execuções locais em 8 de outubro de 2026. Windows, Node.js 22.16.0, Java 21.0.7, TypeScript 5.9.3, Firebase CLI 15.33.0, Vitest/Supertest e os três emuladores. Somente dados sintéticos. Históricos: [Fase A](validation-phase-a.md) e [Fase B](validation-phase-b.md).

## Resultados

| Verificação                   | Resultado                                              |
| ----------------------------- | ------------------------------------------------------ |
| Testes unitários              | 57 aprovados, zero falhas                              |
| Testes com emuladores         | 95 aprovados, zero falhas                              |
| Total                         | **152 aprovados, zero falhas**                         |
| Regressão                     | Todos os 102 testes anteriores preservados e aprovados |
| Acréscimo da Fase C           | 50 testes                                              |
| TypeScript strict             | Aprovado, saída 0                                      |
| ESLint                        | Aprovado, saída 0                                      |
| Build                         | Aprovado, saída 0                                      |
| OpenAPI 3.1                   | Exportado com 43 operações reais                       |
| Tipos TypeScript              | Gerados com openapi-typescript                         |
| npm audit completo e runtime  | Zero vulnerabilidades conhecidas reportadas            |
| Verificação local de segredos | Zero ocorrências nas assinaturas verificadas           |

Nenhuma dependência nova nesta fase. JSONs locais em reports/unit-tests.raw.json, emulator-tests.raw.json, dependency-audit.raw.json e runtime-audit.raw.json, ignorados pelo Git. Logs brutos de emulação não devem ser publicados. Tempo de suíte e resultados em emuladores não medem SLO, capacidade de 100 usuários ou custo produtivo.

A última execução emulada completa levou 179,25 segundos. Ela inclui o teste de limite inclusivo UTC sem milissegundos, normalizado no backend. Os emuladores iniciados pela suíte foram encerrados ao terminar; nenhuma porta temporária ficou aberta após a entrega.

Prettier format:check também passou com saída 0 após a atualização da documentação.

## Processo compilado

dist/src/app/server.js foi iniciado em loopback e conectado aos emuladores demo-lastro-tests somente para verificações de leitura. GET health/live e health/ready: 200. Swagger /docs/: 200, HTML Swagger UI/CSP presentes, sem teste visual/interativo de navegador. /openapi.json: 200, OpenAPI 3.1.0 e 43 operações. GET inventory, inventory/movements e inventory/replenishment sem token: 401 com código seguro/requestId. O processo HTTP temporário foi encerrado após a verificação.

## Cobertura adicional executada

| Arquivo da Fase C                   | Testes |
| ----------------------------------- | ------ |
| tests/unit/inventory.test.ts        | 22     |
| tests/integration/inventory.test.ts | 13     |
| tests/security/inventory.test.ts    | 8      |
| tests/concurrency/inventory.test.ts | 7      |

- Quantidades inteiras para UN/CX/PCT; KG/L até milésimos exatos, sem soma monetária/ponto flutuante; rejeição de precisão, negativos, exponente, vírgula, tipo numérico JSON, zero de movimento e limite excedido. Transições puras de reservas/liberações/expedição/devolução exercitadas sem persistir pedidos ou reservas fictícias.
- Saldo inicial e leitura de produto legado sem campo de mínimo/estoque; entrada válida, replay com resposta original, payload divergente, ajuste positivo/negativo, versão desatualizada e estoque insuficiente.
- Unidade bloqueada após movimentos, inclusive ao voltar saldo a zero; unidade alterável antes de histórico sob regras do produto; concorrência entre primeira entrada/troca de unidade preservando coerência.
- Mínimo e reposição usam disponível, incluindo cenário físico 100/reservado 95/mínimo 10. O reservado foi fixture sintética de saldo, não operação comercial ou pedido persistido. Ajuste abaixo do reservado é rejeitado. Alteração de mínimo atualiza projeção; inativos preservam saldo/histórico e ficam fora da lista padrão.
- Histórico paginado por produto/tipo/período, normalização UTC inclusiva e indisponibilidade de edição comum. Reposição por prefixo/página/ordem e consulta explícita de inativos.
- Reconciliação paginada: sequência, aritmética, hash/cadeia, cabeça/contagem e saldos finais; detecção de histórico alterado, saldo divergente e duplicata na fronteira da página; cursor adulterado, outro produto ou versão alterada é rejeitado.
- Falha sintética lançada depois do staging de saldo/movimento/idempotência/auditoria: resposta sanitizada, nenhuma escrita parcial; retry da mesma chave executa uma única entrada após retirar a falha.
- Vendedor recebe só disponibilidade de ativos; não escreve estoque/mínimo nem lê histórico/reposição/reconciliação. Plataforma sem vínculo não recebe acesso comercial. BOLA/tenant manipulado/produto externo, mass assignment/saldo final/origem inventados, consultas abusivas, ausência de motivo/chave e empresa suspensa/cancelada são rejeitados, inclusive replay.
- Corridas: duas entradas somam sem perda; mesma chave/comando não duplica; chave divergente aceita uma; dois ajustes da mesma versão aceitam um; entrada/ajuste preservam saldo conforme ordem válida; empresas usam mesmo SKU/chave com saldos separados. As corridas anteriores de vagas/carteira/preço/upload continuam aprovadas.

## Reproduzir e interpretar

Siga [README](../README.md). npm test executa unidades. npm run test:integration inicia e encerra emuladores demo-lastro-tests; fixtures recusam projeto real/host remoto/bucket indevido. Pare emuladores de desenvolvimento antes. Typecheck, lint, format:check, build, openapi e types:api completam a verificação. Npm global quebrado nesta máquina: wrapper pwsh -File scripts/npm.ps1 run NOME, sem mudar instalação global.

Autenticação criptográfica produtiva, ASVS completo/pentest, IAM/TLS, Secret Manager/MFA, backups/restauração, carga para 100 usuários, custo, índices implantados, contenção real/autoscaling e SLOs não foram verificados/configurados em produção. Advisory npm zero não significa produto sem vulnerabilidades; scanner local de segredos tem cobertura limitada.

Movimentos/saldos são imutáveis/coerentes pela API nos cenários testados, mas credencial privilegiada pode alterar/reconstruir banco/hashes. Reconciliação detecta inconsistência e não repara. Retenção idempotente sem TTL exige planejamento; agregados por produto podem ter contenção/retries. A reconciliação de um produto em mudança contínua pode precisar de snapshot operacional futuro.

Não há implementação operacional de pedidos/reservas/expedição/liberação/devolução, financeiro, catálogo público ou frontend. Existem contratos e aritmética interna para futura Fase D. Nenhum recurso pago, banco produtivo, deploy, commit, push ou alteração na Atual Pet nesta entrega. Veja [riscos](security.md), [Fase C](phase-c.md) e [Fase D](phase-d.md).
