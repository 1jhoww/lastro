# Lastro — Fase 8: validação e homologação local

Execução: 17–18/10/2026, America/Sao_Paulo. Estado: homologação local concluída com ressalvas.

## Ambiente e preservação

- Repositório em `C:\Users\Administrador\Desktop\Lastro`; alterações locais da Fase 7 e `graphify-out` preservados. Sem commit, push, deploy ou mudança produtiva.
- Node 22.23.3, Temurin 21.0.7, Firebase CLI 15.33.0, Expo 57.0.29.
- Desenvolvimento: `demo-lastro-phase-a`; Auth `127.0.0.1:9099`, Firestore `:8080`, Storage `:9199`, API `:3000`, web `localhost:8081`.
- Integração: `demo-lastro-tests`, isolado da exportação persistente de desenvolvimento.
- Dados demo foram importados, preservados e reexportados em 18/10/2026 02:29. O backup inicial permanece em `backend/.local/emulator-backups`. O Auth exportado contém 13 contas: três demo preexistentes e dez sintéticas criadas nesta fase, incluindo três tentativas do roteiro de perfil. Nenhuma foi apagada.
- `RATE_LIMIT_MAX=5000` valeu somente no processo local da API durante E2E. Nenhum `.env` foi alterado.
- Sandbox causava `EACCES` no loopback e `EPERM` no temporário. Execução local autorizada e `TEMP/TMP` em `.local` resolveram. Proxy IPv4 temporário serviu somente ao navegador integrado.

## Regressão

| Verificação | Resultado |
| --- | --- |
| Frontend Jest | 49 suítes, 614/614 após correções |
| Frontend typecheck e lint | Aprovados |
| Export Expo web e Android | Aprovados; JavaScript web 3,1 MB e Hermes 5,6 MB |
| Backend unitários | 24 suítes, 320/320 no comando padrão |
| Backend build, typecheck, lint | Aprovados; build anterior às alterações apenas de testes |
| OpenAPI | Verificação aprovada; contrato frontend e backend tinham SHA-256 idêntico |
| Scanner local de segredos | Zero achados nos dois projetos; `.env` ignorados; token OIDC não consta do bundle web |
| `git diff --check` | Sem erros; só avisos LF/CRLF |

A primeira rodada integral de integração funcional (`--without-capacity`) aprovou 478/479 testes em 47/48 arquivos. O único teste falho omitia `commercial.visits` da confirmação de recursos perdidos. A API recusou corretamente o downgrade com `FEATURE_LOSS_UNCONFIRMED`. Corrigido o dado do teste, o arquivo isolado passou 3/3. A repetição integral aprovou **479/479 testes em 48/48 arquivos**, em 1.794,64 segundos. [Relatório bruto](../../backend/reports/emulator-tests.raw.json).

Dois ensaios de 20.000 fontes foram excluídos pelo modo documentado `--without-capacity`. Resultados anteriores em `backend/docs/validation-f02.md` não são nova evidência da Fase 8. `format:check` aponta 52 arquivos preexistentes fora do Prettier; nenhum foi formatado em massa.

O teste unitário composto de artefato excedeu cinco segundos sob paralelismo. Isolado, passou; com um worker, 320/320 passaram. O limite do teste passou a 35 segundos para dois subprocessos, cada um ainda limitado a 15 segundos. A suíte padrão passou 320/320 depois.

## Fluxos e segurança

- E2E contra API real e emuladores persistentes, usando cliente HTTP do frontend: estoque **17/17** e pedidos **19/19**. Cobriu cadastro sintético, entradas, ajustes, precisão UN/KG, limites, idempotência, concorrência, confirmação, reserva, expedição, cancelamento, carrinho de 200 itens, permissões e isolamento entre empresas.
- Helper E2E usava contrato antigo de criação de empresa e planos dinâmicos vazios. Foi alinhado ao plano oficial `profissional` e aos campos atuais de cobrança. Nenhuma regra comercial mudou.
- Conta sintética web: convite, ativação, login, modal de nome, `Escape` após animação, nome inválido, edição persistida, envio de redefinição, logout e recuperação. Auth Emulator registrou um código para cada solicitação. [Resultado](evidence/fase8/account-flow.json), [modal](evidence/fase8/perfil-modal-320.png), [perfil](evidence/fase8/perfil-editado-320.png), [recuperação](evidence/fase8/recuperacao-enviada-320.png).
- Administrador demo vê nove clientes; vendedor vê três da carteira. Tela negou Financeiro e Usuários ao vendedor. API retornou **403** para exportação de produtos e relatório PDF do vendedor; token inválido recebeu **401**. [Carteira](evidence/fase8/seller-clientes-320.png), [negação](evidence/fase8/seller-financeiro-negado-320.png), [respostas](evidence/fase8/downloads/manifest.json).
- Integração cobre conta bloqueada, limites por plano inclusive Super Admin, convites concorrentes, revogação, isolamento, dinheiro e estoque. `visits.test.ts` exercita visita manual, confirmação automática de entrega, carteira, idempotência e cálculo de recompra. SDK recusou token expirado na integração; renovação após expiração real no navegador não foi reproduzida. Frontend unitário cobre a resposta 401 após atualização.

## Visual e acessibilidade

Foram capturadas 39 combinações de tela e perfil em **320, 390, 768 e 1280 px**: 156 imagens. Cobrem login, recuperação, dashboard, clientes/carteiras, produtos, catálogo, pedidos, estoque, financeiro, relatórios, usuários, Super Admin, visitas, recompra e perfil. Depois das correções, 108 combinações públicas e administrativas foram recapturadas. Outras 28 imagens cobrem detalhes reais de pedido, cliente, produto, estoque e empresa. [Evidência](evidence/fase8/) e [manifesto de detalhes](evidence/fase8/manifest-details.json).

Todas as capturas automatizadas tiveram `documentElement.scrollWidth == innerWidth`. A inspeção DOM não encontrou botão ou campo sem nome acessível nas páginas visitadas. A rolagem interna respondeu no dashboard, usuários, financeiro e novo pedido a 320 px. Capturas intermediárias mostram conteúdo acima da barra inferior; o fim do formulário longo não foi acionado no navegador.

Defeitos visuais médios corrigidos:

1. Totais monetários do dashboard truncavam em 320 e 390 px. Cartões compactos usam uma coluna. [Depois](evidence/fase8/admin-dashboard-320.png).
2. Total financeiro truncava em 320 px. Indicadores compactos usam uma coluna. [Depois](evidence/fase8/admin-financeiro-320.png).
3. “Pessoas com acesso” encolhia até letras verticais a 320 px. Cabeçalho de `Panel` quebra linha e mantém largura mínima. [Depois](evidence/fase8/usuarios-scroll-320.png).

Tab no login percorreu e-mail, senha, mostrar senha, recuperação e Entrar. Campos obrigatórios exibiram erro textual, `aria-invalid` e `aria-describedby`. Modal de nome fechou por `Escape` após completar animação. Contrastes medidos: texto/canvas 17,05:1; secundário/canvas 6,19:1; placeholder/surface 4,66:1; botão/acento 10,49:1; atenuado/estrutura 5,50:1. A amostra não constitui auditoria WCAG completa.

AVD Android 36.1 iniciou duas vezes, mas Chrome/ADB travaram durante captura; o processo próprio foi encerrado. Teclado virtual e TalkBack **não foram validados**. Bundle Android foi gerado, mas app nativo não foi executado.

## PDFs e CSVs

API demo gerou pedido comercial, romaneio, relatório PDF, relatório CSV e produtos CSV. [Manifesto de tamanhos, SHA-256 e tipos](evidence/fase8/downloads/manifest.json). PDFs A4 renderizados mostram acentos, totais, identidade Lastro e indicação não fiscal sem corte visível: [pedido](evidence/fase8/pdf/demo-pedido-comercial-p1.png), [romaneio](evidence/fase8/pdf/demo-romaneio-p1.png), [relatório](evidence/fase8/pdf/demo-relatorio-pedidos-p1.png).

CSV e PDF de relatório conferem: 12 pedidos; dois rascunhos R$ 946,30, dois confirmados R$ 1.327,20, sete expedidos R$ 5.748,22, um cancelado R$ 229,50. CSV de produtos tem 11 linhas e não expõe estoque.

Integração de exportações passou 18/18: nega vendedor e outra empresa, neutraliza fórmulas de planilha, vincula cursor à identidade, revalida permissão e limita downloads concorrentes.

Integração atual gerou pedido e romaneio com 200 itens, 21 páginas A4 cada. Páginas 1, 11 e 21 foram conferidas. R$ 1.000,00 menos R$ 125,00 resulta em R$ 875,00, sem cortes visíveis nas amostras. [Páginas](evidence/fase8/pdf/).

## Classificação dos achados

| Gravidade | Achado | Estado |
| --- | --- | --- |
| Médio | Valores do dashboard truncados no celular | Corrigido e recapturado |
| Médio | Valor do financeiro truncado em 320 px | Corrigido e recapturado |
| Médio | Cabeçalho de Usuários em letras verticais | Corrigido e recapturado |
| Baixo, teste | Helper E2E incompatível com contrato atual | Corrigido; 36/36 cenários passaram |
| Baixo, teste | Confirmação incompleta no cenário de downgrade concorrente | Corrigido; arquivo passou 3/3 |
| Baixo, teste | Timeout de cinco segundos do teste composto sob paralelismo | Corrigido; suíte padrão passou 320/320 |

Nenhum defeito crítico ou alto do produto foi comprovado nesta execução. Lacunas de validação e risco de publicação estão listados abaixo.

## Firestore e publicação

`backend/firestore.indexes.json` declara **150 índices compostos**, **87 configurações de campo** e TTL para `rateLimits.expiresAt`. Os compostos cobrem coleções consultadas pelos módulos, inclusive produtos (61), estoque (16), pedidos (15), clientes (12), visitas (7) e movimentações (7). As regras de Firestore e Storage negam acesso direto do cliente. Autorização por ator, empresa e permissão foi exercitada via API. Índices remotos não foram consultados nem implantados.

O [Firestore Emulator não controla índices compostos](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production). A [documentação oficial](https://firebase.google.com/docs/firestore/query-data/indexing) exige validação em Firestore real. Isso é risco de publicação, sem falha local comprovada.

Pendências: capacidade não repetida, índices remotos não verificados, renovação após expiração real no navegador não reproduzida, teclado virtual e TalkBack não executados. Sem produção autorizada, não há evidência de TLS, IAM, backups remotos ou disponibilidade produtiva. Nenhuma pendência autoriza deploy.

## Parecer

**Aprovado com ressalvas para homologação local.** Fluxos exercitados, regressão automatizada, segurança entre empresas, PDFs e CSVs passaram. As pendências acima impedem concluir prontidão produtiva. Não iniciar Fase 9 sem autorização.
