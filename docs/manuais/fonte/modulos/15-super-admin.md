---
mes: novembro de 2026
slug: super-admin
modulo: Super Admin
titulo: Super Admin e planos personalizados
subtitulo: Ofertas exclusivas, contratos individuais, cortesias e cobrança.
publico: Equipe do Lastro (Super Admin)
resumo: Este manual explica como a equipe do Lastro cria planos personalizados, vincula empresas, altera contratos e registra cortesias sem mudar os planos oficiais.
administrador: Não acessa a área do Super Admin. Vê apenas o nome do plano, as vagas e os recursos contratados.
vendedor: Não acessa a área do Super Admin nem vê dados de contrato.
---

## O que é um plano personalizado

Um plano personalizado é uma oferta negociada com uma ou mais empresas específicas, com valor, limite de usuários e recursos próprios.

- Não aparece nos preços públicos.
- Não altera os planos Essencial, Profissional e Gestão.
- Só o Super Admin cria, altera ou vincula. Administradores da empresa não têm acesso.

O plano é um **modelo**. Ao vincular uma empresa, o contrato recebe uma **cópia** dos termos. Alterar o modelo depois não muda o que a empresa contratou.

:::nota Recurso contratado e permissão do usuário
O plano define o que a empresa contratou. Dentro disso, o administrador da empresa decide o que cada vendedor pode usar. O backend confere os dois em cada operação.
:::

## O que todo plano inclui

Todo plano personalizado inclui, sem opção de retirar, a mesma base do Essencial:

- clientes e pedidos;
- produtos e estoque;
- contas a receber;
- relatórios comerciais;
- dados da empresa e equipe.

Confirmar um pedido gera parcelas e movimenta o estoque. Por isso nenhuma oferta retira esses módulos. Os demais recursos são escolhidos por categoria.

## Criar um plano

1. Abra [[Planos personalizados]] e clique em [[Novo plano]].
2. Em **Partir de um plano oficial**, escolha um modelo ou [[Começar do zero]]. O modelo copia recursos, valor e limite; o plano oficial não muda.
3. Informe o nome e a descrição interna.
4. Informe a mensalidade negociada e o limite de usuários, ou marque [[Plano gratuito]].
5. Selecione os recursos.
6. Confira o **Resumo da oferta** e clique em [[Criar plano]].

![Início do formulário de nova oferta, com o resumo ao lado.](super-plano-novo-1280.png "sem-menu h=100")

:::atencao O nome é visível para a empresa
A empresa vê o **nome do plano** na área de usuários. A **descrição interna** só aparece para o Super Admin.
:::

Limite acima de 1 sem **Convite de usuários adicionais** é aceito, mas só o Super Admin preenche as demais vagas. O resumo mostra esse aviso.

## Dependências entre recursos

Alguns recursos só funcionam junto com outros. A tela cuida disso e avisa o que mudou:

- ao marcar um recurso, o que ele exige entra junto, com o aviso **Incluídos automaticamente**;
- ao desmarcar um recurso, o que depende dele sai junto, com o aviso **Retirados junto**.

| Recurso                               | Exige                                             |
| ------------------------------------- | ------------------------------------------------- |
| Vendedores e carteiras de clientes    | Convite de usuários adicionais                    |
| Compras e recebimento de mercadorias  | Fornecedores, Custos de aquisição, Contas a pagar |
| Despesas recorrentes                  | Contas a pagar                                    |
| Dashboard financeiro e fluxo de caixa | Contas a pagar, Custos de aquisição               |
| Relatórios financeiros                | Contas a pagar, Custos de aquisição               |

O backend também confere as dependências. Uma combinação incompleta não é salva. **Convite de usuários adicionais** exige limite de pelo menos 2 usuários.

## O que a empresa enxerga

A empresa só vê o que contratou e o que o perfil de cada usuário permite. Recurso fora do contrato não aparece no menu nem nas configurações, sem cadeado ou oferta de outro plano. Uma tentativa por link direto é recusada pelo backend.

Depois de um downgrade, os dados do recurso retirado continuam guardados. Eles voltam a aparecer se o recurso for contratado de novo.

Créditos de fornecedores são a exceção: quem tem permissão de consultar o financeiro continua vendo os créditos já registrados e o histórico deles, mesmo sem compras no contrato e com saldo zerado. A consulta não permite criar compras nem novos créditos.

## Plano gratuito

Use o plano gratuito para cortesias e contratos especiais. Marque [[Plano gratuito]] ao criar a oferta. Sem essa marca, uma oferta sem valor não é salva. Isso evita cortesia por engano.

Um contrato também pode ficar gratuito com valor R$ 0,00 em [[Alterar contrato]] ou ao negociar o valor no vínculo.

| Situação                                     | O que acontece                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Contrato gratuito                            | Nenhuma cobrança automática e nenhum próximo vencimento.                                 |
| Cobranças já emitidas antes de zerar o valor | Continuam abertas. Cancele em [[Cobranças]] as que não forem devidas.                    |
| Contrato gratuito que passa a pagar          | O início da cobrança muda para a data da alteração. Os meses gratuitos não são cobrados. |
| Contrato gratuito que vai para plano oficial | O valor não é herdado. O preço oficial vem sugerido, e outro valor exige confirmação.    |
| Cobrança manual em contrato gratuito         | Aceita com valor combinado e motivo, como implantação. Sem valor, é recusada.            |
| Receita mensal do painel                     | Contrato gratuito soma R$ 0,00.                                                          |

### Sair do gratuito para um plano oficial {nova-pagina}

1. Na empresa, clique em [[Trocar plano]] e escolha o plano.
2. Confira o aviso **Contrato gratuito**, que mostra o preço oficial do plano.
3. Para usar esse preço, informe o motivo e clique em [[Confirmar troca]].
4. Para uma condição especial, marque [[Conceder condição especial]] e informe o **Valor negociado**.
5. Marque a confirmação do valor. Se mudar o valor, confirme de novo.

![Condição especial na saída de um contrato gratuito, com o valor confirmado.](super-gratuito-oficial-1280.png "estreita")

A cobrança começa na data da troca. Cobranças já emitidas não mudam. Em contrato pago, o valor continua o mesmo, a menos que você marque [[Alterar o valor mensal]].

## Vincular uma empresa {nova-pagina}

Na empresa, use [[Plano personalizado]]. O mesmo caminho atende quatro situações: primeiro contrato personalizado, migração de um plano oficial, substituição por outro personalizado e atualização para a versão nova da mesma oferta.

1. Abra [[Empresas]] e escolha a empresa.
2. Clique em [[Plano personalizado]] e escolha a oferta.
3. Confira a prévia: vagas, recursos ganhos e recursos perdidos.
4. Confirme cada recurso que a empresa perderá.
5. Se negociou outro valor, marque [[Negociar outro valor]].
6. Informe o motivo e clique em [[Confirmar vínculo]].

![Vínculo com prévia de vagas e de recursos perdidos.](super-vinculo-1280.png "h=110")

Limites e recursos mudam na hora. Se a empresa ocupar mais vagas do que o plano permite, o vínculo fica bloqueado até liberar vagas. Ninguém é desativado automaticamente.

Para criar uma empresa já em plano personalizado, escolha a oferta em [[Nova empresa]]. Só ofertas ativas aparecem.

## Alterar um contrato

[[Alterar contrato]] muda valor, limite e recursos de **uma única empresa**. A oferta de origem e as outras empresas não mudam.

1. Na empresa, clique em [[Alterar contrato]].
2. Ajuste valor, limite ou recursos.
3. Confirme os recursos perdidos, se houver.
4. Informe o motivo e marque a confirmação da alteração individual.
5. Clique em [[Salvar contrato]].

O painel **Contrato personalizado** mostra a versão contratada e as diferenças em relação ao contratado e à oferta atual.

![Contrato personalizado com a versão e as diferenças.](super-contrato-1280.png)

## Editar, duplicar e desativar um plano

| Ação          | Efeito                                                                                 |
| ------------- | -------------------------------------------------------------------------------------- |
| [[Editar]]    | Cria nova versão da oferta para os próximos contratos. Contratos existentes não mudam. |
| [[Duplicar]]  | Cria outra oferta com os mesmos termos, sem empresas vinculadas.                       |
| [[Desativar]] | Impede novos contratos. Empresas vinculadas continuam com acesso e termos atuais.      |
| [[Reativar]]  | Volta a aceitar novos contratos.                                                       |

Na tela do plano, **Empresas vinculadas** mostra a versão de cada contrato. O selo ((Oferta mudou|alerta)) indica que há versão mais nova. O selo ((Ajustado|destaque)) indica alteração individual.

![Plano com empresas vinculadas e histórico.](super-plano-detalhe-1280.png)

## Encerrar ou substituir um contrato

Para substituir, vincule outro plano personalizado ou use [[Trocar plano]] para voltar a um plano oficial. Para interromper o acesso, use [[Suspender]]: nenhum dado é apagado, e [[Reativar]] devolve o acesso.

## Histórico

Toda criação e alteração fica registrada com autor, data, valores anteriores e novos. Alterações de contrato exigem motivo. Consulte **Histórico** na tela do plano e **Histórico da assinatura** na tela da empresa.

## Quem pode fazer o quê

| Operação                                                | Super Admin | Administrador | Vendedor |
| ------------------------------------------------------- | :---------: | :-----------: | :------: |
| Criar, editar, duplicar e desativar plano personalizado |    {sim}    |     {nao}     |  {nao}   |
| Vincular empresa e alterar contrato                     |    {sim}    |     {nao}     |  {nao}   |
| Registrar plano gratuito                                |    {sim}    |     {nao}     |  {nao}   |
| Ver nome do plano, vagas e recursos contratados         |    {sim}    |     {sim}     |  {nao}   |
| Definir permissões de vendedores dentro do contrato     |    {nao}    |     {sim}     |  {nao}   |
