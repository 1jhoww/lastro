# Etapa 7 — Relatórios, documentos, exportações e catálogo público

Data: 15/10/2026. Escopo: frontend local, OpenAPI **0.8.1 / 114 operações** e backend existente. As Etapas 1–6 foram preservadas. Não houve alteração do backend, commit, push, deploy, acesso à produção, recurso pago ou envio de WhatsApp.

## Recomendação para homologação

**SIM COM RESSALVAS** para **iniciar a homologação funcional completa**. Os fluxos disponíveis no contrato foram integrados e exercitados localmente, com regressão dos módulos anteriores. Isso não representa autorização para produção ou homologação de dispositivos.

As ressalvas são: relatórios agregados sem contrato; builds nativos e seletor de compartilhamento ainda sem execução em Android/iOS; infraestrutura pública não provisionada; lacuna anterior na interface de devolução física. Essas limitações precisam entrar no roteiro de homologação, sem serem confundidas com recursos completos.

## Funcionalidades entregues

- Área administrativa **Relatórios**, com consulta paginada de pedidos por situação, cliente e direção de criação. Mostra valores oficiais por pedido e quantidade de registros carregados, sem inventar faturamento global ou somar rascunhos como vendas.
- Acesso aos relatórios financeiros existentes: títulos, vencimentos, atrasos, saldo, recebimentos por pedido, créditos, estornos, obrigações de reembolso e reconciliação. Venda, dinheiro recebido e obrigação manual continuam distintos.
- **CSV de clientes, produtos, pedidos e recebíveis**, com os filtros efetivamente disponíveis. Cada arquivo corresponde a uma página; metadados preservam contagem e cursor, inclusive quando a página contém zero registros. Não há concatenação de CSV ou varredura integral das coleções.
- **Pedido comercial não fiscal e romaneio sem preços** dentro do detalhe do pedido. O frontend valida status, mídia, assinatura e tamanho antes de criar arquivo. Mantém o nome seguro do servidor. Nunca recompõe o PDF com dados locais.
- Web: abertura por Blob temporário, download com nome original e compartilhamento por arquivos quando o navegador oferece essa capacidade. Android/iOS: bytes em cache privado e seletor nativo para abrir, salvar ou compartilhar, conforme aplicativos disponíveis.
- Limpeza de arquivos e revogação de URLs ao sair, trocar identidade/empresa ou desmontar a tela. Arquivos compartilhados fora do aplicativo não podem ser revogados. Falha de limpeza conserva a tentativa para a próxima troca; o uso no aplicativo já fica bloqueado pela revisão de sessão.
- Configuração administrativa do catálogo: slug, publicação, nome/descrição públicos, telefone internacional e visibilidade dos preços. Usa versão e intenção durável de `src/lib/intent.ts`; timeout mantém chave e corpo para repetição explícita. Slugs reservados e conflitos exigem revisão.
- Catálogo público em `/catalogo/[slug]`, sem login e com cliente HTTP sem Bearer ou `X-Tenant-Id`. Empresa, produtos, categorias, busca por prefixo, paginação, detalhes e imagens usam somente rotas públicas.
- Seleção de até 200 produtos em memória; quantidades inteiras ou de até três casas conforme unidade. Revisão oficial do servidor determina linhas, preços e total estimado em centavos. Preços ocultos permanecem `null`, sem reconstrução local.
- Preparação de WhatsApp com as mesmas linhas e `reviewToken`. Mudanças invalidam a revisão. O visitante abre, revisa e envia manualmente. Nenhum pedido, reserva, pagamento ou transferência é criado pelo catálogo.
- `Retry-After` é preservado; ações de documentos e orçamento aguardam o prazo informado e não repetem requisições automaticamente.
- Navegação existente ganhou Relatórios e Catálogo público. Configurações aponta às condições/formas já implementadas na Etapa 6. O catálogo mantém paleta, Inter e componente `lastro. by hepta` existentes.

## Endpoints integrados

Todos privados usam `/api/v1`, ID Token atual e `X-Tenant-Id`. Autorização final permanece no backend.

| Método    | Endpoint                                      | Uso                                                           |
| --------- | --------------------------------------------- | ------------------------------------------------------------- |
| GET       | `/orders`                                     | Relatório de pedidos por situação/cliente/direção, com cursor |
| GET       | `/orders/{id}` e `/orders/{id}/history`       | Detalhe e histórico existentes, acessíveis pelo relatório     |
| GET       | `/orders/{id}/documents/commercial.pdf`       | Pedido comercial histórico não fiscal                         |
| GET       | `/orders/{id}/documents/packing.pdf`          | Romaneio sem dados monetários                                 |
| GET       | `/exports/customers.csv`                      | Página CSV de clientes                                        |
| GET       | `/exports/products.csv`                       | Página CSV de produtos                                        |
| GET       | `/exports/orders.csv`                         | Página CSV de pedidos, limite 1–10                            |
| GET       | `/exports/receivables.csv`                    | Página CSV de títulos, limite 1–10 e vencimento inclusivo     |
| GET / PUT | `/catalog-settings`                           | Ler/configurar publicação; PUT idempotente e versionado       |
| GET       | `/public/catalogs/{slug}`                     | Identificação pública da empresa                              |
| GET       | `/public/catalogs/{slug}/products`            | Produtos publicados, prefixo/categoria/cursor                 |
| GET       | `/public/catalogs/{slug}/categories`          | Categorias públicas paginadas                                 |
| GET       | `/public/catalogs/{slug}/products/{id}`       | Detalhe público                                               |
| GET       | `/public/catalogs/{slug}/products/{id}/image` | Bytes WebP públicos, sem URL Storage                          |
| POST      | `/public/catalogs/{slug}/quote-preview`       | Revisão oficial das linhas e total estimado                   |
| POST      | `/public/catalogs/{slug}/whatsapp`            | Mensagem e link oficiais após revisão                         |

O acesso financeiro reutiliza os endpoints e telas registrados em [finance-progress.md](finance-progress.md), sem criar leitor paralelo ou executor novo. Os E2E também usam autenticação e rotas administrativas/comerciais já existentes para preparar fixtures sintéticas legitimamente.

## Validação e evidências

O baseline inicial passou **433/433 testes em 31 suítes**. O Jest terminou os testes com sucesso; a escrita inicial do JSON falhou porque a pasta de saída ainda não existia. A pasta foi criada, e a execução final grava o resultado completo normalmente. Nenhum teste anterior foi removido.

Suíte funcional atual: **524/524 testes, 37 suítes**, preservando os 433 anteriores e acrescentando **91 testes**. Inclui filtros/paginação, permissões, troca de empresa, CSV/PDF, recuperação de configuração após perda de resposta, estados inválidos, orçamento público, preços ocultos, revisão inválida, Retry-After e adapters nativos.

TypeScript strict e lint passaram sem erros ou avisos. Expo Doctor passou **21/21** após alinhar cinco patches exigidos do SDK 57: Expo 57.0.29, Metro Runtime 57.0.17, Constants 57.0.22, Linking 57.0.13 e Router 57.0.27. O alinhamento não muda a versão maior do SDK. Instalação limpa do lockfile e bundles finais têm evidência consolidada junto aos comandos abaixo.

| Verificação final                               | Resultado                                             |
| ----------------------------------------------- | ----------------------------------------------------- |
| `npm ci --no-audit --no-fund` no lockfile final | Aprovado, 1.166 pacotes; aviso de peer já documentado |
| TypeScript strict / lint / Prettier             | Aprovados                                             |
| Jest completo                                   | 524/524 testes, 37 suítes                             |
| Expo Doctor                                     | 21/21                                                 |
| HTTP real + emuladores locais                   | 17/17                                                 |
| Interface no bundle web final, Edge headless    | 9/9                                                   |
| Bundle web                                      | 2.765.836 bytes                                       |
| Bundle Hermes Android                           | 5.161.155 bytes                                       |
| Bundle Hermes iOS                               | 4.861.159 bytes                                       |
| Gradle/Xcode, APK/AAB/IPA e dispositivos        | Não executados: ambiente nativo indisponível          |

Comandos de reprodução, usando Node 24.19.0 para o frontend e o runtime Node 22.23.3 existente para a API local:

```powershell
npm ci --no-audit --no-fund
npm run typecheck
npm run lint
node node_modules/prettier/bin/prettier.cjs --check .
node node_modules/jest/bin/jest.js --runInBand
npx expo-doctor
npx expo export --platform all --output-dir .local/etapa7/export
node ../backend/node_modules/tsx/dist/cli.mjs scripts/e2e-etapa7.ts
node scripts/e2e-etapa7-web.cjs
```

E2E exige API/emuladores `demo-lastro-phase-a` já iniciados e `SEED_PASSWORD` efêmera no ambiente, nunca em documentação. O harness web usa Playwright disponível no runtime local e Edge, frontend em `http://localhost:8097`, API em `http://127.0.0.1:3000` e CORS com essa origem exata. A última execução web serviu o bundle exportado, não o servidor de desenvolvimento. Não usa perfil pessoal do navegador. A fixture privada gerada pelo HTTP deve ser apagada depois do E2E web.

Evidências versionáveis, sem credenciais:

- [HTTP real e hashes dos arquivos](evidence/etapa7-e2e.json): **17/17** verificações contra API real e emuladores Auth/Firestore/Storage.
- [Interface web](evidence/etapa7-web.json): **9/9** verificações em Edge headless, incluindo catálogo anônimo, revisão de orçamento, layout de 390px, login, relatório, download/abertura PDF, CSV, endereço público e revogação de Blob após logout sem reload.
- [Inspeção dos PDFs](evidence/etapa7-pdf.json): extração com pypdf, renderização com PDFium e revisão visual das páginas. Comercial com valores; romaneio sem `R$` ou total comercial.
- `docs/evidence/etapa7-validation.json`: comandos, contagens e hashes finais de validação.

Logs, PDFs sintéticos, capturas e bundles locais ficam em `.local/etapa7`, ignorados pelo Git. Não contêm dados de produção. Credenciais efêmeras do seed e fixture de login são apagadas ao finalizar. A API e os emuladores desta execução são encerrados sem afetar outros processos.

Falhas de integração encontradas e corrigidas: expectativa de 404 para filtro com cliente de outra empresa; remoção de carteira com `assignedTo:null` conforme contrato; papel de link dos botões de navegação web; carregamento da imagem pública por bytes CORS, reutilizando a leitura de Blob existente. O backend não foi relaxado para acomodar testes.

## Limitações do contrato e necessidades futuras do backend

- Não existe endpoint de relatório agregado, faturamento global, vendas por período/vendedor/produto ou recebimentos globais por período. `/orders` e seu CSV não aceitam esses filtros. Não há soma global calculada a partir das páginas carregadas.
- Não existe CSV de estoque, movimentações, créditos, estornos, reembolsos ou reconciliação. Os históricos financeiros continuam disponíveis nos fluxos da Etapa 6, conforme seus contratos.
- CSV é uma página, sem snapshot global entre requisições. Alterações concorrentes podem mudar os resultados. O operador precisa salvar cada página antes de continuar. A página seguinte conserva exatamente filtros e limite.
- Limites do backend: CSV de até 1 MiB; PDF de até 8 MiB e 100 páginas; prazo/cota de geração e limites por usuário. Reduzir página CSV ou revisar o pedido quando necessário, sem dividir confirmação comercial para contornar limites.
- PDFs não são NF-e, documento fiscal, comprovante de entrega ou prova de restituição. Execução financeira pendente pode impedir emissão. `DOCUMENT_CHANGED` exige recarregar o pedido.
- Catálogo não converte orçamento em pedido, não coleta identificação do visitante, não confirma aprovação e não usa API oficial do WhatsApp. Constituir reembolso não transfere dinheiro.

Se esses requisitos entrarem em nova etapa, é necessário primeiro aprovar contratos no backend, por exemplo:

| Necessidade              | Contrato futuro proposto, ainda inexistente                                                                           | Justificativa                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Indicadores comerciais   | `GET /reports/sales` com período/fuso, situação, cliente, vendedor e produto, agregados inteiros e escopo documentado | Evitar totais parciais ou mistura de rascunhos/cancelamentos com vendas            |
| Recebimentos por período | `GET /reports/receipts` com data efetiva, estornos e critérios de apuração explícitos                                 | Diferenciar venda, recebimento, estorno, crédito e dinheiro efetivamente devolvido |
| Estoque CSV              | `GET /exports/inventory.csv` com filtros, paginação e colunas autorizadas                                             | A exportação não pode ser simulada por leitura integral no frontend                |
| CSV consolidado          | Operação de exportação com snapshot/expiração/limites de arquivo e autorização definidos                              | Página atual não promete consistência global entre downloads                       |

Esses caminhos são propostas documentais, não endpoints implementados ou chamados.

## Matriz de cobertura do MVP

“Implementado e testado” significa evidência funcional local, não aprovação em dispositivo ou produção. A regressão atual preserva os testes anteriores; os E2E das Etapas 6 A/B/C são evidências históricas identificadas, não reexecuções nesta entrega.

| Requisito                              | Classificação                    | Evidência e limite                                                                                                                                                                               |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Autenticação, convite e permissões  | Implementado e testado           | Suítes auth/session/routes/permissions preservadas; login real e bloqueios de vendedor/plataforma no E2E E7; convites reais usados nas fixtures                                                  |
| 2. Clientes e produtos                 | Implementado e testado           | Suítes de telas/formulários preservadas; criação real, seleção pública, imagem e transferência de carteira no E2E E7                                                                             |
| 3. Cadastro e movimentação de estoque  | Implementado e testado           | Suítes inventory e regras preservadas; entrada real no E2E E7 e evidências anteriores; sem CSV de estoque                                                                                        |
| 4. Criação e confirmação de pedidos    | Implementado e testado           | Suítes orders preservadas; pedido real do vendedor confirmado no E2E E7                                                                                                                          |
| 5. Reserva e baixa física              | Implementado com limitação       | Reserva real na confirmação E7; expedição coberta por testes anteriores e evidência Etapa 6. Interface de intenção/recebimento de devolução física permanece ausente; não foi criada nesta etapa |
| 6. Recebíveis e baixas                 | Implementado e testado           | Suítes financeiras preservadas e E2E A/B/C históricos; CSV E7 verifica vencimento e saldo oficial de pedido confirmado                                                                           |
| 7. Créditos, estornos e reembolsos     | Implementado com limitação       | Suítes B/C e E2E anteriores. Confirmação de reembolso exige prova manual; nenhuma transferência bancária existe                                                                                  |
| 8. Cancelamentos e executor financeiro | Implementado e testado           | Suítes C preservadas; 30 verificações HTTP e 5 de IndexedDB registradas no checkpoint C. Nenhum cenário de 20.000 fontes foi repetido no frontend                                                |
| 9. Relatórios e exportações            | Implementado com limitação       | Relatório de pedidos, acesso financeiro e quatro CSVs testados por HTTP/web. Indicadores agregados e filtros não suportados continuam ausentes                                                   |
| 10. PDFs comerciais e romaneios        | Pendente de teste em dispositivo | HTTP/web, conteúdo e layout testados; adapters nativos testados com sistema de arquivos/compartilhamento simulados. Seletor real Android/iOS ainda pendente                                      |
| 11. Catálogo público e WhatsApp        | Pendente de infraestrutura       | Fluxo local HTTP/web testado. Faltam hospedagem, domínio/HTTPS, origem pública nativa e revisão de envio no WhatsApp real; catálogo não cria pedido                                              |
| 12. Empresas e assinaturas             | Implementado com limitação       | Telas da plataforma e testes de permissão preservados; empresas, plano e vínculos usados legitimamente nas fixtures. Cobrança/assinatura continua manual, sem gateway de pagamento               |

Lacunas adicionais identificadas, sem implementação fora de escopo: **ausente** a interface de devolução física por intenção/recebimento; **ausentes** relatórios agregados e CSVs além dos quatro contratados; **pendentes de infraestrutura** cobrança integrada, operação/monitoramento e publicação pública.

## Web, Android e iOS

- Web: Edge headless real, desktop 1440px e viewport 390px. Viewport de celular não equivale a Safari/Chrome móvel real. Compartilhamento de arquivo depende de Web Share/capacidade do navegador e contexto seguro; o download permanece disponível como alternativa.
- Android/iOS: adaptações do Expo SDK 57 usam `expo/fetch`, `expo-file-system` e `expo-sharing`. Compartilhamento é por URI local privada e MIME/UTI, nunca por endpoint privado com token no URL. O destinatário ou aplicativo é escolhido manualmente.
- Não há Android SDK/adb/Gradle nem Xcode neste ambiente Windows. Não foram gerados APK/AAB/IPA, build assinado ou compilação Gradle/Xcode. Exportação Hermes compila JavaScript, não o aplicativo nativo completo.
- Não houve dispositivo físico, emulador Android ou simulador iOS. Permanecem pendentes: permissões do sistema, aplicativo leitor PDF, opção Salvar em Arquivos, WhatsApp instalado/ausente, retorno do seletor, cancelamento, bloqueio do aparelho e limpeza após encerramento abrupto.
- O servidor autoriza cada emissão. Documento salvo/compartilhado fora do Lastro permanece com o destinatário após transferência de carteira, logout ou revogação de acesso.

Referências usadas para a integração nativa: [FileSystem SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/) e [Sharing SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/).

## Arquivos desta entrega

Novos módulos:

- `src/features/files/{api,contracts,fileEpoch,presentation,presentation.native}.ts`, `FileActions.tsx`, `OrderDocuments.tsx`.
- `src/features/reports/ReportAccess.tsx`, `exportRules.ts`.
- `src/features/publicCatalog/{api,rules}.ts`, `PublicCatalogScreen.tsx`, `PublicProductImage.tsx`.
- `src/app/(app)/relatorios/{index,pedidos,exportacoes}.tsx`, `src/app/(app)/configuracoes/catalogo.tsx`, `src/app/catalogo/_layout.tsx`, `src/app/catalogo/[slug]/index.tsx`.
- `src/api/defaultFetch.ts`, `defaultFetch.native.ts`, `src/lib/blob.ts`, `useCooldown.ts`, `metro.config.js`.
- `tests/unit/etapa7{Rules,Downloads,NativeFiles,CatalogIntent}.test.ts`, `etapa7Screens.test.tsx`, `etapa7FileActions.test.tsx`.
- `scripts/e2e-etapa7.ts`, `scripts/e2e-etapa7-web.cjs`, quatro evidências `docs/evidence/etapa7-*.json` e este relatório.

Arquivos existentes ajustados:

- `src/api/{client,types,errors}.ts`: transporte binário nativo, aliases contratuais e `Retry-After` opcional, preservando o cliente privado existente.
- `src/session/SessionContext.tsx`, `src/navigation/{RootNavigator,destinations}.tsx/ts`: cliente público sem credenciais, rota pública e invalidação de arquivos por sessão/empresa.
- `src/app/(app)/pedidos/[id]/index.tsx`, `src/app/(app)/configuracoes/index.tsx`: documentos e links existentes.
- `src/features/products/api.ts`: apenas extração do helper já existente de leitura de Blob para reutilização pública.
- `src/lib/intent.ts`: novo tipo de intenção de configuração do catálogo, sem alterar transições financeiras.
- `src/features/finance/FinancialRecovery.tsx`: exclui configuração do catálogo do aviso de intenções financeiras, sem mudar recuperação ou comandos da Etapa 6.
- `src/config/env.ts`, `.env.example`: origem web opcional para copiar link do catálogo no aplicativo nativo.
- `tests/support/renderApp.tsx`: rota pública na estrutura de testes do roteador.
- `package.json`, `package-lock.json`, `app.json`: módulos Expo compatíveis e plugin de compartilhamento. `docs/finance-progress.md`: ponte para esta entrega.

O checkout já continha alterações e arquivos não rastreados de etapas anteriores. Esta relação delimita E7; não implica diff limpo desde um commit. O backend foi somente lido/executado.

## Pendências e riscos

- Configurar hospedagem web com fallback de rotas para `/catalogo/:slug`, domínio, HTTPS, origens privadas exatas e origem web nativa (`EXPO_PUBLIC_WEB_BASE_URL`). A URL local de teste não é endereço público distribuível.
- Configurar ambientes de homologação/produção separadamente, sem emuladores, revisar domínio autorizado do Firebase, regras/índices, observabilidade e limites. Não criar infraestrutura automaticamente nesta entrega.
- Homologar APK/AAB e iOS em ambiente de build apropriado, módulos nativos e seletor de compartilhamento; exportar bundles não encerra essa pendência.
- Arquivos usam limites técnicos por resposta. O frontend não promete exportação integral ilimitada, snapshot consistente entre páginas ou eliminação de cópias externas.
- Intenções financeiras permanecem duráveis conforme Etapa 6; intenções comerciais/estoque anteriores conservam as limitações registradas naquele checkpoint.
- Aviso de peer `test-renderer/react-reconciler` versus React da distribuição Expo permanece. Não houve upgrade geral para ocultar aviso ou `npm audit fix --force`.
- `npm audit` no lockfile final registrou **71 ocorrências: 54 high, 17 moderate, zero critical**. O relatório inclui dependências de execução e ferramentas de desenvolvimento, com cadeias de Expo, React Native e Firebase. Expo Doctor não é auditoria de segurança. Corrigir e verificar aplicabilidade em tarefa própria antes de produção; não aplicar atualização geral ou forçada durante esta integração financeira.

## Checklist para homologação funcional

- [ ] Executar os 12 fluxos da matriz com perfis administrador, vendedor e plataforma, incluindo bloqueio/suspensão e acesso direto.
- [ ] Trocar empresa/usuário com download e consulta pendentes; confirmar que nenhum arquivo ou filtro anterior aparece.
- [ ] Conferir CSV em Excel/LibreOffice: BOM, delimitador, fórmulas neutralizadas, acentos, quebras em células, vazio com cursor e continuação com os mesmos filtros.
- [ ] Conferir comercial e romaneio com pedidos longos, preços históricos, descontos, cancelamento, expedição e execução financeira pendente.
- [ ] Testar ausência de rede, resposta perdida na configuração, conflito de versão, slug reservado, quota/Retry-After e sessão expirada.
- [ ] Testar catálogo desativado, produto oculto/inativo, categoria removida, preços ocultos, quantidades e `QUOTE_CHANGED` antes de WhatsApp.
- [ ] Validar fluxo real de leitura/salvamento/compartilhamento Android/iOS e navegação móvel, incluindo cancelamento e aplicativo ausente.
- [ ] Registrar decisão sobre relatórios agregados, CSV de estoque e interface de devolução física antes de declará-los cobertos.

## Checklist de preparação para produção

- [ ] Resolver riscos de dependências e revisar política de atualização do SDK em tarefa própria.
- [ ] Aprovar homologação funcional completa e testes físicos; gerar builds assinados no ambiente correto.
- [ ] Configurar serviços, credenciais, domínios, HTTPS/CORS e versões de backend/frontend homologadas, com segregação de ambientes.
- [ ] Revisar regras/índices, backup/restauração, retenção, idempotência, limites técnicos, cotas, alertas e operação financeira manual.
- [ ] Validar política de privacidade/compartilhamento, autorização por carteira e tratamento de arquivos externos.
- [ ] Definir rollback, suporte, monitoramento e autorização explícita antes de qualquer deploy. Nenhuma destas ações foi executada nesta etapa.
