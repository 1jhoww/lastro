import { StyleSheet, Text, View } from 'react-native';
import { brand, fontFamily } from '@/theme';

type Props = {
  /** Altura do x aproximada pelo tamanho da fonte. */
  size?: number;
  tone?: 'onLight' | 'onDark';
  /** Assinatura institucional "by hepta", alinhada à direita sob o wordmark. */
  signature?: boolean;
};

/**
 * Wordmark "lastro." composto em Inter, seguindo o brand kit: minúsculas, peso semibold,
 * espaçamento negativo e ponto final em Amarelo Lastro.
 *
 * Reconstrução tipográfica provisória: substituir pelo SVG oficial quando os arquivos-fonte
 * da marca forem entregues (ver docs/brand.md). Não alterar proporções sem esse arquivo.
 */
export function Wordmark({ size = 28, tone = 'onLight', signature = false }: Props) {
  const ink = tone === 'onLight' ? brand.carvao : brand.bege;
  const dot = Math.round(size * 0.2);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={signature ? 'lastro, by hepta' : 'lastro'}
      style={styles.root}
    >
      <View style={styles.row}>
        <Text
          style={{
            fontFamily: fontFamily.semibold,
            fontSize: size,
            lineHeight: size * 1.1,
            letterSpacing: -size * 0.055,
            color: ink,
          }}
        >
          lastro
        </Text>
        <View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: brand.amarelo,
            marginLeft: size * 0.04,
            marginBottom: size * 0.2,
          }}
        />
      </View>
      {signature ? (
        <Text
          style={{
            alignSelf: 'flex-end',
            marginTop: -size * 0.12,
            marginRight: dot + size * 0.04,
            fontFamily: fontFamily.regular,
            fontSize: Math.max(11, size * 0.32),
            color: ink,
          }}
        >
          by hepta
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
});
