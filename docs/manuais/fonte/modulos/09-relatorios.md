---
slug: relatorios
modulo: Relatórios
titulo: Relatórios
subtitulo: Relatórios de vendas, financeiro e estoque, com filtros e exportação em CSV e PDF.
publico: Administrador, Vendedor (se liberado)
resumo: Os relatórios reúnem os números da empresa em tela, com filtros por período, cliente, produto e vendedor. Cada relatório pode ser baixado em CSV (para planilha) ou PDF (para imprimir ou enviar). Os relatórios só leem dados: nada é alterado.
administrador: Acessa todos os relatórios comerciais, financeiros e de estoque, de toda a empresa, e exporta cadastros em CSV.
vendedor: Só acessa se o administrador liberar. Vê relatórios comerciais dos clientes da própria carteira.
---

## Relatórios disponíveis

| Categoria | Relatório | Filtros |
|---|---|---|
| Comercial | Vendas por período | Período, cliente, produto, vendedor |
| Comercial | Pedidos por status | Período, situação, cliente, vendedor |
| Comercial | Vendas por cliente | Período, vendedor |
| Comercial | Vendas por produto | Período, cliente, produto, vendedor |
| Comercial | Desempenho por vendedor | Período (depende do plano) |
| Financeiro | Contas a receber | Período, situação, cliente |
| Financeiro | Títulos vencidos | Período, cliente |
| Financeiro | Títulos a vencer | Período, cliente |
| Financeiro | Recebimentos por período | Período, cliente |
| Financeiro | Inadimplência por cliente | Período |
| Estoque | Posição de estoque | Situação, produto |
| Estoque | Estoque baixo | Situação |
| Estoque | Sem estoque | Situação |
| Estoque | Movimentações de estoque | Período, produto, tipo de movimentação |

:::perfil
As categorias **Financeiro** e **Estoque** só aparecem para quem tem acesso a esses módulos (na prática, o administrador). O vendedor com relatórios liberados vê a categoria **Comercial**, com os clientes da própria carteira.
:::

## Gerar um relatório

1. No menu lateral, clique em [[Relatórios]].
2. Escolha a **Categoria**: [[Comercial]], [[Financeiro]] ou [[Estoque]].
3. Escolha o relatório nas opções logo abaixo (por exemplo, [[Por cliente]] ou [[Vencidos]]).
4. Em **Período**, escolha [[Padrão]], [[Este mês]], [[Mês anterior]], [[Últimos 30 dias]], [[Este ano]] ou [[Personalizado]]. No personalizado, informe **De** e **Até**.
5. Ajuste os outros filtros do relatório: situação, cliente, produto, responsável ou tipo de movimentação.
6. Veja o resultado na tela. Abaixo da tabela, use [[Anterior]] e [[Próxima]] para navegar entre as páginas.

![Relatórios: categoria, relatório, filtros e resultado.](admin-relatorios-1280.png "sem-menu h=84")

:::dica O que é o período "Padrão"
Cada relatório tem um período padrão, mostrado logo abaixo do campo. Por exemplo: mês atual até hoje nas vendas, próximos 30 dias em títulos a vencer e vencidos nos últimos 12 meses em títulos vencidos.
:::

:::atencao
A data final precisa ser igual ou posterior à inicial. Se a consulta for grande demais, o Lastro avisa ("Consulta grande demais"): reduza o período ou use mais filtros.
:::

## Baixar em CSV ou PDF

1. Gere o relatório com os filtros desejados.
2. No topo do relatório, clique em [[CSV]] para abrir em planilha ou em [[PDF]] para imprimir ou enviar.
3. O arquivo traz o resultado completo dos filtros, não só a página mostrada na tela.

O PDF traz o nome da empresa e a marca do Lastro. No plano Profissional, o logotipo da empresa também aparece no topo (veja o manual Usuários e permissões).

Os botões ficam desativados enquanto o relatório não carregou ou se o período estiver inválido.

## Exportar cadastros em CSV

Para levar listas completas para uma planilha, use a exportação de cadastros.

1. Em [[Relatórios]], clique em [[Exportar cadastros em CSV]], no fim da página.
2. Em **Dados**, escolha [[Clientes]], [[Produtos]], [[Pedidos]] ou [[Recebíveis]].
3. Ajuste os filtros: situação, início do nome, SKU, responsável, vencimento e ordem, conforme o tipo de dado.
4. Informe quantos **Registros por arquivo** quer baixar.
5. Clique em [[Obter página CSV]]. A tela mostra quantos registros vieram e se "Há continuação.".
6. Se houver continuação, clique em [[Próxima página CSV]] para baixar o arquivo seguinte. Para começar de novo, clique em [[Reiniciar exportação]].

![Exportação de cadastros em CSV.](admin-relatorios-exportacoes-1280.png "sem-menu h=74")

:::nota Abrindo o CSV na planilha
O arquivo usa UTF-8 com BOM, ponto e vírgula como separador e datas no formato brasileiro, e abre direto no Excel ou no Google Planilhas. Alguns textos começam com apóstrofo: é uma proteção contra fórmulas, não apague. Cada arquivo é uma página; a exportação não soma totais entre arquivos.
:::

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Relatórios comerciais | {sim:Toda a empresa} | {lib:Da carteira} |
| Relatórios financeiros | {sim} | {nao} |
| Relatórios de estoque | {sim} | {nao} |
| Baixar CSV e PDF dos relatórios | {sim} | {lib} |
| Exportar recebíveis | {sim} | {nao} |

**Se liberado**: o administrador pode liberar "Relatórios · Visualizar e exportar" para o vendedor em **Configurações › Usuários e convites › Permissões**. Relatórios financeiros e de estoque exigem acesso a esses módulos.
