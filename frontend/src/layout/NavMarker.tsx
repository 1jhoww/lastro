import { StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { color } from '@/theme';

type Props = { icon: LucideIcon; active: boolean; tone?: 'onStructure' | 'onLight'; size?: number };

/**
 * Ícone de navegação com o marcador de "você está aqui": o quadrado amarelo encaixado no canto
 * superior direito, na mesma composição do símbolo do Lastro (L + quadrado).
 */
export function NavMarker({ icon: Icon, active, tone = 'onStructure', size = 20 }: Props) {
  const idle = tone === 'onStructure' ? color.onStructureSecondary : color.textSecondary;
  const on = tone === 'onStructure' ? color.onStructure : color.text;
  return (
    <View style={styles.box}>
      <Icon size={size} color={active ? on : idle} strokeWidth={active ? 2 : 1.75} />
      {active ? <View style={styles.square} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  square: {
    position: 'absolute',
    top: 0,
    right: -1,
    width: 7,
    height: 7,
    borderRadius: 2,
    backgroundColor: color.accent,
  },
});
