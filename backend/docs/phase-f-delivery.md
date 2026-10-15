# Entrega local da Fase F — Catálogo e orçamentos

## 1. Funcionalidades

Configuração empresarial versionada/auditada com ativação, slug único, nome comercial, descrição, WhatsApp e preços visíveis/ocultos. Seleção usa catalogVisible B, sem duplicar produtos. Slugs antigos permanecem reservados ao proprietário.

Consulta pública sem login, pesquisa prefixada, categoria, paginação opaca, detalhe e imagem controlada. Somente ativos publicados da empresa resolvida; sem tenant/SKU/autores/clientes/estoque/financeiro. Bucket e Rules continuam privados.

Carrinho transitório no visitante, com validação/centavos atuais no backend. Preço oculto não aparece no resumo/link/erro monetário/prova. Revisão HMAC exige resumo atual antes de preparar link WhatsApp; visitante revisa e envia manualmente. Nenhum orçamento, cliente, pedido, reserva ou financeiro é criado. Conteúdo de controle/formatação/URLs nos nomes é neutralizado.

## 2. Endpoints Novos

Base `/api/v1`; nove novas operações e 91 anteriores preservadas. OpenAPI 3.1/0.6.0 com 100 operações:

| Método | Endpoint                                    | Resultado                                        |
| ------ | ------------------------------------------- | ------------------------------------------------ |
| GET    | /catalog-settings                           | Configuração administrativa ou catalog=null      |
| PUT    | /catalog-settings                           | Configuração completa versionada/idempotente     |
| GET    | /public/catalogs/{slug}                     | Distribuidora pública                            |
| GET    | /public/catalogs/{slug}/products            | Produtos publicados paginados                    |
| GET    | /public/catalogs/{slug}/products/{id}       | Detalhe público elegível                         |
| GET    | /public/catalogs/{slug}/products/{id}/image | WebP controlado/no-store                         |
| GET    | /public/catalogs/{slug}/categories          | Categorias ativas com publicação                 |
| POST   | /public/catalogs/{slug}/quote-preview       | Resumo atual/reviewToken, sem efeitos comerciais |
| POST   | /public/catalogs/{slug}/whatsapp            | Resumo revalidado, message e whatsappUrl         |

Seleção de produtos utiliza PATCH products/{id} com catalogVisible e versão já existentes.

## 3. Modelo de Dados

Novos registros: catalogSlugs/{slug} global, tenants/{id}/catalogSettings/current e tenants/{id}/catalogOperations/{hash}. Configuração contém campos públicos, versão, autores e datas; idempotência preserva resultado/hash/ator. Registry mantém proprietário de slugs, sem diretório público.

Produtos/categorias permanecem B. Orçamentos, revisão, mensagens e contatos visitantes não são persistidos. rateLimits existente recebe buckets públicos separados, com hashes de IP/janela/slug e count/expiresAt; metadados pseudônimos de segurança, sem itens. TTL/limpeza não implantados. Nenhum saldo ou operação comercial mudou de modelo.

## 4. Permissões

Administração exige catalog:manage, já exclusivo do administrador; contexto relido em transação/replay. Vendedor e plataforma sem vínculo não consultam configuração. Público tem scope=public/security=[], sem Bearer/X-Tenant-Id; slug resolve tenant no servidor. Exige tenant active, catálogo enabled e assinatura active/past_due. Suspended/canceled/provisioning são indisponíveis sem motivo privado. Produto precisa ser ativo/publicado daquele tenant.

## 5. Testes

59 novos: 21 unitários e 38 emulados F, sem remover/enfraquecer os 364 anteriores. Incrementos de configuração, consulta/imagem, orçamento/WhatsApp e limites compartilhados passaram antes da regressão completa.

**423 testes aprovados, zero falhas:** 153 unitários e 270 emulados. Regressão A–F: 21 arquivos emulados, 854,18 s, iniciada em 9/10/2026 às 17:03:17 (America/Sao_Paulo), saída zero. Sem pending/todo ou remoção de cobertura. Emuladores de teste encerrados. Evidências em reports/unit-tests.raw.json, reports/emulator-tests.raw.json, reports/phase-f1-tests.raw.json e reports/phase-f-incremental-tests.raw.json.

TypeScript strict, lint, formatação e build aprovados; OpenAPI/tipos atualizados. Auditorias completa/runtime: zero advisories conhecidos; scanner de segredos sem achados. [Validação detalhada](validation-phase-f.md) registra resultados e reprodução.

## 6. Regressão e Concorrência

Incrementos validaram slug concorrente com um proprietário, mesma chave administrativa com um efeito/resultado original, autorização revogada e rollback após staging sem órfãos. Preview/link concorrentes mantêm conteúdo sem operação comercial; somente contadores de segurança têm escrita.

Preço público alterado exige revisão; preço oculto alterado mantém prova sem divulgar valor. Retirada de produto/catálogo impede link antigo. Despublicação durante Storage bloqueia imagem. Preview de 200 produtos preserva saldos e ausência de efeitos comerciais. Limites entre instâncias e buckets públicos separados dos privados passaram.

## 7. Limitações

Página 25/máximo 50, JSON 64 KiB, até 200 produtos distintos por resumo e limites numéricos C/D, sem mínimo comercial. Mensagem 12.000 caracteres/URL 16.000 com recusa integral; dispositivo pode ter limite menor. Preview de 200 produtos pode exceder link. Não houve envio real ou validação em dispositivo.

Busca prefixada; categorias podem produzir página vazia com cursor. Sem total global, estoque público, orçamento persistido ou conversão automática. no-store controla novas respostas, mas não retira dados já obtidos quando públicos.

126 índices apenas declarados. Emulação não comprova índices produtivos, custo, SLO, cem usuários, resistência a abuso distribuído ou recuperação de produção. expiresAt não elimina contadores sem TTL/limpeza futura. Snapshots grandes e serviços pagos não implementados.

## 8. Arquivos

Novos: src/shared/schemas/catalog.ts; src/modules/catalog/{catalogService,quoteCalculation,publicCursor}.ts; src/app/catalogRoutes.ts; tests/helpers/catalog.ts; tests/unit/catalog.test.ts; tests/integration/{catalogSettings,catalog}.test.ts; scripts/catalog-indexes.mjs; docs/{phase-f,validation-phase-f,phase-f-delivery}.md.

Alterados: src/app/{app,routes}.ts; src/middlewares/rateLimit.ts; src/infrastructure/repositories/{foundationRepository,commercialRepository}.ts; src/modules/auth/openapi.ts; tests/unit/policy.test.ts; firestore.indexes.json; README backend; docs/{validation,security}.md; docs/architecture/{foundation,data-model,permissions}.md; docs/api/{frontend-contract.md,openapi.json,generated-types.ts}.

Serviços B–E, Rules, dependências/lockfile e frontend não foram alterados. Nenhum deploy, commit, push, produção, recurso pago ou alteração de outro projeto.

## 9. Integração com Claude

Usar [tipos](api/generated-types.ts), [OpenAPI](api/openapi.json) e [contrato frontend](api/frontend-contract.md). Administração envia versão/UUID e configuração completa. Visitante usa prefixo público, productId/quantity e reviewToken; não acessa Firestore/Storage.

Frontend mantém carrinho e chama preview após alterações. Não calcula valores ou lê estoque. Null significa preço oculto; imagens usam imagePath; strings são texto, sem HTML/autolink arbitrário. QUOTE_CHANGED exige novo resumo/revisão. Abrir somente whatsappUrl retornado, com envio manual; não apresentar pedido confirmado ou reserva. Respeitar paginação/cursor e Retry-After.

## 10. Pendências G

Escopo G ainda precisa de definição. Persistência de orçamento requer justificativa, dados, consentimento/retenção e aprovação antes de implementar. Conversão em pedido, documentos/fiscal, envio automático, integrações e produção exigem contratos/autorização próprios. Antes de publicar: dispositivos, índices/custo/carga, abuso distribuído e retenção dos contadores. Integração visual fica com Claude. Snapshots grandes continuam proposta independente.
