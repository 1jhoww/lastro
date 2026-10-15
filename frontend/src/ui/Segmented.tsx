import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { color, fontFamily, radius, space } from '@/theme';
import { Text } from './Text';
import { focusRing, showFocusRing, type InteractionState } from './interaction';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

/**
 * Filtro de opções exclusivas (ex.: status do pedido). Rola na horizontal em telas estreitas
 * em vez de quebrar linha.
 */
export function Segmented<T extends string>({ label, options, value, onChange }: Props<T>) {
  return (
    <ScrollView
      // Não encolhe em colunas: sem isto o trilho sobrepõe o campo de cima no celular.
      style={styles.track}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
    >
      <View style={styles.root} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={(s: InteractionState) => [
                styles.item,
                selected ? styles.selected : s.hovered && styles.hovered,
                showFocusRing(s) && focusRing(),
              ]}
            >
              <Text
                variant="small"
                color={selected ? color.onStructure : color.textSecondary}
                style={
                  selected ? { fontFamily: fontFamily.semibold } : { fontFamily: fontFamily.medium }
                }
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  track: { flexGrow: 0, flexShrink: 0 },
  root: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSunken,
  },
  item: {
    minHeight: 36,
    paddingHorizontal: space[3] + 2,
    justifyContent: 'center',
    borderRadius: radius.sm + 1,
  },
  hovered: { backgroundColor: 'rgba(17,17,17,0.05)' },
  selected: { backgroundColor: color.structure },
});
