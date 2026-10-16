# Operação: planos, assinaturas e cobranças

Procedimento para levar a gestão de planos e a cobrança manual a um ambiente (homologação `lastro-hml` nos exemplos). Nada aqui roda automaticamente. Cada passo que altera um projeto real precisa da autorização do responsável.

Regras de negócio: [ADR 0009](adr/0009-planos-oficiais-e-recursos.md) (planos e recursos) e [ADR 0010](adr/0010-cobranca-manual-e-vigencia.md) (cobrança e vigência).

## Ordem de implantação

1. **Índices.** Declarados em `firestore.indexes.json` por `scripts/platform-indexes.mjs`. Em `backend/`, com a conta e o projeto corretos:

   ```bash
   firebase deploy --only firestore:indexes --project lastro-hml
   ```

   Espere todos os índices ficarem prontos no console antes do passo 2. Sem eles, histórico, listas de cobranças e o indicador de recebidos no mês falham.

2. **API e frontend juntos.** A versão 0.9.0 removeu `POST/PATCH /admin/plans` e `PATCH /admin/subscriptions/{id}`, e `POST /admin/tenants` passou a exigir `planCode`. O painel antigo não cria empresas contra a API nova. Publique os dois na mesma janela.

3. **Migração em dry-run.** Ela só lê e imprime o relatório por empresa:

   ```bash
   gcloud run jobs create lastro-migrate-plans-hml --region=southamerica-east1 --image=IMAGEM_DA_API --service-account=lastro-api-hml@lastro-hml.iam.gserviceaccount.com --command=node --args=dist/src/jobs/migratePlans.js,--confirm-project=lastro-hml --set-env-vars=NODE_ENV=production,FIREBASE_MODE=production,FIREBASE_PROJECT_ID=lastro-hml,STORAGE_BUCKET=lastro-hml.firebasestorage.app,CORS_ORIGINS=https://lastro-hml.vercel.app --set-secrets=INVITATION_SECRET=lastro-invitation-secret:latest --max-retries=0
   ```

   ```bash
   gcloud run jobs execute lastro-migrate-plans-hml --region=southamerica-east1 --wait
   ```

   Leia o resultado nos logs da execução. Confira cada empresa:
   - `migrated`: vai para Profissional, mantém o valor e fica aguardando ativação.
   - `skipped`: `custom_user_limit`, `over_capacity` ou `canceled`. Exige decisão manual e não é alterada.
   - `super_admin_is_only_admin`: o Super Admin é o único administrador. O vínculo continua contando vaga até a empresa ter um administrador próprio.
   - `counter_mismatch`: contadores divergentes. Reconcilie antes de aplicar.

4. **Migração aplicada**, só depois da revisão do dry-run:

   ```bash
   gcloud run jobs execute lastro-migrate-plans-hml --region=southamerica-east1 --wait --args=dist/src/jobs/migratePlans.js,--confirm-project=lastro-hml,--apply
   ```

   A migração é idempotente. `--tenant=<id>` limita a uma empresa. Localmente, contra emuladores, use `npm run migrate:plans` (dry-run) e `npm run migrate:plans -- --apply`.

5. **Ativação da cobrança.** No painel, em Assinaturas, ative cada empresa migrada com o valor, o dia de vencimento e o início da cobrança combinados. Nenhuma cobrança é criada antes disso, nem para meses anteriores.

6. **Agendador diário.** Use um Cloud Run Job com a mesma imagem, disparado pelo Cloud Scheduler. Não há endpoint público.

   ```bash
   gcloud run jobs create lastro-billing-hml --region=southamerica-east1 --image=IMAGEM_DA_API --service-account=lastro-api-hml@lastro-hml.iam.gserviceaccount.com --command=node --args=dist/src/jobs/billingCycle.js --set-env-vars=NODE_ENV=production,FIREBASE_MODE=production,FIREBASE_PROJECT_ID=lastro-hml,STORAGE_BUCKET=lastro-hml.firebasestorage.app,CORS_ORIGINS=https://lastro-hml.vercel.app --set-secrets=INVITATION_SECRET=lastro-invitation-secret:latest --max-retries=1 --task-timeout=10m
   ```

   ```bash
   gcloud iam service-accounts create lastro-scheduler-hml --project=lastro-hml
   ```

   ```bash
   gcloud run jobs add-iam-policy-binding lastro-billing-hml --region=southamerica-east1 --member=serviceAccount:lastro-scheduler-hml@lastro-hml.iam.gserviceaccount.com --role=roles/run.invoker
   ```

   ```bash
   gcloud scheduler jobs create http lastro-billing-daily --location=southamerica-east1 --schedule="0 6 * * *" --time-zone="America/Sao_Paulo" --http-method=POST --uri="https://run.googleapis.com/v2/projects/lastro-hml/locations/southamerica-east1/jobs/lastro-billing-hml:run" --oauth-service-account-email=lastro-scheduler-hml@lastro-hml.iam.gserviceaccount.com
   ```

   Exigem as APIs Cloud Run e Cloud Scheduler habilitadas. Copie as variáveis do serviço `lastro-api-hml` se forem diferentes das mostradas. A cada nova imagem da API, atualize os jobs com `gcloud run jobs update NOME --image=IMAGEM_DA_API`. O botão "Gerar agora" do painel (`POST /admin/charges/generate`) aplica a mesma regra e serve de contingência.

## Verificação

- O log do job mostra `billing.generation.completed` com `failed: 0`. Se houver falha, a execução sai com código 1 e o Scheduler registra o erro. Uma nova execução não duplica nada.
- No painel, a visão geral mostra MRR contratado, cobranças em aberto e vencidas e o valor recebido no mês.

## Reversão

Depois que a API nova grava o primeiro documento (convite, vínculo, assinatura ou cobrança), voltar para a API anterior **não é seguro**: os schemas antigos são estritos e recusam os campos novos (`planCode`, `seatExempt`, `billing*`), o que bloquearia o acesso das empresas. Corrija para frente. Antes de qualquer escrita, a reversão é só voltar a imagem anterior. A migração não tem desfazer automático. O relatório e os `auditLogs` (`subscription.migrated`, `membership.seat_exempted`) guardam os valores anteriores para uma correção manual.
