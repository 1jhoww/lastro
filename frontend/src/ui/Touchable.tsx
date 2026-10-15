import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import type { InteractionState } from './interaction';

type Props = Omit<PressableProps, 'style' | 'children'> & {
  /** Estilo por estado (hover/foco/pressionado). */
  pressStyle: (state: InteractionState) => StyleProp<ViewStyle>;
  children: ReactNode | ((state: InteractionState) => ReactNode);
  /** Ignorado: `Link asChild` injeta `style` e mesclaria um array com a função, perdendo-a. */
  style?: unknown;
};

/**
 * Pressable seguro para `<Link asChild>`: o estilo por estado vem de `pressStyle`, que o Link
 * não toca. Use sempre que um Pressable com estilo-função for filho de Link.
 */
export function Touchable({ pressStyle, style: _ignored, children, ...rest }: Props) {
  return (
    <Pressable {...rest} style={(s) => pressStyle(s as InteractionState)}>
      {children as PressableProps['children']}
    </Pressable>
  );
}
