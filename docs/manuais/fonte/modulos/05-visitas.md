---
slug: visitas
modulo: Visitas
titulo: Visitas e recompra
subtitulo: Registro de visitas e contatos com clientes, histórico de atendimento e estimativa de recompra.
publico: Administrador, Vendedor
resumo: O módulo Visitas guarda o relacionamento com cada cliente: visitas presenciais, contatos remotos e entregas confirmadas. A partir dos pedidos confirmados, o Lastro também estima quando cada cliente deve voltar a comprar. Visitas é um recurso do plano Profissional; se o menu não aparecer, o plano contratado não inclui o módulo.
administrador: Vê os atendimentos de toda a empresa, filtra por responsável e registra visitas em nome de qualquer usuário ativo.
vendedor: Registra e consulta visitas dos clientes da própria carteira. O atendimento fica registrado em nome dele.
---

## O que é uma visita no Lastro

Uma **visita comercial** é o registro de um atendimento ao cliente, presencial ou remoto, com data, responsável e observações.

- Registrar visita **não cria pedido**, não mexe no estoque e não gera financeiro.
- Uma visita pode, se você quiser, ficar ligada a um pedido do mesmo cliente.
- Quando a entrega de um pedido é confirmada, o Lastro cria sozinho um registro de **Entrega confirmada** no histórico do cliente.

O menu [[Visitas]] tem duas seções: [[Visitas]] (lista de atendimentos) e [[Recompra]] (estimativas por cliente).

## Consultar os atendimentos

1. Clique em [[Visitas]] no menu lateral. No celular, o módulo fica em **Mais**.
2. Em **Origem**, escolha [[Todas]], [[Manuais]] (visitas e contatos registrados por pessoas) ou [[Entregas]] (registros automáticos de entrega).
3. O administrador pode escolher um **Responsável**.
4. Use os campos de data **De** e **Até** para limitar o período.
5. Cada linha mostra data, cliente, tipo de atendimento, responsável, pedido relacionado e observações. Clique no pedido para abri-lo.

![Lista de visitas com filtros por origem, responsável e período.](admin-visitas-1280.png "sem-menu h=80")

## Registrar uma visita

1. Clique em [[Registrar visita]]. O botão fica na lista de Visitas e no **Histórico de relacionamento** da ficha do cliente (nesse caso, o cliente já vem escolhido).
2. Escolha o **Cliente** atendido.
3. Informe a **Data da visita**. Ela não pode estar no futuro.
4. Em **Tipo de atendimento**, escolha [[Visita presencial]] ou [[Contato remoto]].
5. O administrador escolhe o **Responsável** (quem realizou o atendimento). Para o vendedor, o atendimento fica em nome dele.
6. Em **Observações do atendimento**, descreva o que foi tratado, combinados e próximos passos (pelo menos 3 caracteres).
7. Em **Pedido relacionado**, escolha um pedido do cliente ou deixe **Sem pedido relacionado**. Nem toda visita resulta em pedido.
8. Clique em [[Registrar visita]]. A mensagem "Visita registrada" aparece.

![Formulário de registro de visita.](admin-visita-nova-1280.png "sem-menu h=84")

:::atencao Confira antes de registrar
A tela não oferece edição nem exclusão de visitas. Revise cliente, data e observações antes de clicar em **Registrar visita**.
:::

### Mensagens comuns

| Mensagem | O que fazer |
|---|---|
| A data da visita não pode estar no futuro. | Use a data de hoje ou uma data anterior. |
| O pedido escolhido não pertence a este cliente. | Escolha outro pedido ou deixe sem pedido. |
| Cliente não encontrado na sua carteira. | O cliente pode ter sido transferido para outro vendedor. |
| O responsável escolhido não está mais ativo na empresa. | Escolha outro responsável. |

## Estimativa de recompra

A seção [[Recompra]] mostra, para cada cliente ativo, quando ele deve voltar a comprar.

- **Última compra**: data do último pedido confirmado.
- **Frequência estimada**: mediana dos intervalos entre compras confirmadas nos últimos 12 meses (por exemplo, "A cada 30 dias").
- **Estimativa de recompra**: última compra mais a frequência estimada.

São necessárias pelo menos 3 compras confirmadas no último ano para estimar. A estimativa é uma referência, não uma garantia de novo pedido.

1. Abra [[Visitas]] › [[Recompra]].
2. Busque o cliente pelo nome ou use **Situação**: ((Estimativa vencida|alerta)), ((Dentro do intervalo|sucesso)) ou ((Sem histórico suficiente)). O número entre parênteses mostra quantos clientes há em cada situação.
3. O administrador pode filtrar por vendedor ou por **Sem responsável**.
4. Comece pelos clientes com **Estimativa vencida**: a data provável de recompra já passou.

![Recompra: estimativas por cliente, ordenadas por situação.](admin-recompra-1280.png "sem-menu h=80")

:::dica Rotina sugerida
Toda semana, abra [[Recompra]], filtre **Estimativa vencida** e registre uma visita ou contato para cada cliente atendido.
:::

## Histórico do cliente

Na ficha do cliente, o painel **Histórico de relacionamento** reúne visitas, entregas e compras, das mais recentes para as mais antigas:

- ((Visita manual|destaque)): visitas e contatos registrados;
- ((Entrega confirmada)): criada pela confirmação de entrega do pedido;
- ((Compra confirmada|sucesso)): pedidos confirmados.

O painel **Compras e recompra**, ao lado, mostra a última compra, a última entrega confirmada, a frequência e a estimativa.

:::nota Transferência de carteira
Quando um cliente muda de vendedor, as visitas e entregas já registradas continuam no histórico do cliente.
:::

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Consultar visitas | {sim:Todas} | {pad:Da carteira} |
| Registrar visita | {sim} | {pad:Em seu nome} |
| Escolher outro responsável | {sim} | {nao} |
| Ver recompra | {sim:Todos} | {pad:Da carteira} |

O módulo só aparece quando o plano contratado inclui **Visitas e recompra** (plano Profissional). Para o vendedor, a permissão também exige acesso à carteira de clientes.
