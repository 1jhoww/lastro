---
slug: pedidos
modulo: Pedidos
titulo: Pedidos
subtitulo: Como lançar, confirmar, expedir e acompanhar os pedidos de venda.
publico: Administrador, Vendedor
resumo: Este manual mostra o caminho completo de um pedido no Lastro: do rascunho à confirmação, que reserva o estoque e gera as parcelas a receber, até a saída dos produtos e a confirmação de entrega ao cliente.
administrador: Vê e gerencia os pedidos de toda a empresa, escolhe o responsável pelo pedido, aprova descontos e cancela rascunhos e pedidos confirmados.
vendedor: Cria, edita, confirma e registra a saída dos próprios pedidos, sempre para clientes da própria carteira. Não cancela pedidos nem aprova descontos.
---

## Como funciona um pedido

Todo pedido passa por situações bem definidas. Cada mudança de situação fica registrada no **Histórico do pedido**, com data e responsável.

| Situação | O que significa | Estoque | Financeiro |
|---|---|---|---|
| ((Rascunho)) | Proposta em preparação. Pode estar incompleta e pode ser editada. | Não muda | Nada é gerado |
| ((Confirmado\|destaque)) | Compromisso com o cliente. Aparece como **Aguardando saída**. | Itens ficam **reservados** | Parcelas a receber são geradas |
| ((Expedido\|sucesso)) | Os produtos saíram do estoque. | Sai do estoque físico | Parcelas continuam valendo |
| ((Cancelado\|perigo)) | Pedido encerrado sem venda. | Reserva liberada | Parcelas canceladas |

:::nota Expedir não é entregar
**Registrar saída** só diz que os produtos saíram do estoque. Quando o cliente recebe, você registra a **Confirmação de entrega**, um passo separado que não altera o pedido, o estoque nem o financeiro.
:::

## Encontrar um pedido

1. No menu lateral, clique em [[Pedidos]]. No celular, use a barra inferior.
2. Use as opções de situação para filtrar: [[Todos]], [[Rascunhos]], [[Confirmados]], [[Expedidos]] ou [[Cancelados]].
3. Para ver os pedidos de um cliente, clique em [[Filtrar por cliente]] e escolha o cliente. Para tirar o filtro, clique em [[Remover]].
4. Em **Ordem**, escolha [[Mais recentes]] ou [[Mais antigos]].
5. Para achar um número, digite no campo **Número nos pedidos carregados** (por exemplo, `PED-E48F56EE`). A busca vale só para os pedidos já carregados na lista; carregue mais para ampliar.
6. Clique na linha do pedido para abrir a ficha completa.

![Lista de pedidos do administrador, com filtros por situação, cliente e ordem.](admin-pedidos-1280.png "sem-menu h=82")

:::perfil
O **administrador** vê todos os pedidos da empresa e a coluna **Responsável**. O **vendedor** vê apenas os próprios pedidos, com clientes da sua carteira.
:::

## Lançar um novo pedido

O pedido é montado em uma única página, com quatro partes: **Dados do pedido**, **Produtos**, **Pagamento** e **Finalização**. Nada é gravado até você salvar.

1. Clique em [[Novo pedido]]. O botão fica no topo do menu lateral, na tela Início e na lista de pedidos. No celular, use o botão central da barra inferior.
2. Em **Dados do pedido**, no campo **Cliente**, digite o início do nome e escolha o cliente na lista. Só aparecem clientes ativos (para o vendedor, só os da carteira dele).
3. Confira o **Responsável**. O vendedor aparece como "Você". O administrador pode escolher outro usuário ativo da empresa.
4. Em **Produtos**, busque pelo início do nome em **Buscar produto pelo início do nome**. Cada produto mostra o preço, a unidade e quanto há disponível.
5. Ajuste a quantidade com os botões **+** e **−** ou digite o número. Quantidade zero tira o produto do carrinho.
6. Confira o **Carrinho**. No computador ele fica à direita; no celular, toque em [[Ver resumo]] na barra inferior.
7. Em **Pagamento**, escolha a **Condição de pagamento** (veja a seção a seguir).
8. Se quiser, informe a **Forma pretendida** (Pix, boleto etc.). Ela só indica como o cliente pretende pagar e não registra recebimento.
9. Em **Finalização**, escreva as **Observações**, se houver (instruções de entrega, combinados com o cliente). Confira o resumo de cliente, itens, pagamento e o **Total do pedido**.
10. Clique em [[Salvar rascunho]] para continuar depois, ou em [[Confirmar pedido]] para salvar e seguir direto para a confirmação.

![Tela de novo pedido: cliente e responsável no topo, busca de produtos à esquerda e carrinho à direita.](admin-pedido-novo-1280.png "sem-menu h=88")

:::dica Preço e total são uma prévia
Os valores da tela de edição são uma prévia. Ao salvar, o Lastro calcula os valores oficiais e registra o **Preço registrado** de cada item. Mudanças futuras no preço do produto não alteram pedidos já salvos.
:::

:::atencao Produto com pouco disponível
Se a quantidade passar do disponível, o carrinho mostra "Disponível agora: … A confirmação pode ser recusada." Você pode salvar o rascunho, mas a confirmação só acontece se houver estoque para todos os itens.
:::

### Condição de pagamento

O campo **Condição de pagamento** oferece três caminhos:

- **Uma condição cadastrada** (por exemplo, "À vista" ou "30/60/90"). As parcelas são calculadas a partir da data de confirmação do pedido.
- **Definir vencimentos manualmente**: escolha [[À vista]] e informe o **Vencimento**, ou [[Parcelado]] e informe o **Primeiro vencimento**, as **Parcelas** (de 2 a 12 vezes) e o **Intervalo** ("A cada 30 dias", por exemplo). Uma prévia das parcelas aparece logo abaixo.
- **Definir depois**: o rascunho fica salvo sem condição, mas não pode ser confirmado.

:::nota
Os vencimentos manuais precisam ser de hoje em diante. Se aparecer "O vencimento não pode ser no passado.", ajuste a data antes de salvar. Depois da confirmação, a data de uma parcela só muda pelo Financeiro (veja **Vencimento depois da confirmação**).
:::

### Mensagens comuns ao salvar

| Mensagem | O que fazer |
|---|---|
| Escolha o cliente e inclua ao menos um produto para salvar. | Preencha o cliente e coloque pelo menos um item no carrinho. |
| Para confirmar, escolha a condição de pagamento. | Troque "Definir depois" por uma condição ou por vencimentos manuais. |
| O cliente foi desativado. Escolha outro cliente. | O cliente foi desativado enquanto você montava o pedido. |
| Um dos produtos foi desativado ou mudou de unidade. | Remova o produto do carrinho e salve de novo. |
| O rascunho foi alterado por outra pessoa… | Clique em [[Carregar versão atual]] e refaça a alteração. |

:::atencao "Não sabemos se o rascunho foi criado"
Se a conexão cair ao salvar um pedido novo, o Lastro não sabe se o rascunho chegou ao servidor. Antes de salvar de novo, clique em [[Ver rascunhos]] e confira a lista: a criação de rascunho não tem proteção contra duplicidade.
:::

## Editar um rascunho

1. Abra o pedido na lista de pedidos.
2. Clique em [[Editar rascunho]].
3. Altere cliente, produtos, pagamento ou observações.
4. Clique em [[Salvar rascunho]] ou em [[Confirmar pedido]].

Somente rascunhos aceitam alterações. Pedidos confirmados, expedidos ou cancelados mostram o aviso de que não podem ser editados.

## Confirmar o pedido

Confirmar transforma o rascunho em compromisso com o cliente. Na confirmação, o Lastro **reserva o estoque** de todos os itens e **gera as parcelas a receber** no Financeiro.

1. Abra o rascunho. Confira itens, valores, pagamento e o painel **Registro**.
2. Clique em [[Confirmar pedido]].
3. Revise o resumo na janela "Confirmar pedido?".
4. Clique em [[Confirmar e reservar]].
5. Aguarde a mensagem "Pedido confirmado e estoque reservado". O pedido passa a ((Confirmado|destaque)) e aparece como **Aguardando saída**.

![Ficha do pedido em rascunho, com os botões Editar rascunho, Cancelar rascunho e Confirmar pedido.](admin-pedido-detalhe-1280.png "sem-menu h=82")

Para confirmar, o pedido precisa de cliente, itens e condição de pagamento, e nenhum vencimento pode estar no passado.

:::irreversivel Depois de confirmado, o pedido não pode ser editado
Cliente, itens, preços e valores das parcelas ficam fixos. Para desfazer, só o administrador pode **cancelar** o pedido, e o cancelamento também é definitivo.
:::

### Vencimento depois da confirmação

Se o cliente combinar outra data para uma parcela, o pedido **não** precisa ser cancelado. O administrador corrige a data em **Financeiro › Contas a receber**, na ficha da parcela, com o botão [[Alterar vencimento]] e um motivo. Valores e pagamentos não mudam, e o **Histórico do pedido** registra "Vencimento corrigido". O passo a passo e as regras estão no manual do Financeiro.

O vendedor não altera vencimentos: ele pede a correção ao administrador.

:::atencao Estoque insuficiente
Se aparecer "Não há disponível suficiente para reservar todos os itens. Nada foi reservado.", o Lastro lista os itens em falta. Edite o rascunho e ajuste as quantidades, ou peça ao administrador uma entrada de estoque.
:::

## Registrar a saída (expedição)

Use quando os produtos de um pedido confirmado saírem do estoque para entrega.

1. Abra o pedido confirmado. Na lista, filtre por [[Confirmados]] ou use o bloco **Pedidos aguardando saída** da tela Início.
2. Clique em [[Registrar saída]].
3. Leia o aviso "Registrar saída?": os produtos sairão do estoque físico e a reserva será liberada.
4. Clique em [[Registrar saída]] na janela para concluir.
5. A mensagem "Saída registrada!" aparece e o pedido passa a ((Expedido|sucesso)).

:::irreversivel A saída não pode ser desfeita
A expedição é sempre do pedido inteiro. Se o cliente devolver produtos depois, use o fluxo de **Devoluções** (veja o manual de Devoluções).
:::

## Confirmar a entrega

Quando o cliente receber os produtos de um pedido expedido, registre a entrega na ficha do pedido.

1. Abra o pedido expedido. O painel de entrega mostra "Saída registrada, entrega ainda não confirmada."
2. Clique em [[Confirmar entrega]].
3. Informe a **Data da entrega**. Ela precisa estar entre a data da saída e hoje.
4. Se quiser, preencha **Recebido por** (nome de quem recebeu, com pelo menos 2 letras) e **Observações**.
5. Clique em [[Confirmar entrega]] para concluir. A mensagem "Entrega confirmada" aparece.

A entrega confirmada aparece no histórico do cliente como **Entrega confirmada** e entra na lista de Visitas como registro automático. Cada pedido tem no máximo uma confirmação de entrega.

## Documentos do pedido {nova-pagina}

No painel **Documentos** da ficha do pedido estão os PDFs para enviar ou imprimir:

| Documento | Para que serve | Quando aparece |
|---|---|---|
| Pedido comercial | Itens, quantidades, preços, total, condição de pagamento com as parcelas e observações. | Sempre |
| Romaneio de entrega | Itens e valores entregues, com campos de nome, data e assinatura de quem recebe. | Pedido confirmado ou expedido |

### Baixar e compartilhar

:::lado
1. Abra a ficha do pedido e role até **Documentos**.
2. No computador, use os ícones de cada documento: [[Visualizar]] (abre o PDF em outra aba), [[Baixar]] (salva o arquivo) ou [[Compartilhar]].
3. No celular, toque em [[Abrir]] ou no menu de três pontos para [[Baixar]] ou [[Compartilhar]].
4. Para enviar pelo WhatsApp, escolha [[Compartilhar]] e depois o contato.

O PDF é gerado na hora, com os dados atuais do pedido, e recebe o número do pedido no nome do arquivo.

![Painel Documentos de um pedido confirmado.](admin-pedido-documentos.png)
:::

### Identidade visual dos PDFs

Todo documento traz o **nome da empresa** em destaque e a **marca do Lastro**, pequena, no canto superior direito. O que mais aparece depende do plano:

| Elemento | Essencial | Profissional |
|---|:-:|:-:|
| Nome da empresa | {sim} | {sim} |
| Marca do Lastro | {sim} | {sim} |
| Logotipo da empresa ao lado do nome | {nao} | {sim} |
| Foto de cada produto, ao lado do nome do item | {nao} | {sim} |

:::lado
#### Plano Profissional

- O **logotipo da empresa** fica à esquerda do nome, no topo da primeira página. Ele é cadastrado em **Configurações › Empresa** (veja o manual Usuários e permissões).
- Cada item mostra a **foto do produto** em um quadro de 15 mm, ao lado do nome. Produto sem foto aparece só com o nome, sem quadro vazio.
- O **romaneio de entrega** segue o mesmo padrão, com fotos e os campos de nome, data e assinatura de quem recebe.
- A marca do Lastro continua no canto superior direito, menor que a marca da empresa.

![Pedido comercial no Profissional.](pdf-pedido-profissional.png)
:::

:::lado
#### Plano Essencial

- O topo mostra o **nome da empresa** em texto e a marca do Lastro.
- Os itens aparecem com nome, SKU, quantidade e valores, sem fotos.
- Um logotipo ou fotos já cadastrados ficam **guardados** e voltam aos documentos se a empresa passar para o Profissional.
- O conteúdo do pedido (itens, valores, parcelas e observações) é o mesmo nos dois planos.

![Pedido comercial no Essencial.](pdf-pedido-essencial.png)
:::

:::nota
São documentos **não fiscais**. Gerar o PDF ou assinar o romaneio não muda a situação do pedido.
:::

## Cancelar um pedido (administrador)

Só o administrador cancela pedidos. O botão muda conforme a situação: [[Cancelar rascunho]] para rascunhos e [[Cancelar pedido]] para pedidos confirmados.

1. Abra o pedido e clique no botão de cancelamento.
2. Leia o aviso. No rascunho, ele deixa de poder ser editado ou confirmado. No pedido confirmado, a reserva de estoque é liberada e as parcelas a receber são canceladas.
3. Escreva o **Motivo do cancelamento** (de 3 a 200 caracteres). Ele fica no histórico do pedido.
4. Confirme no botão da janela. A mensagem "Pedido cancelado" aparece.

:::irreversivel O cancelamento é definitivo
Um pedido cancelado não volta a ser rascunho nem confirmado. Se precisar vender de novo, crie um novo pedido. O Lastro também **não faz estorno bancário automático**.
:::

:::atencao Pedido com pagamento registrado
Se o pedido já tem recebimentos, o cancelamento comum é recusado. Use **Abrir financeiro do pedido › Operações excepcionais** para fazer o cancelamento financeiro e escolher se o valor pago vira crédito do cliente ou reembolso a fazer (veja o manual do Financeiro).
:::

Pedidos expedidos não podem ser cancelados. Nesse caso, registre uma devolução.

## Aprovar um desconto (administrador)

O desconto administrativo vale para rascunhos e é aprovado no financeiro do pedido.

1. Abra o rascunho e clique em [[Abrir financeiro do pedido]].
2. Abra **Desconto do pedido**.
3. Em **Tipo de desconto**, escolha **Valor fixo** (informe o **Valor do desconto**) ou **Percentual em pontos base** (1000 = 10%; máximo 10000 = 100%).
4. Escreva a **Justificativa do desconto**.
5. Clique em [[Revisar desconto]], confira e clique em [[Aprovar desconto]].

O Lastro distribui o desconto entre os itens e recalcula as parcelas.

:::atencao Editou o rascunho? Aprove de novo
A aprovação vale para a versão atual do rascunho. Se alguém alterar cliente, itens ou pagamento depois, o desconto precisa ser aprovado novamente.
:::

## Quando a conexão falha

Em operações importantes (confirmar, registrar saída, cancelar), o Lastro protege contra repetição. Se a conexão cair antes da resposta, aparece um aviso como "Não sabemos se o pedido foi confirmado".

- Clique em [[Tentar de novo]]: é seguro. Se a operação já foi gravada, o servidor devolve o mesmo resultado sem repetir o efeito.
- Ou clique em [[Atualizar pedido]] para ver a situação atual.
- Só use **Descartar tentativa** depois de atualizar o pedido e ver que a operação **não** aconteceu.

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Ver pedidos | {sim:Todos} | {pad:Os próprios} |
| Criar e editar rascunhos | {sim} | {pad} |
| Confirmar pedido (reservar estoque) | {sim} | {pad} |
| Registrar saída | {sim} | {pad} |
| Confirmar entrega | {sim} | {pad} |
| Gerar documentos (PDF) | {sim} | {pad} |
| Escolher outro responsável | {sim} | {nao} |
| Aprovar desconto | {sim} | {nao} |
| Cancelar rascunho ou pedido | {sim} | {nao} |

**Padrão**: o vendedor recebe a permissão ao ser convidado, e o administrador pode retirá-la em **Configurações › Usuários e convites**. **Não**: operação exclusiva de administradores.
