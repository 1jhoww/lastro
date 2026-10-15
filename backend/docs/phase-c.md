# Fase C — Estoque, movimentos e reposição

Implementação local no backend Lastro, preservando A/B. Um estoque compartilhado por empresa/produto, sem depósitos individuais ou estoque por vendedor. Não houve deploy, commit, push, banco produtivo, recurso pago ou alteração na Atual Pet. Pedidos, financeiro, catálogo público e frontend não foram implementados.

## Endpoints

Todos sob /api/v1, com Bearer, tenant candidato autorizado e gate de assinatura. Sete operações adicionadas; total 43 no OpenAPI. Rotas estáticas precedem o parâmetro productId.

| Método | Rota                                  | Autorização/uso                                            |
| ------ | ------------------------------------- | ---------------------------------------------------------- |
| GET    | /inventory                            | Administrador: saldos; vendedor: disponibilidade de ativos |
| GET    | /inventory/{productId}                | Mesmo controle e DTO por perfil                            |
| GET    | /inventory/movements                  | Administrador, filtros produto/tipo/período e paginação    |
| POST   | /inventory/entries                    | Administrador, entrada positiva com idempotência           |
| POST   | /inventory/adjustments                | Administrador, variação signed com versão/idempotência     |
| GET    | /inventory/replenishment              | Administrador, abaixo do mínimo, ativos por padrão         |
| GET    | /inventory/{productId}/reconciliation | Administrador, reconciliação por páginas, sem reparo       |

Mínimo é campo minimumStock de POST/PATCH products, somente administrador; PATCH exige versão do produto. Não há PATCH/DELETE de movimentos, nem endpoints de reserva/expedição/liberação/devolução. Correção cria novo ajuste compensatório.

## Modelo e precisão

Quantidades HTTP são texto com ponto decimal, nunca número JSON ou vírgula. UN/CX/PCT: inteiros; KG/L: até três casas. Escala interna universal 1000: "1.250" KG vira 1250, "10" UN vira 10000. Limite absoluto de saldo, mínimo e operação: 1.000.000.000 unidades, ou 1.000.000.000.000 milésimos. Conversão usa BigInt para validar e depois inteiro Number exato; não há aritmética monetária ou conversão automática de unidades. Resposta canônica remove zeros finais da parte fracionária: "1.250"→"1.25".

Disponível=físico-reservado, derivado na resposta. Schemas/transições exigem físico≥reservado≥0 e limites. Estoque mínimo vem do produto; belowMinimum e shortfallScaled são projeções derivadas no mesmo commit. Sugestão=max(0,mínimo-disponível). Sem compra, fornecedor ou alerta automático.

Produtos antigos sem minimumStock leem "0". Sem documento inventory, saldo legado é zero; GET não escreve. Primeiro movimento ou alteração administrativa materializa projeção. Produtos novos já criam produto/projeção/reservaSKU/auditoria juntos. Alterar mínimo sincroniza projeção e incrementa versão de estoque. SKU/nome/categoria/status também sincronizam metadados. Não mudar unidade após a primeira movimentação, mesmo com saldo zero. Antes de histórico, mudança de unidade ainda exige que o mínimo seja válido na unidade nova.

Inativos mantêm saldo/histórico; administrador pode corrigir/receber mercadorias de produto inativo sem ativá-lo. Vendedor não vê seu estoque. Reposição padrão exclui inativos; status=inactive|all permite consulta administrativa explícita. Não existe saldo por vendedor.

## Escritas e idempotência

Entrada: {productId,quantity,reason,notes?}. Ajuste por variação: {productId,delta,expectedVersion,reason,notes?}. Motivo 3..200 caracteres; notas até 1000. Quantity positiva e delta não zero, signed somente no ajuste. Servidor calcula saldos posteriores e rejeita ajuste abaixo do reservado/zero físico negativo.

Idempotency-Key UUID obrigatória em ambos os POSTs. Registro stockOperations por hash da chave no tenant, com hash do comando validado/ator. Repetir exatamente o comando da mesma intenção/ator retorna movimento e snapshot de saldo originais com 201, sem duplicar. Outro ator/comando/produto/tipo usando a chave recebe 409. Quantidade lexicalmente diferente é comando diferente, mesmo quando valor matemático coincide. Chave é independente entre empresas. Não há TTL: retenção/replay devem ser definidos antes de qualquer limpeza.

Transação relê vínculo/assinatura/permissão e depois idempotência, produto e saldo. Escritas: agregado de estoque, movimento imutável, operação e auditoria. Nenhum efeito externo em callback repetível. Entrada acumula no saldo transacional; ajuste exige versão do estoque, distinta da versão do produto. Em conflito, recarregar e decidir nova variação/chave, sem repetir ajuste antigo como nova intenção automaticamente.

Movimentos administrativos registram todos os tipos efetivamente executados: STOCK_ENTRY, STOCK_ADJUSTMENT_IN/OUT; saldos antes/depois, unidade, quantidade, sequência, ator, motivo/nota, data UTC, referência UUID, requestId/operationId e cadeia de hash. Os quatro tipos comerciais estão previstos e têm aritmética pura, mas não são persistidos por esta fase.

## Consultas, reconciliação e custo

Inventory reutiliza filtros/página de produtos (status, categoria, SKU, prefixo de nome, ordem name|createdAt). Vendedor não amplia acesso com status=all. Snapshot de leitura agrupa produto e saldo; página até 100, mais uma leitura de saldo por produto. Reposição consulta belowMinimum no índice, filtra status/categoryId/q, ordena name|shortfall asc|desc; q exige name asc. Histórico: produto, tipo, período UTC inclusivo normalizado em milissegundos, direção e cursor; sem varredura total ou offset.

Reconciliação começa em zero e percorre sequência/documentId, verificando unidade, hash/cadeia, aritmética e saldos antes/depois. Detecta duplicação na fronteira de página. Ao terminar, compara contagem/cabeça/saldos. Cursor assinado leva progresso/versão; se estoque muda, reiniciar. consistent=true com complete=false valida só o prefixo; conclusão exige ambos true. Sem reparo automático. Hash não impede reconstrução integral por operador privilegiado.

São 23 índices locais novos, 101 totais, sem implantação. Quatro escritas de domínio por operação e leituras de identidade/contexto/produto/saldo/idempotência; retries elevam custo. Projeção requer amplificação de índices por saldo atualizado. Reconciliação é linear no histórico, mas limitada por requisição. Produto muito disputado serializa no seu agregado; não há sharding/fila. Medir contenção/custo/capacidade real antes de alterar estrutura.

## Preparação para pedidos

orderStockContract.ts define interface prepare(tx, operação com contexto e pedido real)→apply(). quantities.ts fornece transições puras de reserva/liberação/expedição/devolução com invariantes. Não há adaptador operacional de pedidos, autoridade de origem comercial ou persistência fictícia. Fase D deve implementar validação runtime de pedido/estado/versão/carteira, reservas por pedido/linha e idempotência; todas as leituras antes das escritas, dentro da mesma transação do pedido. Schemas atuais de origem administrativa serão estendidos explicitamente para origens comerciais legítimas. Veja [Fase D](phase-d.md).

## Arquivos criados e alterados

Criados: src/modules/inventory/{quantities,stockProjection,inventoryService,reconciliationCursor,orderStockContract}.ts; src/shared/schemas/inventory.ts; src/app/inventoryRoutes.ts; scripts/inventory-indexes.mjs; tests/helpers/inventory.ts e inventory.test.ts em unit/integration/security/concurrency; docs/adr/0006-estoque-por-produto.md, docs/phase-d.md e validation-phase-b.md.

Alterados: productService.ts, schemas/commercial.ts, repositories/commercialRepository.ts, app.ts/routes.ts e geração OpenAPI; firestore.indexes.json; README raiz/backend, CONTEXT.md, documentos de arquitetura/modelo/permissões/contrato frontend/segurança/validação/phase-c, OpenAPI e tipos gerados. Nenhuma dependência nova; nenhum teste anterior removido.

## Executar localmente

Siga [README](../README.md), Node LTS/Java 21 e portas locais dos três emuladores. Primeiro terminal: npm run emulators. Segundo: npm run seed:local e npm run dev. Em máquina com npm global quebrado, usar pwsh -File scripts/npm.ps1 run NOME. Projeto demo de desenvolvimento preserva nome demo-lastro-phase-a por compatibilidade; testes usam demo-lastro-tests.

Swagger: http://127.0.0.1:3000/docs. Token empresarial deve vir de convite aceito; Super Admin sem vínculo não opera estoque. Exemplo body de entrada: {"productId":"ID","quantity":"1.250","reason":"Recebimento contado"}, com Idempotency-Key UUID e produto KG/L. Ajuste posterior: {"productId":"ID","delta":"-0.250","expectedVersion":1,"reason":"Divergência de contagem"}, com nova chave e versão lida no estoque.

Pare desenvolvimento antes de npm test/npm run test:integration. Relatório real em [validação](validation.md); riscos em [segurança](security.md). Emuladores não comprovam capacidade produtiva, custos, SLOs, IAM ou backups/recuperação.
