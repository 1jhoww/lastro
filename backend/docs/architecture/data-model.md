# Modelo de dados v1

Inclui fundação, comércio, estoque, pedidos, projeções financeiras e retornos v1 das Fases A–E. As seções D preservam a descrição histórica; seção E registra os contratos vigentes.

Schemas executáveis em `src/shared/schemas/models.ts`; entrada HTTP em `shared/schemas/http.ts`. Documentos usam `schemaVersion: 1`, IDs opacos e timestamps ISO 8601 UTC. Valores monetários são inteiros entre 0 e 100.000.000 centavos; limite de usuários entre 1 e 100 (Essencial usa 1). Campos novos de assinatura, vínculo (`seatExempt`) e convite (`seatExempt`) têm padrão na leitura, então documentos anteriores continuam válidos sem reescrita. Email de convite deve estar normalizado em minúsculas; token apresentado não substitui email verificado no Firebase.

| Caminho                                     | Dados e relacionamentos                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identities/{uid}`                          | UID Firebase, estado global `active/disabled`, timestamps. Sem senha, tenant ou perfil global empresarial.                                                              |
| `platformAdmins/{uid}`                      | UID, estado, criação e schema; atribuição fora de endpoints públicos.                                                                                                   |
| `tenants/{id}`                              | Nome, fuso, `provisioning/active`, subscriptionId, versão, contadores internos e timestamps.                                                                            |
| `tenants/{id}/memberships/{uid}`            | UID, tenantId, `administrator/seller`, `active/disabled`, versão e timestamps. Unicidade pelo UID dentro da empresa.                                                    |
| `tenants/{id}/invitations/{id}`             | Email, perfil, SHA-256 do token, `pending/accepted/revoked`, prazo, criador e aceitante. Expiração é derivada do prazo, sem job obrigatório.                            |
| `tenants/{id}/invitationEmails/{emailHash}` | Ponte para último convite emitido ao email; hash no caminho evita documento com email cru. Histórico e autoridade permanecem no convite.                                |
| `plans/{id}`                                | Planos personalizados anteriores ao catálogo oficial; somente leitura. Planos oficiais ficam no código (ADR 0009).                                                      |
| `plans/{id}/versions/{version}`             | Snapshots imutáveis dos planos personalizados.                                                                                                                          |
| `subscriptions/{id}`                        | Tenant, plano/versão, `planCode` (nulo = legado), valor, limite, estado, início, dia de vencimento, início da cobrança, contato, notas, versão. ID coincide com tenant. |
| `billingCharges/{subscriptionId}_{AAAA-MM}` | Cobrança da competência: valor congelado, vencimento, `pending/paid/canceled`, pagamento, notas, origem, plano, versão (ADR 0010).                                      |
| `auditLogs/{id}`                            | Ações da plataforma; contratos, cobranças e convites revogados pelo Super Admin levam `tenantId` para o histórico.                                                      |
| `tenants/{id}/auditLogs/{id}`               | Ações empresariais, ator, recurso, requestId, instante e mudanças permitidas.                                                                                           |
| `auditLogs/{id}`                            | Ações de plataforma, sem permitir consulta comercial geral.                                                                                                             |
| `idempotencyRecords/{hash}`                 | Ator, operação, hash canônico do comando e IDs do resultado; nenhum token de convite cru.                                                                               |
| `rateLimits/{hash}`                         | Contador por ator/operação ou IP/janela, com expiração Timestamp para futura limpeza.                                                                                   |

Exemplo sintético: empresa `tenant_abc`, vínculo `uid_demo` administrador ativo, plano v1 (15000/20000 centavos, duas vagas) e assinatura active. Convite pendente para `other@example.invalid` reserva a segunda vaga, ainda sem vínculo. Aceitação transforma a reserva em vínculo ativo sem aumentar a capacidade ocupada total.

## Consultas e índices

Listagens usam documentId e cursores assinados, limite padrão 25/máximo 100. `/me` faz collectionGroup filtrada pelo UID autenticado e estado ativo, limitada a 100 vínculos; confirma o caminho físico de cada vínculo. Convites válidos consultam `status == pending` e `expiresAt > agora`, com limite de proteção 101. O gate empresarial sempre busca o vínculo dentro da empresa candidata, sem aceitar filtros de tenant enviados pelo cliente.

`firestore.indexes.json` contém os índices de convites e identidade por vínculos e isenções para hashes, resultados e mudanças de auditoria. Emuladores não comprovam todos os requisitos/tempos de índices de produção. A implantação futura deverá validar os índices explicitamente.

## Unicidade, retenção e migração

Vínculos são únicos pelo caminho tenant/UID. Convites vivos para um email não se repetem: a query e a escrita serializada na empresa preservam a decisão concorrente. Expirados não ocupam vagas; revogados não podem ser aceitos. Memberships desativados e convites consumidos são preservados; não há exclusão física pela API.

Idempotência de criação usa ator/operação/chave, valida hash canônico e mantém IDs. Enquanto o registro existir, outra carga com a chave gera conflito. `expiresAt` indica retenção planejada de pelo menos 30 dias, mas não há remoção automática habilitada nesta fase. Replay de criação de empresa recompõe o resultado enquanto o convite inicial estiver pendente/válido; após consumo retorna conflito sem criar outra empresa. Não habilitar TTL desses registros sem revisar a política de replay. Convites são HMAC por tenant/ID; só o hash é persistido e a chave fica fora do código.

Adicionar schemas novos deve seguir expandir/leitura compatível/migrar em lotes/verificar/contrair, com checkpoint e auditoria. A migração para os planos oficiais (`npm run migrate:plans`, dry-run por padrão) segue essa ordem e está descrita em [operação da plataforma](../operations-platform-billing.md); nenhuma migração de produção roda sem autorização.

Índices da plataforma ficam declarados por `scripts/platform-indexes.mjs`: histórico de auditoria por recurso, cobranças por situação/empresa/vencimento e pagamentos do mês. Antes de migrar contadores, reconciliar vínculos ativos e administradores em ambiente isolado, sem remover a proteção transacional. Prazos legais de retenção, anonimização e exclusão de backups exigem política aprovada.

## Fase B — schemas comerciais v1

Fonte: src/shared/schemas/commercial.ts. Recursos armazenam id, tenantId, versão, schemaVersion, timestamps UTC, criador e último editor. Saídas não expõem tenantId, nameKey ou reservas.

| Caminho sob tenants/{id}   | Dados                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| customers/{customerId}     | Nome/razão social, fantasia, CPF/CNPJ opcional normalizado, email, telefone, endereço parcial, notas, assignedTo nullable, estado |
| customerDocuments/{sha256} | Documento reservado ao resourceId, sem valor fiscal cru no caminho                                                                |
| products/{productId}       | Nome, descrição, SKU, categoryId nullable, unidade, quantityPrecision, priceCents, catalogVisible, imagem nullable, estado        |
| productSkus/{sha256}       | SKU reservado ao produto                                                                                                          |
| categories/{categoryId}    | Nome, descrição, estado                                                                                                           |

Reservas são lidas/gravadas junto ao recurso e à auditoria. Inativos mantêm reserva; remover/editar documento ou SKU libera a chave antiga e reserva a nova atomicamente. Mesmo documento/SKU em outra empresa é permitido. Repetir POST de cliente sem documento pode gerar dois cadastros; essa rota não promete idempotência.

Responsável deve ser vendedor com identidade/vínculo ativos no tenant. Desativar/mudar perfil não redistribui carteira automaticamente; administrador transfere os cadastros preservados. Categorias inativas continuam legíveis para interpretar produtos existentes; novos vínculos são rejeitados. Desativar categoria não desativa produtos. DELETE é lógico.

UN/CX/PCT têm precisão 0; KG/L têm 3 casas, representadas como inteiros em milésimos (12,345 KG → 12345). Estoque foi implementado na Fase C sem conversão entre unidades. Pedidos D guardam snapshots de preço/unidade/descrição para preservar históricos.

Storage privado: tenants/{tenantId}/products/{productId}/{imageId}.webp. Firestore contém ID/propriedades da imagem, sem URL pública ou caminho do cliente. Regras negam acesso direto; API deriva caminho e autorização.

## Índices e custo comercial

scripts/commercial-indexes.mjs gera 76 índices comerciais além dos dois da fundação, sem implantar. Cobrem subconjuntos dos filtros por coleção, nameKey/createdAt ASC/DESC e desempate documentId na direção da ordenação. Notas, endereço, contatos, descrição e imagem têm isenções de índices de campo único.

Uma página lê até limit+1 documentos comerciais e mais um quando há cursor, além das leituras de autorização/limitação. Não calcula total por varredura. Muitos índices aumentam armazenamento e amplificação de escrita; filtros/ordens também podem gerar cobrança de entradas de índice. Validar índices reais e medir combinações usadas antes de publicar; retirar índices requer ajustar contrato/testes. Latência e custos não foram medidos nos emuladores. Consulte [preços oficiais Firestore](https://firebase.google.com/docs/firestore/pricing).

## Fase C — Estoque

Schemas em shared/schemas/inventory.ts. Produto ganhou minimumStock decimal textual, padrão "0" na leitura compatível de documentos existentes. Escritas de produto materializam inventory; legado sem saldo é zero e mínimo zero, sem varredura/migração global obrigatória. Primeiro movimento ou alteração administrativa materializa seu registro. Não interpretar ausência de estoque após operações como exclusão válida: recuperação deve restaurar histórico/cabeça juntos.

| Caminho sob tenants/{id} | Dados                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| inventory/{productId}    | Physical/reserved/minimum em milésimos; versão; contador/cabeça/hash do histórico; última movimentação; projeção de nome/SKU/unidade/status/categoria, belowMinimum e shortfallScaled |
| inventoryMovements/{id}  | Evento imutável, produto/tipo/unidade/quantidade; saldos físico/reservado antes/depois; sequência/hash anterior/hash; ator, motivo/nota, origem/referência, requestId e operationId   |
| stockOperations/{hash}   | UUID de operação escopado ao tenant, ator, hash do comando, ID do movimento e snapshot da resposta original                                                                           |

Escala universal 1000, MAX_SCALED=1.000.000.000.000; tudo é inteiro exato e cabe em Number seguro. UN/CX/PCT precisam de múltiplos de 1000 internamente; KG/L até milésimos. Disponível não é persistido. Shortfall=max(0,mínimo-(físico-reservado)) e belowMinimum são projeções escritas no mesmo commit do saldo/mínimo. Mudar metadados do produto sincroniza a projeção, sem alterar saldos ou histórico.

Movimento, saldo, operação idempotente e auditoria são quatro escritas atômicas por operação. Chave pertence ao tenant inteiro e ao ator original: outro ator ou comando não pode reutilizá-la. Registro não tem TTL habilitado; removê-lo permitiria repetir movimento e exige política de retenção/replay aprovada. Alterar mínimo/unidade antes do histórico incrementa versão do estoque; sequência conta apenas movimentos. Unidade bloqueada após qualquer histórico, inclusive físico zero.

Reconciliação lê histórico em páginas de até 100, verifica sequência, cadeia/hash, aritmética e saldos antes/depois e compara cabeça/contagem/saldos ao terminar. Cursor assinado carrega progresso e versão da cabeça; mudança concorrente pede reinício. Não repara automaticamente. Alterações por credencial privilegiada podem reconstruir toda a cadeia; hash não é ancoragem externa nem invulnerabilidade.

## Índices e custo do estoque

scripts/inventory-indexes.mjs acrescenta 23 índices locais: 16 para belowMinimum/status/categoryId com nameKey/shortfallScaled e direções; 6 para produto/tipo/período de histórico; 1 para reconciliação produto/sequência. Total declarado 101 com A/B, sem deploy. Notas/motivo/hashes/snapshot de resposta têm isenções de índices individuais.

Listagem de estoque reaproveita a página de produtos e lê um saldo por produto no mesmo snapshot Firestore, limitada a 100; legado sem documento é zero. Reposição consulta diretamente belowMinimum e não varre todos os produtos. Histórico e reconciliação leem limit+1 por página e usam cursores. Há leituras adicionais de autorização, produto/cabeça, cursor, idempotência e rate limiting; retries de transação aumentam custo. Reposição gera amplificação de índice por saldo atualizado. Nenhuma estimativa monetária/capacidade produtiva foi medida no emulador.

## Fase D — pedidos e recebíveis iniciais

Schemas executáveis em shared/schemas/orders.ts e modules/receivables/orderReceivables.ts; detalhes em [Fase D](../phase-d.md).

| Caminho sob tenants/{id}       | Conteúdo                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orders/{UUID}                  | PED-UUID comercial; cliente/nome e responsável; draft/confirmed/dispatched/canceled; linhas com snapshots de produto/unidade/quantidade/preço/desconto/totais; aprovação; condição e parcelas; notas; versão/atores/datas; dispatchReference |
| orderEvents/{UUID}             | Pedido/versão/tipo/estados/ator/data/motivo/requestId/operação; append-only na API                                                                                                                                                           |
| orderOperations/{hash}         | Ator/pedido/hash do comando/resultado completo original/data/schema; replay sem novos efeitos                                                                                                                                                |
| stockReservations/{hash}       | Tenant/pedido/linha/produto/unidade/quantidade escalada; reserved/dispatched/released; origem da operação/datas                                                                                                                              |
| receivables/{hash}             | Pedido/parcela/ID/número; originalCents/outstandingCents/receivedCents; vencimento/status/origem/datas                                                                                                                                       |
| orderFinancialGuards/{orderId} | Tenant/pedido/receivedCents/paymentCount/version; barreira para futura corrida pagamento/cancelamento                                                                                                                                        |

Sem contador global de pedidos. Quantidades em milésimos, dinheiro em centavos; half-up em subtotal e percentual, desconto proporcional por maior resto e parcelas com restos nas primeiras posições. Sem teto comercial de linhas distintas, até 12 parcelas; subtotal/total até 100.000.000 centavos. DueDate YYYY-MM-DD é data no fuso da empresa (fundação atual America/Sao_Paulo); timestamps são UTC. Não há intervalo automático entre parcelas.

Rascunho admite customerId/customerName/payment null, lines=[] e installments=[]; linhas sem condição podem ter total positivo sem parcelas. Linhas fornecidas exigem quantidade positiva compatível com a unidade. Confirmado exige cliente autorizado, uma ou mais linhas válidas, total final positivo, estoque e condição válida; nenhum mínimo comercial. Documento order e resultado completo orderOperations têm pré-validação de tamanho UTF-8 conforme armazenamento Firestore (1 MiB); bytes do commit/índices/tempo são limites separados. Excesso recusa operação inteira. Normalização versionada das linhas é proposta não implementada.

Reserva usa hash tenant/pedido/linha/produto e não pode ser reaproveitada por outro pedido. Recebível usa hash de pedido/parcela, evitando duplicata. Pedido/reservas/movimentos/saldos/recebíveis/guard/evento/auditoria/operação são atômicos. Cancelar confirmado sem recebimentos cancela parcelas e libera reservado; expedido exige futura devolução. Schema financeiro admite estados futuros para detecção, mas nenhuma rota registra pagamentos ou altera saldos diretamente.

StockMovement agora aceita origin=order com originReference=UUID do pedido; eventos comerciais participam da mesma cadeia/seq/reconciliação C. OrderStockPort ajustado com lineId/occurredAt e tipos operacionais reserva/liberação/expedição; retorno é fluxo futuro. [Fase E](../phase-e.md) exige guard/recebíveis/pagamento juntos na mesma transação.

15 índices D declarados (14 combinações seller/status/customer/createdAt e 1 histórico), total A–D 116; sem implantação. Linhas/parcelas/aprovação/condições/notas/snapshot têm isenções de índices. Página de pedidos lê até limit+1 e cursor/contexto; vendedor lê um cliente por candidato para carteira atual, podendo retornar página vazia com próximo cursor. Histórico é limitado; não há total por varredura. Operações críticas retêm resultado idempotente sem TTL; retenção exige revisão contra replay. Produto disputado segue agregado serializado; custos/latência reais permanecem pendentes.

## Fase E vigente

Schemas paymentSettings.ts, finance.ts e returns.ts definem contratos executáveis. Condições e formas têm cadastros distintos por tenant; pedido preserva versões/schedule/fuso/baseDate e forma prevista. Confirmação E calcula dias corridos a partir da confirmação, sem calendário bancário. Fuso IANA é configurável; registros D não são convertidos.

Receivables D continuam como origem; financialTitles tem componentes aberto/caixa/crédito/cancelado e hash da origem. financialOrderStates guarda somas e cabeça do diário. Primeira mutação materializa projeções sem reescrever D; legado sem origem de dinheiro falha fechado. Guard D serializa todas as operações E e impede cancelamento simples contornar histórico.

Payments conserva valor e forma efetiva originais, alocações, reversedCents e transferredCents; transferência para crédito/obrigação deixa de ser reversível na fonte. CreditLots conserva emitido/disponível/aplicado e evento legítimo de origem; creditApplications mantém valor original, reversões/restaurações e remanescente. RefundObligations registra compromisso; refundConfirmations registra prova manual real. FinancialEvents imutável contém antes/depois, sequência/hash/fontes/ator/motivo; financialOperations conserva resultado pequeno original, sem TTL.

Returns guarda intenção/recebido/resolvido por qualidade; orderReturnLines serializa limites cumulativos por linha. ReturnEvents contém snapshot e prova dos guards; returnReceipts registra cada quantidade efetiva/qualidade e movimento elegível. Estoque vendável recebe somente revendáveis; dano fica separado nos registros de retorno, com decisão financeira explícita. Pedido continua dispatched; reserva consumida, preço e recebíveis D não mudam.

Linhas de returns e orderReturnLines admitem damagedValueReductionCents opcional: diferença acumulada entre limite nominal de danos aceitos e valor efetivamente aceito. Ausência significa zero para cálculo, sem acrescentar campo ao histórico durante leitura. ReturnEvents preserva os valores antes/depois e a prova do guard no mesmo commit. Projeção pública sempre informa a redução, inclusive zero. Valor resolvido do guard deve corresponder ao nominal cumulativo half-up menos redução; alteração sem prova imutável é rejeitada. Não há migração destrutiva ou nova coleção para aceite parcial.

scripts/finance-indexes.mjs adiciona nove índices compostos E, total 125. Arrays de linhas/guards/parcelas/alocações e snapshots antes/depois/resultados têm isenções; nenhuma implantação. Listas leem limit+1, sem contagem global. Títulos antigos filtram cliente/status derivados por candidato e podem produzir página vazia com cursor. Cabeçalhos financeiros e provas de guards são compartilhados dentro de cada transação para evitar releituras por linha. Resolução/cancelamento percorrem fontes de um único pedido em páginas de 100 na mesma transação, sem teto arbitrário; muitos lançamentos num pedido podem atingir limites técnicos e falhar integralmente.

## Fase G - projeções transitórias

Nenhuma coleção, migração, índice ou campo de domínio novo. PDFs são buffers limitados em memória, sem Storage, histórico duplicado ou URL pública. Exportações usam leitores existentes, cursores assinados e uma página limitada por arquivo. O campo rowCount e nextCursor é metadado HTTP, não documento persistido.

Snapshot do pedido mantém nome histórico do cliente, linhas/valores/descontos/condições/parcelas e datas. Endereço/documento histórico do cliente e transportadora não existem nesse snapshot; documentos omitem esses campos. Nome atual da empresa identifica emissor, explicitamente sem alegar snapshot histórico. Data do pedido usa UTC registrado; vencimentos preservam calendário histórico. Observação comercial não entra no romaneio, evitando revelar valores livres. Quantidades físicas de retorno vêm de orderReturnLines e prova imutável de returnEvents/reservas; nenhuma fonte financeira é entregue ao vendedor.

rateLimits reutiliza bucket document-export por UID/janela de hora, count/expiresAt. Sem TTL novo. Versões, reservas, saldos e operações A-F não mudam durante geração, falha ou repetição de downloads.

## Fase F — Catálogo público

| Caminho                               | Conteúdo                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| catalogSlugs/{slug}                   | Registry global: tenantId/slug/schemaVersion; unicidade transacional, sem consulta pública de empresas          |
| tenants/{id}/catalogSettings/current  | enabled/slug/tradeName/description/whatsappNumber/showPrices; versão/autores/datas/schemaVersion                |
| tenants/{id}/catalogOperations/{hash} | Idempotência administrativa por UUID/ator/hash e resposta original; sem TTL automático                          |
| rateLimits/{hash}                     | Buckets de segurança derivados de IP/janela e slug; count/expiresAt, sem itens ou dados de contato do visitante |

Produtos/categorias B são a única origem comercial; catalogVisible existente seleciona produtos ativos. Nenhum campo financeiro, estoque, cliente, pedido ou produto duplicado é criado. DTO público só contém referências opacas necessárias do produto/categoria e informação explicitamente publicada. Slugs antigos continuam reservados ao tenant, mas só a configuração atual pode resolver dados.

Orçamentos e mensagens não são persistidos. Preview/WhatsApp são transações somente leitura do domínio; contadores antiabuso são independentes. Revisão HMAC usa somente dados públicos atuais, com preço null quando oculto. Cursores cifrados/autenticados escondem candidato de categoria não publicada. Rules/bucket continuam privados; imagem é resposta binária da API após gates antes/depois do Storage. Índices locais totais 126, sem deploy; expiresAt dos contadores não implica eliminação sem TTL/limpeza aprovada.
