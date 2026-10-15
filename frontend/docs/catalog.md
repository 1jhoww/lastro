# Cadastros: clientes, produtos e categorias (Etapa 3)

Contrato de referência: OpenAPI 0.8.1 gerado do código do backend (`npm run api:sync`). Nenhum
endpoint, campo ou filtro foi criado no frontend.

## Telas

| Rota                    | Quem            | O que faz                                                                  |
| ----------------------- | --------------- | -------------------------------------------------------------------------- |
| `/clientes`             | admin, vendedor | Lista, busca por início do nome, situação; admin filtra por responsável    |
| `/clientes/novo`        | admin, vendedor | Cadastro; só o nome é obrigatório                                          |
| `/clientes/[id]`        | admin, vendedor | Ficha; admin desativa/reativa e transfere a carteira                       |
| `/clientes/[id]/editar` | admin, vendedor | Edição com controle de versão                                              |
| `/produtos`             | admin, vendedor | Lista, busca, categoria; admin filtra situação e catálogo                  |
| `/produtos/novo`        | admin           | Cadastro (nome, SKU, unidade, preço, categoria, catálogo, estoque mínimo)  |
| `/produtos/[id]`        | admin, vendedor | Ficha com imagem; admin edita, desativa/reativa, envia/troca/remove imagem |
| `/produtos/[id]/editar` | admin           | Edição enviando só os campos alterados                                     |
| `/produtos/categorias`  | admin           | Lista, busca, criar/editar em diálogo, desativar/reativar                  |

Celular: listas empilhadas com o essencial, ações em largura total, formulários em uma coluna,
seleções em folha inferior. Desktop: tabelas com colunas alinhadas, ficha em duas colunas,
formulários com campos lado a lado.

## Endpoints integrados

| Operação                                                                               | Uso                                                |
| -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `GET /customers` (`q`, `status`, `assignedTo`, `sort=name`, `direction=asc`, `cursor`) | Lista de clientes                                  |
| `POST /customers`                                                                      | Cadastro (sem `assignedTo`; o servidor decide)     |
| `GET /customers/{id}`                                                                  | Ficha                                              |
| `PATCH /customers/{id}`                                                                | Edição (`expectedVersion`) e reativação (`status`) |
| `DELETE /customers/{id}` (`{ expectedVersion }`)                                       | Desativação lógica                                 |
| `PATCH /customers/{id}/assignment`                                                     | Transferência de carteira                          |
| `GET /products` (`q`, `status`, `categoryId`, `catalogVisible`, `cursor`)              | Lista de produtos                                  |
| `POST /products`, `GET/PATCH/DELETE /products/{id}`                                    | Cadastro, ficha, edição, desativação/reativação    |
| `PUT /products/{id}/image?expectedVersion=N`                                           | Upload (bytes crus, `image/jpeg                    | png | webp`) |
| `GET /products/{id}/image`                                                             | Bytes WebP autenticados para a pré-visualização    |
| `DELETE /products/{id}/image?expectedVersion=N`                                        | Remover imagem                                     |
| `GET /categories`, `POST /categories`, `PATCH/DELETE /categories/{id}`                 | Categorias                                         |
| `GET /users`                                                                           | Vendedores para filtro e transferência (admin)     |

Não usados nesta etapa (fora do escopo): `exports/*.csv`, `customers/{id}/credits`,
`catalog-settings`, rotas públicas de catálogo.

## Regras aplicadas

- **Escopo:** todo dado de cadastro fica sob a chave `['tenant', id, ...]`; trocar de empresa
  remove o cache e a tela nunca mostra registros da empresa anterior (teste
  `tenantSwitch.test.tsx` com resposta atrasada da nova empresa).
- **Vendedor:** vê só a própria carteira (filtrada pelo servidor), cadastra clientes que entram
  nela, edita dados dos próprios clientes. Não vê desativar, transferência, cadastro/edição de
  produto, categorias, estoque mínimo, catálogo nem envio de imagem. Produtos: só ativos.
- **Administrador:** tudo acima, mais situação, carteira, produtos, preços, imagens e categorias.
- **404 seguro:** cliente fora da carteira aparece como "Cadastro não encontrado", sem confirmar
  que existe.
- **Versão:** edições e mudanças de situação enviam `expectedVersion`. Em `CONFLICT`, nada é
  sobrescrito: o formulário pede "Carregar versão atual"; ações diretas recarregam o registro.
- **Erros no campo certo:** `DUPLICATE_DOCUMENT` → CPF/CNPJ, `DUPLICATE_SKU` → SKU,
  `INVALID_CATEGORY` → categoria, `UNIT_LOCKED` → unidade, `INVALID_PRECISION` → estoque mínimo.
- **Envio duplicado:** botões travam durante o envio; criações (sem `Idempotency-Key` no contrato)
  nunca repetem automaticamente.
- **Validação local = backend:** nome 2–160, CPF/CNPJ (inclusive alfanumérico) pelo mesmo cálculo,
  telefone 8–15 dígitos, UF de 2 letras, CEP de 8 dígitos, SKU `[A-Za-z0-9][A-Za-z0-9._-]*` até 64.
- **Dinheiro e quantidade:** preço em centavos inteiros (campo por deslocamento de dígitos, limite
  R$ 1.000.000,00); estoque mínimo convertido para o texto canônico (`"1.25"`), inteiro para
  UN/CX/PCT e até 3 casas para KG/L. Cadastro de produto não movimenta estoque.
- **Edição de produto envia só o que mudou:** evita `UNIT_LOCKED` e nova reserva de SKU quando
  esses campos não foram alterados.
- **Categoria inativa:** some do seletor de novos vínculos; produto que já a usa mostra
  "(inativa)". Desativar não apaga nem desvincula produtos.
- **Imagem:** escolhida com `expo-image-picker`, validada (tipo e 5 MB) antes do envio, enviada
  como bytes pelo `PUT` do contrato, exibida a partir dos bytes autenticados (data URI em memória,
  nunca URL pública). Falha do servidor ao gravar (ex.: Storage indisponível no ambiente) aparece
  como erro, sem fingir sucesso.

## Componentes e hooks novos

- `ui`: `Dialog` (folha no celular, caixa no desktop), `ConfirmDialog`, `Select`, `ToastProvider`
  /`useToast`, `DataTable` (tabela no desktop, linhas empilhadas no celular).
- `features/catalog`: `useCursorList`/`listParams`, `ListPanel`, `RecordLoading`/`RecordError`,
  `FormSection`/`FieldRow`/`FormActions`/`SubmitError`, `Fact`/`Facts`/`DetailColumns`.
- `features/customers`: hooks de dados, esquema do formulário, `CustomerForm`.
- `features/products`: hooks de dados e imagem, esquema do formulário, `ProductForm`,
  `ProductImagePanel`.
- `features/categories`: hooks de lista, consulta completa (seletores) e mutações.
- `features/users`: `useMembers`, `useAssigneeLabel`.
- `lib`: `document.ts` (CPF/CNPJ, telefone, CEP), `useDebouncedValue`.

## Limitações e pontos para o backend

1. **Membros sem nome ou e-mail.** `GET /users` devolve só `id`, perfil e situação. Filtro e
   transferência de carteira mostram "Vendedor A1B2C3". Sugestão: incluir `email` (e nome, se
   houver) no `memberView` para administradores.
2. **Busca só por início do nome.** Não há busca por CPF/CNPJ, cidade ou trecho do nome. Para SKU
   existe filtro exato (`sku`), ainda não exposto na interface.
3. **Sem contagem de produtos por categoria.** A confirmação de desativação não informa quantos
   produtos usam a categoria (a API não tem total).
4. **Unidade travada só é descoberta no envio.** O produto não informa se já teve movimentação;
   o `UNIT_LOCKED` volta ao salvar e é mostrado no campo.
5. **Runtime do backend.** O backend exige Node `>=22.23.3 <23`; esta máquina tem 22.16.0. O E2E
   desta etapa usou um Node 22.23.3 portátil na pasta temporária da sessão.
