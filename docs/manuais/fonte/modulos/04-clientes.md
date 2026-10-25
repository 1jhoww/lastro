---
slug: clientes
modulo: Clientes
titulo: Clientes
subtitulo: Cadastro de clientes, carteiras de vendedores, desativação e histórico de relacionamento.
publico: Administrador, Vendedor
resumo: Os clientes são as pessoas e empresas que compram de você. Todo pedido começa pela escolha de um cliente ativo. Este manual explica como cadastrar, encontrar e editar clientes, como funciona a carteira de cada vendedor e o que acontece ao desativar um cadastro.
administrador: Vê todos os clientes da empresa, define e transfere o vendedor responsável, desativa e reativa cadastros.
vendedor: Vê, cadastra e edita apenas os clientes da própria carteira. Cliente cadastrado pelo vendedor entra direto na carteira dele.
---

## Carteira de clientes

Cada cliente pode ter um **responsável**: o vendedor que atende aquele cliente. O conjunto de clientes de um vendedor é a **carteira** dele.

- O vendedor só enxerga os clientes da própria carteira, e os pedidos desses clientes.
- O administrador enxerga todos os clientes e escolhe ou troca o responsável.
- Um cliente pode ficar **Sem responsável**. Nesse caso, só o administrador o vê.

:::nota
A carteira é verificada pelo servidor, não apenas pela tela. Mesmo com um link direto, o vendedor não abre cliente de outra carteira.
:::

## Encontrar um cliente

1. No menu lateral, clique em [[Clientes]].
2. Em **Buscar clientes**, digite o início do nome ou o CPF/CNPJ completo.
3. Em **Situação**, escolha [[Ativos]], [[Inativos]] ou [[Todos]].
4. O administrador também pode filtrar por **Responsável**: todos, **Sem responsável** ou um vendedor.
5. Clique no cliente para abrir a ficha. O ícone de lápis abre direto a edição.

![Lista de clientes do administrador, com busca, situação e responsável.](admin-clientes-1280.png "sem-menu h=80")

:::dica Busca pelo início do nome
A busca considera o **início** do nome. Para "Padaria Pão Dourado", digite "Padaria", não "Dourado". Para documento, digite o CPF ou CNPJ completo.
:::

## Cadastrar um novo cliente

1. Na lista de clientes, clique em [[Novo cliente]].
2. Em **Identificação**, preencha:
   - **Nome ou razão social** (obrigatório, pelo menos 2 caracteres);
   - **Nome fantasia**, se houver;
   - **CPF ou CNPJ** (opcional; o Lastro confere os dígitos);
   - **Telefone ou WhatsApp**, com DDD, e **E-mail**;
   - **Observações**: horário de entrega, contato preferido, combinados.
3. Em **Endereço**, digite o **CEP**. O Lastro busca logradouro, bairro, cidade e UF automaticamente.
4. Confira os dados e informe o **Número**. Se o endereço não tiver número, marque **Sem número**.
5. Preencha o **Complemento**, se houver. Ele é o único campo opcional do endereço.
6. Clique em [[Salvar cliente]]. A mensagem "Cliente cadastrado" aparece e a ficha do cliente abre.

![Formulário de novo cliente: identificação e endereço.](admin-cliente-novo-1280.png "sem-menu h=84")

:::perfil
Cliente cadastrado pelo **vendedor** entra na carteira dele. Cliente cadastrado pelo **administrador** começa **sem responsável**; o vendedor é definido depois, na ficha.
:::

:::atencao CEP não encontrado
Se aparecer "CEP não encontrado. Preencha o endereço manualmente." ou se a consulta estiver indisponível, digite logradouro, bairro, cidade e UF à mão. O cadastro funciona normalmente.
:::

### Mensagens comuns

| Mensagem | O que fazer |
|---|---|
| Já existe um cliente com este CPF/CNPJ nesta empresa. | Procure o cadastro existente na lista antes de criar outro. |
| CPF ou CNPJ inválido. Confira os dígitos. | Corrija o documento ou deixe o campo vazio. |
| Telefone inválido. Use DDD e número… | Digite no formato (11) 98765-4321. |
| Informe o número ou marque "Sem número". | Preencha o número do endereço. |

## Consultar a ficha do cliente

A ficha reúne documento, contatos, endereço, observações e o painel **Registro**, com situação, data de cadastro e última alteração.

![Ficha do cliente com dados, carteira e histórico de relacionamento.](admin-cliente-detalhe-1280.png "sem-menu h=84")

Quando o plano inclui Visitas, a ficha também mostra:

- **Compras e recompra**: última compra (pedido confirmado), última entrega confirmada, frequência estimada e estimativa de recompra;
- **Histórico de relacionamento**: visitas, entregas e compras do cliente, mais recentes primeiro, com o botão [[Registrar visita]].

## Editar um cliente

1. Abra a ficha do cliente e clique em [[Editar]].
2. Altere os dados necessários.
3. Clique em [[Salvar cliente]]. A mensagem "Cliente salvo" aparece.

:::nota Endereço incompleto
Cadastros antigos podem mostrar o aviso **Endereço incompleto**. Clique em [[Completar endereço]] e preencha os campos que faltam: o endereço é pedido na próxima edição.
:::

## Transferir o cliente para outro vendedor (administrador)

1. Abra a ficha do cliente.
2. No painel **Carteira**, escolha o novo vendedor em **Transferir para**. Só vendedores ativos aparecem; também é possível escolher **Sem responsável**.
3. Leia o aviso "Transferir cliente?".
4. Clique em [[Transferir cliente]]. A mensagem "Carteira atualizada" aparece.

:::atencao O que muda na transferência
O responsável anterior deixa de ver o cliente e os pedidos dele. O novo responsável passa a ver o cliente, mas **não recebe os pedidos antigos**: eles continuam com o vendedor que os fez.
:::

## Desativar ou reativar um cliente (administrador)

Desative clientes com quem a empresa não trabalha mais. Nada é apagado.

1. Abra a ficha do cliente.
2. Clique em [[Desativar]].
3. Leia o aviso e clique em [[Desativar cliente]].

O cliente sai das listas padrão e não pode receber novos pedidos. Pedidos e histórico ficam preservados. Para voltar a vender, abra o cliente pelo filtro [[Inativos]] e clique em [[Reativar]] e depois em [[Reativar cliente]].

:::nota
O Lastro não exclui clientes: desativar é o caminho para tirar um cadastro de uso sem perder o histórico.
:::

## A visão do vendedor

O vendedor vê a lista "Clientes da sua carteira." e pode cadastrar e editar esses clientes. Ele não vê os botões de desativar nem o painel de transferência; na ficha aparece apenas "Na sua carteira.".

![Lista de clientes na visão do vendedor: somente a própria carteira.](seller-clientes-1280.png "sem-menu h=62")

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Ver clientes | {sim:Todos} | {pad:Da carteira} |
| Cadastrar e editar | {sim} | {pad:Da carteira} |
| Definir ou transferir responsável | {sim} | {nao} |
| Desativar e reativar | {sim} | {nao} |
| Ver histórico e recompra | {sim} | {pad:Da carteira} |

**Padrão**: liberado ao vendedor por padrão; o administrador pode retirar em **Configurações › Usuários e convites**. O histórico e a recompra dependem do plano incluir Visitas (plano Profissional). Vendedores e carteiras também são recursos do Profissional.
