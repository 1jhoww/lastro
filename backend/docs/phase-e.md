# Fase E — Financeiro

Arquitetura geral aprovada pelo usuário, com nove decisões vinculantes nesta revisão. Implementação local concluída e validada em incrementos; sem deploy, commit, push, produção, Atual Pet ou integrações bancárias. Resultados de cada incremento e regressão completa de 364 testes estão registrados na validação E e no relatório de entrega.

Este registro preserva a entrega original da Fase E e as correções posteriores autorizadas. F01 corrigido e F02 RESOLVIDO no escopo local: executor, oito rotas opt-in, publicação única e recuperação validados, com 602 testes únicos aprovados. Cancelamento/devolução de 20.000 fontes diretas passaram; cargas reais de 10/100/500 recebimentos permanecem na regressão. [Projeto aprovado](proposals/financial-resumable-resolution.md), [validação final](validation-f02.md), [entrega](f02-delivery.md) e [contrato 0.8.0](api/financial-executions.md). As 20.000 chamadas HTTP reais e F03-F07 continuam pendentes de homologação/capacidade, sem aprovação produtiva.

## Decisões aprovadas

1. Data-base: confirmação do pedido, fuso IANA empresarial, dias corridos. Não deslocar vencimentos por fins de semana/feriados.
2. Rejeitar recebimento superior ao saldo devido. Sem opção de crédito por excedente; crédito somente com origem legítima comprovada, como cancelamento/devolução.
3. Cadastro de condições por empresa, presets e personalização de até doze parcelas. Padrão igual; pesos inteiros positivos validados e centavos distribuídos deterministicamente. Parcela zero é sem saldo, não dinheiro recebido.
4. Forma prevista no pedido independente da forma efetiva do recebimento. Seleção não liquida títulos.
5. Recebimento/aplicação por operação restritos a títulos de um único pedido. Não distribuir automaticamente entre pedidos.
6. Vendedor somente seleciona condições/formas previstas ativas autorizadas durante o pedido. Nenhum módulo financeiro, saldo, baixa, crédito, estorno ou relatório.
7. Cancelamento de confirmado não expedido escolhe crédito do cliente ou obrigação de devolução manual; auditoria e nenhuma transferência bancária automática.
8. Expedido exige devolução própria integral/parcial: intenção não altera estoque; confirmação física referencia expedição original e limita quantidade cumulativa por linha. Resultado financeiro é resolução separada.
9. Preservar recebíveis, snapshots e operações D históricos; leitura/migração compatíveis sem reescrita de registros antigos.

## Incrementos internos e validação

1. Cadastros/seletores, presets/preview, calendário/pesos e snapshots no pedido. Unitários, integração e isolamento antes de avançar.
2. Títulos/projeções compatíveis, recebimento parcial/integral, diário, guard/idempotência/auditoria, consulta/reconciliação.
3. Estornos, créditos com origem, aplicação/reversão, cancelamento financeiro/estoque num commit e confirmação manual de devolução.
4. Devolução de expedidos: [proposta revisada](proposals/dispatched-returns.md), regras refinadas e decisões respondidas pelo usuário. Fluxo completo em incremento próprio: recebimento físico parcial, danificado separado com aceite financeiro e bloqueio desde a intenção até encerramento/cancelamento do saldo e resolução do recebido.
5. Regressão A–D, inclusive 1/20/50/100/200 produtos; concorrência/falhas/segurança, TypeScript/lint/formatação/build/OpenAPI/tipos e dependências/segredos.

## Condições e formas

Condição: id/name/description/status/schedule/version/autores/datas. Schedule 1..12 elementos offsetDays inteiro não negativo/não decrescente e weight inteiro positivo seguro, padrão 1. Dias limitados pelo calendário representável, sem teto comercial artificial. Presets à vista [0], 30 dias [30], 30/60 [30,60], 30/60/90 [30,60,90]; personalizados até doze. Pesos usam BigInt, maior resto e desempate por posição; soma de parcelas igual ao total. Zero não gera recebimento.

Forma: id/name/kind/status/version/autores/datas; PIX, dinheiro, transferência, cartão, boleto ou outra. Sem dados de cartão/credenciais. Nomes reservados por tipo/empresa, edição versionada e desativação lógica. Histórico permanece.

Frontend tem seletor comercial de opções ativas, rótulo/resumo e preview calculado pelo servidor. Administração configura presets/prazos e pesos opcionais, com parcelas iguais por padrão. Forma prevista é opcional e separada; forma efetiva obrigatória no recebimento. Vendedor não recebe DTO financeiro.

Pedido E guarda condição/versão/prazos/pesos e forma prevista, sem confundir cash legado (uma parcela) com recebimento. Confirmação fixa data-base no fuso e recalcula calendário/valores; preview não reserva, cria títulos ou aprova desconto. Edição/versionamento de condição/forma exige revisão; aprovação do desconto inclui termos comerciais. Pedidos D mantêm calendário/snapshots legados, sem converter automaticamente datas antigas.

## Dados e compatibilidade

Todos os caminhos sob tenants/{tenantId}; API deriva contexto e autoria. Nenhum endpoint de saldo editável.

| Coleção                                                | Função                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| paymentConditions, paymentMethods, paymentSettingNames | Cadastro versionado, snapshots e unicidade por empresa                                                                             |
| receivables                                            | Registro original D de parcela, preservado na migração                                                                             |
| financialTitles                                        | Projeção derivada por ID D: cliente/order, original, aberto, caixa, crédito, cancelado, versão, hash da origem                     |
| payments                                               | Recebimento manual, forma efetiva e alocações de um pedido; original preservado                                                    |
| creditLots                                             | Crédito de cancelamento legítimo, cliente/origem/emitido/disponível/aplicado/versão                                                |
| creditApplications                                     | Alocação original e projeção reversível de uso de crédito                                                                          |
| refundObligations                                      | Obrigação manual original/saldo/devolvido/versão, sem transferência externa                                                        |
| financialOrderStates                                   | Projeção monetária/versão/cabeça de diário por pedido                                                                              |
| financialEvents                                        | Diário imutável compensador, antes/depois, fontes, sequência/hash/ator/motivo/requestId                                            |
| financialOperations                                    | Idempotência por tenant/chave/ator/comando e resultado pequeno original                                                            |
| returns, returnEvents                                  | Intenção versionada e eventos imutáveis antes/depois; correção/cancelamento só do saldo físico pendente                            |
| orderReturnLines                                       | Guarda cumulativa por linha: expedido, pretendido pendente, recebido por qualidade, resolvido e centavos; prova no evento imutável |
| returnReceipts                                         | Cada recebimento físico real, quantidades revendáveis/danificadas, movimento quando elegível, autoria e referência à expedição     |

Leitura de D deriva projeções ausentes sem reescrever recibo/ordem/operação histórica. Primeira mutação financeira materializa projeções na mesma transação do lançamento. Não supor fonte monetária de legado inconsistente: bloquear e exigir revisão formal. Guard D continua atualizado e com evidência histórica monotônica, mesmo após líquido zero, impedindo cancelamento simples contornar E.

## Invariantes

- Dinheiro em centavos inteiros, limites seguros e comandos de valor positivo. Preços/totais/saldos/permissões/tenant externos não são autoridade.
- Título: original = aberto + caixa liquidado + crédito liquidado + cancelado; componentes não negativos. Estado derivado; valor original não muda.
- Caixa recebido líquido = caixa aplicado no pedido + caixa transferido para obrigação/crédito legítimo. Crédito não dobra origem: emitido = disponível + aplicado.
- Recebimento é totalmente alocado a títulos do mesmo pedido/cliente e nunca excede saldo. Não há opção excessDestination nem sobra convertida em crédito.
- Estorno parcial/integral referencia lançamento/alocação original e respeita reversão cumulativa; histórico não é apagado. Em cancelado, não reabrir dívida nem inverter destino já utilizado por comando simples.
- Cancelamento encerra dívida, restaura créditos previamente aplicados às suas origens e destina somente caixa liquidado a novo crédito ou obrigação de devolução. Não creditar o valor total se só parte foi recebida.
- Confirmar devolução manual exige intenção administrativa, valor até obrigação remanescente, forma/data/referência/motivo e versões; não chama banco.
- Todos os efeitos monetários, guard, diário, auditoria e idempotência compartilham commit. Cancelamento não expedido também libera todas as reservas/movimentações D nesse commit.

Exemplo: pedido R$100, recebido R$60, aberto R$40. Cancelamento extingue R$100 de dívida e destina somente R$60 a crédito ou obrigação manual. Pedido liquidado em R$20 de crédito e R$40 de caixa restaura R$20 à fonte e destina R$40 conforme escolha. Parcela zero não exige nem aceita recebimento zero.

## Contratos

Base /api/v1; Bearer Firebase/tenant candidato, Zod strict, autorização atual dentro da transação e replay. UUID Idempotency-Key para mutações críticas, versões de pedido/guard/títulos/fontes. Contrato executável gerado no OpenAPI 0.5.1, com 91 operações reais nas Fases A–E; tipos TypeScript acompanham o contrato.

| Operação                                                                                   | Intenção                                                                                                    |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| payment-conditions / payment-methods GET/POST/GET id/PATCH id                              | Cadastro administrativo com presets, versão, unicidade e desativação                                        |
| orders/payment-options/... GET                                                             | Seletores comerciais ativos para pedido, sem financeiro                                                     |
| orders/{id}/payment-preview POST                                                           | Simulação da condição e forma prevista no pedido autorizado                                                 |
| orders POST/PATCH                                                                          | Selecionar condição/versão e forma prevista separadamente; compatibilidade D                                |
| receivables GET/GET id                                                                     | Títulos e componentes derivados/paginados, administrador                                                    |
| orders/{id}/financial-state GET                                                            | Versões atuais de pedido/guard e componentes dos títulos, administrador                                     |
| payments GET/GET id; orders/{id}/receipts POST                                             | Recebimento parcial/integral, alocações/valor/forma efetiva/data/versões                                    |
| payments/{id}/reversals POST                                                               | Estorno auditado, valor/referências/motivo/versões                                                          |
| customers/{id}/credits GET                                                                 | Créditos com origem, página administrativa                                                                  |
| orders/{id}/credit-applications POST; credit-applications/{id}/reversals POST              | Usar/reverter fonte de crédito em títulos do pedido                                                         |
| orders/{id}/financial-cancellation POST                                                    | Confirmado não expedido, disposition customer_credit ou refund                                              |
| refund-obligations GET; refund-obligations/{id}/confirm POST                               | Obrigação e confirmação manual, integral/parcial limitada                                                   |
| orders/{id}/financial-history / financial-reconciliation GET                               | Diário/reconciliação paginados e sem reparo automático                                                      |
| orders/{id}/returns POST; returns GET/GET id/PATCH id                                      | Intenção por expedição, consultas e correção versionada do saldo ainda não recebido                         |
| returns/{id}/cancel-pending POST                                                           | Cancela somente saldo físico pendente, mantendo recebido/histórico e resolução necessária                   |
| returns/{id}/receipts POST/GET; returns/{id}/history GET                                   | Recebimentos físicos parciais e prova auditável sem repetir movimento                                       |
| returns/{id}/resolve POST                                                                  | Abater dívida, restaurar fontes de crédito, destinar caixa liquidado e aceitar/rejeitar dano explicitamente |
| returns/{id}/resolution-preview GET                                                        | Versões atuais e limites monetários do recebido ainda não resolvido, sem efeitos                            |
| credit-applications GET/GET id; refund-obligations/{id} GET; refund-confirmations/{id} GET | Consultar fontes e comprovantes administrativos                                                             |

Recebimentos/aplicações só confirmed/dispatched e saldo positivo. receivedOn data real não futura no fuso; recordedAt UTC do servidor. Forma efetiva relida ativa; desativação preserva snapshot de operações históricas. Pagamento antecipado livre, crédito promocional, juros/multa/taxas/desconto financeiro, perda, gateway/fiscal/banco e transferência entre clientes ficam fora do escopo.

## Acesso e segurança

Administrador gerencia cadastros, títulos e operações financeiras. Estorno/cancelamento/devolução exigem permissão específica e autenticação recente. Vendedor recebe somente opções comerciais ativas e preview do pedido autorizado, sem financeiro. Super Admin sem vínculo não acessa comércio.

Tenant/cliente/pedido/título/forma/lote/origem são validados por caminho e conteúdo; schemas strict negam mass assignment, IDs externos, total/saldo/ator e opção de excedente. Replay confere autorização atual, ator e hash. TLS/tokens/assinatura/perfil continuam controles A–D. Logs sem payloads privados; Rules negam acesso direto.

## Transações, consultas e limites

Ler contexto/idempotência/pedido/guard/títulos/fontes/cadastros antes de escrever. Callbacks sem HTTP/Storage/email. Preparar todas as escritas, validar estados/versões/invariantes/bytes, depois apply. Documentos de diário separados; sem arrays históricos crescentes ou contador financeiro global por tenant.

Paginação padrão 25/máximo 100, cursores vinculados a ator/tenant/filtros/ordem/cabeça para reconciliação. Sem total por varredura nem reparo silencioso. Consultas legadas podem conferir filtros derivados por candidato e retornar página vazia com cursor; custo/índices e eventual projeção completa exigem medição. Índices locais declarados, nunca implantados nesta fase.

Correção pós-auditoria F01: reconciliação financeira usa checkpoint assinado v1 com falha acumulada, quantidade realmente examinada, posição, hashes e versão/cabeça financeira. Não incorpora snapshots nem referências ilimitadas no cursor. Revalida a âncora anterior, detecta lacunas/duplicatas e confere contagem/cabeça/snapshot finais. `409 CONFLICT` exige reinício após mudança financeira. Cursores antigos válidos do escopo atual retornam `409 FINANCIAL_RECONCILIATION_RESTART_REQUIRED`; inválidos, outros escopos ou cabeças antigas retornam `422 VALIDATION_ERROR`. Histórico permanece compatível. Detalhes e limites da garantia constam no contrato do frontend.

F02 implementado e validado localmente conforme [proposta aprovada](proposals/financial-resumable-resolution.md). O executor usa fontes ativas certificadas, provas fragmentadas, lotes idempotentes e publicação única. O caminho atômico continua compatível para históricos pequenos; mais de 100 pagamentos/aplicações exige `409 FINANCIAL_RESUMABLE_REQUIRED`, sem novo teto comercial. Leitores mantêm valores anteriores até publicação; PDF/CSV relacionados recusam execução ativa. A [validação F02](validation-f02.md) comprova completabilidade estrutural de 20.000 fontes; não aprova desempenho, custo ou implantação reais.

Limites reais Firestore/HTTP e riscos D permanecem: 1 MiB/documento, 10 MiB/requisição, tempo/retries/contenção. Recusa integral, sem lote de confirmação, fila, serviço novo ou mudança de banco. [Snapshots grandes](proposals/large-order-snapshots.md) continuam proposta separada sem aprovação de implementação. Emulação não comprova SLO/100 usuários/custo/backups produtivos.

## Devoluções implementadas

Preço e desconto vêm exclusivamente da linha confirmada. O limite nominal acumulado é half-up(total original × quantidade elegível resolvida / expedida); cada operação registra só a diferença. Quantidade elegível inclui revendável resolvido e danificado aceito administrativamente; danificado rejeitado não abate dívida. A soma recebida, incluindo danificados rejeitados, sempre consome o limite físico expedido. Intenções simultâneas também reservam esse limite: pendente + recebido não pode exceder expedido.

Estado pending/partially_received/received/closed é derivado. Fechar exige nenhum saldo físico e nenhum recebido sem decisão financeira. Cancelar saldo restante nunca apaga recebimentos. Várias intenções por pedido mantêm activeReturnCount; baixar somente uma não libera outra. Bloqueio começa na intenção e termina ao fechar todas. Consultas seguem; outro pedido do cliente pode receber. Confirmação manual de obrigação já constituída segue permitida porque não altera dívida nem cria nova destinação.

Recebimento físico mistura quantidades revendáveis e danificadas na mesma confirmação; somente revendável gera STOCK_RETURN. Danificados ficam em registro separado de recebimento e guard, fora do saldo disponível, sem depósito/quarentena ou destinação física automática. Resolução exige accept true/false por linha danificada ainda não resolvida, motivo e administrador. Decisão abrange todo dano não resolvido daquela linha; novos recebimentos podem ter decisões posteriores independentes.

Aceite permite acceptedCents inteiro entre zero e o limite cumulativo do dano recebido. Omitir acceptedCents com accept=true mantém aceite integral compatível; accept=false permite somente omissão ou zero. O backend calcula primeiro o delta revendável, depois o delta nominal do dano aceito, sem arredondar fragmentos isoladamente. A diferença entre limite do dano e valor aceito acumula em damagedValueReductionCents, nas linhas da intenção e no guard por linha do pedido. Valor resolvido acumulado = limite nominal acumulado − redução acumulada; devoluções posteriores nunca recuperam redução já decidida. Campo ausente em histórico vale zero sem alterar documentos ou hashes existentes. Aceite zero também consome a quantidade física e encerra sua avaliação.

GET returns/{id}/resolution-preview fornece expectedOrderVersion, expectedGuardVersion, expectedVersion e, por linha, quantidades não resolvidas, sellableCents e damagedLimitCents. É consulta administrativa sem efeitos; concorrência pode invalidar versões e limites antes do POST. Resolução relê tudo no mesmo commit. Exemplo: dez unidades/R$10, quatro danificadas, aceite R$1,50: redução R$2,50; retorno posterior das seis revendáveis abate R$6,00, total resolvido R$7,50. Não criar crédito pela diferença rejeitada.

Abatimento segue vencimento/número das parcelas abertas, depois aplicações de crédito por criação/ID e fonte original, depois caixa liquidado. Alocações reversíveis de pagamentos diminuem na transferência, com transferredCents, sem mudar amountCents original. Crédito restaurado usa restoredByCancellationCents também para abatimento por devolução; campo é acumulado de restaurações compensadoras, não estorno de dinheiro. Histórico antes/depois diferencia o motivo. Caixa gera lote legítimo ou obrigação pendente; confirmação manual é outra operação.

Correção de físico ou resolução já concluídos, reclassificação de dano para revendável, disposição do material danificado, estorno de obrigação já confirmada e alteração de destino já consumido exigem contratos compensadores próprios, fora desta fase. API recusa esses atalhos. Não há conflito pendente para o fluxo aprovado; expansões dependem de aprovação específica.

## Critérios de teste

Preservar regressão A–D. Testar cadastros isolados, nomes concorrentes, desativação/versão, opções somente comerciais do vendedor; data-base/fuso/virada de mês/ano e fins de semana sem deslocamento; pesos/doze parcelas/centavo/zero. Recebimento parcial/integral/excesso/duplicata, estorno parcial repetido, crédito concorrente/origem, cancelamento pago com devolução/crédito/restauração de fontes e confirmação manual duplicada.

Falhas após staging não podem deixar efeitos; receber versus cancelar/expedir, troca de perfil/assinatura antes do commit, BOLA/cursor/manipulação e replay revogado. Reconciliação de dinheiro/estoque e cancelamento com 200 produtos. OpenAPI/tipos/TypeScript/lint/formatação/build/dependências/segredos. Riscos residuais e aprovações pendentes documentados, sem afirmar invulnerabilidade.
