# Autenticação, empresa e permissões (Etapa 2)

## Fluxo

```text
abrir o app
  └─ provedor (Firebase) lê a sessão salva ── sem sessão ──> /entrar
        └─ com sessão: GET /api/v1/me
              ├─ falhou (rede/servidor) ─────────────> tela "Não foi possível carregar sua conta"
              ├─ nenhuma empresa ── Super Admin ─────> /plataforma
              │                  └─ demais ──────────> /sem-empresa
              ├─ uma empresa ────────────────────────> entra direto
              ├─ várias ── escolha salva válida ─────> entra nela
              │         └─ sem escolha ──────────────> /empresas
              └─ empresa escolhida com acesso
                    ├─ allowed (active ou past_due) ─> área da empresa
                    └─ suspended / canceled / provisioning ─> /acesso-bloqueado
```

Enquanto o provedor e o `/me` não respondem, a tela de abertura (mesmo fundo do splash) cobre
tudo: nenhuma tela privada é montada antes da decisão.

A decisão é uma função pura ([`src/session/gate.ts`](../src/session/gate.ts)) testada à parte. O
[`RootNavigator`](../src/navigation/RootNavigator.tsx) aplica em duas camadas:
`Stack.Protected` desmonta grupos não permitidos, e um efeito leva à tela inicial do estado atual.

Isto é experiência, não segurança. O backend revalida token, vínculo, permissão e assinatura em
toda chamada.

## Firebase Authentication

Usado só o Firebase Client SDK (`firebase` 13), como o backend exige. Não há endpoint de login no
backend.

| Ação                  | Implementação                                                          |
| --------------------- | ---------------------------------------------------------------------- |
| Entrar                | `signInWithEmailAndPassword`                                           |
| Sair                  | `signOut` + limpeza total do cache + esquecer a última empresa         |
| Recuperar senha       | `sendPasswordResetEmail`; resposta igual exista ou não a conta         |
| Criar conta (convite) | `createUserWithEmailAndPassword` + `sendEmailVerification`             |
| Confirmar e-mail      | `user.reload()` + token novo (o claim `email_verified` vai ao backend) |
| Reautenticar          | `reauthenticateWithCredential` (área da plataforma)                    |
| Token                 | `getIdToken()`; o SDK renova sozinho antes de expirar                  |

Tudo passa pela interface [`AuthGateway`](../src/auth/gateway.ts). Os testes usam uma
implementação falsa com o mesmo comportamento.

### Persistência por plataforma

| Plataforma  | Onde fica a sessão (inclui refresh token)                     | Arquivo                                                      |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Web         | IndexedDB do navegador, isolado por origem                    | [`persistence.ts`](../src/auth/persistence.ts)               |
| Android/iOS | Keystore/Keychain via `expo-secure-store`, dividida em partes | [`persistence.native.ts`](../src/auth/persistence.native.ts) |

- Nativo usa `getReactNativePersistence` com um armazenamento seguro em vez do AsyncStorage
  sugerido na documentação (AsyncStorage é texto puro). O SecureStore recomenda valores pequenos,
  então o usuário serializado é dividido em partes de 1.800 caracteres; parte faltando = sem sessão.
- iOS: `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` — a sessão não migra para outro aparelho por backup.
- `firebase/auth` 13 não declara `getReactNativePersistence` na tipagem pública; o Metro resolve o
  build React Native de `@firebase/auth` em Android/iOS. A declaração está em
  [`firebase-auth-rn.d.ts`](../src/auth/firebase-auth-rn.d.ts). Verificado nos bundles exportados:
  Android contém a persistência RN e o SecureStore; web contém só IndexedDB.
- O app nunca grava ID Token ou refresh token por conta própria. A única preferência salva é a
  última empresa escolhida (id, não segredo), apagada no logout.

### Configuração

`.env` (veja `.env.example`):

| Variável                                 | Local (emulador)                         |
| ---------------------------------------- | ---------------------------------------- |
| `EXPO_PUBLIC_API_URL`                    | `http://127.0.0.1:3000`                  |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID`        | `demo-lastro-phase-a` (igual ao backend) |
| `EXPO_PUBLIC_FIREBASE_API_KEY`           | `demo-key`                               |
| `EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_URL` | `http://127.0.0.1:9099`                  |

A chave web do Firebase é um identificador público, não segredo. Nenhuma credencial
administrativa existe no frontend. Sem `AUTH_EMULATOR_URL`, o app usa o Firebase real do projeto
configurado: nunca preencher com projeto produtivo sem aprovação.

Emulador Android: `127.0.0.1` aponta para o próprio aparelho. Use `10.0.2.2` (emulador do Android
Studio) ou o IP da máquina na rede nas duas URLs. Apps nativos não passam por CORS; o iOS
Simulator acessa `127.0.0.1` normalmente.

## Requisições à API

[`src/api/client.ts`](../src/api/client.ts):

- `Authorization: Bearer <ID Token>` em toda chamada.
- Cada cliente fica **preso a uma empresa** e sempre envia o próprio `X-Tenant-Id`. Trocar de
  empresa cria outro cliente. O cliente de identidade/plataforma nunca envia empresa.
- 401: pede token novo ao provedor e repete uma vez. Segundo 401, ou token revogado no provedor,
  encerra a sessão com o aviso "Sua sessão terminou". Falha de rede ao renovar não encerra.
- Erros pelo código estável (`ApiError.kind`/`code`), nunca pelo texto.

## Empresa e isolamento do cache

- Chaves de dados da empresa começam com `['tenant', tenantId, ...]`.
- Trocar de empresa cancela consultas em andamento e remove todo o prefixo `['tenant']`.
- Trocar de conta ou sair limpa o cache inteiro.
- A escolha salva só vale se a empresa estiver em `/me`; caso contrário, é ignorada.
- Erros `SUBSCRIPTION_*` ou `TENANT_ACCESS_DENIED` no meio da sessão relêem `/me`, e o roteamento
  leva à tela certa.

## Permissões

Vêm exclusivamente de `memberships[].permissions` em `/me` (o seletor de perfil da prévia foi
removido). Aplicação no app:

- Menu e barra inferior mostram só destinos com alguma permissão exigida
  ([`destinations.ts`](../src/navigation/destinations.ts)).
- Telas restritas usam `RequirePermission`: sem permissão, mostram "Você não tem acesso a esta
  área" sem montar a tela nem disparar consultas.
- Ações administrativas (convidar, revogar) só aparecem com `users:manage`.

| Área                                | Administrador                | Vendedor               | Super Admin sem vínculo |
| ----------------------------------- | ---------------------------- | ---------------------- | ----------------------- |
| Início, Pedidos, Clientes, Produtos | sim                          | sim (própria carteira) | não                     |
| Estoque                             | sim                          | acesso negado          | não                     |
| Usuários e convites                 | sim                          | não aparece            | não                     |
| Plataforma Hepta                    | só se também for Super Admin | não                    | sim                     |

### Super Admin

Área separada em `/plataforma`, com shell próprio. Usa só `/admin/tenants`, `/admin/plans` e
`/admin/subscriptions`: nome, situação e condições contratuais. Nunca lê clientes, produtos,
estoque ou pedidos.

O backend exige login com senha nos últimos 5 minutos (`auth_time`). O app confere o claim antes
de montar a área (janela local de 4min30s) e, quando ela fecha ou uma chamada volta `FORBIDDEN`,
pede a senha de novo. O backend usa o mesmo código `FORBIDDEN` para "não é Super Admin" e
"reautenticação necessária"; como só Super Admins chegam à área (pelo `/me`), o app trata como
pedido de senha.

## Assinaturas

| Situação no backend     | O que `/me` mostra | No app                                           |
| ----------------------- | ------------------ | ------------------------------------------------ |
| `active`                | `allowed`          | acesso normal                                    |
| `past_due`              | `allowed`          | acesso normal (regra do MVP)                     |
| `suspended`             | `suspended`        | tela "O acesso desta empresa está suspenso"      |
| `canceled`              | `canceled`         | tela "A assinatura desta empresa foi encerrada"  |
| empresa em configuração | `provisioning`     | tela "Esta empresa ainda está sendo configurada" |

O backend não expõe a situação da assinatura aos usuários da empresa: `past_due` é indistinguível
de `active` para eles, e não existe tela de plano/pagamento. O Super Admin vê as quatro situações
em Plataforma → Assinaturas. Nenhuma reativação ou pagamento é feito pelo app.

## Convites

Rota pública `/convite?token=...`, válida com ou sem sessão.

1. O token sai da URL e do histórico (`router.replace`) e fica só em memória.
2. Sem sessão: criar conta com o e-mail convidado ou entrar numa conta existente. Depois do login,
   o app volta sozinho ao convite.
3. E-mail não verificado: o backend recusaria, então o app pede a confirmação primeiro.
4. Aceite: `POST /users/invitations/accept`; a empresa nova é escolhida e o app entra nela quando
   a sessão já reflete o vínculo.

| Código do backend           | Mensagem                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `INVITATION_EXPIRED` (410)  | Este convite venceu                                                                 |
| `INVITATION_INVALID` (403)  | Convite não pode ser usado (usado, revogado ou outro e-mail; mostra a conta em uso) |
| `CONFLICT` (409)            | Você já faz parte desta empresa                                                     |
| `USER_LIMIT_REACHED` (409)  | A empresa atingiu o limite de usuários                                              |
| `LAST_ADMIN_REQUIRED` (409) | Empresa ainda em configuração                                                       |
| `SUBSCRIPTION_*` (403)      | Acesso da empresa indisponível                                                      |
| `FORBIDDEN` (403)           | Sua conta não pode aceitar convites                                                 |
| `auth/email-already-in-use` | Você já tem uma conta (oferece entrar)                                              |

Emissão: Configurações → Usuários e convites (administrador) e Plataforma → Nova empresa (convite
do primeiro administrador, com `Idempotency-Key` mantida enquanto o formulário não muda). O link
aparece uma vez, com botão de copiar; o Lastro ainda não envia e-mail.
