# Validação local — Fases A, B, C e D

Execuções em 8/10/2026, Windows, Node.js 22.16.0, Java 21.0.7, TypeScript 5.9.3, Firebase CLI 15.33.0, Vitest/Supertest. Auth/Firestore/Storage Emulator com demo-lastro-tests e dados sintéticos; nenhuma produção/recurso pago/deploy/commit/push/Atual Pet. Históricos: [A](validation-phase-a.md), [B](validation-phase-b.md), [C](validation-phase-c.md).

## Resultados finais

| Verificação                | Resultado                                                           |
| -------------------------- | ------------------------------------------------------------------- |
| Unitários                  | 82 aprovados, zero falhas                                           |
| Emuladores                 | 141 aprovados, zero falhas                                          |
| Total                      | **223 aprovados, zero falhas**                                      |
| Regressão A/B/C            | 152 casos anteriores mantidos e aprovados                           |
| Acréscimo D                | 71 casos: 25 unitários, 24 integração, 14 segurança, 8 concorrência |
| TypeScript strict          | Aprovado, saída 0                                                   |
| ESLint                     | Aprovado, saída 0                                                   |
| Build                      | Aprovado, saída 0                                                   |
| Prettier                   | Aprovado, saída 0                                                   |
| OpenAPI 3.1                | Exportado com 51 operações, versão 0.4.0                            |
| Tipos TypeScript           | Gerados com openapi-typescript                                      |
| npm audit completo/runtime | Zero vulnerabilidades conhecidas reportadas, saída 0                |
| Scanner local de segredos  | findings=[], saída 0                                                |

Última suíte emulada: 305,97 segundos, iniciada às 20:29:03. A primeira execução passou 218 casos; a final acrescentou matriz de transições, rollback de expedição/cancelamento, parcela divergente e corrupção persistida, fechando 223. Nenhum teste desabilitado/removido. Uma asserção antiga de inventário exigia ausência de /orders; foi atualizada para exigir as rotas agora reais e continuar negando login paralelo e pagamentos fictícios. Os demais casos anteriores permaneceram.

Nenhuma dependência ou override nova. Auditoria npm inicialmente não alcançou o endpoint no sandbox; reexecução com acesso ao registro público e cache no workspace terminou com saída 0 em completo/runtime. Relatórios ignorados em reports/unit-tests.raw.json, emulator-tests.raw.json, dependency-audit.raw.json e runtime-audit.raw.json. Zero advisories não equivale a pentest/ausência de vulnerabilidades desconhecidas; scanner por assinaturas tem cobertura limitada.

Storage runtime escreve em stderr “Picked up JAVA_TOOL_OPTIONS”, interpretado pelo CLI como “Unexpected rules runtime error”. A mensagem informativa Java já existia nas fases anteriores; os testes reais de Storage/upload/Rules continuaram aprovados, inclusive negação de leitura direta. Não foi usada para ignorar falhas.

## Evidências D

| Arquivo                          | Casos |
| -------------------------------- | ----- |
| tests/unit/orders.test.ts        | 25    |
| tests/integration/orders.test.ts | 24    |
| tests/security/orders.test.ts    | 14    |
| tests/concurrency/orders.test.ts | 8     |

- Criação/edição de rascunho, versão, identificador comercial único, linhas sem preço externo, snapshots e ausência de reservas/recebíveis antes de confirmar.
- Quantidades exatas KG/UN, BigInt antes de converter valores, half-up em meio centavo, limites, porcentagem em pontos base, desconto proporcional por maior resto/desempate, parcelas exatas 33334/33333/33333 e até doze.
- Calendário real, datas passadas/ordem/fuso na virada UTC, CPF/clientes/produtos/carteiras anteriores preservados.
- Confirmação atomicamente reserva/cria recebíveis; insuficiência em uma linha não reserva outras. Mudança de preço usa vigente sem desconto; inatividade/unidade incompatível bloqueiam.
- Desconto só administrativo; vendedor confirma aprovação intacta. Edição invalida, preço modificado exige reaprovação e aprovador inativo não autoriza. Payload discount/null/sellerUid/preço/tenant/status/saldo/origem rejeitado.
- Expedição integral por administrador ou vendedor autorizado; físico/reservado baixam juntos. Alterações posteriores de produto não alteram snapshot confirmado. Expedição duplicada/chave igual retorna resultado original.
- Cancelamento de draft sem estoque/recebíveis; confirmed libera só suas reservas, cancela recebíveis preservando valores originais. Expedidos/cancelados não transitam por fluxo simples. Matriz de transições inválidas e PATCH fora de draft rejeitados.
- Registros financeiros via fixtures SDK: payment, guard recebido, recebível parcialmente recebido, parcela ausente e tenant divergente bloqueiam cancelamento sem liberar estoque. Não há pagamento operacional ou endpoint financeiro.
- Falhas sintéticas lançadas por recordAudit depois de staging: confirmação, expedição e cancelamento sem qualquer escrita parcial; retry com mesma chave funciona após retirar falha.
- Reconciliação C verifica entrada/reserva/expedição/liberação numa cadeia íntegra; reserva adulterada com origem de outro pedido não expede/libera. Integridade de parcelas/recebíveis/IDs e soma verificada.
- BOLA/tenant externo/plataforma sem vínculo, pedido/carteira alheios, mass assignment/injeção e manipulação de consulta. Transferência retira acesso do antigo vendedor e não concede histórico ao novo.
- Suspensão e transferência injetadas após middleware e antes da leitura transacional são detectadas, sem reservas/recebíveis. Replay exige autorização atual. Corrupção de resultado idempotente/lista falha com 500 sanitizado, sem conteúdo privado.
- Corridas: duas confirmações pela última unidade têm um vencedor; mesma chave gera uma operação/reserva/recebível com duas respostas iguais; chaves diferentes para mesmo pedido têm um vencedor; expedição versus cancelamento, retry duplo de cada ação e edição versus confirmação preservam estado/saldo coerentes. Empresas reutilizam SKU/chave com estoques/recebíveis isolados.

## Limite local medido

Teste de dez produtos distintos, nomes com 160 caracteres, descrições 2000, notas 1000 e doze parcelas: confirmação passou em **234 ms** na última execução (primeira amostra 277 ms). Um pedido serializado em JSON: **28.522 bytes**. Os **44 documentos avaliados** (pedido, reservas, saldos, movimentos comerciais, parcelas e operação idempotente) somaram **87.099 bytes JSON**, excluindo guard/evento/auditoria, metadados protobuf e entradas de índice.

Análise do código: até 47 escritas de domínio e 64 leituras lógicas com desconto aprovado para dez linhas/doze parcelas. O teste não mede bytes reais de commit/índice/faturamento nem percentis sob carga. Tempo é uma amostra de confirmação, com preparação de fixtures fora do cronômetro. Cada produto continua agregado serializado; corridas locais exercitam somente os participantes dos testes, não cem usuários.

Limite 10 conservador com evidência local; não afirmar que 50 linhas são seguras. Índices D: 15 adicionados, 116 totais declarados, sem implantação. Validar índices, tamanho real, retries/contenção, latência e custo em ambiente aprovado antes de ampliar. [Limites oficiais Firestore](https://firebase.google.com/docs/firestore/quotas) e [transações](https://firebase.google.com/docs/firestore/manage-data/transactions).

## Processo compilado e reprodução

dist/src/app/server.js iniciou em loopback, development, demo-lastro-tests conectado aos emuladores da suíte. Verificações HTTP de leitura: health/live e ready 200; /docs/ 200 com HTML Swagger; /openapi.json 200, OpenAPI 3.1.0 e 51 operações; GET orders e orders/fake/history sem token 401 UNAUTHORIZED/requestId. Sem QA visual/interativo do navegador. API temporária encerrada após teste; emuladores da suíte encerrados ao completar. Encerramento da API no terminal Windows não concluiu por Ctrl+C; foi concluído somente para o processo identificado pelo PID/comando/data de criação. Nenhum processo alheio foi encerrado.

Execute na pasta backend: pwsh -File scripts/npm.ps1 run test; test:integration; typecheck; lint; format:check; build; openapi; types:api; audit:secrets. Npm global desta máquina está quebrado; wrapper usa CLI junto ao Node. Defina JAVA_HOME para JDK 21. Pare emuladores de desenvolvimento antes da integração; fixtures recusam projeto real/host remoto/bucket indevido. Para audit completo/runtime use npm audit --json / --omit=dev --json com cache local .cache/npm, sem audit fix automático.

Funcionalidades/rotas/arquivos/políticas em [Fase D](phase-d.md); modelo/permissões/contrato frontend atualizados, incluindo invalidate/reapprove do desconto e páginas vazias com cursor após transferência. [Fase E](phase-e.md) prepara financeiro sem o implementar.

## Limitações

Sem comprovação produtiva de criptografia Auth, ASVS completo/pentest, IAM/TLS/Secret Manager/MFA, backups/restauração, retenção externa, SLO/disponibilidade/custo/100 usuários/autoscaling/índices implantados. Conta de serviço comprometida pode reconstruir banco/auditoria/cadeias; reconciliação C detecta cenários conhecidos e não repara. Registros idempotentes sem TTL exigem política antes de limpeza.

Rascunho não idempotente pode duplicar após retry cego; listas podem ter páginas vazias por carteira atual, sem varredura para completar. Snapshots grandes aumentam custo/resposta; medir carga/memória. Pagamentos futuros devem atualizar guard por pedido no mesmo commit dos recebíveis para preservar a barreira de cancelamento. Sem pagamentos completos/devoluções/créditos/reembolsos/frontend/catálogo público. [Riscos](security.md).
