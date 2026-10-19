# Lastro — diagnóstico de pré-publicação

Inspeção em 18/10/2026, America/Sao_Paulo. **Publicação bloqueada. Preparação e inspeção de homologação concluídas; homologação funcional remota ainda não executada.** Nenhum commit, push, deploy, índice, variável, IAM, conta, dado comercial ou recurso remoto foi alterado.

## 1. Escopo e evidência

Foram lidos os relatórios finais das Fases 8 e 9, as configurações locais e metadados de `lastro-hml`. A inspeção remota usou operações de leitura. O smoke HTTP fez duas rodadas de oito chamadas sequenciais e um asset por rodada; a primeira não salvou o arquivo por erro de caminho local. A segunda produziu a evidência. Um navegador anônimo abriu a página pública, sem login ou envio de formulário.

Não foram consultados documentos comerciais, objetos de clientes, contas Auth ou valores de Secret Manager. Não foram gerados e-mails, contas ou dados de teste. `/health/ready` fez leitura técnica do Firestore; preflights terminaram antes de autenticação e contadores privados. Logs técnicos dessas leituras são efeitos normais dos provedores, sem alteração de configuração.

As evidências sanitizadas estão em [evidence/prepublicacao](evidence/prepublicacao/). Os comandos que alteram recursos aparecem somente como propostas nos documentos relacionados.

## 2. Repositório e candidato

| Item                              | Resultado                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Branch / HEAD                     | `main` / `4051f03e78f57f42b5ccc6f7b376c8814e3daa5c`                                             |
| Commits posteriores à base pedida | Zero; os trabalhos posteriores estão na árvore local                                            |
| Estado no início da auditoria     | 34 arquivos rastreados modificados e 301 arquivos não rastreados, antes destes novos documentos |
| Alterações preservadas            | Fases 7/8/9, telas e testes de perfil, ajustes visuais, performance e artefatos Graphify        |
| Rastreamento de temporários       | `graphify-out/` já contém 97 arquivos rastreados; não deve entrar automaticamente no candidato  |
| Caminhos sensíveis rastreados     | Nenhum `.env` privado, chave ou arquivo de service account detectado na árvore atual            |
| Scanner ampliado                  | 858 arquivos de texto atuais, incluindo TSX/CJS/HTML/NDJSON: zero assinaturas encontradas       |

[Snapshot do Git](evidence/prepublicacao/git-status.txt) e [auditoria local](evidence/prepublicacao/local-audit.json). O scanner não cobre histórico completo Git, arquivos ignorados ou binários; zero achados não é certificação de ausência de segredo.

O [scanner de fechamento](evidence/prepublicacao/final-secret-scan.json) examinou 905 arquivos, incluindo as novas evidências sanitizadas, sem achados. O [manifesto do candidato local](evidence/prepublicacao/candidate-manifest.json) fixa hashes de 619 arquivos de fonte, assets, scripts, testes e configuração, com fingerprint `792889b09cd7fbf91eb7893caa7915be0e958d268632c78e60eed80dd59198d3`. Isso identifica uma árvore de trabalho; não substitui commit autorizado ou imagem imutável.

Não versionar `.local/`, `.env*` privados, `.vercel/`, bundles, sourcemaps, `dist/`, relatórios brutos de teste, caches, logs ou exports dos emuladores. As exclusões existentes cobrem grande parte disso. Os caches Graphify já rastreados exigem decisão separada sobre o índice Git; nada foi removido. Evidências selecionadas em `docs/audits/evidence/` exigem revisão de privacidade antes de um futuro commit, especialmente material das fases anteriores.

Os ambientes locais continuam `demo-lastro-phase-a` e loopback. Não substituir `.env` local por configuração remota. O download de configuração usado na inspeção permanece em `.local/`, ignorado pelo Git; inclui metadados e token efêmero do provedor e não deve ser compartilhado.

## 3. Homologação e produção

| Componente              | Estado observado em homologação                                                                                         | Limite da conclusão                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Projeto Google/Firebase | `lastro-hml`, ativo; faturamento habilitado                                                                             | Não identifica nem aprova projeto de produção                                                      |
| Firestore               | `(default)`, Native, `southamerica-east1`, concorrência pessimista                                                      | Nenhum documento comercial foi lido                                                                |
| Recuperação Firestore   | PITR desativado; proteção contra exclusão desativada; retenção informada de 3.600 s; nenhuma agenda de backup retornada | RPO/RTO e restauração não aprovados                                                                |
| Índices                 | 150 locais, 134 remotos `READY`, 16 ausentes; 82/87 configurações de campo correspondem                                 | Cinco isenções ainda faltam; TTL de `rateLimits.expiresAt` ativo                                   |
| Storage                 | `lastro-hml.firebasestorage.app`, região São Paulo, Standard                                                            | Nenhum objeto foi enumerado                                                                        |
| Proteção Storage        | Soft delete de sete dias; uniform bucket-level access desativado; prevenção de acesso público herdada                   | Sem grant público no IAM consultado; ACLs individuais de objetos não auditadas                     |
| Cloud Run               | `lastro-api-hml`, `southamerica-east1`, revisão `lastro-api-hml-00003-jjc`, criada em 16/10                             | Não contém evidência de publicação das alterações locais das Fases 7–9                             |
| Recursos Run            | 1 vCPU, 1 GiB, concorrência 40, timeout 60 s                                                                            | Serviço declara máximo 3; revisão declara máximo 2; não interpretar como capacidade medida         |
| Probes Run              | Startup TCP em 8080; sem liveness HTTP configurado na revisão                                                           | `/health/live` e `/health/ready` existem na aplicação; integração com probes permanece pendente    |
| Vercel                  | Projeto `lastro-hml`, root `frontend`, Node `24.x`, `npm ci`, export Expo, saída `dist`                                 | Node 24 difere do Node 22.23.3 validado localmente e no CI; não foi reproduzido nesta máquina      |
| Versão Vercel           | Deployment `dpl_6ax4B9GsLyg1rZWr2L27WhotJzDr`, `READY`, commit informado `c2509f52…`                                    | Commit anterior a `4051f03`; não equivale ao candidato atual                                       |
| Alertas                 | Nenhuma política de alerta retornada no projeto                                                                         | Ausência de erros recentes não substitui monitoramento                                             |
| Jobs                    | Nenhum Cloud Run Job retornado; Cloud Scheduler API desativada                                                          | Cobrança automática diária não está comprovada; criação de job/agendador exige autorização própria |

O alvo `production` do Vercel acima é o ambiente principal do **projeto de homologação `lastro-hml`**. Não significa produção comercial. Nenhum projeto, bucket, domínio ou conta de serviço de produção separado foi confirmado. Não reutilizar homologação como produção por conveniência.

### URLs observadas

- Frontend: `https://lastro-hml.vercel.app`.
- API do serviço: `https://lastro-api-hml-njkivn2g3q-rj.a.run.app`.
- `PUBLIC_ORIGIN` e frontend apontam ao alias `https://lastro-api-hml-859974935461.southamerica-east1.run.app`.
- Os dois endereços de API responderam ao health check. A escolha de URL canônica deve ser registrada antes do candidato.
- Domínios próprios comerciais, DNS de produção e certificados correspondentes permanecem não definidos nesta evidência.

## 4. Configuração, autenticação e segurança

### Variáveis do Vercel com caractere invisível

Três valores do ambiente principal de `lastro-hml` começam com U+FEFF, um BOM: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID` e `EXPO_PUBLIC_WEB_BASE_URL`. A chave pública Firebase tem formato esperado e não foi incluída no relatório.

Zod 4.6.7 aceita e normaliza as duas URLs; o ID do projeto permanece diferente de `lastro-hml`. Portanto, o defeito não implica que a tela de login necessariamente falhe: a tela publicada carregou. Não foi realizado login real, e não há prova de falha ou sucesso da autenticação. Corrigir os três valores sem BOM e reconstruir o candidato elimina ambiguidade de ambiente e identificadores. Não corrigir isso silenciosamente apenas no artefato local. [Validação exata](evidence/prepublicacao/vercel-environment-validation.json).

Preview contém nomes dos mesmos quatro campos públicos, sem variável de emulador na listagem. Os valores de preview **não foram validados**. A revisão automática rejeitou `vercel env pull` de preview porque o comando baixa todos os valores e pode incluir segredos. Nenhuma alternativa de extração foi usada após a rejeição. Uma leitura futura deve ser autorizada explicitamente e limitada aos quatro campos públicos.

### Auth e IAM

- E-mail/senha habilitados. Domínios autorizados incluem `localhost`, domínios Firebase e `lastro-hml.vercel.app`.
- Templates de e-mail usam serviço padrão e callback Firebase. Entrega, idioma efetivo, ação expirada, convite e recuperação ainda precisam de caixas sintéticas autorizadas.
- Privacidade melhorada de e-mail está habilitada. MFA está desabilitado; política de senha não veio configurada no metadado. Definir política de aceite para contas privilegiadas antes de produção.
- Runtime usa `lastro-api-hml@lastro-hml.iam.gserviceaccount.com`, sem chave gerenciada por usuário retornada.
- IAM do projeto concede `roles/datastore.user` e `roles/firebaseauth.viewer` ao runtime. Bucket concede `roles/storage.objectUser`; o segredo de convites concede `roles/secretmanager.secretAccessor` no próprio segredo.
- **Bloqueio funcional IAM:** `UserService.updateProfile` e reativação chamam `auth.updateUser`. O grant atual de Auth é somente leitura. A hierarquia retornou somente o projeto, sem ancestral com grant adicional demonstrado. Preparar papel mínimo com `firebaseauth.users.get` e `firebaseauth.users.update`; não conceder Owner/Editor ou Auth Admin integral por conveniência. Validar a permissão e o comportamento após autorização.
- A conta padrão de Compute possui `roles/editor`. Revisar dependências de build e uso efetivo antes de reduzir esse grant; não alterar automaticamente.
- O segredo de convites usa referência `latest`. Fixar versão aprovada na próxima revisão e preservar a versão anterior para rollback; não rotacionar a chave durante a troca de release sem plano próprio.

A coleta inicial do Auth incluiu um parâmetro sensível de hashing na evidência e na saída de ferramenta desta conversa. O campo foi removido imediatamente do arquivo entregue, sem commit; nenhum hash de usuário foi consultado. A coleta foi corrigida para selecionar apenas configurações permitidas. Essa saída não deve ser republicada; o responsável deve avaliar o tratamento do material sensível. A evidência final não contém esse valor.

### Rede, logs e controles externos

Cloud Run tem ingress `all` e `allUsers` como `run.invoker`. Isso permite alcançar a API; as rotas privadas ainda devem exigir Firebase Auth e autorização de negócio. CORS não substitui essa autorização.

O preflight de `lastro-hml.vercel.app` retornou 204 com origem exata. Origem externa e alias de preview retornaram 403. Preview exigirá decisão explícita: origem estável autorizada ou uso do domínio principal de homologação, sem wildcard para todas as URLs Vercel.

`TRUST_PROXY_HOPS=0` e peer explícito `169.254.169.126/32` estão configurados. Não se demonstrou resistência a spoofing de headers no ingress real. O teste planejado deve confirmar peer, HTTPS e agrupamento de IP sem abrir confiança a toda rede privada.

API respondeu com HSTS, CSP, `nosniff`, proteção de frame e request ID. Frontend respondeu com HSTS; CSP, `nosniff` e política de frame não apareceram na amostra. Revisar headers compatíveis com Expo, sem inserir uma CSP que quebre assets ou autenticação.

A chave pública Firebase tem lista ampla de APIs permitidas e nenhuma restrição de navegador efetiva no metadado. Chave web é identificador público, não credencial administrativa. Revisar restrições por plataforma sem quebrar Android/iOS, que podem exigir chaves próprias.

Logs locais usam rota, código, duração e request ID, sem token/corpo/email. A consulta limitada de erros das últimas 24 horas não retornou registros; isso não comprova tráfego, ausência histórica de falhas ou sanitização de todos os logs remotos. Nenhuma política de alerta foi encontrada.

## 5. Dependências e compatibilidade

`npm audit --omit=dev --json` retornou zero vulnerabilidades no backend. No frontend, retornou 67 pacotes afetados: 50 com severidade alta e 17 moderada, derivados de **sete avisos únicos**. Não são 67 CVEs distintos. Nenhum `audit fix`, downgrade ou atualização foi executado.

| Aviso                                                                                                                                                | Inclusão no web export atual                                                         | Tratamento necessário                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [decode-uri-component / DoS de decodificação](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)                                                     | Presente no sourcemap, via query-string / Expo Router                                | Corrigir em linha compatível com Expo ou provar mitigação; validar navegação e links |
| [grpc-js / certificados](https://github.com/advisories/GHSA-m9gg-hp2v-232j) e [mensagens de erro](https://github.com/advisories/GHSA-f596-whhp-79r4) | Ausente do sourcemap web; dependência Node de Firestore no pacote Firebase instalado | Avaliar escopo Node/nativo; não alegar exploração no browser                         |
| [node-forge / verificação RSA](https://github.com/advisories/GHSA-86w9-cpqp-85rv)                                                                    | Ausente do sourcemap web; cadeia de ferramentas Expo                                 | Revisar assinatura e build                                                           |
| [braces / exaustão de pilha](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)                                                                      | Ausente do sourcemap web; cadeia Metro/Jest                                          | Revisar processamento de entradas nas ferramentas                                    |
| [sprintf-js / precisão sem limite](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)                                                                | Ausente do sourcemap web; cadeia de ferramentas                                      | Revisar alcance e atualização compatível                                             |
| [uuid / limites de buffer](https://github.com/advisories/GHSA-w5hq-g745-h8pq)                                                                        | Ausente do sourcemap web; cadeia de ferramentas nativas                              | Revisar métodos usados e atualização compatível                                      |

Inclusão em sourcemap não prova caminho explorável; ausência do web não aprova ferramentas ou app nativo. A triagem completa é um bloqueio de liberação, com prioridade ao componente incluído no browser. As sugestões automáticas do npm incluem versões incompatíveis ou anteriores de Expo/React Native; não devem ser aplicadas cegamente. [Auditoria](evidence/prepublicacao/dependency-audit.json) e [inventário do sourcemap](evidence/prepublicacao/web-advisory-inclusion.json).

Backend build e teste de artefato foram repetidos e passaram. `check:openapi` passou; contratos backend/frontend continuam idênticos por SHA-256 e versão `0.9.0`. A árvore de dependências instalada dos dois projetos passou em `npm ls --omit=dev --depth=0`.

Typecheck e lint dos dois projetos foram repetidos nesta etapa e passaram. A formatação dos quatro novos documentos, os links locais e `git diff --check` também passaram. Código de aplicação, dependências e configurações versionadas existentes não foram alterados nesta etapa.

Export web diagnóstico foi gerado com os valores atuais de homologação e sem herdar `.env` demo. O processo não recebeu o token OIDC. O build passou, mas isso **não aprova configuração nem autenticação**. A saída `.local/prepublicacao-web-config-atual` não é artefato liberado para deploy. Um segundo export com sourcemap foi usado somente na triagem local; não publicar sourcemaps por engano.

O engine Docker está indisponível, embora o executável exista. Não foi possível construir/executar a imagem Linux nova. Dockerfile, CI e backend fixam Node 22.23.3; imagem por digest e execução Linux com Sharp/PDF/Firebase continuam gates reais.

Não se repetiram os testes da Fase 9 sem mudança de código de aplicação. Continuam válidos como evidência **local**: 494/494 integração, 320/320 backend, 616/616 frontend, 20/20 capacidade e 36/36 E2E. Não são aprovação remota. O contrato da API atualmente publicada não foi obtido nem equiparado ao candidato; versão nominal sozinha não comprova equivalência.

## 6. Resultados remotos limitados

| Leitura                            | Resultado observado                                           |
| ---------------------------------- | ------------------------------------------------------------- |
| `/health/live`, URL do serviço     | HTTP 200, 147 ms                                              |
| `/health/live`, alias configurado  | HTTP 200, 84 ms                                               |
| `/health/ready`                    | HTTP 200, 85 ms                                               |
| Frontend `/`                       | HTTP 200, 39 ms                                               |
| Deep link `/meu-perfil`            | HTTP 200, 19 ms; fallback SPA, sem validar perfil autenticado |
| CORS permitido / externo / preview | 204 / 403 / 403                                               |
| Navegador anônimo, 390 px          | Redirecionou a `/entrar`; formulário visível                  |

Uma amostra por rota, depois de chamadas anteriores, sem isolamento de rede. Não é p95, cold start, prova de Firebase Auth ou aprovação de performance. Nenhuma carga foi executada. [Smoke](evidence/prepublicacao/public-smoke.json), [navegador](evidence/prepublicacao/hml-browser.json), [captura](evidence/prepublicacao/hml-anonimo-390.png).

## 7. Planos preparados

- [Índices, finalidade, comandos e verificação](prepublicacao-indices-2026-10-18.md).
- [Homologação funcional, sessão, custos, performance e Android](prepublicacao-homologacao-2026-10-18.md).
- [Publicação coordenada, interrupção e rollback](prepublicacao-publicacao-rollback-2026-10-18.md).

## 8. Checklist de liberação

**Aprovado** significa somente o escopo indicado. **Pendente** significa ausência de execução/evidência. **Bloqueado** significa divergência observada ou pré-requisito impeditivo. Todo item obrigatório deve estar aprovado no ambiente de destino antes da publicação; exceção exige decisão explícita e justificativa.

| Item                                                     | Classificação          | Obrigatório para publicar?            | Evidência ou condição                                            |
| -------------------------------------------------------- | ---------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Preservação da árvore e dos dados locais                 | Aprovado               | Sim                                   | Nenhum descarte, exclusão ou migração                            |
| Regressão da Fase 9                                      | Aprovado, local        | Sim                                   | Não substitui testes remotos                                     |
| Build backend e contrato OpenAPI local                   | Aprovado, local        | Sim                                   | Repetidos nesta etapa                                            |
| Smoke de saúde, TLS aceito pelo cliente e CORS principal | Aprovado, limitado     | Sim                                   | Revalidar após nova revisão; não certifica produção              |
| Rules remotas Firestore/Storage                          | Aprovado, configuração | Sim                                   | Correspondem ao deny-all local; Admin SDK depende de IAM         |
| Candidato imutável, commit e dupla de versões            | Bloqueado              | Sim                                   | Alterações locais sem commit; API remota sem SHA Git confirmado  |
| 16 índices e cinco isenções                              | Bloqueado              | Sim                                   | Não implantados                                                  |
| Configuração Vercel sem BOM                              | Bloqueado              | Sim                                   | Três valores divergentes                                         |
| IAM de atualização de usuário                            | Bloqueado              | Sim                                   | Runtime com Auth viewer; Meu Perfil exige update                 |
| Dependências e triagem de segurança                      | Bloqueado              | Sim                                   | Sete avisos, um pacote confirmado no web bundle                  |
| Linux e runtime Node do candidato                        | Pendente               | Sim                                   | Docker indisponível; Vercel Node 24 não reproduzido              |
| Timeout, proxy, admissão e probes                        | Pendente               | Sim                                   | Run 60 s versus aplicação 120 s; spoofing não testado            |
| Backup/restauração, RPO/RTO e proteção dos dados         | Bloqueado              | Sim                                   | Sem agenda/PITR; restauração não ensaiada                        |
| Login, convite, recuperação, e-mail, sessão e bloqueios  | Pendente               | Sim                                   | Somente emulador/local até agora                                 |
| Empresa, vendedor, Super Admin e vagas por plano         | Pendente               | Sim                                   | Testes remotos sintéticos não autorizados nesta etapa            |
| Performance remota e orçamento                           | Pendente               | Sim                                   | Plano limitado preparado; valores financeiros não aprovados      |
| TalkBack, teclado virtual e app Android                  | Pendente               | Sim, para os canais mobile prometidos | ADB respondeu sem dispositivo conectado                          |
| Produção: projeto, domínio, IAM e URLs                   | Bloqueado              | Sim                                   | Destino comercial não confirmado                                 |
| Alertas e responsável de plantão                         | Pendente               | Sim                                   | Nenhuma política encontrada                                      |
| Agenda automática de cobrança                            | Pendente               | Sim, se esse serviço for anunciado    | Sem Job; Scheduler desativado; definir contingência manual       |
| Melhorias adicionais de JS/LCP e relatórios grandes      | Pendente               | Pode acompanhar após lançamento       | Somente com capacidade remota mínima aceita e riscos registrados |
| RUM, tendências de custo e otimização de caches          | Pendente               | Pode acompanhar após lançamento       | Sem abrir exceção para controles de segurança                    |

## 9. Autorizações futuras, independentes

| ID  | Operação proposta                                           | Limite                                                                            |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A01 | Criar os 16 índices compostos                               | Somente `lastro-hml/(default)`; comandos preparados                               |
| A02 | Aplicar as cinco isenções                                   | Somente campos listados; preservar TTL e demais índices                           |
| A03 | Corrigir três valores Vercel sem BOM                        | Somente projeto `lastro-hml`; validar preview separadamente; sem deploy implícito |
| A04 | Revisar IAM mínimo de usuários                              | Papel e diff aprovados antes de criar/vincular/remover grants                     |
| A05 | Preparar timeout/probes/alertas e versão do segredo         | Mudanças separadas, com parâmetros e custo aprovados                              |
| A06 | Habilitar estratégia de backup e proteção                   | Definir RPO/RTO, retenção, custo e ensaio de restauração em destino isolado       |
| A07 | Criar fixtures, contas sintéticas e e-mails de teste        | Empresas A/B, caixas controladas; nenhum administrador permanente                 |
| A08 | Executar homologação/performance limitada                   | Somente após A01–A07 necessários; sem 20 mil fontes ou carga intensa              |
| A09 | Corrigir dependências/configuração local e rever evidências | Escopo separado; repetir regressão afetada                                        |
| A10 | Criar commit de candidato                                   | Revisar seleção de arquivos; sem push automático                                  |
| A11 | Push                                                        | Rever gatilhos Vercel/CI antes; push pode provocar deploy automático              |
| A12 | Publicar e promover em homologação                          | Aprovação específica da dupla de artefatos e plano                                |
| A13 | Publicar em produção                                        | Nova autorização, destino confirmado e checklist aprovado                         |
| A14 | Ler somente valores públicos de preview                     | Quatro `EXPO_PUBLIC_*`; sem baixar outros segredos                                |

Nenhuma autorização foi presumida. Esta entrega termina no diagnóstico e nos planos; não executa nenhuma operação dessa tabela.
