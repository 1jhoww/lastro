# Validação local — Fase F

Windows, Node.js 22.16.0, Firebase CLI 15.33.0, Vitest 5.0.3 e Auth/Firestore/Storage Emulator em demo-lastro-tests. Trabalho restrito ao backend local, com dados sintéticos e hosts 127.0.0.1. Sem produção, deploy, commit, push, dependência nova, recurso pago ou alteração da Atual Pet.

## Resultado

**423 testes aprovados, zero falhas/pending/todo:** 153 unitários em dez arquivos e 270 emulados em vinte e um arquivos. F acrescenta 59: 21 unitários e 38 emulados (oito de configuração, trinta de consultas/orçamento). Os 364 anteriores foram preservados; nenhum removido, desabilitado ou enfraquecido.

Regressão emulada A–F iniciada em 9/10/2026 às 17:03:17 (America/Sao_Paulo), duração 854,18 s, saída zero. Unitários finais: 3,76 s, saída zero. Todos os emuladores de teste foram encerrados. Incremento F1 passou oito testes em 13,60 s; incrementos F1–F3 finais passaram 38 em 66,82 s. Relatórios locais: reports/unit-tests.raw.json, reports/emulator-tests.raw.json, reports/phase-f1-tests.raw.json e reports/phase-f-incremental-tests.raw.json.

TypeScript strict, lint, formatação e build passaram. OpenAPI 3.1/0.6.0 e tipos regenerados, 100 operações, incluindo sete públicas com security=[] e sem headers de autenticação/tenant. Auditorias npm completa/runtime: zero advisories conhecidos. Scanner de segredos: findings=[]. Nenhuma dependência/lockfile mudou. [Relatório de entrega F](phase-f-delivery.md) reúne os dez itens solicitados.

## Evidências

- Configuração ausente/inativa e empresa não autorizada bloqueadas; active/past_due autorizados; suspended/canceled/provisioning indisponíveis sem divulgação de motivo privado.
- Administrador usa catalog:manage; vendedor e plataforma sem vínculo são negados. Rebaixamento após middleware e replay suspenso revalidam contexto.
- Mesmo slug concorrente tem um proprietário; mesma chave concorrente tem uma configuração/resultado original. Slug antigo permanece reservado e não resolve publicação nova até ser escolhido novamente pelo proprietário.
- Falha após staging não deixa registry/configuração/auditoria/operação parcial; retry recupera pela mesma UUID.
- Produtos ocultos/inativos/estrangeiros não são publicados; DTO não contém tenant/SKU/autores/estoque/financeiro. Categoria precisa ter produto publicado; página vazia conserva cursor sem expor candidato privado.
- Pesquisa com acentos, filtro de categoria, paginação/cursor adulterado/contexto trocado e alteração de configuração testados. JSON e imagens usam no-store, sem cache antigo de preços.
- Imagem WebP pública passa por API, enquanto rota privada continua autenticada. Despublicação entre download e segundo snapshot bloqueia bytes. Bucket e Rules não foram alterados.
- CORS público sem credenciais funciona e rejeição privada permanece. Limite em memória barra request antes de ler Firestore; limite compartilhado entre instâncias, orçamento por slug e dez POSTs por minuto passaram. Público não consome bucket privado.
- Unidade inteira UN/CX/PCT e decimal KG/L validada; meio centavo arredonda half-up. Preço zero e subtotal pequeno não geram mínimo comercial. Quantidades/itens excessivos e mass assignment falham sem efeitos comerciais.
- Preço oculto não aparece em detalhe/resumo/mensagem/erro monetário/prova. Alterar exclusivamente preço oculto mantém reviewToken. Preço público alterado exige novo preview; retirar produto ou catálogo impede link antigo.
- Preview/WhatsApp concorrentes retornam mesmo conteúdo de domínio, sem idempotência comercial ou envio. Origem do link, codificação e neutralização de controles/formatação/URLs testadas em unidade.
- Preview de 200 produtos preserva todos os saldos de estoque e não cria reservas/pedidos/recebíveis/financeiro. Ausência de efeitos verificada também para solicitações repetidas.

## Limites e Reprodução

Regressão preservou pedidos de 1/20/50/100/200 produtos, ausência de mínimo, reservas atômicas, recebíveis, parciais/estornos/créditos/retornos e isolamento A–E. Corrida de 200 produtos: 4688 ms, respostas 409/200, um commit integral; replay concorrente: 4537 ms, respostas 200/200, um efeito. Cancelamento financeiro pago de 200: 832 ms; retorno físico: 1933 ms; resolução: 1849 ms. Amostras locais, não SLO/carga produtiva.

Emulador manteve locks após rollback em fixture de capacidade: vinte retries somente na limpeza, conforme helper preexistente (~60 s). Nenhum callback de domínio ou assertion foi repetido para ocultar falha; nenhum timeout de teste foi alterado. JAVA_TOOL_OPTIONS gerou aviso informativo do runner, sem falha. Lint inicial sinalizou regex de controle; expressão equivalente com propriedade Unicode foi corrigida e revalidada. Formatação de catalogRoutes também foi corrigida; checks finais passaram.

Detalhes em [Fase F](phase-f.md). Páginas 25/máximo 50; corpo 64 KiB; até 200 produtos distintos por preview; unidades e valores com limites numéricos existentes. Mensagem 12.000 caracteres e URL 16.000, sem truncamento. Dispositivo pode ter limite menor; não foi realizado envio real pelo WhatsApp.

Emulador não comprova índices produtivos, custo, carga distribuída, SLO, backup/restauração ou resistência completa a abuso. Contadores usam expiresAt sem TTL implantado; retenção/limpeza antes de produção precisa de aprovação. Orçamentos não são persistidos. Índices locais totais 126, sem deploy. Snapshots grandes não foram implementados.

Na pasta backend, configurar TEMP/TMP para .local no sandbox Windows. Executar wrapper scripts/npm.ps1 para test, typecheck, lint, format:check, build, openapi, types:api, audit:secrets e npm audit completo/runtime. scripts/emulators.mjs test executa toda suíte; filtros catalogSettings.test.ts/catalog.test.ts executam incrementos. Processos de emulação precisam das portas locais fora do sandbox; launcher remove credenciais e testes recusam projeto real/hosts externos.

## Arquivos

Novos: src/shared/schemas/catalog.ts; src/modules/catalog/{catalogService,quoteCalculation,publicCursor}.ts; src/app/catalogRoutes.ts; tests/helpers/catalog.ts; tests/unit/catalog.test.ts; tests/integration/{catalogSettings,catalog}.test.ts; scripts/catalog-indexes.mjs; docs/{phase-f,validation-phase-f,phase-f-delivery}.md.

Alterados: src/app/{app,routes}.ts; src/middlewares/rateLimit.ts; src/infrastructure/repositories/{foundationRepository,commercialRepository}.ts; src/modules/auth/openapi.ts; tests/unit/policy.test.ts; firestore.indexes.json; README backend; docs/api/{frontend-contract,openapi.json,generated-types.ts}; docs/architecture/{foundation,data-model,permissions}.md; docs/{validation,security}.md. Produtos B, pedidos D e financeiro E não tiveram seus serviços alterados.

Pendências G: escopo ainda não definido. Persistência/conversão de orçamento, identificação/consentimento e retenção do visitante, documentos/fiscal, envio automático, publicação e infraestrutura precisam de autorização própria. Integração de telas permanece com Claude; contratos fornecem todos os valores, estados e links necessários.
