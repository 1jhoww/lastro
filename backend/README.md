# Lastro backend — Fases A, B, C, D, E, F e G

Fundação REST com Express, TypeScript strict, Firebase Admin, Zod, OpenAPI 3.1, Vitest e Supertest. Clientes, carteiras, produtos, categorias e imagens privadas integram a autorização central. Integração local com Firebase Authentication, Firestore e Storage Emulator. Código original criado neste projeto; sem reutilizar dados, arquivos ou credenciais da Atual Pet.

## Requisitos e instalação

- Node.js LTS `>=24.22.0 <25`, com npm; Java 21 para Firestore Emulator. A versão de referência está em `.node-version`. Build e servidor recusam runtimes antigos ou de outra linha.
- O wrapper `scripts/npm.ps1` prioriza uma versão compatível no PATH e ignora a antiga cópia Node 22 em `.cache/runtime`. Pode usar o runtime oficial local da sessão de saneamento, sem alterar a instalação global.
- Portas locais livres: 3000 (API), 8080 (Firestore), 9099 (Auth), 9199 (Storage), 4400/4500 e 9150 (processos auxiliares do Emulator Suite).
- Execute tudo na pasta `backend`. Downloads de dependências são públicos; emulação não exige login no Firebase, ADC ou criação de projeto.

```powershell
cd C:\Users\Administrador\Desktop\Lastro\backend
npm ci
Copy-Item -LiteralPath .env.example -Destination .env
```

Se o comando npm da máquina estiver quebrado, use `pwsh -File scripts/npm.ps1 ci` e, para scripts, `pwsh -File scripts/npm.ps1 run <nome>`. Quando existe `.cache/runtime/node.exe`, o wrapper usa esse runtime portátil do backend e o CLI npm disponível na instalação local. O PATH muda apenas no processo do wrapper e seus filhos; nenhuma instalação/configuração global é alterada. Sem runtime portátil, instale a versão indicada em `.node-version` antes de executar.

Configure `JAVA_HOME` para um JDK 21 instalado. O launcher preserva o PATH, mantém preferências do Firebase CLI dentro de `.cache/firebase-config`, usa cache local e evita herdar `FIREBASE_TOKEN` ou `GOOGLE_APPLICATION_CREDENTIALS`. No Windows, usa `.local` para sockets temporários do Java: o diretório TEMP abreviado pode causar `Invalid argument: connect`.

## Executar localmente

`npm run build` empacota fontes/licença em `dist/assets`, verifica hashes e gera PDFs a partir dos módulos compilados. Execute o build antes da suíte unitária: um teste copia `dist` e valida os assets sem depender das fontes de desenvolvimento. `npm run check:artifact` repete o smoke test; `npm run check:openapi` confere contrato e tipos. O Dockerfile fixa Node 24.22.0, mas a imagem Linux ainda exige build e testes no ambiente autorizado.

Limites, retenção, migração local e pendências de infraestrutura de F03–F07 estão em [operação técnica](docs/operations-f03-f07.md). Essas configurações não foram implantadas. O launcher aceita `test --without-capacity` para dispensar explicitamente os dois ensaios de 20.000 fontes, preservando os arquivos e a execução padrão integral.

Terminal 1:

```powershell
npm run emulators
```

Terminal 2:

```powershell
npm run seed:local
npm run dev
```

Os dados dos emuladores de desenvolvimento são persistidos em `.local/emulator-data` (restaurados ao iniciar, salvos ao encerrar e a cada 5 minutos). Encerre com `Ctrl+C` uma vez ou `npm run emulators:stop`. O seed cria, somente no emulador, as contas fixas `platform.demo@lastro.invalid` (Super Admin), `admin.demo@lastro.invalid` (administrador) e `vendedor.demo@lastro.invalid` (vendedor), com senhas lidas de `LASTRO_DEMO_*_PASSWORD` no `.env`, e a empresa **Distribuidora Demo Lastro** com clientes, produtos, estoque, pedidos e financeiro. Reexecutar não duplica nem altera dados. Rotina diária, backup, restauração e detalhes: [ambiente local](docs/local-environment.md). `npm run local:check` mostra o que falta.

API: `http://127.0.0.1:3000`; Swagger: `http://127.0.0.1:3000/docs`; contrato: `http://127.0.0.1:3000/openapi.json`. Swagger existe somente em desenvolvimento, usa Bearer e não persiste autorização. Nunca hospede os emuladores publicamente.

## Identidade e convite

Login, logout (`signOut`), verificação de email, recuperação de senha e reautenticação pertencem ao Firebase Client SDK. Não há endpoint de login paralelo. O backend verifica ID Tokens e revogação pelo SDK oficial em todas as rotas privadas.

Para uma verificação manual local, faça login na conta sintética pelo endpoint do Auth Emulator:

```powershell
$loginBody = @{ email = 'platform.demo@lastro.invalid'; password = '<LASTRO_DEMO_PLATFORM_PASSWORD do .env>'; returnSecureToken = $true } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key' -ContentType 'application/json' -Body $loginBody
$headers = @{ Authorization = "Bearer $($login.idToken)" }
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/v1/me' -Headers $headers
```

Tokens e senhas não devem ser enviados a logs, commits ou serviços externos. O exemplo usa somente o Auth Emulator. O frontend futuro deve usar o Firebase Client SDK, não reproduzir esse endpoint de emulação.

1. Super Admin lista/cria planos; cria empresa indicando plano e email do primeiro administrador.
2. A empresa fica em `provisioning`, com uma vaga reservada por convite de administrador. Nenhum vínculo é criado automaticamente.
3. A resposta entrega token de convite ao operador autorizado. Compartilhamento é manual por canal seguro; esta fase não envia email.
4. O destinatário entra pelo Firebase, verifica seu email e aceita o token. O backend consulta o email atual no provedor, valida hash, prazo, assinatura e capacidade.
5. Vínculo, capacidade, consumo do convite e auditoria são gravados juntos; a empresa fica `active`.
6. Administrador convida um segundo administrador ou vendedor. Convites pendentes válidos ocupam vaga, expiram em sete dias e podem ser revogados.
7. O primeiro convite pode ser renovado pela plataforma enquanto a empresa estiver em provisionamento. A renovação invalida o anterior e não concede vínculo automaticamente.

## Contrato HTTP

Todas as rotas reais, schemas, respostas e erros estão em [OpenAPI](docs/api/openapi.json). A fonte do registro é `src/app/routes.ts`; schemas de entrada e saída são compartilhados com a geração do contrato.

- Base `/api/v1`; Bearer obrigatório.
- `X-Tenant-Id` somente para rotas empresariais. É uma empresa candidata, nunca prova de autorização. O servidor valida o vínculo atual.
- POST de plano, empresa, renovação do convite inicial, entrada e ajuste de estoque exige `Idempotency-Key` UUID.
- PATCH exige `expectedVersion`; replay de versão antiga retorna `CONFLICT`.
- Resposta `{ data, requestId }`; erro `{ error: { code, message, status, requestId } }`.
- Paginação: `limit` padrão 25, máximo 100; cursor opaco assinado por usuário, tenant e coleção. Não use offset.
- Query/body/path desconhecidos ou proibidos são rejeitados; JSON máximo 64 KiB.
- DELETE de cliente/produto/categoria desativa logicamente com `{ expectedVersion }`; PATCH com `status: active` reativa. Não há exclusão física por essas rotas.
- Rotas de plataforma exigem identidade administrativa provisionada por operador e autenticação recente (até cinco minutos).
- `/me` lista vínculos da própria identidade, perfis, permissões e disponibilidade; empresa bloqueada não expõe dados comerciais ou condições financeiras nesse endpoint.

## Funcionalidades da Fase B

Clientes aceitam cadastro sem documento/endereço completo. CPF/CNPJ validado e normalizado, inclusive alfanumérico, com unicidade transacional dentro da empresa. Administrador gerencia todos os clientes; vendedor cria clientes atribuídos a si e lê/edita somente sua carteira. Somente administrador transfere responsável e altera status, com versão e auditoria.

Produtos têm SKU normalizado único por empresa, um preço em centavos e unidades UN/CX/PCT/KG/L. Administrador gerencia todos os campos; vendedor consulta ativos. Categoria inativa preserva referências antigas, mas não recebe novas vinculações. Preço atual e catalogVisible não implementam pedidos ou catálogo público.

Busca `q`: prefixo de nome sem distinção de acentos/maiúsculas, com `sort=name&direction=asc`; não é texto completo. Listas: status, sort=name|createdAt e direction=asc|desc. Clientes: assignedTo=UID|unassigned para administrador. Produtos: categoryId, SKU exato e catalogVisible=true|false. Preserve filtros/ordem/limite ao avançar cursor. Páginas 25/100, sem varredura completa.

Imagem: PUT `/api/v1/products/{id}/image?expectedVersion=N`, corpo binário JPEG/PNG/WebP, Content-Type correspondente, até 5 MiB/16 milhões de pixels. Não aceita multipart, SVG, URL, nome original ou caminho. Backend valida/recodifica para WebP e grava no Storage do tenant. GET exige Bearer/tenant e devolve WebP privado; DELETE com versão remove a associação. Nenhum objeto é publicado. Detalhes em [Fase B](docs/phase-b.md).

## Estoque da Fase C

Cada empresa tem um estoque compartilhado por produto, sem depósitos. Quantidades HTTP são textos decimais com ponto: UN/CX/PCT inteiros ("10"), KG/L até três casas ("1.250"). Banco usa inteiros em milésimos, escala 1000, máximo 1.000.000.000 de unidades por saldo. Disponível deriva de físico menos reservado; nenhuma operação administrativa reserva/expede pedidos.

GET inventory e inventory/{productId} consultam saldos; vendedor recebe somente disponibilidade de ativos. Administrador consulta movimentos, reposição e reconciliação. POST inventory/entries recebe productId, quantity, reason, notes opcional. POST inventory/adjustments recebe productId, delta signed, expectedVersion, reason e notes opcional. Ambos exigem UUID em Idempotency-Key. Ajuste é por variação, com saldo final calculado no servidor. Replay de mesma chave/comando/ator devolve resultado original sem nova movimentação; reuso divergente é CONFLICT. Não trocar a chave para retry.

minimumStock no produto é texto decimal, padrão zero para cadastros anteriores; somente administrador modifica. Alteração exige versão do produto e sincroniza projeção de reposição. Unidade não muda após a primeira movimentação, mesmo quando saldo volta a zero. Inativos preservam saldos/histórico e ficam fora da reposição operacional por padrão.

Veja [contrato, exemplos e limitações da Fase C](docs/phase-c.md) e [pedidos da Fase D](docs/phase-d.md).

## Pedidos da Fase D

GET/POST orders, GET/PATCH orders/{id}, POST orders/{id}/confirm|dispatch|cancel e GET orders/{id}/history. Rascunhos aceitam customerId opcional, linhas productId/quantity sem teto comercial, payment opcional={type:cash|installments,dueDates:[YYYY-MM-DD]} e notes. Preços/snapshots/totais vêm do servidor; confirmação relê produtos ativos e preços. Parcelas 1 à vista ou 2..12, soma exata, vencimentos explícitos no calendário/fuso da empresa.

Administrador opera todos os pedidos e aplica discount (fixed em centavos ou percentage em pontos base, motivo obrigatório). Vendedor cria/consulta/edita/confirma/expede somente como responsável do pedido e da carteira atual; não cancela ou envia descontos/preços/responsável. Transferência de cliente bloqueia antigo vendedor e não concede pedidos históricos ao novo. Edição invalida desconto anterior; rascunho aprovado intacto pode ser confirmado por vendedor. Alteração de preço/condições exige reaprovação administrativa.

Confirm/dispatch/cancel exigem expectedVersion e Idempotency-Key UUID. Confirmação grava pedido, reservas por linha, estoque reservado, movimentos, parcelas/recebíveis, evento e auditoria num único commit. Expedição integral retira físico/reservado; cancelamento administrativo com motivo libera reserva e cancela recebíveis sem pagamentos. Registros financeiros bloqueiam cancelamento simples; expedido exige futura devolução. Sem endpoints de pagamento ou saldo financeiro editável.

Máquina de estados: draft→confirmed|canceled; confirmed→dispatched|canceled. Snapshots confirmados preservados. Retry da mesma chave/payload/ator devolve resultado original; outra intenção usando chave é CONFLICT. POST de rascunho não promete idempotência. Lista/histórico paginados, sem varredura/contador global; identificador comercial PED-UUID completo. [Detalhes, arquivos e exemplos](docs/phase-d.md), [contratos da Fase E](docs/phase-e.md).

## Verificação

Pare os emuladores de desenvolvimento antes da suíte de integração, pois o launcher exige as mesmas portas. A suíte inicia e encerra seus próprios processos, usa `demo-lastro-tests` e recusa qualquer projeto real ou hosts remotos.

```powershell
npm run typecheck
npm test
npm run test:integration
npm run lint
npm run format:check
npm run build
npm run openapi
npm run types:api
npm run audit:dependencies
npm run audit:secrets
```

Para código compilado, com emuladores ligados: `npm start`. Resultados reais e limitações: [validação](docs/validation.md).

Em execução dentro do sandbox Windows, se Vitest falhar ao abrir arquivos SSR temporários, aponte TEMP/TMP para o diretório local existente antes dos testes: `$env:TEMP = Join-Path $PWD '.local'; $env:TMP = $env:TEMP`. Portas dos emuladores também precisam de permissão local para os processos. Os testes recusam projeto real, host remoto e bucket divergente; não execute seed para preparar fixtures.

## Estrutura

```text
src/
  app/                       aplicação, processo HTTP e registro de rotas
  config/                    ambiente validado, sem fallback produtivo
  middlewares/               autenticação, autorização, erros, limites, contexto
  infrastructure/firebase/   SDK oficial e seleção explícita de ambiente
  infrastructure/repositories/ referências permitidas e leitura validada
  modules/auth/              acesso e contrato OpenAPI
  modules/users/             vínculos, convites e permissões
  modules/customers/         clientes, carteiras e documentos fiscais
  modules/products/          produtos e imagens privadas
  modules/categories/        categorias empresariais
  modules/inventory/         quantidades, saldos, histórico, reposição e reconciliação
  modules/orders/            rascunhos, aprovação, transições e snapshots
  modules/receivables/       recebíveis iniciais e barreira de cancelamento financeiro
  modules/finance/           condições, formas, títulos, recebimentos, créditos e diário
  modules/returns/           intenções, recebimentos parciais e resolução financeira
  modules/catalog/           publicação controlada, orçamento transitório e link WhatsApp
  modules/platformAdmin/     empresas, planos versionados e assinaturas
  shared/                    schemas, auditoria, erros, tipos e criptografia
tests/{unit,integration,security,concurrency}/
scripts/                     emuladores, bootstrap local, contrato e verificações
docs/{architecture,api,adr}/
```

Empresas, planos e assinaturas ficam em serviços transacionais da fundação porque suas invariantes são conjuntas; não há módulos vazios para imitar uma estrutura. A Fase B pode separá-los quando crescerem, preservando o contrato e as transações.

Veja [arquitetura](docs/architecture/foundation.md), [modelo de dados](docs/architecture/data-model.md), [permissões](docs/architecture/permissions.md), [segurança](docs/security.md) e [decisões](docs/adr/).

## Publicação futura

Não há deploy ou recursos de nuvem nesta fase. O processo aceita PORT e SIGTERM para futura hospedagem no Cloud Run. Modo produtivo exige `NODE_ENV=production`, `FIREBASE_MODE=production`, projeto real, segredo de convites, origens HTTPS exatas e `PUBLIC_ORIGIN` HTTPS; variáveis de emulador são recusadas. ADC deve vir de identidade de serviço com menor privilégio, sem chave JSON no repositório.

TLS, ingress confiável, IAM, Secret Manager, MFA da plataforma, retenção/TTL, backups e testes de restauração dependem de aprovação e configuração de infraestrutura. Não há evidência de capacidade para 100 usuários ou disponibilidade produtiva. Financeiro E implementa condições/formas, parciais/estornos, créditos legítimos, cancelamentos, obrigações manuais e devoluções físicas parciais; detalhes em [Fase E](docs/phase-e.md). Banco, fiscal, frontend, fechamento e compensações físicas concluídas permanecem futuros. Catálogo público foi implementado localmente em F. G adiciona PDFs privados sob demanda e CSVs administrativos paginados; [contratos/limites](docs/phase-g.md). PDFKit é dependência runtime nova; PDF.js e tipos PDFKit são dependências de desenvolvimento. Distribuir assets/fonts junto do build, preservando licença. Nenhum documento é armazenado permanentemente.

Produtos danificados admitem aceite financeiro administrativo integral, parcial ou zero, com preview de limites calculado pelo backend e redução cumulativa auditada, sem aumentar estoque vendável. [Relatório de entrega E](docs/phase-e-delivery.md) reúne endpoints, dados, validação, limites e contrato para integração do frontend.

## Catálogo público e orçamentos da Fase F

Administrador configura GET/PUT `/api/v1/catalog-settings`, com slug único, ativação, nome comercial, descrição, WhatsApp internacional e showPrices. Seleciona produtos por catalogVisible nas rotas B existentes. Configuração usa versões, UUID idempotente e auditoria. Catálogo público resolve slug e relê status da empresa/assinatura sem login; só produtos ativos publicados são apresentados.

GET `/api/v1/public/catalogs/{slug}` e products/categories/details/image dão DTO público sem tenant, SKU, autores, cliente, estoque exato ou financeiro. Imagem é binário pela API com gates antes/depois do Storage; bucket e Rules continuam privados. Preços ocultos usam null em todas as rotas públicas, inclusive resumo e mensagem.

POST quote-preview valida até 200 produtos/quantidades e calcula centavos atuais no servidor. POST whatsapp exige reviewToken e prepara somente link oficial para envio manual. Não persiste orçamento, cria cliente/pedido, reserva estoque ou lança financeiro. Cache no-store, cursores cifrados, limites compartilhados e CORS público separado do privado. [Fase F](docs/phase-f.md), [validação F](docs/validation-phase-f.md) e [contrato para Claude](docs/api/frontend-contract.md) detalham integração e limites. Produção continua fora do escopo.

## Pós-auditoria A–G

F01 corrigido: reconciliação financeira cumulativa com checkpoint assinado, contagem real e reinício explícito de cursores antigos/cabeça alterada. [Validação atual](docs/validation-f01.md): 523 testes aprovados, preservando os 493 anteriores. OpenAPI 0.7.0 e tipos atualizados, sem novo endpoint.

F02 continua bloqueante para integração financeira final. [Projeto de resolução retomável](docs/proposals/financial-resumable-resolution.md) aguarda aprovação; não foi implementado. [F03–F07](docs/audits/remediation-plan-f03-f07.md) têm critérios antes da homologação. Nenhum limite comercial, exclusão de histórico, saldo artificial, deploy ou recurso pago foi introduzido.
