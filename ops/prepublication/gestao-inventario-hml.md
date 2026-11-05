# Lastro Gestão: inventário de `lastro-hml`

Leitura feita em 05/11/2026 com `gcloud`, Firebase CLI e Vercel CLI, sem nenhuma alteração. Valores de segredos e de variáveis não foram lidos.

## Resumo

`lastro-hml` é o único ambiente do Lastro. Não existe homologação separada: o outro projeto visível na conta, `project-c1c123ae-b3b4-4a3a-b24` ("My First Project"), não está vinculado ao Lastro no Firebase.

O banco tem 4 empresas e 4 assinaturas, 2 delas ativas. A contagem foi feita sem ler documentos. **O responsável confirmou que as 2 assinaturas ativas são de clientes reais, então `lastro-hml` é produção, apesar do nome.**

## Firebase e dados

| Recurso                 | Estado                                                       |
| ----------------------- | ------------------------------------------------------------ |
| Projeto Firebase        | `lastro-hml`, único na conta                                 |
| Firestore               | `(default)`, Native, edição Standard, `southamerica-east1`   |
| Proteção contra exclusão | Ativa                                                       |
| PITR                    | **Desativado**                                               |
| Backups agendados       | **Nenhum**                                                   |
| Índices compostos       | 150, todos `READY`                                           |
| Configurações de campo  | 88 remotas; faltam 32 declaradas para o Gestão               |
| TTL                     | `rateLimits.expiresAt`                                       |
| Storage                 | `lastro-hml.firebasestorage.app`, `southamerica-east1`       |

## API

| Item                | Estado                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serviço Cloud Run   | `lastro-api-hml`, `southamerica-east1`                                                                                                                      |
| Revisão ativa       | `lastro-api-hml-00005-g6g`, 100% do tráfego. Revisões 00001 a 00004 continuam disponíveis                                                                   |
| Recursos            | 1 CPU, 1 GiB, máximo de 2 instâncias, timeout de 60 s, ingress público                                                                                      |
| Conta de serviço    | `lastro-api-hml@`, com `roles/datastore.user`, `roles/firebaseauth.viewer` e o papel próprio `lastroRuntimeAuthUpdate`                                      |
| Variáveis (nomes)   | `NODE_ENV`, `FIREBASE_MODE`, `FIREBASE_PROJECT_ID`, `STORAGE_BUCKET`, `CORS_ORIGINS`, `PUBLIC_ORIGIN`, `RATE_LIMIT_MAX`, `TRUST_PROXY_HOPS`, `TRUST_PROXY_ADDRESSES` |
| Segredo             | `INVITATION_SECRET`, vindo de `lastro-invitation-secret`, o único do projeto                                                                                |

O Lastro Gestão não exige variável nova na API nem no frontend.

## Automação e observabilidade

| Item                  | Estado                                         |
| --------------------- | ---------------------------------------------- |
| Cloud Run Jobs        | Nenhum, nem o de cobrança previsto na ADR 0010 |
| API Cloud Scheduler   | **Desligada**                                  |
| Políticas de alerta   | Nenhuma                                        |
| Canais de notificação | Nenhum                                         |
| Verificações de uptime | Nenhuma                                       |
| Métricas de log       | Nenhuma                                        |
| Orçamento             | Um, de alerta                                  |

Hoje uma falha da API só é percebida por quem usa.

## Frontend

| Item                    | Estado                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Projeto Vercel          | `lastro-hml`, ligado ao GitHub                                                                                                            |
| Publicação              | Push em `main` publica como Production                                                                                                    |
| Variáveis               | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_WEB_BASE_URL`, em Production e Preview |
| Preview                 | Usa as mesmas variáveis, portanto a mesma API e o mesmo banco                                                                             |

**Atenção:** um push de `feat/lastro-gestao` pode gerar um preview com as telas novas falando com a API antiga. Por isso a branch segue só local até a API nova estar no ar.

## Pontos para corrigir

1. **Crítico:** sem PITR nem backup, um erro de dados de clientes reais não tem recuperação.
2. **Crítico:** não há nenhum alerta, então uma queda só é percebida pelo cliente.
3. `859974935461-compute@` tem `roles/editor`, papel amplo demais. Ele é usado pelo Cloud Build. Reduzir exige teste próprio.
4. **Crítico:** Preview e Production dividem banco e API, e push em `main` publica direto para os clientes.
5. O projeto nasceu com faturamento de avaliação. O fim dos créditos não pode derrubar clientes reais: confira saldo, validade e tipo de conta.
6. A restrição registrada em [README.md](README.md) continua valendo: não criar recurso com custo sem aprovação.
