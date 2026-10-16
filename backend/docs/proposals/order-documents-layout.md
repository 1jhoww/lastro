# Pedido comercial e romaneio — revisão visual pendente

Status: pendente. Registrado em 2026-10-16, junto ao refinamento da tela de Pedidos (`codex/orders-phase2`).

Os PDFs são gerados somente no backend (`src/modules/documents/pdfRenderer.ts`, pdfkit, A4). O frontend não tem gerador próprio e não deve ganhar um. Esta nota lista o que muda no gerador existente e quais dados ainda faltam no snapshot do documento.

## Situação atual

- Cabeçalho: nome da empresa, título com aviso não fiscal na mesma linha e `commercialId | situação`.
- Corpo em texto corrido: emissão, data do pedido em UTC, cliente (só o nome).
- Tabela do pedido comercial: Produto/SKU, Qtd/un., Unitário, Subtotal, Desconto, Total.
- Tabela do romaneio: Produto/SKU, Solicitada/un., Expedida, Devolvida física, Conferência.
- Totais, condição, forma e parcelas como linhas de texto soltas.
- Rodapé: `Página N | commercialId`.
- Nome do arquivo: `pedido-<uuid>.pdf` e `romaneio-<uuid>.pdf`. O frontend já substitui por `pedido-PED-XXXXXXXX.pdf` ao salvar, mas o `Content-Disposition` ainda expõe o UUID.

## Ajustes no gerador

Comuns aos dois documentos:

1. Cabeçalho em duas colunas: à esquerda, logo (quando houver) e nome da distribuidora com seus dados; à direita, o tipo do documento ("Pedido comercial" ou "Romaneio"), o número e a data do pedido em destaque.
2. Retirar o aviso não fiscal do título e levá-lo ao rodapé de todas as páginas, em texto pequeno: "Documento não fiscal" (romaneio: "Documento não fiscal. Não comprova entrega.").
3. Data do pedido no fuso da empresa (`tenant.timezone`), não em UTC.
4. Blocos lado a lado de distribuidora e cliente/destinatário, com endereço disponível.
5. Tabela com cabeçalho preenchido, linhas zebradas leves, números alinhados à direita e SKU em linha secundária. Manter a repetição do cabeçalho ao quebrar página.
6. Espaçamento em grade única (múltiplos de 4 pt) e corpo em 9–10 pt para leitura impressa.
7. Rodapé: "Página N de M", número curto do pedido e o aviso não fiscal. "de M" exige `bufferPages: true` ou uma segunda passagem.
8. Evitar bloco órfão: totais e parcelas não começam no fim de uma página sem ao menos duas linhas.

Pedido comercial:

- Tabela: Produto, SKU, Quantidade, Unidade, Preço unitário, Subtotal. Mostrar desconto só quando existir.
- Total do pedido em destaque, alinhado à direita, abaixo da tabela.
- Condição de pagamento e forma pretendida em um bloco. Abaixo, uma tabela de parcelas com número, vencimento e valor.
- Observações em bloco próprio, só quando preenchidas.
- Responsável comercial no bloco de dados do pedido.

Romaneio:

- Mesmo cabeçalho, sem nenhum preço, subtotal ou total.
- Destinatário e endereço de entrega.
- Tabela: Produto, SKU, Quantidade, Unidade e coluna de conferência. Manter as colunas de expedida e devolvida só para pedidos expedidos.
- Área de conferência e recebimento com caixas desenhadas (nome, documento, assinatura, data), sem linhas de sublinhado em texto.

## Dados que o snapshot não traz

`OrderService.authorizedSnapshot` devolve apenas `order` e `tenant { name, timezone }`. Para o layout acima, faltam:

- Distribuidora: razão social, CNPJ, endereço, telefone, e-mail e logo.
- Cliente: documento, endereço, telefone. O pedido guarda só `customerName`. Para não ler o cadastro atual, que pode ter mudado, o caminho seguro é gravar esses dados no pedido ao confirmar.
- Responsável: o pedido tem só `sellerUid`. A API de usuários não expõe nome nem e-mail.
- Número comercial sequencial: `commercialId` é `PED-<uuid>`. Um número curto e legível (`PED-000123`) exige um contador por empresa no backend. Enquanto ele não existir, a interface usa os 12 primeiros caracteres.

## Fora do escopo

- Nenhum gerador de PDF no frontend.
- Nenhuma alteração no contrato de autorização, no limite de páginas (`MAX_PDF_PAGES`) ou nos limites de tempo e tamanho.
- O teste de PDFs (`scripts/validate-document-pdfs.mjs`) deve continuar válido para 200 itens e acentos depois da revisão.
