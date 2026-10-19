# Lastro — frontend

App do Lastro para web (desktop e celular), Android e iOS em um único projeto Expo.

Estado: **Etapa 5** — login, empresa e permissões (Etapa 2), cadastros (Etapa 3), estoque
(Etapa 4) e pedidos de ponta a ponta: rascunho, carrinho, confirmação com reserva, expedição,
cancelamento e histórico. O módulo Financeiro (contas a receber, baixas) ainda mostra só o estado
vazio; a ficha do pedido já exibe o resumo financeiro somente leitura para administradores.

- [Autenticação, empresa e permissões](docs/auth.md)
- [Cadastros: clientes, produtos e categorias](docs/catalog.md)
- [Estoque: saldos, entradas, ajustes, histórico e reposição](docs/inventory.md)
- [Pedidos: rascunho, confirmação, expedição e cancelamento](docs/orders.md)
- [Arquitetura e diagnóstico](docs/architecture.md)
- [Marca no produto](docs/brand.md)

## Stack

Expo SDK 57 · Expo Router · React Native Web · TypeScript strict · TanStack Query · React Hook
Form · Zod · Firebase Authentication (Client SDK) · `openapi-fetch` tipado pelo contrato do backend.

## Rodar localmente com o backend e os emuladores

Frontend e backend exigem Node `>=24.22.0 <25`. A referência é Node 24.22.0 LTS, registrada nos arquivos `.node-version`. Firebase 13 exige pelo menos Node 24.12.0. O emulador Firestore exige Java 21. Nenhum projeto Firebase real é usado no desenvolvimento local.

Se o Node global for outro, instale Node 24.22.0 ou use um gerenciador de versões. A antiga cópia em `backend/.cache/runtime` pode conter Node 22 e não atende mais ao projeto. Durante o saneamento, o runtime oficial foi extraído somente em `frontend/.local/saneamento/node24/node-v24.22.0-win-x64`.
Na raiz do repositório, é possível usá-lo no terminal atual sem alterar a instalação global:

```powershell
$runtime = (Resolve-Path 'frontend/.local/saneamento/node24/node-v24.22.0-win-x64').Path
$env:Path = "$runtime;$env:Path"
```

1. Backend (pasta `backend`, terminal 1): emuladores.

   ```powershell
   cd ..\backend
   npm run emulators
   ```

2. Backend (terminal 2): seed e API. O seed cria as contas fixas `platform.demo@lastro.invalid`
   (Super Admin), `admin.demo@lastro.invalid` (administrador) e `vendedor.demo@lastro.invalid`
   (vendedor) da **Distribuidora Demo Lastro**, com dados de demonstração. As senhas vêm de
   `LASTRO_DEMO_*_PASSWORD` no `backend/.env` (veja
   [ambiente local](../backend/docs/local-environment.md)). Os dados persistem entre reinícios;
   o seed só é necessário na primeira vez.

   ```powershell
   cd ..\backend
   npm run seed:local
   npm run dev
   ```

   O backend lê `backend/.env`; se ele não existir, crie a partir de `backend/.env.example`
   (instrução do README do backend).

3. Frontend (terminal 3):

   ```powershell
   npm install
   Copy-Item .env.example .env
   npm run web
   ```

4. Abra `http://localhost:8081` e entre com uma conta do seed. `admin.demo` e `vendedor.demo` caem
   na Distribuidora Demo Lastro; `platform.demo` cai em **Plataforma Hepta**.
5. Para testar o fluxo de onboarding do zero: em **Nova empresa**, crie uma empresa de teste com um e-mail fictício (ex.:
   `admin.teste@lastro.invalid`) e copie o link do convite.
6. Clique em **Sair**, abra o link, crie a conta com esse e-mail e confirme o e-mail. No emulador,
   o link de confirmação fica em
   `http://127.0.0.1:9099/emulator/v1/projects/demo-lastro-phase-a/oobCodes` (abra o `oobLink`
   do e-mail) ou na interface do Emulator Suite.
7. Toque em **Já confirmei** e **Aceitar convite**: o app entra na empresa como administrador.
   Em **Mais → Configurações → Usuários e convites** dá para convidar um vendedor e repetir o
   fluxo.

Celular: `npm start` e Expo Go ou development build. No emulador Android, troque `127.0.0.1` por
`10.0.2.2` nas URLs do `.env` (veja [docs/auth.md](docs/auth.md)).

## E2E contra o backend real

Com emuladores, seed e API rodando (passos 1 e 2), no frontend:

```powershell
$env:SEED_PASSWORD = "<valor de LASTRO_DEMO_PLATFORM_PASSWORD no backend/.env>"
node ..\backend\node_modules\tsx\dist\cli.mjs scripts\e2e-inventory.ts
node ..\backend\node_modules\tsx\dist\cli.mjs scripts\e2e-orders.ts
```

Os scripts criam empresas sintéticas no emulador (admin, vendedor, clientes, produtos UN e KG) e
usam o mesmo cliente HTTP do app (`scripts/e2eSupport.ts`). `e2e-inventory` verifica entradas,
idempotência, precisão, versão, histórico, reposição, permissões e isolamento. `e2e-orders`
verifica rascunho, edição com versão, confirmação com reserva, repetição com a mesma chave,
concorrência de estoque, expedição, cancelamento, recebimento que exige fluxo financeiro,
permissões, isolamento e um carrinho de 200 produtos. O pedido de 200 produtos cria cerca de 450
requisições: suba a API com `RATE_LIMIT_MAX` maior (ex.: `5000`) só no ambiente local.

## Scripts

| Comando              | O que faz                                                                              |
| -------------------- | -------------------------------------------------------------------------------------- |
| `npm run web`        | Servidor de desenvolvimento web                                                        |
| `npm run typecheck`  | TypeScript strict                                                                      |
| `npm run lint`       | ESLint (config Expo)                                                                   |
| `npm test`           | Testes (Jest + Testing Library, roteador real do Expo Router em memória)               |
| `npm run format`     | Prettier                                                                               |
| `npm run api:sync`   | Regenera `contract/openapi.json` e `src/api/schema.d.ts` a partir do código do backend |
| `npm run export:web` | Build estático de produção do web                                                      |

`api:sync` lê `../backend/src` e usa `tsx`/`openapi-typescript` já instalados no backend. Não
escreve nada na pasta do backend.

`/sistema` (só em desenvolvimento) é o catálogo de tokens e componentes.
