# Entrega G - backend local do MVP

Fase G concluída e validada em 9/10/2026, somente no backend local do Lastro. Pronto para auditoria geral e integração frontend, sem publicação produtiva. Evidências em [validação](validation-phase-g.md), [plano/implementação](phase-g.md) e [contrato frontend](api/frontend-contract.md).

## 1. Funcionalidades implementadas

PDF comercial A4 com emissor, pedido/data/status, cliente histórico, produtos/SKU/quantidade/unidade, preços/subtotais/descontos/totais históricos, condições/forma prevista/parcelas e observações. Exibe "Pedido comercial — não é documento fiscal". Não incorpora recebimentos, fontes de crédito ou saldo financeiro.

Romaneio A4 com pedido/cliente, geração, produtos/quantidades/unidades, conferência, observações manuais e recebedor/assinatura. Separa solicitada, expedida e fisicamente devolvida, incluindo danos recebidos. Intenção não é devolução física. Expedido é histórico, não nova autorização de expedição; cancelado não autoriza separação. Sem preços/condições/nota comercial livre ou financeiro. Sem prova automática de entrega.

CSV administrativo de clientes, produtos, pedidos e contas a receber; filtros/paginação, categoria por nome, preço cadastral atual do produto, valores históricos do pedido e saldo derivado validado do título. UTF-8/BOM, ponto e vírgula, CRLF, datas brasileiras e centavos formatados. Fórmulas neutralizadas.

## 2. Endpoints

Seis GET novos sob /api/v1. OpenAPI passa de 0.6.0/100 para 0.7.0/106 operações. Nenhuma rota administrativa redundante ou alteração de contrato comercial A-F.

| Caminho                              | Mídia           | Permissão                                   |
| ------------------------------------ | --------------- | ------------------------------------------- |
| orders/{id}/documents/commercial.pdf | application/pdf | documents:own:read + pedido/carteira atuais |
| orders/{id}/documents/packing.pdf    | application/pdf | documents:own:read + pedido/carteira atuais |
| exports/customers.csv                | text/csv        | reports:read                                |
| exports/products.csv                 | text/csv        | reports:read                                |
| exports/orders.csv                   | text/csv        | reports:read                                |
| exports/receivables.csv              | text/csv        | reports:read + receivables:read             |

GETs retornam bytes, sem envelope JSON. Erros continuam JSON seguro. Attachment com filename ASCII seguro, no-store/nosniff; CSV inclui X-Export-Row-Count e X-Next-Cursor. CORS privado autorizado expõe metadados. Imagens WebP existentes permanecem compatíveis.

## 3. Permissões

Administrador acessa documentos de sua empresa. Vendedor exige pedido próprio e cliente na carteira atual; transferência bloqueia vendedor anterior e não transfere pedido ao novo. Exportações são administrativas, inclusive clientes/produtos/pedidos; financeiro exige permissão própria. Super Admin sem vínculo não acessa comércio. Vínculo/identidade/assinatura são revalidados após renderização/exportação. Documento alterado durante geração retorna DOCUMENT_CHANGED, sem bytes antigos.

Plataforma conserva listagem/consulta de empresas, planos versionados, assinaturas/acesso, alterações com versão/motivo/auditoria e controle de vagas. Plano inicial continua duas vagas e proteção do último administrador ativo. Planos/contratos configuráveis anteriores não mudam silenciosamente. Sem cobrança automática ou novo privilégio empresarial.

## 4. Bibliotecas e modelo

PDFKit 0.20.2 gera PDF nativo Node, com medidas de texto/streams/fontes incorporadas, sem Chromium, HTML remoto ou Storage. fontkit 2.0.4 verifica glifos, recusando caracteres não suportados sem substituição silenciosa. Fontes Liberation Sans regular/bold com licença SIL OFL 1.1 acompanham assets/fonts.

Desenvolvimento: @types/pdfkit 0.17.6, @types/fontkit 2.0.9, pdfjs-dist 6.4.299 e @napi-rs/canvas 1.0.10. Leitura/rasterização verifica conteúdo, geometria e pixels; esses renderizadores não integram runtime produtivo. Referências primárias: [PDFKit](https://pdfkit.org/docs/getting_started.html), [fontkit](https://github.com/foliojs/fontkit).

Nenhuma coleção, migração, índice, permissão ou campo persistido de domínio novo. Downloads transitórios; rateLimits reutiliza bucket por UID/hora. Helper de leitura autorizada e tipo do guard ampliados sem alterar snapshots/formatos anteriores. Proposta de snapshots grandes não implementada.

## 5. Testes

**70 novos e 493 aprovados:** 31 G unitários + 39 G emulados, somados aos 423 A-F preservados. Total: 184 unitários em onze arquivos e 309 emulados em 23 arquivos. Zero falhas, pendentes ou TODO. Incremento emulado final: 105,287 segundos. Regressão integral final: 869,238 segundos, início 18:27:56 America/Sao_Paulo, saída zero.

TypeScript strict, lint, Prettier e build passaram. OpenAPI/tipos atualizados. Auditorias completa/runtime: zero vulnerabilidades conhecidas. Scanner local: findings=[]. Nenhum teste removido/desabilitado/enfraquecido. Emuladores encerrados ao concluir.

## 6. Regressão e recuperação

A-G validou centavos inteiros, ausência de mínimo comercial, reservas/estoque/recebíveis atômicos, carteira/perfis/tenant e compatibilidade D/E. Concorrência de 200 linhas produziu um vencedor completo (200/409) e replay 200/200 sem duplicação. Expedição/cancelamento, recebimento/cancelamento, crédito/estorno e recebimento físico/cancelamento de saldo preservaram invariantes.

Falhas após staging financeiro/físico e falhas de renderização não deixaram efeitos parciais; retry recuperou operações. Download repetido/falho não alterou pedido, estoque, recebível, fontes ou auditoria comercial. Duas gerações/exportações concorrentes são permitidas; terceira é recusada e capacidade é liberada depois, sem fila ilimitada. Cota de 30 downloads por usuário/hora testada.

## 7. Até 200 produtos

Ambos PDFs passaram com 1/20/50/100/200 produtos, nomes/SKU extensos e doze parcelas. Amostra final de 200: comercial 30 páginas/88.665 bytes; romaneio 21 páginas/73.700 bytes. Sem truncamento ou alteração de domínio. Romaneio de 200 expedidos após retorno parcial vendável/danificado preservou 198 unidades físicas pendentes na intenção.

Provas operacionais lidas em lotes de vinte dentro do mesmo snapshot, retendo somente quantidades. Teste confirmou vinte chamadas limitadas nas verificações antes/depois. Nome empresarial de 120 letras largas permanece acima do título. HTML/URL/sintaxe PDF são texto, sem ações JavaScript ou links executáveis. QA final: 54 páginas A4 renderizadas, sem páginas vazias/texto fora da área imprimível; imagens representativas inspecionadas.

## 8. Limitações técnicas

Pedido registra nome histórico do cliente, não endereço/documento histórico ou transportadora; documentos omitem esses campos, sem usar cadastro atual como histórico. Nome empresarial é emissor atual. Data do pedido é UTC identificado; vencimentos preservam calendário registrado. Romaneio exclui observação comercial livre, pois pode conter informação financeira.

PDF: 8 MiB/100 páginas/dez segundos cooperativos e duas gerações por instância. Blocos fora da composição imprimível recusados integralmente. Fonte não cobre todo CJK/emoji: DOCUMENT_UNSUPPORTED_TEXT. CSV: 1 MiB/página, 100 clientes/produtos ou dez pedidos/títulos, duas exportações e 30 segundos cooperativos. Consultas SDK já enviadas não têm cancelamento duro. Cota fixa compartilhada: 30 por UID/hora, sem aumento por troca de tenant.

CSV não é snapshot global entre páginas. Consolidação exige parser/stream correto, um BOM/cabeçalho e células multilinha preservadas. Importar CPF/CNPJ/CEP/telefone como texto na planilha para preservar zeros; não remover proteção de fórmulas. Emulação não comprova SLO, cem usuários, custo ou memória p95/p99. Bytes compartilhados fora do app não são revogáveis.

## 9. Arquivos e contratos

Novos: src/modules/documents/{download,csv,pdfRenderer,documentService,exportService}.ts; src/shared/schemas/documents.ts; src/app/documentRoutes.ts; assets/fonts/{LiberationSans-Regular.ttf,LiberationSans-Bold.ttf,LICENSE_LIBERATION}; scripts/validate-document-pdfs.mjs; tests/helpers/documents.ts; tests/unit/documents.test.ts; tests/integration/{documents,exports}.test.ts; docs/{phase-g,validation-phase-g,phase-g-delivery}.md.

Atualizados: src/app/{app,routes}.ts, src/modules/auth/openapi.ts, src/modules/orders/orderService.ts, src/modules/returns/returnService.ts, src/middlewares/rateLimit.ts, package.json/package-lock.json, README.md, docs/validation.md, docs/security.md, docs/architecture/{foundation,permissions,data-model}.md e docs/api/{openapi.json,generated-types.ts,frontend-contract.md}.

Contrato Claude: Bearer/X-Tenant-Id, mídias binárias, filenames seguros, filtros/cursor/metadados, limites/erros, Blob Web e arquivo temporário/compartilhamento React Native/Expo. Nenhum frontend alterado. Fontes devem acompanhar distribuição compilada. Reports são amostras/evidência local sintética, não armazenamento comercial permanente.

## 10. Auditoria final pendente

Revisão geral de autorização/BOLA, IAM mínimo/MFA, segredos/TLS/ingress, índices produtivos, retenção/TTL, backups/restauração consistente, carga/latência/memória/custo, leitores/compartilhamento Android/iOS/Web e política de arquivos locais. Auditoria de dependências e scanner por assinatura não substituem auditoria de segurança ou testes produtivos. Nenhuma ação produtiva executada nesta fase.

Sem deploy, commit, push, Firebase produtivo, serviços pagos, gateway/boletos/fiscal, envio automático de WhatsApp ou alteração da Atual Pet/outros projetos.
