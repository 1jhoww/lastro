# Fase B — Clientes, carteiras, produtos e categorias

Implementação exclusivamente local, preservando a fundação. Nenhum estoque, pedido, financeiro, catálogo público ou frontend implementado. Nenhum deploy, commit, push, banco produtivo ou alteração na Atual Pet.

## Endpoints novos

Prefixo /api/v1; todos exigem Bearer e X-Tenant-Id autorizado. As 17 operações da Fase A continuam registradas; a Fase B acrescenta 19, totalizando 36 no OpenAPI.

| Método               | Rota                       | Comportamento                                |
| -------------------- | -------------------------- | -------------------------------------------- |
| GET / POST           | /customers                 | Listar com filtros / criar                   |
| GET / PATCH / DELETE | /customers/{id}            | Consultar / editar / desativar               |
| PATCH                | /customers/{id}/assignment | Transferir ou remover responsável            |
| GET / POST           | /products                  | Listar / criar                               |
| GET / PATCH / DELETE | /products/{id}             | Consultar / editar / desativar               |
| PUT / GET / DELETE   | /products/{id}/image       | Upload / bytes privados / remover associação |
| GET / POST           | /categories                | Listar / criar                               |
| GET / PATCH / DELETE | /categories/{id}           | Consultar / editar / desativar               |

DELETE de cadastros usa body expectedVersion, sem excluir o documento; PATCH administrativo status=active reativa. Transferência recebe assignedTo=UID|null e expectedVersion. Imagem PUT/DELETE recebe expectedVersion na query. Nenhuma rota aceita tenantId, autor ou versões persistidas como campos editáveis.

## Regras e escolhas

Administrador gerencia todos os clientes, com ou sem responsável. Vendedor cadastra cliente atribuído ao próprio UID e edita dados comerciais somente dos próprios clientes. Não escolhe/transfere responsável nem altera status. Responsável indicado pelo administrador deve ser identidade/vínculo ativos de vendedor da mesma empresa. Perfil alterado/desativado não causa redistribuição automática; administrador transfere carteiras preservadas. Versão e revalidação transacional impedem sobrescrita de decisão recente.

CPF/CNPJ opcional tem validação matemática, normalização e reserva transacional por empresa. CNPJ numérico e alfanumérico são suportados, conforme [manual oficial do DV](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf). Não há consulta fiscal externa ou confirmação de situação cadastral. Telefone elimina formatação; email é normalizado; endereço é parcial, com CEP/UF normalizados e país BR neste recorte. Cliente pode nascer sem endereço, telefone ou documento.

SKU obrigatório normalizado para maiúsculas, 1..64 caracteres, letras/números e ._-; reserva transacional única por tenant. Cliente/produto inativo mantém documento/SKU reservado. Alterar chave libera reserva anterior e adquire nova na mesma transação. Sem cobrança adicional por perfil ou mudança de preço automática de plano.

Um preço padrão em centavos, entre 0 e 100.000.000; somente administrador o modifica. UN/CX/PCT têm precisão futura zero; KG/L três casas. Não há quantidade, saldo, conversão ou tabela de preços implementados. Snapshot de pedidos é requisito futuro. Categorias inativas preservam referências e são consultáveis, mas não podem receber novas vinculações; produtos existentes não são desativados por cascata.

Busca por prefixo normalizado de nome (sem acentos/maiúsculas), limitada e indexada. Ordenação name|createdAt asc|desc; q exige name asc. Clientes filtram estado/responsável; produtos filtram estado/categoria/SKU/visibilidade. Não há texto completo, pesquisa por nota/documento, offset ou total por varredura. Cursores têm assinatura e escopo de ator/tenant/coleção/filtros/ordem. Veja [índices e custo](architecture/data-model.md).

## Imagens privadas

Fluxo completo local com [Storage Emulator e Admin SDK](https://firebase.google.com/docs/emulator-suite/connect_storage). Upload aceita apenas bytes JPEG/PNG/WebP; MIME conferido pelo decoder, máximo 5 MiB/16 milhões de pixels/lado 8192, sem animação. Recodificação WebP remove metadados. Não aceita URL, SVG, multipart, caminho ou nome original. Limite de 30 tentativas/hora por UID, compartilhado no Firestore.

Caminho derivado pelo servidor: tenants/{tenantId}/products/{productId}/{UUID}.webp. Firestore guarda somente referência e propriedades; nenhuma URL pública é gerada. Regras negam acesso Firebase Storage direto; leitura pela API revalida identidade, tenant, assinatura e produto ativo para vendedor. Resposta binária WebP privada/no-store/nosniff. catalogVisible não torna arquivo público.

Upload salva objeto imutável e depois associa em transação versionada. Perdedor/falha tenta excluir somente seu objeto. Remoção/substituição deixa objetos antigos privados e inacessíveis pela API; interrupção pode gerar órfãos. Não há limpeza automática/TTL nesta fase. Produção requer retenção aprovada, IAM/bucket privado e procedimento de reconciliação. Catálogo futuro deverá usar área pública separada e retirada de publicação em suspensão/inativação; esse mecanismo ainda não existe.

## Arquivos criados e alterados

Criados:

- src/modules/customers/customerService.ts e documents.ts;
- src/modules/products/productService.ts e imageService.ts;
- src/modules/categories/categoryService.ts;
- src/shared/schemas/commercial.ts;
- src/infrastructure/repositories/commercialRepository.ts;
- src/app/commercialRoutes.ts;
- storage.rules e scripts/commercial-indexes.mjs;
- tests/helpers/commercial.ts e commercial.test.ts em unit/integration/security/concurrency;
- docs/adr/0004-carteiras-e-unicidade.md, 0005-imagens-privadas.md, validation-phase-a.md e phase-c.md.

Alterados: src/app/app.ts/routes.ts, config/env.ts, infrastructure/firebase/client.ts, middlewares/rateLimit.ts/errorHandler.ts, modules/auth/openapi.ts; firebase.json, firestore.indexes.json, .env.example, package.json/package-lock.json; tests/helpers/fixture.ts, tests/unit/config.test.ts e tests/integration/foundation.test.ts; README raiz/backend, CONTEXT.md, documentos de arquitetura/permissões/segurança/validação/contrato frontend, OpenAPI e tipos gerados. Sharp é a única dependência direta nova.

O teste antigo de revogação manteve sua expectativa 401; foi adicionado intervalo de 1,1 segundo antes da troca de email para respeitar a precisão em segundos do provedor e eliminar resultado dependente da velocidade. Nenhum teste anterior foi removido ou afrouxado.

## Executar e validar

Siga [README](../README.md); Java 21, Node LTS e portas 8080/9099/9199 disponíveis. Sessão demo de desenvolvimento mantém o identificador demo-lastro-phase-a por compatibilidade da fundação. Testes usam demo-lastro-tests com todos os serviços emulados. Emuladores nunca devem ser expostos publicamente.

Rode em terminais separados: npm run emulators; depois npm run seed:local e npm run dev. Swagger: http://127.0.0.1:3000/docs. Faça login sintético segundo README, crie tenant por convite e use token do vínculo aceito para operar cadastros. Não use token do Super Admin como acesso comercial automático.

Para testes, pare desenvolvimento e execute npm test e npm run test:integration; typecheck, lint, format:check, build, openapi e types:api completam verificação. Se npm global estiver quebrado, use pwsh -File scripts/npm.ps1 run NOME. Resultados reais em [validação](validation.md), riscos em [segurança](security.md), continuidade em [Fase C](phase-c.md).
