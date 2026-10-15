import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { color, useLayoutSize } from '@/theme';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';

/**
 * Estrutura do app autenticado. O desenho segue o símbolo: um "L" escuro (barra lateral no
 * desktop, barra inferior no celular) sustentando a área de trabalho clara.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const size = useLayoutSize();
  if (size === 'compact') {
    return (
      <View style={styles.column}>
        <View style={styles.main}>{children}</View>
        <TabBar />
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Sidebar rail={size === 'medium'} />
      <View style={styles.main}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: color.canvas },
  column: { flex: 1, backgroundColor: color.canvas },
  main: { flex: 1, backgroundColor: color.canvas },
});
