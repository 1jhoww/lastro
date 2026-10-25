---
slug: usuarios-e-permissoes
modulo: Usuários e permissões
titulo: Usuários e permissões
subtitulo: Equipe, permissões do vendedor, dados e logotipo da empresa e recursos de cada plano.
publico: Administrador
resumo: Este manual explica como dar acesso ao Lastro para a sua equipe, como manter o nome e o logotipo da empresa e o que cada plano inclui. Cada pessoa entra por convite, recebe um perfil (Administrador ou Vendedor) e ocupa uma vaga do plano contratado. O administrador também pode ajustar, uma a uma, as permissões de cada vendedor.
administrador: Convida pessoas, define perfis, liga e desliga permissões de vendedores, desativa e reativa acessos, altera o nome e o logotipo da empresa.
vendedor: Não acessa a tela de Usuários. Em Configurações, só consulta os dados da empresa.
---

## Perfis de acesso

| Perfil | O que faz |
|---|---|
| **Administrador** | Gerencia cadastros, estoque, financeiro, pedidos de todos e a equipe. |
| **Vendedor** | Atende a própria carteira: seus clientes, pedidos e documentos. |

- A empresa precisa ter **pelo menos um administrador ativo**.
- O perfil **Vendedor** e os convites adicionais fazem parte do plano **Profissional**. No plano Essencial, só o perfil Administrador está disponível.
- Cada usuário ativo e cada convite pendente ocupam **uma vaga** do plano. O acesso de suporte do Lastro (selo ((Suporte Lastro|destaque))) não ocupa vaga.

## Configurações

Clique em [[Configurações]] no fim do menu lateral (no celular, em **Mais**). Para o administrador, a tela reúne:

- **Empresa**: nome, logotipo, fuso horário e data de início no Lastro (seção a seguir).
- **Usuários e convites**: a equipe e as vagas do plano.
- **Condições de pagamento**: atalho para **Financeiro › Condições e formas** (veja o manual do Financeiro).
- **Catálogo público**: vitrine para clientes (veja o manual do Catálogo público). No plano Essencial, o item aparece apagado com o aviso "Disponível no plano Profissional".

O vendedor vê só **Empresa**, para consulta.

![Configurações do administrador no plano Profissional.](admin-configuracoes-1280.png "sem-menu h=56")

## Dados e identidade da empresa

Abra [[Configurações]] › **Empresa**. O quadro **Identidade da empresa** tem o logotipo à esquerda e o nome à direita. Abaixo ficam o **Fuso horário**, usado para validar as datas de vencimento, e a data **No Lastro desde**.

![Configurações › Empresa no plano Profissional, com logotipo cadastrado.](admin-empresa-1280.png "sem-menu h=62")

### Alterar o nome da empresa

1. Em **Nome da empresa**, digite o novo nome (de 2 a 120 caracteres).
2. Clique em [[Salvar nome]]. Para desistir, clique em [[Descartar]].
3. Aguarde a mensagem "Nome da empresa atualizado".

O nome aparece no app, nos pedidos comerciais, nos romaneios, nos relatórios em PDF e no menu lateral. Documentos gerados depois da troca já saem com o novo nome. Para mudar o fuso horário, fale com o suporte do Lastro.

### Cadastrar o logotipo (plano Profissional)

1. No quadro **Logotipo**, clique em [[Adicionar logotipo]].
2. Escolha o arquivo: JPEG, PNG ou WebP, com até 5 MB. PNG com fundo transparente fica melhor nos documentos.
3. O envio começa na hora. Aguarde a mensagem "Logotipo adicionado" e a prévia no quadro.

O logotipo aparece ao lado do nome da empresa:

- no pedido comercial, no romaneio de entrega e nos relatórios em PDF;
- no topo do catálogo público;
- no menu lateral do Lastro, junto ao nome da empresa.

As proporções do arquivo são mantidas: logotipos quadrados e horizontais funcionam. A marca do Lastro continua presente nos documentos e no catálogo.

### Substituir ou remover o logotipo

- Para trocar, clique em [[Substituir]] e escolha o novo arquivo. A mensagem "Logotipo substituído" confirma a troca. Se o envio falhar, o logotipo anterior continua valendo.
- Para tirar, clique em [[Remover]] e confirme em [[Remover logotipo]]. Os documentos voltam a mostrar só o nome da empresa. Você pode enviar outro depois.

:::atencao "Logotipo não salvo"
O aviso explica o motivo (arquivo grande, formato não aceito, conexão). Quando a falha é passageira, aparece [[Tentar de novo]], que reenvia o mesmo arquivo. Nos outros casos, ajuste o arquivo e clique em [[Adicionar logotipo]] ou [[Substituir]] de novo. As mensagens são as mesmas das fotos de produtos (veja o manual de Produtos).
:::

### Diferenças entre os planos

| Ação | Essencial | Profissional |
|---|:-:|:-:|
| Alterar o nome da empresa | {sim} | {sim} |
| Enviar ou substituir o logotipo | {nao} | {sim} |
| Remover um logotipo guardado | {sim} | {sim} |
| Logotipo nos PDFs, no catálogo e no menu | {nao} | {sim} |

No Essencial, o quadro do logotipo mostra o aviso "Logotipo nos pedidos, romaneios e no catálogo: disponível no plano Profissional." Se a empresa já tinha logotipo, ele fica **guardado** e volta a aparecer quando a empresa passar para o Profissional.

![Configurações › Empresa no plano Essencial: nome editável e aviso sobre o logotipo.](essencial-empresa-1280.png "sem-menu h=56")

:::perfil Quem pode alterar
Só administradores alteram o nome e o logotipo. O vendedor vê o nome da empresa, sem botões de edição. Essas permissões não podem ser liberadas para vendedores.
:::

## Ver a equipe e as vagas

1. Abra [[Configurações]] › **Usuários e convites**.
2. No topo, veja quantos usuários estão ativos e quantos convites estão pendentes.
3. O quadro do plano mostra **Acessos utilizados** e as vagas livres.
4. Em **Pessoas com acesso**, filtre por [[Todos]], [[Ativos]] ou [[Inativos]].

![Tela de Usuários com o plano, as pessoas com acesso e os convites pendentes.](admin-usuarios-1280.png "sem-menu h=88")

:::atencao Sem vagas livres
Se aparecer "Todos os acessos estão ocupados", o botão [[Convidar usuário]] fica desativado. Revogue um convite pendente ou desative um usuário para liberar uma vaga, ou fale com o Lastro sobre o plano.
:::

## Convidar uma pessoa

1. Em **Usuários e convites**, clique em [[Convidar usuário]].
2. Informe o **E-mail** da pessoa.
3. Escolha o **Perfil**: [[Administrador]] ou [[Vendedor]].
4. Clique em [[Gerar convite]].
5. A janela **Convite criado** mostra o link. Copie e envie por um canal seguro (WhatsApp, e-mail da empresa).
6. Clique em [[Concluir]].

:::atencao O link aparece uma única vez
O Lastro gera o link na tela, mas ainda **não envia e-mail**. Copie antes de fechar. Se perder o link, use **Reenviar convite** para gerar outro.
:::

A pessoa convidada abre o link, cria a conta (ou entra com a conta que já tem) com o **mesmo e-mail** do convite e aceita. O passo a passo dela está no manual **Primeiros passos**.

### Convites pendentes

No quadro **Convites pendentes**, cada convite mostra o e-mail, a data e o vencimento. Os ícones da linha permitem:

- **Reenviar convite**: gera um novo link, válido por 7 dias. O link anterior deixa de funcionar. Clique em [[Gerar novo link]].
- **Alterar e-mail do convite**: informe o **E-mail correto** e clique em [[Alterar e-mail]]. A vaga passa para o novo e-mail.
- **Revogar convite**: o link deixa de funcionar e a vaga é liberada. Confirme em [[Revogar convite]].

| Mensagem | O que significa |
|---|---|
| Já existe convite pendente ou acesso ativo para este e-mail. | A pessoa já foi convidada ou já tem acesso. |
| O plano não tem vaga para mais um usuário. | Libere uma vaga antes de convidar. |
| Este convite não faz parte do plano contratado. | Convites adicionais ou o perfil Vendedor exigem o plano Profissional. |

## Mudar perfil ou desativar um acesso

1. Em **Pessoas com acesso**, clique no lápis ([[Editar]]) da pessoa.
2. Em **Perfil**, escolha [[Administrador]] ou [[Vendedor]].
3. Para tirar o acesso, desmarque **Acesso ativo**.
4. Clique em [[Salvar usuário]]. Ao desativar, confirme em [[Desativar acesso]].

A pessoa desativada deixa de entrar no app imediatamente. Clientes, pedidos e histórico dela ficam preservados. Para reativar, abra a pessoa em [[Inativos]] e marque **Acesso ativo** de novo (é preciso ter vaga livre).

:::nota Único administrador
Se a pessoa for o único administrador ativo, o Lastro não deixa mudar o perfil nem desativar. Promova outra pessoa a administrador antes.
:::

## Permissões do vendedor

Cada vendedor começa com as permissões **padrão do vendedor**. O administrador pode retirar ou liberar operações, uma a uma.

1. Em **Pessoas com acesso**, clique no ícone de escudo (**Permissões**) do vendedor.
2. Na janela **Permissões do vendedor**, ligue ou desligue as operações de cada módulo.
3. Para voltar ao padrão, clique em [[Padrão do vendedor]].
4. Clique em [[Salvar permissões]]. A mensagem "Permissões salvas" aparece.

A coluna **Permissões** da lista mostra "Padrão do vendedor" ou "Personalizadas".

:::perfil Regras que não mudam
A carteira continua valendo: o vendedor só vê os próprios clientes e pedidos, mesmo com permissões extras. Operações marcadas **Somente administradores** não podem ser liberadas. Algumas operações dependem de outras: por exemplo, **Pedidos · Criar e editar** exige **Clientes · Gerenciar carteira própria**.
:::

### Tabela de permissões do vendedor

| Módulo | Operação | Vendedor |
|---|---|:-:|
| Dashboard | Visualizar | {sim:Sempre} |
| Pedidos | Visualizar | {pad} |
| Pedidos | Criar e editar | {pad} |
| Pedidos | Confirmar | {pad} |
| Pedidos | Expedir | {pad} |
| Pedidos | Confirmar entrega | {pad} |
| Pedidos | Gerar documentos | {pad} |
| Pedidos | Gerenciar todos e cancelar | {nao} |
| Pedidos | Aprovar descontos | {nao} |
| Clientes | Gerenciar carteira própria | {pad} |
| Clientes | Gerenciar todos e carteiras | {nao} |
| Visitas | Registrar e consultar | {pad} |
| Produtos | Visualizar | {pad} |
| Produtos | Criar e editar | {lib} |
| Estoque | Consultar disponibilidade | {pad} |
| Estoque | Registrar movimentações | {lib} |
| Financeiro | Todas as operações, inclusive corrigir vencimentos | {nao} |
| Relatórios | Visualizar e exportar | {lib} |
| Catálogo | Configurar vitrine | {nao} |
| Configurações | Dados da empresa, condições e formas | {nao} |
| Configurações | Identidade visual (logotipo) | {nao} |
| Usuários | Gerenciar usuários | {nao} |

**Sempre**: incluída para todo vendedor. **Padrão**: ligada ao convidar, pode ser retirada. **Se liberado**: desligada ao convidar, pode ser ligada. **Não**: somente administradores. Recursos fora do plano contratado aparecem como "Fora do plano contratado".

## Planos do Lastro {nova-pagina}

O plano da empresa aparece no quadro do topo da tela **Usuários**, com os acessos utilizados e os recursos incluídos. Hoje o Lastro oferece dois planos:

| Recurso | Essencial | Profissional |
|---|:-:|:-:|
| Usuários (ativos e convites pendentes) | 1 | 2 |
| Pedidos, clientes, produtos com fotos e estoque | {sim} | {sim} |
| Financeiro, devoluções e correção de vencimentos | {sim} | {sim} |
| Relatórios em tela, CSV e PDF | {sim} | {sim} |
| Pedido comercial e romaneio em PDF com o nome da empresa | {sim} | {sim} |
| Convite de usuários adicionais | {nao} | {sim} |
| Perfil Vendedor e carteiras de clientes | {nao} | {sim} |
| Visitas e recompra | {nao} | {sim} |
| Catálogo público com orçamento pelo WhatsApp | {nao} | {sim} |
| Logotipo nos PDFs e no catálogo, fotos dos produtos nos PDFs | {nao} | {sim} |

Não há outros planos disponíveis no momento. Recurso fora do plano não aparece no menu ou aparece com o aviso "Disponível no plano Profissional"; na janela de permissões, aparece como "Fora do plano contratado".

:::nota Troca de plano
A troca de plano é feita pela equipe do Lastro. Para passar ao Essencial, a empresa precisa caber em 1 usuário. Ao sair do Profissional, o catálogo público deixa de abrir e o logotipo e as fotos saem dos documentos; cadastros, logotipo e fotos ficam guardados para uma volta ao Profissional.
:::

## O que só a equipe do Lastro faz

Algumas operações ficam com a equipe do Lastro (perfil **Super Admin**), em uma área própria que os usuários da empresa não acessam:

- criar a empresa no Lastro e enviar o convite do primeiro administrador;
- definir e trocar o plano, o valor mensal e o dia de vencimento da assinatura;
- gerar e acompanhar as cobranças da assinatura;
- suspender e reativar o acesso da empresa;
- solicitar a troca do e-mail de uma conta e desbloquear contas.

O acesso de suporte do Lastro aparece na lista de usuários com o selo ((Suporte Lastro|destaque)) e não ocupa vaga do plano. Administradores da empresa não veem nem alteram plano, valores ou cobranças pelo app.

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Ver dados da empresa | {sim} | {sim} |
| Alterar o nome da empresa | {sim} | {nao} |
| Enviar e trocar o logotipo | {sim:Sim, no Profissional} | {nao} |
| Remover o logotipo | {sim} | {nao} |
| Convidar, editar e desativar usuários | {sim} | {nao} |
| Ajustar permissões de vendedores | {sim} | {nao} |
