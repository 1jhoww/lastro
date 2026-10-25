---
slug: produtos
modulo: Produtos
titulo: Produtos
subtitulo: Cadastro de produtos, preços, unidades, fotos e categorias.
publico: Administrador, Vendedor (consulta)
resumo: O cadastro de produtos define o que a empresa vende, com SKU, unidade, preço de tabela e foto. É dele que saem os itens dos pedidos, os saldos de estoque e a vitrine do catálogo público. Este manual mostra como cadastrar, editar, enviar fotos, organizar em categorias e desativar produtos.
administrador: Cadastra, edita, desativa e reativa produtos, envia e troca fotos e organiza as categorias.
vendedor: Consulta os produtos ativos e seus preços de tabela. Só cadastra ou edita produtos se o administrador liberar essa permissão.
---

## Conceitos do cadastro

| Campo | Para que serve |
|---|---|
| SKU | Código único do produto na empresa. Usado em buscas, relatórios e no estoque. |
| Unidade de venda | Como o produto é vendido e contado: UN, CX, PCT, KG ou L. |
| Preço | Preço de tabela atual, sugerido ao montar o pedido. |
| Estoque mínimo | Quantidade de alerta. Abaixo dela, o produto aparece em **Reposição**. |
| Categoria | Agrupamento opcional para filtrar listas e organizar o catálogo. |

:::nota O estoque não é cadastrado aqui
Todo produto novo começa com estoque zerado. As quantidades entram pelo módulo **Estoque**, com **Registrar entrada** (veja o manual de Estoque).
:::

## Encontrar um produto

1. No menu lateral, clique em [[Produtos]].
2. Em **Buscar produtos**, digite o início do nome ou o SKU exato.
3. Em **Situação**, escolha [[Ativos]], [[Inativos]] ou [[Todos]].
4. Filtre por categoria ou por presença no catálogo: **Visíveis no catálogo** ou **Ocultos do catálogo**.
5. Clique no produto para ver a ficha. O ícone de lápis abre a edição.

![Lista de produtos com categoria, unidade, preço, catálogo e situação.](admin-produtos-1280.png "sem-menu h=80")

## Cadastrar um novo produto

1. Na lista de produtos, clique em [[Novo produto]].
2. Em **Informações**, preencha o **Nome do produto** (pelo menos 2 caracteres).
3. Informe o **SKU**: letras, números, ponto, hífen ou sublinhado, sem espaços (por exemplo, `BEB-001`). Ele é salvo em maiúsculas.
4. Escolha a **Categoria** ou deixe **Sem categoria**.
5. Escreva a **Descrição**, se quiser (até 2000 caracteres).
6. Escolha a **Unidade de venda**:
   - **Unidade (UN)**, **Caixa (CX)** e **Pacote (PCT)** aceitam só quantidades inteiras;
   - **Quilo (KG)** e **Litro (L)** aceitam até 3 casas decimais.
7. Informe o **Preço** por unidade (até R$ 1.000.000,00).
8. Se quiser alerta de reposição, informe o **Estoque mínimo** na mesma unidade.
9. Deixe marcado **Produto ativo** para que ele apareça nos pedidos.
10. Marque **Visível no catálogo público** se o produto deve aparecer na vitrine.
11. Se quiser, clique em [[Adicionar imagem]] e escolha a foto (veja **Fotos dos produtos**). A foto aparece na tela, mas só é enviada ao salvar.
12. Clique em [[Salvar produto]]. A mensagem "Produto cadastrado" (ou "Produto cadastrado com imagem") aparece e a ficha do produto abre.

![Formulário de novo produto.](admin-produto-novo-1280.png "sem-menu h=88")

:::atencao A unidade fica fixa depois da primeira movimentação
Depois que o produto tiver entrada, ajuste ou pedido no estoque, a **Unidade de venda** não pode mais mudar. Escolha com cuidado no cadastro.
:::


## Editar um produto

1. Abra a ficha do produto e clique em [[Editar]] (ou use o lápis na lista).
2. Altere os campos necessários. A foto tem botões próprios e é salva na hora (veja **Fotos dos produtos**).
3. Clique em [[Salvar produto]]. A mensagem "Produto salvo" aparece.

![Edição do produto: dados à esquerda e quadro Imagem à direita.](admin-produto-editar-1280.png "sem-menu h=76")

:::dica Mudança de preço
O novo preço vale para os próximos pedidos. Pedidos já registrados mantêm o preço deles.
:::

| Mensagem | O que fazer |
|---|---|
| Já existe um produto com este SKU nesta empresa. | Use outro SKU ou edite o produto existente. |
| A unidade não pode mudar: o produto já tem movimentação de estoque. | Mantenha a unidade. Se precisar, cadastre um novo produto. |
| Esta categoria está inativa ou foi removida. | Escolha outra categoria. |
| O produto mudou enquanto você decidia… | A versão atual foi carregada; refaça a alteração. |

## Ficha do produto

A ficha mostra o **Preço de tabela**, a categoria, a unidade (com as casas decimais aceitas), a descrição, a foto no quadro **Imagem** e o resumo do **Estoque** (disponível, reservado e físico), com atalhos para [[Abrir estoque]], [[Registrar entrada]] e [[Movimentações]].

![Ficha do produto com a foto e o resumo do estoque.](admin-produto-detalhe-1280.png "sem-menu h=80")

## Fotos dos produtos

Cada produto pode ter uma foto. Ela aparece na lista de produtos, na ficha, no catálogo público e, no plano Profissional, no pedido comercial e no romaneio em PDF.

### Arquivos aceitos

| Item | Regra |
|---|---|
| Formatos | JPEG, PNG ou WebP. HEIC, GIF, PDF e SVG não são aceitos. |
| Tamanho do arquivo | Até 5 MB. No navegador, fotos grandes são reduzidas automaticamente antes do envio. |
| Resolução | Até 50 megapixels. |
| Quantidade | Uma foto por produto. Enviar outra substitui a anterior. |
| Envios | Até 300 fotos e logotipos por hora para cada usuário. Acima disso, o Lastro informa quando tentar de novo. |

:::dica Foto que fica bem
Use foto quadrada, com o produto centralizado e fundo claro. Na ficha, no catálogo e nos PDFs a foto aparece inteira em um quadro quadrado; na lista de produtos, como miniatura.
:::

### Adicionar ou trocar a foto de um produto já cadastrado

1. Abra a ficha do produto.
2. No quadro **Imagem**, clique em [[Adicionar imagem]] (ou em [[Substituir]], se o produto já tem foto).
3. Escolha o arquivo. O envio começa na hora.
4. Aguarde a mensagem "Imagem adicionada" (ou "Imagem substituída").

O mesmo quadro aparece na tela [[Editar]] do produto, com o mesmo funcionamento: a foto é salva na hora, sem esperar o botão [[Salvar produto]].

Para tirar a foto, clique em [[Remover]] e confirme em [[Remover imagem]]. O produto fica sem foto no app e no catálogo; você pode enviar outra depois.

### Quando a foto não é salva no cadastro

O produto e a foto são gravados em duas etapas. Se o produto for salvo e a foto não, o cadastro **continua valendo** e a tela mostra "A imagem não foi salva", com o motivo.

![Produto cadastrado com a foto pendente e as opções para continuar.](admin-produto-imagem-falha-1280.png "sem-menu h=78")

1. Leia o motivo no aviso vermelho.
2. Escolha como continuar:
   - [[Tentar de novo]]: reenvia a mesma foto. Aparece quando a falha é passageira (conexão, limite de envios ou erro interno);
   - [[Escolher outra imagem]]: envia outro arquivo, por exemplo quando o formato não é aceito;
   - [[Continuar sem imagem]]: abre a ficha do produto sem foto.
3. Não clique em [[Novo produto]] de novo para o mesmo item: o produto já existe. Se preferir, adicione a foto depois, na ficha.

### Mensagens de foto

| Mensagem | O que fazer |
|---|---|
| Arquivo muito grande: o limite é 5 MB. | Reduza a foto ou salve uma cópia menor e envie de novo. |
| Formato incompatível. | Salve a foto em JPEG ou PNG. |
| Resolução acima de 50 megapixels. | Reduza a resolução da foto. |
| Imagem inválida ou corrompida. | Abra o arquivo, salve uma cópia em JPEG ou PNG e envie de novo. |
| Problema de conexão: a imagem não chegou ao servidor. | Verifique a internet e clique em [[Tentar de novo]]. |
| Limite de envios de imagens desta hora atingido. | Aguarde o tempo indicado e clique em [[Tentar de novo]]. |
| O registro mudou enquanto você enviava. | A tela foi atualizada; envie a foto de novo. |

Se a troca de uma foto falhar, a foto anterior continua no produto.

## Desativar ou reativar um produto

1. Abra a ficha do produto.
2. Clique em [[Desativar]] e leia o aviso "Desativar produto?".
3. Clique em [[Desativar produto]]. A mensagem "Produto desativado" aparece.

O produto some para os vendedores e do catálogo, e não entra em novos pedidos. Saldo, histórico de estoque e pedidos antigos ficam preservados. Para voltar a vender, filtre [[Inativos]], abra o produto e clique em [[Reativar]] e depois em [[Reativar produto]].

Também é possível desmarcar **Produto ativo** na edição. Nesse caso, o botão de confirmação é [[Salvar e desativar]].

:::nota
O Lastro não exclui produtos. Desativar é o caminho para tirar um item de linha sem perder o histórico.
:::

## Categorias

Categorias ajudam a filtrar produtos e são opcionais.

1. Na lista de produtos, clique em [[Categorias]].
2. Clique em [[Nova categoria]].
3. Informe o **Nome** (pelo menos 2 caracteres) e, se quiser, a **Descrição**.
4. Clique em [[Criar categoria]]. A mensagem "Categoria criada" aparece.

Para alterar, clique em [[Editar]] na linha da categoria e depois em [[Salvar]]. Para tirar de uso, clique em [[Desativar]] e confirme em [[Desativar categoria]]: os produtos que já estão nela continuam com a categoria, mas ela deixa de aparecer em novos cadastros e nos filtros do vendedor.

![Tela de categorias.](admin-categorias-1280.png "sem-menu h=62")

## Quem pode fazer o quê

| Operação | Administrador | Vendedor |
|---|:-:|:-:|
| Consultar produtos e categorias ativos | {sim} | {pad} |
| Cadastrar, editar e desativar produtos | {sim} | {lib} |
| Enviar, trocar e remover fotos | {sim} | {lib} |
| Criar e desativar categorias | {sim} | {lib} |

**Se liberado**: desligado por padrão para o vendedor; o administrador pode liberar em **Configurações › Usuários e convites › Permissões**.
