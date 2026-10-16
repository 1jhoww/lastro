# Fase 1 — Reformulação do Financeiro (UX, navegação e integração)

Reformulação da experiência do módulo Financeiro do frontend, preservando contratos, regras de
negócio e garantias do backend (idempotência, versões, reautenticação, autorização, auditoria e
publicação econômica). Somente o frontend foi alterado. Nada foi commitado, enviado ou implantado.

## 1. Problemas identificados

- **Navegação plana:** seis botões grandes de mesmo peso (Contas a receber, Créditos, Obrigações
  de reembolso, Execuções, Resoluções de devoluções, Condições e formas) em toda tela.
- **Sem visão gerencial:** `/financeiro` era só a lista de títulos; nenhum indicador de em aberto,
  vencido ou recebido.
- **Recebimento técnico:** formulário sempre aberto na página, data em `AAAA-MM-DD` digitada à mão,
  forma em lista suspensa, botões "Receber saldo total" e "Usar data de hoje", motivo obrigatório
  visível e revisão com texto técnico.
- **Datas americanas/técnicas** em filtros, revisão de recebimento, comprovantes de reembolso e
  históricos (`2026-10-13`, instantes ISO crus em execuções e devoluções).
- **IDs técnicos expostos como conteúdo:** filtro "Pedido (ID)", origens como `l1 · disponível`,
  alocações `r1: R$ … remanescente`, pedidos como UUID.
- **Condições confusas:** "Modelo de prazos" começava em **À vista** mesmo quando o nome dizia
  "28 dias"; pesos sem explicação; nenhuma prévia; confirmação com "Prazos: cash" e aviso de
  registro "auditado que não pode ser apagado". Na homologação, os logs do Cloud Run (leitura) mostram
  `POST /payment-methods` 201, mas **nenhum `POST /payment-conditions`**: as condições nunca chegaram
  ao servidor, por isso o editor de pedidos não as oferecia.
- **Operações excepcionais como rotina:** estorno, crédito, reembolso, cancelamento financeiro,
  execução e reconciliação no mesmo nível, com termos como fence, lease, journal, provas.
- **Mobile:** botões em largura total empilhados, cartões altos, tabelas de alocação ilegíveis.

## 2. O que mudou

### 1.1 Painel e navegação

- `/financeiro` agora é **Visão geral**: faixa de indicadores (Total a receber, Vencido, Vence em
  7 dias, Recebido no mês), **Próximos vencimentos** (vencidos primeiro, com cliente, pedido,
  parcela, vencimento DD/MM/AAAA, prazo relativo, situação e valor pendente), **Recebimentos
  recentes** e **Precisa de atenção** (reembolsos a registrar e operações em andamento).
- Indicadores **sem agregados inventados**: a API não tem endpoint agregado; a tela lê todas as
  páginas de títulos e de recebimentos até 10 × 100. Só exibe um indicador quando a leitura cobre
  todo o seu escopo. Como `/receivables` vem ordenado por vencimento, "Vencido" e "Vence em 7 dias"
  continuam corretos mesmo com leitura incompleta, desde que ela tenha passado da data limite;
  "Total a receber" e "Recebido no mês" exigem leitura completa. Caso contrário aparece "—" com
  "Mais de 1000 registros: requer total do servidor". O escopo e o horário da soma ficam visíveis.
- **Navegação em abas**: Visão geral · Contas a receber · Condições e formas (destaque) | Créditos ·
  Reembolsos · Histórico e operações (secundárias). `/financeiro/operacoes` reúne o que não é
  rotina: Complementares (créditos, reembolsos, devoluções) e Avançado (operações em andamento,
  verificação de integridade, resoluções excepcionais), com explicações curtas.
- Links antigos `/financeiro?pedido=…` redirecionam para `/financeiro/receber?pedido=…`.
- Início: painel "Operações financeiras em andamento" compacto com situação amigável.

### 1.2 Contas a receber e registro de pagamentos

- `/financeiro/receber`: filtros compactos (A receber · Vencidos · Quitados · Todos), cliente por
  nome (busca da API por início do nome, inclui desativados), período com calendário e filtro por
  pedido via link contextual (sem digitar ID). Tabela no desktop (cliente + código do pedido,
  parcela, vencimento + prazo, situação, valor, recebido, saldo); cartões compactos no celular.
  "Vencidos" usa `to=ontem` no servidor e confere saldo positivo na tela. Filtros locais carregam
  páginas seguintes automaticamente (até 10) para não mostrar páginas vazias com continuação.
- Situação de cobrança derivada do título oficial: **Vencido / Vence hoje / A vencer / Quitado /
  Cancelado**, com marcador **Parcial**.
- Título (`/financeiro/[id]`): saldo em destaque, vencimento e prazo relativo, valor/recebido/
  crédito/cancelado, parcelas do pedido, pagamentos (forma, data, parcela, referência, estorno),
  histórico completo recolhível e detalhes técnicos recolhidos. Ação principal **Registrar
  pagamento**; crédito e estorno em "Outras ações".
- **Registrar pagamento** em diálogo (folha inferior no celular): valor sugerido = saldo, aceita
  parcial (mostra quanto restará), bloqueia acima do saldo, forma em botões com ícone (somente
  formas ativas; uma única forma já vem escolhida; a forma prevista no pedido vem sugerida), data
  com calendário (padrão hoje no fuso da empresa, sem datas futuras), referência e observação em
  "Mais detalhes". Revisão mostra valor, cliente, parcela, forma, data e "Parcela quitada" ou
  "Restam R$ X em aberto". Sem formas ativas: aviso com link para cadastrar (se houver permissão).
- "Receber saldo total" e "Usar data de hoje" foram removidos: o valor já vem com o saldo e a data
  com hoje.
- **Observação obrigatória do contrato:** `reason` (3–500) é exigido pelo backend em recebimentos.
  A tela preenche uma descrição factual do próprio registro ("Pagamento da 1ª parcela"), editável.
  Não é dado de auditoria inventado. Recomendação de contrato: tornar `reason` opcional em
  recebimentos.
- Feedback só após resposta confirmada; resultado incerto fecha o diálogo e mostra
  "Resultado não confirmado" com **Verificar e repetir com segurança** (mesma chave e corpo).
  Conflito de versão orienta voltar e conferir o saldo atualizado. Todos os caches financeiros e
  de pedidos são invalidados após o comando (comportamento existente preservado).

### 1.3 Condições e formas de pagamento

- Abas **Condições de pagamento** / **Formas de pagamento**, filtro Disponíveis/Inativas/Todas,
  botões compactos **Nova condição** / **Nova forma**, linhas com resumo legível
  ("3 parcelas · 30, 60 e 90 dias", "Partes iguais" ou "25% · 75%") e situação.
- Nova condição em diálogo: nome; prazos em botões (À vista, 30 dias, 30 e 60, 30, 60 e 90,
  Personalizada) **sem valor padrão** (corrige a armadilha "À vista" escondida); personalizada com
  dias após a confirmação e, opcionalmente, partes do valor com percentual; até 12 parcelas; prévia
  ilustrativa para R$ 1.000,00 confirmado hoje com vencimentos e valores pela **mesma regra de maior
  resto do servidor** (20.000 casos aleatórios sem divergência contra `weightedAmounts`), em dias
  corridos, sem ajuste de fim de semana/feriado. Envio direto, sem confirmação assustadora.
- Nova forma: tipo com ícone (Pix, Dinheiro, Transferência, Cartão, Boleto, Outra), nome sugerido
  pelo tipo, validação local de nome repetido (mesma normalização do backend) e recusa oficial
  `DUPLICATE_PAYMENT_SETTING` tratada. Ativar/desativar por chave "Disponível…" na edição.
- Cadastro com resposta perdida mantém chave e corpo: "Verificar e repetir com segurança".
- **Integração com pedidos:** o editor de pedidos usa `GET /orders/payment-options/conditions`
  (somente ativas) e já invalidava o cache após cadastros. Localmente as condições aparecem para
  administrador e vendedor (verificado no navegador e no E2E). Os índices compostos `status +
nameKey` estão `READY` em `lastro-hml` (consulta somente leitura). A causa na homologação era a
  condição não ser criada; corrigida no cadastro. Ajustes restantes na tela de Pedidos ficaram para a
  Fase 2 (seção 9).

### 1.4 Créditos, estornos, reembolsos e operações avançadas

- **Créditos:** escolha do cliente, crédito disponível total só com todas as origens carregadas,
  origens (cancelamento/devolução, pedido, data, valor original, usado, disponível, situação),
  parcelas em aberto do cliente com acesso a "Usar crédito", histórico de uso. Nunca automático.
- **Financeiro do pedido** (`/financeiro/pedidos/[id]`): parcelas e totais, pagamentos, reembolsos,
  créditos usados e créditos do cliente; "Outras ações" com Usar crédito do cliente, Estornar
  pagamento, Estornar uso de crédito e Registrar reembolso já feito (cada uma indica quando está
  indisponível e por quê). Formulário de uma operação por vez com origem/parcela únicas já
  escolhidas, valor sugerido no limite permitido e confirmação com consequência ("Saldo da parcela
  depois", "Crédito restante do cliente", "Restam R$ X a devolver", "O pagamento fica marcado como
  estornado no histórico"). Estorno e reembolso continuam exigindo senha recente.
- **Reembolsos:** "A devolver" × "Devolvido em parte" × "Devolução registrada", cliente, origem,
  pedido, data, valores, orientação de que obrigação não é dinheiro devolvido. Registro manual com
  forma em botões, data com calendário, comprovante e confirmação explícita de devolução externa.
- **Operações em andamento** (execuções): linguagem "Aguardando continuidade", "Necessita atenção",
  "Aguardando confirmação", "Interrompida sem efeito" e "Concluída" (esta **somente** com
  `financialCompleted`, `status=COMPLETED`, `publishedAt` e `result`). Continuar segue explícito e
  revisado; retomar/interromper ficam recolhidos (abrem sozinhos em PAUSED/NEEDS_REVIEW ou com passo
  incerto); estado técnico, revisão, fence, lease e contadores em "Detalhes técnicos".
- **Verificação técnica** (reconciliação): "Registros financeiros do pedido" e "Provas da operação em
  etapas" como escopos distintos, "Divergência encontrada" acumulada, "Nenhuma divergência" só com
  `complete=true` e consistente.
- **Devoluções:** situações "Aguardando recebimento físico", "Resolução financeira pendente",
  "Recebida em parte", "Resolução concluída"; itens com recebido, avaria e acertado; acerto com
  textos claros e destino "Virar crédito do cliente" ou "Reembolsar o cliente". Fluxo físico não foi
  alterado.

## 3. Arquivos

Novos: `src/lib/calendar.ts`, `src/ui/{DateField,Disclosure,ChoiceChips}.tsx`,
`src/features/finance/{FinanceOverviewScreen,OperationsScreen,FinanceParts}.tsx`,
`src/features/finance/{overview,presentation,schedulePreview,receiptNote}.ts`,
`src/app/(app)/financeiro/{receber,operacoes}.tsx`, `scripts/e2e-finance-phase1.ts`,
`tests/unit/financePhase1{Rules,Screens}.test.ts(x)`, `docs/evidence/finance-phase1-e2e.json`.

Alterados: `src/features/finance/{FinanceNav,ReceivablesScreen,ReceivableScreen,ReceiptForm,
SettingsScreen,CreditsScreen,RefundsScreen,EconomicForm,CommandConfirmation,
OrderAdministrationScreen,ExecutionsScreen,ExecutionScreen,ReturnsScreen,ResolutionForm,
ResolutionConfirmation,ReconciliationPanel,FinancialRecovery,FinanceGlance}.tsx`,
`src/features/finance/{api,commands,resolutionCommands,resolutionRules}.ts` (rótulos e hook do
painel), `src/app/(app)/financeiro/index.tsx`, `src/api/errors.ts` (mensagens), `src/ui/{index,
icons}.ts`, `src/features/orders/CustomerPicker.tsx` (prop opcional `includeInactive`, padrão
inalterado), `tests/unit/finance{,B,C}Screens.test.tsx` (seletores das novas telas, mesmas
garantias).

## 4. Reaproveitado sem mudança de regra

`intent.ts` (ledger durável, prepare/finish, chave por intenção), `sendReceipt`,
`sendFinanceCommand`, `resolutionCommands`, `toReceiptBody`, `buildEconomicCommand`,
`ReauthGate`, `FinanceAccess`/`canManageFinance`, `FinancialRecovery`, `useCursorList`,
`useMethodOptions`, `CustomerPicker`, `DataTable`, `Dialog`, `CurrencyInput`, `ListPanel`,
`ResolutionForm` (lógica), `DiscountPanel`.

## 5. Integrações corrigidas

- Cadastro de condições: prazo sem padrão escondido, envio direto e prévia; a condição passa a
  existir no servidor e aparece no editor de pedidos (E2E: admin e vendedor).
- Forma prevista no pedido sugere a forma efetiva no recebimento, sem confundi-las.
- Links contextuais título ↔ pedido ↔ financeiro do pedido ↔ créditos/reembolsos/operações.

## 6. Limitações do backend (documentadas, sem alteração)

- **Sem agregados financeiros** (total em aberto, vencido, recebido por período). Necessário
  endpoint agregado por empresa para escalar além de 1.000 títulos/recebimentos.
- `/receivables` filtra `status` e `customerId` **depois** da paginação (páginas vazias com
  continuação). `/payments` ordena por ID e não filtra por data.
- `reason` obrigatório em recebimento; `reference` obrigatório em reembolso manual.
- Excesso de pagamento responde **409 `EXCESS_PAYMENT`**.
- Obrigação de reembolso e lote de crédito não trazem nome do cliente (uma leitura por cliente).
- Devolução não expõe diretamente se o acerto virou crédito ou reembolso (ver pedido).
- Busca de cliente só por início do nome.

## 7. Testes

- Baseline antes de alterar: **37 suítes, 524/524**.
- Final: **39 suítes, 550/550** (14 regras novas, 8 telas novas; 3 suítes antigas adaptadas aos
  novos seletores mantendo as mesmas garantias). TypeScript sem erros. ESLint e Prettier sem
  problemas nos arquivos da Fase 1; restam 2 erros e 3 avisos de ESLint preexistentes em scripts
  antigos não alterados (`e2e-etapa7-web.cjs`, `e2e-finance-b.ts`, `e2e-finance-c.ts`) e três
  evidências JSON históricas fora do padrão do Prettier já no HEAD.
- Expo Doctor: 20/21; a falha é só versão de patch publicada depois (`expo` 57.0.30 e
  `expo-router` 57.0.28). Dependências não foram alteradas.
- **E2E HTTP Fase 1 10/10** contra API real e emuladores
  ([evidência](evidence/finance-phase1-e2e.json)); E2Es anteriores reexecutados: A 16/16, B 33/33, C 24/24 e C adicional 6/6 (evidências históricas versionadas foram mantidas; saídas novas em `.local/phase1/legacy-evidence`).
- Export web (2,9 MB), iOS (Hermes 5 MB) e Android (Hermes 5,3 MB) aprovados (`.local/phase1/export`). Bundles locais, não builds assinados.
- Navegador (desktop 1024/1440, tablet 768, celular 430/375/320): painel, filtros, recebimento
  parcial e quitação, acima do saldo, calendário, condição personalizada, forma, crédito, estorno com
  senha, reembolso manual, operação pendente, troca de empresa e vendedor sem acesso.

## 8. Evidências visuais

Capturas locais em `frontend/.local/phase1/evidence/` (ignorado pelo Git), numeradas por fluxo:
`0x` antes, `1x` painel/recebimento, `2x` condições/formas, `3x` créditos/estornos/reembolsos/
operações, `4x` empresa/vendedor, `5x` celular 320–375 px.

## 9. Pendências para a Fase 2 — Pedidos

1. `PaymentFields`: mostrar as condições cadastradas como opções visíveis (hoje ficam atrás de
   "Definir depois") e, sem nenhuma cadastrada, avisar com link para Financeiro › Condições e formas.
2. Rotular "Forma de pagamento pretendida" como "Como o cliente pretende pagar (não registra
   pagamento)"; o recebimento já usa essa forma como sugestão.
3. Trocar o vencimento manual digitado por `DateField` (calendário, DD/MM/AAAA).
4. `OrderFinancePanel`: atualizar link para `/financeiro/receber?pedido=` (o redirecionamento cobre
   o link antigo) e usar as situações Vencido/Vence hoje/A vencer/Quitado.
5. Fluxo físico de devolução (intenção e recebimento físico) no pedido; o Financeiro só acerta o que
   já foi recebido.
6. Atalho no pedido para "Registrar pagamento" da próxima parcela em aberto.

## 10. Ajustes finais (encerramento da Fase 1)

### Navegação no celular

Abaixo de 768 px, as abas deram lugar a um seletor compacto ("Financeiro · seção atual · Seções")
que abre a lista completa, separada em Principal e Mais opções, com descrição curta de cada seção.
Nenhuma opção fica cortada em 320, 375 ou 430 px. Os filtros em segmento (situação das contas,
abas de Condições/Formas, reembolsos, operações) passam a quebrar linha no celular. O desktop não
mudou.

### Linguagem

Textos do Financeiro revisados para uma comunicação próxima e clara, sem citar servidor, API,
publicação, versões ou mecanismos internos (ex.: "Pagamento registrado!", "R$ 29,97 recebidos.
Tudo certo, o saldo da parcela já foi atualizado.", "Pronto! Operação concluída."). Sucesso só
aparece após a confirmação da API; operações sem confirmação aparecem como "Ainda não sabemos se
… foi registrado", com o botão "Conferir", que repete a mesma solicitação sem duplicar. O Lastro
nunca afirma que o dinheiro entrou na conta bancária. Códigos de erro, contratos e registros
técnicos não mudaram; detalhes técnicos continuam disponíveis em "Detalhes técnicos".

### Latência após registrar pagamento

Medições (logs do Cloud Run da homologação, leitura; 15–16/10/2026):

| Medida (servidor, `durationMs`)           | p50         | p90         |
| ----------------------------------------- | ----------- | ----------- |
| `POST /orders/:id/receipts`               | 2,0 s       | 2,3 s       |
| `GET /orders/:id/financial-state`         | 1,9 s       | 5,1 s       |
| `GET /receivables` / `/receivables/:id`   | 3,1 / 3,5 s | 5,2 / 7,8 s |
| `GET /payment-methods` (consulta simples) | 2,5 s       | 7,2 s       |

Em cada pagamento da homologação, o app disparava **11 a 30 consultas simultâneas** logo após o
POST, porque invalidava todo o Financeiro e Pedidos e as telas anteriores continuam montadas na
pilha de navegação. Todas caíam numa única instância, cujas consultas entram em fila (leitura
transacional por requisição e limite interno de leituras simultâneas), e o saldo da tela atual só
chegava **3,9 a 11 s** depois do POST. Cloud Run e Firestore estão em `southamerica-east1`; o
Cloud Run usa mínimo de 0 instâncias, 1 vCPU e CPU apenas durante requisições.

Mudanças no frontend:

- A resposta **confirmada** do recebimento é aplicada na hora ao saldo da parcela, à posição do
  pedido, às listas e ao painel (`applyConfirmedReceipt`). Nada é mostrado antes da confirmação.
- Depois de qualquer comando financeiro, só as consultas do pedido/cliente/parcelas afetados são
  recarregadas; o resto fica marcado como desatualizado e se atualiza quando a tela volta a ficar
  visível (`refreshAfterFinanceCommand`, `useRefetchStaleOnFocus`).
- A confirmação não espera mais essas consultas terminarem.

Medição local (emuladores), mesma navegação painel → lista → parcela:

| Medida                           | Antes  | Depois                           |
| -------------------------------- | ------ | -------------------------------- |
| Consultas disparadas após o POST | 11     | 6 (só do pedido)                 |
| Aviso de sucesso                 | 320 ms | 328 ms                           |
| Saldo novo na tela               | 544 ms | 379 ms (junto com a confirmação) |

Na homologação, o saldo passa a aparecer junto com a confirmação do POST (~2 s medidos no
servidor), em vez de esperar a fila de consultas (até 11 s). O tempo do próprio POST e das leituras
depende do backend/infraestrutura; recomendações (sem alteração feita): instância mínima 1 para
evitar partida a frio, revisar o limite de leituras simultâneas por instância e o custo da
inspeção por título nas listagens, e oferecer endpoint agregado para o painel.
