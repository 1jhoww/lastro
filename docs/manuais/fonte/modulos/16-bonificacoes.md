---
mes: novembro de 2026
slug: bonificacoes
modulo: Bonificações
titulo: Bonificações
subtitulo: Produtos entregues ao cliente sem cobrança, em um pedido ou em lançamento avulso.
publico: Administrador, Vendedor (se liberado)
resumo: Bonificação é mercadoria entregue ao cliente sem cobrança. Este manual mostra os dois caminhos, a bonificação dentro de um pedido e o lançamento avulso, e explica quando o estoque sai, como registrar retornos e como acompanhar o custo.
administrador: Concede bonificações, escolhe o responsável, consulta toda a empresa e registra retornos.
vendedor: Só concede bonificações com a permissão "Conceder bonificações". Vê as próprias, de clientes da carteira. Não registra retornos.
---

## Dois caminhos

| | Novo pedido | Nova bonificação |
|---|---|---|
| Quando usar | Venda normal, com bonificação opcional no final | Lançamento sem venda |
| Onde fica | [[Novo pedido]] › **Finalização** › [[Adicionar bonificação]] | [[Bonificações]] › [[Nova bonificação]] |
| Cria pedido? | Sim, o pedido da venda | Não |
| Saída do estoque | Na expedição do pedido | Ao confirmar o lançamento |
| Motivo | Opcional | Obrigatório |

Nos dois casos, a bonificação não entra no total, não gera conta a receber e não conta como faturamento.

:::nota Bonificação de fornecedor é outra coisa
Este manual trata do que a empresa dá ao cliente. Mercadoria recebida de graça de um fornecedor entra por **Estoque › Registrar entrada** (veja o manual de Estoque).
:::

## Bonificar dentro de um pedido

1. Monte o pedido normalmente em [[Novo pedido]].
2. Em **Finalização**, clique em [[Adicionar bonificação]].
3. Busque os produtos e ajuste as quantidades. Você pode bonificar um produto que também está na venda.
4. Se quiser, escolha o **Motivo**.
5. Confira o resumo: os itens bonificados aparecem em **Bonificados**, e o **Total do pedido** não muda.
6. Clique em [[Salvar rascunho]] ou [[Confirmar pedido]].

![Bonificação na etapa final do pedido, separada dos itens vendidos.](admin-pedido-bonificacao-1280.png "sem-menu h=96")

Para tirar a bonificação, retire os produtos e salve o rascunho. A bonificação só pode mudar enquanto o pedido é rascunho.

:::atencao Estoque vale para venda e bonificação juntas
Se não houver estoque para a soma da venda e da bonificação, o pedido não é confirmado. Nada fica reservado pela metade.
:::

:::dica Pedido só com bonificação
Todo pedido precisa de ao menos um item vendido. Para entregar só produtos bonificados, use [[Nova bonificação]].
:::

### O que acontece depois

| Situação do pedido | Bonificação |
|---|---|
| ((Rascunho)) | Pode ser alterada. Estoque não muda. |
| ((Confirmado\|destaque)) | Estoque fica reservado. |
| ((Expedido\|sucesso)) | Produtos saem do estoque físico. |
| ((Cancelado\|perigo)) | Reserva liberada. Bonificação cancelada junto. |

A ficha do pedido mostra a bonificação em um painel próprio, com o número `BON-` e o mesmo final do número do pedido. O pedido comercial e o romaneio trazem os itens em uma seção separada, com a indicação **Sem cobrança**.

## Lançar uma bonificação avulsa

1. No menu, clique em [[Bonificações]].
2. Clique em [[Nova bonificação]].
3. Escolha o **Cliente**.
4. Busque os produtos e ajuste as quantidades.
5. Escolha o **Motivo**: Amostra, Campanha comercial, Relacionamento, Reposição de avaria ou Outro. Em **Outro**, a descrição é obrigatória.
6. O administrador pode escolher outro **Responsável**.
7. Clique em [[Revisar bonificação]] e confira o resumo.
8. Clique em [[Confirmar e dar saída]]. Só neste momento os produtos saem do estoque.

![Lançamento avulso de bonificação.](admin-bonificacao-nova-1280.png "sem-menu h=88")

:::irreversivel
A confirmação dá saída do estoque na hora. Depois do registro, a bonificação avulsa não pode ser cancelada nem editada. Para corrigir um lançamento errado, o administrador registra um retorno total: o histórico guarda a saída e o retorno.
:::

A avulsa usa só o **disponível**. O que está reservado para pedidos não pode ser bonificado.

## Consultar o histórico

Em [[Bonificações]], a lista mostra número, data, cliente, tipo, responsável, unidades e situação. Use [[Todas]], [[Avulsas]] ou [[Vinculadas]] para filtrar. Rascunhos de pedido não aparecem aqui.

Abra uma linha para ver os produtos, o motivo, o responsável, o histórico e os documentos. Na bonificação vinculada, [[Abrir pedido vinculado]] leva à ficha do pedido.

![Histórico de bonificações.](admin-bonificacoes-1280.png "sem-menu h=70")

:::perfil
O **administrador** vê toda a empresa. O **vendedor** vê as bonificações sob sua responsabilidade, de clientes da carteira.
:::

## Comprovante

Na ficha da bonificação, em **Documentos**, abra, baixe ou compartilhe o **Comprovante de bonificação**. Ele traz produtos, quantidades, **Sem cobrança** e campos de assinatura, sem valores.

:::atencao O comprovante não é documento fiscal
O Lastro não emite nota fiscal. Confirme com seu contador a nota fiscal exigida para remessa em bonificação.
:::

## Registrar um retorno (administrador)

Depois da saída do estoque, o cliente pode devolver parte ou tudo.

1. Abra a bonificação.
2. Em **Registrar retorno**, informe a quantidade **Vendável** e a **Danificada** de cada produto.
3. Escreva o **Motivo do retorno**.
4. Clique em [[Revisar retorno]] e depois em [[Registrar retorno]].

![Retorno com quantidades vendável e danificada.](admin-bonificacao-retorno-1280.png "sem-menu h=88")

| Tipo | Estoque | Custo |
|---|---|---|
| Vendável | Volta ao físico | Sai do custo da bonificação |
| Danificado | Não volta | Continua no custo da bonificação |

O retorno não mexe no financeiro nem no custo médio do produto. Antes da expedição, não há retorno: cancele o pedido.

O ajuste de unidades e custo fica no período da bonificação, mesmo que o retorno aconteça em outro mês. Para ver quando cada retorno aconteceu, use o relatório **Retornos de bonificações** ou o **Histórico** da bonificação.

## Custos

Com contrato que inclui custos e a permissão **Visualizar custos**, a ficha mostra **Custo na origem** e **Custo após retornos**. O custo fica congelado na confirmação do pedido ou no registro do lançamento, então compras posteriores não mudam bonificações passadas.

No painel de gestão, **Bonificações concedidas** é uma linha própria. Ela reduz o **Resultado estimado**, mas não muda faturamento, custo das mercadorias vendidas nem margem bruta.

## Relatórios

Em [[Relatórios]] › **Comercial**:

| Relatório | Mostra |
|---|---|
| Bonificações por período | Cada bonificação, com tipo, cliente, responsável e unidades |
| Bonificações por cliente | Total por cliente |
| Bonificações por responsável | Total por vendedor ou responsável |
| Bonificações por produto | Produtos mais bonificados |
| Bonificações por pedido | Vinculadas e o pedido de cada uma |
| Motivos das bonificações avulsas | Por que as avulsas foram concedidas |
| Retornos de bonificações | Cada retorno na data em que aconteceu, com a data da bonificação |

Os relatórios mostram avulsas e vinculadas, unidades e, com acesso a custos, o custo total. Vendedores só veem a própria carteira. Exportam em CSV e PDF como os demais.

## Rascunho com bonificação e permissões

Sem a permissão **Conceder bonificações**, o vendedor não adiciona, altera nem remove itens bonificados.

Se o rascunho já tem uma bonificação autorizada, esse vendedor pode mudar pagamento e observações e confirmar o pedido. Cliente e produtos ficam bloqueados, porque a bonificação foi autorizada para aquela venda.

Se a permissão de quem autorizou for retirada, o pedido não é confirmado até alguém com a permissão rever a bonificação.

## Quem pode fazer o quê

| Ação | Administrador | Vendedor |
|---|---|---|
| Bonificar em um pedido | {sim} | {lib} |
| Lançar bonificação avulsa | {sim} | {lib} |
| Consultar bonificações | Toda a empresa | {lib} |
| Escolher outro responsável | {sim} | {nao} |
| Registrar retorno | {sim} | {nao} |
| Ver custos | {sim} | {lib} |
