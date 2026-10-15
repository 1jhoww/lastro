# Fase G - Documentos, exportacoes e administracao

## Plano tecnico

Escopo exclusivo do backend local. Nenhum deploy, commit, push, acesso produtivo ou recurso pago. A base validada A-F possui 423 testes e OpenAPI 0.6.0 com 100 operacoes.

1. Reutilizar o registro de rotas, autenticacao Firebase, AccessService, OrderService e leitores financeiros. Adicionar seis downloads privados, sem URLs publicas ou armazenamento permanente.
2. Gerar PDFs A4 com PDFKit (Node, sem navegador), fontes Liberation Sans incorporadas e licenciadas. Renderizar fora de transacoes; limitar bytes, paginas, tempo e concorrencia. Revalidar autorizacao e versoes antes da entrega.
3. Pedido comercial utiliza somente snapshots de linhas, valores, desconto, cliente e condicoes. Distribuidora usa nome empresarial atual identificado como emissor. O modelo nao guarda endereco/documento historico de cliente nem transportadora: omitir esses campos, sem inventar ou substituir silenciosamente pelo cadastro atual. Rascunho incompleto permanece identificavel.
4. Romaneio usa estados operacionais reais: separacao para draft/confirmed, historico de expedicao para dispatched, historico cancelado para canceled. Quantidades solicitadas, expedidas e fisicamente devolvidas sao separadas. Intencao nao equivale a recebimento. Reutilizar comprovacao de reservas e guards de devolucao; nunca incluir valores financeiros.
5. CSV administrativo usa reports:read; contas a receber tambem exige receivables:read. Cada download corresponde a uma pagina limitada dos leitores existentes, com cursor assinado em X-Next-Cursor. Nao carregar colecoes inteiras. Manter filtros existentes e documentar paginas vazias com continuacao.
6. CSV UTF-8 com BOM, ponto e virgula, CRLF, campos entre aspas, datas brasileiras e valores decimais com virgula. Neutralizar formulas e controles. Projecoes explicitas excluem autoria, segredos, caminhos internos e saldos nao autorizados.
7. Plataforma existente ja lista empresas/planos/assinaturas e gerencia contratos com motivo, versao, auditoria e capacidade transacional. Validar sem duplicar endpoints. Plano inicial continua duas vagas; planos e contratos configuraveis anteriores permanecem compativeis. Ultimo administrador ativo permanece protegido.
8. Validar incremento unitario e emuladores, PDFs 1/20/50/100/200 produtos, estados/retornos/historico, permissoes/revogacao, CSV e falhas sem efeitos. Inspecionar PDFs renderizados. Executar regressao completa e checks antes da entrega.

## Contratos implementados

- GET /api/v1/orders/{id}/documents/commercial.pdf - documents:own:read, mais acesso atual ao pedido/carteira.
- GET /api/v1/orders/{id}/documents/packing.pdf - mesma autorizacao, sem financeiro.
- GET /api/v1/exports/customers.csv - reports:read, filtros de customers.
- GET /api/v1/exports/products.csv - reports:read, filtros de products.
- GET /api/v1/exports/orders.csv - reports:read, filtros de orders.
- GET /api/v1/exports/receivables.csv - reports:read + receivables:read, filtros de receivables.

Super Admin sem vinculo empresarial nao possui acesso. Exportacoes sao administrativas conforme escopo aprovado; vendedor usa apenas documentos de seus pedidos e carteira atual. Downloads repetidos nao mudam dominio comercial. Contadores antiabuso sao independentes.

## Biblioteca

PDFKit suporta streams Node, medidas de texto, quebras de pagina e fontes TrueType incorporadas. Evita Chromium, HTML remoto e Storage. Referencias primarias: https://pdfkit.org/docs/getting_started.html e https://pdfkit.org/docs/text.html. Fonte Liberation Sans usa SIL Open Font License 1.1; arquivos e licenca acompanham backend. Nao depende de fontes instaladas no host.

Runtime: PDFKit 0.20.2 e fontkit 2.0.4. fontkit já integra PDFKit, mas recebe dependência explícita para verificar cobertura de glifos. Caractere não suportado retorna DOCUMENT_UNSUPPORTED_TEXT (422), sem quadrados vazios ou perda silenciosa de informação. Fonte cobre português acentuado, latim, grego e cirílico; não há promessa universal de CJK/emoji. Controles invisíveis de formatação/bidi são neutralizados. Desenvolvimento: @types/pdfkit, @types/fontkit, pdfjs-dist 6.4.299 e @napi-rs/canvas para leitura/rasterização/QA real, sem dependência desses renderizadores na execução produtiva.

## Implementação

DocumentService lê snapshot autorizado em transação readOnly, usando autorização de pedido existente e fonte de expedição comprovada. Provas de retorno são processadas em lotes de vinte linhas dentro do mesmo snapshot; cache de eventos é liberado entre lotes e somente quantidades físicas ficam na projeção. Nenhum limite comercial ou snapshot persistido é alterado. PdfRenderer mede texto, quebra nomes/SKU, repete cabeçalho/colunas e pagina sem altura fixa que corte conteúdo. Renderização ocorre fora da transação. Nova leitura de acesso/pedido/retorno impede entregar snapshot alterado durante geração; DOCUMENT_CHANGED exige recarga.

Pedido comercial usa nome histórico do cliente, linhas históricas, preço unitário/subtotal/desconto/total e parcelas registradas, sem diário/saldo/fontes financeiras. Nome da empresa é identificação atual do emissor; o modelo anterior não guarda snapshot desse nome. Data do pedido é calendário UTC registrado, explicitamente identificado; emissão usa fuso atual. Não acrescentar endereço atual do cliente como se fosse histórico. Observações comerciais aparecem somente no pedido, não no romaneio, pois texto livre pode conter dados financeiros. Romaneio oferece espaço manual de conferência, observações e recebedor, sem alegar recebimento efetivo.

Romaneio de draft/confirmed representa separação ainda não expedida. canceled mostra histórico cancelado e proíbe separação/expedição. dispatched mostra expedição original e quantidade fisicamente recebida em retorno, incluindo dano. Uma intenção pendente não aumenta devolvido; valor aceito/rejeitado e destino financeiro não aparecem. Guard cumulativo/evidência original são reutilizados sem carregar diário financeiro. Não há recomposição de disponibilidade para nova expedição.

ExportService usa leitores de clientes/produtos/pedidos/títulos existentes. CSV administrativo mantém projeções explícitas, fontes históricas do pedido e saldo derivado validado de D/E. Produto exporta categoria por nome atual e preço atual cadastrado. Não há query collectionGroup, varredura global, contagem global ou carregamento de coleção inteira.

## Limites e paginação

| Recurso               | Limite por arquivo               | Tempo                                   | Concorrência local |
| --------------------- | -------------------------------- | --------------------------------------- | ------------------ |
| PDF                   | 8 MiB / 100 páginas              | 10 segundos de renderização cooperativa | 2                  |
| CSV clientes/produtos | 100 registros / 1 MiB; 25 padrão | 30 segundos cooperativos                | 2 exportações      |
| CSV pedidos/títulos   | 10 registros / 1 MiB; 10 padrão  | 30 segundos cooperativos                | 2 exportações      |

Leitores consultam limit+1 candidatos. Limite menor de pedidos/títulos limita snapshots de origem em memória, não linhas de pedido. Cota fixa compartilhada PDF/CSV: 30 por UID/hora, incluindo tentativas autorizadas; trocar tenant não amplia cota. Instâncias independentes compartilham cota via rateLimits, mas semáforo de geração é local. Sem fila persistente.

Orçamento cooperativo não cancela consulta Firestore já enviada; SDK conserva seus próprios timeouts. PDF cede event loop a cada vinte linhas e verifica orçamento entre blocos. Arquivo inteiro é recusado em excesso/falha; nenhum byte comercial parcial é enviado. Não alegar benchmark de produção ou memória constante independente do tamanho dos snapshots: consumo é limitado por páginas/candidatos/bytes e quantidade concorrente.

CSV entrega uma página por download, incluindo BOM e cabeçalho. X-Next-Cursor indica continuação; X-Export-Row-Count conta registros. Continuar mesmo com zero registros e cursor. Filtros/direção/defaults são os leitores correspondentes; detalhes em [contrato frontend](api/frontend-contract.md). Cursores pertencem a ator/tenant/filtros. Não há snapshot único entre páginas; edição concorrente pode mudar relatório. Cliente deve usar parser/stream correto ao consolidar, preservando apenas um BOM/cabeçalho e células multilinha. Preferir páginas individuais quando consolidação não existir.

CSV usa UTF-8/BOM, ponto e vírgula, CRLF, aspas duplicadas, datas DD/MM/AAAA e BRL decimal com vírgula. Neutralização de fórmulas ocorre depois de remover controles invisíveis; apóstrofo protege =,+,-,@ após whitespace/controles iniciais. Frontend não deve remover essa proteção. Não há exportação contábil, fiscal ou bancária.

## Administração validada sem duplicação

Operações anteriores: GET/POST admin/tenants, POST admin/tenants/{id}/owner-invitations, GET/POST admin/plans, PATCH admin/plans/{id}, GET admin/subscriptions, PATCH admin/subscriptions/{id}. Listagens paginadas já incluem os dados de consulta autorizada; nenhum endpoint redundante adicionado. Plano inicial permanece duas vagas. Modelos configuráveis 2..100 e contratos especiais anteriores permanecem válidos, sem rebaixamento silencioso.

Planos têm versões imutáveis, assinatura conserva preço/limite contratado, alteração exige versão/motivo e grava auditoria. Suspensão/cancelamento bloqueiam acesso empresarial; canceled permanece terminal. Admissão considera vínculos ativos e convites pendentes válidos. Primeiro aceite ativa empresa; último administrador ativo é protegido. Plataforma não herda vínculo empresarial. Sem gateway, cobrança recorrente, boleto ou movimento bancário automático.

## Modelo, arquivos e integração

Nenhuma migração, coleção/índice/permissão nova ou mudança nos snapshots grandes. Bucket/Rules/rotas públicas e contratos A-F preservados. Reutilização técnica de snapshot de pedido e tipo do guard não altera formato persistido. PDF/CSV não gravam auditoria comercial; somente contadores antiabuso e logs HTTP existentes operam fora do domínio. Auditoria das mutações administrativas permanece transacional.

Código novo: src/modules/documents/{download,csv,pdfRenderer,documentService,exportService}.ts, src/shared/schemas/documents.ts e src/app/documentRoutes.ts. Registro/resposta binária/CORS/OpenAPI foram ampliados sem alterar imagens existentes. assets/fonts contém duas fontes TTF e licença. scripts/validate-document-pdfs.mjs lê e rasteriza amostras reais; resultados ficam em reports, sem documento permanente de cliente.

Contrato frontend registra mídia, filtros, erros, limites, Bearer/X-Tenant-Id, Blob Web e arquivo temporário/compartilhamento React Native/Expo. Não há implementação frontend nesta fase. PDFs privados nunca usam URL pública permanente. Referências oficiais de consumo estão no contrato, sem impor versão do SDK do frontend.

## Estado

Implementação local concluída e validada em 9/10/2026: 493 testes aprovados, 70 novos, zero falhas. Regressão A-G integral e checks aprovados. OpenAPI 0.7.0 com 106 operações. Evidências, reprodução e limites em [validação G](validation-phase-g.md); dez itens de entrega em [relatório G](phase-g-delivery.md). Pronto para auditoria geral e integração, ainda sem publicação ou homologação produtiva.
