# Lastro: publicação da API antes do frontend

Procedimento preparado em 05/11/2026. **Nada foi executado.** A homologação usa estes passos primeiro. A produção repete a mesma ordem, com as diferenças indicadas no fim.

## Por que a API vai primeiro

O frontend novo depende de rotas novas, como `/admin/custom-plans` e as de compras. A API nova continua atendendo o frontend antigo, então existe uma janela segura com API nova e frontend antigo. O contrário quebra telas.

## Compatibilidade verificada

Comparação do contrato publicado (`d82ed89`) com a versão candidata, feita em 05/11/2026:

| Verificação                                | Resultado            |
| ------------------------------------------ | -------------------- |
| Operações na API publicada                 | 159                  |
| Operações na candidata                     | 219, sendo 60 novas  |
| Operações removidas                        | 0                    |
| Campos obrigatórios novos em entrada       | 0                    |
| Campos removidos de entrada ou resposta    | 0                    |
| Valores removidos de enum em resposta      | 0                    |
| Parâmetros obrigatórios novos              | 0                    |

Confirme antes de publicar que `d82ed89` ainda é a versão no ar. O contrato não mostra tudo. Estas mudanças de comportamento exigem atenção:

| Mudança                                                 | Efeito com frontend antigo                                  | Regra                                    |
| ------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `planCode` pode valer `custom`                          | Tela antiga recebe um valor desconhecido                    | Não criar contrato personalizado antes do frontend novo |
| Plano `gestao` novo                                     | Tela antiga não conhece o plano                             | Não vender Gestão antes do frontend novo |
| Sair de contrato de R$ 0,00 exige valor                 | Super Admin antigo recebe `PLAN_PRICE_REQUIRED`             | Sem efeito hoje: não há contrato gratuito |
| Permissões `recurring:*` e `supplier-credits:read`      | Só afetam telas do Gestão                                   | Nenhuma ação                             |

Os dados não mudam ao publicar. Clientes comuns seguem no formato antigo, então a reversão continua possível até o primeiro uso de um recurso novo.

## Antes de começar

- [ ] `feat/lastro-gestao` validada: testes completos, typecheck, lint, build e `check:openapi`.
- [ ] Todos os índices `READY`. Em homologação, 184.
- [ ] Nenhuma variável de homologação aponta para `lastro-hml`.
- [ ] Identidade conferida: `gcloud config get-value project --configuration=lastro-homolog`.
- [ ] Sem push para `main`.

## Passo a passo em homologação

Valores completos em [homolog-config.proposal.json](homolog-config.proposal.json).

### 1. Publicar a API sem tráfego

Rode a partir da raiz do repositório.

```bash
gcloud run deploy lastro-api-homolog --source=backend --project=lastro-homolog --region=southamerica-east1 --service-account=lastro-api-homolog@lastro-homolog.iam.gserviceaccount.com --min-instances=0 --max-instances=2 --cpu=1 --memory=1Gi --concurrency=40 --timeout=60 --allow-unauthenticated --no-traffic --tag=candidata --set-env-vars=NODE_ENV=production,FIREBASE_MODE=production,FIREBASE_PROJECT_ID=lastro-homolog,STORAGE_BUCKET=lastro-homolog.firebasestorage.app,CORS_ORIGINS=https://lastro-homolog.vercel.app,PUBLIC_ORIGIN=URL_DA_API,RATE_LIMIT_MAX=180,TRUST_PROXY_HOPS=0,TRUST_PROXY_ADDRESSES=169.254.169.126/32 --set-secrets=INVITATION_SECRET=lastro-invitation-secret:latest --configuration=lastro-homolog
```

Na primeira publicação do serviço, `--no-traffic` não se aplica. A URL final só existe depois dela, então repita a publicação com `PUBLIC_ORIGIN` correto.

### 2. Conferir a revisão

- [ ] `/health/live` responde 200.
- [ ] `/health/ready` responde 200.
- [ ] `HTTPS_REQUIRED` não aparece. Se aparecer, revise `TRUST_PROXY_ADDRESSES`.
- [ ] Os logs não mostram erro de inicialização.

### 3. Mover o tráfego

```bash
gcloud run services update-traffic lastro-api-homolog --project=lastro-homolog --region=southamerica-east1 --to-latest --configuration=lastro-homolog
```

Depois rode o verificador de reversão. Em homologação vazia, o esperado é `rollbackSafe: true`.

### 4. Publicar o frontend

Só depois da API. As variáveis são públicas, e nenhuma pode conter `lastro-hml`.

O arquivo `.vercel/project.json` aponta para a produção. **Nunca rode `vercel deploy` sem as duas variáveis abaixo.**

```powershell
$env:VERCEL_ORG_ID='ID_DA_EQUIPE'; $env:VERCEL_PROJECT_ID='ID_DO_PROJETO_LASTRO_HOMOLOG'; vercel deploy --prod
```

Antes, apague `%TEMP%\metro-cache`. Um cache antigo já inseriu valores errados no pacote.

### 5. Conferir o pacote

- [ ] O pacote publicado não contém `lastro-hml`, `127.0.0.1` nem `demo-lastro`.
- [ ] O domínio do frontend está nos domínios autorizados do Firebase Auth.
- [ ] Login, tela inicial e Super Admin funcionam.
- [ ] Sem erro de CORS no navegador.

## Critérios para parar

Interrompa e não siga para a próxima etapa se ocorrer qualquer um destes:

- Índice fora de `READY`.
- `/health/ready` diferente de 200.
- Taxa de erro 5xx acima da revisão anterior.
- Erro de índice em qualquer lista.
- Variável apontando para outro ambiente.
- Diferença entre o inventário e o estado esperado.

## Recuperação

| Momento                                  | O que fazer                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| Revisão com defeito, sem tráfego         | Não mover o tráfego. Nada mudou                                             |
| Defeito depois de mover o tráfego        | Rodar o verificador. Com `rollbackSafe: true`, voltar à revisão anterior    |
| Verificador informa bloqueio             | Corrigir para a frente. Veja a [recuperação](gestao-recuperacao.md)         |
| Frontend com defeito                     | Promover o deployment anterior. Seguro a qualquer momento                   |
| API nova e frontend antigo com erro      | Manter o frontend antigo e investigar a API antes de seguir                 |
| Índice em `NEEDS_REPAIR`                 | Parar. Excluir e recriar exige autorização                                  |
| Dado errado em homologação               | Corrigir pelos fluxos ou recriar a empresa de teste                         |
| Dado corrompido em produção              | Parar as escritas afetadas. Restaurar em banco novo e corrigir a partir dele |

```bash
gcloud run services update-traffic lastro-api-homolog --project=lastro-homolog --region=southamerica-east1 --to-revisions=REVISAO_ANTERIOR=100 --configuration=lastro-homolog
```

A reversão da API deixa de existir no primeiro uso real de um recurso novo: Contato responsável, plano Gestão, contrato personalizado ou cobrança nesses planos. Essa regra vale para a produção. Depois desse ponto, corrija para a frente.

## Diferenças em produção

A Parte 2 do [checklist](../../backend/docs/gestao-production-checklist.md) continua sendo o roteiro. Este procedimento não autoriza nada em `lastro-hml`.

| Passo         | Homologação                     | Produção                                                       |
| ------------- | ------------------------------- | -------------------------------------------------------------- |
| Autorização   | H1 a H5                         | Própria, a cada etapa                                          |
| Dados         | Fictícios                       | Reais. Exportação e PITR antes                                 |
| Índices       | Arquivo inteiro, banco vazio    | 32 isenções e 34 índices, um a um. Nunca em bloco              |
| Imagem        | Build a partir do código        | A mesma imagem validada, promovida pelo digest                 |
| Frontend      | CLI, com projeto explícito      | Merge em `main` e promoção, depois de ajustar a publicação automática |
| Observação    | 7 dias                          | 24 horas antes da primeira empresa no Gestão                   |
| Janela        | Livre                           | Combinada, com aviso aos clientes                              |

Promover pelo digest exige que a API de produção leia o repositório de imagens de homologação, com papel de leitura só nesse repositório. Essa permissão é a única ligação entre os ambientes, e também depende de aprovação. Ela não dá acesso a dados.
