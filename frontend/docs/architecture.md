# Arquitetura do frontend

Diagnóstico e decisões da fundação (Etapa 1). Autenticação, sessão, empresa, permissões,
assinaturas e convites (Etapa 2) estão em [auth.md](auth.md); o "modo prévia" descrito abaixo
foi substituído pela sessão real. Cadastros (Etapa 3): [catalog.md](catalog.md). Estoque (Etapa 4):
[inventory.md](inventory.md). Pedidos (Etapa 5): [orders.md](orders.md). Financeiro (Etapa 6,
Fases A, B e C): [finance-progress.md](finance-progress.md). As seções de diagnóstico abaixo registram
o estado histórico da Etapa 1; o contrato vigente é OpenAPI 0.8.1, com 114 operações e financeiro F02.

## 1. Backend encontrado

`../backend`: Express 5 + TypeScript strict + Firebase Admin + Zod, Fases A–D implementadas e
testadas com emuladores. Base `/api/v1`, Bearer (Firebase ID Token) em todas as rotas privadas,
`X-Tenant-Id` nas rotas da empresa (candidato, validado no servidor). Respostas `{ data, requestId }`;
erros `{ error: { code, message, status, requestId } }` **sem detalhe por campo**.

## 2. Contratos disponíveis (OpenAPI 3.1, v0.4.0)

| Área       | Operações                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------- |
| Identidade | `GET /me` (vínculos, perfil, permissões, acesso)                                             |
| Empresa    | `GET/PATCH /tenants/current`                                                                 |
| Usuários   | `GET /users`, convites (criar, aceitar, revogar), perfil e status                            |
| Clientes   | CRUD lógico, `PATCH /customers/{id}/assignment` (carteira)                                   |
| Produtos   | CRUD lógico, imagem binária privada (`PUT/GET/DELETE /products/{id}/image`)                  |
| Categorias | CRUD lógico                                                                                  |
| Estoque    | saldos, movimentações, reposição, entradas, ajustes, reconciliação                           |
| Pedidos    | lista, criar/editar rascunho, confirmar, expedir, cancelar, histórico                        |
| Plataforma | `/admin/tenants`, `/admin/plans`, `/admin/subscriptions` (Super Admin, autenticação recente) |

**Não existem:** endpoints financeiros (recebimentos, baixas, relatórios), condições de pagamento
cadastráveis, formas de pagamento, busca textual de pedidos, contadores/totais globais.

Constatações que afetam o frontend:

- **Limite de 10 linhas foi removido no código, mas não no `openapi.json` publicado.** O código
  (`src/shared/schemas/orders.ts`, 20:50) não tem `max` em linhas; o `docs/api/openapi.json` do
  backend (20:26) ainda declara `maxItems: 10` e campos obrigatórios antigos. O frontend gera o
  contrato **direto do código-fonte** (`npm run api:sync`), sem escrever na pasta do backend. O
  limite real restante é técnico: documento Firestore de 1 MiB (`ORDER_TECHNICAL_LIMIT`, 413).
- Não há valor mínimo de pedido nem quantidade mínima comercial; total precisa ser positivo
  (`ORDER_TOTAL_REQUIRED`).
- `/me` não traz o nome da empresa; é preciso `GET /tenants/current` depois de escolher o vínculo.
- Busca `q` é **prefixo do nome** e exige `sort=name&direction=asc`. A interface diz "Buscar pelo
  início do nome".
- Paginação só por cursor (máx. 100). Sem total: listas usam "carregar mais", nunca "página 3 de 9".
- Criação de cliente/produto/rascunho **não é idempotente**: nunca repetir POST às cegas.

## 3. Brand kit

Ver [brand.md](brand.md). Resumo: seis cores oficiais, Inter, wordmark `lastro.`, símbolo "L" +
quadrado amarelo. Faltam os arquivos-fonte; wordmark e símbolo são reconstruções isoladas.

## 4. Direção visual (skill frontend-design)

**Ideia central: o app é o símbolo.** O "L" escuro (barra lateral no desktop, barra inferior no
celular) sustenta a área de trabalho bege, e o quadrado amarelo é o marcador de "você está aqui" e
o botão de novo pedido. Toda a ousadia da marca fica nessa estrutura; o conteúdo é sóbrio.

Revisão contra o genérico (o que foi descartado e por quê):

- Linha de KPIs com números grandes e gráficos no Início → removida. A API não oferece totais, e o
  vendedor precisa de listas acionáveis (pedidos recentes, aguardando expedição, abaixo do mínimo).
- Cartões com sombra em tudo → painéis com borda Areia; sombra só em camadas flutuantes.
- Um raio único em tudo → raios por hierarquia (6 badge, 10 controle, 14 painel, 20 folha).
- Rótulos em caixa alta espaçada (presentes nas peças de marketing do kit) → não usados na
  interface; títulos em caixa normal, peso semibold.
- Marcador amarelo repetido em cada estado vazio → testado e removido na revisão visual: competia
  com o marcador de navegação.
- Pílula destacando item ativo do menu → quadrado amarelo do símbolo.

Tokens: [`src/theme/tokens.ts`](../src/theme/tokens.ts). Catálogo vivo: rota `/sistema` (só em
desenvolvimento).

## 5. Arquitetura

- **Um projeto Expo** (SDK 57, Expo Router, React Native Web) para web, Android e iOS.
- **Estado remoto só no TanStack Query.** Sem store global de dados do servidor. Estado local da
  sessão (empresa escolhida) em contexto.
- **Cliente HTTP tipado** com `openapi-fetch` sobre `paths` gerados do contrato: caminho, query e
  corpo inexistentes não compilam. Middleware injeta Bearer e `X-Tenant-Id` (exceto `/me` e
  `/admin/*`).
- **Erros por código estável** ([`src/api/errors.ts`](../src/api/errors.ts)): classificados em
  sessão, permissão, assinatura, conflito, validação, não encontrado, limite, rede, servidor.
  Leituras repetem só falhas transitórias; escritas nunca repetem automaticamente.
- **Idempotência por intenção** ([`src/lib/idempotency.ts`](../src/lib/idempotency.ts)): a mesma
  chave UUID é reutilizada em retentativas da mesma operação e trocada só quando o conteúdo muda.
- **Dinheiro em centavos e quantidades em milésimos inteiros**, como o backend. O cliente formata
  e lê digitação; preço, desconto, total e parcelas vêm sempre do servidor.
- **Permissões vindas de `/me`** controlam só o que aparece. A autorização é do backend.
- **Segredos:** nenhum segredo no app. Firebase Web API key é pública por desenho. Sessão do
  Firebase no nativo será persistida em `expo-secure-store` (Keychain/Keystore), não em
  AsyncStorage. No web, persistência padrão do Firebase (IndexedDB).

## 6. Bibliotecas complementares

| Biblioteca                                 | Por quê                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `openapi-fetch`                            | Cliente de ~6 KB tipado pelo contrato, com middleware; sem gerar código |
| `@hookform/resolvers`                      | Liga Zod ao React Hook Form                                             |
| `lucide-react-native` + `react-native-svg` | Ícones lineares do mesmo estilo do brand kit; importados um a um        |
| `@expo-google-fonts/inter`                 | Inter embarcada nas três plataformas                                    |
| `expo-secure-store`                        | Persistência segura da sessão no nativo (Etapa 2)                       |
| `expo-crypto`                              | `randomUUID` para Idempotency-Key                                       |
| `jest-expo` + Testing Library RN           | Testes unitários e de componentes compatíveis com Expo                  |

Sem biblioteca de componentes de UI: o design system é próprio e pequeno.

## 7. Estrutura de pastas

```text
frontend/
  contract/openapi.json       contrato gerado do código do backend (api:sync)
  scripts/export-openapi.ts   gera o contrato sem escrever no backend
  src/
    app/                      rotas (Expo Router)
      (auth)/                 entrar, recuperar-senha
      (app)/                  área autenticada com AppShell
      sistema.tsx             catálogo do design system (dev)
    api/                      cliente tipado, erros, QueryClient, schema.d.ts gerado
    brand/                    wordmark e símbolo (provisórios)
    config/                   variáveis públicas validadas com Zod
    features/<domínio>/       componentes, hooks e schemas de cada módulo
    layout/                   AppShell, Sidebar, TabBar, Screen
    lib/                      dinheiro, quantidade, idempotência
    navigation/               destinos e permissões exigidas
    session/                  sessão e perfil (prévia na Etapa 1)
    theme/                    tokens, breakpoints, movimento reduzido
    ui/                       componentes do design system
  tests/unit/
  docs/
```

## 8. Compartilhamento web/mobile

Um código só; a forma muda pela largura, não pela plataforma:

- `compact` (< 768): barra inferior, ações em largura total, wordmark no topo.
- `medium` (768–1099): trilho de ícones à esquerda.
- `expanded` (≥ 1100): barra lateral completa.

Diferenças por plataforma ficam em pontos isolados: anel de foco só por teclado no web
(`ui/interaction.ts`), `Switch` nativo, `KeyboardAvoidingView` no iOS, `softwareKeyboardLayoutMode:
resize` no Android. Quando um padrão nativo for melhor (folha inferior para escolher cliente no
celular, por exemplo), ele entra como variante do mesmo componente.

## 9. Navegação

| Destino       | Admin                | Vendedor   | Celular        |
| ------------- | -------------------- | ---------- | -------------- |
| Início        | sim                  | sim        | barra inferior |
| Pedidos       | todos                | próprios   | barra inferior |
| Novo pedido   | sim                  | sim        | botão central  |
| Clientes      | todos                | carteira   | barra inferior |
| Produtos      | gerir                | consultar  | Mais           |
| Estoque       | sim                  | disponível | Mais           |
| Financeiro    | Fases A/B da Etapa 6 | não        | Mais           |
| Configurações | sim                  | leitura    | Mais           |

Super Admin terá grupo de rotas próprio (`(plataforma)/`) sem acesso a dados comerciais das
empresas, conforme as rotas `/admin/*` existentes.

## 10. Riscos e dependências

1. **`openapi.json` do backend desatualizado** em relação ao código (limite de 10 linhas). Mitigado
   gerando do código; recomendável o backend rodar `npm run openapi` ao fechar o ajuste.
2. **Arquivos oficiais da marca ausentes** (SVG, ícone do app, splash).
3. **Fase E inexistente:** condições de pagamento, formas de pagamento, baixas e relatórios
   dependem de contratos novos. Hoje o pedido só aceita `cash|installments` com datas explícitas;
   a interface de condições cadastráveis não terá persistência até existir API.
4. **CORS do backend** aceita `localhost:8081` e `localhost:19006`; o app web de desenvolvimento usa 8081.
5. **Sem detalhe de erro por campo** na API: validação de campo precisa ser local (Zod) e erros do
   servidor aparecem como aviso do formulário.
6. **Nativo não executado:** os bundles Android e iOS compilam (`expo export`), mas nenhum
   emulador ou aparelho foi aberto nesta etapa.
7. **Sessão no nativo:** `expo-secure-store` tem limite prático de tamanho por item; a
   persistência do Firebase precisará dividir valores grandes (Etapa 2).
