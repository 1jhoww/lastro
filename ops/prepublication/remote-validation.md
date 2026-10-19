# Homologação remota sintética — testes preparados, não executados

Esta matriz exige autorização G9, crédito verificado e fixtures aprovadas. Toda requisição pode consumir Cloud Run, Auth e Firestore; o limitador distribuído roda antes da autenticação. Não executar enquanto a restrição de custo estiver vigente. Não criar contas comerciais, enviar e-mails, emitir cobranças ou usar dados reais.

## Preparação revisável

Usar duas empresas sintéticas A/B, administradores A/B, vendedor A e usuário desabilitado. Usar contas exclusivas de teste, por exemplo `hml-a@lastro.invalid`, sem inbox comercial. Se o fluxo exigir e-mail verificado, marcar apenas a fixture aprovada pelo procedimento Admin; não contornar a validação da app. Contas/empresas não foram criadas.

Registrar UIDs, IDs das empresas, cliente exclusivo de B, membro vendedor e versão do candidato em arquivo privado `.local`. Provisionamento e remoção futura são autorizações separadas. Nunca usar seed demo contra `lastro-hml`. Não exportar banco ou configuração Auth integral. Tokens, senha, API key e refresh tokens ficam apenas na memória ou arquivo privado ignorado; relatório público contém caso, status, código seguro e request ID.

Obter sessões por `signInWithEmailAndPassword` real no frontend candidato, com API key pública correta, project ID `lastro-hml`, domínio autorizado e emuladores ausentes. Capturar `getIdToken()` para requisições de teste sem imprimir. Preparar token expirado capturado anteriormente e token de sessão depois revogada, sem adulterar relógio do servidor. Revogar apenas a fixture autorizada. Um token inventado não prova expiração ou revogação reais.

Base API: `https://lastro-api-hml-859974935461.southamerica-east1.run.app/api/v1`. Origem permitida: `https://lastro-hml.vercel.app`. Não chamar a revisão antiga e atribuir resultado ao candidato. Conferir deployment/revisão efetiva antes dos casos.

## Casos e resultados exigidos

| Caso | Requisição/ação real                                                                                           | Verificação                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A01  | Login administrador A com senha de teste correta; `GET /me` com Bearer válido                                  | 200, UID exato de A, nome/e-mail esperados e memberships apenas permitidos                                                      |
| A02  | Login com senha incorreta                                                                                      | Firebase recusa, frontend não cria sessão válida e não exibe erro com dados sensíveis                                           |
| A03  | `GET /me` sem Authorization, token truncado e assinatura inválida                                              | 401, erro seguro e nenhuma informação de empresa                                                                                |
| A04  | `GET /me` com token realmente expirado                                                                         | 401; refresh controlado do cliente não reapresenta token inválido                                                               |
| A05  | `GET /me` com token capturado antes de revogação da fixture                                                    | 401 pela checagem `verifyIdToken(token,true)`                                                                                   |
| A06  | `GET /me` da conta Firebase desabilitada e da identity Lastro desabilitada                                     | 403 em cada camada; nenhuma empresa acessível                                                                                   |
| A07  | Login A após correção das três variáveis                                                                       | Sem BOM no project ID; emissor/audience correspondem a `lastro-hml`; nenhuma chamada de emulador                                |
| P01  | Salvar nome anterior de A. `PATCH /me`, corpo `{"name":"Teste João de Homologação"}`                           | 200 e nome normalizado; nenhuma falha de `firebaseauth.users.update`                                                            |
| P02  | `GET /me`, recarregar frontend e renovar token/reautenticar A                                                  | Nome persiste no Auth e reaparece no perfil; não depende só de estado local                                                     |
| P03  | `PATCH /me` com nome vazio, >80 caracteres, endereço de e-mail, ou campo extra `uid`/`role`/`email`            | 400; nome, e-mail, privilégios e status continuam intactos                                                                      |
| P04  | `PATCH /me` com UID B injetado no corpo/header de empresa B                                                    | Campo extra rejeitado; operação aceita sem campo extra continua restrita ao UID autenticado, nunca muda nome de B               |
| P05  | Comparar `GET /me` de B antes/depois de P01–P04                                                                | Nome/e-mail/permissões de B não mudam                                                                                           |
| P06  | Restaurar nome original não vazio de A via `PATCH /me`                                                         | 200 e persistência confirmada; se nome original era null, usar fixture com nome inicial definido para evitar cleanup impossível |
| I01  | `GET /tenants/current` e `/customers` de A com `X-Tenant-Id: A`                                                | 200, somente dados da empresa A e carteira permitida                                                                            |
| I02  | Mesmos endpoints com token A e `X-Tenant-Id: B`                                                                | 403 `TENANT_ACCESS_DENIED`; não vazar nomes, contagens, cursores ou metadados de B                                              |
| I03  | Token A, header A, `GET /customers/{clienteB}`                                                                 | 404 conforme contrato, sem dados de B; não basta lista vazia                                                                    |
| I04  | Token B, header B, buscar clienteB existente                                                                   | 200, provando que fixture existe e que I03 não é falso positivo                                                                 |
| I05  | Vendedor A tenta `/users` e operação administrativa de outra carteira/empresa                                  | 403; acesso permitido do vendedor continua funcionando                                                                          |
| I06  | Super Admin com sessão antiga e recente em rota `/admin/*` aprovada                                            | Antiga recebe `REAUTHENTICATION_REQUIRED`; recente respeita autorização e escopo. Sem alteração de cobrança                     |
| C01  | OPTIONS e GET com origem permitida; origem externa e preview não autorizado                                    | Origem exata permitida; externa/preview403. Sem wildcard privado ou credentials cookies                                         |
| C02  | Repetir GET com `X-Forwarded-For` e `X-Forwarded-Proto` forjados em quantidade pequena                         | Proxy não aceita endereço arbitrário nem contorna HTTPS/limites. Registrar peer seguro sem publicar IP pessoal                  |
| R01  | Em janela aprovada, exceder orçamento de rate limit com fixtures, mantendo teto de requests                    | 429 com Retry-After; sem aumentar limite ou abrir tráfego para completar teste; não fazer agora                                 |
| H01  | `/health/live` e `/health/ready` na revisão candidata; encerramento sob operação sintética em ambiente isolado | Liveness independente, readiness503 no drain; sem SDK encerrado sob operação pendente; reconciliar resultado após timeout       |
| X01  | Consultas de cobranças, visitas, auditoria e recompra com dados sintéticos e índices `READY`                   | Filtros, ASC/DESC, cursores e isolamento corretos; nenhum `FAILED_PRECONDITION`                                                 |

P01/P06 são escritas Auth; limitadores e logs também escrevem. Não repetir automaticamente uma alteração que devolva resultado desconhecido. Consultar estado antes e repetir apenas a mesma intenção quando aplicável. Erro IAM deve interromper testes de perfil, sem conceder papel Admin como atalho.

## Evidência e aceite

Registrar status/código, UID/tenant pseudonimizados, request ID, revisão/deployment, duração e invariantes. Não salvar bodies com dados pessoais, tokens ou segredos. Comparar estado antes/depois das fixtures autorizadas. Qualquer acesso entre empresas, atualização do UID errado, erro de IAM, custo inesperado ou resultado financeiro não reconciliado interrompe homologação.

Os testes locais em emuladores não comprovam IAM remoto, créditos, headers reais do proxy ou domínio/Auth da build publicada. Esses itens permanecem bloqueios até a execução autorizada desta matriz.
