# Fase F — Catálogo público e orçamentos

Implementação local concluída em 9/10/2026: 423 testes A–F aprovados, zero falhas, com os 364 anteriores preservados. OpenAPI 0.6.0/100 operações e tipos atualizados; TypeScript, lint, formatação, build e auditorias passaram. [Validação](validation-phase-f.md) e [relatório de entrega](phase-f-delivery.md) registram evidência, limites e integração. Sem deploy, commit, push, produção ou publicação de recursos.

## Análise Inicial

A API 0.5.1 contém 91 operações A–E e nenhuma rota pública de catálogo ou orçamento. OpenAPI, tipos gerados e contrato frontend foram conferidos. Produtos B já possuem catalogVisible, categoria, unidade, preço em centavos e imagem privada. catalog:manage já pertence somente ao administrador. A política publicCatalogAllowed permite active/past_due e bloqueia suspended/canceled; tenant precisa estar active.

Não foi encontrado planejamento operacional anterior da Fase F. Documentos A–E apenas antecipavam catálogo e publicação futura de imagens. Esta fase usa leitura binária pela API com verificação pública antes/depois do Storage, mantendo bucket e Rules privados; não cria área pública ou URL permanente de objeto.

## Plano Técnico

1. Configuração única em tenants/{id}/catalogSettings/current: enabled, slug, tradeName, description, whatsappNumber e showPrices; versão, autoria, auditoria e idempotência administrativa. Registry global catalogSlugs assegura unicidade em transação. Slugs antigos continuam reservados ao mesmo tenant para impedir apropriação de links; somente o slug atual pode resolver catálogo.
2. Rotas públicas em /api/v1/public/catalogs/{slug}, antes da autenticação interna, com DTOs explícitos e gates relidos em snapshot: tenant ativo, assinatura autorizada, catálogo ativo e slug correspondente. Não há listagem de empresas. IDs de produto e categoria são apenas referências opacas necessárias à seleção/filtro; tenant, autores, assinatura, SKU, carteira, estoque e financeiro não são publicados.
3. Produtos continuam no cadastro B. Listagem indexada por status=active/catalogVisible=true/nameKey, prefixo de nome, categoria e cursor autenticado e cifrado com AES-256-GCM. Categorias públicas precisam estar ativas e ter produto publicado. Paginação pode retornar página vazia com cursor, evitando varredura sem limite e exposição do ID de candidato privado. Produto de categoria inativa permanece publicado sem identificação da categoria, preservando a regra B.
4. Carrinho permanece no visitante. POST quote-preview recebe somente linhas de produto/quantidade, valida até 200 produtos distintos e usa unidades/quantidades/cálculo half-up existentes. Preço oculto não participa do resultado, erro de limite monetário ou prova de revisão. Não há escrita de orçamento, cliente, pedido, estoque, recebível ou financeiro.
5. POST whatsapp revalida o carrinho e uma prova de revisão HMAC sobre informações públicas atuais. Alterações relevantes exigem novo preview. Mensagem identifica orçamento não confirmado; links/conteúdo de controle em nomes são neutralizados. Somente link https://wa.me com telefone internacional configurado e mensagem codificada; o visitante revisa e envia. Não há envio automático, integração paga ou sessão pessoal.
6. Cache no-store inclusive imagens/erros; limites antes de leituras, entradas strict, JSON 64 KiB e limites técnicos de mensagem/link. Reutilizar contador Firestore e proteção em memória, com orçamento público separado do privado. Não há mudança de Rules para acesso direto. Índices apenas declarados localmente.
7. Validar incrementos de configuração, consultas/imagens e orçamento/WhatsApp; depois executar regressão integral A–F, TypeScript, lint, formatação, build, contratos, dependências e segredos. Atualizar documentação e entrega para Claude.

Não é necessário persistir orçamentos nem solicitar nova decisão de negócio para esse fluxo. Não há coleta de nome, telefone, email ou identificação do visitante. Configuração, registry de slugs e operações administrativas são os novos registros comerciais. Contadores antiabuso reutilizam rateLimits com identificadores derivados do IP/janela e slug, sem carrinho ou mensagem; são metadados pseudônimos de segurança. expiresAt é marcador de expiração, não promessa de eliminação: TTL/limpeza não foram implantados. Nenhuma publicação em produção.

Formato do link conferido na [documentação oficial do WhatsApp](https://faq.whatsapp.com/5913398998672934/?locale=pt_BR).

## Contratos Implementados

| Método | Endpoint em /api/v1                         | Autorização                                          |
| ------ | ------------------------------------------- | ---------------------------------------------------- |
| GET    | /catalog-settings                           | catalog:manage; administrador                        |
| PUT    | /catalog-settings                           | catalog:manage; administrador; Idempotency-Key UUID  |
| GET    | /public/catalogs/{slug}                     | Sem login; gates públicos atuais                     |
| GET    | /public/catalogs/{slug}/products            | Sem login; produtos ativos publicados                |
| GET    | /public/catalogs/{slug}/products/{id}       | Sem login; produto elegível daquele catálogo         |
| GET    | /public/catalogs/{slug}/products/{id}/image | Sem login; gates antes/depois do Storage             |
| GET    | /public/catalogs/{slug}/categories          | Sem login; categorias ativas com publicação          |
| POST   | /public/catalogs/{slug}/quote-preview       | Sem login; validação estrita; sem efeitos comerciais |
| POST   | /public/catalogs/{slug}/whatsapp            | Sem login; exige prova da revisão atual              |

PUT é substituição completa da configuração, expectedVersion=0 na primeira gravação e versão retornada nas seguintes. Desativar não libera slug. Mudança de slug conserva os anteriores reservados, mas só o atual atende requisições. Seleção de produtos usa catalogVisible pelas rotas administrativas B existentes; não há cadastro paralelo de produto.

Público recebe somente slug/nome comercial/descrição/WhatsApp/showPrices da empresa e produto id/nome/descrição/unidade/precisão/categoria pública/preço permitido/imagePath. IDs de produto/categoria são referências opacas necessárias; não são autorização. Não há SKU, tenantId, autores, assinatura, clientes, saldos de estoque ou componentes financeiros.

## Orçamento e Revisão

Carrinho no frontend contém productId/quantity. quote-preview relê os produtos e produz linhas canônicas e totalEstimatedCents em centavos ou null, currency=BRL, kind=quote_request, confirmedOrder=false e reviewToken. Unitários/subtotais também são null quando preços estão ocultos. Preço oculto não entra na prova nem é calculado para aplicar limite monetário; alterações exclusivamente nesse preço não mudam resposta ou revisão.

whatsapp recebe as mesmas linhas e reviewToken. A prova HMAC cobre dados públicos do resumo, telefone e empresa; nenhuma lista de itens é persistida. Nome/unidade/quantidade/preço público/opções alterados exigem novo preview. Produtos removidos/ocultos/inativos impedem mensagem. Link tem origem fixa https://wa.me e um parâmetro text codificado; o servidor não visita o destino nem verifica a existência da conta. WhatsApp requer envio manual pelo visitante.

Mensagem neutraliza controle, bidi, formatação e URLs em nomes, mantém quantidades/unidades e valores públicos, sem truncar produto ou total silenciosamente. O comprimento final é validado antes de devolver URL. Não cria pedido, cliente, reserva, estoque, recebível, pagamento, crédito ou obrigação.

## Segurança, Custo e Limites

Todas as respostas e erros usam no-store. Consulta pública usa CORS * sem credenciais; CORS/autenticação privados permanecem separados. Rules de Firestore/Storage continuam negando acesso direto. GET imagem entrega somente bytes WebP elegíveis, com caminho interno derivado e segundo snapshot após I/O; suspensão, despublicação e troca de imagem bloqueiam resposta antiga. Uma leitura JSON é coerente no snapshot da transação; alteração posterior não retira dados já obtidos pelo visitante.

Página padrão 25/máximo 50, prefixo de nome normalizado, categoria opcional e cursor vinculado a empresa, configuração e filtros. Não há offset, total global, busca textual completa ou varredura para completar páginas. Categoria pode produzir página vazia com cursor; frontend continua. Candidato privado do cursor é cifrado. Perfil não oferece diretório ou enumeração de empresas; catálogo desconhecido, desativado ou bloqueado usa a mesma indisponibilidade segura.

Limiter em memória barra excesso antes de JSON/Firestore: até 60 requisições/IP/minuto, ou configuração menor. Limiter Firestore compartilha limites entre instâncias: mesmo limite por IP, 600 por slug/minuto e dez POSTs de orçamento/link por IP/minuto. IPv6 usa ipKeyGenerator da biblioteca existente. Publicação e API privada têm buckets separados. Entradas inválidas falham antes do limiter Firestore. Contadores usam três leituras/escritas no máximo por POST; não são registros de orçamento.

Consulta de produtos/categorias limita candidatos a 51 e pode fazer uma leitura adicional por candidato para referência pública. Não lê estoque. Orçamento lê no máximo 200 produtos mais contexto e contadores. Limites técnicos: JSON 64 KiB, 200 produtos distintos por resumo, quantidades C até 1.000.000.000 unidades com até três decimais em KG/L, valor público até 100.000.000 centavos. Sem mínimo comercial. Preço oculto não depende desse limite monetário.

Mensagem até 12.000 caracteres e URL até 16.000; URI efetiva pode atingir limite antes da mensagem devido a codificação. Recusa integral com QUOTE_MESSAGE_LIMIT, sem truncamento. Limites externos de aplicativo/navegador podem ser menores; validação local não comprova entrega de mensagens em dispositivos. Muitos produtos podem ser revisados no preview e ainda exceder limite do link. Nenhuma divisão automática de pedidos ou nova fila.

Índices existentes cobrem produtos/prefixo/categoria e categorias ativas; catalog-indexes.mjs acrescenta índice de existência de produto publicado por categoria e quatro isenções. Total declarado: 126 índices, sem implantação. Emulador não comprova índices reais, custo, SLO ou resistência a ataque distribuído. Proteção volumétrica, retenção de contadores e infraestrutura ficam para publicação futura aprovada.

## Estados e Integração

CATALOG_UNAVAILABLE (404): catálogo desconhecido/desativado/assinatura bloqueada/empresa não ativa. PRODUCT_UNAVAILABLE (404): produto ausente, retirado ou de outro catálogo. PRODUCT_IMAGE_UNAVAILABLE (404): sem imagem elegível. QUOTE_CHANGED (409): atualizar preview e obter nova revisão. INVALID_QUANTITY/INVALID_PRECISION/QUANTITY_LIMIT_EXCEEDED (422): corrigir quantidade conforme unidade. QUOTE_VALUE_LIMIT (422): valor público excede limite técnico. QUOTE_MESSAGE_LIMIT (413): reduzir mensagem/itens. VALIDATION_ERROR (400/422/413), RATE_LIMITED (429) e CONFLICT seguem envelope existente. Nunca preencher dados privados em mensagens de erro.

React Native/Expo/Web usam API, sem acesso direto ao Firestore/Storage. Renderizar nome/descrição como texto, sem HTML ou autolink de conteúdo arbitrário. Usar imagePath como caminho relativo à origem da API. Cart alterado pede novo quote-preview. Frontend não calcula valores nem apresenta pedido confirmado, reserva garantida ou estoque exato. Não registrar reviewToken/carrinho/link em analytics; texto e itens passam ao WhatsApp somente quando visitante abre o link preparado.

## Fase G

Escopo de G ainda não foi aprovado. Persistência de orçamentos, identificação/consentimento do visitante, retenção, histórico comercial, conversão administrativa em pedido, documentos/fiscal, gateways/envio automático e compensações não entram em F. Integração visual pertence ao frontend Claude. Produção exige aprovação própria, medição de índices/custo/carga, política de limpeza dos contadores e validação de links em dispositivos reais. Snapshots grandes permanecem proposta separada, sem implementação.
