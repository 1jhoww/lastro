---
slug: devolucoes
modulo: Devoluções
titulo: Devoluções
subtitulo: Registro, recebimento físico e acerto financeiro de mercadoria devolvida pelo cliente.
publico: Administrador
resumo: A devolução acontece em três etapas separadas, e cada uma tem seu efeito. Primeiro você registra o que o cliente vai devolver; depois confirma o que chegou de fato, separando itens vendáveis e danificados; por fim faz o acerto financeiro, que abate parcelas e transforma o que já foi pago em crédito ou reembolso.
administrador: Registra devoluções, recebe a mercadoria, cancela pendências e faz o acerto financeiro.
vendedor: Não registra nem recebe devoluções. Se o cliente quiser devolver, o vendedor avisa o administrador.
---

## As três etapas

| Etapa | Onde | Estoque | Financeiro |
|---|---|---|---|
| 1. Registrar devolução | Pedido › [[Registrar devolução]] | Não muda | Não muda |
| 2. Receber mercadoria | Mesma tela, na devolução aberta | Vendáveis voltam ao físico | Não muda |
| 3. Acertar no financeiro | Financeiro › Devoluções de mercadoria | Não muda | Abate parcelas, gera crédito ou reembolso |

:::nota Só depois da saída
Devolução só existe para pedido ((Expedido|sucesso)). Pedido confirmado que ainda não saiu do estoque deve ser **cancelado**, não devolvido (veja o manual de Pedidos).
:::

## Etapa 1: registrar a devolução

Registre assim que o cliente combinar a devolução, mesmo que a mercadoria ainda não tenha chegado.

1. Abra o pedido expedido em [[Pedidos]].
2. Clique em [[Registrar devolução]]. A tela **Devoluções do pedido** abre.
3. Em **Registrar devolução**, informe a **Quantidade** de cada produto que vai voltar. A tela mostra quanto saiu de cada item.
4. Escreva o **Motivo** (pelo menos 3 caracteres).
5. Clique em [[Revisar devolução]].
6. Leia o aviso "Registrar devolução?": a solicitação não altera estoque nem registra crédito financeiro.
7. Clique em [[Confirmar registro]]. A mensagem "Devolução registrada!" aparece e a devolução fica ((Aguardando recebimento|alerta)).

:::dica
Informe só o que será devolvido. O limite total por item (o que saiu menos o já devolvido) é conferido ao salvar.
:::

## Etapa 2: receber a mercadoria

Faça quando os produtos chegarem e forem conferidos.

1. Abra o pedido e clique em [[Registrar devolução]]. Em **Devoluções registradas**, clique na devolução.
2. Em **Receber mercadoria**, informe para cada produto:
   - **Vendável**: o que voltou em bom estado e pode ser vendido de novo;
   - **Danificado**: o que voltou com avaria.
3. Informe somente o que chegou agora. Se o restante chegar depois, registre outro recebimento.
4. Escreva o **Motivo** e clique em [[Revisar recebimento]].
5. Confira vendáveis e danificados em "Registrar recebimento físico?".
6. Clique em [[Confirmar registro]]. A mensagem "Recebimento físico registrado!" aparece.

**Só os itens vendáveis voltam ao estoque disponível.** Danificados ficam registrados na devolução, mas não entram no estoque vendável.

A situação da devolução muda conforme o recebimento: ((Aguardando recebimento|alerta)), ((Recebimento parcial)), ((Mercadoria recebida|sucesso)) ou ((Encerrada)).

:::irreversivel O recebimento físico não pode ser desfeito
Os itens vendáveis entram no estoque na hora e o registro fica no histórico. Confira as quantidades antes de confirmar. Se errar, corrija o saldo com um ajuste de estoque explicando o motivo.
:::

### O cliente desistiu de devolver o restante

1. Abra a devolução e clique em [[Cancelar quantidades pendentes]].
2. Leia o aviso "Cancelar o que falta receber?".
3. Confirme. A mensagem "Pendência cancelada!" aparece.

Só as quantidades ainda não recebidas são canceladas. Mercadoria já recebida e valores continuam registrados.

## Etapa 3: acerto financeiro

O recebimento físico **não** gera crédito nem reembolso. O acerto é feito no Financeiro.

1. Abra [[Financeiro]] › [[Histórico e operações]] › **Devoluções de mercadoria**. Também dá para usar [[Consultar resolução financeira]] na devolução do pedido.
2. Clique na devolução. A tela **Acerto da devolução** mostra, por item, o que voltou, o que já foi acertado e o que falta.
3. Em **Acertar o que foi devolvido**, confira por item o valor a abater dos produtos em bom estado.
4. Para cada item com avaria, decida:
   - **Abater o valor integral da avaria**;
   - **Abater parte do valor** (informe o valor);
   - **Aceitar a devolução sem abater valor**;
   - **Recusar abatimento da avaria**.
5. Em **O que fazer com o valor já pago**, escolha **Virar crédito do cliente** ou **Reembolsar o cliente**.
6. Em **Como processar**, escolha **De uma vez** ou **Em etapas, com acompanhamento**.
7. Escreva o **Motivo** (obrigatório) e clique em [[Revisar]].
8. Confirme sua senha e clique em [[Confirmar]].
9. A mensagem "Acerto confirmado" mostra o total acertado. Saldos, créditos e reembolsos já foram atualizados.

![Devoluções de mercadoria no Financeiro (lista vazia na demonstração).](admin-financeiro-devolucoes-1280.png "sem-menu h=58")

O Lastro calcula os valores pelo preço registrado no pedido: primeiro abate o que está em aberto nas parcelas; o que já tinha sido pago vai para o destino escolhido.

:::irreversivel Valores aplicados não voltam
Depois que os valores forem aplicados, a operação não pode ser interrompida nem desfeita. O reembolso fica registrado como **a fazer**: o Lastro não transfere dinheiro. Devolva ao cliente por fora e registre em **Financeiro › Reembolsos** (veja o manual do Financeiro).
:::

:::atencao Operação em andamento
Enquanto um acerto em etapas não terminar, outras operações financeiras do pedido ficam bloqueadas. Acompanhe pelo botão [[Acompanhar operação]].
:::

## Acompanhar o histórico

Cada devolução guarda o próprio histórico: devolução solicitada, solicitação alterada, pendência cancelada, recebimento físico registrado e resolução financeira registrada. Abra **Histórico da devolução** na devolução do pedido ou no acerto financeiro.

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Registrar devolução | {sim} | {nao} |
| Receber mercadoria e cancelar pendências | {sim} | {nao} |
| Acertar no financeiro | {sim} | {nao} |

Devoluções são operações administrativas e não podem ser liberadas para vendedores.
