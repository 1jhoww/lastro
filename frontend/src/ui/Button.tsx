import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { color, fontFamily, layout, radius, space } from '@/theme';
import { Text } from './Text';
import { focusRing, showFocusRing, type InteractionState } from './interaction';

export type ButtonVariant = 'primary' | 'strong' | 'outline' | 'ghost' | 'danger' | 'onStructure';
export type ButtonSize = 'sm' | 'md' | 'lg';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Mostra indicador e bloqueia novos toques: proteção contra envio duplicado. */
  loading?: boolean;
  fullWidth?: boolean;
  trailing?: ReactNode;
};

const palette: Record<
  ButtonVariant,
  { bg: string; bgHover: string; bgPressed: string; fg: string; border?: string }
> = {
  primary: {
    bg: color.accent,
    bgHover: '#F7C21A',
    bgPressed: color.accentPressed,
    fg: color.onAccent,
  },
  strong: { bg: color.structure, bgHover: '#262626', bgPressed: '#000000', fg: color.onStructure },
  outline: {
    bg: 'transparent',
    bgHover: 'rgba(17,17,17,0.04)',
    bgPressed: 'rgba(17,17,17,0.08)',
    fg: color.text,
    border: color.borderStrong,
  },
  ghost: {
    bg: 'transparent',
    bgHover: 'rgba(17,17,17,0.05)',
    bgPressed: 'rgba(17,17,17,0.09)',
    fg: color.text,
  },
  danger: { bg: color.danger, bgHover: '#9F1F15', bgPressed: '#8A1A12', fg: '#FFFFFF' },
  onStructure: {
    bg: 'transparent',
    bgHover: color.structureRaised,
    bgPressed: color.structureLine,
    fg: color.onStructure,
    border: color.structureLine,
  },
};

const heights: Record<ButtonSize, number> = { sm: 36, md: layout.hitTarget, lg: 52 };

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled,
  fullWidth,
  trailing,
  ...rest
}: Props) {
  const p = palette[variant];
  const inactive = Boolean(disabled) || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={size === 'sm' ? 4 : undefined}
      {...rest}
      style={(state: InteractionState) => [
        styles.base,
        {
          height: heights[size],
          paddingHorizontal: size === 'sm' ? space[3] : space[5],
          backgroundColor: state.pressed ? p.bgPressed : state.hovered ? p.bgHover : p.bg,
          borderColor: p.border ?? 'transparent',
          opacity: disabled && !loading ? 0.45 : 1,
        },
        fullWidth && styles.full,
        showFocusRing(state) && focusRing(variant === 'onStructure'),
      ]}
    >
      <View style={[styles.content, loading && styles.hidden]}>
        {Icon ? <Icon size={size === 'sm' ? 16 : 18} color={p.fg} strokeWidth={2} /> : null}
        <Text
          variant={size === 'sm' ? 'smallStrong' : 'bodyStrong'}
          color={p.fg}
          style={{ fontFamily: fontFamily.semibold }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {trailing}
      </View>
      {loading ? <ActivityIndicator style={StyleSheet.absoluteFill} color={p.fg} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  full: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  hidden: { opacity: 0 },
});
