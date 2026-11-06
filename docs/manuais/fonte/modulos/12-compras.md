---
mes: novembro de 2026
slug: compras
modulo: Compras
titulo: Compras e fornecedores
subtitulo: Fornecedores, pedidos de compra, recebimento de mercadorias, encerramento de saldo e custos.
publico: Administrador, Vendedor (se liberado), Se contratado
resumo: O módulo Compras registra o que a empresa compra dos fornecedores. Confirmar a compra gera as contas a pagar; receber a mercadoria movimenta o estoque e atualiza o custo. As duas coisas são separadas, porque a mercadoria e o dinheiro raramente acontecem no mesmo dia.
administrador: Cadastra fornecedores, cria e confirma compras, recebe mercadorias, encerra saldos pendentes e consulta custos e margens.
vendedor: Só usa compras e custos se o administrador liberar. Nunca cadastra fornecedores.
---

## Antes de começar

Disponível quando o contrato da empresa inclui esse recurso. Sem ele, o item não aparece no menu.

Três ideias explicam quase todo o módulo:

| Acontecimento | O que muda | O que não muda |
|---|---|---|
| Confirmar a compra | Gera os títulos em Contas a pagar | O estoque |
| Receber a mercadoria | Soma ao estoque e atualiza o custo médio | Os títulos e os pagamentos |
| Pagar um título | Sai dinheiro do caixa | O estoque |

:::nota Entrada avulsa continua existindo
Bonificação, amostra ou ajuste de abertura seguem em **Estoque › Registrar entrada**. A entrada avulsa não gera título e não muda o custo médio. Use Compras quando houver fornecedor e valor a pagar.
:::

## Cadastrar um fornecedor

Cliente e fornecedor são o mesmo cadastro, então uma empresa que compra e vende para você aparece uma vez só.

1. No menu lateral, clique em [[Clientes]].
2. Clique em [[Novo fornecedor]].
3. Em **Relacionamento**, mantenha [[Fornecedor]] marcado. Marque também [[Cliente]] se a empresa for os dois.
4. Preencha o **Nome ou razão social** e o endereço. CPF ou CNPJ é opcional, e **Contato responsável** ajuda a saber com quem falar.
5. Clique em [[Salvar fornecedor]]. Se a empresa também for cliente, o botão aparece como [[Salvar cliente]].

![Novo fornecedor, com o relacionamento já marcado.](admin-fornecedor-novo-1280.png "sem-menu h=120")

Para consultar, escolha a aba [[Fornecedores]] em Clientes.

![Aba de fornecedores em Clientes.](admin-fornecedores-1280.png "sem-menu h=85")

:::dica CPF ou CNPJ já cadastrado
Se a empresa já é cliente, o Lastro avisa e oferece usar o cadastro existente. Assim a mesma empresa nunca fica duplicada.
:::

## Consultar as compras

1. No menu lateral, clique em [[Compras]].
2. Use as visões [[Todas]], [[A receber]], [[Rascunhos]], [[Recebidas]], [[Encerradas]] e [[Canceladas]].
3. Clique na compra para abrir a ficha.

![Lista de compras com as situações.](admin-compras-1280.png "sem-menu h=85")

- ((Rascunho)): nada mudou no estoque nem no financeiro.
- ((Confirmada)): títulos gerados, aguardando a mercadoria.
- ((Parcialmente recebida|alerta)): chegou parte da mercadoria.
- ((Recebida|sucesso)): toda a mercadoria chegou.
- ((Encerrada com saldo)): parte não será entregue, e a decisão financeira foi registrada.
- ((Cancelada)): fica no histórico, sem efeito.

## Criar uma compra

1. Em [[Compras]], clique em [[Nova compra]].
2. Clique em [[Escolher fornecedor]] e selecione o fornecedor.
3. Confira a **Data da compra** e, se souber, a **Previsão de entrega**.
4. Escolha a **Condição de pagamento**. São as mesmas condições usadas nos pedidos.
5. Clique em [[Adicionar produto]] para cada item. Informe quantidade e **Custo unitário**. O Lastro sugere o custo de referência ou, sem ele, o último custo.
6. Se houver, preencha **Frete**, **Despesas adicionais** e **Desconto da compra**.
7. Clique em [[Salvar rascunho]].

![Nova compra, com dados, produtos e valores adicionais.](admin-compra-nova-1280.png "sem-menu h=125")

:::atencao Não lance o frete de novo como despesa
Frete e despesas adicionais entram no custo dos produtos, na proporção do valor de cada item, e fazem parte dos títulos da compra. Lançá-los também em Contas a pagar conta o valor duas vezes.
:::

## Confirmar a compra

1. Abra o rascunho e clique em [[Confirmar compra]].
2. Confira as parcelas. Você pode ajustar valores e vencimentos, desde que a soma continue igual ao total.
3. Clique em [[Confirmar compra]]. A mensagem "Compra confirmada" aparece.

![Confirmação, com parcelas e vencimentos ajustáveis.](admin-compra-confirmar-1280.png "sem-menu estreita")

Depois de confirmar, só a previsão de entrega e as observações podem ser corrigidas, sempre com motivo. Para mudar valores, use [[Voltar a rascunho]]: os títulos são cancelados e uma nova confirmação gera títulos novos. Isso só é possível sem recebimentos e sem pagamentos.

## Receber a mercadoria

Registre o que chegou de fato, mesmo que seja só uma parte.

1. Abra a compra e clique em [[Receber mercadoria]].
2. Confira a **Data do recebimento**. Ela não pode ser futura.
3. Ajuste a quantidade de cada item. O campo já vem com o que falta receber.
4. Clique em [[Registrar recebimento]]. O estoque e o custo médio são atualizados na hora.

![Recebimento: informe o que chegou de cada item.](admin-compra-receber-1280.png "sem-menu estreita")

Repita quantas vezes for preciso até completar a compra.

![Compra parcialmente recebida, com recebimentos e histórico.](admin-compra-parcial-1280.png "sem-menu h=125")

:::atencao Quantidade acima do comprado
O Lastro recusa receber mais do que falta. Se o fornecedor mandou a mais, registre a diferença em uma nova compra.
:::

### Estornar um recebimento

Se registrou errado, clique em [[Estornar]] no recebimento e informe o motivo. A mercadoria sai do estoque com movimentação própria e o custo médio é recalculado. O estorno é recusado se esse estoque já estiver reservado ou expedido.

## Encerrar o saldo pendente {nova-pagina}

Use quando o fornecedor não vai entregar o restante de uma compra parcialmente recebida.

1. Abra a compra e clique em [[Encerrar saldo pendente]].
2. Em **O que acontece com o valor não entregue**, escolha a decisão. O Lastro mostra o efeito antes de você confirmar.
3. Se aparecer o aviso de valor pago a maior, diga se ele fica como crédito ou como valor a recuperar.
4. Escreva o **Motivo**.
5. Clique em [[Encerrar saldo]].

![Encerramento com abatimento: itens, valores e parcelas alteradas.](admin-compra-encerrar-1280.png "sem-menu estreita")

| Decisão | Títulos | Resultado |
|---|---|---|
| [[Abater dos títulos]] | Reduzidos a partir do último vencimento | O que já foi pago além do entregue vira crédito ou valor a recuperar |
| [[Cobrança integral]] | Continuam iguais | O fornecedor cobra também o que não entregou, e o valor aparece como perda no painel |
| [[Crédito do fornecedor]] | Continuam iguais | O valor não entregue vira crédito para usar depois |

O estoque que já entrou, o custo médio e os pagamentos feitos não mudam em nenhum caso.

:::irreversivel O encerramento é definitivo
Depois de encerrar, a compra não recebe mais mercadoria nem permite estornar recebimentos. Confira a decisão com calma. Se o fornecedor entregar depois, registre uma nova compra.
:::

![Compra encerrada, com a decisão e o que não foi entregue.](admin-compra-encerrada-1280.png "sem-menu h=140")

## Cancelar uma compra

Rascunhos e compras confirmadas sem recebimento podem ser cancelados em [[Cancelar compra]], com motivo. A compra e os títulos ficam no histórico como cancelados.

| Mensagem | O que fazer |
|---|---|
| Esta compra tem mercadoria recebida. | Estorne os recebimentos, ou encerre o saldo pendente. |
| Esta compra tem títulos pagos. | Estorne os pagamentos em Contas a pagar. |
| Esta compra usou crédito do fornecedor. | Estorne o uso do crédito antes de continuar. |

## Custos e margem

Abra um produto em [[Produtos]] para ver o quadro **Custos e margem**.

![Ficha do produto com custos, margem e histórico.](admin-produto-custos-1280.png "sem-menu h=125")

| Custo | De onde vem |
|---|---|
| **Custo de referência** | Informado por você no cadastro do produto ou em [[Alterar custo]], sem precisar lançar uma compra. Um recebimento só o preenche quando está vazio. |
| **Custo médio do estoque** | Custo médio ponderado real, calculado a cada recebimento, com frete e descontos rateados. |
| **Último custo de compra** | O do recebimento mais recente. |

Saídas de estoque e entradas avulsas não mudam o custo médio. Editar o custo de referência não movimenta o estoque e não altera o custo médio já apurado. A margem usa o custo médio quando ele existe; sem ele, usa o custo de referência. O preço de venda nunca muda por causa do custo: isso continua sendo decisão sua.

:::nota Vendas passadas não mudam
O custo fica gravado na confirmação do pedido. Quando o custo médio muda depois, as margens das vendas já feitas continuam iguais.
:::

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Gerenciar fornecedores | {sim} | {nao} |
| Consultar compras | {sim} | {lib} |
| Criar e editar compras | {sim} | {lib} |
| Confirmar compras | {sim} | {lib} |
| Receber mercadorias | {sim} | {lib} |
| Encerrar saldo pendente | {sim} | {lib} |
| Visualizar custos | {sim} | {lib} |

**Se liberado**: o administrador pode liberar em **Configurações › Usuários e convites › Permissões**. Consultar compras exige também visualizar custos, porque a compra mostra valores de aquisição.
