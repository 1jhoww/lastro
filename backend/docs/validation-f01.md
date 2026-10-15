# Validação pós-auditoria: F01 e projeto F02

Data: 9/10/2026, horário de São Paulo. Backend local Lastro; nenhuma publicação.

## Resultado

**523 testes aprovados, zero falhas ou pendências:** 193 unitários em 12 arquivos e 330 com Auth/Firestore/Storage Emulators em 24 arquivos. Os 493 testes anteriores foram preservados; F01 acrescenta nove unitários e 21 cenários HTTP. O teste histórico de corrupção foi fortalecido para três páginas, sem remover suas verificações anteriores.

F01 está corrigido. F02 tem somente [projeto técnico](proposals/financial-resumable-resolution.md), pendente de aprovação; nenhum workflow/projeção/endpoint de F02 foi implementado. [F03–F07](audits/remediation-plan-f03-f07.md) têm plano posterior e critérios de aceite antes da homologação.

## Red, green e suíte completa

1. Antes da correção, a regressão HTTP com três eventos/páginas falhou exatamente na página final: esperado `consistent: false`, recebido `true`; dez outros testes do arquivo passaram.
2. Depois da correção inicial, os 11 testes de recebimentos passaram, incluindo a regressão ampliada.
3. Novos testes de checkpoint também detectaram a classificação incorreta de token vazio como cursor legado. A implementação foi corrigida; nenhum teste foi enfraquecido.
4. Execução financeira focada: 32 testes HTTP aprovados, em dois arquivos, 140,85 s.
5. Suíte unitária completa: 193 aprovados, 4,60 s.
6. Suíte emulada completa: 330 aprovados, 24 arquivos, 1.035,80 s, saída zero, início às 22:03:07 locais. Artefato preservado em `reports/f01-emulator-tests.raw.json`; contagens conferidas independentemente no JSON.

Em uma limpeza de fixture, o emulador manteve lock por algum tempo: o retry já existente e restrito ao erro `Transaction lock timeout` foi acionado 20 vezes. Isso não repetiu asserções nem comandos da aplicação. Nenhuma configuração, timeout de teste ou política de retry foi alterada nesta rodada.

O primeiro runner encontrou a porta 8080 ocupada. O processo foi identificado com caminho do jar local Lastro, projeto `demo-lastro-phase-a` e pai inexistente: era emulador Java órfão da auditoria anterior. Somente esse processo foi encerrado. Após a suíte final, consulta de listeners com visibilidade adequada confirmou ausência nas portas 9099, 8080, 9199, 4400, 4500 e 9150. A nota no relatório anterior registra a limitação da sua checagem sob sandbox.

## Escopo específico das regressões

- Corrupção de hash na primeira, intermediária e penúltima posição permanece inconsistente até o final.
- Eventos ausentes não são contados como sequência; três documentos restantes resultam em `checkedEvents: 3`.
- Duplicata com hash próprio válido aumenta contagem real e falha na integridade.
- Âncora removida/alterada entre requests conserva posição assinada, contagem das observações e inconsistência.
- Cabeça removida/adulterada falha fechada com `FINANCIAL_INTEGRITY`.
- Novo recebimento invalida a continuação com `409 CONFLICT`; reinício confere a nova cabeça.
- Replay paralelo do mesmo cursor devolve mesma página, sem duplicar contagem ou escrever ledger.
- Cursores antigos válidos exigem reinício explícito; o cursor de histórico continua funcionando.
- Ator, pedido, empresa e limite ficam isolados; assinatura inválida, vendedor e vínculo revogado não passam.
- Checkpoint com IDs e contadores máximos cabe nos 1024 caracteres do contrato; formato desconhecido, token vazio/excessivo e outra chave/escopo são rejeitados.
- Fluxo sem eventos retorna contagem zero e não cria projeção financeira.

Contagem é cumulativa de eventos observados, não quantidade atual de documentos após uma alteração privilegiada. Ledger é imutável pelos writers normais; checkpoint não cria snapshot global entre requests nem protege contra reescrita privilegiada de páginas antigas depois da leitura. Essa limitação está explícita no contrato.

## Contrato e ferramentas

TypeScript strict, lint, formatação e **build real** aprovados. OpenAPI e tipos regenerados; versão estrutural preservada em 0.7.0, 106 operações únicas. O gerador em memória coincide com JSON salvo. A mudança de contrato F01 é semântica/documental, sem novos endpoints ou campos de resposta.

`409 FINANCIAL_RECONCILIATION_RESTART_REQUIRED` identifica cursor legado válido do escopo/cabeça atuais. Legacy com cabeça antiga, outro escopo ou assinatura inválida retorna `422 VALIDATION_ERROR`. Continuação v1 após mudança financeira retorna `409 CONFLICT`. Os caminhos e exemplos estão no [contrato frontend](api/frontend-contract.md).

Dependências não foram alteradas. O resultado npm zero vulnerabilidades da auditoria anterior não foi convertido em certificação nova do runtime. F06 permanece pendente. Scanner local reexecutado: `findings: []`; é limitado aos padrões configurados e não certifica ausência geral de segredos.

## Regressão A–G e limites

Passaram novamente permissões/isolamento, estoque/reservas, pedidos de 1–200 produtos, recebimentos/estornos/créditos, devoluções/danos, catálogo, PDFs/CSV e corridas existentes. Pedido concorrente de 200 linhas retornou `[200,409]`; replay concorrente retornou `[200,200]`. Cancelamento financeiro de 200 produtos levou 816 ms; devolução física 1.915 ms e resolução 1.849 ms, com histórico pequeno.

PDFs de 200 produtos continuaram com 30 páginas comerciais e 21 operacionais. A suíte inspeciona seus arquivos; não foi feita nova QA visual manual. Métricas locais não comprovam performance, IAM, índices implantados ou limites de produção.

Os ensaios de 20.000 fontes de F02 permanecem como evidência da auditoria. A matriz do projeto distingue fixtures de capacidade de 20.000 chamadas reais; seus testes de execução retomável ainda não existem e não entram nos 523.

## Arquivos e decisões

Código F01: `financialReads.ts`, novo `finance/reconciliationCursor.ts` e descrição em `financeRoutes.ts`. Testes: novo unitário e integração `financialReconciliation.test.ts`; reforço de `financeReceipts.test.ts`. Contratos: OpenAPI, tipos e frontend contract. Documentação: Fase E, validação vigente, nota histórica da auditoria, README, este registro, projeto F02 e plano F03–F07.

**Próximo gate:** aprovar projeto F02 antes de implementação. Continuam bloqueantes a completabilidade dos históricos grandes e a aprovação/validação da sua mudança estrutural. Sem deploy, commit, push, produção, recursos pagos, snapshots grandes ou mudanças no frontend/Atual Pet/outros projetos.
