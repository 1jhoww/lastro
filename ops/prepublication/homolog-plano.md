# Lastro: plano do ambiente `lastro-homolog`

Plano preparado em 05/11/2026. **Nada aqui foi executado.** Nenhum projeto, índice, job, alerta ou variável foi criado ou alterado. Cada etapa depende da aprovação indicada.

Documentos ligados: [configuração](homolog-config.proposal.json), [custos](homolog-custos.md), [proteção de dados](homolog-protecao-dados.md) e [publicação](homolog-publicacao.md).

## Objetivo

Validar o Lastro Gestão e os planos personalizados em um ambiente real do Google Cloud, sem tocar em `lastro-hml`, que tem clientes reais e é a produção.

## Regras de isolamento

| Regra                                                                   | Como conferir                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Projeto Google próprio, sem recurso compartilhado com a produção        | `--project=lastro-homolog` em todo comando                        |
| Dados sempre fictícios. Nada é copiado de `lastro-hml`                  | Empresas criadas pelo Super Admin, com nomes de demonstração      |
| Base de usuários própria                                                | Contas de teste em domínio `.invalid` ou caixas do responsável    |
| Conta de serviço, segredo e bucket próprios                             | Nenhuma conta de um projeto recebe papel no outro                 |
| Configuração local separada do `gcloud`                                 | Configuração `lastro-homolog`, sem ativar como padrão             |
| Projeto Vercel próprio                                                  | Nenhuma variável aponta para `lastro-hml`                         |
| Sem push para `main`                                                    | A publicação usa a CLI, a partir da branch local                  |

Dois perigos concretos nesta máquina:

- `.vercel/project.json` aponta para o projeto de produção. Publicar a homologação exige informar o projeto, como mostra a [publicação](homolog-publicacao.md).
- Hoje o Preview da Vercel de produção fala com a API dos clientes. Um push de `feat/lastro-gestao` geraria um preview com telas novas sobre a API antiga. A branch segue local até esse ponto ser corrigido.

## Infraestrutura atual

Leitura feita em 05/11/2026, sem alteração. Banco com cerca de 9 MB e poucas leituras e escritas por dia.

| Item              | `lastro-hml`                                                     |
| ----------------- | ---------------------------------------------------------------- |
| Firestore         | `(default)`, Native, Standard, `southamerica-east1`, 150 índices |
| Storage           | `lastro-hml.firebasestorage.app`, exclusão reversível de 7 dias  |
| API               | `lastro-api-hml`, 1 CPU, 1 GiB, até 2 instâncias, concorrência 40 |
| Segredo           | `lastro-invitation-secret`, réplica em `southamerica-east1`      |
| Imagens           | Repositório `cloud-run-source-deploy`, cerca de 372 MB           |
| Jobs              | Nenhum. API do Cloud Scheduler desligada                         |
| Alertas           | Nenhuma política, canal ou verificação de uptime                 |
| Frontend          | Projeto Vercel `lastro-hml`, equipe em plano Hobby               |

## Infraestrutura necessária

| Recurso          | Homologação                                     | Observação                                      |
| ---------------- | ----------------------------------------------- | ----------------------------------------------- |
| Projeto          | `lastro-homolog`, com Firebase                  | Exige faturamento: Cloud Run e Storage não rodam sem ele |
| Autenticação     | Firebase Auth, e-mail e senha                   | Domínio do frontend autorizado                  |
| Banco            | Firestore `(default)`, `southamerica-east1`     | Mesma região da produção, proteção contra exclusão |
| Arquivos         | `lastro-homolog.firebasestorage.app`            | Mesma região                                    |
| API              | `lastro-api-homolog`, mínimo 0, máximo 2        | Sem instância mínima                            |
| Conta de serviço | `lastro-api-homolog@`                           | Mesmos papéis da produção                       |
| Segredo          | `lastro-invitation-secret`, valor novo          | Nunca reutilizar o da produção                  |
| Jobs             | Recorrências, cobrança e verificador            | Criados sem agendamento                         |
| Frontend         | Projeto Vercel `lastro-homolog`                 | Depende da decisão sobre o plano Vercel         |
| Observabilidade  | Orçamento, canal de e-mail, 5 alertas           | Lista na [configuração](homolog-config.proposal.json) |

Não entram: PITR, backup agendado, instância mínima, domínio próprio e GitHub Actions. Nenhum deles é necessário para validar a versão.

## Sequência

### Etapa 0: decisões do responsável

1. Confirmar no console o saldo e o tipo da conta de faturamento. O faturamento nasceu de avaliação, e a CLI não mostra créditos.
2. Escolher a conta de faturamento da homologação.
3. Decidir o plano Vercel. Veja [custos](homolog-custos.md#vercel).
4. Definir o e-mail de alertas. Ele fica fora do repositório.

### Etapa 1: projeto e serviços **[aprovação]**

O identificador pode estar em uso por outra conta. Se recusado, escolha outro e troque em todos os comandos.

```bash
gcloud config configurations create lastro-homolog --no-activate
```

```bash
gcloud projects create lastro-homolog --name="Lastro homologacao" --configuration=lastro-homolog
```

```bash
gcloud billing projects link lastro-homolog --billing-account=CONTA_DE_FATURAMENTO --configuration=lastro-homolog
```

```bash
firebase projects:addfirebase lastro-homolog
```

```bash
gcloud services enable firestore.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com identitytoolkit.googleapis.com monitoring.googleapis.com logging.googleapis.com billingbudgets.googleapis.com --project=lastro-homolog --configuration=lastro-homolog
```

Crie o orçamento antes de qualquer outro recurso. Ele avisa, mas não limita o gasto.

### Etapa 2: banco, arquivos e autenticação **[aprovação]**

```bash
gcloud firestore databases create --project=lastro-homolog --location=southamerica-east1 --type=firestore-native --delete-protection --configuration=lastro-homolog
```

No console do Firebase:

1. Em Authentication, ative o provedor E-mail/senha.
2. Em Storage, inicie o bucket em `southamerica-east1`.

### Etapa 3: regras e índices **[aprovação]**

O ambiente está vazio, então o arquivo pode ser aplicado de uma vez. Esta exceção vale só aqui. **Em `lastro-hml`, continua proibido usar `firebase deploy` em bloco.** Rode a partir de `backend/`, sempre com o projeto explícito.

```bash
firebase deploy --only firestore,storage --project lastro-homolog
```

Critério de saída: 184 índices `READY`, nenhum `CREATING` ou `NEEDS_REPAIR`, 119 configurações de campo e TTL ativo em `rateLimits.expiresAt`. Conferir que a coleção `customPlans` segue fechada: a regra geral nega qualquer acesso direto.

```bash
gcloud firestore indexes composite list --project=lastro-homolog --database="(default)" --format="value(state)" --configuration=lastro-homolog
```

### Etapa 4: identidade da API **[aprovação]**

```bash
gcloud iam service-accounts create lastro-api-homolog --project=lastro-homolog --display-name="Lastro API homologacao" --configuration=lastro-homolog
```

Conceda estes papéis à conta, como na produção:

| Papel                           | Onde                                          |
| ------------------------------- | --------------------------------------------- |
| `roles/datastore.user`          | Projeto                                       |
| `roles/firebaseauth.viewer`     | Projeto                                       |
| Próprio, com `firebaseauth.users.update` | Projeto                              |
| `roles/storage.objectUser`      | Bucket `lastro-homolog.firebasestorage.app`   |
| `roles/secretmanager.secretAccessor` | Segredo `lastro-invitation-secret`       |

Crie o segredo com valor novo, com pelo menos 43 caracteres. O valor não é exibido nem gravado em arquivo.

```bash
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" | gcloud secrets create lastro-invitation-secret --project=lastro-homolog --replication-policy=user-managed --locations=southamerica-east1 --data-file=- --configuration=lastro-homolog
```

### Etapa 5: publicar **[aprovação]**

Siga a [publicação](homolog-publicacao.md): API primeiro, frontend depois.

### Etapa 6: criar os dados de teste

1. Crie uma conta fictícia em Authentication e copie o `uid`.
2. Em Firestore, crie `platformAdmins/{uid}` com os campos `uid`, `status: "active"`, `createdAt` em ISO e `schemaVersion: 1`.
3. Entre no app e crie as empresas pelo Super Admin.

Crie ao menos uma empresa em cada situação: Essencial, Profissional, Gestão, personalizada paga, personalizada gratuita, e personalizada sem compras com crédito de fornecedor quitado.

### Etapa 7: validar

Cumpra as seções 3, 4 e 5 da Parte 1 do [checklist](../../backend/docs/gestao-production-checklist.md) e estes casos:

- [ ] Plano personalizado: criar, vincular, alterar contrato, trocar plano e conferir o histórico.
- [ ] Saída do gratuito: preço oficial sugerido, valor negociado com confirmação, cobranças emitidas intactas.
- [ ] Empresa só vê o nome do plano, as vagas e os recursos do contrato.
- [ ] Contas a pagar sem recorrências: categorias funcionam, e as permissões continuam na janela de permissões.
- [ ] Crédito quitado segue legível depois que o plano perde compras, sem liberar novas operações.
- [ ] Suspender e reativar preservam dados e contrato.
- [ ] Verificador de reversão informa `plan_custom` e `charge_custom`.
- [ ] Listas não retornam erro de índice. O emulador não exige índices, então essa falha só aparece aqui.

### Etapa 8: jobs e alertas **[aprovação]**

Crie os jobs sem agendamento, rode a simulação e só depois crie os alertas. O agendamento tem aprovação própria. Observe por pelo menos 7 dias sem erro inesperado.

## Encerramento

A homologação pode ficar parada: sem instância mínima, o custo em repouso é só de armazenamento. Excluir o projeto é uma decisão à parte. A exclusão fica reversível por 30 dias.

## Aprovações necessárias

| Código | O que autoriza                                                   | Toca a produção? |
| ------ | ---------------------------------------------------------------- | ---------------- |
| H1     | Criar projeto, vincular faturamento e orçamento                  | Não              |
| H2     | Banco, Auth, Storage, regras e 184 índices em homologação        | Não              |
| H3     | Conta de serviço, segredo e publicação da API de homologação     | Não              |
| H4     | Projeto Vercel de homologação e plano escolhido                  | Não              |
| H5     | Jobs, alertas e agendamento em homologação                       | Não              |
| P1     | Ativar backup diário e PITR em `lastro-hml`                      | **Sim**          |
| P2     | Criar bucket de exportação e exportar `lastro-hml`               | **Sim**          |
| P3     | Trocar as variáveis de Preview da Vercel de produção             | **Sim**          |
| P4     | Desligar a publicação automática por push em `main`              | **Sim**          |
