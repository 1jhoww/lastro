import { Stack } from 'expo-router';
import { AppShell } from '@/layout/AppShell';
import { color } from '@/theme';
import { FinancialRecovery } from '@/features/finance/FinancialRecovery';

// Etapa 2: este layout passa a exigir sessão Firebase e empresa selecionada (redireciona para /entrar).
export default function AppLayout() {
  return (
    <AppShell>
      <FinancialRecovery background>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: color.canvas },
          }}
        />
      </FinancialRecovery>
    </AppShell>
  );
}
