import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { color, radius, space } from '@/theme';
import { Text } from './Text';

type Props = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  /** compact: dentro de painéis; regular: tela inteira vazia. */
  size?: 'compact' | 'regular';
};

/** Estado vazio como convite à ação: diz o que falta e oferece o próximo passo. */
export function EmptyState({ icon: Icon, title, description, action, size = 'regular' }: Props) {
  const compact = size === 'compact';
  return (
    <View style={[styles.root, compact && styles.compact]}>
      <View style={styles.mark}>
        <Icon size={compact ? 20 : 24} color={color.text} strokeWidth={1.75} />
      </View>
      <View style={styles.copy}>
        <Text variant={compact ? 'h3' : 'h2'} align="center">
          {title}
        </Text>
        {description ? (
          <Text variant={compact ? 'small' : 'body'} color={color.textSecondary} align="center">
            {description}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[4],
    paddingVertical: space[12],
    paddingHorizontal: space[6],
  },
  compact: { paddingVertical: space[8], gap: space[3] },
  mark: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { gap: space[1], maxWidth: 380 },
});
