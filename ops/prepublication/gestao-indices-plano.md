# Lastro Gestão: plano de publicação dos índices

Nada aqui foi executado. **`lastro-hml` tem clientes reais:** este plano só vale na Parte 2 do checklist, depois da homologação no ambiente novo. Em ambiente novo e vazio, os índices podem ser publicados de uma vez. Os comandos estão em [gestao-indices-aprovacao.txt](gestao-indices-aprovacao.txt), um por linha. A análise está na [auditoria](../../docs/audits/indices-gestao-2026-11-04.md).

## Escopo

| Grupo | Quantidade | Conteúdo                                                            |
| ----- | ---------- | ------------------------------------------------------------------- |
| I-1   | 32         | Isenções de campo em textos e listas das coleções novas             |
| I-2   | 34         | Índices compostos: 8 em `customers`, 26 em coleções novas           |

Os 150 índices e as 88 configurações já publicados não mudam, e nada é removido.

## Por que não usar `firebase deploy`

`firebase deploy --only firestore:indexes` aplica o arquivo inteiro: índices, configurações de campo e TTL. A regra deste projeto é evitar isso, porque uma diferença não prevista viraria alteração. Comandos individuais deixam cada mudança nomeada, conferível e reversível.

## Custo e impacto

- O custo recorrente é armazenamento e escrita de entradas de índice.
- As coleções novas estão vazias, então a construção é imediata e o custo inicial é próximo de zero.
- `customers` tem dados, mas só registros com `isSupplier` entram nos 8 índices novos. Hoje nenhum registro tem esse campo.
- Nenhuma leitura ou escrita da versão atual muda.
- Limite: 184 de 1000. Sem faturamento, o limite cai para 200.

## Sequência

1. **Conferir o estado.** Repita a leitura e compare: 150 compostos `READY`, 88 campos. Se houver qualquer diferença, pare.

   ```bash
   gcloud firestore indexes composite list --project=lastro-hml --database="(default)" --format="value(state)"
   ```

2. **Aplicar I-1**, um comando por vez, conferindo o retorno. Cada comando leva segundos em coleção vazia.
3. **Aplicar I-2**, um comando por vez. Cada um cria uma operação de longa duração. Se quiser não bloquear o terminal, acrescente `--async`.
4. **Aguardar.** Repita a listagem até todos ficarem `READY`. O critério de saída é 184 `READY`, nenhum `CREATING` e nenhum `NEEDS_REPAIR`.
5. **Conferir igualdade.** A lista remota precisa ser idêntica às 184 declarações, e o TTL de `rateLimits.expiresAt` precisa continuar ativo.
6. **Registrar** data, responsável e resultado no checklist.

Só depois disso a API nova pode receber tráfego. O emulador não exige índices, então uma falta só apareceria em uso real, como erro nas listas de compras e títulos.

## Se algo der errado

| Situação                     | Ação                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Índice fica em `NEEDS_REPAIR` | Pare. Investigue antes de seguir. Excluir e recriar exige autorização                |
| Construção demora            | Espere. Não publique a API nem repita o comando                                      |
| Quota recusada               | Pare. Confirme o faturamento antes de qualquer outra ação                            |
| Versão nova é revertida      | Mantenha os índices. Não afetam a versão anterior, e removê-los não é necessário     |

Remover um índice exige autorização própria. Isenções se revertem com `--clear-exemption`, campo a campo.
