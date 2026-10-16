# Pedidos — estado preservado da Fase 2

Base: `732359b`, da branch `codex/preserve-finance-phase1`.
Branch de trabalho: `codex/orders-phase2`.

Este checkpoint preserva a implementação em andamento a pedido do usuário. Não representa conclusão da Fase 2 nem liberação para homologação.

## Alterações

- Cliente disponível imediatamente, busca por nome e avanço direto para produtos.
- Responsável próximo ao cliente; estrutura principal de produtos e carrinho preservada.
- Revisão em colunas, calendário compartilhado e prévia das parcelas com pesos e maiores restos.
- Filtros responsivos e busca por número explicitamente limitada aos pedidos carregados.
- Ação “Registrar saída”, documentos e histórico recolhidos nos detalhes.
- Resumo financeiro reutiliza consultas e chaves de cache do Financeiro.
- Solicitação de devolução, recebimento parcial, separação vendável/danificado, cancelamento de pendências e acesso à resolução financeira.
- Intenções duráveis de devolução com chave idempotente, versões e isolamento por usuário, empresa e pedido.

Backend, contratos, infraestrutura e dados reais não foram alterados. Os artefatos GraphiFy existentes foram consultados junto ao código e à OpenAPI; não foram regenerados e não representam as novas telas.

## Validação já executada

- Suíte frontend existente: 40 suítes, 554 testes aprovados antes dos últimos ajustes de apresentação.
- Novos testes de comandos de devolução e prévia: 8 aprovados.
- Integração: 4 arquivos, 79 testes aprovados (`orders`, `returns`, `paymentSettings`, `financeReceipts`).
- Emuladores existentes reutilizados com projeto `demo-lastro-tests`. Um executor local ajustou somente o login sintético para indicar o projeto de teste e usar a autenticação administrativa do emulador. As primeiras tentativas sem esse ajuste falharam na preparação das fixtures.
- Navegador local: login sintético, seleção de empresa, busca de cliente, avanço para produtos e inclusão no carrinho exercitados.

## Ainda pendente

- Reexecutar suíte completa após todos os ajustes finais e gerar build web.
- Completar E2E do novo fluxo físico de devolução e testes de tela específicos.
- Concluir inspeção visual de todas as telas em 320, 375, 430, 768, 1024 e 1440 px. Capturas preliminares não constituem aprovação visual completa.
- Revisar casos de concorrência, recuperação após resposta ambígua e atualização das listas após devolução.
- Consolidar relatório final, evidências e pendências de documentos.

## Limitações conhecidas

- API não oferece busca global de pedidos por número; filtro local informa seu alcance.
- API de responsáveis não oferece nome ou e-mail; interface preserva a identificação disponível.
- Melhorias no conteúdo dos PDFs ficam para a fase de Documentos; arquivos oficiais do backend são preservados.

Commit e push deste checkpoint foram solicitados explicitamente depois da orientação inicial de manter tudo local. Nenhum merge na `main` ou comando de deploy faz parte desta entrega.

## Refinamento de Pedidos e Documentos (2026-10-16)

- Novo pedido e edição em uma página contínua: Dados do pedido, Produtos, Pagamento e Finalização. Os passos numerados foram removidos.
- Cliente em combobox (65%) e responsável em select compacto (35%). O responsável só é editável por administradores.
- Catálogo com preço alinhado e controle −/+ com digitação. Quantidade zero retira o produto do carrinho.
- No desktop largo, o carrinho fica em coluna lateral fixa durante a rolagem. No celular, uma barra inferior mostra itens e total e abre o resumo.
- Prévia de parcelas em tabela abaixo da condição. Rodapé com total, "Salvar rascunho" e "Confirmar pedido". Confirmar salva o rascunho e abre na ficha a confirmação com reserva de estoque.
- Documentos em duas linhas: Pedido comercial e Romaneio, com ações de visualizar, baixar e compartilhar. Cada ação obtém o PDF e executa a intenção. Arquivos salvos como `pedido-PED-XXXXXXXX.pdf` e `romaneio-PED-XXXXXXXX.pdf`.
- Melhorias visuais dos PDFs ficaram registradas para o backend em `backend/docs/proposals/order-documents-layout.md`.
- Verificação feita: typecheck, lint, quatro suítes de testes relacionadas (26 testes) e build web. A inspeção visual das telas autenticadas não foi feita.
