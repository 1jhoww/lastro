# Lastro Gestão: checklist de produção

Nada aqui roda sozinho. Cada etapa que altera um projeto real precisa de autorização do responsável. Os exemplos usam `lastro-hml`.

## 0. Antes de começar

- [ ] **Definir o ambiente de destino.** Hoje só existe `lastro-hml`, que atende `lastro-hml.vercel.app`. Não há projeto de produção separado.
- [ ] Confirmar a identidade: `gcloud config list` na configuração `lastro-hml`, conta do Lastro. Nunca use a configuração padrão da máquina.
- [ ] Confirmar faturamento ativo. Sem ele, o limite de índices é 200.
- [ ] Exportar o Firestore antes de publicar:

  ```bash
  gcloud firestore export gs://BUCKET_DE_BACKUP/pre-gestao --project=lastro-hml
  ```

- [ ] Anotar a revisão atual da API e o deployment atual da Vercel, para a reversão.
- [ ] Commit da versão candidata revisado. **Um push para `main` publica o frontend na Vercel automaticamente.** Não faça push antes da etapa 4.

## 1. Variáveis

- [ ] API: nenhuma variável nova. `gcloud run deploy` sem flags de ambiente mantém as atuais.
- [ ] Frontend: nenhuma `EXPO_PUBLIC_*` nova.
- [ ] Job: mesmas variáveis e segredo da API. Copie do serviço se forem diferentes dos exemplos abaixo.

## 2. Permissões

- [ ] Treze permissões novas vêm do código, liberadas pelo plano: `suppliers:manage`, `purchases:read`, `purchases:create`, `purchases:edit`, `purchases:confirm`, `purchases:receive`, `purchases:close`, `costs:read`, `payables:read`, `payables:manage`, `payables:pay`, `payables:reverse` e `financial-reports:read`. Nenhuma alteração em banco.
- [ ] Administradores recebem tudo que o plano inclui. Vendedores só por concessão explícita.
- [ ] Conta de serviço do job: a mesma da API.
- [ ] Conta de serviço do agendador: só `roles/run.invoker` no job.

## 3. Índices

- [ ] Revisar a [auditoria](../../docs/audits/indices-gestao-2026-11-04.md): 34 a criar, nenhum a remover.
- [ ] Publicar, sem `--force`:

  ```bash
  firebase deploy --only firestore:indexes --project lastro-hml --config firebase.json
  ```

- [ ] Aguardar todos `READY`. Critério: 184 índices.

  ```bash
  gcloud firestore indexes composite list --project=lastro-hml --database="(default)" --format="value(state)"
  ```

## 4. API

- [ ] Gerar e publicar a imagem. Flags omitidas mantêm ambiente e segredos:

  ```bash
  gcloud run deploy lastro-api-hml --source=backend --region=southamerica-east1 --configuration=lastro-hml --quiet
  ```

- [ ] `/health/live` e `/health/ready` respondem 200.
- [ ] Anotar a nova revisão.

## 5. Frontend

- [ ] Só depois da API: o contrato novo traz o plano `gestao` e os campos novos.
- [ ] Publicar por push em `main`, ou manualmente a partir da raiz do repositório. Em publicação manual, apague `%TEMP%\metro-cache` antes.
- [ ] Conferir no pacote publicado que não há `127.0.0.1` nem `demo-lastro`.

## 6. Agendamento de recorrências

**Fase de preparação.** Cria o job, sem agendar nada. Exige a API Cloud Scheduler habilitada, hoje desligada em `lastro-hml`.

- [ ] Criar o job:

  ```bash
  gcloud run jobs create lastro-recurring-hml --region=southamerica-east1 --image=IMAGEM_DA_API --service-account=lastro-api-hml@lastro-hml.iam.gserviceaccount.com --command=node --args=dist/src/jobs/recurringExpenses.js --set-env-vars=NODE_ENV=production,FIREBASE_MODE=production,FIREBASE_PROJECT_ID=lastro-hml,STORAGE_BUCKET=lastro-hml.firebasestorage.app,CORS_ORIGINS=https://lastro-hml.vercel.app --set-secrets=INVITATION_SECRET=lastro-invitation-secret:latest --max-retries=1 --task-timeout=15m
  ```

- [ ] Simular, sem gravar. Critério: `recurring.generation.completed` com `dryRun: true` e `failed: 0`:

  ```bash
  gcloud run jobs execute lastro-recurring-hml --region=southamerica-east1 --wait --args=dist/src/jobs/recurringExpenses.js,--dry-run
  ```

**Fase de ativação.** Só com autorização específica. Não faz parte da publicação.

- [ ] Executar uma vez manualmente e conferir títulos em uma empresa de teste.
- [ ] Criar a conta do agendador, se ainda não existir, e dar permissão no job:

  ```bash
  gcloud run jobs add-iam-policy-binding lastro-recurring-hml --region=southamerica-east1 --member=serviceAccount:lastro-scheduler-hml@lastro-hml.iam.gserviceaccount.com --role=roles/run.invoker
  ```

- [ ] Agendar:

  ```bash
  gcloud scheduler jobs create http lastro-recurring-daily --location=southamerica-east1 --schedule="30 6 * * *" --time-zone="America/Sao_Paulo" --http-method=POST --uri="https://run.googleapis.com/v2/projects/lastro-hml/locations/southamerica-east1/jobs/lastro-recurring-hml:run" --oauth-service-account-email=lastro-scheduler-hml@lastro-hml.iam.gserviceaccount.com
  ```

- [ ] Criar alerta para `severity=ERROR` com `jsonPayload.event` iniciado em `recurring.generation.`.
- [ ] A cada nova imagem da API: `gcloud run jobs update lastro-recurring-hml --image=IMAGEM_DA_API`.

## 7. Smoke tests

Em empresa de teste no plano Gestão, salvo indicação:

- [ ] Empresas Essencial e Profissional mantêm preço, módulos e acesso.
- [ ] Empresa Essencial recebe `FEATURE_NOT_IN_PLAN` em `GET /purchases`.
- [ ] Listas de compras, títulos, fornecedores e créditos abrem sem erro de índice.
- [ ] Compra confirmada gera títulos e não muda o estoque.
- [ ] Recebimento parcial muda estoque e custo médio.
- [ ] Encerrar saldo com abatimento reduz títulos abertos e mantém o estoque.
- [ ] Pagamento parcial aparece no painel como caixa realizado.
- [ ] Devolução de valor a recuperar aparece como entrada no caixa.
- [ ] Relatórios `purchases-supplier` e `cash-flow` abrem e exportam CSV e PDF.
- [ ] Pedido, recebimento de cliente e movimentação avulsa continuam funcionando.

## 8. Reversão

**Frontend:** seguro a qualquer momento. Promova o deployment anterior na Vercel. A API nova aceita o cliente antigo.

**Índices:** deixar como estão. Índice sem uso não afeta a versão anterior.

**Job:** pausar o agendador basta. Títulos já emitidos continuam válidos.

**API: reverter não é seguro depois do primeiro uso.** Os esquemas da versão anterior são estritos e recusam dados que a versão nova grava:

| Dado gravado pela versão nova                                 | Efeito na versão anterior                 |
| ------------------------------------------------------------- | ----------------------------------------- |
| Cliente criado ou editado (`relationships`, `contactName`, `isSupplier`) | Listas de clientes e pedidos falham |
| Assinatura com plano `gestao`                                 | Acesso da empresa falha                   |
| Movimentação `STOCK_PURCHASE_*` ou origem `purchase`          | Histórico do produto falha                |

Portanto:

- [ ] **Sem nenhum desses dados:** reverta o tráfego para a revisão anotada.

  ```bash
  gcloud run services update-traffic lastro-api-hml --to-revisions=REVISAO_ANTERIOR=100 --region=southamerica-east1
  ```

- [ ] **Com esses dados:** corrija para a frente com nova versão. Reverter exigiria limpar esses campos em produção, operação destrutiva que precisa de decisão própria e do backup da etapa 0.
- [ ] Encerramento de saldo não tem desfazer. Um encerramento errado se corrige no financeiro, não por reversão.

## Comprovação

- [ ] Registrar revisão da API, deployment do frontend, horário e resultado dos smoke tests.
