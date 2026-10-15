import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ChevronRight, type LucideIcon } from '@/ui/icons';
import { color, layout, space } from '@/theme';
import { Text } from './Text';
import { focusRing, showFocusRing, type InteractionState } from './interaction';
import { Touchable } from './Touchable';

type Props = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  href?: Href;
  /** Texto curto à direita (ex.: "em breve"). */
  meta?: string;
  disabled?: boolean;
  last?: boolean;
};

/** Linha de lista navegável: base das listas no celular e dos menus de configuração. */
export function ListRow({ title, description, icon: Icon, href, meta, disabled, last }: Props) {
  const row = (
    <Touchable
      accessibilityRole={href ? 'link' : undefined}
      accessibilityState={{ disabled }}
      disabled={disabled || !href}
      pressStyle={(s: InteractionState) => [
        styles.row,
        !last && styles.divider,
        (s.hovered || s.pressed) && !disabled && { backgroundColor: 'rgba(17,17,17,0.03)' },
        showFocusRing(s) && focusRing(),
      ]}
    >
      {Icon ? (
        <View style={styles.icon}>
          <Icon size={20} color={disabled ? color.textDisabled : color.text} strokeWidth={1.75} />
        </View>
      ) : null}
      <View style={styles.copy}>
        <Text variant="bodyStrong" color={disabled ? color.textSecondary : color.text}>
          {title}
        </Text>
        {description ? (
          <Text variant="small" color={color.textSecondary}>
            {description}
          </Text>
        ) : null}
      </View>
      {meta ? (
        <Text variant="caption" color={color.textSecondary}>
          {meta}
        </Text>
      ) : null}
      {href && !disabled ? <ChevronRight size={18} color={color.textSecondary} /> : null}
    </Touchable>
  );
  return href && !disabled ? (
    <Link href={href} asChild>
      {row}
    </Link>
  ) : (
    row
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget + 16,
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  icon: { width: 24, alignItems: 'center' },
  copy: { flex: 1, gap: 2 },
});
