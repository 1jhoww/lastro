# Graph Report - Lastro  (2026-10-15)

## Corpus Check
- Large corpus: 571 files · ~788,540 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 3634 nodes · 15488 edges · 110 communities (106 shown, 4 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 518 edges (avg confidence: 0.84)
- Token cost: 713,336 input · 0 output

## Community Hubs (Navigation)
- UI Kit e Tema
- Schemas e Erros Backend
- Telas Financeiro Frontend
- APIs de Feature Frontend
- App Express e Proteção HTTP
- Movimentações de Estoque UI
- Componentes Base e Erros UI
- Tipos API e Comandos Financeiros
- Rotas, Auditoria e Atores
- Navegação Expo Router
- Rotas e Schemas de Pedidos
- Sessão, Formulários e Convite
- Serviço de Estoque Backend
- Cliente API e Scripts E2E
- Livro Financeiro e Devoluções
- Fixtures de Teste Backend
- Editor de Pedidos
- Ações de Pedido e Telas Admin
- Docs de Fases B-G
- Serviço de Pedidos
- Telas de Listagem
- Catálogo e Orçamento Backend
- Testes Integração Financeiro
- Schemas Comerciais e Documentos
- Modelo de Execução Financeira
- Telas de Resolução Financeira
- Evidência Validação Finance C
- Repositórios e Acesso
- Fake API de Testes Frontend
- Provas e Publicação Financeira
- Testes Pedidos e Devoluções
- Documentos PDF e CSV
- Schemas Financeiros
- Gate de Sessão e Navegador
- Fake Gateway Auth Testes
- Acesso Financeiro Frontend
- Deps Frontend (tooling)
- Deps Expo Runtime
- Intent Ledger Durável
- Config Expo app.json
- Deps Backend e Validação PDF
- Ações de Arquivo Etapa 7
- Testes Finance B
- Hashes e Backfill Financeiro
- Bootstrap App e Firebase
- Fundação, Tenant e Permissões
- Testes Finance C
- Modelo de Dados e Estoque (ADRs)
- Fases de Resolução Financeira
- README Backend e Contrato HTTP
- Exportações Frontend
- API de Execuções Financeiras
- DevDeps Backend
- Scripts Emuladores e Segredos
- Scripts npm Backend
- Testes Execução Financeira
- tsconfig Backend
- Projeções Financeiras (ADR 0008)
- Contrato Frontend e Catálogo Público
- E2E Web Finance C
- Geração OpenAPI
- Regras de Recebíveis
- Docs Etapas Frontend
- Validações Fases A-E
- Segurança e Correção F04
- Devolução de Pedidos Expedidos
- Visão Econômica
- Testes Telas Estoque
- Persistência Auth Nativa
- tsconfig Frontend
- Proposta F02 Resolução Retomável
- Deps Runtime Backend
- Progresso Financeiro Etapa 6
- Scripts npm Frontend
- Resumo F03-F07
- Relatório Final Etapa 7
- Interface AuthGateway
- Pedidos e Reservas (ADR 0007)
- Auditoria Backend A-G
- Devoluções e Capacidade
- Intent Ledger (docs)
- DevDeps Frontend
- Orçamentos e Snapshots F05
- Executor Financeiro Retomável
- Auth e Cache por Tenant (docs)
- Config Jest
- Regras Caveman
- Garantias Atômicas e Ledger
- Regras Agente Expo
- Marca e Catálogo Público
- Testes Telas Etapa 7
- Validação F01/F02
- Validação Fase F
- Overrides npm Backend
- Smoke Server
- Config Vercel
- Runtime Node F06
- Capacidade 20k Fontes
- Validação Pedidos A-D
- Check OpenAPI
- Config Metro
- Schema OpenAPI Frontend
- Rate Limiting F03
- Índices Catálogo
- tsconfig Build
- Prettier Backend
- Prettier Frontend
- Índices Comerciais
- Empacotamento Assets

## God Nodes (most connected - your core abstractions)
1. `Text()` - 226 edges
2. `requireCondition()` - 185 edges
3. `Button()` - 176 edges
4. `useSession()` - 170 edges
5. `Actor` - 147 edges
6. `unwrap()` - 140 edges
7. `digest()` - 130 edges
8. `Alert()` - 128 edges
9. `react-native` - 122 edges
10. `toApiError()` - 114 edges

## Surprising Connections (you probably didn't know these)
- `Cline caveman rule` --semantically_similar_to--> `AGENTS.md (caveman rules)`  [INFERRED] [semantically similar]
  .clinerules/caveman.md → AGENTS.md
- `Copilot instructions (caveman)` --semantically_similar_to--> `AGENTS.md (caveman rules)`  [INFERRED] [semantically similar]
  .github/copilot-instructions.md → AGENTS.md
- `OpenCode AGENTS.md (caveman)` --semantically_similar_to--> `AGENTS.md (caveman rules)`  [INFERRED] [semantically similar]
  .opencode/AGENTS.md → AGENTS.md
- `Windsurf caveman rule` --semantically_similar_to--> `AGENTS.md (caveman rules)`  [INFERRED] [semantically similar]
  .windsurf/rules/caveman.md → AGENTS.md
- `Cline caveman rule` --implements--> `Caveman terse response style`  [INFERRED]
  .clinerules/caveman.md → AGENTS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Caveman rule replicated for each AI coding tool** — agents, _clinerules_caveman, _github_copilot_instructions, _opencode_agents, _windsurf_rules_caveman [EXTRACTED 1.00]
- **Order confirmation commits order, reservations, stock and receivables together** — context_pedido, context_reserva, context_estoque, context_recebivel [EXTRACTED 1.00]
- **Return flow: intention, physical receipt, financial resolution** — context_intencao, context_recfis, context_resolucao, context_obrigacao [EXTRACTED 1.00]
- **Mecanismo de resolucao financeira retomavel F02** — backend_docs_proposals_financial_resumable_resolution_consistency_model, backend_docs_proposals_financial_resumable_resolution_execution_state_machine, backend_docs_proposals_financial_resumable_resolution_checkpoints_proofs, backend_docs_proposals_financial_resumable_resolution_economic_resolver, backend_docs_proposals_financial_resumable_resolution_active_sources_generations, backend_docs_proposals_financial_resumable_resolution_idempotency_fencing [EXTRACTED 1.00]
- **Rodada de remediacao F03-F07 (achado, plano, correcao)** — backend_docs_audits_remediation_f03_f07_2026_10_13_f03_fix, backend_docs_audits_remediation_f03_f07_2026_10_13_f04_fix, backend_docs_audits_remediation_f03_f07_2026_10_13_f05_fix, backend_docs_audits_remediation_f03_f07_2026_10_13_f06_fix, backend_docs_audits_remediation_f03_f07_2026_10_13_f07_fix [EXTRACTED 1.00]
- **Fluxo de devolucao de pedido expedido (intencao, recebimento fisico, resolucao financeira)** — backend_docs_proposals_dispatched_returns_partial_returns, backend_docs_proposals_dispatched_returns_physical_receipt, backend_docs_proposals_dispatched_returns_financial_resolution, backend_docs_proposals_dispatched_returns_damaged_decisions, backend_docs_proposals_dispatched_returns_order_financial_block [EXTRACTED 0.90]
- **Order Confirmation Atomic Commit (reservations, receivables, state, idempotency)** — backend_docs_phase_d_order_state_machine, backend_docs_phase_d_stock_reservations, backend_docs_phase_d_installment_receivables, backend_docs_phase_d_order_idempotency, backend_docs_phase_c_order_stock_contract [EXTRACTED 0.95]
- **Public Catalog to Quote to WhatsApp Flow** — backend_docs_phase_f_public_catalog, backend_docs_phase_f_quote_preview_review_token, backend_docs_phase_f_whatsapp_link, backend_docs_phase_f_public_rate_limiting [EXTRACTED 0.95]
- **Dispatched Return Resolution Flow** — backend_docs_phase_e_dispatched_returns, backend_docs_phase_e_damaged_goods_acceptance, backend_docs_phase_e_credit_lots, backend_docs_phase_e_refund_obligations, backend_docs_f02_delivery_resumable_financial_resolution [INFERRED 0.85]
- **Phased validation reports A through G plus F01/F02 rounds** — backend_docs_validation_phase_a, backend_docs_validation_phase_b, backend_docs_validation_phase_c, backend_docs_validation_phase_d, backend_docs_validation_phase_e, backend_docs_validation_phase_f, backend_docs_validation_phase_g, backend_docs_validation_f01, backend_docs_validation_f02 [EXTRACTED 1.00]
- **F02 resumable financial resolution mechanism** — backend_docs_validation_f02_resumable_executor, backend_docs_validation_f02_merkle_membership_proofs, backend_docs_validation_f02_execution_locks_fencing, backend_docs_validation_f02_single_publication, backend_docs_validation_f02_admin_resume_recovery, backend_docs_validation_f02_active_source_index [EXTRACTED 1.00]
- **Phase E financial lifecycle (settings, receipts, reversals, returns)** — backend_docs_validation_phase_e_payment_settings, backend_docs_validation_phase_e_receipts, backend_docs_validation_phase_e_reversals_credits_cancellation, backend_docs_validation_phase_e_dispatched_returns, backend_docs_validation_phase_e_damage_acceptance [EXTRACTED 1.00]
- **Idempotent intent-based command pattern (stock, orders, finance, catalog settings)** — frontend_docs_inventory_intent_ledger, frontend_docs_inventory_movement_review_flow, frontend_docs_orders_lifecycle_commands, frontend_docs_finance_progress_durable_intent_persistence, frontend_docs_etapa_7_relatorio_final_catalog_settings, frontend_docs_architecture_idempotency_by_intent [EXTRACTED 0.95]
- **Auth, session and tenant routing flow** — frontend_docs_auth_authgateway, frontend_docs_auth_session_gate, frontend_docs_auth_api_client, frontend_docs_auth_tenant_cache_isolation, frontend_docs_auth_permissions, frontend_docs_auth_subscription_states [EXTRACTED 0.90]
- **Etapa 6 financial phases A, B, C progression** — frontend_docs_finance_progress_phase_a_receivables, frontend_docs_finance_progress_phase_b_credits_refunds, frontend_docs_finance_progress_phase_c_executor, frontend_docs_finance_progress_resumable_execution, frontend_docs_finance_progress_reconciliation [EXTRACTED 0.90]

## Communities (110 total, 4 thin omitted)

### Community 0 - "UI Kit e Tema"
Cohesion: 0.03
Nodes (140): styles, styles, PlatformLayout(), DesignSystem(), styles, swatches, Props, Symbol() (+132 more)

### Community 1 - "Schemas e Erros Backend"
Cohesion: 0.05
Nodes (93): CommercialCollection, FoundationRepository, platformAdminSchema, decodePublicCursor(), encodePublicCursor(), keyFor(), initialFinancialHash(), financialOperationSchema (+85 more)

### Community 2 - "Telas Financeiro Frontend"
Cohesion: 0.05
Nodes (105): PaymentMethod, Receivable, ReceivablesRoute(), Attention(), FinanceOverviewScreen(), Indicators(), plural(), RecentReceipts() (+97 more)

### Community 3 - "APIs de Feature Frontend"
Cohesion: 0.06
Nodes (91): paidSource(), fixture(), getExecution(), unwrap(), queryKeys, Category, CategoryCreate, CategoryUpdate (+83 more)

### Community 4 - "App Express e Proteção HTTP"
Cohesion: 0.04
Nodes (63): apply, args, config, cursor, firebase, config, firebase, now (+55 more)

### Community 5 - "Movimentações de Estoque UI"
Cohesion: 0.05
Nodes (81): Customer, CustomerCreate, CustomerUpdate, Movement, PublicProduct, QuoteInput, StockAdjustmentBody, StockAdmin (+73 more)

### Community 6 - "Componentes Base e Erros UI"
Cohesion: 0.08
Nodes (71): fallback, messages, toApiError(), CompanySettings(), Field(), styles, inviteError(), InvitePanel() (+63 more)

### Community 7 - "Tipos API e Comandos Financeiros"
Cohesion: 0.03
Nodes (83): AcceptedInvitation, BodyOf, CatalogInput, CatalogSettings, CategoriesPage, ConditionCreate, ConditionUpdate, CreatedTenant (+75 more)

### Community 8 - "Rotas, Auditoria e Atores"
Cohesion: 0.08
Nodes (18): createRoutes(), actorFor(), platformAuthorization(), selectedTenant(), tenantAuthorization(), CategoryService, CustomerService, decimalCents() (+10 more)

### Community 9 - "Navegação Expo Router"
Cohesion: 0.06
Nodes (52): EditCustomer(), Assignment(), CustomerDetail(), CustomerView(), styles, CatalogSettings(), Settings(), Settings() (+44 more)

### Community 10 - "Rotas e Schemas de Pedidos"
Cohesion: 0.04
Nodes (70): commercialRoutes, documentRoutes, executionRoutes, financeRoutes, inventoryRoutes, orderRoutes, paymentSettingsRoutes, returnRoutes (+62 more)

### Community 11 - "Sessão, Formulários e Convite"
Cohesion: 0.06
Nodes (64): BlockedAccess(), styles, SignIn(), styles, ResetPassword(), styles, PublicCatalogRoute(), AcceptInvitation() (+56 more)

### Community 12 - "Serviço de Estoque Backend"
Cohesion: 0.06
Nodes (52): SourceChange, InventoryService, movementHash(), movementView(), operationSchema, stockView(), FirestoreOrderStockAdapter, reservationIdFor() (+44 more)

### Community 13 - "Cliente API e Scripts E2E"
Cohesion: 0.11
Nodes (53): config, config, artifacts, main(), output, publicApi, url, localUrl (+45 more)

### Community 14 - "Livro Financeiro e Devoluções"
Cohesion: 0.10
Nodes (15): Book, FinancialBook, FinancialService, SourceIndex, assertDocumentFits(), documentSize(), FIRESTORE_DOCUMENT_BYTES, stringSize() (+7 more)

### Community 15 - "Fixtures de Teste Backend"
Cohesion: 0.10
Nodes (49): createdTenantView, planView, conditionView, f, f, headers(), f, catalogConfig() (+41 more)

### Community 16 - "Editor de Pedidos"
Cohesion: 0.07
Nodes (59): ApiClient, ConditionOption, MethodOption, Order, OrderCreate, OrderUpdate, sendReceipt(), sendFinanceCommand() (+51 more)

### Community 17 - "Ações de Pedido e Telas Admin"
Cohesion: 0.09
Nodes (53): lineColumns, OrderDetail(), OrderView(), styles, Total(), Orders(), OrdersRoute(), StatusFilter (+45 more)

### Community 18 - "Docs de Fases B-G"
Cohesion: 0.05
Nodes (62): F02 Delivery Report, 20,000-Source Capacity Fixtures, F02 Batch Budget Limits (150 reads, 100 writes), Execution Lease and Fence, 409 FINANCIAL_RESUMABLE_REQUIRED, F02 Resumable Financial Resolution Executor, Operacao tecnica F03-F07, Cheap Per-IP HTTP Limiter Before JSON/Auth (+54 more)

### Community 19 - "Serviço de Pedidos"
Cohesion: 0.09
Nodes (37): calendarFor(), commercialTerms(), presetSchedule(), termsAt(), termsInstallments(), weightedAmounts(), FinancialLocks, approvalFingerprint() (+29 more)

### Community 20 - "Telas de Listagem"
Cohesion: 0.09
Nodes (48): Product, Customers(), statusOptions, styles, FigureKey, Inventory(), SearchMode, statusOptions (+40 more)

### Community 21 - "Catálogo e Orçamento Backend"
Cohesion: 0.07
Nodes (34): publicCatalogRoutes(), CatalogService, messageText(), money(), quoteMessage(), quoteReviewToken(), whatsappLink(), catalogAdminResult (+26 more)

### Community 22 - "Testes Integração Financeiro"
Cohesion: 0.13
Nodes (36): companyDate(), eventSchema, paymentSchema, condition(), creditSource(), financePost(), financialOrder(), receiptBody() (+28 more)

### Community 23 - "Schemas Comerciais e Documentos"
Cohesion: 0.05
Nodes (42): normalizeDocument(), validDocument(), normalizeImage(), address, assignmentInput, categoriesPage, Category, categoryCreate (+34 more)

### Community 24 - "Modelo de Execução Financeira"
Cohesion: 0.07
Nodes (39): FinancialBatchMeter, SplitFinancialBatch, abortInput, advanceInput, allocateIntent(), attemptSchema, counter, executionsPage (+31 more)

### Community 25 - "Telas de Resolução Financeira"
Cohesion: 0.09
Nodes (37): ApiError, classify(), FinancialExecution, ReturnPreview, ReturnResolutionInput, AppLayout(), Execution(), ExecutionScreen() (+29 more)

### Community 26 - "Evidência Validação Finance C"
Cohesion: 0.04
Nodes (45): backendChanges, backendRuntime, baseline, passed, suites, total, bundles, checks (+37 more)

### Community 27 - "Repositórios e Acesso"
Cohesion: 0.08
Nodes (13): overrides, path, value, CommercialRepository, AccessService, FinancialCommands, PaymentSettingsService, InitialOrderReceivables (+5 more)

### Community 28 - "Fake API de Testes Frontend"
Cohesion: 0.11
Nodes (33): current(), InventoryRoute(), administrator, category(), customer(), Handler, membership(), meta (+25 more)

### Community 29 - "Provas e Publicação Financeira"
Cohesion: 0.11
Nodes (34): preparedSourceSchema, ProofReader, publicationSchema, ReturnHeadReader, rootCertificateSchema, sourcePlanSchema, ReturnPublication, orderLifecycleSchema (+26 more)

### Community 30 - "Testes Pedidos e Devoluções"
Cohesion: 0.17
Nodes (28): reconciliationView, orderView, f, f, seller(), method(), enter(), stockProduct() (+20 more)

### Community 31 - "Documentos PDF e CSV"
Cohesion: 0.09
Nodes (27): manifest, root, source, brazilianDate(), csvBytes(), csvCell(), MAX_CSV_BYTES, safeDocumentText() (+19 more)

### Community 32 - "Schemas Financeiros"
Cohesion: 0.06
Nodes (35): allocation, allocationInput, allocationsInput, cancellationInput, creditInput, creditReversalInput, creditsPage, creditView (+27 more)

### Community 33 - "Gate de Sessão e Navegador"
Cohesion: 0.09
Nodes (23): Me, Membership, clearOrphanFiles(), BootScreen(), MeErrorScreen(), kvStorage, RootNavigator(), styles (+15 more)

### Community 34 - "Fake Gateway Auth Testes"
Cohesion: 0.09
Nodes (18): AuthUser, fail(), Account, FakeGateway, marker(), renderApp(), testQueryClient(), ana (+10 more)

### Community 35 - "Acesso Financeiro Frontend"
Cohesion: 0.11
Nodes (18): SettingsRoute(), CreditsRoute(), Page(), Page(), Page(), Page(), ReceivableRoute(), FinanceRoute() (+10 more)

### Community 36 - "Deps Frontend (tooling)"
Cohesion: 0.06
Nodes (31): { defineConfig }, expoConfig, engines, node, eslint, prettier, typescript, zod (+23 more)

### Community 37 - "Deps Expo Runtime"
Cohesion: 0.06
Nodes (34): dependencies, expo, expo-clipboard, expo-constants, expo-crypto, expo-file-system, expo-font, @expo-google-fonts/inter (+26 more)

### Community 38 - "Intent Ledger Durável"
Cohesion: 0.13
Nodes (27): api, directory, kv, main(), store, CancellationInput, newIdempotencyKey(), useIntentKey() (+19 more)

### Community 39 - "Config Expo app.json"
Cohesion: 0.06
Nodes (31): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, predictiveBackGestureEnabled, softwareKeyboardLayoutMode (+23 more)

### Community 40 - "Deps Backend e Validação PDF"
Cohesion: 0.07
Nodes (28): engines, node, eslint, prettier, typescript, zod, name, private (+20 more)

### Community 41 - "Ações de Arquivo Etapa 7"
Cohesion: 0.15
Nodes (19): Download, downloadMessage(), FilePresentation, FileActions(), cleaners, fileLease(), resetPrivateFiles(), trackPrivateFile() (+11 more)

### Community 42 - "Testes Finance B"
Cohesion: 0.15
Nodes (25): buildEconomicCommand(), orderLine(), application(), condition(), lot(), meta, payment(), refund() (+17 more)

### Community 43 - "Hashes e Backfill Financeiro"
Cohesion: 0.22
Nodes (14): financialEventHash(), receivableBasis(), compactHeaderHash(), proofManifestHash(), boundedDocument(), integrity(), SourceBackfill, activeGenerationId() (+6 more)

### Community 44 - "Bootstrap App e Firebase"
Cohesion: 0.11
Nodes (22): ErrorKind, createQueryClient(), retryable, RootLayout(), createAuth(), createFirebaseGateway(), toUser(), AuthGatewayError (+14 more)

### Community 45 - "Fundação, Tenant e Permissões"
Cohesion: 0.14
Nodes (28): ADR 0001 Identidade global e vinculo por empresa, ADR 0002 Admissao transacional (capacidade e administrador), ADR 0003 Planos versionados, Firestore collections v1 (tenants/{id}/...), Arquitetura da fundacao, Central tenant authorization gate, Capacity model (active members + valid pending invitations), Platform operator separated from tenant roles (+20 more)

### Community 46 - "Testes Finance C"
Cohesion: 0.14
Nodes (22): createApiClient(), criticalRequest, intentLedger, createFakeApi(), order(), cancellationInput, execution(), publishedExecution() (+14 more)

### Community 47 - "Modelo de Dados e Estoque (ADRs)"
Cohesion: 0.13
Nodes (27): ADR 0004 Carteiras e unicidade transacional, ADR 0005 Imagens privadas e associacao versionada, ADR 0006 Estoque serializado por produto, Quantities as decimal strings, Modelo de dados v1, Idempotency records / operations (no TTL), Composite index cost vs query flexibility (125-126 indexes, not deployed), Inventory movement hash chain and reconciliation (+19 more)

### Community 48 - "Fases de Resolução Financeira"
Cohesion: 0.29
Nodes (10): batchReads(), appendChain(), ensure(), move(), ResolutionPlan, ResolutionPhases, sealSourceProof(), SourceProof (+2 more)

### Community 49 - "README Backend e Contrato HTTP"
Cohesion: 0.12
Nodes (25): F02 contrato de execucoes financeiras, Batch limits (150 reads, 100 writes, 2 MiB), Completion criteria (financialCompleted, COMPLETED, publishedAt), Lease and fencing token for executor takeover, Pending homologation (20k real receipts, quotas, Cloud Run), Refund stays manual obligation, Order and fenced lots remain blocked until publication, Proof reconciliation (scope proofs, signed cursor) (+17 more)

### Community 50 - "Exportações Frontend"
Cohesion: 0.15
Nodes (19): ExportForm(), ExportPages(), Exports(), statuses, exportPage(), ExportRequest, ExportResource, Query (+11 more)

### Community 51 - "API de Execuções Financeiras"
Cohesion: 0.25
Nodes (7): chainStart(), view(), ExecutionPublication, FinancialExecutions, lease(), terminal(), assertExecutionTransition()

### Community 52 - "DevDeps Backend"
Cohesion: 0.10
Nodes (20): devDependencies, eslint, @eslint/js, firebase-tools, @napi-rs/canvas, openapi-typescript, pdfjs-dist, prettier (+12 more)

### Community 53 - "Scripts Emuladores e Segredos"
Cohesion: 0.10
Nodes (14): findings, patterns, walk(), args, child, env, filters, withoutCapacity (+6 more)

### Community 54 - "Scripts npm Backend"
Cohesion: 0.11
Nodes (18): scripts, audit:dependencies, audit:secrets, build, check:artifact, check:openapi, dev, emulators (+10 more)

### Community 55 - "Testes Execução Financeira"
Cohesion: 0.22
Nodes (10): financialCapacityReport(), advanceExecution(), currentExecution(), Execution, finishExecution(), refreshFinancialActor(), f, f (+2 more)

### Community 56 - "tsconfig Backend"
Cohesion: 0.11
Nodes (17): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, module, moduleResolution, noFallthroughCasesInSwitch, noImplicitOverride, noUncheckedIndexedAccess (+9 more)

### Community 57 - "Projeções Financeiras (ADR 0008)"
Cohesion: 0.26
Nodes (17): ADR 0008 Projecoes financeiras compativeis com D, Damaged goods acceptance (full / partial / zero) with backend limits, Financial state, receipts, reversals and credit applications, Payment condition/method selection and payment-preview, Financial projections: financialTitles / financialOrderStates / journal, Returns aggregate (orderReturnLines, returnReceipts, returnEvents), Fase E - financeiro e retornos, Condicao de pagamento (+9 more)

### Community 58 - "Contrato Frontend e Catálogo Público"
Cohesion: 0.16
Nodes (17): Contrato de integracao do frontend, Financial cancellation and manual refund obligation, Financial reconciliation signed checkpoint cursor (F01), Inventory reconciliation paged audit, Private PDF/CSV download contract (blob, one page per CSV), Public catalog visitor flow (no Bearer, opaque IDs, no-store), quote-preview + whatsapp link (reviewToken, nothing persisted), Handle errors by stable code, not message (+9 more)

### Community 59 - "E2E Web Finance C"
Cohesion: 0.17
Nodes (14): { createServer }, delay(), esbuild, main(), cdp(), connect(), evaluate(), shutdown() (+6 more)

### Community 60 - "Geração OpenAPI"
Cohesion: 0.17
Nodes (11): components, $defs, operations, paths, webhooks, routeDefinitions, jsonSchema(), openApiDocument() (+3 more)

### Community 61 - "Regras de Recebíveis"
Cohesion: 0.17
Nodes (13): ReceiptInput, ReceivableStatus, inFlight, ReceivableFilters, scanPages(), calendarDate, filterSchema, isOverdue() (+5 more)

### Community 62 - "Docs Etapas Frontend"
Cohesion: 0.23
Nodes (14): Frontend architecture and diagnosis (Etapa 1), Catalog: customers, products, categories (Etapa 3), expectedVersion optimistic concurrency with CONFLICT reload, Authenticated product image upload and preview, Safe 404 for customers outside seller portfolio, Shared UI components (Dialog, Select, DataTable, Toast, ListPanel), Inventory (Etapa 4), Entry/adjustment review-then-confirm flow with impact preview (+6 more)

### Community 63 - "Validações Fases A-E"
Cohesion: 0.23
Nodes (14): Validation Phase A (foundation), Firebase Emulator Suite test harness (demo projects), Invites, admin capacity and last-admin protection, Multi-tenant isolation and access control, Validation Phases A and B (commercial base), Customers and seller portfolios, Products and categories (SKU, price), Validation Phases A, B and C (inventory) (+6 more)

### Community 64 - "Segurança e Correção F04"
Cohesion: 0.21
Nodes (12): Correcao consolidada F03-F07 (2026-10-13), Correcao F04: TTL rateLimits, expiracao logica de replay, limpeza de imagens (parcial), Validacao integrada: 636 testes unicos, 36 novos, 602 preservados, Riscos residuais: F04/F06 parciais, infraestrutura externa pendente, Veredito: backend apto para homologacao local, Plano F04: retencao por colecao, TTL Timestamp, limpeza de imagens, Seguranca das Fases A-G, Controles de upload e imagens privadas (sharp, Storage Rules) (+4 more)

### Community 65 - "Devolução de Pedidos Expedidos"
Cohesion: 0.21
Nodes (12): Proposta revisada: devolucoes de pedidos expedidos, Decisao administrativa de produto danificado (aceite integral/parcial/zero), Ordem de abatimento: parcelas em aberto, depois fontes liquidadas, Resolucao financeira de devolucao (POST returns/{id}/resolve), Bloqueio financeiro por pedido durante devolucao pendente, Devolucoes parciais em momentos diferentes (intencao vs recebimento), Recebimento fisico idempotente (returnReceipts imutaveis), Agregados returns, orderReturnLines, returnReceipts e Guard E (+4 more)

### Community 66 - "Visão Econômica"
Cohesion: 0.49
Nodes (3): EconomicView, integrity(), sourceProofId()

### Community 67 - "Testes Telas Estoque"
Cohesion: 0.23
Nodes (8): StockAdjustmentRoute(), StockEntryRoute(), MovementScreen(), Call, stockMovement(), ChooseTenant(), moved(), overrides

### Community 68 - "Persistência Auth Nativa"
Cohesion: 0.15
Nodes (6): firebase/auth, ReactNativeAsyncStorage, authPersistence, chunkedSecureStorage, options, firebase

### Community 69 - "tsconfig Frontend"
Cohesion: 0.15
Nodes (12): compilerOptions, exactOptionalPropertyTypes, noFallthroughCasesInSwitch, noImplicitOverride, noUncheckedIndexedAccess, paths, strict, types (+4 more)

### Community 70 - "Proposta F02 Resolução Retomável"
Cohesion: 0.24
Nodes (10): Alternativas de correcao F02 (admissao, fontes ativas, resolucao retomavel), F02: resolucao financeira retomavel (proposta aprovada), Fontes ativas certificadas por geracao e lotes de credito cercados, Checkpoints idempotentes e provas Merkle fragmentadas, Resolvedor economico unico (visao anterior ate publicacao), Maquina de estados da execucao (ACCEPTED ... COMPLETED/ABORTED), Migracao e pedidos ja bloqueados (backfill, ativacao opt-in, NEEDS_REVIEW), Endpoints HTTP opt-in de financial-executions (202, advance, resume, abort) (+2 more)

### Community 71 - "Deps Runtime Backend"
Cohesion: 0.17
Nodes (12): dependencies, cors, dotenv, express, express-rate-limit, firebase-admin, fontkit, helmet (+4 more)

### Community 72 - "Progresso Financeiro Etapa 6"
Cohesion: 0.21
Nodes (10): Money in cents, quantities in integer thousandths, Super Admin platform area with recent-password reauthentication, Etapa 6 Finance and Receivables progress, Phase A: receivables list, installment detail, receipts, Phase B: credits, reversals, manual refunds, payment settings, draft discount, Phase C: financial cancellation executor (F02) and returns resolution, Recent-password reauthentication for financial commands (ReauthGate), Cumulative paginated reconciliation (journal and proofs) (+2 more)

### Community 73 - "Scripts npm Frontend"
Cohesion: 0.17
Nodes (12): scripts, android, api:sync, export:web, format, format:check, ios, lint (+4 more)

### Community 74 - "Resumo F03-F07"
Cohesion: 0.18
Nodes (8): baseline, current, executions, lockfileSha256, missing, newTests, result, structural

### Community 75 - "Relatório Final Etapa 7"
Cohesion: 0.24
Nodes (11): Backend contract gaps and risks (no field errors, cursor-only pagination), Catalog backend limitations (members without names, prefix-only search), Etapa 7 final report: reports, documents, exports, public catalog, Page-by-page CSV exports (customers, products, orders, receivables), File epoch cleanup (revoke Blob URLs and cache on identity/tenant change), Missing aggregate report contracts (sales, receipts, inventory CSV), MVP coverage matrix (12 requirements), Native Android/iOS builds and share sheet not exercised (+3 more)

### Community 77 - "Pedidos e Reservas (ADR 0007)"
Cohesion: 0.40
Nodes (10): ADR 0007 Pedidos confirmam estoque e recebiveis no mesmo commit, Order lifecycle and discount approval flow (phase D), orderFinancialGuards serializer, Order transaction (prepare -> apply), Fase D - pedidos, reservas, expedicao, Aprovacao de desconto, Expedicao, Pedido (+2 more)

### Community 78 - "Auditoria Backend A-G"
Cohesion: 0.22
Nodes (8): Auditoria final backend Lastro A-G (2026-10-09), Checklist de integracao frontend (idempotencia, versoes, cursores), Cursor de reconciliacao de estoque com checkpoint assinado, Verificacao local 493 testes e limites de cobertura, Correcao F07: gerador separa io input/output, OpenAPI 0.8.1, Plano F07: separar conversao de entrada e saida OpenAPI, Matriz adversarial e aceite estrutural local (20.000 fontes), Estoque Fase C: operacao idempotente, ledger com hash encadeado

### Community 79 - "Devoluções e Capacidade"
Cohesion: 0.22
Nodes (10): Order lifecycle (draft, confirmed, dispatched, canceled), Firestore technical limits (1 MiB doc, 10 MiB request, 270s tx), Large order capacity matrix (20/50/100/200 products), Large order snapshots proposal (immutable per-version lines), Monetary damage acceptance (full, partial, zero), E4 dispatched returns, physical receipt and damage resolution, Validation Phase G (documents and exports, 493 tests), On-demand private PDFs (commercial and picking list) (+2 more)

### Community 80 - "Intent Ledger (docs)"
Cohesion: 0.22
Nodes (9): Stable error-code classification (ApiError kind), OpenAPI contract generated from backend source (api:sync), Typed HTTP client (openapi-fetch + middleware), Per-platform session persistence (IndexedDB web, SecureStore native), Admin catalog settings with durable versioned intent, Durable intent persistence before HTTP (IndexedDB web, SecureStore fragments native), Intent ledger (lib/intent.ts): key per intent, unknown outcome retry, Draft creation without Idempotency-Key (no auto retry) (+1 more)

### Community 81 - "DevDeps Frontend"
Cohesion: 0.20
Nodes (10): devDependencies, eslint, eslint-config-expo, jest, jest-expo, prettier, @testing-library/react-native, @types/jest (+2 more)

### Community 82 - "Orçamentos e Snapshots F05"
Cohesion: 0.36
Nodes (7): Correcao F05: orcamentos separados, vagas PDF/CSV, snapshots sequenciais, byte budget, Plano F05: orcamento de processamento/memoria e concorrencia, Proposta: snapshots de pedidos alem do documento agregado, Linhas imutaveis por versao (alternativa recomendada), Alternativas rejeitadas: truncar snapshots, banco relacional, saga, Documentos Fase G: PDFKit sem HTML, CSV com neutralizacao de formulas, vagas compartilhadas, Pedidos Fase D: confirmacao em um commit, aprovacao de desconto, sem confirmacao repartida

### Community 83 - "Executor Financeiro Retomável"
Cohesion: 0.22
Nodes (9): Active financial source projection/index, Administrative resume with reauth and sealed-backup proof recovery, Central economic view resolver (prior values until publication), Eight opt-in financial execution endpoints (OpenAPI 0.8.0), Durable resumable financial executor, Single atomic publication commit (financial event v2), SourceBackfill (internal certified index backfill), Compatible financial projections (ADR 0008) (+1 more)

### Community 84 - "Auth e Cache por Tenant (docs)"
Cohesion: 0.31
Nodes (9): Remote state only in TanStack Query, Authentication, company and permissions (Etapa 2), API client bound to tenant (Bearer + X-Tenant-Id, 401 retry), AuthGateway interface (Firebase Client SDK), Invitation acceptance flow (/convite), Session gate (pure routing decision function), Subscription states and blocked-access screens, Tenant cache isolation (['tenant', id, ...] query keys) (+1 more)

### Community 85 - "Config Jest"
Cohesion: 0.22
Nodes (9): jest, moduleNameMapper, modulePathIgnorePatterns, preset, setupFilesAfterEnv, testPathIgnorePatterns, transformIgnorePatterns, ^lucide-react-native$ (+1 more)

### Community 86 - "Regras Caveman"
Cohesion: 0.39
Nodes (7): Cline caveman rule, Copilot instructions (caveman), OpenCode AGENTS.md (caveman), Windsurf caveman rule, AGENTS.md (caveman rules), Auto-Clarity exception, Caveman modes (/caveman, /ultracave, /megacave)

### Community 87 - "Garantias Atômicas e Ledger"
Cohesion: 0.29
Nodes (7): F01 reconciliation cursor/checkpoint fix, Merkle membership proofs for financial sources, Inventory ledger with hash chain and movements, Paginated inventory reconciliation, Atomic order confirmation (reservations + receivables), E1 payment conditions and forms per company, E2 partial/full receipts with ledger and guard

### Community 88 - "Regras Agente Expo"
Cohesion: 0.25
Nodes (7): frontend AGENTS.md (Expo agent rules), Continuous Native Generation (no hand-edited ios/android), EAS build, submit and update, Expo Router navigation in src/app, frontend CLAUDE.md, Navigation destinations by role, Permissions from /me memberships (UI-only, backend authoritative)

### Community 89 - "Marca e Catálogo Público"
Cohesion: 0.32
Nodes (6): Responsive breakpoints compact/medium/expanded shared across web and native, Brand in the product, Official palette (Carvao, Grafite, Bege, Amarelo Lastro, Areia, Cinza), Provisional Wordmark and Symbol reconstructions, Anonymous public catalog at /catalogo/[slug], Quote preview and manual WhatsApp message with reviewToken

### Community 90 - "Testes Telas Etapa 7"
Cohesion: 0.25
Nodes (7): intentScope(), Choose(), FinanceProbe(), item, overrides, preview, profile

### Community 91 - "Validação F01/F02"
Cohesion: 0.38
Nodes (7): Current validation A-G with F01/F02 rounds, Validacao pos-auditoria F01 e projeto F02, F02 technical project (resumable resolution proposal), Remediation plan F03-F07, F01 corrected (523 tests), F02 implementation and local validation, Fixture cleanup retry on emulator Transaction lock timeout

### Community 92 - "Validação Fase F"
Cohesion: 0.33
Nodes (7): Private product images in Storage (re-encoded, no public token), Exact quantity arithmetic (UN integer, KG/L thousandths), Validation Phase F (public catalog, 423 tests), Catalog settings and slug registry, Public catalog by slug (no tenant/SKU/stock exposed), Public rate limiting and CORS without credentials, Transient quote preview and WhatsApp message with reviewToken

### Community 93 - "Overrides npm Backend"
Cohesion: 0.29
Nodes (7): uuid, overrides, basic-ftp, chokidar, gaxios, @google-cloud/pubsub, re2

### Community 94 - "Smoke Server"
Cohesion: 0.29
Nodes (5): address, child, env, listener, stopped

### Community 95 - "Config Vercel"
Cohesion: 0.29
Nodes (6): buildCommand, framework, installCommand, outputDirectory, rewrites, $schema

### Community 96 - "Runtime Node F06"
Cohesion: 0.40
Nodes (5): Riscos da implantacao real (artefato, TLS/proxy, IAM, Firestore), Correcao F06: Node 22.23.3 LTS, engines restrito, artefato com fontes (parcial), Plano posterior de correcao F03-F07, Plano F06: fixar LTS corrigido e validar artefato Linux, Gate de homologacao (IAM, TLS/proxy/CORS, backup, retencao, indices, custo)

### Community 97 - "Capacidade 20k Fontes"
Cohesion: 0.33
Nodes (5): 20,000-source structural capacity matrix (cancel and return), financialSourceSeed fixture generator, Pending 20,000 real HTTP receipts (homologation), F02 resolved locally (602 unique tests), Pending production controls (IAM, TLS, MFA, backups, SLOs)

### Community 98 - "Validação Pedidos A-D"
Cohesion: 0.33
Nodes (4): Execution locks, leases and fencing, Validation Phases A-D (223 tests, orders), Administrative discount approval and invalidation, Idempotency and concurrency races for orders

### Community 99 - "Check OpenAPI"
Cohesion: 0.33
Nodes (4): generated, saved, savedTypes, openapi-typescript

### Community 100 - "Config Metro"
Cohesion: 0.33
Nodes (3): config, { getDefaultConfig }, expo

### Community 101 - "Schema OpenAPI Frontend"
Cohesion: 0.33
Nodes (5): components, $defs, operations, paths, webhooks

### Community 102 - "Rate Limiting F03"
Cohesion: 0.60
Nodes (4): Correcao F03: limitador antes do JSON, cache de readiness, IPv6, allowlist de peers, Plano F03: limitador barato antes do parsing e readiness com cache, Fase F: catalogo publico controlado (DTO, cursor AES-GCM, preco oculto, wa.me), Rate limiting em memoria e contador Firestore por IP/janela

### Community 103 - "Índices Catálogo"
Cohesion: 0.40
Nodes (4): config, fields, index, path

### Community 104 - "tsconfig Build"
Cohesion: 0.40
Nodes (4): exclude, extends, include, ./tsconfig.json

### Community 105 - "Prettier Backend"
Cohesion: 0.50
Nodes (3): printWidth, singleQuote, trailingComma

### Community 106 - "Prettier Frontend"
Cohesion: 0.50
Nodes (3): printWidth, singleQuote, trailingComma

## Knowledge Gaps
- **82 isolated node(s):** `zod`, `@types/cors`, `@types/express`, `@types/fontkit`, `@types/node` (+77 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1118 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react-native` connect `UI Kit e Tema` to `Telas Financeiro Frontend`, `Movimentações de Estoque UI`, `Componentes Base e Erros UI`, `Navegação Expo Router`, `Sessão, Formulários e Convite`, `Editor de Pedidos`, `Ações de Pedido e Telas Admin`, `Telas de Listagem`, `Fake API de Testes Frontend`, `Gate de Sessão e Navegador`, `Fake Gateway Auth Testes`, `Acesso Financeiro Frontend`, `Deps Frontend (tooling)`, `Intent Ledger Durável`, `Ações de Arquivo Etapa 7`, `Testes Finance B`, `Exportações Frontend`, `Testes Telas Estoque`, `Testes Telas Etapa 7`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `zod`, `@types/cors`, `@types/express` to the rest of the system?**
  _82 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Kit e Tema` be split into smaller, more focused modules?**
  _Cohesion score 0.033285250631085464 - nodes in this community are weakly interconnected._
- **Why does `expo-router` connect `Navegação Expo Router` to `UI Kit e Tema`, `Gate de Sessão e Navegador`, `Telas Financeiro Frontend`, `Acesso Financeiro Frontend`, `Deps Frontend (tooling)`, `Movimentações de Estoque UI`, `Componentes Base e Erros UI`, `Fake Gateway Auth Testes`, `Testes Telas Estoque`, `Testes Finance B`, `Sessão, Formulários e Convite`, `Editor de Pedidos`, `Ações de Pedido e Telas Admin`, `Telas de Listagem`, `Telas de Resolução Financeira`, `Testes Telas Etapa 7`, `Fake API de Testes Frontend`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Should `Schemas e Erros Backend` be split into smaller, more focused modules?**
  _Cohesion score 0.05132119788608338 - nodes in this community are weakly interconnected._
- **Why does `requireCondition()` connect `Livro Financeiro e Devoluções` to `Schemas e Erros Backend`, `Visão Econômica`, `App Express e Proteção HTTP`, `Rotas, Auditoria e Atores`, `Rotas e Schemas de Pedidos`, `Hashes e Backfill Financeiro`, `Serviço de Estoque Backend`, `Fases de Resolução Financeira`, `Serviço de Pedidos`, `API de Execuções Financeiras`, `Catálogo e Orçamento Backend`, `Schemas Comerciais e Documentos`, `Modelo de Execução Financeira`, `Repositórios e Acesso`, `Provas e Publicação Financeira`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `Telas Financeiro Frontend` be split into smaller, more focused modules?**
  _Cohesion score 0.04709336465061656 - nodes in this community are weakly interconnected._