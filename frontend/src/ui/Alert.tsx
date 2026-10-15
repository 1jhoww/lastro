import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from '@/ui/icons';
import { color, radius, space } from '@/theme';
import { Text } from './Text';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const tones: Record<Tone, { bg: string; fg: string; bar: string; icon: LucideIcon }> = {
  info: { bg: color.surface, fg: color.text, bar: color.structure, icon: Info },
  success: { bg: color.successSoft, fg: color.success, bar: color.success, icon: CircleCheck },
  warning: { bg: color.warningSoft, fg: color.warning, bar: color.accent, icon: TriangleAlert },
  danger: { bg: color.dangerSoft, fg: color.danger, bar: color.danger, icon: CircleAlert },
};

type Props = { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode };

/** Aviso em linha: diz o que aconteceu e o que fazer. Erros e avisos são anunciados. */
export function Alert({ tone = 'info', title, children, action }: Props) {
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <View
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      style={[styles.root, { backgroundColor: t.bg, borderLeftColor: t.bar }]}
    >
      <Icon size={18} color={t.fg} strokeWidth={2} style={styles.icon} />
      <View style={styles.body}>
        <Text variant="bodyStrong" color={t.fg}>
          {title}
        </Text>
        {typeof children === 'string' ? (
          <Text variant="small" color={color.text}>
            {children}
          </Text>
        ) : (
          children
        )}
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    borderLeftWidth: 3,
  },
  icon: { marginTop: 2 },
  body: { flex: 1, gap: space[1] },
  action: { marginTop: space[2], alignItems: 'flex-start' },
});
