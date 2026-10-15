import Svg, { Path, Rect } from 'react-native-svg';
import { brand } from '@/theme';

type Props = {
  size?: number;
  tone?: 'onLight' | 'onDark';
};

/**
 * Símbolo do Lastro: um "L" estrutural com o quadrado amarelo no vão superior.
 *
 * Traçado provisório a partir da imagem do brand kit; substituir pelo SVG oficial quando
 * disponível (ver docs/brand.md). O componente isola o desenho para essa troca ser pontual.
 */
export function Symbol({ size = 32, tone = 'onLight' }: Props) {
  const ink = tone === 'onLight' ? brand.carvao : brand.bege;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="lastro">
      <Path
        fill={ink}
        d="M14 4h14a14 14 0 0 1 14 14v40a4 4 0 0 0 4 4h40a14 14 0 0 1 14 14v6a14 14 0 0 1-14 14H14A14 14 0 0 1 0 82V18A14 14 0 0 1 14 4z"
      />
      <Rect x={54} y={4} width={42} height={42} rx={10} fill={brand.amarelo} />
    </Svg>
  );
}
