import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { color as palette, type as typeScale, type TypeVariant } from '@/theme';

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  color?: string;
  align?: 'left' | 'center' | 'right';
};

export function Text({ variant = 'body', color = palette.text, align, style, ...rest }: TextProps) {
  return (
    <RNText
      {...rest}
      style={[typeScale[variant], { color }, align ? { textAlign: align } : null, style]}
    />
  );
}
