# Proposta: snapshots de pedidos além do documento agregado

**Pendente de aprovação; não implementada.** Não cria fila, serviço pago, confirmação parcial ou migração de banco na alternativa recomendada.

## Limitação

D mantém todas as linhas em orders/{id} e copia resultado completo em orderOperations/{hash}. Não haver teto comercial de linhas não elimina o limite técnico de 1 MiB por documento. Duzentas descrições ASCII de 2000 caracteres cabem no cenário testado; duzentas descrições de 2000 caracteres UTF-8 de três bytes excedem o limite. O tamanho depende do conteúdo, não de uma quantidade comercial fixa.

Pré-validação recusa integralmente documentos/resultados idempotentes excedentes, com 413 ORDER_TECHNICAL_LIMIT, antes de escritas. Commit de 10 MiB, prazo/retries e índices continuam sujeitos ao banco. Fórmula de armazenamento não mede protobuf ou entradas de índice. [Quotas oficiais](https://firebase.google.com/docs/firestore/quotas), [tamanho](https://firebase.google.com/docs/firestore/storage-size), [transações](https://firebase.google.com/docs/firestore/manage-data/transactions). O limite publicado de 500 é de transformações por documento, sem impor teto arbitrário geral de escritas. [Medições D](../validation.md).

## Alternativas

| Alternativa                               | Benefício                                              | Custo/risco                                                                |
| ----------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Agregado atual + recusa integral          | Contrato/atomicidade preservados, já implementado      | Conteúdo extenso pode não caber mesmo com 200 produtos                     |
| Linhas imutáveis por versão (recomendada) | Remove teto do documento agregado sem omitir snapshots | Mais leituras/escritas, publicação/paginação/replay e migração compatível  |
| Remover/truncar snapshots                 | Documento menor                                        | Viola preservação solicitada; não recomendado                              |
| Banco relacional                          | Outro modelo transacional                              | Mudança operacional/estrutural maior, não justificada pela evidência atual |
| Confirmação em lotes/saga                 | Contorna tamanho da transação                          | Muda atomicidade e requer compensação; não recomendado nem autorizado      |

## Desenho para aprovação

1. Cabeça do pedido conserva cliente/responsável/estado/versão/totais/aprovação/condição/parcelas e referência à versão de linhas. Subcoleção de linhas por versão contém posição/produto/snapshot integral. Versões referenciadas por confirmação/replay são imutáveis.
2. Rascunho grande exige publicar versão completa: preparar linhas privadas sem reserva/recebível, validar quantidade/hash/conclusão e publicar cabeça atomicamente. Não confirmar versão incompleta. Se preparação exigir lotes, aprovar recuperação/limpeza de preparação sem efeitos comerciais; faz parte desta mudança estrutural.
3. Confirmação lê cabeça/versão fechada, produtos/saldos/reservas/parcelas/guard/autorização; pedido, reservas, movimentos, recebíveis, guard, auditoria e idempotência continuam **no mesmo commit**. Excesso de 10 MiB/tempo é recusado integralmente; normalização não promete capacidade infinita.
4. Idempotência guarda cabeça/versão e referência às linhas imutáveis para reconstruir resposta original sob autorização atual. Paginar linhas de versão fixa com contagem/hash; definir compatibilidade com frontend que espera array completo. Nunca usar linhas atuais num replay antigo.
5. Leitura compatível D agregado/resultados antigos; migração com checkpoint/reconciliação somente em ambiente aprovado. Não alterar snapshots/eventos históricos sem prova. Fingerprint de desconto inclui versão/hash.
6. Revisar JSON 64 KiB por rota com carga paginada e orçamento técnico de bytes, sem novo teto comercial. Validar isenções/índices, custos e unicode/milhares de linhas compactas, falha de publicação e concorrência.

Antes de implementar: aprovar contrato de publicação/paginação, compatibilidade/replay, custo adicional e critério técnico de rejeição. Nesta entrega somente o agregado atual foi ajustado; nenhuma normalização/fila/lote de confirmação/infraestrutura foi criada.
