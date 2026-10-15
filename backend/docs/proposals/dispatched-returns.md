# Proposta revisada: devoluções de pedidos expedidos

**Regras revisadas, decisões respondidas pelo usuário e implementação local autorizada em incremento próprio.** Arquitetura geral E e fluxo ajustado seguem autorização local, sem deploy, commit, push, produção ou banco externo.

## Regras vinculantes

- Snapshot da linha confirmada, preço efetivo e desconto original. Novos preços do produto não alteram valor devolvido.
- Devoluções parciais em momentos diferentes. Quantidade cumulativa recebida <= expedida; valor cumulativo resolvido <= total confirmado da linha. Quantidades inteiras escaladas e centavos inteiros.
- Limite nominal cumulativo da linha = half-up(totalCents confirmado × quantidade cumulativa elegível resolvida / quantidade expedida). Cada resolução usa diferença ainda não resolvida, não arredonda cada fragmento isoladamente. Aceite monetário parcial de dano reduz esse limite por damagedValueReductionCents acumulado. Integral física devolve o total original somente quando não há dano rejeitado ou redução administrativa. Retorno de valor zero não cria pagamento/crédito fictício.
- Abater primeiro parcelas em aberto (vencimento/número determinísticos), depois fontes efetivamente liquidadas. Crédito aplicado retorna à origem correspondente, até valor reversível daquela aplicação; uso da mesma origem em outro pedido não é estornado.
- Caixa liquidado (dinheiro/PIX/boleto/cartão/transferência) pode originar crédito ou obrigação de devolução por escolha administrativa. Sem exceder liquidado nem declarar dinheiro devolvido antes de confirmação efetiva.
- Bloqueio por pedido impede baixas/estornos/consumo de crédito/cancelamento financeiro conflitantes enquanto houver resolução pendente. Leitura/histórico seguem. Outro pedido do mesmo cliente não fica globalmente bloqueado; só há concorrência legítima se disputar mesma fonte de crédito.
- Intenção não altera estoque. Recebimento físico aceita só quantidade realmente recebida; intenção 10, recebimento 6: movimentar apenas 6 elegíveis, manter 4 pendentes.
- Cada recebimento tem versão/UUID idempotente, linhas/quantidades/qualidade, ator/data/motivo/referência à expedição e evento imutável. Recebimentos posteriores do saldo usam a mesma intenção e nova chave operacional, sem duplicar os anteriores.
- Produto danificado/não revendável não entra automaticamente em estoque disponível. Estoque atual não tem agregado de quarentena; destinação precisa da decisão abaixo.
- Alteração/cancelamento auditados somente da parte ainda não recebida. Não apagar/reabrir eventos físicos/financeiros concluídos. Correção de erro já concluído exige operação compensadora própria, sem reutilizar cancelamento de intenção.

## Agregados e contratos implementados

returns/{id} guarda pedido/dispatchReference, cliente, quantidades pretendidas/recebidas por linha, pending/partially_received/received/closed, versão, autores/datas/motivo. orderReturnLines por linha guardam expedido/recebido/valor resolvido e serializam disputa. returnReceipts imutáveis guardam cada confirmação física real, quantidade/revendabilidade/ator/data/operação. Guard E serializa efeitos financeiros por pedido.

POST orders/{id}/returns cria intenção. PATCH returns/{id} corrige parte pendente com versão/motivo; POST returns/{id}/cancel-pending cancela somente saldo não recebido, com idempotência/auditoria. Nenhuma dessas ações inventa retorno físico.

POST returns/{id}/receipts aceita subconjunto de linhas/quantidades realmente recebidas e avaliação de revenda. Transação relê autorização/expedição/retorno/guard/estoque, valida cumulação e cria eventos/movimentos/guard/recebimento/auditoria/idempotência juntos. Parte recebida pode ser resolvida financeiramente enquanto o restante físico segue pendente, conforme decisão de bloqueio abaixo.

POST returns/{id}/resolve resolve somente diferença física recebida e ainda não resolvida, com versões/UUID/motivo/destino do caixa. Mesmo commit aplica abatimentos de títulos, restauração de créditos por origem, crédito novo ou obrigação manual legítimos, guard/diário/auditoria/idempotência. Não alterar snapshot confirmado/expedição/reserva consumida.

damagedDecisions aceita {lineId,accept,acceptedCents?}. Administrador pode aceitar valor integral, parcial ou zero por linha danificada ainda não resolvida. Ausência do valor mantém comportamento integral de accept=true; rejeição não admite valor positivo. GET returns/{id}/resolution-preview calcula limites e versões no backend. Delta revendável vem antes do delta do dano no arredondamento cumulativo; redução já decidida não retorna em recebimentos futuros. Campos novos são opcionais nos documentos históricos, sem defaults que mudem provas imutáveis.

Títulos D permanecem originais; projeções E acumulam abatimentos rastreáveis. Pedido mantém dispatched, e resumo de devolução é recurso próprio. Resultado original idempotente referencia recebimento/resolução imutáveis, nunca estado atual.

## Decisões finais recebidas

1. **Produtos não revendáveis:** registrar quantidade recebida separadamente do estoque vendável; aceite financeiro administrativo obrigatório. Sem movimentação de estoque disponível. Aceite/rejeição explícitos com motivo/autoria; sem crédito/devolução fictícios ou aceitação automática.
2. **Bloqueio:** desde a intenção até encerramento físico ou cancelamento do saldo pendente, mantendo bloqueio enquanto houver recebimento sem resolução financeira. Intenção 10/recebido 6/resolvido 6/restante 4 continua bloqueada; cancelar auditadamente as 4 permite encerrar, sem apagar as 6. Somente o pedido afetado fica bloqueado.

## Validação obrigatória

Recebimento 6 de 10/restante 4, múltiplas resoluções, quantidade/valor cumulativos, pesos/descontos/precisão/arredondamento, danificado, duas devoluções pela última quantidade, mesma chave, falha após staging, cancelar/corrigir parte pendente e negação de cancelar histórico concluído. Receber/resolver versus baixa/estorno/uso de crédito, origem já usada em outro pedido e indisponibilidade de contexto atual. Reconciliação financeira/estoque e 200 linhas/bytes/locks. Sem confirmação repartida, fila, integração bancária ou estoque fictício.

Quantidade elegível inclui revendável resolvido e dano aceito explicitamente. Rejeição administrativa encerra a avaliação financeira daquele dano, sem abatimento e sem aumentar disponível. O guard mantém prova no evento imutável. Alocações de caixa transferidas deixam de ser reversíveis no recebimento original, sem apagar seu valor histórico.
