---
mes: novembro de 2026
slug: contas-a-pagar
modulo: Contas a pagar
titulo: Contas a pagar e despesas
subtitulo: Títulos, pagamentos, despesas avulsas e recorrentes, categorias e créditos de fornecedores.
publico: Administrador, Vendedor (se liberado), Se contratado
resumo: Contas a pagar reúne tudo que a empresa deve, venha de compras, de despesas ou de recorrências. Cada título tem saldo próprio, aceita pagamento parcial e guarda o histórico. Nada é apagado: um estorno fica registrado junto do pagamento original.
administrador: Lança despesas e recorrências, registra pagamentos e estornos e usa os créditos de fornecedores.
vendedor: Só acessa se o administrador liberar. Estornos e créditos seguem a mesma liberação.
---

## Onde fica

Em [[Financeiro]], escolha [[Contas a pagar]]. No celular, toque em [[Seções]] para trocar de área. Disponível quando o contrato da empresa inclui esse recurso.

Um título pode nascer de quatro formas:

| Origem | Como nasce | Conta como despesa? |
|---|---|---|
| Compra | Ao confirmar a compra, um título por parcela | Não: chega ao resultado quando a mercadoria é vendida |
| Despesa avulsa | Em [[Nova despesa]] | Sim |
| Despesa recorrente | Gerada pela recorrência | Sim |
| Lançamento manual | Em [[Nova despesa]], tipo [[Outro lançamento]] | Não: fica no caixa, como parcela de empréstimo |

![Títulos a pagar por vencimento.](admin-pagar-1280.png "sem-menu h=120")

Use as visões [[A pagar]], [[Vencidos]], [[Pagos]], [[Cancelados]] e [[Todos]]. Um título aparece como ((Vencido|perigo)) sozinho, quando passa do vencimento com saldo em aberto.

## Lançar uma despesa

1. Em [[Contas a pagar]], clique em [[Nova despesa]].
2. Em **Tipo**, escolha [[Despesa da operação]] ou [[Outro lançamento]].
3. Preencha a **Descrição** e, se quiser, o **Beneficiário**.
4. Informe **Valor**, **Emissão**, **Vencimento** e **Categoria**.
5. Clique em [[Lançar título]].

![Nova despesa.](admin-pagar-nova-1280.png "sem-menu h=125")

:::atencao Compra de mercadoria não é despesa
Para mercadoria, use **Compras**: o título nasce na confirmação e o valor entra no custo dos produtos. Lançar aqui faz a compra aparecer como despesa e deixa o estoque sem custo.
:::

## Registrar um pagamento

1. Abra o título e clique em [[Registrar pagamento]].
2. Confira o **Valor abatido do título**. Valor menor que o saldo deixa o título parcialmente pago.
3. Informe a **Data do pagamento** e a **Forma de pagamento**. A data não pode ser futura.
4. Se houver, preencha **Juros**, **Multa** e **Desconto**. O quadro **Sai do caixa** mostra o total.
5. Clique em [[Registrar pagamento]].

![Pagamento com juros, multa e desconto separados.](admin-pagar-pagamento-1280.png "sem-menu estreita")

![Título parcialmente pago, com o histórico de pagamentos.](admin-pagar-titulo-1280.png "sem-menu h=85")

### Estornar um pagamento

Clique em [[Estornar]] no pagamento e informe o motivo. O saldo do título volta, e o pagamento fica no histórico como estornado.

### Corrigir vencimento ou cancelar

Em **Mais ações**, use [[Corrigir vencimento]] ou [[Cancelar título]]. Título de compra permite corrigir vencimento e observações, mas é cancelado pela própria compra. Título com pagamento só pode ser cancelado depois do estorno.

## Despesas recorrentes

Aluguel, internet e tudo que se repete. Os títulos nascem até 35 dias antes do vencimento.

1. Em [[Financeiro]], escolha [[Despesas recorrentes]].
2. Clique em [[Nova recorrência]].
3. Informe descrição, valor e frequência: mensal, trimestral ou anual.
4. Escolha o dia do vencimento e a data de início. Em mês sem esse dia, o vencimento cai no último dia do mês.
5. Clique em [[Criar recorrência]]. Os títulos próximos já são gerados.

![Despesas recorrentes e categorias.](admin-recorrentes-1280.png "sem-menu h=120")

| Ação | O que acontece |
|---|---|
| Alterar | Vale para títulos futuros em aberto. Títulos pagos ou vencidos ficam como estão. |
| Pausar | Nada novo é gerado. O período da pausa não é cobrado depois. |
| Retomar | Volta a gerar a partir de hoje. |
| Encerrar | Para definitivamente. Títulos já gerados continuam valendo. |

:::dica Gerar títulos agora
O botão gera na hora o que estiver dentro dos 35 dias. Repetir não duplica: cada título é único por recorrência e data.
:::

### Categorias

No fim da tela de recorrências, digite o nome em **Nova categoria** e clique em [[Adicionar]]. As categorias agrupam as despesas nos relatórios.

## Créditos de fornecedores {nova-pagina}

Quando uma compra é encerrada com saldo, o valor pode virar crédito ou valor a recuperar. Veja o manual de Compras.

| Tipo | Quando usar |
|---|---|
| **Crédito do fornecedor** | O fornecedor vai abater em compras futuras. |
| **Valor a recuperar** | Você pagou a mais e espera receber de volta. |

1. Em [[Financeiro]], escolha [[Créditos de fornecedores]].
2. Abra o crédito.
3. Clique em [[Usar em um título]] para compensar um título de compra do mesmo fornecedor. Não há saída de dinheiro.
4. Ou clique em [[Registrar devolução]] quando o fornecedor devolver o dinheiro. O valor entra no caixa.

![Crédito do fornecedor com saldo.](admin-credito-fornecedor-1280.png "sem-menu h=98")

Cada movimentação pode ser desfeita com [[Estornar]], informando o motivo. Ela fica no histórico como estornada e o saldo do crédito volta.

:::atencao Crédito só compensa título de compra
O crédito veio de mercadoria, então não reduz despesas como aluguel ou energia. Também não existe baixa por perda: um crédito que não será recebido continua aparecendo com saldo.
:::

:::nota Depois de uma troca de plano
Se o contrato deixar de incluir compras, os créditos já registrados continuam em **Créditos de fornecedores**, mesmo com saldo zerado, para quem tem permissão de consultar o financeiro. A consulta mostra os créditos e o histórico de cada um. [[Usar em um título]] e [[Registrar devolução]] só aparecem se o contrato incluir contas a pagar. Nada disso permite criar compras ou novos créditos.
:::

## Mensagens comuns

| Mensagem | O que fazer |
|---|---|
| O valor passa do saldo em aberto do título. | Diminua o valor. Juros e multa vão em campos próprios. |
| Título de compra é alterado pela própria compra. | Abra a compra para cancelar ou reabrir. |
| Estorne os pagamentos deste título antes de continuar. | Estorne o pagamento e tente de novo. |
| O crédito só compensa títulos de compra do mesmo fornecedor. | Escolha outro título. |

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Consultar títulos e recorrências | {sim} | {lib} |
| Criar e editar títulos e recorrências | {sim} | {lib} |
| Usar crédito e registrar devolução | {sim} | {lib} |
| Registrar pagamentos | {sim} | {lib} |
| Estornar pagamentos e movimentos de crédito | {sim} | {lib} |

**Se liberado**: o administrador pode liberar em **Configurações › Usuários e convites › Permissões**.
