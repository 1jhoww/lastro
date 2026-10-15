# Validação vigente - Fases A-G

## Rodada pós-auditoria: F02

**F02 RESOLVIDO localmente: 602 testes únicos aprovados, zero falhas finais ou pendências.** São 227 unitários e 375 emulados únicos: regressão integral de 374, mais um teste novo no recorte adicional de quatro (três sobrepostos). Os 493 A-G e os 330 cenários emulados F01 permanecem presentes e aprovados. Os dois cenários de 20.000 fontes válidas diretas concluíram cancelamento/devolução com recuperação, saldos íntegros, estoque correto e publicação única. Nenhum recebimento dessas fixtures foi enviado pela API.

Executor durável, provas fragmentadas, visão econômica anterior, locks/fences e oito rotas opt-in validados. TypeScript, lint, formatação, build e scanner de segredos passaram. OpenAPI 0.8.0: 114 operações e tipos sincronizados. Resultados, escopo das métricas, reproduções e contratos em [validação F02](validation-f02.md), [entrega F02](f02-delivery.md) e [contrato de execuções](api/financial-executions.md). Integração local pronta com ressalvas; nenhum aceite de produção ou capacidade real.

20.000 chamadas HTTP reais permanecem pendentes de homologação/capacidade. F03-F07 continuam no [plano posterior](audits/remediation-plan-f03-f07.md), incluindo runtime/artefato e divergências de esquemas de saída. Índices, IAM/TLS, retenção/backups e limites/custos produtivos exigem homologação autorizada. Emuladores não certificam segurança ou desempenho em produção.

## Rodada pós-auditoria: F01, preservada

**523 testes aprovados, zero falhas ou pendências:** 193 unitários e 330 com Auth/Firestore/Storage Emulators, em 9/10/2026. Os 493 anteriores foram preservados; nove unitários e 21 cenários HTTP novos cobrem checkpoint, falha cumulativa, ausência/duplicata, concorrência, cursores antigos e isolamento. Suíte emulada: 24 arquivos, 1.035,80 segundos, saída zero. TypeScript, lint, formatação e build real aprovados; OpenAPI/tipos regenerados, 0.7.0 e 106 operações preservados. Emuladores encerrados e listeners conferidos com permissão adequada.

F01 corrigido; [evidências e limites](validation-f01.md). O resultado F02 vigente está na seção acima. O [projeto aprovado](proposals/financial-resumable-resolution.md) permanece referência do desenho e das decisões, não certificado de capacidade produtiva.

## Validação G anterior, preservada

**493 testes aprovados, zero falhas, pendentes ou TODO:** 184 unitários e 309 com Auth/Firestore/Storage Emulators, em 9/10/2026. Os 423 A-F foram preservados; G acrescenta 70 testes. Regressão emulada final: 23 arquivos, 869,238 segundos, saída zero. Nenhum teste removido, desabilitado ou enfraquecido. Emuladores encerrados após a execução.

TypeScript strict, lint, formatação e build aprovados. OpenAPI 3.1/0.7.0 com 106 operações reais, seis downloads novos e sete rotas públicas F preservadas. Tipos regenerados. Auditorias completa/runtime de dependências: zero vulnerabilidades conhecidas. Scanner local de assinaturas: findings=[]. Fontes licenciadas e renderizador compilado carregados corretamente.

G implementa PDF comercial histórico e romaneio operacional privados, sob demanda e sem Storage. CSVs administrativos de clientes/produtos/pedidos/títulos são paginados, com projeções explícitas, UTF-8/BOM e neutralização de fórmulas. Autorização atual de tenant/perfil/carteira, revalidação após geração, limites de memória/bytes/tempo/concorrência e cota compartilhada foram exercitados. Administração existente foi validada sem duplicar endpoints, modificar plano inicial de duas vagas ou liberar comércio para plataforma.

PDFs de 1/20/50/100/200 produtos, acentos, nomes/SKU extensos, estado cancelado/confirmado/expedido e retornos físicos parciais/integral/danificados passaram. Nome empresarial com 120 letras largas mantém cabeçalho sem sobreposição. QA renderizou 54 páginas A4 reais, sem páginas vazias ou texto fora da área imprimível. PDFs de 200 produtos: 30 páginas comerciais/21 operacionais. Romaneio de 200 expedidos preservou um retorno vendável, um danificado e 198 pendentes, sem valores financeiros ou nova expedição.

Regressão A-F preserva ausência de mínimo comercial, centavos inteiros, reservas/estoque/recebíveis atômicos, permissões e isolamento. Recebimentos parciais, estornos, créditos rastreáveis, obrigações manuais, retornos/danos e fontes cumulativas passaram. Receber versus cancelar, crédito versus estorno, expedir versus cancelar e replay concorrente de 200 linhas mantiveram invariantes. Falhas seguidas de retry recuperaram efeitos integralmente. Nenhum domínio comercial foi alterado por falha/repetição de download. Catálogo público e orçamento transitório F permanecem validados, sem persistência ou envio automático.

Resultados, arquivos e reprodução em [validação G](validation-phase-g.md), [entrega G](phase-g-delivery.md) e [Fase G](phase-g.md). Integração Bearer/download/compartilhamento Web/React Native/Expo em [contrato frontend](api/frontend-contract.md), [OpenAPI](api/openapi.json) e [tipos](api/generated-types.ts).

Históricos preservados: [validação F](validation-phase-f.md), [entrega F](phase-f-delivery.md), [E](validation-phase-e.md), [entrega E](phase-e-delivery.md), [D - revisão de 255](validation-phase-d-revision.md), [D - 223](validation-phase-d.md), [C](validation-phase-c.md), [B](validation-phase-b.md), [A](validation-phase-a.md). Proposta de snapshots grandes não implementada; regras de [devoluções](proposals/dispatched-returns.md) vigentes.

Limites: ausência de endereço/documento histórico no pedido, fontes sem cobertura universal de CJK/emoji (recusa explícita), CSV por página sem snapshot global e orçamento de tempo cooperativo. Emulação não comprova p95/p99, cem usuários, custo, índices implantados, leitores mobile ou backups produtivos. IAM/TLS/MFA, retenção/TTL, recuperação, carga e homologação de dispositivos permanecem na auditoria/integração. Sem deploy, commit, push, produção, recurso pago ou alteração no frontend/Atual Pet/outros projetos.
