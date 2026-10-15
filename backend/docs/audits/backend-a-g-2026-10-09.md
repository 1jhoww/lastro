# Auditoria final do backend Lastro A–G

Data: 9 de outubro de 2026, horário de São Paulo. Escopo: exclusivamente o backend local. OpenAPI: 0.7.0.

Nota posterior: F01 recebeu correção e regressões na rodada autorizada pelo usuário. O conteúdo abaixo preserva as evidências anteriores à correção. Ver [validação atual](../validation.md), [contrato F01](../api/frontend-contract.md) e [desenho F02 ainda não implementado](../proposals/financial-resumable-resolution.md). F02 continua bloqueante. A verificação de encerramento anterior não enxergou um processo Java órfão sob o sandbox; na rodada seguinte, caminho/projeto demo foram conferidos com permissão adequada e somente esse processo local foi encerrado.

## 1. Veredito e resumo executivo

**Veredito: bloqueado para aprovação da integração financeira final do MVP.** Telas independentes podem avançar, mas não devem pressupor que os fluxos financeiros estejam definitivamente aprovados. Não foi demonstrada corrupção de saldo ou estoque por uma operação normal da API. Foi demonstrado um estado financeiro que a API aceita, mas não consegue resolver posteriormente.

Os 493 testes foram executados novamente e passaram: 184 unitários e 309 com emuladores. Duas reproduções adicionais revelaram comportamentos não cobertos pela suíte:

1. A reconciliação financeira pode terminar com `complete: true` e `consistent: true`, apesar de uma inconsistência detectada anteriormente. A contagem também pode incluir um evento ausente.
2. Um pedido de R$ 200,00, com um produto e 20.000 recebimentos de R$ 0,01, falha no cancelamento financeiro. Uma devolução fisicamente recebida do mesmo pedido também falha na resolução financeira. O evento final ultrapassa 1 MiB, a transação é rejeitada e o bloqueio financeiro permanece.

Ambos precisam de correção aprovada antes da integração final dos fluxos financeiros. A segunda correção exige escolher uma política de capacidade ou um novo mecanismo estrutural. Esta auditoria não escolhe nem aplica essa mudança.

Não houve deploy, commit, push, acesso à produção, alteração de outro projeto ou correção de código. Código, configuração e contratos existentes permaneceram intactos. Este relatório é o único documento novo. Testes geraram relatórios, logs, caches e artefatos locais. Reproduções usaram dados sintéticos em emuladores isolados; os emuladores foram encerrados.

## 2. Achados por criticidade

| ID  | Criticidade                                 | Natureza                                                      | Resultado e prioridade                                                                                                        |
| --- | ------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| F02 | Bloqueante para integração financeira final | Problema comprovado                                           | Fontes financeiras sem orçamento técnico podem impedir cancelamento e resolução de devolução já recebida.                     |
| F01 | Alta                                        | Problema comprovado                                           | Reconciliação perde falhas anteriores e pode declarar integridade incorreta. Corrigir antes da integração final.              |
| F03 | Média                                       | Caminhos comprovados; impacto de abuso potencial              | JSON inválido não passa pelo limitador privado; readiness público consulta Firestore sem limite próprio.                      |
| F04 | Média                                       | Limitação de retenção comprovada                              | Contadores não têm TTL declarado; expiração textual da plataforma não serve diretamente para TTL; imagens antigas permanecem. |
| F05 | Média                                       | Limitação comprovada; capacidade potencial                    | Limites de tempo não cobrem todo o processamento; páginas com snapshots completos podem consumir muita memória.               |
| F06 | Média                                       | Runtime desatualizado comprovado; explorabilidade condicional | Node local 22.16.0 antecede correções de segurança; `npm audit` não audita o runtime.                                         |
| F07 | Baixa                                       | Divergência semântica comprovada                              | OpenAPI usa esquema de entrada também para respostas, tornando campos materializados indevidamente opcionais.                 |

“Bloqueante” em F02 refere-se à conclusão confiável do fluxo financeiro, não a uma exploração remota demonstrada. F03–F06 podem ser tratados durante a preparação de homologação, mas não devem ser ignorados antes da exposição real.

### F02. Crescimento financeiro impede concluir operações admitidas

**Localização:** `src/modules/finance/financialService.ts:480`, `:510`, `:539`, `:585`, `:622`, `:685`, `:776`, `:807`; `src/modules/finance/financialBook.ts:284`, `:303`, `:325`; `src/modules/returns/returnService.ts:236`, `:252`, `:489`, `:653`; `src/modules/orders/technicalSize.ts:31`.

**Causa:** `activeCredits()` pagina, mas acumula todas as aplicações ativas. `cashSources()` pagina, mas acumula todos os recebimentos do pedido, inclusive fontes já estornadas ou transferidas. `prepareCashTransfer()` produz uma alteração e uma referência por recebimento utilizado. Cancelamento e abatimento de devoluções colocam essas referências em um único evento financeiro. O limite por documento é verificado somente quando a operação final tenta salvar esse evento. Não há admissão que garanta a capacidade futura de cancelar ou devolver o pedido.

Paginação de leitura não limita o trabalho total, o array final, o número de documentos alterados ou o tamanho do commit. A quantidade de produtos não limita a quantidade de fragmentos financeiros.

**Reprodução executada, em etapas: documentação dos dados e limites da prova.**

1. Um ensaio de leitura com 301 pagamentos totalmente estornados manteve os 301 objetos em memória, apesar de saldo de caixa zero. Essa prova usou um leitor simulado, não produção.
2. Um evento válido pelos esquemas, com 20.000 IDs de pagamento de 64 caracteres, mediu **1.301.269 bytes** pelo estimador real. `assertDocumentFits()` retornou `413 / ORDER_TECHNICAL_LIMIT`.
3. Em um emulador vazio `demo-lastro-phase-a`, foram criados usuário, empresa, plano, cliente, produto, forma de pagamento e pedido sintéticos. O pedido tinha um produto, uma unidade e total de **20.000 centavos**. Os primeiros três recebimentos de um centavo vieram da API HTTP real.
4. Os 19.997 recebimentos restantes foram fixtures locais gravadas diretamente no emulador. Cada pagamento, evento e registro de operação foi validado pelos esquemas. A cadeia de hashes, os estados anteriores/posteriores e as projeções foram construídos de forma consistente. Não foram executadas 20.000 chamadas de recebimento nem criados todos os seus logs administrativos; essa parte não comprova o desempenho ou toda a trilha de admissão HTTP.
5. A API real de leitura financeira confirmou o estado pago: `cashSettledCents: 20000`. O cancelamento HTTP, com versões atuais e destinação de reembolso, foi executado.

Resultado do cancelamento:

```json
{
  "syntheticPayments": 20000,
  "totalCents": 20000,
  "status": 413,
  "code": "ORDER_TECHNICAL_LIMIT",
  "elapsedMs": 41918,
  "projectionsUnchanged": true,
  "samplePaymentTransferredCents": 0,
  "refunds": 0,
  "credits": 0
}
```

Pedido, estado financeiro, guarda, título e estoque permaneceram iguais. Um pagamento amostrado permaneceu sem transferência. Não foram inspecionados individualmente todos os 20.000 pagamentos após a rejeição. Nenhuma obrigação de reembolso ou crédito de destino foi criada.

Depois, o mesmo pedido foi expedido pela API real. Uma intenção de devolução foi criada e a unidade vendável foi recebida fisicamente. A resolução financeira com reembolso foi tentada:

```json
{
  "syntheticPayments": 20000,
  "returnResolutionStatus": 413,
  "returnResolutionCode": "ORDER_TECHNICAL_LIMIT",
  "elapsedMs": 41495,
  "domainUnchangedAfterFailure": true,
  "returnStatus": "received",
  "received": "1",
  "financialResolved": "0",
  "activeReturnCount": 1,
  "sellablePhysicalScaled": 1000,
  "cashSettledCents": 20000,
  "cancelPendingStatus": 409,
  "cancelPendingCode": "RETURN_NO_PENDING"
}
```

O estoque vendável aumentou corretamente na confirmação física. A falha posterior não desfez nem duplicou esse recebimento. A devolução permaneceu recebida, não resolvida financeiramente, com bloqueio ativo. Não existe saldo físico pendente para cancelar. Repetir a resolução não reduz o evento que causa `413`. Não foi identificada uma saída administrativa aprovada pela API para concluir esse caso sem mudar o modelo ou a política de capacidade.

**Impacto:** indisponibilidade financeira de um pedido válido, sem um mínimo comercial relevante. Cancelamentos, devoluções parciais/integralmente pagas, restaurações com muitas aplicações de crédito e muitos lotes compartilham o mecanismo. A prova não demonstra perda de dinheiro, mistura entre empresas ou corrupção física. Demonstra falha de completabilidade e recuperação: rollback funciona, mas a operação continua impossível.

**Alcance adicional:** fontes completamente estornadas continuam aumentando consultas e memória. Aplicações ativas e lotes também aumentam leituras e alterações. A cardinalidade crítica depende de tamanho dos IDs, alocações e outros campos; 20.000 é uma reprodução, não um limite universal seguro. Além de 1 MiB por documento, Firestore limita requisições a 10 MiB e transações a 270 segundos, com 60 segundos de inatividade. Essas últimas falhas não foram reproduzidas nesta rodada. Não foi presumido um limite genérico de 500 gravações. [Limites oficiais do Firestore](https://firebase.google.com/docs/firestore/quotas?hl=en).

**Alternativas de correção para aprovação:**

- **Admissão técnica conservadora:** antes de aceitar mais fontes, garantir que cancelamento e devolução futuros caberão nos limites de documento, commit e processamento. Rejeitar somente a operação nova, deixando o estado anterior completável. Precisa de decisão específica, pois restringe a quantidade de fragmentos financeiros. Não equivale a criar mínimo comercial ou proibir valores de um centavo.
- **Projeção de fontes ativas e provas fragmentadas:** consultar somente fontes relevantes e trocar referências ilimitadas por blocos de prova com raiz verificável. Preservar eventos, rastreabilidade e compatibilidade. Fragmentar referências, sozinho, não limita as milhares de alterações dentro da mesma transação.
- **Resolução financeira retomável:** estado durável de execução, bloqueio explícito, checkpoints idempotentes, progresso verificável e finalização. Exige desenho estrutural e aprovação financeira. Deve preservar abatimento de dívida antes de créditos e destinação de caixa. Não dividir silenciosamente uma operação hoje atômica.

Apagar histórico financeiro ou chaves de idempotência, estornar pagamentos ficticiamente ou reclassificar produto vendável como danificado não são correções aceitáveis.

**Testes necessários:** milhares de recebimentos mínimos, fontes zeradas, muitas aplicações do mesmo lote e de lotes diferentes, múltiplos títulos, limites em bytes/UTF-8, rejeição antes da admissão perigosa e devolução já recebida após falha. Se houver workflow retomável, testar reinício em cada checkpoint, concorrência, replay e perda da resposta após commit.

### F01. Reconciliação financeira esquece inconsistências anteriores

**Localização:** `src/modules/finance/financialReads.ts:382`, `:398`, `:425`, `:433`, `:447`, `:459`; `src/shared/utils/crypto.ts:39`. Lacuna atual: `tests/integration/financeReceipts.test.ts:214`.

**Causa:** o cursor assinado carrega escopo e ID do último evento, mas não o resultado acumulado. Cada página reinicializa `consistent` usando apenas o evento anterior imediato. Uma página seguinte pode voltar a `true`, mesmo depois de um erro de hash ou lacuna anterior. `checkedEvents` recebe o número de sequência, não uma contagem verificável de eventos examinados.

**Reprodução HTTP real com Firebase Emulator:** pedido sintético com três recebimentos reais de um centavo e `limit=1`. O primeiro evento foi alterado diretamente no emulador, de valor 1 para 2, preservando seu hash antigo. As páginas retornaram:

| Página | `consistent` | `complete` | `checkedEvents` |
| ------ | ------------ | ---------- | --------------- |
| 1      | false        | false      | 1               |
| 2      | false        | false      | 2               |
| 3      | true         | true       | 3               |

Depois, somente o primeiro evento sintético foi removido do emulador. Seguir todos os novos cursores produziu:

| Página | `consistent` | `complete` | `checkedEvents` |
| ------ | ------------ | ---------- | --------------- |
| 1      | false        | false      | 2               |
| 2      | true         | true       | 3               |

Foram lidos dois eventos existentes, mas a resposta final declarou três. A projeção financeira permaneceu com caixa de três centavos e dívida de 19.997 centavos. A consulta não alterou o domínio. O evento removido foi reconstruído antes da reprodução de F02, com o hash conferido contra o evento seguinte.

**Pré-condição:** alteração, perda ou recuperação incorreta do ledger por operador/IAM, falha externa ou restauração. A API normal não permite editar ou excluir esses eventos. Portanto, não se trata de uma exploração pública de escrita no ledger.

**Impacto:** o consumidor que toma a página final como veredito global recebe uma confirmação falsa de integridade. O endpoint de reconciliação falha justamente quando precisa detectar corrupção histórica. Agregar `false` no frontend pode mitigar o caso, mas não corrige a contagem nem fornece uma prova cumulativa do backend.

**Alcance e cobertura:** o teste atual verifica uma cadeia saudável de duas páginas. Depois altera o primeiro evento e verifica apenas a primeira resposta inconsistente. Não segue até uma página final saudável, nem cobre um evento desaparecido. Reconciliação de estoque já possui checkpoint assinado com estado acumulado: `src/modules/inventory/inventoryService.ts:397` e `reconciliationCursor.ts` oferecem um padrão local útil.

**Correção recomendada:** cursor financeiro versionado com checkpoint limitado e assinado, contendo consistência acumulada, quantidade realmente verificada, sequência, posição, hash e prova suficiente do estado anterior. Vincular a usuário, empresa, pedido, filtros e cabeça atual. Preservar ou versionar a interpretação da resposta. Reiniciar com conflito quando a cabeça mudar. Tratar os cursores anteriores explicitamente.

Alternativas: reler toda a cadeia até o cursor em cada página, com custo crescente; ou declarar o resultado como estritamente local à página e obrigar agregação do cliente. A segunda opção muda a semântica e não entrega a reconciliação cumulativa esperada.

**Testes necessários:** falhas na primeira, intermediária e última página; ausência e duplicidade; três ou mais páginas; diferentes limites; contagem efetiva; alteração da cabeça; cursor falsificado e tentativa entre empresas.

### F03. Caminhos HTTP contornam limitação privada ou geram leitura pública

**Localização:** `src/app/app.ts:116`, `:118`, `:141`; `src/middlewares/rateLimit.ts:29`, `:54`, `:89`.

**Reprodução executada:** aplicação Express real, Firestore substituído por contador local de chamadas. Com `rateLimitMax=1`, três POSTs privados com JSON inválido responderam `[400,400,400]`; três acessos a readiness responderam `[200,200,200]` e fizeram três leituras. Requisições privadas normais responderam `[401,429]`.

**Causa:** `express.json()` vem antes do limitador privado. O erro de parsing encerra esse caminho antes da contagem. `/health/ready` consulta um documento do Firestore sem autenticação, cache ou limitador próprio. O catálogo público possui proteção barata anterior ao parser e não apresentou esse mesmo desvio.

**Impacto:** abuso potencial de CPU por JSON inválido e amplificação de leituras cobradas por readiness, se esse caminho ficar aberto na implantação. Não foram feitos teste de carga nem medição de custo real. Os limitadores privados em produção ainda atualizam seus contadores quando a requisição já excedeu a cota. O limitador público compartilhado por slug também pode criar contenção ou esgotamento de orçamento por terceiros.

**Correção recomendada:** limitação barata anterior ao parsing privado; readiness restrito a probes/ingress adequado ou verificação com cache curto e orçamento explícito. Não adicionar autenticação incompatível com os probes. Testar JSON inválido, corpo excedente, indisponibilidade do banco e comportamento depois de `429`. Homologar chaves de IP e proxies, inclusive IPv6.

### F04. Retenção e limpeza ainda não formam um sistema operacional completo

**Localização:** `src/middlewares/rateLimit.ts:32`, `:59`, `:109`; `firestore.indexes.json`; `src/modules/platformAdmin/platformService.ts:88`, `:222`, `:426`; `src/shared/schemas/models.ts:104`; `src/modules/products/imageService.ts:80`, `:88`, `:125`.

**Reprodução por configuração e código:** existem 126 índices compostos e 61 configurações de campos, mas nenhuma declaração `ttl`. Contadores têm `expiresAt` do tipo Timestamp. Registros idempotentes da plataforma têm `expiresAt` textual ISO. Substituição ou remoção da associação de imagem não remove o objeto antigo. A limpeza do upload falho é uma tentativa que pode falhar sem recuperação posterior.

**Impacto:** crescimento contínuo de contadores temporários e objetos não referenciados. Expiração lógica textual não faz exclusão física. Habilitar TTL diretamente no campo textual da plataforma não resolve sua retenção: TTL exige data/hora. Auditoria e idempotência financeira, por outro lado, não devem ser excluídas indiscriminadamente. [Requisitos oficiais de TTL](https://firebase.google.com/docs/firestore/ttl).

**Correção recomendada:** política aprovada por coleção; TTL de Timestamp somente onde seguro; campo apropriado e migração explícita para registros temporários textuais; limpeza de objetos após verificar referências atuais. Medir armazenamento e custo. Preservar ledger, provas, obrigações e replay financeiro. Tratar como pendência de implantação, não como autorização para apagar dados.

### F05. Orçamentos de processamento e memória incompletos

**Localização:** `src/app/server.ts:11`; `src/modules/documents/documentService.ts:24`, `:70`; `src/modules/documents/pdfRenderer.ts:86`; `src/modules/documents/exportService.ts:13`, `:34`; `src/modules/orders/orderService.ts:690`; `src/modules/finance/financialReads.ts:217`.

**Evidência:** `server.requestTimeout=30000` limita o recebimento da requisição, não toda a execução do handler. O PDF possui limite de renderização, mas lê e revalida fontes antes/depois desse trecho. A exportação verifica tempo cooperativamente e não cancela uma chamada SDK já em andamento. Páginas de pedidos podem materializar até 100 snapshots completos; consultas de títulos também carregam ordens de origem. Uma ordem próxima de 1 MiB multiplicada por 100 já exige orçamento considerável por requisição. Esse cálculo é risco, não uma medição de RSS. [Semântica de requestTimeout no Node](https://nodejs.org/api/http.html#serverrequesttimeout).

PDFs e exportações já têm limite de duas execuções por serviço/instância. Isso é positivo, mas não limita todo o tráfego nem o custo das consultas anteriores. F02 levou aproximadamente 42 segundos no app HTTP de teste; esse ensaio não usou o servidor configurado e não prova um timeout específico do Cloud Run.

**Correção recomendada:** orçamento explícito de processamento e concorrência por operação; medir memória, latência, leituras e tamanho real de commit no artefato Linux. Reduzir materialização desnecessária sem implementar a proposta de snapshots grandes nesta fase. Qualquer timeout financeiro deve distinguir operação não aplicada de resposta perdida após commit e preservar replay.

**Validação pendente:** carga sustentada, p95/p99, páginas grandes simultâneas, consultas lentas, cancelamento de downloads, pressão de imagens e encerramento do processo durante operações.

### F06. Runtime Node local anterior a correções de segurança

**Localização:** `package.json:7`; runtime efetivamente usado: Node `v22.16.0`, OpenSSL `3.0.16`, Windows x64.

**Evidência:** `engines: >=22 <25` aceita versões antigas da linha 22 e a linha 23 sem suporte atual. O runtime instalado é anterior às correções de segurança publicadas para 22.23.2 em julho de 2026. As duas consultas autorizadas ao npm retornaram zero vulnerabilidades, mas esse resultado não cobre Node ou OpenSSL. [Publicação oficial de segurança](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases).

**Impacto potencial, não exploração demonstrada:** parte dos avisos envolve HTTP/2, Permission Model e condições de agentes HTTPS. O servidor inspecionado usa HTTP/1, não usa Permission Model e não aceita URLs arbitrárias para buscar imagens. Não foi demonstrada alcançabilidade de todos os avisos neste aplicativo.

**Correção recomendada:** fixar uma versão LTS suportada e corrigida no artefato de homologação/produção. Reexecutar suíte, validar Sharp e fontes no sistema real e registrar runtime/SBOM. Nenhuma atualização foi feita nesta auditoria.

### F07. Respostas OpenAPI descritas como entradas

**Localização:** `src/modules/auth/openapi.ts:4`, `:72`; `src/shared/schemas/paymentSettings.ts`; `docs/api/openapi.json`; `docs/api/generated-types.ts`.

**Reprodução em memória:** o gerador usa `io: 'input'` para toda conversão, inclusive respostas. Na resposta de opções de pagamento, `items[].schedule[].weight` possui default 1, mas não entra em `required`. O backend materializa `weight` no parsing de saída; o tipo publicado o declara opcional.

**Impacto:** contrato mais fraco que a resposta real, aumentando tratamento desnecessário e dúvida no frontend. Não foi encontrada divergência de versão, endpoint ausente ou arquivo gerado desatualizado. É uma divergência de semântica, não de sincronização.

**Correção recomendada:** diferenciar esquemas de entrada e saída no gerador; revisar defaults e transforms; testar respostas reais contra a interpretação de saída. Validar a regeneração antes de publicar novos tipos. Pode aguardar a revisão contratual, sem impedir telas básicas.

## 3. Arquitetura, invariantes e módulos restantes

O exame incluiu handlers, serviços, esquemas, repositórios, configuração, índices, regras, testes e contratos. A documentação orientou o escopo, mas não substituiu a leitura de código. Não foi feita análise formal nem afirmada prova exaustiva de todas as combinações.

| Área                         | Evidência positiva encontrada                                                                                                                                               | Limite da conclusão                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A: acesso e plataforma       | Autenticação Firebase; vínculo atual e empresa ativa; superadmin sem acesso comercial implícito; reautenticação em operações sensíveis.                                     | Emulador não prova verificação criptográfica produtiva, IAM, MFA ou configuração externa.           |
| B: cadastros e imagens       | Esquemas estritos; permissões; versões; isolamento por empresa; normalização de imagens, sem fetch de URL fornecida.                                                        | Retenção de imagens e orçamento de processamento permanecem pendentes.                              |
| C: estoque                   | Quantidades escaladas; reservas transacionais; ledger/projeções e reconciliação cumulativa; controles de replay.                                                            | Carga real, contenção e limites do serviço não foram certificados.                                  |
| D: pedidos                   | Valores inteiros; snapshots e baselines; reservas e transições preparadas na mesma transação; casos de 1–200 produtos.                                                      | Cardinalidade de produtos não limita cardinalidade financeira futura.                               |
| E: financeiro e devoluções   | Guardas/versionamento; alocação explícita; estornos/créditos rastreáveis; recebimento físico separado; danificados sem aumento de estoque vendável; aceite administrativo.  | F01/F02 invalidam a conclusão de completude integral.                                               |
| F: catálogo e orçamentos     | Projeção pública explícita; limitação anterior ao parser público; cursor assinado; preços ocultos respeitados; sem exposição normal de clientes, estoque ou dados internos. | Resistência a abuso distribuído, contenção por slug e custo precisam de homologação.                |
| G: PDFs, CSV e administração | Acesso atual; revalidação após geração; downloads privados/no-store; CSV paginado e protegido contra fórmulas; fontes empacotáveis.                                         | Artefato Linux, assets, concorrência e orçamento de I/O não foram validados em infraestrutura real. |

Não identifiquei bypass rotineiro comprovado entre empresas ou permissão financeira de vendedor nos caminhos examinados. Regras Firestore e Storage negam acesso direto do cliente. O Admin SDK usa IAM e não fica protegido por essas regras; a garantia depende dos checks nos serviços e da identidade do processo.

Os módulos preservam as dependências esperadas: pedidos dependem de estoque/cadastros/condições, financeiro verifica baselines do pedido, devoluções coordenam físico e financeiro, documentos reutilizam fontes autorizadas. Provas e preparação anteriores às gravações reduzem aplicação parcial. O crescimento ilimitado de fontes em F02 é a exceção importante à capacidade de concluir essa coordenação.

## 4. Verificações executadas e cobertura real

| Verificação local         | Resultado nesta rodada                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                | `npm run typecheck`: aprovado.                                                                                                   |
| Lint                      | `npm run lint`: aprovado.                                                                                                        |
| Formatação                | `npm run format:check`: aprovado, incluindo este relatório.                                                                      |
| Configuração de build     | `tsc -p tsconfig.build.json --noEmit`: aprovado. Não foi gerado um novo artefato `dist`.                                         |
| Unitários                 | **184 aprovados**, 11 arquivos, zero falhas; 9,28 s.                                                                             |
| Firebase Emulators        | **309 aprovados**, 23 arquivos, zero falhas ou pendências; 929,54 s.                                                             |
| Total da suíte            | **493 aprovados**. Probes adicionais não entram nessa contagem.                                                                  |
| npm audit runtime         | `npm audit --omit=dev`: zero vulnerabilidades relatadas.                                                                         |
| npm audit completo        | `npm audit`: zero vulnerabilidades relatadas.                                                                                    |
| Scanner local de segredos | Zero achados nos quatro padrões configurados; não é scanner abrangente.                                                          |
| OpenAPI                   | Gerador em memória idêntico ao JSON salvo; versão 0.7.0; 106 operações únicas.                                                   |
| Rotas versus contrato     | 106 handlers correspondentes; nenhuma operação ausente ou extra. Sete operações públicas, 99 privadas e seis downloads binários. |
| Tipos gerados             | Regeneração em memória idêntica ao arquivo TypeScript salvo.                                                                     |
| Encerramento              | Nenhum listener dos emuladores nos ports 9099, 8080, 9199, 4400, 4500 e 9150 ao final.                                           |

A primeira tentativa unitária falhou por diretório temporário indisponível no sandbox. Foi resolvida usando `TEMP/TMP` local. A primeira inicialização dos emuladores falhou antes dos testes por timeout da porta do hub no sandbox. A execução local autorizada seguinte completou a suíte. Não foram removidos testes, relaxadas asserções ou reduzida cobertura.

O relatório bruto da suíte com emuladores está em `reports/emulator-tests.raw.json`. Foi conferido independentemente: 309 passaram, zero falhas, zero pendências, 23 arquivos, resultado global positivo. Nenhum relatório de teste existente foi tomado como substituto dessa execução.

**O que os 493 testes sustentam:** regressões locais de autenticação/permissão, isolamento, CRUD, estoque, reservas, transições de pedido, condições e parcelas, pagamentos parciais, alocações, excedentes rejeitados, estornos, créditos, cancelamentos, obrigações manuais, devoluções parciais/danificadas, catálogo, documentos e exportações. Existem cenários de concorrência/replay e alterações recusadas por versão.

**O que não sustentam:** propagação de inconsistência por três ou mais páginas; milhares de fragmentos financeiros; retomada de uma operação deterministicamente grande; assinatura Firebase em produção; índices implantados; IAM; custo; resistência a carga distribuída; SLO de 100 usuários; artefato de produção completo. Testes de recuperação não equivalem a matar o processo em todos os checkpoints ou perder respostas reais de rede após commit.

Os emuladores não impõem todos os limites nem exigem os índices compostos como produção. Seus comportamentos transacionais também diferem. Por isso, aprovação local não prova que uma transação grande caberá, nem que uma consulta funcionará no ambiente real. [Diferenças oficiais do emulador Firestore](https://firebase.google.com/docs/emulator-suite/connect_firestore).

**Resultados locais de capacidade e concorrência relevantes:**

- Pedido de 200 produtos: snapshot estimado de 494.558 bytes e registro de operação de 494.867 bytes. Os números de 617 gravações e 824 leituras são fórmulas lógicas dos helpers, não rastreamento de faturamento ou medição protobuf.
- Corrida de pedido de 200 produtos: respostas `[200,409]`; replay concorrente: `[200,200]`. Tempos locais aproximados: 5,85 s e 16,74 s.
- Cancelamento com 200 produtos: cerca de 1,02 s. Devolução física: 2,53 s; resolução: 2,38 s. Esses testes usam histórico financeiro pequeno.
- PDFs de 200 produtos: comercial com 30 páginas/88.827 bytes; romaneio com 21 páginas/73.951 bytes. A suíte inspeciona os PDFs gerados; não foi feita uma nova inspeção visual manual nesta auditoria.
- Probes F02: rejeição de cancelamento e resolução sem alteração parcial das projeções examinadas. Recuperação por retry não funciona, pois o tamanho não muda. Esse é o limite da garantia atual de recuperação.

O scanner de segredos ignora `.env`, `.local`, dependências, builds, caches e relatórios e procura somente padrões específicos. Zero achados não certifica ausência de segredos nesses locais, no histórico ou na configuração produtiva. As consultas ao registry enviaram somente inventário de dependências necessário ao npm audit, sem código-fonte, segredos ou arquivos privados.

## 5. Estabilidade do contrato da API

O contrato estrutural 0.7.0 está sincronizado com código e tipos. Não houve mudança de endpoint nesta rodada. O envelope de sucesso, erros seguros, cabeçalhos de empresa, versões, idempotência, paginação e downloads têm base consistente para integração.

As ressalvas reais são F01, que altera o significado do resultado financeiro, F02, que permite falha terminal de um fluxo admitido, e F07, que enfraquece campos de saída. Paridade textual do gerador não detecta esses problemas semânticos.

Correções aprovadas precisam declarar compatibilidade de cursores, campos e erros. Uma política de admissão financeira deve publicar limites e código estável. Um workflow retomável deve publicar estados, bloqueios, consulta de progresso e replay. Não atribuir ao frontend o dever de consertar uma cadeia financeira ou descobrir sozinho que um fluxo nunca poderá concluir.

## 6. Correções antes do frontend e pendências de homologação

**Antes de aprovar a integração financeira final:**

1. Corrigir e testar a reconciliação cumulativa, incluindo contagem e eventos ausentes.
2. Aprovar e executar uma solução de completabilidade para fontes financeiras, cobrindo pedido já existente e devolução fisicamente recebida.
3. Publicar os impactos contratuais dessas duas correções, com testes e tipos atualizados.

**Podem avançar junto à homologação:** F03, F04, F05, F06 e F07, com responsáveis e aceite explícitos. F03–F06 precisam ser resolvidos ou controlados antes da exposição pública real; “podem aguardar” não significa dispensados.

Não há aprovação implícita para nova restrição financeira, migração de ledger ou substituição da atomicidade atual. As decisões comerciais já aprovadas não precisam ser refeitas. As alternativas estruturais novas de F02 precisam de aprovação específica após este relatório.

## 7. Riscos da implantação real

- **Artefato:** `tsc` não copia `assets/fonts`. `pdfRenderer.ts:23` lê fonte no carregamento do módulo. Empacotar somente `dist` pode falhar com `ENOENT` no startup inteiro. O README já exige assets e licença; validar essa exigência no artefato Linux, inclusive Sharp. Não foi produzido/deployado esse artefato nesta rodada.
- **TLS/proxy:** `trustProxyHops` precisa corresponder ao ingress real. Cloud Run termina TLS antes do processo; a aplicação exige HTTPS nos caminhos normais. Configuração errada pode rejeitar tráfego legítimo ou confiar em headers forjados. Validar CORS, IP, protocolo e paths de proxy; não habilitar confiança irrestrita. [Express e proxies](https://expressjs.com/en/guide/behind-proxies/), [Contrato Cloud Run](https://docs.cloud.google.com/run/docs/container-contract).
- **IAM e identidade:** separar contas por ambiente, negar acesso desnecessário, controlar Admin SDK/Storage, usar Secret Manager e verificar MFA/reauth da plataforma. A configuração de infraestrutura ainda não foi auditada porque produção não foi acessada.
- **Firestore:** verificar implantação e cobertura dos 126 índices/61 configurações, TTL autorizado, tamanho de commits, custo por fluxo e contenção. Não usar emulador como certificação desses itens.
- **Operação financeira:** testar respostas perdidas após commit, SDK lento, retries e SIGTERM. Cloud Run concede janela limitada ao desligamento; transações e clientes precisam recuperar pelo estado persistido, não por suposição sobre a resposta HTTP.
- **Dados e auditoria:** definir backup/restauração, retenção, responsabilidade por reembolsos manuais e detecção de ledger alterado. Hashes locais não protegem contra um administrador que reescreva toda a cadeia e a cabeça; a ameaça de operador requer IAM, logs externos e política de auditoria adequados.
- **Capacidade/custo:** decidir concorrência e máximo de instâncias; medir páginas grandes, PDFs, exportações, processamento de imagens, limitadores e readiness. Nenhuma capacidade produtiva, custo mensal ou disponibilidade foi certificada.

## 8. Checklist para integração com Claude

- [ ] Resolver F01/F02 e congelar a versão contratual resultante antes do aceite financeiro final.
- [ ] Usar `docs/api/openapi.json`, `generated-types.ts` e `frontend-contract.md` como conjunto; não inferir permissões a partir de telas.
- [ ] Autenticar com Firebase ID token; enviar `X-Tenant-Id` somente como empresa candidata. Tratar vínculo revogado/empresa suspensa e limpar estado no logout/troca de empresa.
- [ ] Separar áreas de vendedor, administrador da empresa e plataforma. Tratar reautenticação sensível recente; reauth não substitui MFA.
- [ ] Guardar centavos inteiros e quantidades no formato contratual. Não recalcular parcelas, feriados, reservas, disponibilidade ou abatimentos no cliente.
- [ ] Manter a mesma `Idempotency-Key` para a mesma intenção retomada. Nova chave somente para nova intenção. Após resposta perdida, recuperar por replay/leitura; não concluir que o dinheiro não foi aplicado.
- [ ] Enviar versões esperadas. Em `409`, recarregar o estado e obter nova decisão do operador. Não redistribuir pagamentos entre pedidos automaticamente.
- [ ] Seguir `nextCursor` mesmo quando filtros derivados produzem uma página vazia. Repetir filtros e limite; tratar cursor invalidado. Após corrigir F01, consumir o veredito cumulativo documentado.
- [ ] Representar intenção, pendência física, quantidade recebida vendável/danificada, aceite administrativo, resolução parcial e bloqueio financeiro separadamente. Não apresentar criação de obrigação como transferência bancária concluída.
- [ ] Para downloads, verificar status e MIME antes de interpretar bytes. Tratar JSON de erro, `409`, `413`, `429`, CSV com BOM/campos multilinha e cabeçalhos de próxima página.
- [ ] Validar Blob/download no React Native Web e arquivo temporário/compartilhamento no Expo. Não persistir PDFs privados em cache público; limpar arquivos e estado de sessão conforme política.
- [ ] Configurar API base por ambiente/dispositivo. `localhost` no celular não é o computador. Validar HTTPS e origens CORS exatas, sem curingas credenciados.
- [ ] Não repetir cegamente POSTs que o contrato declara não idempotentes. Para esses caminhos, conferir estado antes de nova criação.
- [ ] Exercitar 1, 20, 50, 100 e 200 produtos; múltiplas páginas; falhas de rede; troca de empresa; ausência de permissão; produtos danificados e histórico fragmentado.

## 9. Evidências, arquivos e próximo passo

Arquivos-fonte e linhas acima são relativos à raiz deste backend. Evidências locais adicionais foram executadas de forma temporária, sem adicionar testes ou scripts ao código versionável. As reproduções completas e suas limitações ficam registradas neste documento; os dados sintéticos não são dados comerciais e não devem orientar números de capacidade produtiva.

Documento criado: `docs/audits/backend-a-g-2026-10-09.md`. Documentos de entrega/validação das fases e contratos existentes não foram reescritos para esconder ou corrigir os achados. O relatório desta auditoria complementa os 493 resultados, sem convertê-los em uma certificação de produção.

**Próximo passo:** aprovar a correção de F01 e escolher a alternativa de F02, incluindo tratamento dos estados existentes e impactos do contrato. Depois executar correções em rodada separada, preservar cobertura e repetir a suíte completa e as reproduções adversariais antes do aceite financeiro.
