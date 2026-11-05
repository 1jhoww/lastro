# Lastro Gestão: compras, custos e contas a pagar

O plano Gestão (referência R$ 299/mês, 5 usuários) soma ao Profissional quatro recursos: `purchasing.orders`, `costing.products`, `finance.payables` e `finance.management`. Como nos demais planos, nenhum código compara nomes de plano: as permissões novas só existem quando a assinatura inclui o recurso (`withinPlan`), e o backend responde `FEATURE_NOT_IN_PLAN` para o restante. No downgrade nada é apagado: compras, títulos e custos ficam gravados e voltam a aparecer se a empresa retornar ao plano.

## Cadastro único

Valores padrão de `relationships`, `isSupplier` e `contactName` não são gravados. O esquema os devolve na leitura, e um cliente comum continua no formato que a versão anterior da API lê. Assim a publicação não fecha sozinha o caminho de reversão: isso só acontece com o uso real de fornecedores, contato ou do plano Gestão, e `dist/src/jobs/gestaoRollbackCheck.js` diz se já aconteceu.

Fornecedor não é uma coleção nova. O documento de `customers` ganhou `relationships` (`customer`, `supplier`), `contactName` e a projeção `isSupplier`. Registros antigos não têm esses campos e são lidos como cliente, sem migração. A reserva de CPF/CNPJ continua única por empresa, então a mesma empresa nunca é cadastrada duas vezes: quem tenta recebe `DUPLICATE_DOCUMENT` e pode acrescentar o relacionamento ao registro existente. A lista padrão continua trazendo só clientes; como registros antigos não têm campo para consultar, fornecedores puros são filtrados em memória, em varredura limitada que preserva o cursor. Cadastro só de fornecedor não entra em pedido nem tem vendedor responsável, e um relacionamento com histórico (pedidos ou compras) não pode ser removido.

## Custos

Custos nunca ficam no documento do produto, que vendedores leem. Cada produto tem um `productCosts` com custo de referência, custo médio e último custo, e `productCostEvents` guarda o histórico.

- **Custo médio ponderado móvel**: a cada recebimento, `(saldo físico × médio + valor recebido) / (saldo físico + quantidade)`. Estoque sem custo conhecido não entra na conta: sem médio vale o custo de referência; sem nenhum dos dois, o custo recebido vira o médio. Quando o saldo é zero, o custo recebido também vira o médio.
- **Saídas não mudam o médio**: expedição, ajuste e devolução movimentam quantidade, não custo.
- **Entrada avulsa**: é valorizada pelo custo médio vigente, ou seja, não altera o médio, nem gera título. Bonificação não dilui o custo, de propósito: sem custo informado, qualquer valor seria inventado.
- **Custo de referência**: é manual. Um recebimento só o preenche quando está vazio. É o custo sugerido nas compras (sem ele, o último custo).
- **Preço de venda**: nunca muda por causa de custo.
- **Precisão**: custo unitário em milésimos de centavo, para a média não acumular arredondamento.

## Custo apropriado

O total da compra é `itens − descontos dos itens + frete + despesas − desconto da compra`. Na confirmação, frete, despesas e desconto são rateados pelo valor líquido de cada item, pelo método do maior resto. A soma dos valores apropriados é exatamente o total da compra, que é também a soma dos títulos. Por isso esses custos entram no estoque uma vez só e não devem ser lançados de novo como despesa.

Cada recebimento vale a diferença entre o valor acumulado arredondado e o que já entrou. Assim, recebimentos parciais somam exatamente o valor apropriado do item, em qualquer ordem.

## Vendas passadas

Ao confirmar um pedido, um plano com `costing.products` grava `orderCostSnapshots` com o custo de cada linha. Relatórios de margem usam esse registro e nunca o custo atual. Pedidos sem registro (feitos antes do plano) ou linhas sem custo ficam fora da margem e o relatório informa quanto ficou de fora. O custo é reconhecido na confirmação, a mesma data que define venda nos relatórios existentes.

## Compra e recebimento

Confirmar é compromisso comercial e financeiro: gera um título por parcela e não toca no estoque. Receber é a entrada física: cria movimentação `STOCK_PURCHASE_ENTRY`, atualiza saldos e custo, e deriva a situação da compra (`confirmed`, `partially_received`, `received`). Título e mercadoria são independentes: pagar não recebe, e receber não paga.

Os prazos vêm de `paymentConditions`, contados da data da compra. As parcelas podem ser ajustadas na confirmação, desde que somem o total.

Depois de confirmada, a compra só aceita correção de previsão e observações, com motivo. Para mudar valores, volta a rascunho, o que cancela os títulos abertos e incrementa `titleGeneration`, de modo que a nova confirmação gere títulos novos sem duplicar. Isso só é possível sem recebimentos nem pagamentos.

Cancelar uma compra com mercadoria recebida ou título pago é recusado (`PURCHASE_HAS_RECEIPTS`, `PURCHASE_HAS_PAYMENTS`). Primeiro se estorna, cada coisa com seu registro: o estorno de recebimento cria `STOCK_PURCHASE_REVERSAL`, recalcula o médio e é recusado se o estoque já estiver reservado ou expedido.

Recebimento acima do pendente é recusado (`RECEIPT_EXCEEDS_PENDING`). Não existe fluxo de recebimento a maior: a diferença vira uma nova compra.

## Encerramento de saldo pendente

Compra parcialmente recebida pode ter o saldo encerrado quando o fornecedor não vai entregar o restante. Vale só para `partially_received`: sem recebimento a saída é cancelar a compra. A entrada é uma decisão financeira explícita, e o estoque já recebido, o custo médio e os pagamentos não mudam em nenhuma delas.

O valor não entregue é o que cada item ainda traria para o estoque: `valor apropriado − valor recebido`. Inclui a parte de frete e descontos. Assim, valor recebido e valor não entregue somam exatamente o total da compra.

- **Abatimento**: o valor sai dos títulos em aberto, do último vencimento para o primeiro, sem passar de zero. O título guarda o valor em `canceledCents`; `originalCents` não muda. Título sem pagamento que zera fica cancelado; com pagamento, fica pago. O que os títulos não absorvem já foi pago e vira excesso, que precisa ser classificado como crédito ou valor a recuperar.
- **Cobrança integral**: nenhum título muda, e a obrigação com o fornecedor fica inteira. A classificação está em "Mercadorias cobradas e não entregues".
- **Crédito do fornecedor**: nenhum título muda e todo o valor vira crédito.

A compra guarda quantidades não entregues em `undeliveredQuantity`, e `purchaseClosures` guarda itens, títulos alterados, decisão e motivo. O total da compra e as parcelas originais ficam como foram negociados, e relatórios mostram o não entregue em coluna própria.

O id do encerramento vem da compra, então ele só pode existir uma vez. O comando exige a versão da compra e os valores mostrados na prévia: se um pagamento mudar os números no meio do caminho, é recusado (`CLOSURE_VALUES_CHANGED`).

**Não há desfazer.** Depois de encerrar, a compra não recebe mercadoria nem aceita estorno de recebimento (`PURCHASE_CLOSED`), porque os valores da decisão dependem do que estava recebido. Estornar um pagamento continua possível: o título volta a ter saldo e o crédito registrado não muda, de modo que o líquido entre os dois se mantém.

## Mercadorias cobradas e não entregues

Na cobrança integral a empresa deve por mercadoria que não recebeu. Esse valor não é custo das mercadorias vendidas: nada foi vendido, e somá-lo ao custo médio encareceria o estoque que chegou de verdade. Também não é despesa operacional, porque não vem de uma despesa lançada.

Fica como **perda com mercadorias não entregues**, linha própria do resultado estimado:

| Linha do resultado                   | Efeito                                            |
| ------------------------------------ | ------------------------------------------------- |
| Custo das mercadorias vendidas       | Não muda                                          |
| Lucro bruto e margem bruta           | Não mudam                                         |
| Despesas operacionais                | Não mudam                                         |
| Mercadorias cobradas e não entregues | Valor não entregue da compra encerrada            |
| Resultado estimado                   | Reduz pelo valor da linha acima                   |

O reconhecimento é na data do encerramento, quando a perda deixa de ser expectativa. O caixa é outra coisa: o dinheiro só sai quando os títulos são pagos, pelo fluxo normal de contas a pagar. Abatimento e crédito do fornecedor não geram essa linha, porque neles a empresa não fica com a perda. Se o fornecedor devolver depois, a devolução não existe nesse tratamento: quem espera receber de volta deve escolher crédito do fornecedor ao encerrar.

## Crédito de fornecedor

`supplierCredits` guarda o que o fornecedor deve de volta, com tipo `credit` ou `recoverable`. Os dois têm os mesmos movimentos em `supplierCreditMovements`:

- **Uso em título**: compensa título de compra do mesmo fornecedor, sem movimentar caixa. Só títulos de compra, para que crédito de mercadoria não vire redução de despesa operacional. Título quitado assim fica pago, com `paidCents` zero.
- **Devolução**: dinheiro de volta, com data. Entra no caixa realizado.
- **Estorno**: marca o movimento e devolve o saldo, sem apagar.

Compra com crédito usado em seus títulos não pode ser cancelada nem reaberta até o uso ser estornado (`PURCHASE_HAS_CREDITS`). Não há baixa por perda: crédito que nunca será recebido continua aberto.

## Contas a pagar

Títulos nascem de compra, despesa avulsa, recorrência ou lançamento manual. O valor original nunca muda depois de um pagamento: cada baixa é um registro próprio em `payablePayments`, com o valor abatido do título e, separados, juros, multa e desconto. O dinheiro que sai do caixa é a soma deles. Estorno marca o pagamento como estornado e devolve o saldo, sem apagar nada. Vencido é derivado da data e do saldo, nunca gravado.

Lançamento manual fica em contas a pagar e no fluxo de caixa, mas não conta como despesa operacional. Serve para o que não é custo da operação, como parcela de empréstimo.

Recorrências geram títulos até 35 dias antes do vencimento, por job diário, por um comando na tela e ao criar, alterar ou retomar a recorrência. O job isola falhas por empresa e por recorrência e aceita simulação. O id do título vem da recorrência e da data, então repetir não duplica. O dia inexistente no mês cai no último dia. O período de pausa não é cobrado depois, e a recuperação de atraso olha no máximo 60 dias para trás. Alterar a recorrência muda só títulos em aberto, sem pagamento e com vencimento futuro.

## Financeiro consolidado

- **Caixa**: só recebimentos, reembolsos, pagamentos e devoluções de fornecedor registrados. Título em aberto é previsão, e compensação com crédito não é caixa.
- **Saldo de caixa**: valor informado pela empresa numa data, mais o que se moveu desde então. Sem informação, o painel diz que não há saldo em vez de assumir zero.
- **Resultado estimado**: faturamento, menos custo das mercadorias vendidas, menos despesas operacionais por competência, menos mercadorias cobradas e não entregues. Compra de mercadoria não é despesa: seu custo chega ao resultado quando a mercadoria é vendida. Não é lucro líquido contábil, porque não considera tributos, depreciação nem devoluções.

## Índices

Listas só aceitam filtros que têm índice. Combinação sem índice é recusada pelo esquema, com 422, em vez de falhar no banco ou de gerar um índice para cada combinação possível. Cada índice custa escrita em todo documento da coleção.

## Permissões

Administradores têm tudo que o plano inclui. Vendedores só recebem por concessão explícita. `purchases.view` exige `costs.view`, porque uma compra mostra custos de aquisição. `suppliers.manage` não pode ser concedida a vendedores. `purchases.close` exige ver compras e contas a pagar, porque a decisão mexe em títulos. Relatórios financeiros valem para a empresa inteira, fora da carteira do vendedor, e exigem contas a pagar e custos.
