# Auditoria arquitetural do Lastro (2026-10-15)

Base: grafo do graphify em `graphify-out/` (3634 nós, 15488 arestas, 110 comunidades), análise estática própria dos imports de `backend/src` e `frontend/src` e leitura do código-fonte. O código de produção não foi alterado. A árvore de trabalho tinha alterações não commitadas no financeiro do frontend (`lib/calendar.ts`, `features/finance/*`, `api/errors.ts`); onde elas tocam um achado, isso está indicado.

## Veredito

A arquitetura está saudável e pode crescer. Não há ciclo de import em tempo de execução: os dois ciclos de arquivo existentes passam só por `import type`. O contrato HTTP é declarativo e validado na saída. O OpenAPI é gerado do código e os tipos do frontend são gerados dele. O cache do frontend é isolado por empresa. As decisões difíceis estão em ADRs, e os testes são extensos (20 arquivos unitários e 29 de integração no backend).

Os problemas reais são de fronteira e de semântica, não de estrutura:

- A infraestrutura conhece o domínio financeiro.
- `shared/` depende de módulos.
- Alguns helpers transversais moram no módulo errado.
- Dois códigos de erro comunicam a coisa errada ao usuário.
- Nenhuma dessas garantias é verificada em CI.

Todos os itens têm correção incremental, sem mexer em regra de negócio.

Escala usada:

- **Severidade:** Alta / Média / Baixa.
- **Impacto:** o que piora se nada for feito.
- **Esforço:** P (horas), M (1–3 dias), G (semana ou mais).

## 1. `requireCondition()` e as 15 comunidades do backend

**Conclusão: falso positivo como problema arquitetural.**

`requireCondition` é uma asserção de 3 linhas que lança `AppError` ([appError.ts:12-19](../../backend/src/shared/errors/appError.ts)). Ela aparece 343 vezes em 38 arquivos, e `appError.ts` tem o maior fan-in do backend (52 arquivos). A centralidade vem de ser a guarda padrão de todos os serviços, inclusive o Livro Financeiro (19 usos em `financialBook.ts`) e as Devoluções (22 em `returnService.ts`). Ela não liga essas comunidades por lógica de negócio. A ponte que o grafo mostra é um artefato: todos chamam o mesmo utilitário folha, que não depende de nenhum módulo.

O que vale observar, e está nos itens A4 e A5, é o efeito colateral dessa escolha. Cada chamada escreve o status HTTP e o código de erro como literais. Não existe catálogo central de códigos, então o frontend não tem garantia de compilação de que trata cada um.

O acoplamento real entre Livro Financeiro e Devoluções existe, mas passa por outros caminhos:

- `returnService.ts:7-8` importa `Book` e `FinancialService` só como tipo.
- `finance/resolution/executionService.ts:22-23`, `executionPhases.ts:11-13` e `executionPublication.ts:10-11` importam `ReturnService` (tipo), `returnEventHash`, `returnedValueLimits` e `returnState` (valores).

Esse acoplamento é intencional: a resolução financeira de devolução é um único executor retomável (ADR 0008, proposta F02). Só a localização de `returnEventHash` é um problema (item A3).

## 2. Achados confirmados

| ID | Achado | Severidade | Impacto | Esforço |
|----|--------|-----------|---------|---------|
| A1 | Repositório de infraestrutura executa lógica do domínio financeiro em toda leitura | Média | Acoplamento oculto e custo de leitura | P |
| A2 | `shared/schemas` importa de módulos de domínio | Média | `shared` deixa de ser folha | P |
| A3 | Helpers transversais em módulos errados criam ciclos entre módulos | Baixa–Média | Ciclos finance⇄returns/orders/inventory | P |
| A4 | `assertDocumentFits` sempre responde `ORDER_TECHNICAL_LIMIT` ("Pedido excede…") | Baixa–Média | Mensagem e conselho errados fora de pedidos | P–M |
| A5 | `LEGACY_FINANCIAL_REVIEW_REQUIRED` cai no texto genérico "Recarregue a tela" | Média | Contradiz a ADR 0008 e induz o usuário ao erro | P |
| A6 | Serviços transacionais de 800–1100 linhas com métodos de 200–290 linhas | Média (crescimento) | Custo de mudança crescente no financeiro | M contínuo |
| A7 | Objetos criados fora da raiz de composição; `createRoutes` com 17 parâmetros posicionais | Baixa | Fiação espalhada | P |
| A8 | Gerador OpenAPI em `modules/auth` importa `app/routes`; frontend importa código do backend | Baixa | Inversão de camada e acoplamento entre projetos | P |
| A9 | `session/` do frontend importa `features/files` | Baixa | Camada base depende de feature | P |
| A10 | `features/finance` usa `features/orders/rules` para datas e execuções; datas duplicadas em `lib/calendar.ts` | Baixa | Duplicação e posse errada | P |
| A11 | Rotas em `src/app` fazem acesso a dados direto | Baixa | Contraria `frontend/AGENTS.md` e foge do registro de chaves | P por tela |
| A12 | Sem CI, sem regra de fronteira de import, duas cópias do OpenAPI sem verificação | Média (processo) | Garantias dependem de disciplina local | P–M |
| A13 | Exports mortos | Baixa | Ruído | P |

### A1. Infraestrutura conhece o domínio financeiro (Média, P)

**Evidência:**

- [foundationRepository.ts:10](../../backend/src/infrastructure/repositories/foundationRepository.ts) importa `EconomicView` de `modules/finance/resolution/economicView.ts`.
- `readSnapshot` (linhas 89-106) passa todo documento de empresa com caminho de 4 segmentos por `EconomicView.resolve` (linha 100).
- `resolve` ([economicView.ts:369-422](../../backend/src/modules/finance/resolution/economicView.ts)) trata `financialEvents`, `returnEvents`, `orders`, `returns` e marcadores `pending*`. Ele verifica provas e devolve a versão "antes" ou "depois" da execução.

**Por que importa:** a sobreposição é deliberada. Ela garante que nenhuma leitura veja estado intermediário de uma execução financeira (ADR 0008, F02). O problema é onde ela mora:

- Qualquer coleção nova lida por `foundation.read` passa, sem aviso, por código do financeiro.
- As leituras de prova contam no orçamento de leitura (`checkReadBudget` nas linhas 21 e 32).
- A camada de infraestrutura passa a ter um ciclo de módulo com `modules/finance/resolution`.

**Correção incremental, sem mudança de comportamento:**

1. Declare em `infrastructure/` uma interface `SnapshotResolver` com `resolve(tenantId, collection, id, raw, tx?)` e `publishedSource(...)`.
2. Receba essa interface no construtor de `FoundationRepository`.
3. Crie o `EconomicView` em [app.ts](../../backend/src/app/app.ts), junto com os outros serviços.

Os testes `financialEconomicView` (unitário e integração) já cobrem o comportamento.

### A2. `shared/schemas` depende de módulos (Média, P)

**Evidência:**

| Arquivo | Linha | Importa | De |
|---------|-------|---------|-----|
| [shared/schemas/commercial.ts](../../backend/src/shared/schemas/commercial.ts) | 4 | `validDocument`, `normalizeDocument` | `modules/customers/documents.ts` |
| [shared/schemas/inventory.ts](../../backend/src/shared/schemas/inventory.ts) | 5 | `MAX_SCALED`, `movementTypes` | `modules/inventory/quantities.ts` |
| [shared/schemas/returns.ts](../../backend/src/shared/schemas/returns.ts) | 6 | `MAX_SCALED` | `modules/inventory/quantities.ts` |
| [shared/schemas/financialExecutions.ts](../../backend/src/shared/schemas/financialExecutions.ts) | 6 | `financialGuardSchema` | `modules/receivables/orderReceivables.ts` |

**Por que importa:** é isso que transforma o backend inteiro em um único componente fortemente conectado no nível de módulo. Qualquer módulo importa `shared/schemas`, e `shared/schemas` importa módulos. Não há quebra em tempo de execução hoje, mas qualquer import novo de valor nessa direção pode criar um ciclo real de inicialização ESM.

**Correção:** mova os símbolos puros (validação de CPF/CNPJ, constantes de quantidade, `financialGuardSchema`) para `shared/`. Mantenha um re-export no arquivo antigo para não mexer nos chamadores. Nenhuma regra muda, só o endereço.

### A3. Helpers transversais no módulo errado (Baixa–Média, P)

| Símbolo | Mora em | Usado por |
|---------|---------|-----------|
| `assertDocumentFits` | [orders/technicalSize.ts:24](../../backend/src/modules/orders/technicalSize.ts) | catalog, finance (5 arquivos), returns, `resolution/sourceIndex` |
| `reservationIdFor` | [inventory/orderStockAdapter.ts:12](../../backend/src/modules/inventory/orderStockAdapter.ts) | orders, finance, returns, `resolution/executionPhases` |
| `returnEventHash` | [returns/returnService.ts:17](../../backend/src/modules/returns/returnService.ts) | `resolution/executionService.ts:23`, `resolution/executionPublication.ts:10` |

**Por que importa:**

- Esses três helpers criam os ciclos de módulo finance⇄orders, finance⇄inventory e finance⇄returns.
- `returnEventHash` é uma função pura que vive dentro de um serviço de 820 linhas. Importá-la carrega o serviço inteiro.
- `assertDocumentFits` é uma regra de armazenamento do Firestore, não de pedidos.

**Correção:** mova cada um para um arquivo neutro:

- `shared/firestore/documentSize.ts`
- `inventory/reservationIds.ts`
- `returns/hashes.ts` ou `returns/calculation.ts`

Deixe re-exports nos endereços antigos.

### A4. Erro técnico de pedido usado fora de pedidos (Baixa–Média, P–M)

**Evidência:** [technicalSize.ts:24-31](../../backend/src/modules/orders/technicalSize.ts) sempre lança `413 ORDER_TECHNICAL_LIMIT` com a mensagem "Pedido excede o tamanho técnico de documento". A função também é chamada para:

- configurações do catálogo ([catalogService.ts:116-117](../../backend/src/modules/catalog/catalogService.ts));
- pagamentos ([financialService.ts:139](../../backend/src/modules/finance/financialService.ts));
- eventos financeiros ([financialBook.ts:335-337](../../backend/src/modules/finance/financialBook.ts));
- devoluções e recebimentos de devolução ([returnService.ts:244-245, 588](../../backend/src/modules/returns/returnService.ts)).

O frontend traduz esse código para "Divida em dois pedidos" ([errors.ts:145](../../frontend/src/api/errors.ts)). Esse conselho é inútil para um evento financeiro ou uma devolução grande. A proposta `large-order-snapshots` mostra que o limite de 1 MiB é alcançável.

**Correção:** dê a `assertDocumentFits` um código opcional. O padrão continua `ORDER_TECHNICAL_LIMIT`, para manter o contrato dos pedidos. Os outros chamadores passam um código próprio, por exemplo `DOCUMENT_TECHNICAL_LIMIT`.

Isso muda o contrato da API. Antes de liberar, atualize `docs/api/frontend-contract.md`, o `errors.ts` do frontend e o teste `orderCapacity.test.ts:251`.

### A5. Bloqueio de legado aparece como "recarregue a tela" (Média, P)

**Evidência:** `409 LEGACY_FINANCIAL_REVIEW_REQUIRED` é lançado em:

- [financialBook.ts:107-108 e 136-137](../../backend/src/modules/finance/financialBook.ts);
- [financialReads.ts:171-172](../../backend/src/modules/finance/financialReads.ts).

O frontend não tem mensagem própria para ele. Por ser 409, cai no fallback de conflito: "Estes dados mudaram desde que você abriu a tela. Recarregue para ver a versão atual." ([errors.ts](../../frontend/src/api/errors.ts), objeto `fallback`).

A ADR 0008 diz que dinheiro legado sem origem comprovada "bloqueia para revisão formal". Recarregar nunca resolve: o usuário entra em laço. A alteração em andamento em `errors.ts` adiciona `FINANCIAL_INTEGRITY` e outros códigos, mas não este.

**Contexto:** 42 dos 89 códigos de erro do backend não têm mensagem própria no frontend. A maioria fica bem com o fallback por tipo (`FORBIDDEN`, `RESOURCE_NOT_FOUND`, `RATE_LIMITED` etc.). Os que pedem uma ação diferente da genérica merecem texto próprio, por exemplo `LEGACY_FINANCIAL_REVIEW_REQUIRED`, `FINANCIAL_SOURCE_GENERATION_STALE`, `RETURN_NOT_RESOLVABLE` e os `DOCUMENT_*_LIMIT`.

**Correção agora:** adicione a mensagem, por exemplo "Este pedido tem lançamentos antigos que precisam de revisão administrativa antes de novos movimentos". **Depois:** publique a lista de códigos no OpenAPI (enum em `errorView`) para que o frontend seja verificado na compilação.

### A6. Scripts de transação longos (Média para crescimento, M contínuo)

| Arquivo | Linhas | Método maior |
|---------|--------|--------------|
| [financialService.ts](../../backend/src/modules/finance/financialService.ts) | 1131 | `cancel` (848-1008), `prepareRebate` (717-848) |
| [executionService.ts](../../backend/src/modules/finance/resolution/executionService.ts) | 1116 | `advance` (465-754), `start` (166-432) |
| [executionPhases.ts](../../backend/src/modules/finance/resolution/executionPhases.ts) | 1102 | `planning` (74-341) |
| [orderService.ts](../../backend/src/modules/orders/orderService.ts) | 864 | `command` (512-713) |
| [returnService.ts](../../backend/src/modules/returns/returnService.ts) | 820 | `guards` (65-183) |

No frontend, [SettingsScreen.tsx](../../frontend/src/features/finance/SettingsScreen.tsx) tem 862 linhas e `EconomicForm.tsx` tem 649.

**Leitura:** isso não é violação de responsabilidade. Cada método é uma transação Firestore completa, e partir ao meio pode separar leitura e escrita que precisam ficar no mesmo commit. A cobertura de testes é alta. O risco é o custo de cada mudança e a revisão difícil.

**Recomendação:** não refatore agora. Adote a regra "extrair ao tocar": funções puras de cálculo e validação saem do método quando ele for alterado. Ative `max-lines-per-function` como aviso, não erro, para dar visibilidade.

### A7. Composição fora da raiz (Baixa, P)

**Evidência:**

- [routes.ts:258](../../backend/src/app/routes.ts) cria `new FinancialExecutions(finance, returns)` dentro do roteador.
- `createRoutes` recebe 17 parâmetros posicionais (linhas 238-256).
- Serviços criam as próprias dependências:
  - `FinancialBook` três vezes: `financialService.ts:26`, `financialReads.ts:23`, `sourceBackfill.ts:97`.
  - `FinancialLocks` duas vezes: `orderService.ts:41`, `financialCommands.ts:28`.

Conferi que essas classes não guardam estado: não há cache, `Map` ou `Set` de instância. Então não existe bug de consistência.

**Correção:** crie `FinancialExecutions` em `app.ts`. Troque os parâmetros posicionais por um objeto `services`.

### A8. OpenAPI no lugar errado (Baixa, P)

**Evidência:**

- [modules/auth/openapi.ts:2](../../backend/src/modules/auth/openapi.ts) importa `routeDefinitions` de `app/routes.ts`: um módulo depende da camada de aplicação.
- [frontend/scripts/export-openapi.ts:3](../../frontend/scripts/export-openapi.ts) importa o fonte do backend.
- `api:sync` ([frontend/package.json:61](../../frontend/package.json)) roda com `../backend/node_modules`.

**Correção:** mova o arquivo para `app/openapi.ts` e deixe um re-export no endereço antigo. Para o frontend, a cópia já versionada em `backend/docs/api/openapi.json` pode ser a fonte, sem executar código do backend.

### A9. Sessão depende de feature de arquivos (Baixa, P)

**Evidência:** [SessionContext.tsx:22-23](../../frontend/src/session/SessionContext.tsx) importa `resetPrivateFiles` e `clearOrphanFiles` de `features/files`, e `features/files/OrderDocuments.tsx` importa `session/`.

**Motivo legítimo:** limpar arquivos privados ao sair ou trocar de empresa é requisito de segurança.

**Correção:** mova `fileEpoch` para `lib/`, ou faça a sessão expor um registro de callbacks de encerramento que `features/files` assina.

### A10. Finanças usa regras de pedidos como biblioteca (Baixa, P)

**Evidência:** são 23 imports de `features/finance` para `features/orders`:

- `todayIn` (7 usos) e `parseCalendarDate` (2), que são utilitários de data.
- `executionDone`, `executionPublished` e `executionStatusLabel`, que são conceitos financeiros.
- Todos vêm de [orders/rules.ts:116-210](../../frontend/src/features/orders/rules.ts).

O arquivo novo, ainda não commitado, [lib/calendar.ts](../../frontend/src/lib/calendar.ts) reimplementa os mesmos algoritmos:

| `lib/calendar.ts` | `orders/rules.ts` |
|-------------------|-------------------|
| `addDays` | `addDays` (idêntico) |
| `isIsoDate` | `isCalendarDate` |
| `parseBrDate` | `parseCalendarDate` |
| `formatIsoDate` | `formatCalendarDate` |

**Correção, quando o trabalho atual entrar:**

- `orders/rules.ts` passa a re-exportar de `lib/calendar.ts`, e `todayIn` vai para lá.
- Os helpers de execução vão para `features/finance`.

Reusar `CustomerPicker`, `useOrder` e `useMethodOptions` é legítimo.

### A11. Acesso a dados dentro de `src/app` (Baixa, P por tela)

**Evidência:** estas rotas declaram `useQuery` ou `useMutation` com `api.GET` e `api.POST` direto:

- [configuracoes/catalogo.tsx:51-55](../../frontend/src/app/(app)/configuracoes/catalogo.tsx), com chave literal `['tenant', tenantId, 'catalog-settings']` fora de `queryKeys`;
- `configuracoes/usuarios.tsx`;
- `convite.tsx`;
- `empresas.tsx`;
- `plataforma/nova-empresa.tsx`.

Isso contraria [frontend/AGENTS.md](../../frontend/AGENTS.md): "Keep non-route code … outside `src/app/`". O prefixo `['tenant', id]` é respeitado, então não há bug de isolamento.

**Correção:** mova cada consulta para o `api.ts` da feature quando a tela for alterada, e registre a chave em `queryKeys`.

### A12. Garantias sem CI (Média, processo, P–M)

**Evidência:**

- `.github/` só tem `copilot-instructions.md`, sem workflows. Não há outro CI versionado.
- `typecheck`, `lint`, os mais de 600 testes e `check:openapi` rodam só localmente.
- Nenhuma regra de lint protege fronteiras de import: não há `no-restricted-imports` nem `import/no-cycle` nos `eslint.config.js`.
- `backend/docs/api/openapi.json` e `frontend/contract/openapi.json` são idênticos hoje (verificado com `cmp`), mas nada impede que divirjam.

**Correção:**

- Crie um workflow mínimo com `npm ci`, `typecheck`, `lint`, os testes unitários dos dois projetos e `check:openapi`.
- Compare as duas cópias do OpenAPI no CI.
- Adicione `no-restricted-imports` para `shared/**` e `infrastructure/**` não importarem `modules/**`, aplicado depois de A1 e A2.
- Os testes de integração com emulador podem ficar em um job separado.

### A13. Exports mortos (Baixa, P)

Estes exports não são referenciados em nenhum lugar, nem no próprio arquivo:

- **Backend:** os tipos `Customer` e `Category` (`shared/schemas/commercial.ts`); `Identity`, `Invitation`, `Plan` e `Audit` (`shared/schemas/models.ts`).
- **Frontend:**
  - cerca de 20 aliases em [api/types.ts](../../frontend/src/api/types.ts) (`PublicCatalog`, `CustomersPage`, `OrdersPage`, `RecordStatus` e outros);
  - `isApiError`;
  - `IntentLedger` (`lib/intent.ts`);
  - `motion` (`theme/tokens.ts`);
  - `Hint` (`catalog/FormParts.tsx`);
  - `ConditionValues` e `MethodValues` (`finance/administrationRules.ts`);
  - `titleLabels` (`finance/rules.ts`), provavelmente substituído pelo `presentation.ts` em andamento.

**Correção:** remova aos poucos. Uma ferramenta como `knip` acha os próximos.

## 3. Integridade do grafo (falsos positivos)

O graphify reportou 467 arestas soltas, 19 autorreferências e 82 nós isolados. Reconstruí a extração a partir do cache e classifiquei cada caso.

**Arestas inválidas:** 695 arestas brutas apontam para um nó inexistente. Depois da deduplicação, o diagnóstico mostra 467, e separa 196 como referências externas. Todas vêm do extrator de AST; zero vêm da extração semântica dos documentos.

| Tipo | Quantidade | Exemplo | Causa |
|------|-----------|---------|-------|
| `imports` para membros de barrel do frontend | 496 | `frontend_src_theme_index_color`, `frontend_src_ui_icons_plus` | `theme/index.ts` e `ui/icons.ts` re-exportam, e o extrator não segue o re-export até a definição |
| `imports_from` para pacotes externos | 198 | `ref_zod`, `ref_node_fs`, `ref_node_crypto` | Pacotes não viram nós |
| `re_exports` não resolvido | 1 | — | Mesma limitação |

**Conclusão:** nenhuma dessas arestas indica erro no código.

**Autorreferências (19):**

- **6 são recursões reais e corretas:**
  - `stableJson` ([crypto.ts:4-12](../../backend/src/shared/utils/crypto.ts));
  - `valueSize` ([technicalSize.ts:6-21](../../backend/src/modules/orders/technicalSize.ts));
  - `toApiQuantity` e `fromApiQuantity` ([quantity.ts:43-54](../../frontend/src/lib/quantity.ts));
  - `canonicalJson` (`intentStorageCore.ts:31`);
  - `walk` (`scripts/check-secrets.mjs:20`).
- **13 são colisões de nome no extrator:**
  - `read` chamando `repo.foundation.read` (3);
  - `create` chamando `tx.create` (5);
  - `download` chamando `.download()`;
  - `ReadGate.run` chamando `budgets.run`;
  - `digest` chamando `createHash().digest`;
  - `png` chamando `.png()` do sharp;
  - `delete` chamando `files.delete` em teste.

**Nós isolados (82):** são chaves de `package.json`, `tsconfig.json` e `app.json`, constantes zod usadas só via `z.infer`, e campos do JSON de evidência. Só um arquivo tem grau zero: `backend/scripts/npm.ps1`, porque o graphify não extrai PowerShell. O subconjunto que é código morto de fato está em A13.

## 4. God Nodes e comunidades de baixa coesão (falsos positivos)

| Nó | Arestas | Leitura |
|----|---------|---------|
| `Text()`, `Button()`, `Alert()` | 226 / 176 / 128 | Primitivas de UI. `theme/index.ts` tem fan-in 115 e `ui/index.ts` 105. Esperado. |
| `useSession()` | 170 | Contexto de sessão; [SessionContext.tsx](../../frontend/src/session/SessionContext.tsx) tem 289 linhas. Esperado. A9 trata a única dependência indevida. |
| `requireCondition()` | 185 | Ver seção 1. |
| `Actor` | 147 | Tipo do contexto de autenticação passado a todos os serviços. Esperado. |
| `unwrap()`, `toApiError()` | 140 / 114 | Ponto único de tratamento HTTP no frontend. É um ponto forte. |
| `digest()` | 130 | Hash das provas financeiras (Merkle, eventos). Esperado no desenho F02. |
| `react-native` | 122 | Dependência de plataforma. |

**Comunidades de baixa coesão:**

- `UI Kit e Tema` (0.033), `Schemas e Erros Backend` (0.051) e `Telas Financeiro Frontend` (0.047) têm coesão baixa por construção. São folhas que compartilham um import comum, agrupadas pelo algoritmo de comunidades, mas sem ligação entre si.
- Em `Telas Financeiro`, o tamanho reflete o tamanho real da feature (ver A6).
- Coesão baixa aqui não indica módulo para dividir.

**Outros falsos positivos:**

- **Ciclos de arquivo:** só dois, ambos com `import type`:
  - `financialBook.ts` ↔ `resolution/sourceIndex.ts` (`sourceIndex.ts:4`);
  - `routes.ts` ↔ `*Routes.ts` (tipo `Route`).

  O ESM apaga esses imports, então não há ciclo em tempo de execução. Isso bate com o "Import Cycles: None" do graphify.
- **Várias instâncias de `FinancialBook`:** sem estado (A7).
- **Validação de CPF/CNPJ duplicada** entre `backend/src/modules/customers/documents.ts` e `frontend/src/lib/document.ts`: espelho intencional entre dois deploys. O risco de divergência é pequeno. Um teste com os mesmos casos nos dois lados resolveria.
- **Conexões entre as regras caveman** (`.clinerules`, `.github`, `.opencode`, `.windsurf`): configuração duplicada de propósito para cada ferramenta.

## 5. Pontos fortes confirmados

- **Contrato declarativo:** `routeDefinitions` vem dos `*Routes.ts`. Rota sem handler falha na subida ([routes.ts:820-821](../../backend/src/app/routes.ts)), e toda saída passa por `definition.output.parse` antes de responder.
- **Uma fonte de verdade para o contrato:** o OpenAPI é gerado do código e verificado por `check:openapi`. Os tipos do frontend são gerados dele (`schema.d.ts`).
- **Portas e adaptadores onde o domínio cruza agregados:** `OrderStockPort`, `OrderReceivablesPort` e `ReturnStockAdapter`.
- **Isolamento por empresa no cache:** prefixo `['tenant', id]` documentado em [queryKeys.ts](../../frontend/src/api/queryKeys.ts) e respeitado mesmo nas chaves literais.
- **Decisões registradas** em `backend/docs/adr/0001-0008` e cobertura de testes alta no financeiro.

## 6. Riscos

1. **Mudança no financeiro:** A6 e A1 concentram o risco. Cada alteração no executor exige entender `EconomicView`, que atua em leituras de outros módulos.
2. **Regressão silenciosa de fronteira:** sem CI e sem lint de imports (A12), A2 e A3 tendem a piorar com o crescimento.
3. **Comunicação de bloqueios ao usuário:** A4 e A5 dão orientação errada em situações financeiras. Esse é o risco de maior impacto para o negócio na lista.
4. **Divergência de contrato:** as duas cópias do OpenAPI e os códigos de erro fora do contrato (A5, A12).

## 7. Plano de ação priorizado

Cada passo é independente, preserva o comportamento e pode ser um commit próprio.

| Ordem | Ação | Achado | Esforço | Risco de regressão |
|-------|------|--------|---------|--------------------|
| 1 | Mensagem própria para `LEGACY_FINANCIAL_REVIEW_REQUIRED`; revisar `FINANCIAL_SOURCE_GENERATION_STALE`, `RETURN_NOT_RESOLVABLE` e `DOCUMENT_*_LIMIT` | A5 | P | Nenhum |
| 2 | Workflow de CI mínimo + comparação das cópias do OpenAPI | A12 | P–M | Nenhum |
| 3 | Mover símbolos puros de módulos para `shared/` com re-export | A2 | P | Baixo (só endereço) |
| 4 | Mover `assertDocumentFits`, `reservationIdFor` e `returnEventHash` para arquivos neutros com re-export | A3 | P | Baixo |
| 5 | Lint `no-restricted-imports` para `shared/**` e `infrastructure/**` | A12 | P | Nenhum (depois de 3 e 6) |
| 6 | Injetar `SnapshotResolver` no `FoundationRepository` | A1 | P | Baixo; coberto por `financialEconomicView` |
| 7 | `FinancialExecutions` e `createRoutes` com objeto de serviços em `app.ts` | A7 | P | Baixo |
| 8 | `openapi.ts` para `app/` | A8 | P | Baixo |
| 9 | Código de erro por chamador em `assertDocumentFits` | A4 | P–M | Médio: muda o contrato; coordenar com o frontend |
| 10 | Unificar datas em `lib/calendar.ts`; helpers de execução para finance | A10 | P | Baixo; fazer depois do trabalho em andamento |
| 11 | Desacoplar `session/` de `features/files` | A9 | P | Baixo |
| Contínuo | Extrair ao tocar nos serviços grandes; mover queries de `src/app` ao alterar a tela; remover exports mortos | A6, A11, A13 | — | — |

**Não recomendado agora:**

- Dividir os serviços financeiros em várias classes.
- Introduzir uma camada de domínio separada.
- Trocar a sobreposição de `EconomicView` por outro mecanismo.

Qualquer um desses tocaria regras já validadas por mais de 600 testes, sem ganho proporcional.

## Método

- **Grafo:** graphify 0.9.91 sobre 503 arquivos de código e 61 documentos (imagens excluídas). A extração semântica dos documentos foi feita por 5 subagentes.
- **Imports:** análise estática própria de `backend/src` (93 arquivos, 553 arestas) e `frontend/src` (233 arquivos, 1255 arestas). Ela resolve `.js`→`.ts` e o alias `@/`, separa `import type` de import de valor e calcula componentes fortemente conectados por arquivo e por módulo.
- **Verificação:** cada achado foi conferido no código, com linhas citadas acima. Também foram conferidos os exports não referenciados e os códigos de erro do backend contra o mapa de mensagens do frontend.
