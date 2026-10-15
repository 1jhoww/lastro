/**
 * Tokens do design system do Lastro.
 *
 * As seis cores de marca vêm do brand kit oficial (docs/brand.md). As demais são derivações
 * funcionais com contraste verificado (WCAG AA para texto). Componentes nunca usam hex soltos:
 * sempre `color.*`.
 */

export const brand = {
  carvao: '#111111',
  grafite: '#2A2A2A',
  bege: '#F6F3ED',
  amarelo: '#F3B800',
  areia: '#E4DCCF',
  cinza: '#A0A0A0',
} as const;

export const color = {
  // Superfícies claras
  canvas: brand.bege, // fundo da área de trabalho
  surface: '#FCFBF8', // painéis, campos e linhas de tabela
  surfaceSunken: '#EFEBE3', // trilhos, áreas recolhidas, skeleton
  border: brand.areia,
  borderStrong: '#CFC5B4',

  // Texto sobre superfícies claras
  text: brand.carvao, // 17:1 sobre bege
  textSecondary: '#5E5A53', // 6.2:1 sobre bege
  textPlaceholder: '#77716A',
  textDisabled: brand.cinza, // somente estados desabilitados, nunca conteúdo

  // Estrutura escura (navegação, painel de marca)
  structure: brand.carvao,
  structureRaised: '#1C1C1C',
  structureLine: brand.grafite,
  onStructure: '#F6F3ED',
  onStructureSecondary: '#CFCAC0', // 11.6:1 sobre carvão
  onStructureMuted: '#8F8A80', // 5.5:1 sobre carvão

  // Destaque. Amarelo nunca é cor de texto sobre fundo claro.
  accent: brand.amarelo,
  accentPressed: '#DCA600',
  accentSoft: '#FDF1C7',
  onAccent: brand.carvao, // 10.5:1

  // Semânticas
  danger: '#B42318',
  dangerSoft: '#FBE9E7',
  success: '#1F6B45',
  successSoft: '#E5F2EA',
  warning: '#7A5A00',
  warningSoft: '#FDF1C7',
  info: brand.grafite,
  infoSoft: '#ECE7DE',

  focus: brand.carvao,
  focusOnStructure: brand.amarelo,
  overlay: 'rgba(17,17,17,0.48)',
} as const;

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/**
 * Escala tipográfica (tamanho/entrelinha em px). Inter abaixo de 20px usa espaçamento neutro;
 * acima disso, levemente negativo, como no wordmark.
 */
export const type = {
  display: { fontSize: 40, lineHeight: 44, letterSpacing: -1.2, fontFamily: fontFamily.semibold },
  h1: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6, fontFamily: fontFamily.semibold },
  h2: { fontSize: 20, lineHeight: 26, letterSpacing: -0.3, fontFamily: fontFamily.semibold },
  h3: { fontSize: 16, lineHeight: 22, letterSpacing: -0.1, fontFamily: fontFamily.semibold },
  bodyLarge: { fontSize: 17, lineHeight: 26, letterSpacing: 0, fontFamily: fontFamily.regular },
  body: { fontSize: 15, lineHeight: 22, letterSpacing: 0, fontFamily: fontFamily.regular },
  bodyStrong: { fontSize: 15, lineHeight: 22, letterSpacing: 0, fontFamily: fontFamily.medium },
  small: { fontSize: 13, lineHeight: 18, letterSpacing: 0, fontFamily: fontFamily.regular },
  smallStrong: { fontSize: 13, lineHeight: 18, letterSpacing: 0, fontFamily: fontFamily.medium },
  caption: { fontSize: 12, lineHeight: 16, letterSpacing: 0.1, fontFamily: fontFamily.regular },
  // Números: mesmos tamanhos, dígitos tabulares para alinhar colunas de valores e quantidades.
  figure: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
    fontFamily: fontFamily.medium,
    fontVariant: ['tabular-nums'] as 'tabular-nums'[],
  },
  figureLarge: {
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.6,
    fontFamily: fontFamily.semibold,
    fontVariant: ['tabular-nums'] as 'tabular-nums'[],
  },
} as const;

export type TypeVariant = keyof typeof type;

/** Base 4. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/**
 * Raios em hierarquia: quanto maior a peça, maior o raio. O quadrado amarelo do símbolo
 * (`mark`) é a única forma com raio proporcional fixo.
 */
export const radius = {
  xs: 4,
  sm: 6, // badges, marcadores
  md: 10, // botões, campos
  lg: 14, // painéis
  xl: 20, // folhas modais, ícone do app
  pill: 999,
} as const;

/** Sombras só para camadas que flutuam (menus, modais, toasts). Painéis usam borda. */
export const elevation = {
  overlay: {
    shadowColor: brand.carvao,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  raised: {
    shadowColor: brand.carvao,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;

export const breakpoint = {
  /** abaixo: celular, navegação inferior */
  medium: 768,
  /** a partir daqui: barra lateral completa */
  expanded: 1100,
} as const;

export const layout = {
  sidebarWidth: 248,
  railWidth: 76,
  contentMaxWidth: 1240,
  tabBarHeight: 64,
  /** área mínima de toque */
  hitTarget: 44,
} as const;

export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;
