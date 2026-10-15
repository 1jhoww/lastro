import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wordmark } from '@/brand';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import { Button, Text } from '@/ui';
import { LogOut } from '@/ui/icons';

/**
 * Moldura das telas da conta fora de uma empresa (escolher empresa, acesso bloqueado, sem
 * empresa). Mostra quem está logado e sempre oferece sair.
 */
export function AccountFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { user, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const compact = useLayoutSize() === 'compact';

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + (compact ? space[4] : space[8]) },
        compact && styles.contentCompact,
      ]}
    >
      <View style={styles.inner}>
        <View style={styles.bar}>
          <Wordmark size={compact ? 22 : 26} />
          <View style={styles.who}>
            {compact ? null : (
              <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                {user?.email}
              </Text>
            )}
            <Button label="Sair" variant="ghost" size="sm" icon={LogOut} onPress={signOut} />
          </View>
        </View>
        <View style={styles.headings}>
          <Text variant="h1" accessibilityRole="header">
            {title}
          </Text>
          {description ? (
            <Text variant="body" color={color.textSecondary}>
              {description}
            </Text>
          ) : null}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.canvas },
  content: { paddingHorizontal: space[8], paddingBottom: space[12] },
  contentCompact: { paddingHorizontal: space[4] },
  inner: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: space[6] },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
    marginBottom: space[4],
  },
  who: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1 },
  headings: { gap: space[2] },
});
