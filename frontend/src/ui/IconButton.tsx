import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { color, layout, radius } from '@/theme';
import { focusRing, showFocusRing, type InteractionState } from './interaction';

type Props = Omit<PressableProps, 'style' | 'children'> & {
  icon: LucideIcon;
  /** Obrigatório: botão só com ícone precisa de nome acessível. */
  label: string;
  tone?: 'onLight' | 'onStructure';
};

export function IconButton({ icon: Icon, label, tone = 'onLight', ...rest }: Props) {
  const onStructure = tone === 'onStructure';
  const fg = onStructure ? color.onStructureSecondary : color.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...rest}
      style={(state: InteractionState) => [
        styles.base,
        (state.hovered || state.pressed) && {
          backgroundColor: onStructure ? color.structureRaised : 'rgba(17,17,17,0.06)',
        },
        showFocusRing(state) && focusRing(onStructure),
      ]}
    >
      <Icon size={20} color={fg} strokeWidth={1.75} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: layout.hitTarget,
    height: layout.hitTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
