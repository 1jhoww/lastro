# Manuais do usuário

Manuais de uso do Lastro para usuários finais, um PDF por módulo, com a identidade visual do app
(cores de `frontend/src/theme/tokens.ts`, fonte Inter de `frontend/assets/fonts`, símbolo e
wordmark de `frontend/src/brand`).

| Arquivo | Conteúdo |
|---|---|
| `lastro-manual-primeiros-passos.pdf` | Convite e criação de conta, login, recuperação de senha, navegação (computador e celular), tela Início, Meu Perfil, telas de acesso bloqueado |
| `lastro-manual-pedidos.pdf` | Ciclo do pedido, lista e filtros, lançar pedido, condição de pagamento e vencimentos manuais, editar, confirmar (reserva), vencimento depois da confirmação, registrar saída, confirmar entrega, documentos PDF (baixar, compartilhar, logotipo e fotos por plano), cancelar, desconto |
| `lastro-manual-financeiro.pdf` | Termos, navegação, condições e formas, contas a receber, registrar pagamento, correção de vencimento (regras, restrições e histórico), estorno, crédito do cliente, reembolsos, créditos, cancelamento financeiro, financeiro do pedido |
| `lastro-manual-clientes.pdf` | Carteira, busca, cadastro (CEP), ficha, edição, transferência de carteira, desativação, visão do vendedor |
| `lastro-manual-visitas.pdf` | Visitas e contatos, registro de visita, recompra, histórico do cliente |
| `lastro-manual-produtos.pdf` | Cadastro, SKU, unidade, preço, edição, fotos (formatos, limites, adicionar depois, falha e nova tentativa), desativação, categorias |
| `lastro-manual-estoque.pdf` | Físico/reservado/disponível, entradas, ajustes, movimentações, reposição |
| `lastro-manual-devolucoes.pdf` | Registro, recebimento físico (vendável/danificado), cancelamento de pendências, acerto financeiro |
| `lastro-manual-relatorios.pdf` | Catálogo de relatórios, filtros, CSV/PDF, exportação de cadastros |
| `lastro-manual-usuarios-e-permissoes.pdf` | Perfis, Configurações, nome e logotipo da empresa, vagas do plano, convites, edição/desativação, permissões do vendedor, planos Essencial e Profissional, funções da equipe do Lastro (Super Admin) |
| `lastro-manual-catalogo-publico.pdf` | Disponibilidade por plano, configurar, logotipo e marca do Lastro, publicar e compartilhar, escolher produtos, tirar do ar, visão do cliente |
| `lastro-apresentacao.pdf` | Apresentação do app em A4 paisagem (18 slides): visão geral, perfis, jornada da venda, um slide por módulo, celular, planos, confiabilidade e manuais |

Cada manual tem capa, índice com páginas, passo a passo numerado, caixas de dica/atenção/"não pode
ser desfeito", tabela "Quem pode fazer o quê" (administrador × vendedor, conforme
`backend/src/modules/users/permissions.ts`) e rodapé com paginação.

As capturas ficam em `fonte/capturas/` (telas a 1280 px e 390 px, com densidade 2x, e as
páginas de PDF `pdf-*.png`). Foram feitas no app local com os emuladores e usam só dados
fictícios: a empresa "Distribuidora Demo Lastro" do seed local (`backend/scripts/seed-local.ts`,
plano Profissional, com logotipo e fotos de demonstração) e a empresa "Mercearia Demo Essencial"
(plano Essencial). Não coloque dados reais, senhas ou tokens nos manuais: o repositório é
público.

## Como regenerar

Requisitos: Node 22+, Google Chrome ou Microsoft Edge instalado (ou a variável `LASTRO_CHROME`
apontando para o executável) e as dependências do backend instaladas (`pdfjs-dist` numera o índice).

```bash
node docs/manuais/fonte/gerar.mjs
```

Para gerar só alguns módulos, passe os slugs (`node docs/manuais/fonte/gerar.mjs pedidos estoque`).
Com `--html`, o HTML final também é gravado em `docs/manuais/fonte/.html/` para inspeção.

## Fonte

- `fonte/modulos/*.md`: texto de cada manual. O cabeçalho (`---`) define `slug`, `modulo`,
  `titulo`, `subtitulo`, `publico`, `resumo`, `administrador` e `vendedor`.
- `fonte/estilo.css`: layout A4 e identidade visual.
- `fonte/gerar.mjs`: converte o Markdown, imprime com o Chrome headless e preenche o índice.

Marcações aceitas no Markdown, além de `##`/`###`, listas, tabelas, `**negrito**` e `` `código` ``:

| Marcação | Resultado |
|---|---|
| `[[Novo pedido]]` | Nome de botão, aba ou opção como aparece na tela |
| `((Confirmado\|destaque))` | Selo de situação (tons: `sucesso`, `alerta`, `perigo`, `destaque`) |
| `{sim}` `{nao}` `{pad}` `{lib}` `{sim:Texto}` | Marcadores das tabelas de permissão |
| `:::dica`, `:::atencao`, `:::irreversivel`, `:::perfil`, `:::nota` + `:::` | Caixas de destaque (título opcional após o tipo) |
| `:::lado` + `:::` | Texto à esquerda e captura de celular à direita |
| `![Legenda](arquivo.png "sem-menu h=80")` | Captura de `fonte/capturas`; `sem-menu` corta o menu lateral, `h` limita a altura em mm, `estreita` usa 62% da largura |
| `## Título {nova-pagina}` | Seção começando em página nova |

A apresentação paisagem tem fonte própria: `fonte/apresentacao.html` (um `<section class="slide">` por slide; `{{img:arquivo.png}}` aponta para `fonte/capturas`). Regenere com:

```bash
node docs/manuais/fonte/gerar-apresentacao.mjs
```

Ao mudar uma tela do app, atualize o manual do módulo, refaça a captura com o mesmo nome em
`fonte/capturas/` e rode o gerador de novo.
