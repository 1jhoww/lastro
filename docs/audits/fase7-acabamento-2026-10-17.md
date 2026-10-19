# Fase 7 — Acabamento geral, UX e responsividade

Data: 17/10/2026. Base local: `4051f03`. Sem commit, push ou deploy.

## Diagnóstico inicial

O frontend usa Expo SDK 57, React Native e Expo Router. `Screen`, `DataTable`, `Dialog`, `TextField`, `Alert`, `Skeleton`, `EmptyState` e tokens de tema já concentram grande parte da apresentação. A navegação protege grupos pelo estado da sessão; o backend revalida permissões. As listas principais têm tratamento compacto, e os módulos já usam estados de carregamento, erro e vazio. Não apareceu duplicação que justificasse consolidação ampla.

Faltava a tela Meu Perfil. O nome podia ser editado diretamente no menu, mas não havia lugar único para ver identidade, empresa, função e segurança. A entrada de estoque enviava a operação ao tocar no botão principal, embora o ajuste exigisse revisão. A tabela de estoque no desktop omitia o mínimo cadastrado. O cabeçalho da plataforma e a moldura da conta precisavam comportar a nova ação em larguras pequenas.

Baseline da suíte unitária: 48 suítes, 597 testes aprovados e 13 falhas reproduzidas. O primeiro comando Jest parou antes dos testes porque o cache padrão ficava em uma pasta temporária sem permissão. A execução reproduzível usou `--cacheDirectory .local/jest-phase7`.

## Falhas conhecidas

| # | Teste | Classificação | Causa e tratamento |
|---|---|---|---|
| 1 | Estoque: colunas no desktop | Defeito de interface, com assert antigo | O mínimo não aparecia na tabela. A coluna foi incluída; o assert antigo de “Situação” foi substituído pelo mínimo acessível. A situação já aparece como texto junto ao produto. |
| 2 | Estoque: detalhe do produto | Teste desatualizado | O teste exigia mostrar a versão técnica `9`. O detalhe apresenta saldos, mínimo, reposição e histórico; a versão permanece interna. A verificação técnica foi retirada do teste. |
| 3 | Entrada: validação e revisão | Defeito de interface | O envio ocorria sem revisão. A confirmação voltou antes da chamada à API. |
| 4 | Entrada em KG: três casas | Defeito de interface | O fluxo esperado de revisão não existia. A confirmação voltou; a precisão permaneceu igual. |
| 5 | Entrada em KG: quatro casas | Defeito de interface | O fluxo esperado de revisão não existia. A confirmação voltou; a validação continua bloqueando o envio. |
| 6 | Entrada: falha de rede e chave | Defeito de interface | O fluxo esperado de revisão não existia. A confirmação voltou; a repetição mantém chave e corpo. |
| 7 | Entrada: timeout | Defeito de interface | O fluxo esperado de revisão não existia. A confirmação voltou; o resultado incerto continua protegido. |
| 8 | Entrada: erro 5xx e retorno | Defeito de interface | O fluxo esperado de revisão não existia. A confirmação voltou; a intenção pendente continua preservada. |
| 9 | Entrada: recusa do servidor | Defeito de interface | O fluxo esperado de revisão não existia. A confirmação voltou; nova intenção recebe outra chave. |
| 10 | Reposição: aviso no início | Teste desatualizado | O aviso atual diz “Estoque baixo” e “1 produto abaixo do mínimo”. O teste agora verifica essa apresentação e a consulta. |
| 11 | Reposição: início do vendedor | Teste desatualizado | “Pedidos recentes” virou “Atividade recente”. O teste ainda confirma que vendedor não consulta reposição. |
| 12 | Dashboard: prioridades | Teste desatualizado | Os textos de pedidos e vencimentos mudaram. O teste agora verifica o bloco de prioridade, a contagem, o valor e a ausência de falso alerta de estoque. |
| 13 | Permissões: ajuda do estoque | Teste desatualizado | A legenda passou a iniciar recolhida. O teste abre “Entender os saldos” antes de verificar a ajuda; também verifica ações do administrador. |

As sete falhas de entrada passaram após corrigir a interface, sem mudar seus asserts. As outras verificações foram alinhadas à apresentação atual e mantiveram verificações de dados, consultas e permissões. Nenhum teste foi removido ou desabilitado. Nenhuma falha foi classificada como instabilidade não determinística.

## Correções por módulo

- **Meu Perfil:** nova rota para identidade autenticada, inclusive sem empresa ativa ou com acesso bloqueado. Mostra nome, e-mail, empresa e função. Usa `PATCH /api/v1/me` para nome, com atualização do cache da sessão, saudação e menu. Usa o envio de link do Firebase para alteração de senha. Mostra o fluxo existente de troca de e-mail somente quando o suporte tiver iniciado uma solicitação. Oferece saída da sessão. Não permite editar função, permissões, empresa ou assinatura.
- **Estoque:** revisão antes de registrar entrada; mínimo visível na tabela desktop. Validação de quantidade, idempotência e tratamento de resultado incerto permaneceram cobertos pelos testes.
- **Navegação e responsividade:** Meu Perfil entrou no menu lateral, trilho médio, tela Mais, moldura de conta e área Super Admin. Cabeçalhos da conta e da plataforma aceitam quebra de linha em larguras pequenas.
- **Dashboard:** teste alinhado ao bloco de prioridade atual. A saudação passou a ser verificada após editar nome no perfil.
- **Clientes e carteiras, produtos, pedidos, financeiro, relatórios, documentos, usuários, Super Admin, visitas e recompra:** revisão estática dos fluxos e testes existentes. Nenhuma alteração de regra ou apresentação sem defeito comprovado. A distinção entre visita manual, entrega automática e estimativa já consta das telas e textos atuais.

## Validação

| Verificação | Resultado |
|---|---|
| 13 falhas anteriores | 13 tratadas; suítes de Dashboard, Estoque e Permissões: 40/40 aprovados. |
| Suíte unitária completa | 49 suítes, 613/613 testes aprovados. Depois, teste direcionado do perfil: 4/4 aprovados. |
| Typecheck frontend | `npm run typecheck` aprovado. |
| Lint frontend | `npm run lint` aprovado. |
| Bundle web | `npm run export:web` aprovado. |
| Bundle Android | `npx expo export --platform android --output-dir .local/phase7-android-export` aprovado com `TEMP` e `TMP` apontando para `.local`. |
| Contrato frontend/backend | Nenhum endpoint, schema ou payload novo. A tela usa `/me`, `/tenants/current` e o fluxo de e-mail já existentes; TypeScript validou as chamadas. |
| Inspeção visual no navegador | Não realizada. Navegador retornou `ERR_CONNECTION_TIMED_OUT` para `localhost:8090`; o shell recebeu erro de permissão ao acessar `127.0.0.1:8090`. |
| PDF comercial e romaneio | Sem mudança nas fontes ou regras; não houve nova inspeção visual dos PDFs nesta fase. |

Nenhuma tela foi verificada visualmente em 320–375 px, 390–430 px, 768 px ou 1280 px. Testes de componentes e bundles não substituem essa inspeção. A navegação crítica foi exercitada por testes de rota, sessão e tela; não houve validação manual com teclado, leitor de tela ou teclado virtual.

## Arquivos principais

- `frontend/src/app/meu-perfil.tsx`
- `frontend/src/session/gate.ts` e `frontend/src/navigation/RootNavigator.tsx`
- `frontend/src/layout/AccountMenu.tsx`, `frontend/src/app/(app)/mais.tsx`, `frontend/src/features/session/AccountFrame.tsx` e `frontend/src/features/platform/PlatformShell.tsx`
- `frontend/src/features/session/NameEditor.tsx`
- `frontend/src/features/inventory/MovementForm.tsx` e `frontend/src/app/(app)/estoque/index.tsx`
- `frontend/tests/unit/myProfile.test.tsx`, `inventoryScreens.test.tsx`, `dashboard.test.tsx` e `permissions.test.tsx`

## Pendências para Fase 8

Validar visualmente as telas principais, Meu Perfil, modais, relatórios e PDFs nas quatro faixas de largura solicitadas. Exercitar teclado, foco, leitor de tela, teclado virtual, login e logout em navegador e dispositivo. Confirmar os fluxos com backend e Firebase em ambiente de homologação. A inspeção visual bloqueada impede afirmar que o critério visual da Fase 7 foi comprovado integralmente.
