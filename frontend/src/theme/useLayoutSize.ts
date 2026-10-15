import { useWindowDimensions } from 'react-native';
import { breakpoint } from './tokens';

export type LayoutSize = 'compact' | 'medium' | 'expanded';

export function layoutSizeFor(width: number): LayoutSize {
  if (width >= breakpoint.expanded) return 'expanded';
  if (width >= breakpoint.medium) return 'medium';
  return 'compact';
}

/** Tamanho de layout derivado da largura da janela (web) ou da tela (nativo). */
export function useLayoutSize(): LayoutSize {
  const { width } = useWindowDimensions();
  return layoutSizeFor(width);
}
