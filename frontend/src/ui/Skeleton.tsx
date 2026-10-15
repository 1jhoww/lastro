import { useEffect, useState } from 'react';
import { Animated, type DimensionValue, StyleSheet } from 'react-native';
import { color, radius, useReducedMotion } from '@/theme';

type Props = { width?: DimensionValue; height?: number; rounded?: number };

/** Bloco de carregamento. Pulsa devagar; fica estático com movimento reduzido. */
export function Skeleton({ width = '100%', height = 14, rounded = radius.xs }: Props) {
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduced]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.base, { width, height, borderRadius: rounded, opacity }]}
    />
  );
}

const styles = StyleSheet.create({ base: { backgroundColor: color.surfaceSunken } });
