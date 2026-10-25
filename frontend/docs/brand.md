# Marca no produto

Fonte de verdade: o brand kit oficial anexado em 2026-10-08 (cópia de referência em
[`brand/brand-kit-referencia.webp`](brand/brand-kit-referencia.webp)). Em caso de divergência, o
brand kit prevalece sobre este documento e sobre os tokens.

## O que o brand kit define

| Elemento    | Definição                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------- |
| Wordmark    | `lastro.` em minúsculas, peso semibold, tracking negativo, ponto final em Amarelo Lastro     |
| Assinatura  | `by hepta`, alinhada à direita sob o wordmark                                                |
| Símbolo     | "L" estrutural em carvão com quadrado amarelo de cantos arredondados no vão superior direito |
| Ícone / App | Símbolo sobre quadrado arredondado carvão (ou bege no modo claro)                            |
| Horizontal  | Símbolo à esquerda do wordmark com assinatura                                                |
| Tipografia  | Inter                                                                                        |
| Ícones      | Traço fino, linear, cantos suaves (compatível com Lucide)                                    |
| Conceito    | Estabilidade, sustentação, confiança: "uma base sólida para o seu negócio"                   |

Paleta oficial:

| Nome           | Hex       | Uso no produto                                                         |
| -------------- | --------- | ---------------------------------------------------------------------- |
| Carvão         | `#111111` | Estrutura (barra lateral, barra inferior), texto principal             |
| Grafite        | `#2A2A2A` | Linhas e estados sobre a estrutura escura                              |
| Bege           | `#F6F3ED` | Fundo da área de trabalho, texto sobre carvão                          |
| Amarelo Lastro | `#F3B800` | Ação principal, marcador de navegação, disponível no estoque           |
| Areia          | `#E4DCCF` | Bordas de painéis                                                      |
| Cinza          | `#A0A0A0` | Somente desabilitado/decorativo (contraste 2,4:1 no bege, não é texto) |

As cores derivadas (superfície, texto secundário, semânticas) estão em
[`src/theme/tokens.ts`](../src/theme/tokens.ts) com o contraste medido. Amarelo nunca é cor de
texto sobre fundo claro.

## Assets: estado atual

**Não há arquivos-fonte oficiais (SVG/PNG) da logo no repositório.** O único material recebido é a
prancha do brand kit em imagem. Para não bloquear a Etapa 1:

- [`src/brand/Wordmark.tsx`](../src/brand/Wordmark.tsx) compõe o wordmark em Inter com o ponto em
  amarelo, seguindo proporções observadas na prancha.
- [`src/brand/Symbol.tsx`](../src/brand/Symbol.tsx) traça o símbolo em SVG a partir da prancha.

Os dois são **reconstruções provisórias**, isoladas em um único componente cada para que a troca
pelos arquivos oficiais seja pontual. Nenhuma nova forma foi criada.

Pendências para a Hepta:

1. SVG oficial do wordmark (com e sem assinatura), do símbolo e da versão horizontal.
2. Ícone do app em 1024×1024 e camadas do ícone adaptativo do Android (frente, fundo, monocromático).
3. Splash: símbolo isolado em PNG com transparência.

Até lá, os ícones do app nativo em `assets/` (ícone, ícone adaptativo e splash) continuam os do template Expo; `app.json` já usa as cores da marca. Na versão web, o favicon (`public/favicon.svg` e `public/favicon.ico`), o `apple-touch-icon` e `assets/favicon.png` usam o símbolo de [`src/brand/Symbol.tsx`](../src/brand/Symbol.tsx), gerados por [`scripts/generate-web-icons.cjs`](../scripts/generate-web-icons.cjs); o modelo `public/index.html` declara esses ícones com `?v=` para renovar o cache do navegador.

## Como a marca aparece na interface

A identidade aparece em um lugar forte e fica quieta no resto:

- **O "L" é a estrutura do app.** A barra lateral escura (desktop) e a barra inferior (celular)
  são o "L" do símbolo sustentando a área de trabalho clara.
- **O quadrado amarelo marca onde você está.** O item de navegação ativo recebe o quadrado
  amarelo encaixado no canto superior direito do ícone, na mesma composição do símbolo. No celular,
  o botão central de novo pedido é o próprio quadrado amarelo.
- **Amarelo é ação, não decoração.** Botão principal, marcador de navegação e o saldo disponível
  do estoque. Nada de gradientes, ilustrações ou cartões coloridos.
- **Tela de acesso como a capa do brand kit:** painel carvão com wordmark grande, frase "Uma base
  sólida para o seu negócio." e o traço amarelo curto.

Os badges de status usam um marcador quadrado (não círculo) pelo mesmo motivo.
