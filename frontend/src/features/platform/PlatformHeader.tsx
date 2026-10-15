import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { color, space } from '@/theme';
import { Text } from '@/ui';

export function PlatformHeader(props: { title: string; description?: string; action?: ReactNode }) {
  return (
    <View style={styles.root}>
      <View style={styles.headings}>
        <Text variant="h1" accessibilityRole="header">
          {props.title}
        </Text>
        {props.description ? (
          <Text variant="body" color={color.textSecondary}>
            {props.description}
          </Text>
        ) : null}
      </View>
      {props.action}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: space[4] },
  headings: { flex: 1, minWidth: 240, gap: space[1] },
});
