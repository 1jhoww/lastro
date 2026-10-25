---
slug: financeiro
modulo: Financeiro
titulo: Financeiro
subtitulo: Contas a receber, pagamentos, correção de vencimentos, estornos, créditos, reembolsos e cancelamentos.
publico: Administrador
resumo: O Financeiro acompanha o dinheiro que os clientes devem à empresa. As parcelas nascem da confirmação dos pedidos; aqui você registra o que foi pago, corrige vencimentos e lançamentos e trata créditos, reembolsos e cancelamentos. Nenhuma operação do Lastro transfere dinheiro de verdade: o sistema registra o que aconteceu fora dele.
administrador: Acessa todo o Financeiro: consulta parcelas, registra pagamentos, corrige vencimentos, estorna, usa créditos, registra reembolsos, cancela pedidos no financeiro e cadastra condições e formas de pagamento.
vendedor: Não acessa o Financeiro. Ao abrir o módulo, vê o aviso de acesso negado. Consulta condição e parcelas pela ficha dos próprios pedidos.
---

## Antes de começar

Alguns termos aparecem em todo o módulo:

| Termo | O que é |
|---|---|
| Parcela (título) | Valor a receber de um pedido confirmado, com vencimento e saldo próprios. |
| Condição de pagamento | Regra de prazos: quando o cliente paga (à vista, 30 dias, 30/60/90…). |
| Forma de pagamento | Como o cliente paga: Pix, dinheiro, transferência, cartão, boleto ou outra. |
| Pagamento (recebimento) | Registro do dinheiro que entrou, com data e forma. |
| Estorno | Desfaz um pagamento ou um uso de crédito registrado por engano. O registro original fica no histórico. |
| Crédito do cliente | Valor que o cliente pode usar em parcelas futuras. Nasce de cancelamento ou devolução. |
| Reembolso | Valor que a empresa precisa devolver ao cliente. O Lastro só registra a devolução feita por fora. |

:::atencao O Lastro não movimenta dinheiro
Registrar pagamento, estorno ou reembolso não faz Pix, transferência nem cobrança. Primeiro o dinheiro entra ou sai pelo banco; depois você registra no Lastro.
:::

## Navegar pelo Financeiro

Clique em [[Financeiro]] no menu lateral. As abas no topo levam às seções:

- [[Visão geral]]: quanto falta receber e o que vence em breve.
- [[Contas a receber]]: parcelas dos clientes e registro de pagamentos.
- [[Condições e formas]]: prazos de pagamento e formas aceitas.
- [[Créditos]], [[Reembolsos]] e [[Histórico e operações]]: consultas e operações ocasionais.

No celular, toque no nome da seção atual para trocar de seção.

### Visão geral

A Visão geral mostra os indicadores **Total a receber**, os títulos vencidos, **Vence em 7 dias** e o **Recebido** no mês atual, já descontados os estornos. Abaixo ficam **Próximos vencimentos** (vencidos primeiro), **Recebimentos recentes** e o quadro **Precisa de atenção**, com reembolsos a registrar e operações em andamento.

![Visão geral do Financeiro, com indicadores e próximos vencimentos.](admin-financeiro-1280.png "sem-menu h=84")

## Cadastrar condições e formas de pagamento

Faça este cadastro antes dos primeiros pedidos. Condições aparecem para escolha ao criar um pedido; formas aparecem ao registrar um pagamento.

### Nova condição de pagamento

1. Abra [[Financeiro]] › [[Condições e formas]] e escolha [[Condições de pagamento]].
2. Clique em [[Nova condição]].
3. Informe o **Nome** (por exemplo, "30/60/90").
4. Em **Prazos**, escolha um modelo pronto ([[À vista]], [[30 dias]], [[30 e 60]], [[30, 60 e 90]]) ou [[Personalizada]].
5. Na condição personalizada, ajuste os **Dias** de cada parcela (dias após a confirmação do pedido) e use [[Adicionar parcela]] quando precisar.
6. Deixe marcado **Dividir o valor em partes iguais**, ou informe a parte de cada parcela (por exemplo, 1 e 2 = um terço e dois terços).
7. Confira a prévia "Exemplo: pedido de … confirmado hoje".
8. Clique em [[Criar condição]]. A mensagem confirma que ela já está disponível para novos pedidos.

:::nota
Os vencimentos contam a partir da confirmação do pedido, em dias corridos, sem ajuste para fins de semana ou feriados.
:::

### Nova forma de pagamento

1. Em [[Condições e formas]], escolha [[Formas de pagamento]].
2. Clique em [[Nova forma]].
3. Escolha o **Tipo**: Pix, Dinheiro, Transferência, Cartão, Boleto ou Outra.
4. Informe o **Nome** (por exemplo, "Pix Banco do Brasil").
5. Clique em [[Criar forma]].

Para tirar uma condição ou forma de uso, abra o cadastro e desmarque **Disponível para novos pedidos** (condição) ou **Disponível para registrar pagamentos** (forma). Desativar não altera pedidos nem pagamentos já registrados.

## Consultar as contas a receber

1. Abra [[Financeiro]] › [[Contas a receber]].
2. Escolha a situação: [[A receber]], [[Vencidos]], [[Quitados]] ou [[Todos]].
3. Para filtrar, use [[Cliente]] ou [[Período]] (**Vencimento de** e **Vencimento até**). Para tirar o período, clique em [[Limpar período]].
4. Clique em uma parcela para abrir a ficha e registrar o pagamento.

![Contas a receber: cada linha é uma parcela, com vencimento, situação, valor, recebido e saldo.](admin-financeiro-receber-1280.png "sem-menu h=84")

As situações mais comuns são ((Vencido|perigo)), ((Vence hoje|alerta)), ((A vencer)), ((Parcial|destaque)) e ((Quitado|sucesso)). O pagamento parcial mantém a parcela em aberto com o saldo restante.

## Registrar um pagamento (baixa)

Use quando o cliente pagar uma parcela, no todo ou em parte.

1. Em [[Contas a receber]], abra a parcela. A ficha mostra o **Saldo a receber** e o vencimento.
2. Clique em [[Registrar pagamento]].
3. Confira o **Valor recebido**. Ele começa com o saldo da parcela; diminua se o pagamento for parcial. O valor não pode passar do saldo.
4. Escolha a **Forma de pagamento**. Se o pedido tinha forma prevista, o Lastro mostra "Previsto no pedido: …"; confira como o cliente pagou de fato.
5. Informe a **Data do pagamento**: o dia em que o dinheiro entrou. Ela não pode ser futura.
6. Se quiser, abra **Mais detalhes** e preencha a **Referência** (código do Pix ou número do comprovante) e a **Observação** (fica no histórico).
7. Clique em [[Registrar pagamento]] e revise o resumo, que mostra o saldo depois do pagamento.
8. Clique em [[Confirmar pagamento]]. A mensagem "Pagamento registrado!" aparece e o saldo é atualizado.

:::irreversivel O pagamento só é desfeito por estorno
Depois de confirmado, o pagamento não pode ser editado nem apagado. Se ele foi lançado errado, faça um **estorno** (seção a seguir) e registre o pagamento correto.
:::

:::atencao "Ainda não sabemos se o pagamento foi registrado"
Se a conexão cair na confirmação, **não lance de novo**. Clique em [[Conferir pagamento]]: se ele já foi gravado, nada é duplicado.
:::

:::nota Sem forma de pagamento cadastrada
Se aparecer "Nenhuma forma de pagamento ativa", cadastre ao menos uma em [[Condições e formas]] antes de registrar pagamentos.
:::

## Corrigir o vencimento de uma parcela {nova-pagina}

Use quando a data de uma parcela precisa mudar depois da confirmação do pedido: um novo prazo combinado com o cliente, uma data digitada errado ou uma parcela vencida que será paga em outra data. Não é preciso cancelar e recriar o pedido.

![Ficha da parcela, com o vencimento atual e o botão Alterar vencimento.](admin-parcela-1280.png "sem-menu h=66")

1. Abra [[Financeiro]] › [[Contas a receber]] e clique na parcela.
2. Abaixo do **Saldo a receber** e do vencimento atual, clique em [[Alterar vencimento]].
3. Em **Novo vencimento**, digite a data (DD/MM/AAAA) ou escolha no calendário. A dica abaixo do campo mostra o intervalo permitido.
4. Em **Motivo**, explique a alteração (por exemplo, "combinado com o cliente"). O motivo é obrigatório.
5. Clique em **Confirmar** seguido da nova data.
6. Aguarde o aviso "Vencimento alterado", que mostra a data anterior e a nova.

![Janela Alterar vencimento com a nova data, o motivo e o intervalo permitido.](admin-alterar-vencimento-janela.png "estreita")

:::nota O que muda e o que não muda
Muda só a data da parcela. Valores, pagamentos já registrados, saldo e estoque continuam iguais. A nova data passa a valer na ficha do pedido, nas listas, nos filtros, no painel Início e nos relatórios.
:::

### Regras da nova data

- Hoje ou uma data futura.
- Não antes do vencimento da parcela anterior nem depois do vencimento da parcela seguinte do mesmo pedido. Para afastar mais uma parcela, corrija primeiro a seguinte.
- Diferente do vencimento atual.
- O motivo precisa ter de 3 a 500 caracteres.

### Quando o botão fica indisponível

| Situação | Por quê |
|---|---|
| Parcela ((Quitado\|sucesso)) | Não há saldo a receber. |
| Parcela cancelada ou pedido cancelado | A parcela não existe mais para cobrança. |
| Devolução do pedido em andamento | O financeiro do pedido fica bloqueado até a devolução terminar. |
| Operação financeira em andamento | Aguarde a operação terminar e clique em [[Atualizar]]. |

Parcelas ((A vencer)), ((Vence hoje|alerta)), ((Vencido|perigo)) e ((Parcial|destaque)) podem ter o vencimento corrigido.

### Histórico e auditoria

Toda correção fica registrada e não pode ser apagada:

- na ficha da parcela, em **Correções de vencimento**, com a data anterior, a nova, quando foi feita e o motivo;
- no **Histórico do pedido**, como "Vencimento corrigido", com o responsável e o motivo;
- no registro de auditoria da empresa, com quem fez, quando, as duas datas e o motivo.

:::atencao "Vencimento não alterado"
Se outra pessoa alterou o pedido ou a parcela enquanto a janela estava aberta, a correção é recusada sem mudar nada. Feche a janela, clique em [[Atualizar]] e repita.
:::

## Outras ações da parcela

Na ficha da parcela, o quadro **Outras ações** traz operações para situações específicas. Elas abrem o **Financeiro do pedido**, onde ficam todas as operações daquele pedido.

### Estornar um pagamento

Use quando um pagamento foi registrado por engano, por exemplo em duplicidade.

1. Na parcela, clique em [[Estornar um pagamento]].
2. Em **Pagamento a estornar**, escolha o pagamento.
3. Escolha a **Parcela** e informe o **Valor** a estornar.
4. Escreva o **Motivo** (pelo menos 3 caracteres; por exemplo, "pagamento lançado em duplicidade").
5. Clique em [[Revisar]] e confira o que acontece: o saldo da parcela volta a ficar em aberto.
6. Digite sua **Senha** e clique em [[Confirmar]]. Estornos e reembolsos pedem senha recente.
7. Clique em [[Confirmar estorno]].

:::irreversivel O estorno não pode ser desfeito
O pagamento não é apagado: fica no histórico como estornado. Se você estornou por engano, registre um novo pagamento com os dados corretos.
:::

### Usar o crédito do cliente

O crédito só existe quando houve cancelamento ou devolução anterior. Ele nunca é usado sozinho.

1. Na parcela, clique em [[Usar crédito do cliente]].
2. Em **Crédito a usar**, escolha a origem do crédito.
3. Escolha a **Parcela** e informe o **Valor**.
4. Escreva o **Motivo**, clique em [[Revisar]] e depois em [[Usar crédito]].

Para desfazer um uso de crédito, use **Estornar uso de crédito** no Financeiro do pedido: o valor volta ao crédito do cliente e a parcela fica em aberto de novo.

## Reembolsos

Um reembolso a fazer surge quando um pedido pago é cancelado ou uma devolução é acertada como reembolso.

1. Devolva o dinheiro ao cliente **por fora** do Lastro (Pix, transferência…).
2. Abra [[Financeiro]] › [[Reembolsos]]. Use o filtro de situação e o filtro de cliente, se precisar.
3. Clique no reembolso. O Financeiro do pedido abre na operação **Registrar reembolso já feito**.
4. Escolha o **Reembolso pendente** e informe o **Valor**.
5. Informe **Como o dinheiro foi devolvido**, a **Data da devolução** e o **Comprovante** (código do Pix ou número da transferência).
6. Marque **Confirmo que o dinheiro já foi devolvido ao cliente fora do Lastro**.
7. Escreva o **Motivo** e clique em [[Revisar]].
8. Confirme a senha e clique em [[Registrar reembolso]].

A lista de Reembolsos mostra a situação de cada valor: ((A devolver|alerta)), ((Devolvido em parte|alerta)) ou ((Devolução registrada|sucesso)).

:::irreversivel O registro do reembolso não transfere dinheiro
Registre somente depois de devolver o dinheiro de fato. O registro documenta a devolução e não pode ser apagado.
:::

## Créditos de clientes

1. Abra [[Financeiro]] › [[Créditos]].
2. Clique em [[Escolher cliente]]. Os créditos são sempre de um cliente específico.
3. Veja o **Crédito disponível**, as origens (cancelamento ou devolução de pedido) e o histórico de uso.
4. Em **Usar crédito em uma parcela**, abra uma parcela em aberto do cliente para escolher o valor.

## Cancelamento financeiro de um pedido

Use apenas quando um pedido **confirmado e ainda não expedido** não será entregue e já tem pagamento registrado. O cancelamento comum de pedido é recusado nesses casos.

1. Abra o pedido e clique em [[Abrir financeiro do pedido]].
2. Abra **Operações excepcionais**.
3. Em **O que fazer com o valor já pago**, escolha:
   - **Virar crédito do cliente**: o valor fica disponível para compras futuras.
   - **Reembolsar o cliente**: fica registrado um reembolso a fazer; o dinheiro é devolvido por fora.
4. Em **Como processar**, escolha **De uma vez** (pedidos com poucos pagamentos) ou **Em etapas, com acompanhamento**.
5. Escreva o **Motivo** (obrigatório, fica no histórico) e clique em [[Revisar]].
6. Confirme a senha. Confira os valores: o Lastro abate o que está em aberto e destina o que já foi pago.
7. Confirme a operação.

Como o pedido ainda não foi expedido, o estoque reservado volta a ficar disponível.

:::irreversivel Depois de aplicados os valores, não há volta
O pedido fica cancelado e os valores aplicados não podem ser desfeitos. Confira cliente, total e destino do valor pago antes de confirmar.
:::

### Operações em etapas

Cancelamentos e devoluções grandes podem ser processados em etapas. Acompanhe em [[Histórico e operações]] › **Operações em andamento** ou pelo botão [[Acompanhar operação]]. Enquanto a operação não terminar, pagamentos, créditos e estornos daquele pedido ficam bloqueados, e os saldos anteriores continuam valendo.

## Financeiro do pedido

Na ficha de qualquer pedido, o administrador vê o painel **Financeiro do pedido** e o botão [[Abrir financeiro do pedido]]. A tela reúne:

- os saldos: **Recebido em dinheiro**, **Pago com crédito**, **Dinheiro que virou crédito ou reembolso** e **Em aberto**;
- os pagamentos, créditos usados e reembolsos do pedido;
- **Outras ações**: usar crédito, estornar pagamento, estornar uso de crédito e registrar reembolso já feito;
- **Desconto do pedido** (somente em rascunho) e **Operações excepcionais**;
- **Verificação técnica**, que confere a integridade dos registros sem alterar nada.

Se uma ação estiver indisponível, o Lastro explica o motivo logo abaixo do botão (por exemplo, "Nenhum pagamento que possa ser estornado").

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Visualizar parcelas, pagamentos, créditos e reembolsos | {sim} | {nao} |
| Registrar pagamentos e usar créditos | {sim} | {nao} |
| Corrigir vencimentos de parcelas | {sim} | {nao} |
| Estornar pagamentos e usos de crédito | {sim} | {nao} |
| Cancelar pedido no financeiro | {sim} | {nao} |
| Registrar reembolsos | {sim} | {nao} |
| Cadastrar condições e formas de pagamento | {sim} | {nao} |

Todas as operações do Financeiro são exclusivas de administradores e não podem ser liberadas para vendedores.
