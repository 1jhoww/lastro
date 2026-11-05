# Lastro Gestão: auditoria de índices do Firestore

Consulta somente de leitura em 04/11/2026, projeto `lastro-hml`, banco `(default)`. Nenhum índice foi criado, alterado ou removido.

## Resultado

| Item                                              | Valor                                  |
| ------------------------------------------------- | -------------------------------------- |
| Declarados antes da auditoria                     | 226                                    |
| Declarados agora                                  | 184                                    |
| Redução líquida, só em índices nunca publicados | 42                                     |
| Publicados em `lastro-hml`                        | 150, todos `READY`                     |
| Publicados e ausentes da declaração               | 0                                      |
| A publicar                                        | 34                                     |

Os 150 publicados são idênticos aos 150 anteriores ao Gestão. Os 34 restantes são novos e nenhum deles existe no ambiente, então a redução não remove nada do que está em uso.

## Quotas

Fonte: [limites do Firestore](https://firebase.google.com/docs/firestore/quotas), consultada na mesma data.

- Índices compostos por banco: 200 sem faturamento, 1000 com faturamento.
- Configurações de campo por banco: 200 sem faturamento, 1000 com faturamento. O repositório declara 119.
- Entradas de índice por documento: 40.000.

`lastro-hml` tem faturamento ativo, banco `FIRESTORE_NATIVE`, edição `STANDARD`, região `southamerica-east1`. O limite aplicável é 1000.

**Atenção:** a conta foi registrada como faturamento de avaliação. Se o faturamento for desligado, o limite cai para 200. Com 184 índices a publicação continua cabendo, mas sobra margem para apenas 16.

## O que saiu

A regra anterior gerava um índice para cada combinação possível de filtros. Cada índice custa escrita em todo documento, e a maior parte das combinações não tinha consumidor: as telas usam um filtro por vez.

| Coleção     | Antes | Depois | Decisão                                                                                                                    |
| ----------- | ----- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `payables`  | 47    | 14     | `payableQuery` aceita um filtro além da situação. Mais que isso responde 422, antes de chegar ao banco.                    |
| `customers` | 16    | 8      | Fornecedor não tem responsável. Filtrar fornecedor por `assignedTo` responde 422, e a tela esconde esse filtro nessa aba.  |
| `purchases` | 7     | 5      | `status` já diz se há mercadoria pendente, então `status` com `pendingReceipt` responde 422.                               |

Entrou um índice novo: `supplierCredits (hasBalance, createdAt↓)`.

### Por que não usar a fusão de índices

O Firestore pode combinar índices de igualdade com uma mesma ordenação. A documentação descreve isso só para filtros de igualdade e não diz como se comporta com intervalo no campo de ordenação, que é o caso de `payables` (`dueDate` entre duas datas). Testar exigiria publicar índices, o que está fora desta etapa. Por isso a redução veio de limitar o que a API aceita: o comportamento é o mesmo em emulador e em produção, e uma combinação sem índice é recusada com mensagem clara, nunca com erro do banco.

## Índices antigos: candidatos, sem alteração

Os 150 publicados ficaram intactos. Estão em uso por telas já em homologação, e removê-los exigiria mudar módulos fora do escopo desta entrega. Candidatos para uma próxima etapa:

- **`products`, 32 índices com `sku`.** `sku` é único por empresa, então qualquer combinação com ele devolve no máximo um documento. Buscar pelo `sku` isolado e filtrar em memória dispensaria esses índices, exceto `sku` com as quatro ordenações.
- **`products`, 61 no total.** Mesmo padrão de combinação completa de `status`, `categoryId`, `sku` e `catalogVisible`, com duas ordenações e duas direções. É a coleção com escrita mais cara.
- **`inventory`, 16.** Cada ajuste de saldo paga todos eles.

Remover índice publicado é uma alteração no ambiente e precisa de autorização própria. `firebase deploy --only firestore:indexes` sem `--force` só acrescenta, então não remove nenhum deles.

## Impacto da publicação

- São 34 índices em coleções vazias ou de baixo volume. `customers` é a única com dados: 8 índices sobre `isSupplier`, campo que registros antigos não têm. Eles não entram nesses índices, o que é o comportamento desejado, porque só fornecedores são consultados por ele.
- Registros antigos não precisam de reescrita.
- A API nova depende desses índices. Publique e aguarde `READY` antes de publicar a API, ou as listas de compras e títulos respondem erro em vez de lista vazia.

## Cobertura

`backend/tests/unit/managementIndexes.test.ts` falha se uma combinação aceita pelos esquemas ficar sem índice, se surgir índice repetido, ou se a API voltar a aceitar uma combinação que não tem índice. O emulador não exige índices, portanto esse teste é a única trava antes da publicação.
