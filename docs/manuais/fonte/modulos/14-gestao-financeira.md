---
mes: novembro de 2026
slug: gestao-financeira
modulo: Painel de gestão
titulo: Painel de gestão e relatórios
subtitulo: Saldo de caixa, previsão, resultado estimado e relatórios financeiros.
publico: Administrador, Vendedor (se liberado), Se contratado
resumo: O Painel de gestão junta o que entrou, o que saiu e o que está previsto, a partir dos registros da própria empresa. Título em aberto é sempre previsão, nunca caixa. O resultado mostrado é gerencial e ajuda a acompanhar o negócio, sem substituir a contabilidade.
administrador: Consulta o painel, informa o saldo de caixa e usa os relatórios financeiros.
vendedor: Só acessa se o administrador liberar. Os relatórios financeiros valem para a empresa inteira, fora da carteira do vendedor.
---

## Abrir o painel

1. No menu lateral, clique em [[Financeiro]].
2. Escolha [[Painel de gestão]].
3. Escolha o período: [[Este mês]], [[Mês passado]] ou [[Últimos 90 dias]].

![Painel de gestão.](admin-gestao-painel-1440.png "sem-menu larga h=150")

Clique em um quadro para abrir a lista que deu origem ao número. Disponível quando o contrato da empresa inclui esse recurso.

## Informar o saldo de caixa

O Lastro não adivinha quanto há no banco. Sem essa informação, o painel diz que não há saldo em vez de assumir zero.

1. No quadro **Saldo de caixa**, clique em [[Atualizar saldo]].
2. Informe o valor e a data a que ele se refere.
3. Salve. A partir daí, o saldo soma o que entrou e tira o que saiu desde essa data.

:::dica Confira de vez em quando
Compare com o extrato. Se houver movimentos fora do Lastro, como tarifas, atualize o saldo com o valor real.
:::

## O que cada número significa

| Número | De onde vem |
|---|---|
| **Saldo de caixa** | Saldo informado, mais entradas e saídas registradas desde a data. |
| **Total a pagar** | Saldo dos títulos em aberto. |
| **Total a receber** | Saldo das parcelas de clientes em aberto. |
| **Contas vencidas** | Títulos a pagar vencidos. |
| **Recebíveis vencidos** | Parcelas de clientes vencidas. |
| **Créditos de fornecedores** | Valores a usar ou a recuperar. Só aparece quando existe saldo. |

## Fluxo de caixa projetado

Mostra semana a semana o saldo previsto para 30, 60 ou 90 dias, somando o que vence a receber e tirando o que vence a pagar, inclusive recorrências ainda não geradas.

:::atencao Previsão não é dinheiro
Título em aberto só vira caixa quando o pagamento é registrado. Se os clientes atrasarem, o saldo real fica abaixo da previsão.
:::

## Resultado do período

| Linha | Como é calculada |
|---|---|
| **Faturamento** | Pedidos confirmados no período. |
| **Custo das mercadorias vendidas** | Custo gravado na confirmação de cada pedido. |
| **Lucro bruto** | Faturamento menos o custo. Pedidos sem custo ficam fora, e o painel avisa. |
| **Despesas operacionais** | Despesas avulsas e recorrentes, pela competência. |
| **Mercadorias cobradas e não entregues** | Compras encerradas com cobrança integral. Só aparece quando existe. |
| **Resultado estimado** | Lucro bruto, menos despesas, menos mercadorias não entregues. |

:::nota Por que a compra não aparece como despesa
Comprar mercadoria troca dinheiro por estoque. O custo chega ao resultado quando a mercadoria é vendida.
:::

:::nota Mercadorias cobradas e não entregues
Quando o fornecedor cobra o que não entregou, o valor fica em linha própria, na data do encerramento. Ele reduz o resultado estimado, mas não muda o custo das mercadorias vendidas nem a margem bruta, porque nada foi vendido. O dinheiro só sai quando os títulos são pagos.
:::

:::atencao O resultado é gerencial
Ele não considera tributos, depreciação nem devoluções. Não substitui o lucro líquido apurado pela contabilidade.
:::

## Relatórios financeiros

1. No menu lateral, clique em [[Relatórios]].
2. Escolha a categoria [[Gestão]].
3. Escolha o relatório, ajuste o período e os filtros.
4. Use [[CSV]] ou [[PDF]] para baixar.

![Relatórios da categoria Gestão.](admin-relatorios-gestao-1280.png "sem-menu h=120")

| Relatório | Para que serve |
|---|---|
| Fluxo de caixa | Entradas e saídas realizadas no período. |
| A pagar por período | Títulos por vencimento. |
| A pagar por fornecedor | Quanto se deve a cada beneficiário. |
| A pagar vencidos | Títulos em atraso. |
| Pagamentos | Pagamentos registrados, com juros e descontos. |
| Compras por fornecedor | Total comprado, recebido e não entregue. |
| Compras por produto | Quantidades compradas, recebidas e não entregues. |
| Evolução dos custos | Como o custo de cada produto mudou. |
| Rentabilidade | Margem por produto, com o custo da venda. |
| Despesas | Despesas por categoria. |

## No celular

![Painel de gestão no celular.](admin-gestao-painel-390.png "estreita h=118")

No celular, no tablet e em janelas estreitas, toque em [[Seções]] no topo do Financeiro para trocar de área.

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Ver o painel e os relatórios financeiros | {sim} | {lib} |
| Atualizar o saldo de caixa | {sim} | {lib} |

**Se liberado**: o painel e os relatórios exigem também consultar contas a pagar e custos. Atualizar o saldo exige a permissão de criar e editar títulos.
