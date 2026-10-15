import { useState } from 'react';
import { Pressable } from 'react-native';
import { color } from '@/theme';
import { TextField, type TextFieldProps } from '@/ui';
import { Eye, EyeOff } from '@/ui/icons';

/** Campo de senha com mostrar/ocultar. */
export function PasswordField(props: Omit<TextFieldProps, 'secureTextEntry' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      secureTextEntry={!visible}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'}
          hitSlop={10}
          onPress={() => setVisible((v) => !v)}
        >
          {visible ? (
            <EyeOff size={18} color={color.textSecondary} />
          ) : (
            <Eye size={18} color={color.textSecondary} />
          )}
        </Pressable>
      }
    />
  );
}
