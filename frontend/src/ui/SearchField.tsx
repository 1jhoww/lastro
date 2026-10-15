import { Search, X } from '@/ui/icons';
import { Pressable, StyleSheet } from 'react-native';
import { color } from '@/theme';
import { TextField, type TextFieldProps } from './TextField';

type Props = Omit<TextFieldProps, 'icon' | 'trailing' | 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (value: string) => void;
};

/** Busca com limpar. A API faz busca por prefixo do nome; o texto de ajuda deve dizer isso. */
export function SearchField({ value, onChangeText, ...rest }: Props) {
  return (
    <TextField
      icon={Search}
      value={value}
      onChangeText={onChangeText}
      returnKeyType="search"
      autoCorrect={false}
      autoCapitalize="none"
      inputMode="search"
      {...rest}
      trailing={
        value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Limpar busca"
            hitSlop={10}
            onPress={() => onChangeText('')}
            style={styles.clear}
          >
            <X size={16} color={color.textSecondary} />
          </Pressable>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({ clear: { padding: 4 } });
