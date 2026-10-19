# Lastro — Fase 8: rascunho de 17/10/2026

Relatório atualizado: [homologação final de 18/10/2026](fase8-homologacao-final-2026-10-18.md).

Data: 17/10/2026 (America/Sao_Paulo). Estado: validação em andamento.

## Escopo e preservação

O repositório já continha alterações locais da Fase 7 e saídas `graphify-out`. Nada foi descartado, sobrescrito ou enviado ao Git remoto. Nenhum deploy, alteração produtiva ou migração remota foi executado.

O ambiente de desenvolvimento aponta para `demo-lastro-phase-a`. A suíte de integração usa o projeto separado `demo-lastro-tests` e não importa `backend/.local/emulator-data`. A exportação persistida de desenvolvimento já existia antes da execução. Auth, Firestore e Storage usam `127.0.0.1:9099`, `:8080` e `:9199`. A API usa `:3000` e o Expo web `localhost:8081`. Node 22.23.3, OpenJDK/Temurin 21.0.7, Firebase CLI 15.33.0 e Expo 57.0.29.

O sandbox bloqueava conexões de loopback com `EACCES`. As suítes com emuladores foram executadas com acesso local autorizado. O navegador integrado só alcançou IPv4; um proxy temporário, ignorado pelo Git, liga `127.0.0.1:8090` ao Expo em `::1:8081`. A aplicação não foi alterada para resolver esse problema da ferramenta.

## Resultados já concluídos

| Verificação | Resultado |
| --- | --- |
| Frontend Jest | 49 suítes, 614/614 testes aprovados |
| Frontend typecheck e lint | Aprovados |
| Expo web export | Aprovado, bundle web gerado |
| Expo Android export | Aprovado, bundle Hermes gerado |
| Backend build, typecheck e lint | Aprovados |
| OpenAPI e tipos backend | Sincronizados; contrato frontend idêntico por SHA-256 |
| Scanner local de segredos | Zero achados em backend e frontend; `.env` ignorados pelo Git |
| Bundle web | `VERCEL_OIDC_TOKEN` local não aparece no JavaScript exportado |
| `git diff --check` | Sem erros de whitespace; avisos de conversão LF/CRLF |
| Backend `format:check` | 52 arquivos preexistentes fora do padrão Prettier; sem alteração nesta fase |

A primeira execução dos unitários do backend, dentro do sandbox, aprovou 309/320 testes. Dez falharam por `EACCES` em `127.0.0.1`; o teste do artefato excedeu seu timeout de 5 segundos sob carga concorrente. Esses resultados ainda não representam defeito do produto. A repetição fora do bloqueio local está pendente.

## Evidência visual parcial

Login e recuperação foram capturados em 320, 390, 768 e 1280 px. Cada largura apresentou `scrollWidth == innerWidth`. Capturas estão em `evidence/fase8/public-*.png`; não houve erro no console do navegador. A navegação por Tab no login seguiu e-mail, senha, mostrar senha, recuperação e botão Entrar. E-mail vazio e inválido exibiram erro textual; o campo inválido apresentou `aria-invalid=true` e `aria-describedby`.

Três PDFs A4 gerados pelos testes unitários atuais foram renderizados e inspecionados: pedido comercial com acentos, romaneio com acentos e pedido com marca longa. O total de R$ 25,00 corresponde a 2 unidades de R$ 12,50. Os dois documentos comerciais mostram identificação não fiscal. Não houve corte, sobreposição ou perda de glifos nas páginas conferidas. PNGs estão em `evidence/fase8/pdf/`.

Os contrastes dos tokens principais, recalculados: texto/canvas 17,05:1; texto secundário/canvas 6,19:1; placeholder/surface 4,66:1; texto do botão/amarelo 10,49:1; texto atenuado/estrutura 5,50:1. Essa amostra não equivale a auditoria completa WCAG. Leitor de tela e teclado virtual ainda não foram executados.

## Infraestrutura e índices

`backend/firestore.indexes.json` declara 150 índices compostos e 87 configurações de campo; uma configuração TTL cobre `rateLimits.expiresAt`. As regras de Firestore e Storage negam acesso direto do cliente. O backend aplica autorização por identidade, empresa e permissão. A implantação e o estado remoto dos índices não foram consultados nem alterados.

O [Firestore Emulator não controla índices compostos](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production). Assim, testes locais aprovados não comprovam que toda consulta terá índice em produção. A [documentação oficial de índices](https://firebase.google.com/docs/firestore/query-data/indexing) exige validação e implantação separadas antes da publicação.

## Pendências desta execução

- Concluir integração Firebase funcional, segurança e concorrência.
- Repetir unitários do backend fora do bloqueio de loopback.
- Executar inspeção visual autenticada em todas as larguras pedidas.
- Gerar PDF comercial, romaneio, relatório PDF e CSV pelo servidor local; inspecionar páginas e dados.
- Executar fluxos reais de login, logout, permissões, perfil e exportação no ambiente persistente.
- Classificar defeitos comprovados, riscos e parecer final.

Dois ensaios estruturais de 20.000 fontes cada foram excluídos da repetição funcional atual pelo modo documentado `--without-capacity`. A rodada anterior os aprovou, conforme `backend/docs/validation-f02.md`, mas isso não é evidência de nova execução na Fase 8. Nenhuma conclusão de capacidade produtiva será derivada deles.
