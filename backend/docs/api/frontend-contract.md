# Integração do frontend futuro

Contrato vigente local: OpenAPI 0.9.0, 131 operações, Fases A–G, endpoints opt-in F02 e administração de planos, assinaturas e cobranças. Seções D descrevem o fluxo histórico; financeiro/retornos E usam comandos próprios. Tipos para integração do frontend estão em generated-types.ts. A validação estrutural final F02 está registrada em [validation-f02](../validation-f02.md).

## Planos, assinaturas e cobranças (0.9.0)

Mudanças incompatíveis para o painel Super Admin: `POST/PATCH /admin/plans` e `PATCH /admin/subscriptions/{id}` foram removidos. `POST /admin/tenants` não aceita mais `planId`: envia `planCode` (`essencial|profissional`), `billingDay` (1–28), `billingStartsOn` (AAAA-MM-DD, hoje até +1 ano em America/Sao_Paulo) e, opcionalmente, `monthlyPriceCents` (padrão: preço de referência), `billingContact` e `commercialNotes`. O token do convite inicial continua sendo devolvido como antes, e convites já emitidos continuam válidos.

Empresa (todas as rotas privadas): `/me` devolve em cada vínculo `plan {code, name, userLimit, features}` e as `permissions` já filtradas pelo plano. Use `features` para explicar ações indisponíveis ("disponível no Profissional"); a autorização final é do servidor (`FEATURE_NOT_IN_PLAN`, 403). `GET /users` devolve `capacity {userLimit, activeUsers, reservedInvitations, available}`, e membros e convites têm `seatExempt` (acesso de suporte Lastro, sem ocupar vaga). Esconda "Convidar" quando `users.invite` estiver ausente ou `available` for 0. `USER_LIMIT_REACHED` continua sendo a recusa por capacidade. `CUSTOMER_ADMIN_REQUIRED` (409) recusa o Super Admin como primeiro administrador.

Super Admin (todas exigem login recente, como as demais rotas `/admin`):

- `GET /admin/overview`: indicadores e próximos vencimentos. `mrrCents` é a receita contratada dos contratos ativos; `receivedThisMonthCents` é a soma dos pagamentos registrados no mês. Não somar um ao outro.
- `GET /admin/companies?q&planCode=essencial|profissional|legacy&status&attention=overdue|open` e `GET /admin/companies/{id}`: empresas, assinatura, próximo vencimento, vagas, contato, cobranças em aberto, usuários (nome/e-mail do provedor), convites e vitrine. Nenhum dado comercial da empresa.
- `GET /admin/plan-catalog`; `GET /admin/subscriptions/{id}/plan-change?planCode` (prévia de vagas excedentes e recursos perdidos); `POST /admin/subscriptions/{id}/plan` `{expectedVersion, planCode, monthlyPriceCents?, acknowledgedLostFeatures, reason}`.
- `POST /admin/subscriptions/{id}/activate|terms|suspend|reactivate` com `expectedVersion` e `reason`; `GET /admin/subscriptions/{id}/history`.
- `GET /admin/charges?situation=all|open|overdue|due_soon|paid|canceled&tenantId&limit&cursor`; `POST /admin/charges` (competência manual, `CHARGE_EXISTS` 409); `POST /admin/charges/generate`; `POST /admin/charges/{id}/pay|correct|cancel`; `GET /admin/charges/{id}/history`. `situation` é derivada (vencida, vence em até 5 dias) e só serve para alerta.
- `GET /admin/invitations` (empresas aguardando o primeiro administrador, com o link vigente quando houver) e `POST /admin/companies/{id}/invitations/{invitationId}/revoke` `{reason}`.

Todo comando com `expectedVersion` responde 409 `CONFLICT` quando a versão está desatualizada: recarregue e peça nova confirmação. Downgrade: `USER_LIMIT_REACHED` (libere vagas antes) e `FEATURE_LOSS_UNCONFIRMED` (confirme os recursos da prévia). Regras de vigência em [ADR 0010](../adr/0010-cobranca-manual-e-vigencia.md).

## F02 - execuções financeiras retomáveis

F02 validado localmente: 602 testes únicos e cancelamento/devolução de 20.000 fontes diretas aprovados. Usar [contrato específico](financial-executions.md) para início, avanço, consulta, retomada, abort e reconciliação. POST 202 não é conclusão financeira. Somente `financialCompleted=true`, `status=COMPLETED`, resultado e `publishedAt` confirmam publicação. PDFs/CSVs relacionados a pedido em processamento recusam download conflitante. Reembolso permanece manual. Não ler documentos Firestore preparados pelo frontend. Contadores são técnicos e uma execução financeira concluída pode deixar bloqueio físico da intenção. Não há worker automático: o cliente/admin deve continuar e retomar o workflow.

F07 diferencia entrada e saída: `schedule[].weight` continua opcional na entrada e passa a obrigatório nas respostas, como o servidor já materializa. SKU, UF e CEP têm schemas de saída normalizada. Não houve mudança silenciosa no formato HTTP financeiro. Retenção/TTL e artefato Linux permanecem dependências externas descritas em [operação F03–F07](../operations-f03-f07.md); consultar o relatório consolidado para o resultado da regressão local.

Ao receber 503 `REQUEST_OUTCOME_UNKNOWN`, não inferir rollback: consultar estado e repetir a mesma chave/corpo de comando. Chaves administrativas de plataforma têm replay por 30 dias, depois 410 `IDEMPOTENCY_EXPIRED`, mantendo a chave contra reaplicação. Idempotências financeiras continuam com retenção e replay anteriores. Listagens/documentos podem receber 413 `READ_MEMORY_LIMIT`: reduzir `limit`, reiniciar paginação com os mesmos filtros e continuar pelo novo cursor. Nenhum pedido foi limitado comercialmente.

## Fase G - downloads privados

GET orders/{id}/documents/commercial.pdf e packing.pdf retornam bytes application/pdf, sem envelope JSON. Ambos exigem Bearer Firebase e X-Tenant-Id. Administrador acessa pedidos da empresa; vendedor exige pedido próprio e cliente na carteira atual. Super Admin sem vínculo não acessa. Usar permissão documents:own:read do /me para exibir ação; autorização final pertence ao servidor.

Comercial contém snapshots de cliente/nome, produtos/SKU/quantidade/unidade, valores/descontos e condições/parcelas históricas. Não contém saldos recebidos, fontes de crédito ou diário financeiro. Nome empresarial identifica emissor atual; data do pedido usa calendário UTC identificado no PDF, preservando determinismo sem inventar fuso histórico. Emissão usa fuso atual da empresa. Modelo não guarda endereço/documento histórico do cliente ou transportadora: não substituir por cadastro atual nem adicionar dados pelo frontend.

Romaneio separa solicitada, expedida e devolvida física. Pretensão não é recebimento; danificado recebido conta como devolução física, nunca estoque disponível. Pedido expedido gera histórico, não autorização de nova expedição. Pedido cancelado não autoriza separação. Nenhum valor, condição/forma de pagamento, desconto ou observação comercial potencialmente financeira entra no romaneio; campo de observações da conferência e recebedor permanece preenchível manualmente. PDF não é fiscal ou prova automática de entrega.

GET exports/customers.csv, products.csv e orders.csv exigem reports:read (administrador). GET exports/receivables.csv também exige receivables:read. Vendedor não exporta; não reutilizar URL de administrador. CSV UTF-8/BOM, delimitador ponto e vírgula, CRLF, campos entre aspas e aspas duplicadas. Valores BRL usam vírgula decimal, sem conversão de centavos pelo frontend. Datas DD/MM/AAAA; data do pedido é UTC, vencimento preserva calendário registrado. Status usa enum do domínio. Prefixo apóstrofo neutraliza fórmulas; não removê-lo antes de abrir planilha.

Cada resposta CSV representa somente uma página. X-Export-Row-Count conta registros, sem cabeçalho. X-Next-Cursor aparece quando há continuação; repetir exatamente filtros e limit. Página vazia pode ter cursor, especialmente títulos filtrados por situação/cliente. Nunca concluir exportação somente porque veio vazia. Não há snapshot global entre páginas; alterações concorrentes podem mudar relatório. Para arquivo consolidado, frontend deve preservar um único BOM/cabeçalho e concatenar CSV com parser/stream apropriado, não dividir linhas ingenuamente: células podem conter quebras de linha. Oferecer páginas individuais é contrato suportado sem consolidação.

Filtros:

- Clientes: limit 1..100 (25 padrão), cursor, status active/inactive/all (active padrão), q prefixo normalizado até 80 caracteres, sort name/createdAt, direction asc/desc, assignedTo UID/unassigned.
- Produtos: mesmos filtros, sem assignedTo; acrescenta categoryId, sku e catalogVisible true/false.
- Pedidos: limit 1..10 (10 padrão), cursor, status draft/confirmed/dispatched/canceled, customerId e direction asc/desc (desc padrão); ordenação createdAt. Dados históricos, sem linhas/snapshots internos na exportação.
- Recebíveis: limit 1..10 (10 padrão), cursor, orderId, customerId, status open/partially_paid/paid/canceled/zero e from/to YYYY-MM-DD inclusivos por vencimento. from deve ser menor ou igual a to. Ordenação vencimento e ID; saldo vem de projeção financeira validada, inclusive legado D.

Downloads usam Content-Disposition attachment com filename ASCII seguro, Cache-Control private,no-store e nosniff. CORS privado autorizado expõe Content-Disposition, X-Next-Cursor, X-Export-Row-Count e X-Request-Id. Não enviar token no URL, abrir endpoint privado em iframe/link desautenticado ou criar URL permanente pública. Não registrar documentos/tokens em analytics, logs ou cache compartilhado.

Erros mantêm application/json e envelope error existente. Verificar status/Content-Type antes de ler bytes; nunca salvar erro JSON como PDF. 401 pede renovação/login; 403 nega vínculo/permissão/assinatura; 404 não revela outra carteira; DOCUMENT_CHANGED (409) exige recarregar pedido. DOCUMENT_SIZE_LIMIT/PAGE_LIMIT/TIME_LIMIT/LAYOUT_LIMIT e EXPORT_SIZE_LIMIT/TIME_LIMIT (413) recusam arquivo inteiro, sem alterar domínio. DOCUMENT_UNSUPPORTED_TEXT (422) indica caractere sem glifo na fonte incorporada; não há substituição silenciosa ou promessa de emoji/CJK. DOCUMENT_BUSY/EXPORT_BUSY (429) pede espera curta; RATE_LIMITED respeita Retry-After. Dados incompatíveis geram erro de integridade, sem reparo silencioso.

Limites técnicos: PDF até 8 MiB, 100 páginas e dez segundos de renderização cooperativa. PDF e CSV compartilham duas operações simultâneas por instância e prazo total de 30 segundos, incluindo leituras e revalidação. CSV conserva 1 MiB por página. RPC Firestore já enviada não recebe cancelamento físico; sua vaga permanece ocupada até terminar mesmo depois de timeout/desconexão. Orçamento acumulado de leitura: 32 MiB estimados com margem 2x, não teto de RSS. Cota compartilhada de PDFs/CSVs: 30 downloads por usuário/hora, sem ampliação por troca de tenant. Contadores antiabuso não modificam pedidos/estoque/financeiro. Sem fila persistente ou armazenamento de PDFs.

### Web

Obter ID Token atual e chamar fetch na origem confiável da API com Authorization: Bearer e X-Tenant-Id, cache: no-store. Confirmar response.ok e Content-Type; depois usar response.blob(), URL.createObjectURL, link download com nome validado de Content-Disposition e URL.revokeObjectURL após uso. Nunca usar innerHTML para campos. Manter headers de paginação antes de consumir corpo. AbortController interrompe espera do cliente, não garante cancelamento de leitura já iniciada no backend.

### React Native / Expo

Usar API compatível com SDK do frontend, sem alterar esse projeto nesta fase. expo/fetch fornece resposta binária; validar status e mídia, gravar bytes em File(Paths.cache, nome-seguro) e compartilhar URI local com expo-sharing após isAvailableAsync. Expo FileSystem também oferece download autenticado com headers; validar comportamento de erros/arquivos parciais da versão usada. Apagar temporários após compartilhamento/logout/troca de empresa; arquivo já compartilhado fora do app não pode ser revogado pelo backend. Web usa fluxo Blob, não URI local nativa. Sem Expo, usar adaptador nativo autorizado que preserve headers e bytes, nunca base64 em JSON da API.

Referências oficiais verificadas para integração, sem instalar dependências no frontend: [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/), [Expo Sharing](https://docs.expo.dev/versions/latest/sdk/sharing/). Recursos nativos precisam de teste real Android/iOS/Web antes da integração final; backend não valida permissões do sistema operacional.

## Fase F — administração

GET /catalog-settings retorna {catalog:null} antes da configuração. PUT /catalog-settings exige administrador catalog:manage, Bearer, X-Tenant-Id e UUID Idempotency-Key. Body completo: {expectedVersion,slug,enabled,tradeName,description,whatsappNumber,showPrices}. Usar expectedVersion=0 inicialmente; demais atualizações usam version da última resposta. Slug lowercase ASCII 3..63, letras/dígitos/hífens, começa com letra e não termina com hífen. WhatsApp usa telefone internacional somente dígitos, 8..15, começando diferente de zero. Não enviar URL, mensagem, tenant ou autoria. Alteração de slug mantém reserva dos anteriores; CATALOG_SLUG_UNAVAILABLE (409) exige outro identificador. Replay conserva resposta original e relê autorização.

Selecionar produtos por catalogVisible nas rotas B existentes, com versão administrativa do produto. Catálogo habilitado publica somente ativos selecionados. Não há produto duplicado ou seleção pelo visitante. Configuração não concede permissão de alterar preços ou estoque a outro perfil.

## Fase F — visitante

Base /api/v1/public/catalogs/{slug}; não enviar Bearer/X-Tenant-Id nem acessar Firebase diretamente. GET base fornece empresa pública; GET products fornece id/name/description/unit/quantityPrecision/category/unitPriceCents/imagePath. GET products/{id} detalha produto. GET categories contém somente categorias ativas com produtos publicados. Produto de categoria inativa pode aparecer sem categoria. ID opaco de produto/categoria serve somente à seleção/filtro; não representa autorização.

Listas: limit 1..50 (padrão 25), cursor e q como prefixo normalizado de nome; products também aceita categoryId. Cursor é opaco, cifrado e ligado a slug/configuração/filtros. Página vazia pode ter nextCursor; continuar paginação. Mudança de configuração/cursor removido pede reinício. Sem sort arbitrário, status, SKU, estoque ou tenant. Renderizar strings como texto; não usar HTML/autolink de conteúdo de produto.

GET products/{id}/image entrega WebP por API sem login. Usar imagePath relativo à origem da API; não construir URL Storage, token de download ou caminho interno. Imagens e JSON usam no-store; não manter cache durável com preços/status antigos. Rotas públicas permitem CORS * sem credenciais; rotas internas mantêm CORS autorizado e autenticação.

Carrinho fica no frontend e permite adicionar/editar/remover produto por id. POST quote-preview recebe somente linhas:

```json
{
  "lines": [{ "productId": "id-opaco-do-produto", "quantity": "0.125" }]
}
```

Servidor relê produto/unidade/preço e responde linhas canônicas, currency=BRL, totalEstimatedCents, kind=quote_request, confirmedOrder=false e reviewToken. UN/CX/PCT usam inteiro; KG/L até três casas. Centavos são inteiros, cálculo half-up no backend. Com preços ocultos, unitPriceCents/subtotalCents/totalEstimatedCents são null, inclusive em rotas alternativas; não reconstruir totais nem obter versão privada do produto. Preview admite até 200 produtos distintos e não reserva/cria nada.

Depois da revisão, POST whatsapp recebe mesmas lines e reviewToken. Resposta inclui message/whatsappUrl e resumo validado. Abrir whatsappUrl como link externo; visitante revisa e envia manualmente. Não executar envio automático, não marcar pedido criado e não coletar nome/telefone do visitante nesse contrato. Repetir preview/link é seguro para domínio e não exige Idempotency-Key; limites antiabuso ainda se aplicam. Não enviar preços, totais, nomes, unidades, texto ou destino calculados pelo navegador.

Estados: CATALOG_UNAVAILABLE (404) cobre desconhecido/desativado/acesso bloqueado; PRODUCT_UNAVAILABLE (404) indica item retirado/oculto/inativo/fora do catálogo. QUOTE_CHANGED (409) exige novo preview por mudança de preço público/nome/unidade/quantidade/opções/telefone. Não enviar resumo antigo após esse erro. Quantidade inválida usa INVALID_QUANTITY/INVALID_PRECISION/QUANTITY_LIMIT_EXCEEDED (422). QUOTE_VALUE_LIMIT (422) é técnico e só para preço público. QUOTE_MESSAGE_LIMIT (413) impede link excessivo sem truncamento; reduzir itens ou tratar revisão separada. RATE_LIMITED (429) respeita Retry-After; não repetir em loop.

Limites: JSON 64 KiB; 60 consultas/IP/minuto, 600/slug/minuto e dez POSTs de preview/link por IP/minuto; configuração menor reduz limite por IP. Mensagem 12.000 caracteres/URL 16.000, com possível limite menor no dispositivo. Não armazenar carrinho/reviewToken/link em analytics. G não tem fluxo de persistência ou conversão de orçamento aprovado.

## Fase E — seleção comercial

Administrador cadastra POST payment-conditions com name e preset cash/net30/30_60/30_60_90 ou schedule personalizado até doze linhas offsetDays/weight; nunca ambos. Peso padrão 1. PATCH usa expectedVersion e status=inactive para desativação. Payment-methods usa name/kind (cash/pix/transfer/card/boleto/other), separado dos prazos. Mutações exigem UUID Idempotency-Key.

Seletor usa GET orders/payment-options/conditions e methods, páginas ativas sem financeiro. POST orders/{id}/payment-preview recebe expectedVersion, paymentConditionId/paymentConditionVersion e forma prevista opcional. Servidor calcula parcelas/datas/fuso e desconto que precisa de aprovação. Preview não grava/reserva/liquida. POST/PATCH orders guarda seleção; não enviar payment legado junto à condição. IDs/versões vêm em pares; null limpa rascunho. Confirmação fixa data-base e dias corridos; alteração de cadastro exige revisão. Parcela zero é ausência de saldo, sem recebimento fictício. Seller não usa rotas financeiras.

## Fase E — financeiro administrativo

GET orders/{id}/financial-state fornece orderVersion, guardVersion, financialVersion e títulos/saldos/versões. Usar expectativas para concorrência, nunca autoridade. Forma efetiva ativa pode diferir da prevista. POST orders/{id}/receipts:

```json
{
  "expectedOrderVersion": 2,
  "expectedGuardVersion": 1,
  "customerId": "cliente",
  "methodId": "forma",
  "methodVersion": 1,
  "amountCents": 500,
  "receivedOn": "2026-10-09",
  "allocations": [{ "receivableId": "titulo", "amountCents": 500, "expectedVersion": 1 }],
  "reason": "Recebimento conferido"
}
```

Alocações somam valor positivo até saldo, somente do pedido/cliente. Não há destino para excedente. POST payments/{id}/reversals acrescenta expectedVersion do pagamento e alocações até fonte reversível. amountCents original permanece; reversedCents/transferredCents/remainingCents mostram destino e remanescente. Nunca apagar pagamento.

GET customers/{id}/credits lista fontes legítimas. POST orders/{id}/credit-applications recebe creditLotId/expectedLotVersion, cliente/versões/valor/alocações/motivo. Reversão credit-applications/{id}/reversals também exige versão da aplicação/fonte. Não criar saldo livre ou distribuir entre pedidos.

POST orders/{id}/financial-cancellation: versões do pedido/guard, reason, disposition customer_credit/refund. Somente confirmado não expedido: encerra dívida, restaura créditos às fontes, destina caixa liquidado e libera reservas. Expedido usa retorno. Obrigação pending não significa dinheiro devolvido. POST refund-obligations/{id}/confirm exige versões/valor até obrigação/forma efetiva e versão/refundedOn/reference/reason. Operador confirma prova real; backend não transfere. GET refund-confirmations/{operationId} mostra prova.

Reautenticar antes de estorno/cancelamento/restituição/retorno sensível (cinco minutos). CONFLICT exige recarregar projeções; RETURN_FINANCIAL_BLOCK permite consultar pendências, sem novas baixas. Repetir chave/payload após falha de rede; resultado original pode diferir do estado atual. Filtros derivados de títulos podem produzir página vazia com cursor; continuar paginação.

### Reconciliação financeira após F01

`GET /api/v1/orders/{id}/financial-reconciliation`: `limit` 1..100, padrão 25. A resposta permanece `{data: {orderId, consistent, complete, checkedEvents, nextCursor}, requestId}`. `checkedEvents` é a contagem cumulativa de eventos realmente examinados, não a última sequência. `consistent: false` não volta a `true` durante a mesma execução. Exigir `complete: true` e `consistent: true` para aceitar a conclusão; não reparar dados pelo cliente.

O checkpoint v1 é assinado, limitado a 1024 caracteres e vinculado a ator, empresa, pedido, limite normalizado, versão e cabeça financeira. Repetir o mesmo cursor sem mudança financeira retorna a mesma página/contagem. Não somar `checkedEvents` entre páginas. Conservar o último cursor confirmado em uma tentativa retomada.

`409 / CONFLICT` indica mudança financeira entre páginas; reiniciar sem cursor. Cursor antigo ainda válido para o escopo/cabeça atuais retorna `409 / FINANCIAL_RECONCILIATION_RESTART_REQUIRED`; também reiniciar. Cursor inválido, adulterado, de outro ator/empresa/pedido/limite, com formato desconhecido ou legado cuja cabeça já mudou retorna `422 / VALIDATION_ERROR`; descartar o cursor. Não há conversão silenciosa de cursor antigo para resultado cumulativo. Permissões atuais continuam sendo verificadas em todas as páginas.

Lacunas, duplicatas, hashes e transições de snapshot são verificados nas páginas lidas. A âncora imediata da página anterior é relida; sua remoção/alteração preserva a falha e a posição assinada. Uma cabeça inválida pode retornar `409 / FINANCIAL_INTEGRITY` antes da paginação, nunca um certificado positivo. A contagem representa observações da execução; uma âncora examinada e depois removida continua contada, mas torna a execução inconsistente.

O ledger é imutável pelas operações normais. A paginação não cria um snapshot Firestore global entre requests. Uma alteração privilegiada em uma página antiga, depois de examinada e fora dos writers controlados, exige nova reconciliação; o checkpoint não protege contra um operador que reescreva toda a cadeia/cabeça. `financial-history` mantém seu cursor e contrato anteriores. F01 isolada não resolve crescimento de histórico; usar o executor opt-in F02 conforme contrato e validação específica.

## Fase E — retorno físico e resolução

POST orders/{id}/returns: expectedOrderVersion/expectedGuardVersion, reason e lines [{lineId,quantity}] da expedição original. PATCH returns/{id} acrescenta expectedVersion e lista planejada; só saldo não recebido pode mudar. POST returns/{id}/cancel-pending preserva recebido. GET retorna quantidades textuais/versão.

POST returns/{id}/receipts: versões/motivo/subconjunto lines [{lineId,sellableQuantity?,damagedQuantity?}], somente realmente recebido. Dez pretendidos/seis recebidos deixam quatro pendentes. Revendável gera movimento; danificado fica separado. Uma UUID por confirmação real, mesma UUID/payload no replay. GET receipts/history mantém autoria/datas/quantidades/expedição.

GET returns/{id}/resolution-preview: consulta administrativa sem efeitos. Retorna returnId, expectedOrderVersion, expectedGuardVersion, expectedVersion e lines [{lineId,sellableQuantity,damagedQuantity,sellableCents,damagedLimitCents}]. Use limite calculado pelo backend para o campo de aceite, sem reconstruir centavos ou arredondamento no frontend. Preview pode ficar desatualizado por concorrência; POST valida novamente.

POST returns/{id}/resolve: versões/motivo/disposition, damagedDecisions [{lineId,accept,acceptedCents?}] obrigatório para dano não decidido. Resolve todos os recebidos ainda não resolvidos daquela intenção; dano rejeitado não abate dívida. acceptedCents é inteiro entre zero e damagedLimitCents por linha. Omitir em accept=true aceita integralmente o limite; accept=false aceita somente omissão ou zero. Aceite parcial/zero encerra avaliação de toda a quantidade danificada recebida daquela linha, sem aumentar estoque vendável. Novos recebimentos podem ter decisões posteriores. Valor zero por arredondamento ou decisão não cria dinheiro. GET returns e histórico informam damagedValueReductionCents; ausência em eventos históricos equivale a zero.

Exemplo de resolução de dano com aceite parcial, usando versões recebidas do preview:

```json
{
  "expectedOrderVersion": 3,
  "expectedGuardVersion": 4,
  "expectedVersion": 2,
  "reason": "Aceite parcial após avaliação do produto danificado",
  "disposition": "refund",
  "damagedDecisions": [{ "lineId": "linha-da-expedicao", "accept": true, "acceptedCents": 150 }]
}
```

Enviar UUID em Idempotency-Key. RETURN_VALUE_LIMIT (409) recusa aceite acima do limite cumulativo; DAMAGED_ACCEPTANCE_REQUIRED (422) exige decisão faltante. CONFLICT (409) exige novo preview e revisão administrativa, sem substituir chave de intenção com replay válido. Resposta amountCents inclui abatimento total, não valor bancário devolvido; refundObligationId indica obrigação manual pendente, creditLotId indica crédito de caixa com origem. Crédito aplicado é restaurado antes de destinar caixa. Nenhuma rota chama banco.

Bloqueio começa na intenção e continua com saldo físico ou recebido não resolvido. Seis resolvidos/quatro pendentes mantém bloqueio; cancelar as quatro pode encerrar sem apagar as seis. Outros pedidos do cliente seguem. Não oferecer apagar/corrigir evento físico concluído ou afirmar reembolso ao constituir obrigação. Compensações exigem contratos futuros.

Use Firebase Client SDK para login, logout, verificação/recuperação de email e reautenticação. Envie ID Token atual em Authorization Bearer. `/me` lista empresas vinculadas; selecione um tenant permitido e envie `X-Tenant-Id` nas rotas empresariais. Não envie perfil, permissões ou saldos como autoridade. Em erro 401, renovar token/reautenticar conforme o provedor; em 403, não repetir a operação como se fosse sucesso.

Convite recebe email normalizado e perfil `administrator/seller`. O backend devolve convite e token ao administrador. Entrega manual nesta fase; nunca coloque esse token em logs ou links de analytics. Destinatário autenticado/verificado aceita com `{ token }`; o vínculo é criado transacionalmente. Convite vencido/revogado/consumido não cria outro usuário.

Empresa provisionada não dá acesso privado até o primeiro administrador aceitar. Usuários bloqueados por assinatura recebem código seguro. `/me` permite apresentar a própria identidade e estado do vínculo sem divulgar preços, notas comerciais ou informações privadas do tenant suspenso.

`past_due` mantém acesso no MVP manual; não equivale a suspensão. `suspended/canceled` bloqueiam o acesso privado e a política de catálogo. A reativação de suspended libera o acesso segundo os vínculos atuais. canceled é terminal neste contrato.

Use UUID por intenção de criação em Idempotency-Key nas rotas indicadas no OpenAPI. Não troque a chave ao repetir por falha de rede. Para PATCH, envie expectedVersion da última resposta; em CONFLICT, recarregue e peça decisão do operador quando pertinente.

Gere tipos com `npm run openapi` e `npm run types:api`. `docs/api/generated-types.ts` é contrato gerado, não código de frontend. O aplicativo futuro deve tratar erros pelo código estável, e não pela mensagem traduzida. Cada operação do OpenAPI registra escopo/permissão e estratégia de replay.

## Fase B

Clientes: GET/POST customers; GET/PATCH/DELETE customers/{id}; PATCH customers/{id}/assignment. DELETE recebe body expectedVersion e desativa; PATCH com status=active reativa (administrador). Vendedor não envia assignedTo nem status; responsável é seu UID na criação. Edita nome, fantasia, documento, email, telefone, endereço e notas da própria carteira. CPF/CNPJ é opcional, matematicamente validado/normalizado, sem consulta à Receita Federal.

Produtos/categorias: GET/POST coleção e GET/PATCH/DELETE por ID. Vendedor consulta produtos ativos e categorias; não modifica esses cadastros. priceCents é inteiro não negativo; quantityPrecision é derivada, não saldo/quantidade editável. catalogVisible é intenção de publicação futura, sem rota pública.

Query: limit 1..100 (padrão 25), cursor, status=active|inactive|all (padrão active), q (prefixo de nome normalizado), sort=name|createdAt e direction=asc|desc. q exige name asc. Clientes: assignedTo=UID|unassigned para administrador; vendedor não amplia carteira por filtro. Produtos: categoryId, sku exato normalizado, catalogVisible=true|false. Preserve parâmetros ao paginar; cursor é específico para usuário, filtros, ordem e empresa.

PATCH/DELETE/transferência exigem expectedVersion. Em CONFLICT, refaça GET e resolva a decisão; não sobrescreva automaticamente. POST comercial não usa Idempotency-Key: CPF/CNPJ/SKU têm unicidade, mas cliente sem documento pode duplicar após retry. Não faça retry automático cego dessas criações.

Imagens: PUT products/{id}/image?expectedVersion=N com bytes e Content-Type image/jpeg, image/png ou image/webp. Máximo 5 MiB, 16 milhões de pixels/lado 8192, sem animação, multipart, URL ou SVG. Resposta é produto/metadados/versão. GET autenticado retorna bytes image/webp sem envelope JSON, Cache-Control private,no-store; DELETE com versão na query remove associação e devolve produto. Não use Storage SDK direto ou URL pública: busque bytes autenticados e descarte URLs locais após uso.

Erros adicionais: DUPLICATE_DOCUMENT/DUPLICATE_SKU (409), INVALID_ASSIGNEE/INVALID_CATEGORY/INVALID_IMAGE (422), RATE_LIMITED (429). Carteira alheia retorna RESOURCE_NOT_FOUND (404), sem confirmar existência. Dados pessoais e imagens não devem ir a analytics, logs ou caches públicos.

## Fase C — estoque

Quantidades são strings decimais com ponto, sem separador de milhares/comma/exponente/número JSON. UN/CX/PCT aceitam "10"; KG/L aceitam "1.250" ou "0.001". API devolve texto canônico sem zeros fracionários finais ("1.25"). Limite 1.000.000.000 unidades por saldo/mínimo/operação; financeiro continua em centavos. Produto retorna minimumStock (padrão "0" em legado), editável somente por administrador e sob expectedVersion do produto.

GET inventory e inventory/{productId}: administrador recebe physical, reserved, available, minimumStock, suggestedQuantity, version e lastMovementAt. Vendedor recebe apenas productId/name/SKU/unit/available de ativos. Disponível é derivado; nunca enviar saldos em body. GET inventory/movements filtra productId/type/from/to, direction asc|desc e paginação padrão. Datas são UTC ISO 8601, com até três casas de milissegundos, normalizadas no servidor; período inclusivo. GET inventory/replenishment filtra status/categoryId/q, sort=name|shortfall e direction; q exige name asc, ativos por padrão.

POST inventory/entries: {productId,quantity,reason,notes?}. POST inventory/adjustments: {productId,delta,expectedVersion,reason,notes?}, delta pode ser negativo e nunca zero. Ambos exigem UUID em Idempotency-Key. Resposta 201 inclui movimento e snapshot de estoque após operação, mesmo em replay. Retentar mesma intenção com mesma chave e mesmo comando/ator; mudança de conteúdo/ator é 409. Ajuste usa versão do estoque retornada por GET inventory, que é distinta da versão do produto. Em conflito, recarregar saldo e obter nova decisão antes de nova chave/comando.

GET inventory/{productId}/reconciliation pagina auditoria matemática sem reparar. consistent=true só valida páginas percorridas; exigir também complete=true para conclusão. nextCursor assinado está vinculado ao ator/tenant/produto e cabeça do estoque; em CONFLICT reiniciar. Não usar checkpoint externo editado como autoridade.

Erros adicionais: INVALID_QUANTITY, INVALID_PRECISION, QUANTITY_LIMIT_EXCEEDED (422); INSUFFICIENT_STOCK, UNIT_LOCKED, CONFLICT (409). Movimentos não têm PATCH/DELETE; correção cria ajuste compensatório com justificativa. Produtos inativos mantêm histórico/saldo e administradores podem corrigir seu estoque; vendedor não os consulta. Não há pedido, reserva operacional, expedição, liberação ou devolução por HTTP nesta fase.

## Fase D — pedidos

A Fase D adiciona pedidos/reservas/expedição/liberação por operações legítimas de pedido, sem reserva livre ou retorno físico. GET/POST orders, GET/PATCH orders/{id}, POST orders/{id}/confirm|dispatch|cancel, GET orders/{id}/history. Todas sob /api/v1 com Bearer/tenant autorizado.

Criar: {customerId,lines:[{productId,quantity}],payment:{type:cash|installments,dueDates:[YYYY-MM-DD]},notes?}. Sem teto comercial de produtos distintos; quantidades C. Rascunho permite omitir cliente/linhas/pagamento e usar null para limpar cliente/pagamento; linhas vazias não confirmam. Confirmação exige cliente autorizado, ao menos uma linha válida, quantidade positiva, total positivo, estoque e pagamento válido. Não há valor mínimo comercial. Nome/unidade/SKU/descrição/preço/totais/parcelas/IDs vêm do servidor. Não enviar snapshot, preço, saldo, status, reservas ou tenant como autoridade. POST rascunho não promete idempotência; não fazer retry automático cego. Identificador comercial é PED-UUID completo.

PATCH usa expectedVersion e campos opcionais de rascunho; não edita confirmado/expedido/cancelado. Somente administrador pode enviar sellerUid e discount={type:fixed|percentage,value,reason} ou discount:null. Fixed em centavos, percentage em pontos base (1000=10%). Toda edição invalida desconto anterior; informar isso na UX e buscar reaprovação explícita se necessário. Aprovação intacta pode ser confirmada pelo vendedor, mas mudança de preço/condições ou aprovador inativo exige DISCOUNT_APPROVAL_REQUIRED.

Datas reais/futuras na empresa, ordenadas, sem intervalo automático; cash uma data, installments 2..12. Servidor arredonda subtotais half-up, distribui desconto proporcional por maior resto e diferenças de parcela nas primeiras posições; soma exata. Confirmação recalcula preço vigente e retorna snapshots definitivos; não confiar no total exibido previamente para confirmar. Fuso atual da fundação: America/Sao_Paulo.

Confirm/dispatch/cancel: {expectedVersion}; cancel exige reason. Headers Idempotency-Key UUID por intenção. Retry rede usa mesma chave/payload/ator e retorna resultado original; para obter estado atual fazer GET. Não trocar chave de transição após timeout. Em 409 recarregar e resolver conflito, sem sobrescrever automaticamente. Confirm reserva/cria recebíveis; dispatch integral retira físico/reservado; cancel administrativo libera/cancela parcelas quando permitido.

Vendedor precisa ser responsável pelo pedido e carteira atual. Transferência bloqueia anterior e não dá pedidos antigos ao novo vendedor; administrador preserva acesso. Não exibir ações cancel/desconto ao vendedor, mas segurança continua no servidor. Listas: status/customerId/direction asc|desc, limit/cursor; padrão createdAt desc. Páginas vazias podem ter nextCursor após transferência; continuar usando cursor sem varrer no cliente em busca de total. Histórico tem pageQuery e eventos/version/ator/estados/motivo; sem PATCH/DELETE.

Erros: INVALID_ORDER_STATE/CONFLICT/PRODUCT_UNAVAILABLE/CUSTOMER_INACTIVE/INSUFFICIENT_STOCK/DISCOUNT_APPROVAL_REQUIRED/INVALID_RESERVATION/FINANCIAL_CANCELLATION_REQUIRED/RECEIVABLE_INTEGRITY (409); INVALID_DUE_DATE/INVALID_DISCOUNT/ORDER_VALUE_LIMIT/INVALID_RESPONSIBLE (422). Acesso alheio: 404 seguro. Recebimentos bloqueiam cancelamento automático; pedido expedido exige futura devolução. Não sugerir que dinheiro foi devolvido nem que foi gerado crédito. Nenhum endpoint financeiro foi disponibilizado.

Na revisão D, saídas de rascunho podem conter customerId/customerName/payment null e arrays vazios. INCOMPLETE_ORDER e ORDER_TOTAL_REQUIRED são 422; ORDER_TECHNICAL_LIMIT é 413 por documento/limite técnico do banco. Payload JSON acima de 64 KiB usa 413 VALIDATION_ERROR. Não dividir confirmação para contornar erro técnico nem exibir pedido como confirmado antes do 200; em perda de resposta repetir mesma chave. [Plano E](../phase-e.md) propõe seletores separados de condições/formas e preview de vencimentos, sem rotas financeiras implementadas.
