# Lastro — saneamento dos bloqueios de pré-publicação

Data: 18/10/2026. Base Git `4051f03e78f57f42b5ccc6f7b376c8814e3daa5c`, com alterações anteriores das Fases 7–9 preservadas. Este relatório atualiza as propostas dos diagnósticos de pré-publicação, sem reescrever evidência histórica.

**Resultado: correções locais preparadas e validadas; publicação continua bloqueada. Nenhum commit, push, deploy ou alteração de recurso remoto foi realizado.** A instrução posterior do usuário prevalece: não criar recursos que gerem custo agora; permanecer nos créditos de teste. A referência de R$100 não autoriza cobrança nem upgrade da conta.

## 1. Correções locais

- Override de `decode-uri-component` para 0.5.0. A entrada malformada que excedia dois segundos no consumidor real agora termina em cerca de 56 ms, em processo filho com timeout. Corrige o caminho `Expo Router → query-string 7.1.3 → decode-uri-component` presente no bundle web.
- Patch mínimo em `query-string 7.1.3` para acessar `.default` do decoder ESM. Mantém a API CommonJS usada pelo Router. `patch-package 8.0.1` e `postinstall --error-on-fail` tornam a instalação reproduzível e interrompem mudanças incompatíveis. Jest passa a transformar o decoder ESM. Não foi aplicado downgrade do Expo ou atualização principal incompatível de query-string.
- Override de `@grpc/grpc-js` para 1.14.6, com compatibilidade de cliente/SSL testada. Override restrito `xcode → uuid 11.1.1`, preservando `generateUuid()` com 24 caracteres hexadecimais maiúsculos e unicidade.
- Node 24.22.0 LTS padronizado nos dois pacotes, `.node-version`, engines `>=24.22.0 <25`, CI, Dockerfile e guardas de build/servidor. Frontend agora usa `npm run build` também no `vercel.json` local. `.npmrc` do frontend passa a exigir engine compatível. O wrapper PowerShell não escolhe mais Node 22 portátil por cima de um PATH compatível.
- Novo ciclo de encerramento: SIGTERM/SIGINT disparam um único drain; novas operações e readiness recebem 503; promises reais de handlers, autenticação, limitadores e RPC de readiness continuam contadas após timeout da resposta. SDK só encerra após conexões e operações terminarem. Prazo 9 s sai com falha antes do SIGKILL de 10 s do Cloud Run. Não há garantia de rollback financeiro após interrupção; preservar idempotência e reconciliar estado.
- Startup/liveness propostos em `/health/live`, sem Firestore; readiness dependente continua separada, com cache/single-flight. O prazo da aplicação de 120 s continua intacto. Proposta remota de 130 s preparada, mas Cloud Run permanece em 60 s até autorização.
- `.dockerignore`, `.gcloudignore`, `.vercelignore` de raiz/frontend e `.gitignore` protegem entradas de publicação contra env privado, chaves, caches, relatórios e grafo gerado. Arquivos já rastreados em `graphify-out` não foram removidos ou alterados para limpeza.
- `scripts/prepare-release-candidate.mjs` gera inventário por allowlist, hashes e scan por assinaturas; não faz staging, cópia, commit ou exclusão. Inclui fontes, assets/licenças, contratos, lockfiles, patches, configs, testes e propostas. Exclui evidências brutas e temporários mesmo se já rastreados. Manifesto completo fica em `backend/.local/saneamento/candidate-files.json`.

Nenhum `npm audit fix --force` foi executado. Nenhuma coleção, seed persistente, cache de usuário, arquivo de credencial ou dado comercial local foi apagado. Instalação limpa e emuladores usam diretórios e projeto de teste isolados.

## 2. Vulnerabilidades corrigidas e pendentes

Auditoria `npm audit --omit=dev`: antes 67 pacotes sinalizados, sendo 50 high e 17 moderate; depois 51, sendo 46 high e 5 moderate. São contagens de pacotes afetados e cadeias transitivas, não 51 falhas independentes. Avisos únicos caíram de sete para três. A instalação limpa retornou os mesmos 51 no escopo omit-dev. Auditoria com desenvolvimento na árvore principal: 56 pacotes sinalizados, mesmos três avisos únicos. Backend: zero avisos no escopo omit-dev.

| Dependência          | Afetado / instalado antes | Correção local                  | Caminho e compatibilidade                                                                                                                        |
| -------------------- | ------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| decode-uri-component | <=0.4.2 /0.4.2            | 0.5.0                           | Presente em Expo Router/query-string e no web. Patch de interop de uma linha, testes do consumidor, exports web/Android e Chrome local aprovados |
| @grpc/grpc-js        | <1.13.6 /1.9.16           | 1.14.6                          | Transporte Node transitivo do SDK Firestore; ausente no web exportado. Duas vulnerabilidades resolvidas; API CommonJS/SSL verificada             |
| uuid                 | <11.1.1 /7.0.3 no xcode   | 11.1.1 somente nesse consumidor | Ferramenta de projeto nativo; mantém CommonJS/v4. Sem override global sobre implementações independentes                                         |

Referências: [decoder](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), [gRPC1](https://github.com/advisories/GHSA-m9gg-hp2v-232j), [gRPC2](https://github.com/advisories/GHSA-f596-whhp-79r4), [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Versões afetadas foram conferidas nos avisos e instalação, sem confiar apenas na recomendação automática do npm.

| Pendente             | Afetado / instalado | Exposição avaliada                                                                                                                    | Motivo para permanecer / condição de liberação                                                                                                                                                                                                   |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| braces, high         | <=3.0.3 /3.0.3      | micromatch nas cadeias Metro/Jest/CLI; padrão profundamente aninhado pode esgotar stack. Não consta no bundle web final               | Nenhuma versão corrigida publicada no aviso consultado. Não inventar um parser/patch nem fazer downgrade do framework. Restringir entradas de tooling a fontes revisadas; exigir correção upstream ou aceite de risco explícito antes de liberar |
| node-forge, high     | <=1.4.0 /1.4.0      | Expo CLI e `@expo/code-signing-certificates`; verificação RSA PKCS#1v1.5 pode aceitar DigestAlgorithm extra. Não consta no web        | Sem versão corrigida no aviso consultado. Alterar criptografia localmente seria arriscado. Não usar material de assinatura/certificado não confiável; assinatura/distribuição nativa continua pendente                                           |
| sprintf-js, moderate | <=1.1.3 /1.0.3      | `@istanbuljs/load-nyc-config → argparse 1.0.10 → sprintf-js`; formatação com precisão não limitada pode causar DoS. Não consta no web | Atualizar para 1.1.3 ainda seria vulnerável. Jest 30 não é substituição validada do preset Expo/Jest 29. Não passar formatos externos ao tooling; aguardar correção ou migração compatível avaliada                                              |

Avisos sem versão corrigida: [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). A sugestão automática de Expo 44 para node-forge é downgrade de várias versões principais; foi rejeitada. Ausência no bundle reduz a exposição do navegador, mas não elimina risco na instalação, build ou canal nativo. Não há aceite automático de vulnerabilidade.

O sourcemap final contém `decode-uri-component/index.js` cujo conteúdo coincide integralmente com o pacote instalado0.5.0. gRPC, uuid, braces, node-forge e sprintf-js não aparecem nessa lista de módulos. Essa conclusão cobre o export web inspecionado, não todos os artefatos futuros. Scan do export não encontrou chave privada, JWT ou valores privados conhecidos dos envs locais; não é prova exaustiva de ausência de segredos.

## 3. Node e builds

Escolha: Node 24.22.0 LTS. Expo 57 aceita Node 22.13+, mas Firebase 13 já instalado exige Node >=24.12 em pacotes App/Auth/AI. Node 22.23.3 deixou de atender a instalação estrita do frontend, independentemente do build backend anterior. Não rebaixar Firebase para contornar engine. [Expo 57](https://docs.expo.dev/versions/v57.0.0/), [Firebase JS](https://firebase.google.com/support/release-notes/js), [Node LTS](https://nodejs.org/en/about/previous-releases).

Binário oficial Windows x64 foi extraído somente em `frontend/.local/saneamento/node24/node-v24.22.0-win-x64`; SHA-256 conferido com `SHASUMS256.txt`: `F9683A19877E12A9B167305C8DB71040D812876359DE21F0D2E97C3F321F80C3`. Instalação global Node 22.23.3 permanece intacta.

Build backend compilado e smoke de assets/PDF/Sharp passaram com Node 24.22.0/OpenSSL 3.5.8. Export web de 3,1 MB e Android de 5,6 MB passaram. Instalação `npm ci` isolada aplicou o patch e exportou web com sucesso. O identificador de bundle coincide, mas os SHA-256 dos arquivos diferem entre exports; não se afirma reprodução binária idêntica. O bundle principal e o export final explícito têm o mesmo SHA-256, então o smoke Chrome cobre ambos. O primeiro teste dessa cópia falhou porque o filtro `.local` do Metro excluía o próprio host de teste; foi removido somente da cópia isolada, mantendo o filtro na fonte principal. Build final da fonte principal também passou com dotenv desativado e apenas variáveis demo explícitas.

Vercel suporta24.x e já está configurado nessa linha, mas escolhe minor/patch automaticamente. Não é possível prometer pin exato24.22.0 no serviço. O guard de build recusa versões24 anteriores ao mínimo e majors futuras. A build efetiva da Vercel ainda precisa registrar `node --version`; nenhuma build remota foi disparada. [Versões Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Dockerfile agora referencia `node:24.22.0-bookworm-slim` em ambos os estágios. Docker Desktop foi iniciado localmente, mas o engine Linux não disponibilizou o pipe. Imagem Linux não foi construída nem executada; não se substituiu por build remoto pago. Permanecem pendentes instalação nativa Linux, digest da imagem e smoke PDF/Sharp/Firebase nesse ambiente. Export Android não comprova instalação/teclado/TalkBack em dispositivo.

## 4. Operações remotas prontas para revisão

Pacote completo: [ops/prepublication/README.md](../../ops/prepublication/README.md), com nove grupos independentes, atual/proposto/justificativa/risco/reversão e restrição de custo. Arquivos `*.proposal.json` são especificações de revisão; não executar como substituição integral de recursos.

G1 contém individualmente 16 índices; G2 contém cinco campos. G3 limpa três valores Vercel com BOM, sem ler segredos de preview. G4 preserva viewer e propõe somente a nova permissão `firebaseauth.users.update` no runtime SA. G5 separa proteção de exclusão de PITR. G6 separa diário 7d, semanal 35d e ensaio de restauração. G7 cobre timeout/probes/segredo/caps. G8 contém alertas desativados, contato privado e referência de orçamento. G9 contém matriz sintética, sem contas comerciais.

Nenhum desses grupos autoriza commit, push, nova build, deploy, envio de e-mail, criação de conta de teste ou promoção comercial. G1/G5-PITR/G6/G7/G8-periódico/G9 ficam adiados enquanto não houver autorização compatível com o custo. G2/G3/G4 e proteção contra exclusão precisam de aprovações próprias, mesmo sem nova infraestrutura.

## 5. Segurança e operação

Autenticação valida Bearer com limite de 8192, assinatura/audience/issuer via Firebase Admin e revogação real (`verifyIdToken(...,true)`). Usuário Firebase e identity Lastro desabilitados são recusados. Tenant não vem de claim confiada cegamente: header passa por validação, vínculo atual e permissões no banco. Rotas da plataforma exigem sessão recente de até 300 s. `PATCH /me` altera somente displayName do UID autenticado, com objeto estrito e nome normalizado.

Runtime usa ADC pela service account do Cloud Run. Snapshot não encontrou chaves gerenciadas pelo usuário nessa conta. Secret Accessor limita-se ao segredo de convite, mas referência `latest` deve ser fixada na versão 1 após aprovação. Nenhum valor de segredo foi lido para corrigir código. Não baixar configuração Auth integral: pode conter material de hash sensível. Arquivos env/OIDC existentes continuam privados e excluídos do candidato.

IAM atual viewer não permite atualizar nome/desbloquear usuário: bloqueio real ainda remoto. Papel customizado aditivo propõe somente `users.update`; mantém viewer existente e dispensa Auth Admin. Eventual retirada de permissões antigas de leitura exige análise e aprovação separadas. `users.update` continua amplo dentro do projeto; não permite limitar apenas displayName, portanto os testes de identidade e escopo são obrigatórios. Editor na service account padrão Compute é achado separado: revisar consumidores antes de remoção, sem alterar agora.

CORS privado exige origem HTTPS exata e não usa cookies/credentials. O catálogo público usa `*` sem credentials deliberadamente. Preview não autorizado segue negado. CORS não substitui autenticação. Proxy mantém somente `169.254.169.126/32`, sem confiança global ou por número de hops; peer e headers reais ainda exigem teste remoto. Não ampliar rede para fazer teste passar.

Rate limit mantém memória antes de parsing/Auth, orçamento privado distribuído 180/IP/min e limites públicos próprios. Saturação não grava novo contador; TTL de `rateLimits.expiresAt` segue ativo no snapshot. Limitador público de memória é por instância; camada Firestore coordena instâncias. Não aumentar limites ou instâncias sem ensaio remoto. Requests rejeitados ainda podem consumir backend/Firestore antes de autenticar. TTL do Firestore já existente também pode gerar cobrança; nenhum TTL novo foi ativado.

API key pública Firebase tem restrição de APIs extensa e nenhuma lista de HTTP referrers efetiva no snapshot. Não é segredo de servidor nem prova de acesso ao banco. Redução de APIs/referrers exige avaliar web e nativo separadamente; não aplicar restrição browser que quebre Android. Rules, bucket IAM/ACL e condição de conta paga permanecem pontos de revisão antes de publicação comercial. Não ativar App Check/MFA ou trocar Storage/credenciais automaticamente neste saneamento.

Matriz preparada em [remote-validation.md](../../ops/prepublication/remote-validation.md): login real, senha errada, ausência/assinatura/expiração/revogação, desabilitação, perfil persistente, injeção de UID/campos, tenantA/B, carteira de vendedor, CORS/proxy/rate limiting e índices. Nenhuma conta comercial foi usada; testes remotos não foram executados.

## 6. Testes e evidências desta rodada

| Verificação                                      | Resultado                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Backend build, assets/licenças, PDFs e Sharp     | Passou em Windows/Node 24.22.0                                                                    |
| Typecheck e lint dos dois pacotes                | Passaram na versão final                                                                          |
| Backend unitário                                 | 25 arquivos, 326 testes passaram                                                                  |
| Direcionados lifecycle/httpProtection/readBudget | 27 testes passaram; inclui RPC readiness após timeout                                             |
| Frontend unitário                                | 50 suítes, 616 testes passaram                                                                    |
| Compatibilidade de dependências/runtime          | 6/6 na árvore principal e 6/6 após npm ci isolado                                                 |
| Contratos OpenAPI/tipos                          | Geração do backend coincide; dois JSONs e ambos os tipos coincidem por SHA-256                    |
| Web e Android                                    | Exportaram; web repetido com dotenv desativado e configuração demo                                |
| Instalação limpa                                 | npm ci isolado, patch aplicado, seis testes e build web passaram                                  |
| Chrome local a 390 px                            | Login renderiza consulta Unicode e consulta malformada de 12.290 bytes; zero pageerrors;377/347ms |
| Dependências backend                             | npm audit --omit=dev: zero                                                                        |
| Dependências frontend                            | 51 pacotes no omit-dev, três avisos únicos pendentes; mesmo resultado na instalação limpa         |
| Scan de candidato/export                         | Nenhum achado pelas assinaturas e valores privados conhecidos; limite metodológico registrado     |
| Integração/regressão emulada                     | 51 arquivos, 494 testes passaram; 1.845,75 s em Node 24.22.0                                      |
| Docker Linux, dispositivo, Auth/IAM remoto       | Não validados nesta rodada                                                                        |

Não repetir a aprovação histórica dos 20 testes de capacidade como se fossem resultados novos. A regressão concluída usa `--without-capacity`, excluindo somente os cenários financeiros de 20.000 fontes. Comandos financeiros, selagem, limites e idempotência não foram alterados por este saneamento. Evidências novas resumidas ficam em `docs/audits/evidence/saneamento`; logs completos, runtime, envs e manifesto privado permanecem `.local`.

## 7. Riscos, custos e bloqueios restantes

Custo incremental criado nesta execução: nenhum recurso remoto novo. Isso não afirma custo total zero da infraestrutura existente. Crédito não equivale a gratuidade permanente. Não foi confirmado saldo, expiração ou se a conta foi convertida para pagamento. Não há autorização para converter conta ou ampliar serviços.

Não estimar reais sem tamanho do banco, SKUs regionais BRL e consumo. Fórmulas e volumes estão no pacote operacional: PITR aproximadamente D GiB-mês; backups até 12D GiB retidos; restore D GiB mais banco isolado; uptime até 129.600 requests/mês. Todas essas opções foram adiadas, sem criação, agendamento ou notificações. PITR, backup, restore e TTL não têm franquia gratuita Firestore. [Preços oficiais](https://cloud.google.com/firestore/pricing).

Bloqueios para publicação: três avisos sem correção upstream/aceite; imagem Linux e digest; mudanças remotas ainda não aprovadas; 16 índices e cinco campos; três variáveis com BOM; Auth update IAM; recuperação não ensaiada; timeout/probes não alinhados remotamente; saldo/validade de crédito; comportamento real de Auth/proxy/isolamento; dispositivo e acessibilidade nativa do canal escolhido; destino comercial e plano de publicação aprovados. A restrição de custo pode manter parte desses bloqueios aberta. Não substituir recuperação por ausência silenciosa de backup em uma publicação comercial.

## 8. Ordem recomendada

1. Preservar regressão local e manifesto do candidato, sem commit. As duas evidências da Fase 9 reescritas pelos benchmarks foram copiadas para a pasta saneamento; os originais foram restaurados byte a byte.
2. Confirmar créditos no console sem upgrade, criação de recursos ou novas chamadas funcionais remotas. Inspeção manual substitui checks periódicos agora.
3. Pedir aprovação individual para G2, G3, G4 e, separadamente, proteção contra exclusão de G5. Aprovação de configuração não inclui deploy nem custo de testes/builds.
4. Manter G1, PITR, backups/restore, revisão Cloud Run, monitoramento periódico e testes remotos adiados enquanto custo novo não for permitido.
5. Resolver/avaliar explicitamente os três avisos restantes e validar imagem Linux local. Atualizar snapshots e custo antes de qualquer futura execução remota.
6. Quando houver aprovação de recursos/consumo, executar índices e recuperação conforme dependências, depois candidato e matriz sintética. Produção comercial continua dependendo de autorização própria.

Ao encerrar esta rodada, parar e solicitar aprovações por grupo. Não executar alterações remotas em resposta apenas ao fornecimento de e-mail/orçamento.
