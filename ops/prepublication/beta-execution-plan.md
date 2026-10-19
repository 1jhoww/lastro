# Lastro — publicação beta controlada em homologação

Data: 18/10/2026, America/Sao_Paulo. **Preparação somente. Nenhuma mudança remota, commit, push ou deploy foi executado.** A aprovação anterior de G2/G3/G5 autoriza preparar, não executar. Este plano é o caminho crítico atual; as opções gerais de recuperação/monitoramento dos documentos anteriores não entram automaticamente na publicação.

## Resultado pretendido e limites

Publicar a dupla backend/frontend do mesmo candidato no Cloud Run e Vercel existentes. Usar `https://lastro-hml.vercel.app` como beta web, em desktop e celular. Todos os módulos entram no candidato. A resposta "tudo" foi interpretada como todos os módulos e intenção de usar dados comerciais, mantendo testes estritamente sintéticos.

Liberar inicialmente para convidados e empresas identificadas pelo operador. Não criar autorização pública de acesso a tenants, não ampliar CORS, não alterar limites financeiros, não importar dados comerciais ou emitir cobranças reais durante os testes. Login Firebase sozinho não concede vínculo/permissão em empresa. Publicação nas lojas nativas não integra este deploy web.

**Dados financeiros reais só entram depois de validar recuperação.** Proteção contra exclusão impede apagar o banco, mas não restaura documentos ou lançamentos incorretos. O banco não tem backup/PITR habilitados. A preparação de uma recuperação restaurável permanece indispensável para uso comercial; eventual ativação e ensaio com custo precisam de aprovação própria. Sem esse aceite, é possível homologar todos os módulos com dados sintéticos, mas não declarar o beta comercial liberado.

## Verificações indispensáveis já feitas

- Metadados Firestore e runtime relidos sem consultar documentos comerciais. Projeto `lastro-hml`, banco `(default)`, região `southamerica-east1`, Native; proteção contra exclusão e PITR continuam desativados.
- Runtime continua com `roles/datastore.user` e `roles/firebaseauth.viewer`. Não foram alterados bindings. `users.get` já está presente no viewer.
- Código e Admin SDK instalado confirmam: `updateUser()` chama `accounts:update` e depois `getUser()`. Meu Perfil grava somente `displayName` do UID autenticado. Desbloqueio global grava `disabled:false` e depois atualiza a identity Lastro em transação. Reativação de vínculo consulta o estado Auth e altera Firestore; não desbloqueia a conta automaticamente.
- Portanto, `firebaseauth.users.update` é a única permissão **Auth adicional** necessária para esses caminhos, preservados viewer e Datastore atuais. A permissão sozinha não substitui `users.get` nem acesso Firestore. Não é necessário Auth Admin, create/delete, envio de e-mail ou acesso a hashes/configuração. IAM não restringe `users.update` apenas a displayName: o escopo da app e os testes de isolamento continuam obrigatórios. [Mapeamento IAM oficial](https://docs.cloud.google.com/identity-platform/docs/access-control).
- Foram lidos somente os três valores públicos nomeados da Vercel, por ID. Cada valor coincide exatamente com a proposta anterior e começa com um único U+FEFF. Não foi feito pull de ambiente nem leitura de outras variáveis descriptografadas.
- Repositório `cloud-run-source-deploy` e bucket `run-sources-lastro-hml-southamerica-east1` já existem na região. Não há necessidade de criar outro repositório, bucket, serviço ou conta para preparar o candidato.
- Node 24.22.0, builds e contratos já passaram nesta árvore. Evidência disponível: 326 unitários backend, 616 frontend, 494 integração e seis testes de compatibilidade. Não repetir carga, capacidade de 20 mil fontes ou nova auditoria geral. Docker local continua sem engine; a única build candidata Linux proposta verificará PDF/Sharp/assets no próprio Dockerfile antes de permitir deploy.

## Etapa A — configuração exata, aguardando autorização

| ID   | Ação exata                                                                                                                                      | Impacto                                                                                       | Custo incremental esperado                                                                                  | Publicação automática                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A-G2 | Desabilitar somente índices simples de `visits.notes`, `visits.customerName`, `visits.payloadHash`, `deliveries.notes`, `deliveries.receivedBy` | Retira indexação desses campos; não altera documentos, compostos ou TTL                       | R$0 esperado para a mudança; tende a reduzir armazenamento de índices. Reversão/reindexação é outra decisão | Não cria revisão/deploy                                                         |
| A-G3 | PATCH somente `value` nos três IDs de variáveis production do projeto Vercel `lastro-hml`, removendo apenas o primeiro U+FEFF                   | Configuração limpa para a próxima build; deployment atual continua igual                      | R$0 esperado, sem build ou execução de função                                                               | API de variável não publica. Não usar botão/CLI de redeploy, Git ou deploy hook |
| A-G5 | Habilitar somente `deleteProtectionState` do banco `(default)` em `lastro-hml`                                                                  | Bloqueia exclusão administrativa do banco; não protege exclusão de documentos                 | R$0 esperado; nenhum armazenamento, backup ou PITR adicional                                                | Não cria revisão/deploy                                                         |
| A-G4 | Criar papel `projects/lastro-hml/roles/lastroRuntimeAuthUpdate` com somente `firebaseauth.users.update` e vincular apenas ao runtime SA         | Habilita nome do próprio perfil e desbloqueio global pelas rotas autorizadas; preserva viewer | R$0 esperado para IAM; operações Auth futuras seguem uso normal                                             | IAM não publica código; sem troca de SA                                         |

Estimativas R$0 referem-se à alteração de configuração, não ao custo total dos serviços existentes. A precificação Firestore cobra operações de dados, índices/armazenamento e rede; os três grupos não habilitam um novo componente faturável. [Preços Firestore](https://firebase.google.com/docs/firestore/pricing). Mudanças em variáveis só entram em novos deployments. [Semântica Vercel](https://vercel.com/docs/environment-variables).

Antes de executar: confirmar autorização por ID; capturar snapshots privados de metadados e deployment atual; comparar com o pacote preparado; parar em divergência. Não usar `firebase deploy`, arquivo completo de índices, `set-iam-policy` ou atualização global de ambiente. Não habilitar APIs ou conceder permissões para contornar falha.

### A-G2: cinco comandos, nenhuma flag TTL

```powershell
gcloud firestore indexes fields update notes --project=lastro-hml --database="(default)" --collection-group=visits --disable-indexes
gcloud firestore indexes fields update customerName --project=lastro-hml --database="(default)" --collection-group=visits --disable-indexes
gcloud firestore indexes fields update payloadHash --project=lastro-hml --database="(default)" --collection-group=visits --disable-indexes
gcloud firestore indexes fields update notes --project=lastro-hml --database="(default)" --collection-group=deliveries --disable-indexes
gcloud firestore indexes fields update receivedBy --project=lastro-hml --database="(default)" --collection-group=deliveries --disable-indexes
```

Equivalente REST preparado: PATCH de cada Field com `updateMask=indexConfig` e body `{"indexConfig":{"indexes":[]}}`. Nenhum `ttlConfig` no body ou máscara. Executar um de cada vez, registrar operação e confirmar `indexes:[]`. Comparar todos os compostos e todos os TTL antes/depois; exigir igualdade integral. Demais campos devem permanecer iguais, desconsiderando apenas metadados de progresso/horário. Não executar os 16 comandos de G1 nesse grupo. [API Fields.patch](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.collectionGroups.fields/patch).

Reversão: somente se autorizada e confirmada herança original, `--clear-exemption` nos mesmos campos. Pode reconstruir índices; não reverter automaticamente por mera demora. Não apagar documentos.

### A-G3: exatamente três valores

| Chave                           | Próximo valor, igual ao original sem primeiro BOM                |
| ------------------------------- | ---------------------------------------------------------------- |
| EXPO_PUBLIC_API_URL             | `https://lastro-api-hml-859974935461.southamerica-east1.run.app` |
| EXPO_PUBLIC_FIREBASE_PROJECT_ID | `lastro-hml`                                                     |
| EXPO_PUBLIC_WEB_BASE_URL        | `https://lastro-hml.vercel.app`                                  |

Projeto ID `prj_jrOM9upMAw6v5uecuCrgpPUGwAM4`; team `team_H7PBg30K6E951T7pyrGlbBvD`; target exclusivamente `production`, que neste projeto significa homologação principal. IDs exatos de variável e corpos preparados ficam no arquivo privado `backend/.local/beta/vercel-three-prepared.private.json`.

Por variável: reler somente esse ID; exigir valor atual idêntico ao snapshot; calcular `current.slice(1)` depois de validar primeiro codepoint U+FEFF; fazer `PATCH /v9/projects/{projectId}/env/{envId}?teamId=...` com **somente** `{"value":"..."}`. Preservar key, type encrypted, target, gitBranch, vínculo de integração e customEnvironmentIds. Não aplicar trim, normalização de URL, troca de domínio ou mudança na Firebase API key. Confirmar valor exato e metadados preservados. Comparar deployment/alias antes/depois; não clicar em proposta de redeploy. [PATCH Vercel](https://vercel.com/docs/rest-api/projects/edit-an-environment-variable).

Reversão: restaurar somente value anterior do snapshot privado; nenhuma build ou alteração das outras variáveis. As APIs nativas dessas configurações não iniciam deploy; se surgir deployment concorrente de origem externa, interromper e identificar a origem sem alterar automações por conta própria.

### A-G5: proteção, exclusivamente

```powershell
gcloud firestore databases update --project=lastro-hml --database="(default)" --delete-protection
```

Equivalente REST: PATCH do banco com `updateMask=deleteProtectionState`, body `{"deleteProtectionState":"DELETE_PROTECTION_ENABLED"}`. Não passar `--enable-pitr`, flags de retenção, backup ou clone. Confirmar proteção habilitada e PITR, retenção, localização, tipo, índices, TTL e agendamentos inalterados. Não testar a proteção tentando excluir o banco. Reversão exige nova autorização para `--no-delete-protection`. [Comando oficial](https://docs.cloud.google.com/firestore/native/docs/manage-databases#update_the_delete_protection_setting).

### A-G4: acréscimo mínimo

Após autorização específica, confirmar que o ID proposto não existe com definição diferente. Criar somente com o arquivo `auth-runtime-role.proposal.json`. Conceder binding à identidade `serviceAccount:lastro-api-hml@lastro-hml.iam.gserviceaccount.com`, no projeto `lastro-hml`, sem remover viewer ou modificar outros bindings. Relê-los para confirmar que a única nova permissão é `users.update`. A confirmação funcional de IAM depende dos testes reais sintéticos aprovados na etapa D; análise de código não equivale a esses testes.

```powershell
gcloud iam roles create lastroRuntimeAuthUpdate --project=lastro-hml --file=ops/prepublication/auth-runtime-role.proposal.json
gcloud projects add-iam-policy-binding lastro-hml --member="serviceAccount:lastro-api-hml@lastro-hml.iam.gserviceaccount.com" --role="projects/lastro-hml/roles/lastroRuntimeAuthUpdate" --condition=None
```

Reversão: retirar somente esse binding adicionado, se autorizada; conservar viewer e papel caso usado por outro consumidor. Não conceder Auth Admin se houver erro.

## Etapa B — índices e build Linux, aprovação separada

**B-G1:** adicionar somente os 16 índices ausentes já preparados, com mesma ordem/escopo; esperar `READY`, sem excluir/recriar os 134 existentes ou mudar TTL. Como todos os módulos entram no beta, não declarar cobranças/visitas/recompra funcionais sem esses índices e dados de teste. Há armazenamento adicional faturável de índices; valor depende do dataset, não medido por leitura comercial nesta preparação. Não prometer R$0 para G1. Antes de executar, apresentar o custo de armazenamento estimado ou obter aceite expresso dessa incerteza delimitada; não executar por herança da aprovação G2.

**B-build:** uma build Docker do candidato backend, por lockfile, Node24.22.0. Usar default pool `E2_MEDIUM`, timeout900s, `cloudbuild.beta.yaml`, repositório e bucket existentes. Não criar API, repo, bucket, private pool ou ampliar IAM. Se faltar permissão/recurso, parar. Nenhuma repetição automática em máquina maior.

Modelo, ainda não executado; `CANDIDATE_DIR` e tag serão lidos do manifesto fechado, não da árvore de trabalho mutável:

```powershell
gcloud builds submit "$CANDIDATE_DIR/backend" --project=lastro-hml --region=southamerica-east1 --config=ops/prepublication/cloudbuild.beta.yaml --substitutions="_BETA_TAG=$BETA_TAG" --gcs-source-staging-dir=gs://run-sources-lastro-hml-southamerica-east1/beta-candidates --gcs-log-dir=gs://run-sources-lastro-hml-southamerica-east1/beta-build-logs
```

Estimativa de computação pela tabela consultada: E2_MEDIUM a US$0,003/min; 15min correspondem a US$0,045, antes de créditos. Confirmar SKU regional antes da execução. Soma-se armazenamento da imagem/fontes/logs nos recursos existentes, conforme volume/retensão; não é conta total nem teto garantido. A imagem candidata ainda não tem tamanho ou digest. Registrar ambos depois da build. A antiga imagem/revisão fica preservada. [Cloud Build](https://cloud.google.com/build/pricing), [Artifact Registry](https://cloud.google.com/artifact-registry/pricing).

Build deve passar compilação e smoke PDF/Sharp/assets em Linux antes de qualquer deploy. O frontend estático usa apenas fontes revisadas; as três dependências de tooling ainda vulneráveis não aparecem no bundle web inspecionado. Isso não resolve o risco no build: a decisão de publicar o beta exige aceite explícito e restrito desse risco residual, sem material de assinatura nativa ou entradas externas não revisadas. Não publicar APK/OTA/loja por analogia.

## Etapa C — publicação da dupla, cada ação precisa de autorização

1. Apresentar digest Linux, hashes de fonte/contrato/lockfiles, resultado do build, configuração atual/proposta e custo medido. Nenhum commit ou push é necessário para deploy por CLI; evitá-los para não disparar Git/Vercel automaticamente.
2. Após aprovação do deploy API: criar revisão candidata **no serviço existente**, por digest, sem tráfego principal, tag de beta. Preservar SA, bucket, IAM, envs, CORS, 1CPU/1GiB, concorrência40, mínimo0, caps serviço3/revisão2. Propor timeout130s para app120s, startup HTTP `/health/live` e segredo versão1 sem rotação. Confirmar cada diff antes. Não criar monitoramento periódico ou aumentar capacidade. Revisão sem tráfego ainda pode consumir durante startup/testes.
3. Autorizar e executar teste API pequeno contra a tag com origem principal e identidades sintéticas. Não enviar credenciais comerciais, ampliar CORS ou mudar variáveis production para a URL temporária. Exigir invariantes de login, perfil, pedidos, estoque, financeiro e isolamento antes de tráfego.
4. Apresentar autorização separada para promoção API e publicação frontend principal. Usar janela sem novas operações comerciais e guardar revisão/deployment antigos. Direcionar API candidata somente quando compatibilidade estiver demonstrada; publicar frontend do mesmo candidato, com os três valores limpos e API key pública existente, sem emuladores ou env privado.
5. Deploy frontend explícito no projeto existente. Não importar `.env.local`, token OIDC, senha, credencial Admin ou diretório `.local`. Confirmar Node efetivo>=24.22.0 e hashes de contrato. Build remoto pode consumir quota/plano Vercel; não garantir gratuidade sem verificar saldo. Não usar Git push como mecanismo implícito de publicação.
6. Executar smoke final na URL principal depois da dupla publicada, mantendo usuários comerciais fora até aceite. Se falhar, parar liberação; rollback de código somente quando compatível com os dados. Nunca apagar ledger, pedido, auditoria ou ajustar saldo manualmente para fazer smoke passar.

As ações concretas de deploy/promoção serão apresentadas com digest/deployment reais antes de executar. A aprovação da etapa A não inclui B/C/D, build, upload, restauração ou qualquer novo recurso pago.

## Etapa D — smoke completo, pequeno e sintético

Preparar duas empresas sintéticas A/B, administradores A/B, vendedor A e usuário bloqueado, com identificador exclusivo de execução. Criação das fixtures e uso remoto precisam de autorização específica. Senhas/tokens ficam privados. Não reutilizar contas comerciais. Não executar seed local contra o projeto remoto. Não apagar fixtures automaticamente; preservar para verificação.

Limite proposto: uma rodada, até300 requisições da aplicação, sem concorrência de carga, sem varrer coleções comerciais. Parar ao atingir limite, erro de IAM, saldo divergente, acesso cruzado, resultado financeiro desconhecido ou custo inesperado. Leituras internas do SDK/Firestore não são limitadas por esse contador HTTP; acompanhar logs existentes sem criar alertas pagos.

| Caso | Caminho de teste                                                                          | Aceite                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| S1   | Login real A/B e vendedor; senha errada; sem token; token inválido; bloqueado             | Sessões válidas acessam somente o permitido; negativas401/403; sem emulador                                              |
| S2   | Meu Perfil de A, salvar nome com acento, recarregar e renovar sessão                      | Nome persiste no Auth; B não muda; campo uid/role extra é rejeitado                                                      |
| S3   | Desbloquear conta sintética pela plataforma; reativar vínculo separadamente               | Login volta apenas após desbloqueio; vínculo desabilitado não se reativa implicitamente; quotas/permissões preservadas   |
| S4   | ProdutoP1 estoque10/preço10,00 e P2 estoque10/preço25,00; cliente de A                    | Estoques e versões coerentes; B e vendedor sem permissão não alteram A                                                   |
| S5   | Pedido com P1x2 e P2x1; confirmar e repetir mesma intenção/chave                          | Total4500 centavos; reserva2/1; saldo físico permanece10/10; replay sem duplicação                                       |
| S6   | Expedir; replay; PDF e CSV pequenos                                                       | Estoque físico8/9, reserva0/0; um movimento por efeito; PDF/Sharp/fontes funcionam em Linux                              |
| S7   | Receber2000 e depois2500 centavos; repetir chaves originais                               | Recebido4500, saldo0; diário/recebíveis reconcilia exatamente; replay não duplica dinheiro                               |
| S8   | Outro pedido não pago: confirmar e cancelar; devolução pequena em pedido próprio aprovado | Reservas liberadas; estoque, obrigação/crédito/caixa reconciliados conforme origem; nenhum crédito ou dinheiro inventado |
| S9   | A tenta header/id/cursor de B; vendedor tenta financeiro/admin; revogação da fixture      | Negação pelo contrato; B prova que registro existe; zero vazamento de corpo/contagem/arquivo                             |
| S10  | Visitas/recompra/cobranças sintéticas, filtros e cursores; CORS e health                  | Índices READY e resultados não vazios corretos; origem externa recusada; readiness/live corretos                         |

Registrar caso, status, código seguro, request ID, revisão/deployment e valores sintéticos esperados/observados. Não publicar bodies privados ou tokens. Evidência dos494 testes locais não substitui a rodada real. Não fazer teste de carga ou criar monitoramento recorrente.

## Critério final de liberação

Liberar beta somente depois de publicar a dupla autorizada, passar S1–S10, comprovar isolamento e invariantes financeiras, fechar IAM/variáveis/índices e aceitar explicitamente riscos residuais de tooling. Para dados comerciais reais, também validar recuperação restaurável e seus custos aprovados. Até lá, estado é **candidato preparado, beta não liberado**.

Nenhuma garantia de lançamento hoje substitui esses gates. Se um gate falhar, corrigir somente o bloqueio necessário, testar o caminho afetado e pedir autorização para a próxima ação remota concreta.
