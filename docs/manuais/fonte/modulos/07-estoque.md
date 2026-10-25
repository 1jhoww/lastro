---
slug: estoque
modulo: Estoque
titulo: Estoque
subtitulo: Saldos, entradas de mercadoria, ajustes, histórico de movimentações e reposição.
publico: Administrador, Vendedor (consulta)
resumo: O Estoque mostra quanto existe de cada produto e quanto está livre para vender. Os pedidos movimentam o estoque sozinhos (reserva, saída e devolução); as entradas de mercadoria e os ajustes de contagem são registrados aqui, sempre com motivo e histórico.
administrador: Vê os três saldos de cada produto, registra entradas e ajustes, consulta o histórico de movimentações e a lista de reposição.
vendedor: Vê só a quantidade disponível para vender. Registra entradas e ajustes apenas se o administrador liberar essa permissão.
---

## Como ler os saldos

O Lastro tem um único estoque por empresa, sem depósitos separados e sem estoque por vendedor. Cada produto tem três números:

| Saldo | O que significa |
|---|---|
| **Físico** | O que está no estoque: disponível + reservado. |
| **Reservado** | Comprometido com pedidos confirmados que ainda não saíram. |
| **Disponível** | O que pode ser vendido agora: físico menos reservado. Nunca fica negativo. |

Na tela, use [[Entender os saldos]] para ver essa legenda.

### Quem mexe em cada saldo

| Acontecimento | Onde é feito | Efeito |
|---|---|---|
| Entrada de mercadoria | Estoque › [[Registrar entrada]] | Soma ao físico |
| Ajuste de contagem | Estoque › [[Ajustar saldo]] | Soma ou retira do físico |
| Pedido confirmado | Pedidos | Reserva: disponível diminui |
| Pedido cancelado | Pedidos | Reserva liberada |
| Saída registrada | Pedidos | Sai do físico e libera a reserva |
| Devolução recebida | Pedidos › Devoluções | Itens vendáveis voltam ao físico |

## Consultar o estoque

1. No menu lateral, clique em [[Estoque]].
2. O administrador vê as visões [[Saldos]], [[Reposição]] e [[Movimentações]], e os indicadores **Produtos ativos**, **Estoque baixo**, **Sem disponível** e **Com reservas**.
3. Busque pelo início do nome ou, em **Buscar por**, escolha [[SKU]] e digite o código exato.
4. Use os filtros de **Categoria**, **Situação**, ordem e **Saldo** ([[Sem disponível]], [[Com disponível]], [[Estoque baixo]], [[Com reservas]]).
5. Clique no produto para ver o saldo detalhado e as últimas movimentações.

![Saldos de estoque do administrador, com indicadores e filtros.](admin-estoque-1280.png "sem-menu h=84")

Cada produto mostra uma situação: ((Normal|sucesso)), ((Abaixo do mínimo|alerta)), ((Sem estoque|perigo)), ((Tudo reservado|perigo)) ou ((Produto inativo)).

:::perfil
O **vendedor** vê apenas "Quanto há disponível para vender agora.", sem físico, reservado nem histórico. Produto sem saldo aparece como ((Sem disponível|perigo)).
:::

## Registrar uma entrada de mercadoria

Use quando chegar mercadoria do fornecedor.

1. Em [[Estoque]], clique em [[Registrar entrada]]. Na ficha de um produto, o botão já abre com o produto escolhido.
2. Clique em [[Escolher produto]] e selecione o produto.
3. Informe a **Quantidade**, na unidade do produto. KG e L aceitam até 3 casas decimais; as demais unidades, só inteiros.
4. Escreva o **Motivo** (de 3 a 200 caracteres). Por exemplo: "Nota fiscal 1234 do fornecedor".
5. Se quiser, preencha a **Observação**.
6. Confira o quadro **Antes e depois**, com o saldo atual e o resultado.
7. Clique em [[Revisar entrada]] e confira o resumo em "Confirmar entrada?".
8. Clique em [[Registrar entrada]]. A mensagem "Entrada registrada" aparece.

![Tela de entrada de mercadoria.](admin-estoque-entrada-1280.png "sem-menu h=62")

:::irreversivel A movimentação não pode ser apagada
Toda entrada ou ajuste entra no histórico. Se registrou errado, faça um **ajuste** no sentido contrário, explicando o motivo.
:::

## Ajustar o saldo

Use para corrigir o físico depois de uma contagem, uma avaria ou um vencimento.

1. Em [[Estoque]], clique em [[Ajustar saldo]].
2. Clique em [[Escolher produto]] e selecione o produto.
3. Em **Tipo de ajuste**, escolha [[Acrescentar ao físico]] ou [[Retirar do físico]].
4. Informe a **Quantidade** a acrescentar ou retirar.
5. Escreva o **Motivo** (por exemplo, "Contagem do dia 10", "avaria", "vencimento") e a **Observação**, se houver.
6. Confira o quadro **Antes e depois**.
7. Clique em [[Revisar ajuste]], confira e clique em [[Registrar ajuste]]. A mensagem "Ajuste registrado" aparece.

![Tela de ajuste de saldo, antes de escolher o produto.](admin-estoque-ajuste-1280.png "sem-menu h=56")

:::atencao O reservado é protegido
O ajuste muda só o físico. Não é possível retirar mais do que o **disponível**: a parte reservada para pedidos confirmados fica protegida. Se precisar, cancele ou ajuste os pedidos primeiro.
:::

### Mensagens comuns

| Mensagem | O que fazer |
|---|---|
| Só é possível retirar até … | Diminua a quantidade: o restante está reservado para pedidos. |
| O saldo mudou antes da confirmação | Outra movimentação alterou o estoque. Revise o impacto e confirme de novo. |
| Saldo insuficiente | O disponível mudou. Revise a quantidade. |

:::atencao "Não sabemos se a entrada foi registrada"
Se a conexão cair, clique em [[Tentar de novo]]: é seguro, não duplica. Ou clique em [[Ver histórico]] para conferir. Só descarte a tentativa depois de confirmar no histórico que a movimentação **não** aparece; se ela foi gravada, registrar de novo duplica o saldo.
:::

## Histórico de movimentações (administrador)

1. Em [[Estoque]], escolha [[Movimentações]] (ou [[Ver todas]] na ficha de um produto).
2. Para ver um produto, clique em [[Filtrar por produto]].
3. Escolha o tipo: Entrada, Ajuste positivo, Ajuste negativo, Reserva de pedido, Reserva liberada, Expedição ou Devolução recebida.
4. Escolha o **Período**: todo o período ou os últimos 7, 30 ou 90 dias.
5. Ordene por [[Mais recentes]] ou [[Mais antigas]].

![Histórico de movimentações de estoque.](admin-estoque-movimentacoes-1280.png "sem-menu h=88")

Cada linha mostra data, produto, tipo, quantidade, **Saldo após** e **Motivo e responsável**. Movimentações de pedidos aparecem como automáticas. Responsáveis aparecem como "Você" ou por um código.

## Reposição (administrador)

A visão [[Reposição]] lista os produtos ativos com disponível **abaixo do estoque mínimo**.

1. Em [[Estoque]], escolha [[Reposição]].
2. Veja as colunas **Disponível**, **Mínimo** e **Falta para o mínimo**. A ordem padrão mostra a maior falta primeiro.
3. Clique no produto para abrir a ficha e registrar a entrada.

![Lista de reposição: produtos abaixo do mínimo.](admin-estoque-reposicao-1280.png "sem-menu h=100")

:::dica
O estoque mínimo é definido no cadastro do produto (veja o manual de Produtos). Ele só gera o alerta: o Lastro não faz compras automáticas.
:::

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Consultar disponível | {sim} | {pad} |
| Ver físico e reservado | {sim} | {lib} |
| Registrar entradas e ajustes | {sim} | {lib} |
| Histórico e reposição | {sim} | {lib} |

**Se liberado**: o administrador pode liberar "Estoque · Registrar movimentações" para o vendedor em **Configurações › Usuários e convites › Permissões**.
