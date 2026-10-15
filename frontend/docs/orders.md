# Pedidos (Etapa 5)

Contrato de referência: OpenAPI 0.8.1 gerado do código do backend (`npm run api:sync`). Nenhum
endpoint, campo, estado ou transição foi criado no frontend.

## Telas e fluxos

| Rota                   | Quem            | O que faz                                                                              |
| ---------------------- | --------------- | -------------------------------------------------------------------------------------- |
| `/pedidos`             | admin, vendedor | Lista com situação, cliente e ordem; admin vê responsável; paginação por cursor        |
| `/pedidos/novo`        | admin, vendedor | Cliente → produtos → revisão; cria o rascunho                                          |
| `/pedidos/[id]`        | admin, vendedor | Ficha: itens com preços registrados, totais, pagamento, parcelas, registro, histórico  |
| `/pedidos/[id]/editar` | admin, vendedor | Edição de rascunho (cliente, itens, quantidades, pagamento, observações)               |
| `/` (Início)           | admin, vendedor | "Pedidos recentes" e "Aguardando expedição" (confirmados, mais antigos primeiro) reais |

Fluxo de criação em três passos curtos, num só lugar:

1. **Cliente**: busca pelo início do nome entre clientes ativos (vendedor: só a carteira; o
   servidor filtra). Administrador escolhe também o responsável (lista de membros ativos).
2. **Produtos**: busca de produtos ativos com preço, unidade e disponível; "Adicionar" põe 1
   unidade; o carrinho tem stepper e digitação (vírgula ou ponto), subtotal e total previstos.
   Desktop largo: busca e carrinho lado a lado. Celular: um embaixo do outro.
3. **Revisão**: cliente, itens, total previsto, condição de pagamento, observações e "Criar
   rascunho" (ou "Salvar rascunho"). A confirmação acontece na ficha, com revisão final.

Ficha do pedido: ações conforme situação e permissão — rascunho: editar, confirmar, cancelar
(admin); confirmado: expedir, cancelar (admin); expedido e cancelado: nenhuma.

## Endpoints integrados

| Operação                                                                    | Uso                                                |
| --------------------------------------------------------------------------- | -------------------------------------------------- |
| `GET /orders` (`status`, `customerId`, `direction`, `cursor`, `limit`)      | Lista e painéis do Início                          |
| `POST /orders`                                                              | Criar rascunho (sem Idempotency-Key no contrato)   |
| `GET /orders/{id}`                                                          | Ficha e edição                                     |
| `PATCH /orders/{id}` (`expectedVersion`)                                    | Salvar rascunho                                    |
| `POST /orders/{id}/confirm` (`Idempotency-Key`, `expectedVersion`)          | Confirmar (reserva atômica no servidor)            |
| `POST /orders/{id}/dispatch` (`Idempotency-Key`, `expectedVersion`)         | Expedir (reserva vira saída física)                |
| `POST /orders/{id}/cancel` (`Idempotency-Key`, `expectedVersion`, `reason`) | Cancelar rascunho ou confirmado (libera a reserva) |
| `GET /orders/{id}/history`                                                  | Histórico de eventos                               |
| `GET /orders/payment-options/conditions` e `/methods`                       | Condições e formas de pagamento do pedido          |
| `GET /orders/{id}/financial-state`                                          | Resumo financeiro (só admin, após confirmação)     |
| `GET /financial-executions?orderId=`                                        | Execuções financeiras do pedido (só leitura)       |
| `GET /customers`, `GET /products`, `GET /inventory`, `GET /inventory/{id}`  | Cliente, produtos, disponível (reaproveitados)     |
| `GET /users`                                                                | Responsável (admin)                                |

Não usados (fora do escopo desta etapa): `POST /orders/{id}/payment-preview` (o rascunho salvo
já traz as parcelas oficiais), PDFs (`/documents/*.pdf`), recebimentos, créditos, cancelamento
financeiro e execuções retomáveis (escrita), devoluções.

## Regras aplicadas

- **Preços e totais são do servidor.** O carrinho mostra prévia com o preço de tabela e a mesma
  regra de arredondamento do backend (`(preço × milésimos + 500) / 1000`, em BigInt). Depois de
  salvar, a ficha mostra só os snapshots oficiais (`unitPriceCents`, `totalCents`, parcelas); nada
  é reconstruído a partir do cadastro atual.
- **Quantidades** em milésimos inteiros (`lib/quantity`): UN/CX/PCT inteiros, KG/L até 3 casas.
- **Sem limite artificial de itens.** Carrinho com linhas memorizadas; testado com 1, 20, 50, 100
  e 200 produtos (Jest) e 200 produtos contra o backend real.
- **Disponível no carrinho** vem do mesmo cache do estoque (`useAvailability`). Até 50 produtos o
  app consulta cada um; acima disso usa só o que já está em cache (evita centenas de chamadas e o
  limite de taxa do servidor). A decisão final é sempre a confirmação.
- **Vendedor** não escolhe responsável, não aplica desconto, não altera preço, não cancela e não vê
  dados financeiros; o corpo enviado nunca contém `sellerUid` nem `discount` para ele.
- **Pagamento**: condição cadastrada (`paymentConditionId` + versão) **ou** vencimentos manuais
  (`payment`: à vista ou 2–12 parcelas a partir do primeiro vencimento e intervalo), nunca os dois;
  trocar para manual envia `paymentConditionId: null`. Vencimento no passado é recusado antes do
  envio. "Definir depois" é permitido no rascunho; a confirmação exige condição.
- **Rascunho com versão**: o editor fixa a versão ao abrir. Em `CONFLICT`, nada é sobrescrito; a
  tela oferece "Carregar versão atual". Pedido não rascunho não abre para edição.
- **Criação sem Idempotency-Key** (contrato): botão trava durante o envio e nunca há repetição
  automática. Sem resposta, a tela avisa "Não sabemos se o rascunho foi criado" e leva aos
  rascunhos antes de qualquer nova tentativa.
- **Confirmar, expedir e cancelar** usam o registro de intenções de `lib/intent.ts` (compartilhado
  com o estoque): chave por usuário, empresa, tipo e pedido; repetir = mesma chave e mesmo corpo;
  timeout (20 s), falha de rede ou 5xx = resultado desconhecido, com "Tentar de novo", "Atualizar
  pedido" e "Descartar" (com confirmação); demais ações do pedido ficam travadas. Se a releitura
  mostra o pedido já na situação pretendida, a pendência é resolvida sem repetir (resposta perdida
  depois do commit).
- **Erros com orientação**: `INSUFFICIENT_STOCK` (lista os itens sem disponível suficiente, até 50
  produtos), `PRODUCT_UNAVAILABLE`, `INVALID_RESERVATION`, `INVALID_ORDER_STATE`, `CONFLICT`,
  `INCOMPLETE_ORDER`, `INVALID_DUE_DATE`, `CUSTOMER_INACTIVE`, `ORDER_OPERATION_IN_PROGRESS`,
  `FINANCIAL_OPERATION_IN_PROGRESS`, `FINANCIAL_CANCELLATION_REQUIRED`,
  `FINANCIAL_RESUMABLE_REQUIRED`. Nenhum sucesso aparece antes da resposta da API.
- **Estoque**: o app nunca reserva nem baixa estoque. Após cada comando, o pedido salvo entra no
  cache e listas, histórico, saldos, movimentações, reposição e painéis do Início são recarregados.
- **Financeiro (somente leitura)**: a ficha mostra, para administradores, recebido, créditos e
  situação de cada parcela, e execuções financeiras do pedido com o estado real. "Aceita" ou "em
  processamento" nunca aparecem como concluídas; só `financialCompleted` conta como concluída.
- **Empresa e Super Admin**: chaves em `['tenant', id, 'orders', ...]`, removidas na troca de
  empresa; intenções pendentes incluem empresa e usuário no escopo. Super Admin sem vínculo não
  chega às rotas e a API responde 403.

## Componentes e hooks

Novos (`src/features/orders/`): `api.ts` (`useOrderList`, `useOrder`, `useOrderHistory`,
`useConditionOptions`, `useMethodOptions`, `useOrderFinance`, `useCreateOrder`, `useUpdateOrder`,
`useOrderCommand`), `rules.ts` (rótulos, prévia, ações por situação, pagamento, execução),
`OrderEditor`, `CustomerPicker`, `ProductSearch`, `CartList`, `PaymentFields`, `OrderActions`,
`OrderHistoryPanel`, `OrderFinancePanel`, `OrderGlance`.

Reaproveitados/estendidos: `lib/intent.ts` (antes em `features/inventory`; agora genérico, com
`criticalRequest` e `withDeadline`), `useAvailability` e `useSeedInventoryItems` (estoque),
`useCustomerList`, `useProductList`, `useMembers`, `DataTable`, `Dialog`, `ConfirmDialog`,
`Select`, `QuantityInput`, `Segmented`, `ListPanel`, `RecordError`.

Removido: `ModuleNotice` (não restou módulo "em construção" com tela; o Financeiro tem estado
próprio).

## Testes

- `tests/unit/orderRules.test.ts` (16): arredondamento e BigInt, total, linhas canônicas, ações
  por situação/perfil, corpo de pagamento (condição, manual, depois, recusas), datas, execução.
- `tests/unit/ordersScreens.test.tsx` (36): lista (desktop/celular, filtros, cursor, erro/vazio),
  criação (vendedor, admin com responsável e condição, vencimento passado, sem resposta, produto
  indisponível), edição (versão, conflito, não rascunho), confirmação (sucesso + invalidação de
  estoque, estoque insuficiente com divergência, 5 recusas, rede, resposta perdida após commit,
  timeout, pendência isolada por pedido), expedição, cancelamento (motivo, recebimentos),
  execução financeira em andamento, histórico, Super Admin, 404 de carteira, troca de empresa e
  carrinhos de 1/20/50/100/200 produtos.
- `scripts/e2e-orders.ts`: 19 verificações contra o backend real (ver README).

## Limitações e pontos para o backend

1. **Criação de rascunho sem Idempotency-Key.** Perda de resposta no `POST /orders` pode gerar
   rascunho duplicado se a pessoa tentar de novo; a interface orienta conferir os rascunhos. Sugestão:
   aceitar `Idempotency-Key` também na criação.
2. **Sem busca textual de pedidos** nem filtro por responsável/período; só situação, cliente e ordem.
3. **Histórico e responsável sem nome**: só UID (aparece "Você" ou código).
4. **`INSUFFICIENT_STOCK` não diz quais itens faltam**; o app compara com o disponível atual (até 50
   produtos).
5. **Cancelamento de pedido com recebimentos** exige o fluxo financeiro administrativo
   (`/orders/{id}/financial-cancellation` ou execução retomável), com decisão de crédito ou devolução.
   Não foi implementado nesta etapa: a tela explica e não chama esses endpoints.
6. **Desconto administrativo** (`discount` com aprovação) existe no contrato e é exibido quando
   presente, mas a edição de desconto não tem tela nesta etapa.
7. **Teste em aparelho físico e emuladores Android/iOS:** não executado. Bundles compilam; o app foi
   exercitado no navegador (desktop 1280 px e celular 375 px).
