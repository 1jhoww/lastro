# Estoque (Etapa 4)

Contrato de referência: OpenAPI 0.8.1 gerado do código do backend (`npm run api:sync`). Nenhum
endpoint, campo, filtro ou regra foi criado no frontend; o backend é a fonte de verdade.

## Telas

| Rota                     | Quem            | O que faz                                                                                  |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------ |
| `/estoque`               | admin, vendedor | Saldos. Admin: físico, reservado, disponível, mínimo e situação. Vendedor: só disponível   |
| `/estoque/[id]`          | admin, vendedor | Saldo de um produto. Admin: três saldos, mínimo, versão do estoque e últimas movimentações |
| `/estoque/entrada`       | admin           | Entrada de mercadoria (`?produto=ID` abre com o produto escolhido)                         |
| `/estoque/ajuste`        | admin           | Ajuste do físico para cima ou para baixo, com motivo                                       |
| `/estoque/movimentacoes` | admin           | Histórico com filtros de produto, tipo, período e ordem                                    |
| `/estoque/reposicao`     | admin           | Produtos com disponível abaixo do mínimo; tocar leva à entrada daquele produto             |
| `/produtos/[id]`         | admin, vendedor | Ficha ganhou o painel "Estoque" (saldo do perfil, atalhos de entrada e histórico)          |
| `/` (Início)             | admin           | "Abaixo do mínimo" agora mostra os 5 produtos com maior falta, com atalho para Reposição   |

Desktop: tabelas com colunas de saldo alinhadas à direita. Celular: lista com nome, físico e
reservado em uma linha e o disponível em destaque; filtros secundários (categoria, situação,
ordem) ficam atrás de "Filtros". Entrada e ajuste são telas inteiras (teclado numérico, campos em
uma coluna, ações em largura total), com revisão em folha inferior.

## Endpoints integrados

| Operação                                                                                    | Uso                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `GET /inventory` (`q`, `sku`, `status`, `categoryId`, `sort`, `direction`, `cursor`)        | Saldos e seletor de produto das movimentações     |
| `GET /inventory/{productId}`                                                                | Saldo de um produto (tela de estoque e ficha)     |
| `POST /inventory/entries` (`Idempotency-Key`)                                               | Entrada                                           |
| `POST /inventory/adjustments` (`Idempotency-Key`, `expectedVersion`)                        | Ajuste                                            |
| `GET /inventory/movements` (`productId`, `type`, `from`, `to`, `direction`, `cursor`)       | Histórico                                         |
| `GET /inventory/replenishment` (`q`, `status`, `categoryId`, `sort`, `direction`, `cursor`) | Reposição e painel do Início                      |
| `GET /products/{id}`                                                                        | Nome dos produtos no histórico (mesmo cache)      |
| `GET /inventory/{productId}/reconciliation`                                                 | Só no E2E (auditoria da cadeia); sem tela por ora |

Permissões do backend: `inventory:available:read` (admin e vendedor) para saldos;
`inventory:manage` (só admin) para entradas, ajustes, histórico, reposição e reconciliação.

## Regras aplicadas

- **Três saldos, cálculo do servidor.** Físico, reservado e disponível chegam como texto canônico
  e são lidos em milésimos inteiros (`lib/quantity`). O app não recalcula `disponível`; só o exibe.
  O estoque mínimo do cadastro aparece separado ("Estoque mínimo cadastrado") e nunca como saldo.
- **Vendedor:** a API devolve só `available`. A interface não tem colunas, filtros de situação,
  ações nem histórico para ele, e as rotas administrativas mostram acesso negado sem chamar a API.
- **Quantidade por unidade:** UN/CX/PCT inteiros; KG/L até 3 casas. Validação local igual à do
  servidor (Zod), digitação com vírgula ou ponto, envio no texto canônico (`"1.255"`, `"-2"`).
- **Prévia do impacto:** físico, reservado e disponível antes → depois, na tela e na revisão.
  Retirada maior que o disponível é bloqueada antes do envio ("o restante está reservado para
  pedidos"), como a regra do servidor (`físico ≥ reservado`). Reservado nunca muda por ajuste.
- **Revisão obrigatória:** preencher → "Revisar" → confirmar. O sucesso só aparece com a resposta
  da API; depois disso o saldo devolvido substitui o do cache e listas, histórico e reposição são
  recarregados.
- **Idempotência por intenção** (`lib/intent.ts`, compartilhado com pedidos):
  - a chave UUID nasce com a intenção e fica num registro fora das telas, separado por usuário,
    empresa, tipo e produto;
  - repetir o mesmo conteúdo reutiliza a chave (o servidor devolve o resultado já gravado);
  - conteúdo diferente gera chave nova (o servidor recusa chave reaproveitada com outro corpo);
  - **confirmada** (2xx): chave descartada; **recusada** (4xx): nada gravado, a pessoa corrige;
  - **desconhecida** (sem resposta, timeout de 20 s ou 5xx): o formulário trava e oferece
    "Tentar de novo" (mesma chave e mesmo corpo), "Ver histórico" e "Descartar" (com confirmação
    explicando o risco de duplicar). Nenhuma chave nova é gerada sozinha; a pendência sobrevive a
    sair e voltar da tela.
- **Versão do estoque:** o ajuste envia `expectedVersion` = versão do **estoque** (campo `version`
  de `/inventory/{id}`), nunca a do cadastro do produto. Em `409 CONFLICT` o saldo é recarregado,
  a tela avisa "O saldo mudou antes da confirmação" e a pessoa revisa de novo (nova chave, nova
  versão). Validado com conflito real no navegador.
- **Histórico imutável:** sem editar ou excluir movimentações (a API não oferece). Entradas e
  ajustes manuais aparecem como "Entrada manual"/"Ajuste manual"; reservas, liberações, expedições
  e devoluções como "Automática (pedido)". O motivo técnico das automáticas ("STOCK_DISPATCH")
  não é exibido como texto de alguém.
- **Responsável:** a API traz só `actorUid`. Aparece "Você" ou "Usuário A1B2C3"; nenhum nome é
  inventado.
- **Cache e empresa:** todas as chaves de estoque ficam em `['tenant', id, 'inventory', ...]`.
  Trocar de empresa cancela e remove esse cache (Etapa 2); as intenções pendentes incluem a
  empresa no escopo e nunca são reaproveitadas em outra. A ficha do produto e a tela de estoque
  usam a mesma chave do saldo: uma consulta só, sem divergência.
- **Super Admin** continua sem vínculo com empresas: as rotas de estoque não carregam e a API
  responde 403 mesmo se chamada (E2E).

## Componentes e hooks novos

- `features/inventory/api.ts`: `useInventoryList`, `useInventoryItem`, `useMovements`,
  `useProductNames`, `useReplenishment`, `useRecordMovement` (+ `movementRequest.timeoutMs`).
- `lib/intent.ts`, compartilhado com pedidos: `createIntentLedger`/`intentLedger`, `intentScope`,
  `usePendingIntent`, `outcomeOf`, `fingerprintOf`, `PendingIntentError`.
- `features/inventory/stock.ts`: `isAdminStock`, `figuresOf`, `needsReplenishment`,
  `previewBalance`, `movementTypeLabel`, `originLabel`, `reasonText`, `movementEffect`,
  `periodStart`.
- `features/inventory/movementRules.ts`: esquema Zod por unidade, `toEntryBody`,
  `toAdjustmentBody`, `deltaMilli`.
- Componentes: `MovementScreen`, `MovementForm`, `ProductPicker`, `MovementTable`,
  `ProductStockPanel`, `BelowMinimumPanel`, `StockParts` (`BalanceFigures`, `StockBar`,
  `StockStatus`, `InventoryNav`, `qty`).
- `ui/DataTable`: `hrefOf` opcional (linhas só leitura) e `stacked` (lista mesmo no desktop).
- `lib/quantity`: `toApiQuantity`/`fromApiQuantity` aceitam sinal (delta de ajuste).
- `lib/dates`: `formatDateTime`.

## Testes

- `tests/unit/inventoryRules.test.ts` (23): quantidade com sinal, saldos, prévia, validação por
  unidade (UN/CX/PCT/KG/L), corpos de entrada e ajuste, idempotência, classificação de resultado,
  histórico e período.
- `tests/unit/inventoryScreens.test.tsx` (33): saldos (admin, vendedor, desktop, celular, SKU,
  cursor, carregando/erro/vazio), detalhe, ficha do produto com cache compartilhado, entrada
  (inteiro, KG, sucesso só após a API, rede, timeout, 5xx, pendência após sair e voltar, descarte,
  recusa), ajuste (reservado, versão, conflito, estoque insuficiente), permissões por rota, Super
  Admin, histórico (filtros, cursor, responsáveis, origem), reposição, Início e troca de empresa.
- `scripts/e2e-inventory.ts`: 17 verificações contra o backend real e os emuladores, usando o
  cliente HTTP do app (ver README).

## Limitações e pontos para o backend

1. **Entrada sem `expectedVersion`.** O contrato de `POST /inventory/entries` não aceita versão
   (só o ajuste). Entrada é soma e a idempotência impede duplicidade, então não há perda; mas a
   prévia exibida pode ficar desatualizada se outra pessoa movimentar no meio. O saldo final
   mostrado é o devolvido pelo servidor.
2. **Histórico sem nomes.** `movementView` traz `productId` e `actorUid`, sem nome do produto nem
   da pessoa. O nome do produto vem de `GET /products/{id}` (uma consulta por produto distinto da
   página, em cache); o responsável aparece como código. Sugestão: incluir `productName` e um
   rótulo do ator na resposta.
3. **Sem filtro por origem ou responsável** no histórico (só produto, tipo e período). "Manual x
   automática" é derivado de `origin`.
4. **Motivo das movimentações automáticas** é o próprio tipo (`reason = "STOCK_RESERVATION"`).
   Sugestão: gravar a referência legível do pedido.
5. **Sem totais.** Listas paginadas por cursor, sem contagem (mesma regra das etapas anteriores).
6. **Reconciliação** (`/inventory/{id}/reconciliation`) existe e foi validada no E2E, mas ficou
   sem tela: é ferramenta de auditoria, fora do pedido desta etapa.
7. **Teste em aparelho físico e emuladores Android/iOS:** não executado. Os bundles Android e iOS
   compilam (`expo export`); o app foi exercitado no navegador (desktop e 375 px).

## Dependências (instalação limpa)

`npm ci` passava, mas `npm ls` acusava `react-native-worklets@0.13.0` inválido para
`expo-modules-core` (peer `^0.7.4 … ^0.10.0`). Causa: `expo-router` declara
`react-native-reanimated` e `react-native-gesture-handler` como peers, e o npm instalava as
versões mais novas (reanimated 4.7.1 → worklets 0.13; gesture-handler 3.3), fora do SDK 57.
Correção pela resolução do próprio Expo: `npx expo install react-native-reanimated
react-native-worklets react-native-gesture-handler`, que fixou `4.5.1`, `0.10.1` e `~2.32.0`
(versões do `bundledNativeModules.json` do SDK 57) e regenerou o `package-lock.json`. Depois
disso, `npm ls` não acusa problemas e `npm ci` instala sem ajuste manual.

Jest: o mock nativo de `expo-crypto` devolve `undefined` em `randomUUID`; `tests/setup.ts` usa
`crypto.randomUUID` do Node para que os testes de idempotência tenham chaves reais.
