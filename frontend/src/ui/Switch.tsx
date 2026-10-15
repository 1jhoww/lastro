import { Switch as RNSwitch, StyleSheet, View } from 'react-native';
import { color, layout, space } from '@/theme';
import { Text } from './Text';

type Props = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  description?: string;
  disabled?: boolean;
};

/** Ligar/desligar com efeito imediato (ex.: produto ativo). Usa o controle nativo de cada plataforma. */
export function Switch({ label, value, onChange, description, disabled }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text variant="body">{label}</Text>
        {description ? (
          <Text variant="small" color={color.textSecondary}>
            {description}
          </Text>
        ) : null}
      </View>
      <RNSwitch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: color.borderStrong, true: color.structure }}
        thumbColor={value ? color.accent : color.surface}
        {...({ activeThumbColor: color.accent } as object)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: layout.hitTarget,
  },
  copy: { flex: 1, gap: 2 },
});
