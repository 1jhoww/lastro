import { Stack } from 'expo-router';
import { FinanceFrame } from '@/features/finance/FinanceNav';
import { color } from '@/theme';

/** Todas as telas do Financeiro dividem a coluna de seções no desktop. */
export default function FinanceLayout() {
  return (
    <FinanceFrame>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: color.canvas },
        }}
      />
    </FinanceFrame>
  );
}
