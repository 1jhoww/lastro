import { StyleSheet, View } from 'react-native';
import { color, radius, space } from '@/theme';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'strong';

const tones: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: color.infoSoft, fg: color.text, dot: color.textSecondary },
  accent: { bg: color.accentSoft, fg: color.text, dot: color.accent },
  success: { bg: color.successSoft, fg: color.success, dot: color.success },
  warning: { bg: color.warningSoft, fg: color.warning, dot: color.accent },
  danger: { bg: color.dangerSoft, fg: color.danger, dot: color.danger },
  strong: { bg: color.structure, fg: color.onStructure, dot: color.accent },
};

/** Estado curto (ex.: status do pedido). O texto sempre carrega o significado, não só a cor. */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const t = tones[tone];
  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <View style={[styles.dot, { backgroundColor: t.dot }]} />
      <Text variant="smallStrong" color={t.fg} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1] + 2,
    paddingHorizontal: space[2],
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  // Quadrado, não círculo: eco do quadrado amarelo do símbolo.
  dot: { width: 6, height: 6, borderRadius: 1.5 },
});
