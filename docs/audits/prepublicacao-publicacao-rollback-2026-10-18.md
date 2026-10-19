# Lastro — plano de publicação controlada e rollback

**Proposta não executada.** Cada mudança remota, commit, push, build pago, deploy e promoção depende de autorização específica. O destino de produção ainda precisa ser identificado; os nomes concretos abaixo referem-se somente a `lastro-hml`.

## 1. Artefatos e compatibilidade

| Artefato           | Estado atual                                                                                                         | Exigência para o candidato                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Código local       | HEAD `4051f03` com mudanças Fases 7–9 não commitadas                                                                 | Seleção revisada, sem caches/segredos; commit autorizado e fingerprint do conteúdo testado             |
| Contrato           | OpenAPI `0.9.0`, cópias backend/frontend iguais                                                                      | Registrar SHA-256 e operações; comparar com a dupla atualmente servida                                 |
| Imagem atual hml   | Revisão `lastro-api-hml-00003-jjc`, digest `sha256:a1529f7a0f32f86927ee0a916a3ce618017a67cf14cb2d7bdf8a3db3466a14a7` | Preservar imagem por digest e configuração antiga; não inferir SHA Git pelo nome da imagem             |
| Frontend atual hml | `dpl_6ax4B9GsLyg1rZWr2L27WhotJzDr`, commit `c2509f52…`                                                               | Preservar deployment e variáveis da build; não chamá-lo de release de produção comercial               |
| Backend novo       | Build local aprovado; imagem Linux nova não executada                                                                | Build isolado por lockfile, Node 22.23.3, assets/PDF/Sharp/Firebase testados em Linux; digest imutável |
| Frontend novo      | Export diagnóstico local aprovado; contém configuração remota ainda a corrigir                                       | Novo export depois da correção, com ambiente hml validado; deployment imutável e hash dos assets       |

A versão nominal `0.9.0` não garante que duas builds tenham o mesmo contrato. Não publicar API e frontend de fontes independentes. Chaves públicas Firebase podem estar no bundle; tokens OIDC, senhas, service accounts e segredo de convite nunca podem entrar no export, imagem ou evidência pública.

O Vercel já recebe deploys ligados a GitHub. O estado completo de auto-deploy/integração não foi comprovado pela inspeção sanitizada. **Push pode disparar publicação.** Antes de autorizar push, confirmar triggers, branch de produção e proteções do projeto. Não tratar push como operação separada de risco zero.

## 2. Ordem de homologação

1. Fechar o [checklist obrigatório](prepublicacao-diagnostico-2026-10-18.md#8-checklist-de-liberação) necessário para iniciar testes: índices, ambiente, IAM, segurança, orçamento, recuperação e origem de teste.
2. Após autorização, adicionar somente os índices faltantes e isenções aprovadas. Não remover os 134 índices existentes. Esperar `READY` e validar filtros reais com fixtures autorizadas.
3. Aprovar os dados de recuperação: RPO/RTO, backup restaurável em projeto/banco isolado, configuração atual, versão de segredo, contratos, imagens e deployments anteriores. Não restaurar banco sobre dados ativos como rollback automático.
4. Autorizar e revisar commit do candidato. Definir versão de release, hashes de lockfiles, contrato e fonte. Sem autorização de commit, limitar-se ao manifesto da árvore local.
5. Construir imagem e export em ambiente isolado, com variáveis corretas. Não executar `vercel deploy` ou `gcloud run deploy` durante um simples build local. Registrar custo de build remoto se ele for necessário.
6. Publicar revisão candidata da API **sem tráfego principal** e frontend candidato sem promoção, somente após autorização de deploy em hml. Fixar segredo em versão numérica aprovada; manter CORS em origem exata de homologação.
7. Executar smoke e matriz funcional contra a dupla candidata. Roteamento/tag/proteção do preview deve estar aprovado; não ampliar CORS globalmente para fazer o teste passar.
8. Se existir compatibilidade comprovada API nova/frontend antigo, promover API e depois frontend dentro da janela acordada. Caso contrário, usar janela de manutenção com bloqueio de novas escritas e dupla coordenada. Não usar tráfego dividido entre APIs incompatíveis que escrevem no mesmo banco.
9. Repetir URLs públicas, health, origem permitida/negada, sessão, permissões, índices, pedido sintético, financeiro e relatórios. Só abrir novas escritas depois do aceite.
10. Registrar revisão/deployment efetivos e observar por 30–60 minutos. Acompanhar primeiras 24 horas com responsável e alertas; isso não é uma automação criada por este plano.

Dry-run de migração de planos, eventual aplicação, ativação de cobrança e Scheduler são operações separadas. Não executar jobs antigos por analogia. Se dados legados exigirem migração, revisar relatório por tenant e contrato de compatibilidade antes de autorizar qualquer escrita. O procedimento histórico de [cobrança](../../backend/docs/operations-platform-billing.md) alerta que schemas antigos podem recusar os campos novos; não promete desfazer automático.

## 3. Configuração proposta para revisão

- Vercel: remover U+FEFF dos três valores públicos identificados, confirmar projeto `lastro-hml`, API HTTPS e frontend HTTPS. Não incluir variável de emulador. Usar quatro valores `EXPO_PUBLIC_*` revisados, sem herdar `.env` demo ou token OIDC.
- Runtime: manter modo produtivo seguro, ADC pela identidade do serviço e bucket correto. Nunca fornecer credencial de produção ao teste.
- Timeout: revisar proposta de 130 s no Cloud Run para permitir o limite de 120 s da aplicação e resposta controlada. Confirmar clientes e ingress; a mudança cria revisão e pode afetar custo. Timeout de plataforma retorna 504 e não encerra necessariamente o processamento. [Semântica oficial](https://docs.cloud.google.com/run/docs/configuring/request-timeout).
- Probes: startup/liveness devem verificar o processo sem reiniciar instâncias por falha transitória do Firestore. Usar readiness dependente de Firestore como verificação de liberação/monitoramento, com cadência limitada. Confirmar suporte e configuração efetivos do provedor. [Health checks Cloud Run](https://docs.cloud.google.com/run/docs/configuring/healthchecks).
- Concorrência/memória: não aumentar 40 requisições ou instâncias com base somente nos ensaios emulados. Reconciliar os limites de serviço/revisão e validar pressão de memória e ReadGates em Linux.
- Proxy: preservar confiança restrita até demonstrar peer/headers reais. Não substituir por `trust proxy=true`, número de hops ou CIDR amplo.
- Segredo: usar a versão habilitada aprovada sem rotacionar valores durante a promoção. Conservar acesso e versão anteriores; `latest` dificulta reprodução e rollback.
- Backup/monitoramento: aprovar retenção, proteção contra exclusão, teste de restauração e alertas de 5xx, 504, OOM, latência, retries, falhas financeiras e custo. Alertas não impõem teto de gasto.

## 4. Critérios de sucesso e interrupção

Sucesso exige todos os gates obrigatórios aprovados no destino; imagens e deployments rastreáveis; índices `READY`; CORS/URLs/Auth coerentes; ausência de vazamento ou efeito duplicado; reconciliação financeira e de estoque; perfis/vagas corretos; recuperação ensaiada; acessibilidade dos canais lançados; métricas dentro dos limites remotos acordados.

Interromper promoção e novas escritas por quebra de contrato, 401/403 inesperado em fluxo permitido, falha de IAM, índice ausente, vazamento entre empresas, duplicação, divergência de estoque/dinheiro, corrupção de prova, resultado desconhecido sem reconciliação, restart/OOM, 5xx persistentes, indisponibilidade de Auth/Firestore ou custo fora do orçamento. Não esconder 409/429 previstos; distingui-los pelos códigos e invariantes.

Não repetir automaticamente comandos financeiros após 503/504. Observar resultado e repetir apenas a mesma intenção com chave/corpo originais quando o procedimento permitir.

## 5. Rollback com preservação dos dados

| Situação                                                         | Ação permitida após autorização                                                  | Restrição                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Candidato sem tráfego e sem escrita                              | Abandonar promoção e manter revisão/deployment atuais                            | Conservar artefatos; nenhuma limpeza automática                                                    |
| Troca de código sem mudança de schema e sem escrita incompatível | Direcionar tráfego à revisão e deployment anteriores comprovadamente compatíveis | Revisar configuração e versão do segredo, não só imagem                                            |
| Novo código já escreveu campos/estados incompatíveis             | Bloquear novas escritas, preservar logs/provas e corrigir para frente            | Não voltar cegamente à API antiga; schemas estritos podem bloquear acesso                          |
| Comando financeiro com resposta perdida                          | Consultar execução/estado, reconciliar e retomar com idempotência                | Não apagar ledger, provas, auditoria ou ajustar saldo manualmente                                  |
| Dano real aos dados                                              | Abrir incidente; restaurar backup/PITR em destino isolado e comparar             | Restauração sobre banco ativo exige plano e autorização próprios; pode perder escritas posteriores |
| Índice recém-criado                                              | Em geral, conservar índice durante rollback do código                            | Excluir/recriar índices não é requisito do rollback; evitar regressão da versão antiga             |
| Isenção de campo aplicada                                        | Reavaliar dependência de ambas as versões antes de reindexar                     | Reindexação pode custar e demorar; nunca modificar em massa por reflexo                            |

Modelos abaixo **não foram executados**. Não colar antes de confirmar destino, compatibilidade, snapshot e autorização:

```powershell
# MODELO DE REVERSÃO HML: somente se a revisão antiga continuar compatível com os dados.
gcloud run services update-traffic lastro-api-hml --project=lastro-hml --region=southamerica-east1 --to-revisions=lastro-api-hml-00003-jjc=100

# MODELO VERCEL HML: reverte build e variáveis daquela build; não reverte dados ou API.
vercel rollback lastro-pyuf1v3f2-jhow-s-projects3.vercel.app
```

Cloud Run permite dirigir tráfego a uma revisão anterior; isso não reverte banco, segredo ou frontend. [Tráfego e rollback](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration). Rollback Vercel reutiliza a build e configuração dela, não as variáveis recém-editadas. [Instant Rollback](https://vercel.com/docs/instant-rollback).

## 6. Produção comercial

Não há comando pronto de produção porque projeto, domínio, bucket, identidade e orçamento não foram confirmados. Antes de preparar esse comando, registrar ambiente separado, isolamento de credenciais/dados, DNS/TLS, Auth, IAM, Rules, índices, backup, custo, responsáveis e canal mobile.

Repetir os gates no destino de produção com dados de aceite autorizados. Homologação `lastro-hml` aprovada não autoriza modificar outro projeto. A promoção comercial exige autorização explícita da versão, janela, estratégia de interrupção e responsável pelo rollback.
