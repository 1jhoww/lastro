---
mes: novembro de 2026
versao: Versão 0.2 · 6 de novembro de 2026
rotulo: Manual de atualização
slug: atualizacao-0-2
modulo: Novidades da versão 0.2
titulo: Novidades da versão 0.2
subtitulo: Tudo que entrou no Lastro em 5 e 6 de novembro de 2026 e como começar a usar.
publico: Administrador, Vendedor (se liberado), Equipe do Lastro
resumo: Este manual reúne só o que é novo na versão 0.2. Ele mostra o que mudou, quem recebe cada novidade e o caminho para começar a usar. O passo a passo completo de cada assunto continua nos manuais de cada módulo.
administrador: Usa a nova navegação do Financeiro. Com o plano Gestão ou um contrato equivalente, usa também fornecedores, compras, custos, contas a pagar e o painel de gestão.
vendedor: Continua vendo só o que o administrador liberou. Compras, custos e contas a pagar ficam desligados até serem liberados.
---

## O que há de novo

| Novidade | Para quem | Onde fica |
|---|---|---|
| Nova navegação do Financeiro | Quem usa o Financeiro | [[Financeiro]] |
| Relatórios dentro do Financeiro | Administrador | [[Financeiro]] › [[Relatórios]] |
| Só aparece o que o contrato inclui | Todas as empresas | Menu e configurações |
| Plano Gestão | Empresas que contratarem | Veja a seção **Plano Gestão** |
| Custo e margem no cadastro do produto | Contrato com custos | [[Produtos]] |
| Fornecedores | Contrato com compras | [[Clientes]] |
| Compras e recebimento de mercadoria | Contrato com compras | [[Compras]] |
| Contas a pagar e despesas recorrentes | Contrato com contas a pagar | [[Financeiro]] |
| Créditos de fornecedores | Contrato com compras | [[Financeiro]] |
| Painel de gestão e relatórios financeiros | Contrato com gestão financeira | [[Financeiro]] |
| Planos personalizados e contratos gratuitos | Equipe do Lastro | Área do Super Admin |

:::nota Seus dados continuam como estavam
Pedidos, clientes, produtos, estoque e contas a receber não mudam com esta versão. Empresas que não contrataram os novos recursos notam apenas a navegação do Financeiro.
:::

## Para todas as empresas

### Nova navegação do Financeiro

As seções do Financeiro saíram da linha no topo e foram organizadas em dois grupos: **Principal** e **Mais opções**.

![Seções do Financeiro na coluna ao lado do conteúdo.](admin-pagar-1440.png "sem-menu larga h=70")

1. Clique em [[Financeiro]] no menu lateral.
2. Em telas largas, escolha a seção na coluna ao lado do conteúdo.
3. No celular, no tablet e em janelas estreitas, toque em [[Seções]] no topo da tela.

[[Condições e formas]], que antes ficava entre as seções principais, agora está em **Mais opções**.

### Relatórios dentro do Financeiro

[[Financeiro]] › [[Relatórios]] abre só os relatórios financeiros e de gestão. A tela [[Relatórios]] do menu lateral continua igual, com todas as categorias.

### Só aparece o que o contrato inclui

O menu, as configurações e a janela de permissões mostram apenas o que a empresa contratou. Se um recurso sair do contrato, os dados continuam guardados e voltam a aparecer quando ele for contratado de novo.

## Plano Gestão

O Gestão é o novo plano do Lastro. Ele soma ao Profissional o controle do que a empresa compra, paga e lucra, com até 5 usuários.

Para começar, siga esta ordem:

1. Cadastre os **fornecedores**.
2. Informe o **custo** dos produtos que você já vende.
3. Lance a primeira **compra** e registre o **recebimento**.
4. Lance as **despesas** e crie as **recorrências**.
5. Informe o **saldo de caixa** no [[Painel de gestão]].

| Acontecimento | O que muda | O que não muda |
|---|---|---|
| Confirmar a compra | Gera os títulos em Contas a pagar | O estoque |
| Receber a mercadoria | Soma ao estoque e atualiza o custo médio | Os títulos e os pagamentos |
| Pagar um título | Sai dinheiro do caixa | O estoque |

## Custo e margem do produto

Agora você informa quanto paga por um produto no próprio cadastro, sem precisar lançar uma compra. A margem é recalculada enquanto você digita.

1. Em [[Produtos]], abra o cadastro ou a edição do produto.
2. No grupo **Custo e margem**, informe o **Custo de referência**.
3. Confira o lucro e a margem estimados.
4. Clique em [[Salvar produto]].

![Custo de referência, margem estimada e custo médio ainda não calculado.](admin-produto-custo-novo-1280.png)

| Custo | O que é |
|---|---|
| **Custo de referência** | Valor informado por você. É sugerido nas próximas compras. |
| **Custo médio do estoque** | Custo real, calculado a cada compra recebida. Não pode ser editado. Antes do primeiro recebimento aparece **Ainda não calculado**. |

:::nota O que o custo de referência não muda
Editar esse valor não movimenta o estoque, não altera o custo médio já apurado e não muda a margem de pedidos já confirmados.
:::

Se o produto for salvo e o custo não, a tela avisa e guarda o valor. Clique em [[Tentar novamente]]. Não cadastre o produto de novo: ele já existe.

## Fornecedores

Cliente e fornecedor são o mesmo cadastro, então uma empresa que compra e vende para você aparece uma vez só.

1. Em [[Clientes]], clique em [[Novo fornecedor]].
2. Preencha o **Nome ou razão social** e o endereço.
3. Clique em [[Salvar fornecedor]].

Para consultar, escolha a aba [[Fornecedores]] em Clientes.

## Compras e recebimento

1. Em [[Compras]], clique em [[Nova compra]].
2. Escolha o fornecedor e a **Condição de pagamento**.
3. Clique em [[Adicionar produto]] e informe quantidade e **Custo unitário**.
4. Clique em [[Salvar rascunho]] e depois em [[Confirmar compra]].
5. Quando a mercadoria chegar, clique em [[Receber mercadoria]] e registre o que chegou de fato.

Você pode receber em partes. Se o fornecedor não for entregar o restante, clique em [[Encerrar saldo pendente]] e escolha o que acontece com o valor não entregue.

![Compra parcialmente recebida, com recebimentos e histórico.](admin-compra-parcial-1280.png "sem-menu h=110")

:::dica Entrada avulsa continua existindo
Bonificação, amostra ou ajuste de abertura seguem em **Estoque › Registrar entrada**. A entrada avulsa não gera título e não muda o custo médio.
:::

## Contas a pagar e despesas recorrentes

Títulos de compras, despesas avulsas e recorrências ficam juntos em [[Contas a pagar]].

1. Para uma despesa, clique em [[Nova despesa]], preencha os dados e clique em [[Lançar título]].
2. Para pagar, abra o título e clique em [[Registrar pagamento]].
3. Para o que se repete, abra [[Despesas recorrentes]], clique em [[Nova recorrência]] e informe valor, frequência e dia do vencimento.

:::atencao Confira as recorrências todo mês
Abra [[Despesas recorrentes]] e clique em [[Gerar títulos agora]]. Os títulos dos próximos 35 dias aparecem em Contas a pagar. Repetir não duplica.
:::

Quando uma compra é encerrada com saldo, o valor pode virar crédito. Use-o em [[Créditos de fornecedores]] para abater um título do mesmo fornecedor.

## Painel de gestão e relatórios

O [[Painel de gestão]] junta o que entrou, o que saiu e o que está previsto.

1. Em [[Financeiro]], escolha [[Painel de gestão]].
2. No quadro **Saldo de caixa**, clique em [[Atualizar saldo]] e informe o valor do banco. Sem essa informação, o painel não assume zero.
3. Escolha o período.
4. Clique em um quadro para ver a lista que deu origem ao número.

![Painel de gestão.](admin-gestao-painel-1440.png "sem-menu larga h=120")

:::atencao O resultado é gerencial
O resultado estimado não considera tributos, depreciação nem devoluções. Ele não substitui o lucro líquido apurado pela contabilidade.
:::

## Para a equipe do Lastro

A área do Super Admin agora cria ofertas negociadas com empresas específicas, sem alterar os planos oficiais.

1. Abra [[Planos personalizados]] e clique em [[Novo plano]].
2. Informe nome, mensalidade, limite de usuários e recursos. Para cortesia, marque [[Plano gratuito]].
3. Clique em [[Criar plano]].
4. Em [[Empresas]], escolha a empresa, clique em [[Plano personalizado]] e confira a prévia.
5. Informe o motivo e clique em [[Confirmar vínculo]].

Alterar o plano depois não muda contratos já vinculados: cada contrato guarda uma cópia dos termos.

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Usar o Financeiro completo | {sim} | {nao} |
| Informar custo do produto | {sim} | {lib} |
| Ver custos e margens | {sim} | {lib} |
| Gerenciar fornecedores | {sim} | {nao} |
| Consultar, criar e receber compras | {sim} | {lib} |
| Consultar e pagar contas a pagar | {sim} | {lib} |
| Ver o painel e os relatórios financeiros | {sim} | {lib} |

**Se liberado**: o administrador libera em **Configurações › Usuários e convites › Permissões**, dentro do que o contrato inclui. Planos personalizados são exclusivos da equipe do Lastro.

## Onde saber mais

| Assunto | Manual |
|---|---|
| Navegação, contas a receber e créditos de clientes | Financeiro |
| Cadastro, custo e margem | Produtos |
| Fornecedores, compras e recebimentos | Compras |
| Títulos, despesas, recorrências e créditos de fornecedores | Contas a pagar |
| Painel, fluxo de caixa e resultado | Gestão financeira |
| Planos e permissões | Usuários e permissões |
| Planos personalizados e contratos | Super Admin |
