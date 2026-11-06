# Bonificações ao cliente

Bonificação é mercadoria entregue a um cliente sem cobrança. Existem dois fluxos independentes: a **vinculada**, adicionada na etapa final do pedido, e a **avulsa**, lançada em área própria sem pedido nenhum. Nenhum dos dois gera faturamento, contas a receber ou pedido fictício.

## Fora do pedido

Bonificação fica na coleção `bonuses`, nunca em `orders.lines`. O esquema do pedido recusa produto repetido, e uma linha a preço zero entraria em vendas, CMV e devoluções. A vinculada usa o id do pedido como id próprio, então um pedido tem no máximo uma bonificação e encontrá-la custa uma leitura. O documento do pedido não muda: pedidos antigos seguem sem migração, e vendas, recebíveis e margem ficam protegidos por construção.

O número é `BON-XXXXXXXX`, derivado do UUID como `PED`, sem contador global (ADR 0007). A vinculada repete o sufixo do pedido.

## Estoque

| Evento | Vinculada | Avulsa |
|---|---|---|
| Rascunho | Sem efeito | Não existe |
| Confirmação do pedido | Reserva (`STOCK_RESERVATION`, origem `bonus`) | Não existe |
| Registro | Não existe | Saída imediata (`STOCK_BONUS_OUT`) |
| Expedição | Saída (`STOCK_DISPATCH`, origem `bonus`) | Não existe |
| Cancelamento antes da saída | Libera a reserva com o pedido | Não existe |
| Depois da saída | Retorno (`STOCK_BONUS_RETURN`) | Retorno (`STOCK_BONUS_RETURN`) |

A avulsa só usa o disponível (físico menos reservado): nunca consome o que está reservado para um pedido. A interface mostra um resumo e só chama a API depois da confirmação; a saída acontece nesse commit. Não há rascunho de avulsa no servidor.

### Mesma linha de produto vendida e bonificada

Vendido e bonificado do mesmo produto são duas reservas e dois movimentos. Ler o saldo por linha perderia a primeira atualização e bifurcaria a cadeia de movimentos, porque as leituras são paralelas e o agregado seria sobrescrito. `StockLedger` lê cada produto uma vez, encadeia sequência, saldo e hash em memória e grava o agregado uma vez.

### A bonificação segue o pedido

`FirestoreOrderStockAdapter` acrescenta as linhas bonificadas sozinho nas operações completas. Assim nenhum caminho expede ou libera um pedido sem a bonificação: comando do pedido e cancelamento financeiro atômico passam pelo mesmo adaptador. O cancelamento financeiro retomável planeja as linhas vendidas e depois as bonificadas; `baseline.bonusLineCount` só existe quando o pedido tem bonificação, e a publicação cancela a bonificação no mesmo commit que cancela o pedido.

Falta de estoque para a bonificação recusa a confirmação inteira. Pedido exige ao menos um item vendido; quem só quer bonificar usa o lançamento avulso.

Bonificação de pedido só muda em rascunho, sempre pela edição do pedido. Isso incrementa a versão e invalida desconto aprovado, como qualquer edição.

## Concorrência

Confirmação, expedição e cancelamento usam a versão do pedido e `orderOperations`. Avulsa e retorno usam `bonusOperations`, com a chave de idempotência. Retorno exige `expectedVersion`, e o acumulado por linha nunca passa do que saiu. O agregado `inventory` serializa as baixas do mesmo produto, então lançamentos simultâneos não vendem o mesmo saldo.

## Custos

O custo é congelado como na venda: médio ou, sem recebimento, referência. A vinculada congela na confirmação; a avulsa, no registro. Fica em `bonusCostSnapshots`, separado de `bonuses`, que vendedores leem, e de `orderCostSnapshots`, que alimenta o CMV. Só é capturado com `costing.products`. Sem custo conhecido a linha fica `missing`, nunca zero.

Bonificação não altera o custo médio: saída e retorno movimentam quantidade, não custo. O retorno vendável entra pelo médio vigente, que continua igual, e o custo congelado da bonificação permanece. O custo líquido desconta só o vendável. O danificado mantém o custo, porque a mercadoria se perdeu.

## Resultado estimado

O resultado ganhou a linha **Bonificações concedidas**, fora do faturamento, do CMV, da margem e das despesas operacionais, com o custo líquido de retornos. O reconhecimento é na data de confirmação ou registro, a mesma das vendas. Retorno posterior corrige o período da bonificação, não o período do retorno. Bonificação sem custo registrado fica de fora, e o painel avisa em nota.

## Retornos

Retorno é parcial ou total, por linha, somente com `returns:manage`, que vendedores nunca recebem. Exige que a mercadoria tenha saído. Vendável volta ao físico; danificado é registrado e não gera movimento. Não há efeito financeiro. Lançamento avulso feito por engano é corrigido com retorno total vendável. Não existe cancelamento de avulsa, para que o histórico sempre mostre a saída e o retorno.

## Permissões e planos

`bonuses:grant` é parte do módulo base `customers-orders`: disponível em todo plano, sem novo recurso pago nem limite novo. Administradores têm a permissão. Para vendedores, a operação **Conceder bonificações** é `grantable`, desligada por padrão, sem fluxo de aprovação. Ela cobre a bonificação no pedido, o lançamento avulso e a consulta do que é seu. Um rascunho já com bonificação pode ser confirmado por quem não a tem: a permissão vale para quem concede, não para quem confirma.

Quem vê o pedido vê a bonificação dele, sem custo. Custos só chegam com `costs:read`, conferido no servidor: relatórios omitem colunas e totais, e os arquivos saem da mesma visão. O relatório por responsável segue `commercial.sellers`, como o de vendedores.

## Documentos

Pedido comercial e romaneio trazem a seção da bonificação depois dos totais, com produtos, quantidades e "Sem cobrança". O comprovante próprio segue a mesma regra e declara que não é documento fiscal. O preço de tabela fica em `linePrices`, só para uso interno: nenhuma resposta da API e nenhum documento o mostra. O Lastro não emite nota fiscal; a obrigação fiscal da remessa fica com a empresa.

## Publicação

Movimentos com tipo e origem novos não são lidos pela API anterior, que tem esquemas estritos. A primeira bonificação real bloqueia reverter a API: `job:rollback-check` aponta `bonus_record`. A coleção nova exige índices antes da publicação da API; ver `ops/prepublication/bonificacoes-publicacao.md`.
