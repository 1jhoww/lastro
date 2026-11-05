# Lastro Gestão: backup, recuperação e correção progressiva

Estratégia preparada, sem nada criado. Complementa [recovery.proposal.json](recovery.proposal.json).

## O problema

A API anterior usa esquemas estritos. Se ler um registro com campo ou valor novo, ela falha. Reverter a API não é, portanto, um botão seguro para sempre.

| Dado                                         | Efeito na API anterior                  |
| -------------------------------------------- | --------------------------------------- |
| Assinatura com plano `gestao`                | Acesso daquela empresa falha            |
| Fornecedor (`relationships`, `isSupplier`)   | Lista de clientes e pedidos falham      |
| Cliente com **Contato responsável**          | Lista de clientes e pedidos falham      |
| Movimentação `STOCK_PURCHASE_*`              | Histórico do produto falha              |

## O que já foi feito para reduzir o risco

- **Cliente comum continua no formato antigo.** Os valores padrão não são gravados. Publicar a API nova, sozinha, não fecha o caminho de volta.
- **Verificador somente de leitura.** `dist/src/jobs/gestaoRollbackCheck.js` lista empresas e motivos que impedem reverter, sem expor conteúdo. Termina com código 2 se reverter quebraria leituras.

Em ambiente real, o verificador roda como execução única da mesma imagem, com uma conta que tenha leitura no Firestore:

```bash
gcloud run jobs create lastro-rollback-check-hml --project=lastro-hml --region=southamerica-east1 --image=IMAGEM_DA_API_NOVA --service-account=lastro-job-hml@lastro-hml.iam.gserviceaccount.com --command=node --args=dist/src/jobs/gestaoRollbackCheck.js --set-env-vars=NODE_ENV=production,FIREBASE_MODE=production,FIREBASE_PROJECT_ID=lastro-hml,STORAGE_BUCKET=lastro-hml.firebasestorage.app,CORS_ORIGINS=https://lastro-hml.vercel.app --set-secrets=INVITATION_SECRET=lastro-invitation-secret:latest --max-retries=0 --task-timeout=10m
```

```bash
gcloud run jobs execute lastro-rollback-check-hml --project=lastro-hml --region=southamerica-east1 --wait
```

## Pontos sem volta

| Momento                                       | Reverter a API?                                     |
| --------------------------------------------- | --------------------------------------------------- |
| Revisão nova sem tráfego                      | Sim, nada mudou                                     |
| Tráfego na API nova, sem uso de recursos novos | Sim, se o verificador disser `rollbackSafe: true`  |
| Alguém preencheu Contato responsável          | Não, sem ponte                                      |
| Primeira empresa no plano Gestão              | Não: corrija para a frente                          |

O campo Contato responsável aparece para todos os planos, então pode fechar o caminho antes do plano Gestão. Por isso o verificador roda antes de qualquer reversão.

## Camadas de proteção

| Camada              | Protege contra                          | Estado    | Decisão                     |
| ------------------- | --------------------------------------- | --------- | --------------------------- |
| Proteção de exclusão | Apagar o banco                         | Ativa     | Manter                      |
| Exportação pontual  | Publicação que dá errado                | Não existe | Obrigatória antes de publicar |
| Backup diário       | Erro descoberto dias depois             | Não existe | Aprovar custo               |
| PITR de 7 dias      | Erro recente, com precisão de minutos   | Desativado | Aprovar custo               |
| Revisões Cloud Run  | Código com defeito                      | Ativas    | Manter                      |
| Registros contábeis | Saber o que mudou                       | Ativos    | Manter                      |

**Recomendação:** homologar só com dados fictícios exige ao menos a exportação pontual. Dados financeiros reais exigem backup diário, PITR e um ensaio de restauração concluído.

### Exportação antes de publicar

Exige um bucket próprio, na mesma região. A exportação é cobrada por leitura de documentos, e o arquivo por armazenamento.

```bash
gcloud storage buckets create gs://lastro-hml-backups --project=lastro-hml --location=southamerica-east1 --uniform-bucket-level-access
```

```bash
gcloud firestore export gs://lastro-hml-backups/pre-gestao-AAAAMMDD --project=lastro-hml --database="(default)"
```

### Backup diário e PITR

```bash
gcloud firestore backups schedules create --project=lastro-hml --database="(default)" --recurrence=daily --retention=7d
```

```bash
gcloud firestore databases update --project=lastro-hml --database="(default)" --enable-pitr
```

### Restauração

**Nunca restaure sobre o banco em uso.** Restaure em banco novo, confira e só então decida. Corrigir registros pontuais a partir da cópia costuma ser melhor do que trocar o banco inteiro, porque preserva o que foi registrado depois.

```bash
gcloud firestore databases restore --project=lastro-hml --source-backup=NOME_DO_BACKUP --destination-database=lastro-restauracao
```

O ensaio mede tempo real e confere contagens, isolamento entre empresas, estoque com hash encadeado e título a título. Metas ainda não medidas: perda máxima de 24 horas com backup, 1 minuto com PITR, restauração em 4 horas.

## Correção progressiva

Depois do ponto sem volta, a saída padrão é publicar uma correção. Reverter deixa de ser opção.

| Sintoma                                  | Primeira ação                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| Erro de índice em listas                 | Confira `READY`. Publique o índice que faltar                                     |
| Defeito só no Gestão                     | Mova as empresas para fora do plano: as telas somem, os dados ficam. Corrija e volte |
| Defeito em telas antigas                 | Corrija em revisão nova. Se o verificador permitir, reverta                       |
| Frontend com defeito                     | Promova o deployment anterior na Vercel. É seguro a qualquer momento              |
| Job com defeito                          | Pause o agendador. Títulos gerados continuam válidos                              |
| Título ou estoque errado por uma empresa | Corrija pelos próprios fluxos: estorno, reabertura, ajuste com motivo             |
| Dado corrompido em volume                | Pare as escritas afetadas. Restaure em banco novo e corrija a partir dele         |

Correção de dados em produção por script sempre roda antes em cópia, com simulação e autorização, no mesmo padrão de `migratePlans.ts`.

## Ponte de compatibilidade

Se for preciso voltar depois do uso de Contato responsável, sem Gestão ativo, uma versão ponte resolve sem tocar nos dados:

- Base: a versão anterior, commit `8008300`.
- Mudança: `customerSchema` aceita e ignora `relationships`, `contactName` e `isSupplier`.
- Publicação: revisão própria, depois teste de leitura de clientes.

Ela não foi criada. Vale preparar antes de publicar se a janela de reversão importar. Ela **não** cobre empresas no plano Gestão: para essas, só correção para a frente. Limpar os campos direto no banco é destrutivo e fica fora deste plano.

## Responsabilidades

Cada restauração, reversão ou correção de dados precisa de autorização específica, registro de início e fim, e verificação depois de concluída.
