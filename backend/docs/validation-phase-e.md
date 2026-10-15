# Validação local — Fase E

Execuções em 8–9/10/2026, Windows, Node.js 22.16.0, Java 21.0.7, TypeScript 5.9.3, Firebase CLI 15.33.0 e Vitest 5.0.3. Auth/Firestore/Storage Emulator, demo-lastro-tests, dados sintéticos. Sem deploy, commit, push, produção, dependência nova, integração bancária, serviço pago ou alteração da Atual Pet.

## Resultado

**364 testes aprovados, zero falhas, nenhum removido/desabilitado:** 132 unitários em nove arquivos e 232 emulados em dezenove arquivos. Regressão integral iniciada em 9/10 às 16:23:05 (America/Sao_Paulo), duração 687,37 segundos, saída zero e todos os emuladores de teste encerrados. São os 223 anteriores, mais 32 da revisão D e 109 de E. Os 339 da validação anterior foram preservados; esta conclusão acrescenta nove unitários e dezesseis emulados.

TypeScript strict, ESLint, build e Prettier aprovados. OpenAPI 3.1, versão 0.5.1, 91 operações reais; tipos regenerados e contrato inspecionado para preview e acceptedCents. npm audit completo/runtime: zero advisories conhecidos; scanner local de segredos findings=[]. Esses controles não equivalem a pentest ou ASVS completo. [Relatório de entrega](phase-e-delivery.md) reúne os oito itens solicitados e o contrato para Claude.

Históricos [D — revisão de 255](validation-phase-d-revision.md), [D anterior — 223](validation-phase-d.md), [C](validation-phase-c.md), [B](validation-phase-b.md) e [A](validation-phase-a.md) preservados. Asserção de inventário de API passou a exigir pagamentos reais E; nenhum teste anterior removido/desabilitado. Relatórios brutos em reports/ são ignorados.

## Incrementos validados

Conclusão local do aceite monetário de dano em 9/10/2026: nove testes unitários e dezesseis emulados adicionais, preservando todos os anteriores. Incrementos revalidados antes da regressão completa: 39 testes financeiros em quatro arquivos (137,53 s) e 34 de devoluções (195,90 s), sem falhas. Aceite integral compatível, parcial e zero; preview administrativo de limites sem efeitos; excesso, fração monetária e decisão contraditória recusados; redução histórica ausente não recebe default que modifique prova imutável.

Concorrência adicional: crédito versus estorno, intenção versus recebimento/estorno/aplicação, receber versus cancelar saldo físico e resolução duplicada de dano pago. Uma versão tem um vencedor; mesma chave tem um efeito. Duas intenções abertas conservam bloqueio ao encerrar somente uma. Falha após staging de aceite parcial conserva fontes, títulos, redução e bloqueio; retry original recupera. Retornos posteriores não recuperam redução anterior, incluindo fracionários com deltas nominais 1/0/1. Abatimento parcial pago respeita dívida, fontes de crédito e somente depois caixa.

- E1: cadastros empresariais de condições/formas, nomes únicos concorrentes, presets/customização/pesos/doze parcelas, opções comerciais do vendedor, preview sem efeito e snapshots/calendário no pedido. Fuso IANA configurável; data-base da confirmação, dias corridos e fins de semana sem deslocamento. Cadastros desativados/versionados exigem revisão; desconto continua vinculado aos termos comerciais.
- E2: leitura D sem reescrita, materialização transacional de projeções no primeiro lançamento, recebimentos parciais/integral, forma efetiva separada da prevista, soma/alocação de um pedido e rejeição de excedente/zero. Diário antes/depois, guard e resultado idempotente pequeno compartilham commit. Parcela zero não cria pagamento fictício.
- E3: estornos parciais limitados às fontes; créditos legítimos, aplicação/restauração/reversão; cancelamento não expedido com liberação atômica de reservas, dívida extinta, origem de crédito restaurada e somente caixa liquidado destinado a crédito/obrigação. Restituição manual parcial/integral preserva prova real e não chama banco.
- E4: intenção sem estoque, correção/cancelamento só do saldo pendente, recebimentos físicos parciais imutáveis, guard por linha, qualidade revendável/danificada, resolução administrativa separada e cumulative half-up em centavos. Danificado fica fora do disponível e exige aceite/rejeição explícitos. Bloqueio por pedido desde intenção até encerramento físico e resolução; outros pedidos do cliente seguem.
- Segurança: vendedor sem saldos/baixas/fontes/relatórios, tenant estrangeiro rejeitado, contexto relido após middleware, replay revogado, reautenticação sensível, forma desativada, origem desconhecida/corrompida e projeção adulterada falham fechadas. Falha sintética inicialmente mostrou erro 422 em divergência interna; corrigido para 409 FINANCIAL_INTEGRITY e validado na regressão.

## Integridade e concorrência

Mesma chave concorrente de recebimento/retorno produz resultado original e um efeito. Versões concorrentes, fonte de crédito disputada por pedidos diferentes e pedido recebido versus cancelado têm somente um vencedor. Intenções concorrentes não prometem quantidades expedidas já comprometidas. Guard financeiro, títulos, fontes, diário, auditoria e idempotência não ficam parciais.

Falhas após staging exercitam recebimento, cancelamento com dinheiro, físico e resolução; nenhum pagamento/lote/obrigação/guard/recibo/movimento parcial. Retry da mesma intenção funciona. Caixa transferido deixa de ser reversível na alocação original, sem apagar amountCents. Crédito restaurado à fonte não desfaz consumo daquela fonte em outro pedido.

Intenção dez, recebido seis, resolvido seis, restante quatro: conserva pendência e bloqueio. Cancelamento auditado das quatro encerra, preservando seis/recibo/autoria/histórico. Retorno fracionário de linha KG com dois centavos gera deltas 1/0/1; soma exata, sem liquidação fictícia. Preço atual alterado não muda devolução histórica. Dano rejeitado não abate dívida; aceito abate sem aumentar disponível.

Pedido de 200 produtos com desconto original e doze parcelas: cancelamento financeiro pago libera todas as reservas, preserva originais D e replay antigo. Retorno físico integral de 200 e resolução preservam snapshots/expedição/reserva consumida e recebíveis D. Reconciliação verifica todos os produtos e diário monetário.

## Capacidade medida

Uma linha/uma unidade/R$0,01 e R$5,00 continuam válidos; 0.001 KG positivo também. Nenhum pedido mínimo/teto comercial de produtos foi reintroduzido. Confirmação, replay, expedição, cancelamento e reconciliação exercitados em 20/50/100/200; descrições 2000 ASCII, nomes 160, notas 1000, desconto 12,5% e doze parcelas.

| Produtos | Confirmar ms | Replay ms | Expedir ms | Cancelar D ms | Pedido bytes | Operação D bytes |
| -------- | ------------ | --------- | ---------- | ------------- | ------------ | ---------------- |
| 20       | 318          | 167       | 217        | 246           | 53918        | 54227            |
| 50       | 331          | 126       | 245        | 296           | 127358       | 127667           |
| 100      | 465          | 165       | 331        | 377           | 249758       | 250067           |
| 200      | 651          | 165       | 511        | 530           | 494558       | 494867           |

Amostras E com 200 na regressão final: cancelamento financeiro pago **734 ms**; recebimento físico de retorno **1946 ms**; resolução financeira **1830 ms**. Tempos E incluem consultas de versões dos helpers; preparo de fixtures fica fora. Não são p95/p99, SLO, teste de cem usuários ou capacidade produtiva. Guard por linha acrescenta leituras/escritas; provas de eventos e cabeçalhos são reutilizadas dentro da transação, sem cache de autorização.

Corrida de 200 produtos na regressão final: 4928 ms, respostas 200/409, um commit integral. Repetição concorrente da mesma confirmação: 3702 ms, 200/200, um efeito. Na validação anterior, o emulador manteve locks após rollback, exigindo vinte retries somente na limpeza entre fixtures (~60 s); callbacks de domínio não foram retentados por teste para ocultar falhas. hookTimeout=120 s cobre limpeza. Startup JAVA_TOOL_OPTIONS gera aviso informativo no runner de Rules; não causou falha.

## Limites e decisões pendentes

HTTP JSON 64 KiB e pré-validação UTF-8 de documentos 1 MiB permanecem, sem teto por quantidade de linhas. D usa resultado idempotente completo; 200 descrições multibyte extensas excedem documento e são recusadas integralmente. [Normalizar snapshots](proposals/large-order-snapshots.md) segue proposta sem aprovação. Centavos até 100.000.000 e quantidades até 1.000.000.000.000 milésimos são limites numéricos preexistentes.

Firestore também limita [requisição/tempo/índices](https://firebase.google.com/docs/firestore/quotas): 10 MiB por requisição, 270 segundos por transação, 60 ociosos e 500 transformações por documento. Não interpretar 500 transformações como limite geral de escritas. Pré-validação de tamanho do documento não mede protobuf/entradas de índice. Muitos recebimentos/fontes num pedido podem atingir bytes/tempo/contenção; cancelamento/retorno percorrem somente fontes daquele pedido em páginas de 100 dentro do mesmo commit. Falha técnica é integral, sem fila ou confirmação repartida.

scripts/finance-indexes.mjs acrescentou nove índices E, total 125, com isenções de arrays/snapshots/guards/alocações; somente declaração local. [Emulador não comprova índices compostos ou todos os limites produtivos](https://firebase.google.com/docs/emulator-suite/connect_firestore). SLOs, cem usuários, custo para 10/50/100 empresas, backups produtivos, IAM/TLS/retencão/App Check/Armor e recuperação real continuam dependentes de autorização e medição próprias.

Não há conflito pendente para o fluxo de retorno aprovado. Correção compensadora de físico/resolução concluídos, reclassificação/descarte de danificado, estorno de restituição confirmada e troca de destino já consumido precisam de contratos próprios. Sem atalhos inseguros. Relatório contábil global/fechamento/gateway/banco/fiscal/cobrança/juros/taxas estão fora desta fase.

## Arquivos

Novos: src/shared/schemas/{paymentSettings,finance,returns}.ts; src/app/{paymentSettingsRoutes,financeRoutes,returnRoutes}.ts; src/modules/finance/{paymentCalculation,paymentSettingsService,financialCommands,financialBook,financialReads,financialService}.ts; src/modules/returns/{calculation,returnService}.ts; src/modules/inventory/returnStockAdapter.ts; scripts/finance-indexes.mjs.

Testes novos: tests/helpers/finance.ts; tests/unit/{paymentSettings,finance,returns}.test.ts; tests/integration/{paymentSettings,financeReceipts,financeSettlement,returns}.test.ts; tests/security/finance.test.ts.

Alterados: src/app/{app,routes}.ts; src/modules/orders/orderService.ts; src/modules/users/{permissions,userService}.ts; src/modules/auth/openapi.ts; src/infrastructure/repositories/commercialRepository.ts; src/shared/schemas/{models,http,orders}.ts; tests/unit/policy.test.ts; scripts/emulators.mjs; firestore.indexes.json.

Documentação: docs/phase-e.md; docs/proposals/dispatched-returns.md; docs/adr/0008-projecoes-financeiras-compativeis.md; docs/{validation,validation-phase-e,validation-phase-d-revision,phase-d,security}.md; docs/architecture/{foundation,data-model,permissions}.md; docs/api/{frontend-contract.md,openapi.json,generated-types.ts}; README raiz/backend e CONTEXT.md raiz. Package/lockfile/Rules/configuração Firebase não alterados nesta fase.

## Reprodução e ambiente

Na pasta backend, com Java 21 em JAVA_HOME: pwsh -File scripts/npm.ps1 run test; test:integration; typecheck; lint; format:check; build; openapi; types:api; audit:secrets. Npm global está quebrado; wrapper usa npm-cli junto ao Node. Auditoria pública executada pelo mesmo CLI, cache local e sem audit fix/instalação.

Na conclusão, o sandbox Windows causou ENOENT no cache SSR temporário do Vitest e timeout da porta local 4400. Unitários passaram após configurar TEMP/TMP para backend/.local. Emulação passou com execução dos processos fora do sandbox, exclusivamente em demo-lastro-tests e hosts 127.0.0.1; não houve mudança de assertion, filtro de falha ou timeout para obter aprovação. Auditoria npm precisou de acesso ao registry público; nenhuma instalação ou alteração de dependência. Esses problemas de ambiente não foram registrados como testes de negócio aprovados.

scripts/emulators.mjs test admite opcionalmente caminhos estritos tests/integration|security|concurrency/_.test.ts para incrementos; sem filtro executa toda regressão. Suite recusa projeto real/host remoto e usa um worker. Fixtures de capacidade elevam somente limite local de requisições, não configuração produtiva. Relatórios unit-tests.raw.json, emulator-tests.raw.json e order-capacity.raw.json contêm evidência final; relatórios phase-e_-tests.raw.json preservam incrementos e tentativa anterior, inclusive a falha corrigida.

Na validação anterior de 339 testes, dados de desenvolvimento Auth/Firestore/Storage foram exportados para .local/pre-phase-e-validation antes de parar somente emuladores identificados. Emuladores demo-lastro-phase-a foram restaurados por importação do snapshot, sem seed destrutivo; CLI confirmou All emulators ready. A API existente então retornou 0.5.0/90 operações e /health/ready ok. Exportação local continha três usuários Auth; conferência de importação usou SDK oficial apontado somente a 127.0.0.1. Na conclusão atual, apenas emuladores de teste demo-lastro-tests foram iniciados/encerrados; contrato 0.5.1/91 foi gerado e exercitado via createApp/Supertest. Snapshot/logs são ignorados; isto não equivale a backup produtivo.
