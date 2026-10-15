# Validação G - execução local

Data: 9/10/2026, America/Sao_Paulo. Escopo somente backend, sem deploy/commit/push/produção/recursos pagos. Baseline A-F: 423 testes, sem remoção/desabilitação/enfraquecimento.

## Estado da execução

**493 testes aprovados, zero falhas, pendentes ou TODO:** 184 unitários em onze arquivos e 309 emulados em 23 arquivos. G acrescenta 70 testes (31 unitários e 39 emulados); os 423 A-F foram preservados. Nenhum teste removido, desabilitado ou enfraquecido.

Unitários finais: início 9/10/2026 18:20:26, duração 5,379 segundos. Incremento emulado G final: 39 testes em dois arquivos, início 18:20:49, duração 105,287 segundos. Regressão emulada integral com código final: início 18:27:56, duração 869,238 segundos, saída zero. Execução integral anterior também passou em 995,17 segundos; após ajustes de memória/layout, incremento e suíte integral foram executados novamente, sem reutilizar resultado anterior como prova final.

TypeScript strict, lint, formatação e build passaram. OpenAPI 3.1/0.7.0 contém 106 operações, incluindo seis downloads privados; sete rotas públicas F preservadas. Tipos TypeScript foram regenerados. Auditoria de dependências completa/runtime reportou zero vulnerabilidades; scanner local de assinaturas reportou findings=[]. Build compilado carregou renderizador e fontes locais corretamente. Emuladores foram encerrados pelo runner após saída zero.

## Cobertura G

- PDFs reais 1/20/50/100/200 produtos, nomes/SKU extensos, português acentuado, rodapé/cabeçalho, múltiplas páginas e valores/condições históricos.
- Estados draft/confirmed/dispatched/canceled, retorno parcial/integral/danificado e intenção sem quantidade fisicamente recebida.
- Romaneio de 200 produtos expedidos com retorno físico parcial, um vendável e um danificado, mais 198 pendentes. Sem campo monetário ou nova autorização de expedição.
- Projeção comercial sem recebimentos/créditos adicionais; romaneio sem nota comercial que possa conter valores livres.
- Tenant, carteira, vendedor/admin/plataforma, revogação após renderização/exportação e mudança concorrente de pedido.
- CSV de 230 clientes em três páginas limitadas, categorias, dados históricos, saldo financeiro derivado, filtros/cursor inválido ou de outro contexto.
- Fórmulas CSV, controles invisíveis, BOM/CRLF/aspas/células multilinha, bytes/páginas/tempo, duas operações concorrentes e cota compartilhada de downloads.
- Falha de PDF seguida de recuperação, nenhum pedido/reserva/estoque/financeiro/auditoria comercial alterado em geração/repetição/falha.
- Administração existente: duas vagas iniciais, plano versionado, assinatura histórica, auditoria e isolamento de dados empresariais.

## QA de documentos

scripts/validate-document-pdfs.mjs lê cinco PDFs reais e renderiza todas as páginas com PDF.js/@napi-rs/canvas. Verifica A4, texto dentro da área imprimível, rodapé/empresa e pixels não vazios. Salva imagens de primeira/meio/última página para inspeção visual. Amostras finais: comercial de 200 itens (30 páginas, 88.665 bytes), romaneio de 200 (21 páginas, 73.700 bytes), dois documentos acentuados (uma página cada) e nome empresarial com 120 letras largas (uma página), total 54 páginas. Cabeçalho longo foi testado primeiro com falha de sobreposição e corrigido com medidas dinâmicas, mantendo a asserção de geometria.

No teste de 200 produtos expedidos com retorno físico parcial/dano, leitura de provas executou vinte lotes de até vinte linhas nas duas verificações do documento, dentro de snapshots readOnly, sem reter todos os eventos de origem. Devoluções físicas parciais/integral/danificadas preservaram domínio durante download. CSV de 230 clientes retornou três páginas e nenhum campo interno.

Concorrência final: dois pedidos de 200 linhas disputaram estoque e produziram 200/409 em 4.395 ms; replay concorrente produziu 200/200 em 3.847 ms sem duplicação. Expedição versus cancelamento, crédito versus estorno, recebimento versus cancelamento e físico versus cancelamento de saldo mantiveram invariantes. Falhas injetadas seguidas de retry recuperaram pedidos/estoque/recebíveis/guard/diário/auditoria sem efeitos parciais. Fonte financeira de 200 produtos retornou físico em 2.104 ms e resolução em 2.074 ms; essas amostras locais não são SLOs.

Inspeção visual: margens, quebras de nomes/SKU, colunas numéricas, texto acentuado, campo de recebedor e rodapés sem sobreposição. Poppler sequencial e PDFium renderizaram página intermediária com cabeçalho completo, conferido também por PDF.js. Invocação isolada do Poppler local a partir de página posterior apresentou omissões visuais; não usar essa invocação como evidência única. Texto/provas e rasterização independente demonstraram presença no PDF. Dispositivos Android/iOS e leitores produtivos ainda precisam de homologação.

## Reprodução

Executar na pasta backend, com Node 22.16.0/Java 21 usados nesta validação. TEMP/TMP locais evitam falha de arquivo temporário/sockets no Windows. Runner recusa Firebase real e usa exclusivamente demo-lastro-tests/127.0.0.1.

```powershell
$env:TEMP = Join-Path $PWD '.local'
$env:TMP = $env:TEMP
pwsh -File scripts/npm.ps1 run test -- --reporter=default --reporter=json --outputFile=reports/unit-tests.raw.json
node scripts/emulators.mjs test tests/integration/documents.test.ts tests/integration/exports.test.ts
node scripts/emulators.mjs test
node scripts/validate-document-pdfs.mjs
pwsh -File scripts/npm.ps1 run typecheck
pwsh -File scripts/npm.ps1 run lint
pwsh -File scripts/npm.ps1 run format:check
pwsh -File scripts/npm.ps1 run build
pwsh -File scripts/npm.ps1 run openapi
pwsh -File scripts/npm.ps1 run types:api
pwsh -File scripts/npm.ps1 audit --cache .cache/npm
pwsh -File scripts/npm.ps1 audit --omit=dev --cache .cache/npm
pwsh -File scripts/npm.ps1 run audit:secrets
```

Reports gerados são evidência local, não documentos permanentes de clientes: unit-tests.raw.json, emulator-tests.raw.json, phase-g-incremental-tests.raw.json, document-pdf-validation.raw.json e reports/pdf. Não dependem de bucket. Logs INTERNAL_ERROR de falhas injetadas são esperados; aprovação depende das asserções de rollback e status da suíte, não de ocultar logs.

## Limites da evidência

Emulação não comprova p95/p99, 100 usuários, custo, índices implantados ou backups produtivos. Cleanup de fixtures pode aguardar lock residual de transações abortadas, com retries do helper anterior somente na limpeza, nunca nas asserções. Fontes não cobrem todos os scripts; caractere sem glifo é recusado, sem alteração de dado histórico. Endereço/documento histórico de cliente não existe no snapshot anterior. CSV não tem snapshot global entre páginas. Orçamento de tempo é cooperativo; consulta SDK já enviada não tem cancelamento duro. Retenção/TTL, infraestrutura/IAM/TLS/MFA, recuperação produtiva, SDK mobile/compartilhamento e homologação de leitores pertencem à auditoria/integracão, sem configurar produção nesta fase.
